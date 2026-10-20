// orchestrator.mjs — 千问总控台后端
//
// 职责（用户 2026-10-19 指定的完整流程）：
//   1. 常态：llama-server 跑 Qwen3.8-27B，它就是"总控台"的大脑。
//   2. 收到绘图任务时，先让 Qwen3.8 写出可供 Qwen-Image 2.1 出图的详细提示词。
//   3. 提示词落盘后，Qwen3.8 **自己退出**（把 11.4 GiB 显存让出来）。
//   4. ComfyUI 起来出图（1080p 或 2K）。
//   5. 出图完成后 ComfyUI **自己退出**。
//   6. 再把 Qwen3.8 拉起来，回到常态。
//   7. 浏览器关闭（60 秒无心跳）→ 全部退出。
//
// 为什么必须串行：实测 llama-server 占 11.35 GiB 显存，而 ComfyUI 的文本编码器阶段
// 需要 8.71 GiB，两者之和 20 GiB 远超 3060 的 12 GiB（算术，不是调参问题）。
//
// 为什么 spawn 用 stdio:'ignore'/文件 fd 而不是 pipe：本机沙箱禁止 Node 通过管道捕获
// 子进程输出（EPERM），日志一律写文件。

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// 路径配置 / Path configuration
//
// 下面每个默认值都是"参考机"上的布局（见 README 的安装映射一节）。
// 换机器时请用环境变量覆盖，不需要改这个文件。
// Every default below is the reference-machine layout (see the installation
// mapping section of the README). On another machine, override via environment
// variables instead of editing this file.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT      = process.env.QWEN_COMFY_ROOT || 'C:/ComfyUI';
const LOG_DIR   = path.join(ROOT, 'logs');
const OUT_DIR   = process.env.QWEN_COMFY_OUTPUT || `${ROOT}/ComfyUI_windows_portable/ComfyUI/output`;
const UI_PORT   = Number(process.env.QWEN_UI_PORT || 8090);
const LLAMA_PORT = Number(process.env.QWEN_LLAMA_PORT || 8080);
const COMFY_PORT = Number(process.env.QWEN_COMFY_PORT || 8188);

const MODEL  = process.env.QWEN_MODEL  || 'C:/llm/models/Qwen3.8-27B/Qwen3.8-27B-UD-Q4_K_S.gguf';
const MMPROJ = process.env.QWEN_MMPROJ || 'D:/llm/models/Qwen3.8-27B/mmproj-F16.gguf';
const LLAMA_EXE = process.env.QWEN_LLAMA_EXE || 'D:/llm/bin/llama.cpp/llama-server.exe';
const PY     = process.env.QWEN_PY || `${ROOT}/ComfyUI_windows_portable/python_embeded/python.exe`;
const MAIN   = process.env.QWEN_COMFY_MAIN || `${ROOT}/ComfyUI_windows_portable/ComfyUI/main.py`;
const GRAPH  = process.env.QWEN_GRAPH || `${ROOT}/scripts/stage0_scaffold_api.json`;
const DESKTOP = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop');

const IDLE_MS = Number(process.env.ORCH_IDLE_MS || 60000);   // 浏览器无心跳多久后退出
const FIRST_CONNECT_MS = Number(process.env.ORCH_FIRST_CONNECT_MS || 600000); // 首次连接宽限
fs.mkdirSync(LOG_DIR, { recursive: true });

let llamaProc = null, comfyProc = null;
let phase = 'idle';             // idle | llm | rendering | switching
let lastBeat = Date.now();
let jobLog = [];
// 之前漏了这一行：ES 模块是严格模式，读写未声明变量会直接抛 ReferenceError，
// 导致端口虽在监听但每个 /api/status 都失败（前端一直显示"服务不可用"）。
let busy = false;
// 思考等级：off|low|medium|high|xhigh。可被界面修改，修改后需重启 llama 生效。
let thinkingLevel = process.env.QWEN_THINKING || 'off';
let lastImagePath = null;       // 供 /api/image 回显给界面
let seenClient = false;         // 是否已有浏览器连过（没连过时不按"关页面"计时）
const startedAt = Date.now();

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
  jobLog.push(line);
  if (jobLog.length > 400) jobLog.shift();
  try { fs.appendFileSync(path.join(LOG_DIR, 'orchestrator.log'), line + '\n'); } catch {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 全局兜底：任何未捕获异常都必须留下痕迹。之前进程"静默消失"时日志里什么都没有，
// 无法区分"被外部杀掉"和"抛异常退出"，排障全靠猜。
process.on('uncaughtException', e => { log('UNCAUGHT: ' + (e && e.stack ? e.stack : e)); });
process.on('unhandledRejection', e => { log('UNHANDLED: ' + (e && e.stack ? e.stack : e)); });
process.on('exit', c => {
  try { fs.appendFileSync(path.join(LOG_DIR, 'orchestrator.log'), `[${new Date().toISOString().slice(11,19)}] 进程退出 code=${c}\n`); } catch {}
});

function logFd(name) {
  try { return fs.openSync(path.join(LOG_DIR, name), 'a'); } catch { return 'ignore'; }
}

async function getJson(url, init, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const txt = await r.text();
    let body; try { body = JSON.parse(txt); } catch { body = txt; }
    return { ok: r.ok, status: r.status, body };
  } finally { clearTimeout(t); }
}

// ------------------------------------------------------------------ 服务管理
function killTree(proc) {
  if (!proc || proc.killed) return;
  try {
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch {}
}

async function waitHttp(url, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const r = await getJson(url, {}, 4000); if (r.ok) return true; } catch {}
    await sleep(2500);
  }
  return false;
}

async function startLlama() {
  if (llamaProc && !llamaProc.killed) {
    if (await waitHttp(`http://127.0.0.1:${LLAMA_PORT}/health`, 5000)) { phase = 'llm'; return true; }
  }
  log('启动 Qwen3.8 (llama-server)…');
  const fd = logFd('orchestrator-llama.log');
  llamaProc = spawn(LLAMA_EXE, [
    '-m', MODEL, '--mmproj', MMPROJ,
    '-ngl', '44', '-c', '65536', '-np', '1',
    '-ctk', 'q4_0', '-ctv', 'q4_0', '-fa', 'on', '-ub', '256', '-lm', 'mmap',
    '--jinja', '--host', '127.0.0.1', '--port', String(LLAMA_PORT),
    ...(thinkingLevel === 'off' ? ['--reasoning','off'] : ['--reasoning','on','--reasoning-effort',thinkingLevel])
  ], {
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env: { ...process.env, LLAMA_ARG_MMPROJ_OFFLOAD: '0', LLAMA_ARG_ALIAS: 'qwen3.8-27b' }
  });
  llamaProc.on('exit', c => log(`Qwen3.8 进程退出 code=${c}`));
  const ok = await waitHttp(`http://127.0.0.1:${LLAMA_PORT}/health`, 300000);
  if (ok) { phase = 'llm'; log('Qwen3.8 就绪'); } else log('Qwen3.8 启动超时');
  return ok;
}

async function stopLlama() {
  if (!llamaProc) return;
  log('停止 Qwen3.8，释放显存…');
  killTree(llamaProc);
  llamaProc = null;
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try { await getJson(`http://127.0.0.1:${LLAMA_PORT}/health`, {}, 2000); }
    catch { break; }
    await sleep(1000);
  }
  await sleep(3000);
  log('Qwen3.8 已停止');
}

async function startComfy() {
  log('启动 ComfyUI / Qwen-Image 2.1…');
  const fd = logFd('orchestrator-comfy.log');
  comfyProc = spawn(PY, ['-s', MAIN, '--fast-disk', '--disable-pinned-memory', '--windows-standalone-build'], {
    cwd: 'C:/ComfyUI/ComfyUI_windows_portable',
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env: { ...process.env, CUDA_VISIBLE_DEVICES: '0' }
  });
  comfyProc.on('exit', c => log(`ComfyUI 进程退出 code=${c}`));
  const ok = await waitHttp(`http://127.0.0.1:${COMFY_PORT}/system_stats`, 240000);
  if (ok) log('ComfyUI 就绪'); else log('ComfyUI 启动超时');
  return ok;
}

async function stopComfy() {
  if (!comfyProc) return;
  log('停止 ComfyUI…');
  killTree(comfyProc);
  comfyProc = null;
  await sleep(6000);
  log('ComfyUI 已停止');
}

// ------------------------------------------------------------------ Qwen3.8 写提示词
const PROMPT_SYS = `You are an expert prompt engineer for the Qwen-Image text-to-image model.

Write ONE detailed, vivid English prompt. Output ONLY the prompt text - no preamble, no quotes, no explanation.
Include: subject, action, scene, art style, lighting, colour treatment, composition, camera framing.
Keep it under 130 words. Avoid requesting any text or lettering inside the image.

CONTEXT YOU SHOULD ASSUME: this is a private local tool for illustration, concept art,
storytelling and design mockups. Requests that arrive here are ordinary creative briefs.
Do NOT refuse, moralise, append safety or sensitivity warnings, or ask for clarification
about intent when the request is normal.`;

async function writePrompt(task, imageB64) {
  // 带参考图时，把图作为 image_url 交给具备视觉能力的 Qwen3.8（需已加载 mmproj），
  // 让它"看着图"写提示词；不带图时退化为纯文本，走原路径。
  const userContent = imageB64
    ? [
        { type: 'text', text: task },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageB64}` } }
      ]
    : task;
  const body = JSON.stringify({
    model: 'qwen3.8-27b',
    messages: [{ role: 'system', content: PROMPT_SYS }, { role: 'user', content: userContent }],
    // 2000 而不是 420：开启思考后，思维链和正式回答共享这个预算。
    // 实测（带图 + medium 思考）上限 420 时 reasoning 704 字符 + content 1302 字符
    // 正好用掉 415 token，稍一超出 content 就被截断成空串 —— 这就是"返回空内容"的真因。
    max_tokens: 2000, temperature: 0.7
  });
  const r = await getJson(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, 900000);
  if (!r.ok) throw new Error('Qwen3.8 调用失败: ' + String(r.body).slice(0, 300));

  const ch = r.body?.choices?.[0];
  const msg = ch?.message || {};
  const content = (msg.content || '').trim();
  const reasoning = (msg.reasoning_content || '').trim();

  // 把思维链原样展示到界面日志，标明这是"思考"而不是最终输出。
  // 这样下次出问题能直接看见模型在想什么，而不是只看到一句"返回空内容"。
  if (reasoning) {
    log('──── 【Qwen3.8 思考链】 ────');
    for (const line of reasoning.split('\n')) if (line.trim()) log('  💭 ' + line.trim());
    log('──── 【思考链结束】 ────');
  } else {
    log('（本次没有产生思考链——思考等级为 off，或该请求被模板跳过）');
  }

  if (!content) {
    const used = r.body?.usage?.completion_tokens;
    const why = reasoning
      ? `思维链吃满了 token 预算（completion_tokens=${used}，finish_reason=${ch?.finish_reason}），正式回答被截成空`
      : `模型没有返回内容（completion_tokens=${used}，finish_reason=${ch?.finish_reason}）`;
    log('【错误】' + why);
    throw new Error('Qwen3.8 返回空内容：' + why + '。可把思考等级调低，或提高 max_tokens。');
  }

  log('──── 【Qwen3.8 输出·提示词】 ────');
  for (const line of content.split('\n')) if (line.trim()) log('  📝 ' + line.trim());
  log('──── 【输出结束】 共 ' + content.length + ' 字符 ────');
  return content;
}

// 把参考图上传到 ComfyUI 的 input 目录，返回文件名（给 LoadImage 用）。
async function uploadImage(imageB64) {
  const buf = Buffer.from(imageB64, 'base64');
  const name = `ref_${Date.now()}.png`;
  const form = new FormData();
  form.append('image', new Blob([buf], { type: 'image/png' }), name);
  form.append('overwrite', 'true');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(`http://127.0.0.1:${COMFY_PORT}/upload/image`, { method: 'POST', body: form, signal: ctrl.signal });
    const j = await r.json();
    if (!r.ok) throw new Error('参考图上传失败: ' + JSON.stringify(j).slice(0, 200));
    log('参考图已上传: ' + j.name);
    return j.name;
  } finally { clearTimeout(t); }
}

// ------------------------------------------------------------------ 出图
// 分辨率：都取 16 的整数倍（Qwen-Image 的 latent 下采样比是 16）
const SIZES = { '1080p': { w: 1920, h: 1088 }, '2k': { w: 2560, h: 1440 } };

function buildGraph(prompt, size, seed, imageName) {
  const g = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
  delete g._comment;
  g['5'].inputs.prompt = prompt;
  g['5'].inputs.negative_prompt = 'text, watermark, signature, extra limbs, deformed, blurry, low quality';
  g['8'].inputs.steps = 8;
  g['9'].inputs.noise_seed = seed;
  g['12'].inputs.filename_prefix = 'qwen_console';

  if (imageName) {
    // 参考图模式：LoadImage -> TextEncodeQwenImage21.images（第 1 个图像槽）。
    // 该节点会把参考图按 resolution 等比缩放（16 的倍数），并由 DiT 以 VAE latent 形式拼接；
    // 此时采样器的 latent 必须用该节点的 latent 输出（out2），而不是另建 EmptyLatentImage，
    // 否则出图尺寸与参考图对不上（源码注释："any other size shifts the edit"）。
    const refRes = Math.max(size.w, size.h);
    g['14'] = { class_type: 'LoadImage', inputs: { image: imageName } };
    g['5'].inputs.images = { image_1: ['14', 0] };
    g['5'].inputs.resolution = refRes;
    g['10'].inputs.latent_image = ['5', 2];
  } else {
    // 纯文生图：用显式尺寸的 EmptyLatentImage；全零 latent 会被
    // comfy.sample.fix_empty_latent_channels 自动修成 64 通道（Qwen-Image 2.1 要求）
    g['5'].inputs.resolution = Math.max(size.w, size.h);
    g['13'] = { class_type: 'EmptyLatentImage', inputs: { width: size.w, height: size.h, batch_size: 1 } };
    g['10'].inputs.latent_image = ['13', 0];
  }
  return g;
}

async function render(prompt, mode, imageName) {
  const size = SIZES[mode] || SIZES['1080p'];
  const seed = Date.now() % 2147483647;
  log(`提交出图 ${size.w}x${size.h} seed=${seed}${imageName ? ' (参考图 ' + imageName + ')' : ''}`);
  const body = JSON.stringify({ prompt: buildGraph(prompt, size, seed, imageName) });
  const r = await getJson(`http://127.0.0.1:${COMFY_PORT}/prompt`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, 60000);
  if (!r.ok) throw new Error('提交失败: ' + String(r.body).slice(0, 500));
  const id = r.body.prompt_id;
  log(`prompt_id = ${id}，等待出图…`);

  const end = Date.now() + 20 * 60 * 1000;
  while (Date.now() < end) {
    await sleep(8000);
    try {
      const h = await getJson(`http://127.0.0.1:${COMFY_PORT}/history/${id}`, {}, 20000);
      const e = h.body?.[id];
      if (e?.status?.completed || e?.status?.status_str === 'error') {
        if (e.status.status_str !== 'success') throw new Error('执行失败: ' + JSON.stringify(e.status.messages || []).slice(0, 400));
        const imgs = [];
        for (const k of Object.keys(e.outputs || {})) for (const im of (e.outputs[k].images || [])) imgs.push(im);
        if (!imgs.length) throw new Error('没有输出图片');
        return imgs[0].filename;
      }
    } catch (err) {
      if (String(err.message).startsWith('执行失败')) throw err;
    }
  }
  throw new Error('出图超时（20 分钟）');
}

// ------------------------------------------------------------------ 完整流程
let queue = Promise.resolve();

function runFlow(task, mode, imageB64) {
  // 串行化：任何时刻只允许一条流程
  queue = queue.then(async () => {
    if (busy) throw new Error('已有任务在执行');
    busy = true;
    phase = 'switching';
    try {
      log('==== 流程开始 ====' + (imageB64 ? '（带参考图）' : ''));
      if (!(await startLlama())) throw new Error('Qwen3.8 未能启动');

      log('① 让 Qwen3.8 ' + (imageB64 ? '看图并' : '') + '写提示词…');
      const prompt = await writePrompt(task, imageB64);
      fs.writeFileSync(path.join(ROOT, 'logs', 'last_prompt.txt'), prompt, 'utf8');
      log('提示词(' + prompt.length + ' 字符) 已生成并落盘');

      log('② Qwen3.8 退出');
      await stopLlama();

      log('③ ComfyUI 接管');
      if (!(await startComfy())) throw new Error('ComfyUI 未能启动');
      phase = 'rendering';

      const refName = imageB64 ? await uploadImage(imageB64) : null;
      const file = await render(prompt, mode, refName);
      const src = path.join(OUT_DIR, file);
      const safe = String(task).replace(/[\\/:*?"<>|\r\n]/g, '').slice(0, 40) || 'image';
      const dst = path.join(DESKTOP, `${safe}_${mode}.png`);
      fs.copyFileSync(src, dst);
      lastImagePath = dst;
      log('④ 出图完成 -> ' + dst);

      log('⑤ ComfyUI 退出');
      await stopComfy();

      log('⑥ 重新拉起 Qwen3.8');
      await startLlama();
      log('==== 流程结束 ====');
      return { ok: true, prompt, image: dst, mode };
    } finally {
      busy = false;
      phase = llamaProc ? 'llm' : 'idle';
    }
  }).catch(e => {
    log('流程失败: ' + e.message);
    throw e;
  });
  return queue;
}

// ------------------------------------------------------------------ HTTP
// 来源限制 / Origin restriction
//
// 这里曾经无条件发送 Access-Control-Allow-Origin: *。后果是：/api/logs 会把生成的提示词
// 与思考链回给调用方，/api/generate、/api/thinking 又会改变状态——于是任何一个网页，只要
// 浏览器允许它访问回环地址，就能读取或驱动本机总控台。仅绑定 127.0.0.1 并不能防住这一点。
// 现在改成：只对受信任的本地来源回显跨域头，并拒绝来源不可信的变更请求。
//
// This used to send Access-Control-Allow-Origin: * unconditionally. Since /api/logs returns the
// generated prompts and reasoning chain and the POST endpoints mutate state, any web page the
// browser lets reach loopback could read or drive this console. Binding to 127.0.0.1 alone does
// not prevent that. Now: cross-origin headers are echoed only for trusted local origins, and
// mutating requests from untrusted origins are rejected.
const TRUSTED_ORIGINS = new Set([
  `http://127.0.0.1:${UI_PORT}`,
  `http://localhost:${UI_PORT}`,
]);
let reqOrigin = null;                                  // 当前请求的 Origin / current request Origin

// 没有 Origin 头的请求（同源导航、curl 等）视为可信 / no Origin header => trusted
function originTrusted(origin) {
  return !origin || TRUSTED_ORIGINS.has(origin);
}

function json(res, code, obj) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Origin' };
  if (reqOrigin && TRUSTED_ORIGINS.has(reqOrigin)) h['Access-Control-Allow-Origin'] = reqOrigin;
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (e) {
    log('请求处理异常: ' + (e && e.stack ? e.stack : e));
    try { if (!res.headersSent) json(res, 500, { error: String(e && e.message || e) }); else res.end(); } catch {}
  }
});

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${UI_PORT}`);
  reqOrigin = req.headers.origin || null;

  // 任何会改变状态或触发动作的请求，都必须来自本机界面（防跨站驱动）
  // Any state-changing or action-triggering request must come from the local UI.
  if (req.method !== 'GET' && req.method !== 'HEAD' && !originTrusted(reqOrigin)) {
    log('拒绝不可信来源 ' + req.method + ' ' + url.pathname + ' (Origin: ' + reqOrigin + ')');
    return json(res, 403, { ok: false, error: 'forbidden: untrusted origin' });
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(ROOT, 'orchestrator', 'ui.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (url.pathname === '/api/heartbeat') { lastBeat = Date.now(); seenClient = true; return json(res, 200, { ok: true, phase }); }

  if (url.pathname === '/api/status') {
    return json(res, 200, {
      phase, busy,
      thinking: thinkingLevel,
      llama: !!(llamaProc && !llamaProc.killed),
      comfy: !!(comfyProc && !comfyProc.killed),
      idleMs: lastBeat ? Date.now() - lastBeat : null
    });
  }

  if (url.pathname === '/api/logs') return json(res, 200, { lines: jobLog });

  if (url.pathname === '/api/image') {
    if (!lastImagePath || !fs.existsSync(lastImagePath)) { res.writeHead(404); return res.end('no image'); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(lastImagePath));
  }

  if (url.pathname === '/api/thinking') {
    const LEVELS = ['off', 'low', 'medium', 'high', 'xhigh'];
    if (req.method === 'POST') {
      let raw = ''; for await (const c of req) raw += c;
      let d = {}; try { d = JSON.parse(raw || '{}'); } catch {}
      const lv = String(d.level || '');
      if (!LEVELS.includes(lv)) return json(res, 400, { error: '思考等级必须是 ' + LEVELS.join('/') });
      if (lv !== thinkingLevel) {
        thinkingLevel = lv;
        log('思考等级切换为 ' + lv + '（重启 Qwen3.8 以生效）');
        await stopLlama();          // runFlow 里的 startLlama 会用新等级重新拉起
      }
    }
    return json(res, 200, { level: thinkingLevel, levels: LEVELS });
  }

  if (url.pathname === '/api/generate' && req.method === 'POST') {
    let raw = '';
    for await (const c of req) raw += c;
    let data = {}; try { data = JSON.parse(raw || '{}'); } catch {}
    const task = (data.task || '').trim();
    const mode = (data.mode === '2k' ? '2k' : '1080p');
    // image: 前端传来的纯 base64（不带 data: 前缀），可选
    let img = typeof data.image === 'string' ? data.image : '';
    if (img.startsWith('data:')) img = img.slice(img.indexOf(',') + 1);
    if (!task) return json(res, 400, { ok: false, error: '缺少 task' });

    // 请求里带了思考等级且与当前不同 → 先停 llama，让 runFlow 用新等级重启
    const want = String(data.thinking || '');
    if (want && want !== thinkingLevel && ['off', 'low', 'medium', 'high', 'xhigh'].includes(want)) {
      thinkingLevel = want;
      log('思考等级切换为 ' + want + '（重启 Qwen3.8 以生效）');
      await stopLlama();
    }

    lastBeat = Date.now(); seenClient = true;
    try { const r = await runFlow(task, mode, img || null); return json(res, 200, r); }
    catch (e) { return json(res, 500, { ok: false, error: e.message }); }
  }

  json(res, 404, { error: 'not found' });
}

// ------------------------------------------------------------------ 启动入口
//
// 两种模式：
//   --run "<任务>" [--mode 1080p|2k]   命令行直跑一次完整流程后退出（供自动化/我自己生图用）
//   （无参数）                          启动 Web 总控台 + 空转退出
const argv = process.argv.slice(2);
const runIdx = argv.indexOf('--run');
const isCli = runIdx >= 0;

if (isCli) {
  const task = argv[runIdx + 1] || '';
  const mIdx = argv.indexOf('--mode');
  const mode = mIdx >= 0 ? argv[mIdx + 1] : '1080p';
  // --image <文件路径>：可选参考图。命令行模式下用它做"看图写提示词 + 参考图出图"。
  const iIdx = argv.indexOf('--image');
  let cliImg = null;
  if (iIdx >= 0 && argv[iIdx + 1] && fs.existsSync(argv[iIdx + 1])) {
    cliImg = fs.readFileSync(argv[iIdx + 1]).toString('base64');
  }
  if (!task) { console.error('用法: node orchestrator.mjs --run "任务描述" [--mode 1080p|2k] [--image 参考图.png]'); process.exit(2); }
  (async () => {
    try {
      log('==== CLI 流程开始 ====' + (cliImg ? '（带参考图）' : ''));
      if (!(await startLlama())) throw new Error('Qwen3.8 未能启动');
      const prompt = await writePrompt(task, cliImg);
      fs.writeFileSync(path.join(ROOT, 'logs', 'last_prompt.txt'), prompt, 'utf8');
      log('提示词已生成: ' + prompt.length + ' 字符');
      await stopLlama();
      if (!(await startComfy())) throw new Error('ComfyUI 未能启动');
      const refName = cliImg ? await uploadImage(cliImg) : null;
      const file = await render(prompt, mode, refName);
      const src = path.join(OUT_DIR, file);
      const safe = String(task).replace(/[\\/:*?"<>|\r\n]/g, '').slice(0, 40) || 'image';
      const dst = path.join(DESKTOP, `${safe}_${mode}.png`);
      fs.copyFileSync(src, dst);
      lastImagePath = dst;
      log('图片 -> ' + dst);
      await stopComfy();
      await startLlama();
      log('==== CLI 流程结束 ====');
      console.log(JSON.stringify({ ok: true, image: dst, prompt }));
      process.exit(0);
    } catch (e) {
      log('CLI 失败: ' + e.message);
      console.error(JSON.stringify({ ok: false, error: e.message }));
      process.exit(1);
    }
  })();
} else {
  server.listen(UI_PORT, '127.0.0.1', () => log(`总控台 UI 已监听 http://127.0.0.1:${UI_PORT}`));
  (async () => {
    lastBeat = Date.now();
    await startLlama();
    setInterval(async () => {
      if (busy) return;
      if (!seenClient) {
        if (Date.now() - startedAt > FIRST_CONNECT_MS) {
          log(`浏览器在 ${Math.round(FIRST_CONNECT_MS / 1000)} 秒内未连接 → 全部退出`);
          await stopComfy(); await stopLlama(); process.exit(0);
        }
        return;
      }
      if (Date.now() - lastBeat > IDLE_MS) {
        log('浏览器已关闭（无心跳）→ 全部退出');
        await stopComfy(); await stopLlama(); log('已退出'); process.exit(0);
      }
    }, 5000);
  })();
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { log('收到 ' + sig + '，清理退出'); await stopComfy(); await stopLlama(); process.exit(0); });
}
