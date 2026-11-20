#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';

/* __INLINE_DATA_START__ */
const INLINE = {"stage":"image-stage","kind":"image","expects":"gpu-handoff","symbols":["startComfy","uploadImage","render"],"example":{"schema":"qwen-duo-12g.config/v1","projectRoot":"","llamaExe":"","model":"","mmproj":"","python":"","comfyMain":"","comfyCwd":"","graph":"","comfyOutput":"","imageDit":"","imageEncoder":"","imageVae":"","thinking":"off","mode":"1080p","llamaPort":8080,"comfyPort":8188,"uiPort":8090,"allowDownloads":false,"allowSystemChanges":false,"expectedBytes":{}},"usage":["qwen-duo-12g stage: image-stage","Run this file alone. It does not read other skill-package files or launch the repository orchestrator.","stdout JSON is a candidate handoff, not a documented Agensi runtime API.","liveHardwareVerified is always false in this script. A controlled fixture is not a real model result.","Do not put secrets in arguments or stdout. This script does not download, install, or edit the system.","Usage: node <this-file> --config <absolute-file> --artifact-dir <absolute-dir> --confirm-write --input-json <small-json> [--image <file>] [--service-timeout-ms N]","Exit codes: 0 stage finished, 2 usage, 3 missing input, 4 invalid input, 5 blocked or service failed."]};
/* __INLINE_DATA_END__ */

const EXIT = { OK: 0, USAGE: 2, MISSING: 3, INVALID: 4, BLOCKED: 5 };
const SECRET_KEY = /password|secret|token|credential|api[-_]?key/i;
const SECRET_VALUE = /^(sk-|ghp_|github_pat_|AKIA|xox[baprs]-)/;
const INPUT_MAX = 16 * 1024;
const CONFIG_MAX = 256 * 1024;

function base(extra) {
  return Object.assign({
    stage: INLINE.stage,
    kind: INLINE.kind,
    symbols: INLINE.symbols,
    marketplaceApproved: false,
    protocol: 'candidate-stdout-json-v1',
    protocolGuaranteedByAgensi: false,
    liveHardwareVerified: false,
    implementationPresent: true,
    executedLocalProgram: false,
    realModelOutput: false,
  }, extra);
}
function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function finish(obj) { emit(obj); return obj.exitCode; }
function parseArgs(argv) {
  const out = { flags: {}, options: {}, error: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') out.flags.help = true;
    else if (token === '--print-example-config') out.flags.example = true;
    else if (token === '--confirm-write') out.flags.confirmWrite = true;
    else if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (!key || value === undefined || value.startsWith('--')) { out.error = 'missing value for --' + key; return out; }
      if (Object.hasOwn(out.options, key)) { out.error = 'duplicate --' + key; return out; }
      out.options[key] = value;
      i += 1;
    } else { out.error = 'unexpected argument'; return out; }
  }
  return out;
}
function findSecret(value, where) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findSecret(value[i], where + '[' + i + ']');
      if (hit) return hit;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (SECRET_KEY.test(key)) return where + '.' + key;
      const hit = findSecret(value[key], where + '.' + key);
      if (hit) return hit;
    }
    return '';
  }
  if (typeof value === 'string' && SECRET_VALUE.test(value)) return where;
  return '';
}
function summarize(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const key of ['stage', 'ok', 'exitCode', 'dependencyOk', 'artifactVerified', 'artifactDir', 'portsClear', 'promptSha256', 'imageSha256', 'serviceDeclaredFixture', 'ownedProcessReleased', 'ownerPid', 'ownerStarttime', 'checksMayContinue', 'stopPipeline', 'processAbsent', 'portClosed']) {
    const value = obj[key];
    if (typeof value === 'boolean' || typeof value === 'number') out[key] = value;
    else if (typeof value === 'string' && value.length <= 256 && !SECRET_VALUE.test(value)) out[key] = value;
  }
  return out;
}
function loadInput(raw) {
  if (raw == null) return { ok: true, value: null };
  if (Buffer.byteLength(raw) > INPUT_MAX) return { ok: false, exitCode: EXIT.INVALID, error: 'input JSON is larger than 16KB' };
  let value;
  try { value = JSON.parse(raw); } catch { return { ok: false, exitCode: EXIT.INVALID, error: 'input JSON is not valid' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, exitCode: EXIT.INVALID, error: 'input JSON must be an object' };
  const secret = findSecret(value, 'input');
  if (secret) return { ok: false, exitCode: EXIT.INVALID, error: 'refusing sensitive input at ' + secret };
  return { ok: true, value, summary: summarize(value) };
}
function timeoutMs(raw) {
  if (raw == null) return 30000;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (value < 200 || value > 300000) return null;
  return value;
}


const REQUIRED = ['projectRoot', 'llamaExe', 'model', 'mmproj', 'python', 'comfyMain', 'comfyCwd', 'graph', 'comfyOutput'];
const FILE_KEYS = new Set(['llamaExe', 'model', 'mmproj', 'python', 'comfyMain', 'graph', 'imageDit', 'imageEncoder', 'imageVae']);
const DIR_KEYS = new Set(['projectRoot', 'comfyCwd', 'comfyOutput']);
const OPTIONAL = ['imageDit', 'imageEncoder', 'imageVae'];
const THINKING = new Set(['off', 'low', 'medium', 'high', 'xhigh']);
const MODES = new Set(['1080p', '2k']);
const GRAPH_MAX = 2 * 1024 * 1024;
function loadConfig(file) {
  if (!file) return { ok: false, exitCode: EXIT.MISSING, error: 'pass --config <absolute-file>' };
  if (!path.isAbsolute(file)) return { ok: false, exitCode: EXIT.INVALID, error: 'config path must be absolute' };
  let stat;
  try { stat = fs.statSync(file); } catch { return { ok: false, exitCode: EXIT.MISSING, error: 'config file not found' }; }
  if (!stat.isFile() || stat.size > CONFIG_MAX) return { ok: false, exitCode: EXIT.INVALID, error: 'config must be a file under 256KB' };
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { ok: false, exitCode: EXIT.INVALID, error: 'config is not valid JSON' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, exitCode: EXIT.INVALID, error: 'config must be a JSON object' };
  const secret = findSecret(parsed, 'config');
  if (secret) return { ok: false, exitCode: EXIT.INVALID, error: 'refusing sensitive config field at ' + secret };
  return { ok: true, config: parsed };
}
function structuralErrors(cfg) {
  const errors = [];
  const allowed = new Set(Object.keys(INLINE.example));
  for (const key of Object.keys(cfg)) if (!allowed.has(key)) errors.push('unknown key: ' + key);
  if (cfg.schema !== INLINE.example.schema) errors.push('schema mismatch');
  for (const key of REQUIRED.concat(OPTIONAL)) {
    if (typeof cfg[key] !== 'string') errors.push(key + ' must be a string');
    else if (cfg[key] && !path.isAbsolute(cfg[key])) errors.push(key + ' must be an absolute path');
  }
  if (!THINKING.has(cfg.thinking)) errors.push('bad thinking value');
  if (!MODES.has(cfg.mode)) errors.push('bad mode');
  const ports = ['llamaPort', 'comfyPort', 'uiPort'];
  for (const key of ports) if (!Number.isInteger(cfg[key]) || cfg[key] < 1 || cfg[key] > 65535) errors.push(key + ' must be a port');
  if (new Set(ports.map((key) => cfg[key])).size !== 3) errors.push('ports must be distinct');
  if (cfg.allowDownloads !== false) errors.push('allowDownloads must be false');
  if (cfg.allowSystemChanges !== false) errors.push('allowSystemChanges must be false');
  if (!cfg.expectedBytes || typeof cfg.expectedBytes !== 'object' || Array.isArray(cfg.expectedBytes)) errors.push('expectedBytes must be an object');
  else {
    for (const [key, value] of Object.entries(cfg.expectedBytes)) {
      if (!FILE_KEYS.has(key) || !Number.isInteger(value) || value < 0) errors.push('bad expectedBytes.' + key);
      else if (!cfg[key]) errors.push('expectedBytes.' + key + ' has no path');
    }
  }
  return errors;
}


function portListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, family: 4 });
    const done = (value) => { socket.removeAllListeners(); socket.destroy(); resolve(value); };
    socket.setTimeout(200);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}
function httpJson(port, method, urlPath, body, ms) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port, method, path: urlPath,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
      timeout: ms,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        try { parsed = JSON.parse(text); } catch { /* text */ }
        resolve({ status: res.statusCode, body: parsed, text });
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end(data || undefined);
  });
}
async function waitOk(port, urlPath, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const res = await httpJson(port, 'GET', urlPath, null, 500); if (res.status === 200) return true; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return false;
}


function artifactDir(dir, confirm) {
  if (!confirm) return { ok: false, error: 'pass --confirm-write for the artifact directory' };
  if (!dir || !path.isAbsolute(dir)) return { ok: false, error: 'artifact dir must be absolute' };
  let stat;
  try { stat = fs.statSync(dir); } catch { return { ok: false, error: 'artifact dir not found' }; }
  if (!stat.isDirectory()) return { ok: false, error: 'artifact dir is not a directory' };
  return { ok: true, dir: path.resolve(dir) };
}
function inside(dir, target) {
  const rel = path.relative(fs.realpathSync(dir), fs.realpathSync(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
function writeNamed(dir, name, data) {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return { ok: false, error: 'artifact name rejected' };
  const target = path.join(dir, name);
  fs.writeFileSync(target, data);
  if (!inside(dir, target)) return { ok: false, error: 'artifact write left the directory', path: target };
  return { ok: true, path: target };
}


function liveIdentity(pid) {
  if (process.platform !== 'linux' || !Number.isInteger(pid) || pid <= 0) return { state: 'unavailable' };
  let exe = '';
  let starttime = '';
  let args = [];
  try { exe = fs.readlinkSync('/proc/' + pid + '/exe'); } catch (error) {
    if (error && error.code === 'ENOENT') return { state: 'absent' };
    return { state: 'unavailable' };
  }
  try {
    const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    const end = stat.lastIndexOf(')');
    if (end < 0) return { state: 'unavailable' };
    starttime = stat.slice(end + 2).split(' ')[19] || '';
    if (!starttime) return { state: 'unavailable' };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { state: 'absent' };
    return { state: 'unavailable' };
  }
  try { args = fs.readFileSync('/proc/' + pid + '/cmdline').toString('utf8').split('\0').filter((item) => item !== ''); }
  catch (error) {
    if (error && error.code === 'ENOENT') return { state: 'absent' };
    return { state: 'unavailable' };
  }
  return { state: 'alive', exe, starttime, args };
}
function sameIdentity(live, expected) {
  if (!live || live.state !== 'alive' || !expected) return false;
  if (live.exe !== expected.exe || String(live.starttime) !== String(expected.starttime)) return false;
  if (typeof expected.token !== 'string' || expected.token.length < 16) return false;
  for (let i = 0; i < live.args.length - 1; i += 1) {
    if (live.args[i] === '--qwen-owned-token' && live.args[i + 1] === expected.token) return true;
  }
  return false;
}
function processAbsent(pid, starttime) {
  const live = liveIdentity(pid);
  if (live.state === 'unavailable') return 'unverified';
  if (live.state === 'absent') return 'absent';
  if (String(live.starttime) === String(starttime)) return 'alive';
  return 'replaced';
}


async function stopOwned(expected) {
  const first = liveIdentity(expected && expected.pid);
  if (first.state === 'absent') return { stopped: false, signaled: false, reason: 'pid-absent' };
  if (first.state !== 'alive' || !sameIdentity(first, expected)) return { stopped: false, signaled: false, reason: 'identity-unverified' };
  const again = liveIdentity(expected.pid);
  if (!sameIdentity(again, expected)) return { stopped: false, signaled: false, reason: 'identity-changed' };
  try { process.kill(expected.pid, 'SIGTERM'); }
  catch (error) {
    if (error && error.code === 'ESRCH') return { stopped: false, signaled: false, reason: 'pid-absent' };
    return { stopped: false, signaled: false, reason: 'signal-failed' };
  }
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const now = processAbsent(expected.pid, expected.starttime);
    if (now === 'absent' || now === 'replaced') return { stopped: true, signaled: true, reason: 'process-absent' };
    if (now === 'unverified') return { stopped: false, signaled: true, reason: 'identity-unverified' };
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const still = liveIdentity(expected.pid);
  if (!sameIdentity(still, expected)) return { stopped: false, signaled: true, reason: 'identity-changed' };
  try { process.kill(expected.pid, 'SIGKILL'); } catch { /* already gone */ }
  const finalState = processAbsent(expected.pid, expected.starttime);
  if (finalState === 'absent' || finalState === 'replaced') return { stopped: true, signaled: true, reason: 'process-absent' };
  return { stopped: false, signaled: true, reason: 'still-alive' };
}
async function stopChild(child, expected) {
  const first = liveIdentity(expected && expected.pid);
  if (first.state === 'absent') return { stopped: true, signaled: false, reason: 'already-absent' };
  if (first.state !== 'alive' || !sameIdentity(first, expected)) return { stopped: false, signaled: false, reason: 'identity-unverified' };
  const again = liveIdentity(expected.pid);
  if (!sameIdentity(again, expected)) return { stopped: false, signaled: false, reason: 'identity-changed' };
  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
  try { child.kill('SIGTERM'); }
  catch { return { stopped: false, signaled: false, reason: 'signal-failed' }; }
  const done = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(false), 400))]);
  if (!done) {
    const still = liveIdentity(expected.pid);
    if (still.state === 'alive' && !sameIdentity(still, expected)) return { stopped: false, signaled: true, reason: 'identity-changed' };
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    const done2 = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(false), 400))]);
    if (!done2) return { stopped: false, signaled: true, reason: 'still-alive' };
  }
  return { stopped: true, signaled: true, reason: 'process-exited' };
}


function startOwned(exe, args, cwd, logPath, extraEnv, recordPath) {
  return new Promise((resolve, reject) => {
    const token = crypto.randomBytes(16).toString('hex');
    const fullArgs = args.concat(['--qwen-owned-token', token]);
    let child;
    let logFd;
    try { logFd = fs.openSync(logPath, 'a'); } catch (error) { reject(error); return; }
    try {
      child = spawn(exe, fullArgs, {
        cwd, env: Object.assign({}, process.env, extraEnv), shell: false,
        stdio: ['ignore', logFd, logFd], windowsHide: true,
      });
    } catch (error) { reject(error); return; }
    let settled = false;
    const fail = (error) => { if (settled) return; settled = true; reject(error); };
    child.once('error', fail);
    child.once('spawn', () => {
      if (settled) return;
      child.removeListener('error', fail);
      child.on('error', () => {});
      const live = liveIdentity(child.pid);
      const expected = { pid: child.pid, exe: live.exe, starttime: live.starttime, token, stage: INLINE.stage };
      if (!sameIdentity(live, expected)) { fail(new Error('process identity was not available')); return; }
      try { fs.writeFileSync(recordPath, JSON.stringify(expected), { flag: 'wx' }); }
      catch (error) { fail(error); return; }
      settled = true;
      resolve({ child, expected });
    });
  });
}


async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) return finish(base({ ok: false, exitCode: EXIT.USAGE, error: args.error, spawned: false }));
  if (args.flags.help) { process.stdout.write(INLINE.usage.join('\n') + '\n'); return EXIT.OK; }
  const limit = timeoutMs(args.options['service-timeout-ms']);
  if (limit == null) return finish(base({ ok: false, exitCode: EXIT.INVALID, error: 'bad service timeout', spawned: false }));
  const input = loadInput(args.options['input-json']);
  if (!input.ok) return finish(base({ ok: false, exitCode: input.exitCode, error: input.error, spawned: false }));
  if (!input.value) return finish(base({ ok: false, exitCode: EXIT.MISSING, error: 'pass --input-json', spawned: false }));
  const place = artifactDir(args.options['artifact-dir'], args.flags.confirmWrite);
  if (!place.ok) return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: place.error, spawned: false }));
  if (input.value.stage !== 'gpu-handoff' || input.value.ok !== true || input.value.ownedProcessReleased !== true || input.value.artifactDir !== place.dir) return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: 'handoff did not confirm the prompt process is absent', protocolMismatch: input.value.stage !== 'gpu-handoff', spawned: false }));
  const loaded = loadConfig(args.options.config);
  if (!loaded.ok) return finish(base({ ok: false, exitCode: loaded.exitCode, error: loaded.error, spawned: false }));
  const errors = structuralErrors(loaded.config);
  if (errors.length) return finish(base({ ok: false, exitCode: EXIT.INVALID, configErrors: errors, spawned: false }));
  const cfg = loaded.config;
  const promptPath = path.join(place.dir, 'prompt.txt');
  let prompt = ''; try { prompt = fs.readFileSync(promptPath, 'utf8'); } catch { return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: 'prompt artifact missing', spawned: false })); }
  if (crypto.createHash('sha256').update(prompt).digest('hex') !== input.value.promptSha256) return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: 'prompt hash mismatch', spawned: false }));
  let reference = null;
  if (args.options.image) {
    let stat; try { stat = fs.statSync(args.options.image); } catch { stat = null; }
    if (!path.isAbsolute(args.options.image) || !stat || !stat.isFile() || stat.size > 30 * 1024 * 1024) return finish(base({ ok: false, exitCode: EXIT.INVALID, error: 'reference image must be an existing absolute file up to 30MB', spawned: false }));
    reference = { bytes: fs.readFileSync(args.options.image) };
  }
  let graph; try { graph = JSON.parse(fs.readFileSync(cfg.graph, 'utf8')); } catch { return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: 'graph cannot be read', spawned: false })); }
  if (!graph || typeof graph !== 'object' || Array.isArray(graph) || !graph['5'] || !graph['5'].inputs || typeof graph['5'].inputs !== 'object') return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: 'graph node 5 prompt input is missing', spawned: false }));
  graph['5'].inputs.prompt = prompt;
  if (graph['5'].inputs.prompt !== prompt) return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: 'prompt was not injected', spawned: false }));
  if (await portListening(cfg.comfyPort)) return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: 'image port is in use; not stopping it', spawned: false }));
  const logWrite = writeNamed(place.dir, 'image-service.log', '');
  if (!logWrite.ok) return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: logWrite.error, spawned: false }));
  const recordPath = path.join(place.dir, 'owned-image-stage.json');
  let owned;
  try { owned = await startOwned(cfg.python, ['-s', cfg.comfyMain, '--fast-disk', '--disable-pinned-memory', '--windows-standalone-build'], cfg.comfyCwd, logWrite.path, { QWEN_COMFY_OUTPUT: cfg.comfyOutput, QWEN_COMFY_PORT: String(cfg.comfyPort) }, recordPath); }
  catch { return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: 'service executable could not be started', spawned: false })); }
  let payload = { ok: false, exitCode: EXIT.BLOCKED, error: 'image stage failed', spawned: true };
  try {
    if (!(await waitOk(cfg.comfyPort, '/system_stats', limit))) payload = { ok: false, exitCode: EXIT.BLOCKED, error: 'image service did not become healthy', spawned: true };
    else {
      if (reference) {
        const uploaded = await uploadReference(cfg.comfyPort, reference.bytes, limit);
        if (!uploaded.ok) payload = { ok: false, exitCode: EXIT.BLOCKED, error: uploaded.error, spawned: true };
        else {
          graph['14'] = { class_type: 'LoadImage', inputs: { image: uploaded.name } };
          graph['5'].inputs.images = { image_1: ['14', 0] };
          graph['5'].inputs.resolution = cfg.mode === '2k' ? 2560 : 1920;
          if (!graph['10'] || !graph['10'].inputs) payload = { ok: false, exitCode: EXIT.BLOCKED, error: 'graph node 10 is required for a reference image', spawned: true };
          else graph['10'].inputs.latent_image = ['5', 2];
        }
      }
      if (payload.error === 'image stage failed') {
      const submitted = await httpJson(cfg.comfyPort, 'POST', '/prompt', { prompt: graph }, limit);
      const id = submitted.body && submitted.body.prompt_id;
      if (submitted.status !== 200 || !id) payload = { ok: false, exitCode: EXIT.BLOCKED, error: 'image submit failed', spawned: true };
      else {
        let done = null;
        const end = Date.now() + limit;
        while (Date.now() < end && !done) {
          const hist = await httpJson(cfg.comfyPort, 'GET', '/history/' + encodeURIComponent(id), null, 1000);
          const entry = hist.body && hist.body[id];
          if (entry && entry.status && (entry.status.completed || entry.status.status_str === 'error')) done = entry;
          else await new Promise((resolve) => setTimeout(resolve, 40));
        }
        const images = [];
        if (done && done.outputs) for (const key of Object.keys(done.outputs)) for (const image of (done.outputs[key].images || [])) images.push(image);
        const cached = Boolean(done && done.status && JSON.stringify(done.status.messages || []).includes('execution_cached'));
        if (!done || done.status.status_str === 'error' || !images.length) payload = { ok: false, exitCode: EXIT.BLOCKED, error: 'image service produced no file', spawned: true };
        else {
          const read = readServicePng(cfg.comfyOutput, images[0]);
          if (!read.ok) payload = { ok: false, exitCode: EXIT.BLOCKED, error: read.error, spawned: true };
          else if (read.bytes.length < 8 || read.bytes[0] !== 0x89 || read.bytes.toString('ascii', 1, 4) !== 'PNG') payload = { ok: false, exitCode: EXIT.BLOCKED, error: 'service file is not a PNG', spawned: true };
          else {
            const copied = writeNamed(place.dir, 'service-output.png', read.bytes);
            if (!copied.ok) payload = { ok: false, exitCode: EXIT.BLOCKED, error: copied.error, spawned: true };
            else {
              const fixture = Boolean(done.fixture === true);
              payload = { ok: true, exitCode: EXIT.OK, spawned: true, checksMayContinue: true, stopPipeline: false, artifactDir: place.dir, artifactFile: 'service-output.png', imageSha256: crypto.createHash('sha256').update(read.bytes).digest('hex'), promptSha256: input.value.promptSha256, serviceDeclaredFixture: fixture, executionCached: cached, referenceUploaded: Boolean(reference), evidenceClass: fixture ? 'controlled-fixture' : 'service-output-unverified-hardware' };
            }
          }
        }
      }
      }
    }
  } catch { payload = { ok: false, exitCode: EXIT.BLOCKED, error: 'image service call failed', spawned: true }; }
  const released = await stopChild(owned.child, owned.expected);
  if (released.stopped) { try { fs.unlinkSync(recordPath); } catch { /* record remains for cleanup */ } }
  if (payload.ok && !released.stopped) payload = { ok: false, exitCode: EXIT.BLOCKED, error: 'owned image process was not released', spawned: true, ownedProcessReleased: false };
  if (payload.ok) payload.ownedProcessReleased = true;
  return finish(base(payload));
}
function uploadReference(port, bytes, ms) {
  const boundary = 'qwenformboundary';
  const body = Buffer.concat([
    Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="image"; filename="reference.png"\r\nContent-Type: application/octet-stream\r\n\r\n'),
    bytes,
    Buffer.from('\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--' + boundary + '--\r\n'),
  ]);
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/upload/image', headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length }, timeout: ms }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { parsed = {}; }
        if (res.statusCode !== 200 || typeof parsed.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(parsed.name)) resolve({ ok: false, error: 'reference upload was not accepted' });
        else resolve({ ok: true, name: parsed.name });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'reference upload timed out' }); });
    req.on('error', () => resolve({ ok: false, error: 'reference upload failed' }));
    req.end(body);
  });
}
function readServicePng(outputDir, image) {
  const type = typeof image.type === 'string' && image.type ? image.type : 'output';
  if (type !== 'output' && type !== 'temp' && type !== 'input') return { ok: false, error: 'unsupported image type' };
  if (typeof image.filename !== 'string' || !/^[A-Za-z0-9._-]+\.png$/.test(image.filename)) return { ok: false, error: 'image filename rejected' };
  const rawSub = image.subfolder == null ? '' : String(image.subfolder);
  const parts = rawSub === '' ? [] : rawSub.split(/[\\/]/);
  if (parts.some((part) => part === '' || part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))) return { ok: false, error: 'image subfolder rejected' };
  let root;
  try { root = fs.realpathSync(outputDir); } catch { return { ok: false, error: 'output directory is unavailable' }; }
  if (type !== 'output') {
    try { root = fs.realpathSync(path.resolve(path.dirname(root), type)); } catch { return { ok: false, error: 'service directory for ' + type + ' is unavailable' }; }
  }
  let current = root;
  try {
    for (const part of parts.concat([image.filename])) {
      const next = path.join(current, part);
      if (fs.lstatSync(next).isSymbolicLink()) return { ok: false, error: 'service path contains a symlink' };
      current = next;
    }
    const fd = fs.openSync(current, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const real = fs.realpathSync(current);
    const rel = path.relative(root, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { fs.closeSync(fd); return { ok: false, error: 'service file is outside its directory' }; }
    const bytes = fs.readFileSync(fd);
    fs.closeSync(fd);
    return { ok: true, bytes };
  } catch { return { ok: false, error: 'service file is not readable' }; }
}

main().then((code) => process.exit(code)).catch((error) => {
  emit(base({ ok: false, exitCode: 1, error: String(error && error.message || 'internal error').slice(0, 180), spawned: false }));
  process.exit(1);
});
