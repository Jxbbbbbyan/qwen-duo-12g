#!/usr/bin/env node
// Self-contained stage script. Do not import skill-package files.
import fs from 'node:fs';
import path from 'node:path';

/* __INLINE_DATA_START__ */
const INLINE = {"stage":"outputs","kind":"blocked","expects":"image-stage","symbols":["deliverImage"],"example":{"schema":"qwen-duo-12g.config/v1","projectRoot":"","llamaExe":"","model":"","mmproj":"","python":"","comfyMain":"","comfyCwd":"","graph":"","comfyOutput":"","imageDit":"","imageEncoder":"","imageVae":"","thinking":"off","mode":"1080p","llamaPort":8080,"comfyPort":8188,"uiPort":8090,"allowDownloads":false,"allowSystemChanges":false,"expectedBytes":{}},"blocker":"Windows GPU, llama.cpp, ComfyUI, process lifetime, and a shared workspace are not established for an Agensi buyer session. This script does not start them.","usage":["qwen-duo-12g stage: outputs","Run this file alone. It does not read or launch other skill-package files.","stdout JSON is a candidate handoff, not a documented Agensi runtime API.","Do not put secrets in arguments or stdout. This script does not download, install, or edit the system.","Usage: node <this-file> --input-json <small-json>","This stage always stops. It does not start the local program.","Exit codes: 0 check finished, 2 usage, 3 missing input, 4 invalid input, 5 blocked."]};
/* __INLINE_DATA_END__ */

const EXIT = { OK: 0, USAGE: 2, MISSING: 3, INVALID: 4, BLOCKED: 5 };
const REQUIRED = ['projectRoot', 'llamaExe', 'model', 'mmproj', 'python', 'comfyMain', 'comfyCwd', 'graph', 'comfyOutput'];
const FILES = new Set(['llamaExe', 'model', 'mmproj', 'python', 'comfyMain', 'graph', 'imageDit', 'imageEncoder', 'imageVae']);
const DIRS = new Set(['projectRoot', 'comfyCwd', 'comfyOutput']);
const OPTIONAL = ['imageDit', 'imageEncoder', 'imageVae'];
const THINKING = new Set(['off', 'low', 'medium', 'high', 'xhigh']);
const MODES = new Set(['1080p', '2k']);
const SECRET_KEY = /password|secret|token|credential|api[-_]?key/i;
const SECRET_VALUE = /^(sk-|ghp_|github_pat_|AKIA|xox[baprs]-)/;
const INPUT_MAX = 16 * 1024;
const CONFIG_MAX = 256 * 1024;
const GRAPH_MAX = 2 * 1024 * 1024;
const DISK_NOTE = 100 * 1024 * 1024 * 1024;

function base(extra) {
  return Object.assign({
    stage: INLINE.stage,
    kind: INLINE.kind,
    symbols: INLINE.symbols,
    marketplaceApproved: false,
    pipelineBlocked: true,
    stopPipeline: true,
    protocol: 'candidate-stdout-json-v1',
    protocolGuaranteedByAgensi: false,
    spawned: false,
    executedLocalProgram: false,
    submissionBlocker: INLINE.blocker,
  }, extra);
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function finish(obj) {
  emit(obj);
  return obj.exitCode;
}

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
      if (!key || value === undefined || value.startsWith('--')) {
        out.error = 'missing value for --' + key;
        return out;
      }
      if (Object.hasOwn(out.options, key)) {
        out.error = 'duplicate --' + key;
        return out;
      }
      out.options[key] = value;
      i += 1;
    } else {
      out.error = 'unexpected argument';
      return out;
    }
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
  for (const key of ['stage', 'exitCode', 'pipelineBlocked', 'stopPipeline', 'workspaceVerified', 'reportComplete', 'dependencyOk', 'checksMayContinue', 'ok']) {
    const value = obj[key];
    if (typeof value === 'boolean' || typeof value === 'number') out[key] = value;
    else if (typeof value === 'string' && value.length <= 80 && !SECRET_VALUE.test(value)) out[key] = value;
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

function loadConfig(file) {
  if (!file) return { ok: false, exitCode: EXIT.MISSING, error: 'pass --config <absolute-file>' };
  if (!path.isAbsolute(file)) return { ok: false, exitCode: EXIT.INVALID, error: 'config path must be absolute' };
  let stat;
  try { stat = fs.statSync(file); } catch { return { ok: false, exitCode: EXIT.MISSING, error: 'config file not found' }; }
  if (!stat.isFile()) return { ok: false, exitCode: EXIT.INVALID, error: 'config path is not a file' };
  if (stat.size > CONFIG_MAX) return { ok: false, exitCode: EXIT.INVALID, error: 'config file is larger than 256KB' };
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
  if (cfg.schema !== INLINE.example.schema) errors.push('schema must be ' + INLINE.example.schema);
  for (const key of REQUIRED.concat(OPTIONAL)) {
    if (typeof cfg[key] !== 'string') errors.push(key + ' must be a string');
    else if (cfg[key] !== '' && !path.isAbsolute(cfg[key])) errors.push(key + ' must be an absolute path');
    else if (cfg[key].includes('\0')) errors.push(key + ' contains a NUL');
  }
  if (!THINKING.has(cfg.thinking)) errors.push('thinking must be off, low, medium, high, or xhigh');
  if (!MODES.has(cfg.mode)) errors.push('mode must be 1080p or 2k');
  const ports = ['llamaPort', 'comfyPort', 'uiPort'];
  for (const key of ports) {
    if (!Number.isInteger(cfg[key]) || cfg[key] < 1 || cfg[key] > 65535) errors.push(key + ' must be an integer port');
  }
  if (new Set(ports.map((key) => cfg[key])).size !== ports.length) errors.push('ports must be distinct');
  if (cfg.allowDownloads !== false) errors.push('allowDownloads must be false; this skill does not download');
  if (cfg.allowSystemChanges !== false) errors.push('allowSystemChanges must be false; this skill does not change the system');
  if (!cfg.expectedBytes || typeof cfg.expectedBytes !== 'object' || Array.isArray(cfg.expectedBytes)) errors.push('expectedBytes must be an object');
  else {
    for (const [key, value] of Object.entries(cfg.expectedBytes)) {
      if (!FILES.has(key)) errors.push('expectedBytes.' + key + ' is not a file field');
      else if (!Number.isInteger(value) || value < 0) errors.push('expectedBytes.' + key + ' must be a non-negative integer');
      else if (cfg[key] === '') errors.push('expectedBytes.' + key + ' is set but the path is empty');
    }
  }
  return errors;
}

function commandOnPath(name) {
  const parts = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of parts) {
    for (const suffix of suffixes) {
      try { if (fs.statSync(path.join(dir, name + suffix)).isFile()) return true; } catch { /* next */ }
    }
  }
  return false;
}


function priorOk(input, expected) {
  if (!expected || !input) return { ok: true, checked: false };
  if (input.stage !== expected) return { ok: false, error: 'input stage is not ' + expected };
  if (input.ok !== true) return { ok: false, error: 'previous stage did not report ok true' };
  return { ok: true, checked: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) return finish(base({ ok: false, exitCode: EXIT.USAGE, error: args.error, reportComplete: false }));
  if (args.flags.help) {
    process.stdout.write(INLINE.usage.join('\n') + '\n');
    return EXIT.OK;
  }
  if (args.flags.example) {
    if (INLINE.kind !== 'validate') return finish(base({ ok: false, exitCode: EXIT.USAGE, error: 'example config is printed only by the validate-config script' }));
    process.stdout.write(JSON.stringify(INLINE.example, null, 2) + '\n');
    return EXIT.OK;
  }
  const allowed = new Set(['config', 'workspace', 'input-json']);
  for (const key of Object.keys(args.options)) {
    if (!allowed.has(key)) return finish(base({ ok: false, exitCode: EXIT.USAGE, error: 'unknown option --' + key }));
  }
  if (args.flags.confirmWrite && INLINE.kind !== 'dependencies') return finish(base({ ok: false, exitCode: EXIT.USAGE, error: '--confirm-write is only valid for the dependencies script' }));
  const input = loadInput(Object.hasOwn(args.options, 'input-json') ? args.options['input-json'] : null);
  if (!input.ok) return finish(base({ ok: false, exitCode: input.exitCode, error: input.error, reportComplete: false }));
  if (INLINE.kind === 'preflight') {
    if (Object.keys(args.options).length || args.flags.confirmWrite) return finish(base({ ok: false, exitCode: EXIT.USAGE, error: 'preflight accepts no config and starts nothing' }));
    return finish(base({
      ok: true,
      exitCode: EXIT.OK,
      reportComplete: true,
      checksMayContinue: true,
      stopPipeline: true,
      pipelineBlocked: true,
      host: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        nvidiaSmiOnPath: commandOnPath('nvidia-smi'),
        nvidiaSmiNote: 'A name on PATH is not a GPU test.',
      },
      blockers: [{ id: 'gpu-process-lifecycle-undocumented', detail: INLINE.blocker }],
    }));
  }
  if (INLINE.kind === 'blocked') {
    if (!input.value) return finish(base({ ok: false, exitCode: EXIT.MISSING, error: 'pass --input-json from the previous check', reportComplete: false }));
    return finish(base({
      ok: false,
      exitCode: EXIT.BLOCKED,
      reportComplete: true,
      checksMayContinue: false,
      stopPipeline: true,
      pipelineBlocked: true,
      prior: input.summary,
      protocolMismatch: Boolean(INLINE.expects) && input.value.stage !== INLINE.expects,
      reason: 'This stage is not run inside the marketplace temporary-file session. Images and weights are not returned through stdout.',
    }));
  }
  const loaded = loadConfig(args.options.config);
  if (!loaded.ok) return finish(base({ ok: false, exitCode: loaded.exitCode, error: loaded.error, reportComplete: false }));
  const errors = structuralErrors(loaded.config);
  if (errors.length) return finish(base({ ok: false, exitCode: EXIT.INVALID, error: 'invalid config', configErrors: errors, reportComplete: false }));
  const prior = priorOk(input.value, input.value ? INLINE.expects : null);
  if (!prior.ok) return finish(base({ ok: false, exitCode: EXIT.BLOCKED, error: prior.error, prior: input.summary, reportComplete: true }));
  if (INLINE.kind === 'validate') {
    return finish(base({
      ok: true,
      exitCode: EXIT.OK,
      reportComplete: true,
      checksMayContinue: true,
      stopPipeline: true,
      pipelineBlocked: true,
      structurallyValid: true,
      prior: input.summary,
    }));
  }
  const report = await assess(loaded.config, args.options.workspace || '', Boolean(args.flags.confirmWrite));
  return finish(base({
    ok: false,
    exitCode: EXIT.BLOCKED,
    reportComplete: true,
    checksMayContinue: false,
    stopPipeline: true,
    pipelineBlocked: true,
    dependencyOk: report.dependencyOk,
    workspaceVerified: report.workspace.verified,
    workspaceDetail: report.workspace.detail,
    blockers: report.blockers,
    warnings: report.warnings,
    files: report.files,
    ports: report.ports,
    freeBytes: report.freeBytes,
    prior: input.summary,
  }));
}

main().then((code) => process.exit(code)).catch(() => {
  emit(base({ ok: false, exitCode: 1, error: 'internal error', reportComplete: false }));
  process.exit(1);
});
