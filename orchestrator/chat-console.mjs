// chat-console.mjs — 纯对话总控台（只用 Qwen3.8-27B，64K 上下文，不生图）
//
// 与出图总控台的区别（用户 2026-10-19 明确要求）：
//   1. 只做语言对话，不碰 ComfyUI，完全不动显存给画图。
//   2. 上下文固定 64K（实测该配置显存 11.5 GiB、内存约 96%，是本机上限内的最优解）。
//   3. **不会自动退出**：没有空闲计时器，只有用户点"退出"或收到停止信号才关闭。
//      （出图总控台是"关浏览器→60 秒退出"，这里刻意不那样做。）
//
// 端口 8091，与出图总控台（8090）分开，互不干扰。
// 若 8080 上已有健康 llama，则复用，不重复启动，退出时也不误杀别人的实例。

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 路径配置：默认值为参考机布局，换机器用环境变量覆盖。
// Path configuration: defaults are the reference-machine layout; override with
// environment variables on another machine.
const ROOT      = process.env.QWEN_COMFY_ROOT || 'C:/ComfyUI';
const LOG_DIR   = path.join(ROOT, 'logs');
const UI_DIR    = process.env.QWEN_UI_DIR || `${ROOT}/orchestrator`;
const UI_PORT   = Number(process.env.QWEN_CHAT_UI_PORT || 8091);
const LLAMA_PORT = Number(process.env.QWEN_LLAMA_PORT || 8080);

const MODEL  = process.env.QWEN_MODEL  || 'C:/llm/models/Qwen3.8-27B/Qwen3.8-27B-UD-Q4_K_S.gguf';
const MMPROJ = process.env.QWEN_MMPROJ || 'D:/llm/models/Qwen3.8-27B/mmproj-F16.gguf';
const LLAMA_EXE = process.env.QWEN_LLAMA_EXE || 'D:/llm/bin/llama.cpp/llama-server.exe';

// 64K 上下文的实测最优配置；-ngl 44 是"显存装得下且内存最省"的点
const CTX = Number(process.env.QWEN_CTX || 65536);
const NGL = Number(process.env.QWEN_NGL || 44);

fs.mkdirSync(LOG_DIR, { recursive: true });

let llamaProc = null;
let ownsLlama = false;                  // 只清理自己启动的实例
let thinkingLevel = process.env.QWEN_THINKING || 'off';
let busy = false;
let logLines = [];

function log(m) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${m}`;
  console.log(line);
  logLines.push(line);
  if (logLines.length > 500) logLines.shift();
  try { fs.appendFileSync(path.join(LOG_DIR, 'chat-console.log'), line + '\n'); } catch {}
}
process.on('uncaughtException', e => log('UNCAUGHT: ' + (e?.stack || e)));
process.on('unhandledRejection', e => log('UNHANDLED: ' + (e?.stack || e)));

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

async function llamaHealthy(ms = 4000) {
  try { const r = await getJson(`http://127.0.0.1:${LLAMA_PORT}/health`, {}, ms); return r.ok; }
  catch { return false; }
}

function logFd(name) { try { return fs.openSync(path.join(LOG_DIR, name), 'a'); } catch { return 'ignore'; } }

function killTree(proc) {
  if (!proc || proc.killed) return;
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
}

async function startLlama() {
  if (await llamaHealthy(3000)) {
    // 别人已经在跑就复用；ownsLlama 保持 false，退出时不动它
    if (!llamaProc) log('检测到 8080 上已有健康的 Qwen3.8，直接复用');
    return true;
  }
  log(`启动 Qwen3.8（64K / -ngl ${NGL} / 思考=${thinkingLevel}）…`);
  const fd = logFd('chat-console-llama.log');
  const reasonArgs = thinkingLevel === 'off'
    ? ['--reasoning', 'off']
    : ['--reasoning', 'on', '--reasoning-effort', thinkingLevel];
  llamaProc = spawn(LLAMA_EXE, [
    '-m', MODEL, '--mmproj', MMPROJ,
    '-ngl', String(NGL), '-c', String(CTX), '-np', '1',
    '-ctk', 'q4_0', '-ctv', 'q4_0', '-fa', 'on', '-ub', '256', '-lm', 'mmap',
    '--jinja', '--host', '127.0.0.1', '--port', String(LLAMA_PORT),
    ...reasonArgs
  ], {
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env: { ...process.env, LLAMA_ARG_MMPROJ_OFFLOAD: '0', LLAMA_ARG_ALIAS: 'qwen3.8-27b' }
  });
  ownsLlama = true;
  const end = Date.now() + 300000;
  while (Date.now() < end) {
    if (await llamaHealthy(4000)) { log('Qwen3.8 就绪'); return true; }
    await sleep(3000);
  }
  log('Qwen3.8 启动超时');
  return false;
}

async function stopLlama() {
  if (!ownsLlama || !llamaProc) { log('不停止 llama（不是本总控台启动的）'); return; }
  log('停止 Qwen3.8…');
  killTree(llamaProc);
  llamaProc = null; ownsLlama = false;
  await sleep(3000);
}

// ------------------------------------------------------------------ HTTP
// 来源限制 / Origin restriction：只接受本机界面的变更请求。
// 本文件原本不发任何跨域头，但跨站页面仍可"发送"POST（读不到响应不等于没执行），
// 所以 /api/chat、/api/quit、/api/thinking 这类接口必须校验 Origin。
// This file never sent CORS headers, but a cross-site page can still SEND a POST to it
// (being unable to read the response does not mean it did not execute), so the mutating
// endpoints must validate Origin.
const TRUSTED_ORIGINS = new Set([
  `http://127.0.0.1:${UI_PORT}`,
  `http://localhost:${UI_PORT}`,
]);
let reqOrigin = null;

function originTrusted(origin) {
  return !origin || TRUSTED_ORIGINS.has(origin);   // 无 Origin 头（同源 / curl）视为可信
}

function json(res, code, obj) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Origin' };
  if (reqOrigin && TRUSTED_ORIGINS.has(reqOrigin)) h['Access-Control-Allow-Origin'] = reqOrigin;
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${UI_PORT}`);
  reqOrigin = req.headers.origin || null;

  // 变更请求必须来自本机界面 / mutating requests must come from the local UI
  if (req.method !== 'GET' && req.method !== 'HEAD' && !originTrusted(reqOrigin)) {
    log('拒绝不可信来源 ' + req.method + ' ' + url.pathname + ' (Origin: ' + reqOrigin + ')');
    return json(res, 403, { ok: false, error: 'forbidden: untrusted origin' });
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(UI_DIR, 'chat-ui.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (url.pathname === '/api/status') {
    return json(res, 200, {
      busy, thinking: thinkingLevel, ctx: CTX, ngl: NGL,
      llama: await llamaHealthy(2500),
      ownsLlama
    });
  }

  if (url.pathname === '/api/logs') return json(res, 200, { lines: logLines });

  if (url.pathname === '/api/thinking' && req.method === 'POST') {
    let raw = ''; for await (const c of req) raw += c;
    let d = {}; try { d = JSON.parse(raw || '{}'); } catch {}
    const lv = String(d.level || '');
    const LEVELS = ['off', 'low', 'medium', 'high', 'xhigh'];
    if (!LEVELS.includes(lv)) return json(res, 400, { error: '等级必须是 ' + LEVELS.join('/') });
    if (lv !== thinkingLevel) {
      thinkingLevel = lv;
      log('思考等级 -> ' + lv + '（重启 Qwen3.8 生效）');
      await stopLlama();
      await startLlama();
    }
    return json(res, 200, { level: thinkingLevel });
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    let raw = ''; for await (const c of req) raw += c;
    let d = {}; try { d = JSON.parse(raw || '{}'); } catch {}
    const messages = Array.isArray(d.messages) ? d.messages : [];
    if (!messages.length) return json(res, 400, { error: '缺少 messages' });
    if (busy) return json(res, 429, { error: '上一条还在生成，请稍候' });

    busy = true;
    try {
      if (!(await startLlama())) throw new Error('Qwen3.8 未能启动');
      const body = JSON.stringify({ model: 'qwen3.8-27b', messages, max_tokens: 2048, temperature: 0.7 });
      log(`对话请求：${messages.length} 条消息`);
      const r = await getJson(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, 1800000);
      if (!r.ok) throw new Error('llama 调用失败: ' + String(r.body).slice(0, 300));
      const ch = r.body?.choices?.[0];
      const msg = ch?.message || {};
      const content = (msg.content || '').trim();
      const reasoning = (msg.reasoning_content || '').trim();
      if (reasoning) log('（本次有思考链 ' + reasoning.length + ' 字符）');
      if (!content) throw new Error(`模型返回空内容（completion_tokens=${r.body?.usage?.completion_tokens}, finish_reason=${ch?.finish_reason}）`);
      log('回复 ' + content.length + ' 字符');
      return json(res, 200, { ok: true, content, reasoning, usage: r.body?.usage ?? null });
    } catch (e) {
      log('对话失败: ' + e.message);
      return json(res, 500, { ok: false, error: e.message });
    } finally { busy = false; }
  }

  // 只有这条路会真正关停一切
  if (url.pathname === '/api/quit' && req.method === 'POST') {
    log('收到退出指令，正在关闭…');
    try { await stopLlama(); } catch {}
    log('已退出');
    try { json(res, 200, { ok: true }); } catch {}
    setTimeout(() => process.exit(0), 300);
    return;
  }

  return json(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    log('请求异常: ' + (e?.stack || e));
    try { if (!res.headersSent) json(res, 500, { error: String(e?.message || e) }); else res.end(); } catch {}
  });
});

server.listen(UI_PORT, '127.0.0.1', () => log(`对话总控台已监听 http://127.0.0.1:${UI_PORT}  （不会自动退出）`));

// 启动即把模型拉起来，随后一直待命；没有任何空闲计时器。
(async () => { await startLlama(); })();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { log('收到 ' + sig + '，关闭'); try { await stopLlama(); } catch {} process.exit(0); });
}
