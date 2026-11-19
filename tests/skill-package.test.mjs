import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSkill, packSkill, zipStore } from '../tools/package-qwen-skill.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skill', 'qwen-duo-12g', 'scripts');

function run(script, args, extra = {}) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...extra });
}

function jsonOf(result) {
  return JSON.parse(result.stdout);
}

test('package check matches the generated scripts and the local CLI order', () => {
  const checked = checkSkill();
  assert.deepEqual(checked.errors, []);
});

test('preflight is a report and blocks the pipeline', () => {
  const result = run(path.join(SCRIPTS, '01-preflight.mjs'), []);
  assert.equal(result.status, 0);
  const body = jsonOf(result);
  assert.equal(body.stage, 'preflight');
  assert.equal(body.marketplaceApproved, false);
  assert.equal(body.protocolGuaranteedByAgensi, false);
  assert.equal(body.pipelineBlocked, true);
  assert.equal(body.stopPipeline, true);
  assert.equal(body.checksMayContinue, true);
  assert.equal(body.spawned, false);
  assert.equal(body.executedLocalProgram, false);
  assert.equal(run(path.join(SCRIPTS, '01-preflight.mjs'), ['--config', '/tmp/x']).status, 2);
});

test('validate accepts the example and rejects bad, missing, relative, and secret config', () => {
  const script = path.join(SCRIPTS, '02-validate-config.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen skill 测试-'));
  const example = path.join(dir, 'example.json');
  fs.writeFileSync(example, run(script, ['--print-example-config']).stdout);
  assert.equal(run(script, ['--config', example]).status, 0);
  assert.equal(run(script, ['--config', path.join(dir, 'missing.json')]).status, 3);
  fs.writeFileSync(path.join(dir, 'bad.json'), '{');
  assert.equal(run(script, ['--config', path.join(dir, 'bad.json')]).status, 4);
  const relative = JSON.parse(fs.readFileSync(example, 'utf8'));
  relative.model = 'models/weight.gguf';
  const relativeFile = path.join(dir, 'relative.json');
  fs.writeFileSync(relativeFile, JSON.stringify(relative));
  assert.equal(run(script, ['--config', relativeFile]).status, 4);
  relative.model = '';
  relative.allowDownloads = true;
  fs.writeFileSync(relativeFile, JSON.stringify(relative));
  assert.equal(run(script, ['--config', relativeFile]).status, 4);
  const secretFile = path.join(dir, 'secret.json');
  const secret = JSON.parse(fs.readFileSync(example, 'utf8'));
  secret.apiKey = 'sk-SECRETVALUE';
  fs.writeFileSync(secretFile, JSON.stringify(secret));
  const secretRun = run(script, ['--config', secretFile]);
  assert.equal(secretRun.status, 4);
  assert.equal(secretRun.stdout.includes('SECRETVALUE'), false);
});

test('dependencies stop, and a write probe does not remove a user file', () => {
  const script = path.join(SCRIPTS, '03-dependencies.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen dep 测试-'));
  const example = path.join(dir, 'example.json');
  fs.writeFileSync(example, run(path.join(SCRIPTS, '02-validate-config.mjs'), ['--print-example-config']).stdout);
  const blocked = run(script, ['--config', example]);
  assert.equal(blocked.status, 5);
  const blockedJson = jsonOf(blocked);
  assert.equal(blockedJson.pipelineBlocked, true);
  assert.equal(blockedJson.workspaceVerified, false);
  const ws = path.join(dir, 'work space');
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(ws, 'keep-me.txt'), 'keep\n');
  const probed = jsonOf(run(script, ['--config', example, '--workspace', ws, '--confirm-write']));
  assert.equal(probed.workspaceVerified, true);
  assert.equal(fs.readFileSync(path.join(ws, 'keep-me.txt'), 'utf8'), 'keep\n');
  assert.equal(fs.existsSync(path.join(ws, 'qwen-duo-12g-workspace-probe.json')), false);
  fs.writeFileSync(path.join(ws, 'qwen-duo-12g-workspace-probe.json'), 'user-owned\n');
  const existing = jsonOf(run(script, ['--config', example, '--workspace', ws, '--confirm-write']));
  assert.equal(existing.workspaceVerified, false);
  assert.equal(fs.readFileSync(path.join(ws, 'qwen-duo-12g-workspace-probe.json'), 'utf8'), 'user-owned\n');
});

test('candidate JSON handoff stops the model stage without starting a program', () => {
  const pre = run(path.join(SCRIPTS, '01-preflight.mjs'), []);
  const validated = run(path.join(SCRIPTS, '02-validate-config.mjs'), ['--config', path.join(SCRIPTS, '..', 'templates', 'config.example.json'), '--input-json', pre.stdout.trim()]);
  assert.equal(validated.status, 0);
  const prompt = run(path.join(SCRIPTS, '04-prompt-model.mjs'), ['--input-json', JSON.stringify({ stage: 'dependencies', ok: true, pipelineBlocked: false })]);
  assert.equal(prompt.status, 5);
  const body = jsonOf(prompt);
  assert.equal(body.pipelineBlocked, true);
  assert.equal(body.spawned, false);
  assert.equal(body.executedLocalProgram, false);
  assert.equal(body.protocolMismatch, false);
  const forged = run(path.join(SCRIPTS, '06-image-stage.mjs'), ['--input-json', '{"stage":"gpu-handoff","ok":true,"task":"测试 $(touch pwned)"}']);
  assert.equal(forged.status, 5);
  assert.equal(forged.stdout.includes('pwned'), false);
  assert.equal(forged.stdout.includes('测试'), false);
});

test('a copied script does not execute or read a sibling', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen alone 测试-'));
  const script = path.join(dir, '01-preflight.mjs');
  fs.copyFileSync(path.join(SCRIPTS, '01-preflight.mjs'), script);
  fs.writeFileSync(path.join(dir, 'launch-me.mjs'), 'import fs from "node:fs"; fs.writeFileSync("ran.txt", "RAN");\n');
  const result = spawnSync(process.execPath, ['--experimental-permission', '--allow-fs-read=' + script, script], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'ran.txt')), false);
  const body = JSON.parse(result.stdout);
  assert.equal(body.stage, 'preflight');
});

test('orchestrator CLI rejects a bad mode and a missing image before starting a server', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-orch-'));
  const env = { ...process.env, QWEN_COMFY_ROOT: root };
  const program = path.join(ROOT, 'orchestrator', 'orchestrator.mjs');
  const missing = run(program, ['--run'], { env, timeout: 5000 });
  assert.equal(missing.status, 2);
  const mode = run(program, ['--run', 'task', '--mode', '4k'], { env, timeout: 5000 });
  assert.equal(mode.status, 2);
  const image = path.join(root, 'missing image 测试.png');
  const absent = run(program, ['--run', 'task', '--image', image], { env, timeout: 5000 });
  assert.equal(absent.status, 2);
  assert.match(absent.stderr, /30MB|不存在|必须是/);
});

test('zip has one top-level folder and is reproducible', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-zip-'));
  const first = packSkill(out);
  const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-zip-'));
  const second = packSkill(secondDir);
  assert.equal(first.sha256, second.sha256);
  const listed = spawnSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); names=z.namelist(); assert names and all(n.startswith("qwen-duo-12g/") and ".." not in n.split("/") for n in names); assert names.count("qwen-duo-12g/SKILL.md")==1; tops=set(n.split("/")[0] for n in names); assert tops=={"qwen-duo-12g"}; print(len(names))', first.zipPath], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(listed.stdout.trim(), '17');
  const buf = fs.readFileSync(first.zipPath);
  assert.equal(buf.length < 50 * 1024 * 1024, true);
  const parsed = zipStore([{ name: 'qwen-duo-12g/SKILL.md', data: Buffer.from('x') }]);
  assert.equal(parsed[0], 0x50);
});
