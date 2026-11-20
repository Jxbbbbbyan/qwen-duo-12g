#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

/* __INLINE_DATA_START__ */
const INLINE = {"stage":"validate-config","kind":"validate","expects":"preflight","symbols":[],"example":{"schema":"qwen-duo-12g.config/v1","projectRoot":"","llamaExe":"","model":"","mmproj":"","python":"","comfyMain":"","comfyCwd":"","graph":"","comfyOutput":"","imageDit":"","imageEncoder":"","imageVae":"","thinking":"off","mode":"1080p","llamaPort":8080,"comfyPort":8188,"uiPort":8090,"allowDownloads":false,"allowSystemChanges":false,"expectedBytes":{}},"usage":["qwen-duo-12g stage: validate-config","Run this file alone. It does not read other skill-package files or launch the repository orchestrator.","stdout JSON is a candidate handoff, not a documented Agensi runtime API.","liveHardwareVerified is always false in this script. A controlled fixture is not a real model result.","Do not put secrets in arguments or stdout. This script does not download, install, or edit the system.","Usage: node <this-file> --print-example-config","Usage: node <this-file> --config <absolute-file> [--input-json <small-json>]","Exit codes: 0 stage finished, 2 usage, 3 missing input, 4 invalid input, 5 blocked or service failed."]};
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


async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) return finish(base({ ok: false, exitCode: EXIT.USAGE, error: args.error }));
  if (args.flags.help) { process.stdout.write(INLINE.usage.join('\n') + '\n'); return EXIT.OK; }
  if (args.flags.example) { process.stdout.write(JSON.stringify(INLINE.example, null, 2) + '\n'); return EXIT.OK; }
  const input = loadInput(args.options['input-json']);
  if (!input.ok) return finish(base({ ok: false, exitCode: input.exitCode, error: input.error }));
  if (input.value && input.value.stage !== INLINE.expects) return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: 'input stage is not ' + INLINE.expects, protocolMismatch: true }));
  const loaded = loadConfig(args.options.config);
  if (!loaded.ok) return finish(base({ ok: false, exitCode: loaded.exitCode, error: loaded.error }));
  const errors = structuralErrors(loaded.config);
  if (errors.length) return finish(base({ ok: false, exitCode: EXIT.INVALID, error: 'invalid config', configErrors: errors }));
  return finish(base({ ok: true, exitCode: EXIT.OK, checksMayContinue: true, stopPipeline: false, structurallyValid: true, evidenceClass: 'config-check' }));
}

main().then((code) => process.exit(code)).catch((error) => {
  emit(base({ ok: false, exitCode: 1, error: String(error && error.message || 'internal error').slice(0, 180), spawned: false }));
  process.exit(1);
});
