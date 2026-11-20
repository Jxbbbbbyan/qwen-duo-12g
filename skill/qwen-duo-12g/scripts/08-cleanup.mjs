#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';

/* __INLINE_DATA_START__ */
const INLINE = {"stage":"cleanup","kind":"cleanup","expects":"outputs","symbols":["stopComfy","stopLlama"],"example":{"schema":"qwen-duo-12g.config/v1","projectRoot":"","llamaExe":"","model":"","mmproj":"","python":"","comfyMain":"","comfyCwd":"","graph":"","comfyOutput":"","imageDit":"","imageEncoder":"","imageVae":"","thinking":"off","mode":"1080p","llamaPort":8080,"comfyPort":8188,"uiPort":8090,"allowDownloads":false,"allowSystemChanges":false,"expectedBytes":{}},"usage":["qwen-duo-12g stage: cleanup","Run this file alone. It does not read other skill-package files or launch the repository orchestrator.","stdout JSON is a candidate handoff, not a documented Agensi runtime API.","liveHardwareVerified is always false in this script. A controlled fixture is not a real model result.","Do not put secrets in arguments or stdout. This script does not download, install, or edit the system.","Usage: node <this-file> --config <absolute-file> --artifact-dir <absolute-dir> --confirm-write --input-json <small-json>","Exit codes: 0 stage finished, 2 usage, 3 missing input, 4 invalid input, 5 blocked or service failed."]};
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


async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) return finish(base({ ok: false, exitCode: EXIT.USAGE, error: args.error }));
  if (args.flags.help) { process.stdout.write(INLINE.usage.join('\n') + '\n'); return EXIT.OK; }
  const input = loadInput(args.options['input-json']);
  if (!input.ok) return finish(base({ ok: false, exitCode: input.exitCode, error: input.error }));
  if (!input.value) return finish(base({ ok: false, exitCode: EXIT.MISSING, error: 'pass --input-json' }));
  const place = artifactDir(args.options['artifact-dir'], args.flags.confirmWrite);
  if (!place.ok) return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: place.error }));
  if (input.value.stage !== 'outputs' || input.value.artifactDir !== place.dir) return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: 'outputs stage did not name this directory', protocolMismatch: input.value.stage !== 'outputs' }));
  const loaded = loadConfig(args.options.config);
  if (!loaded.ok) return finish(base({ ok: false, exitCode: loaded.exitCode, error: loaded.error }));
  const imagePath = path.join(place.dir, 'service-output.png');
  const imageKept = fs.existsSync(imagePath);
  const stopped = [];
  const retired = [];
  const skipped = [];
  for (const name of ['owned-prompt-model.json', 'owned-image-stage.json']) {
    const recordPath = path.join(place.dir, name);
    if (!fs.existsSync(recordPath)) continue;
    let record; try { record = JSON.parse(fs.readFileSync(recordPath, 'utf8')); } catch { skipped.push(name); continue; }
    if (!record || !Number.isInteger(record.pid) || typeof record.exe !== 'string' || typeof record.starttime !== 'string' || typeof record.token !== 'string') { skipped.push(name); continue; }
    const result = await stopOwned(record);
    if (result.stopped) { stopped.push(record.pid); try { fs.unlinkSync(recordPath); } catch { /* leave it */ } }
    else if (result.reason === 'pid-absent') { retired.push(record.pid); try { fs.unlinkSync(recordPath); } catch { /* leave it */ } }
    else skipped.push(name);
  }
  const llamaUp = await portListening(loaded.config.llamaPort);
  const comfyUp = await portListening(loaded.config.comfyPort);
  const ok = input.value.ok === true && imageKept && !llamaUp && !comfyUp && skipped.length === 0;
  return finish(base({ ok, exitCode: ok ? EXIT.OK : EXIT.BLOCKED, checksMayContinue: false, stopPipeline: true, artifactDir: place.dir, imageKept, stoppedOwnedPids: stopped, retiredAbsentPids: retired, skippedUnmatchedPids: skipped.length, portsClear: !llamaUp && !comfyUp, evidenceClass: 'cleanup-check' }));
}

main().then((code) => process.exit(code)).catch((error) => {
  emit(base({ ok: false, exitCode: 1, error: String(error && error.message || 'internal error').slice(0, 180), spawned: false }));
  process.exit(1);
});
