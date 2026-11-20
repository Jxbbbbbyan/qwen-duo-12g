#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

/* __INLINE_DATA_START__ */
const INLINE = {"stage":"preflight","kind":"preflight","expects":null,"symbols":[],"example":{"schema":"qwen-duo-12g.config/v1","projectRoot":"","llamaExe":"","model":"","mmproj":"","python":"","comfyMain":"","comfyCwd":"","graph":"","comfyOutput":"","imageDit":"","imageEncoder":"","imageVae":"","thinking":"off","mode":"1080p","llamaPort":8080,"comfyPort":8188,"uiPort":8090,"allowDownloads":false,"allowSystemChanges":false,"expectedBytes":{}},"usage":["qwen-duo-12g stage: preflight","Run this file alone. It does not read other skill-package files or launch the repository orchestrator.","stdout JSON is a candidate handoff, not a documented Agensi runtime API.","liveHardwareVerified is always false in this script. A controlled fixture is not a real model result.","Do not put secrets in arguments or stdout. This script does not download, install, or edit the system.","Usage: node <this-file>","Exit codes: 0 stage finished, 2 usage, 3 missing input, 4 invalid input, 5 blocked or service failed."]};
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
  for (const key of ['stage', 'ok', 'exitCode', 'dependencyOk', 'artifactVerified', 'artifactDir', 'portsClear', 'promptSha256', 'imageSha256', 'serviceDeclaredFixture', 'ownedProcessReleased', 'checksMayContinue', 'stopPipeline']) {
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


async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) return finish(base({ ok: false, exitCode: EXIT.USAGE, error: args.error }));
  if (args.flags.help) { process.stdout.write(INLINE.usage.join('\n') + '\n'); return EXIT.OK; }
  if (Object.keys(args.options).length || args.flags.example || args.flags.confirmWrite) return finish(base({ ok: false, exitCode: EXIT.USAGE, error: 'preflight takes no options' }));
  return finish(base({ ok: true, exitCode: EXIT.OK, checksMayContinue: true, stopPipeline: false, host: { platform: process.platform, arch: process.arch, node: process.version }, evidenceClass: 'host-report' }));
}

main().then((code) => process.exit(code)).catch((error) => {
  emit(base({ ok: false, exitCode: 1, error: String(error && error.message || 'internal error').slice(0, 180), spawned: false }));
  process.exit(1);
});
