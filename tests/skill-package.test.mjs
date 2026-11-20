import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSkill, packSkill } from '../tools/package-qwen-skill.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skill', 'qwen-duo-12g', 'scripts');
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function run(script, args, extra = {}) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...extra });
}
function jsonOf(result) {
  return JSON.parse(String(result.stdout).trim().split('\n').pop());
}
function listen(port) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.end());
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

test('package check matches the generated scripts and the local CLI order', () => {
  assert.deepEqual(checkSkill().errors, []);
});

test('preflight reports the host and validate rejects bad config', () => {
  const pre = run(path.join(SCRIPTS, '01-preflight.mjs'), []);
  assert.equal(pre.status, 0);
  assert.equal(jsonOf(pre).liveHardwareVerified, false);
  assert.equal(run(path.join(SCRIPTS, '01-preflight.mjs'), ['--config', '/tmp/x']).status, 2);
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
  fs.writeFileSync(path.join(dir, 'relative.json'), JSON.stringify(relative));
  assert.equal(run(script, ['--config', path.join(dir, 'relative.json')]).status, 4);
  const secret = JSON.parse(fs.readFileSync(example, 'utf8'));
  secret.apiKey = 'sk-SECRETVALUE';
  fs.writeFileSync(path.join(dir, 'secret.json'), JSON.stringify(secret));
  const secretRun = run(script, ['--config', path.join(dir, 'secret.json')]);
  assert.equal(secretRun.status, 4);
  assert.equal(secretRun.stdout.includes('SECRETVALUE'), false);
});

test('a busy port makes dependencyOk false and is left running', async () => {
  const world = makeWorld();
  const server = await listen(world.cfg.llamaPort);
  const validated = jsonOf(run(path.join(SCRIPTS, '02-validate-config.mjs'), ['--config', world.cfgPath]));
  const result = run(path.join(SCRIPTS, '03-dependencies.mjs'), ['--config', world.cfgPath, '--artifact-dir', world.art, '--confirm-write', '--input-json', JSON.stringify(validated)]);
  const body = jsonOf(result);
  assert.equal(result.status, 5);
  assert.equal(body.dependencyOk, false);
  assert.equal(body.blockers.some((item) => item.id === 'port-in-use:llamaPort'), true);
  assert.equal(await portOpen(world.cfg.llamaPort), true);
  await new Promise((resolve) => server.close(resolve));
});

test('controlled fixtures pass text and a labelled PNG without claiming a real model', () => {
  const world = makeWorld();
  const bodies = {};
  let prev = '';
  for (const name of fs.readdirSync(SCRIPTS).sort()) {
    const result = run(path.join(SCRIPTS, name), argsFor(name, world, prev));
    assert.equal(result.status, 0, name + '\n' + result.stdout + result.stderr);
    bodies[name] = jsonOf(result);
    prev = result.stdout.trim();
  }
  assert.match(fs.readFileSync(path.join(world.art, 'prompt.txt'), 'utf8'), /FIXTURE/);
  assert.equal(fs.existsSync(path.join(world.root, 'pwned')), false);
  const image = bodies['07-outputs.mjs'];
  assert.equal(image.liveHardwareVerified, false);
  assert.equal(image.realModelOutput, false);
  assert.equal(image.serviceDeclaredFixture, true);
  assert.equal(image.evidenceClass, 'controlled-fixture');
  assert.equal(fs.existsSync(path.join(world.art, 'service-output.png')), true);
  assert.equal(bodies['08-cleanup.mjs'].imageKept, true);
});

test('a failed prompt service is stopped and an unrelated process is kept', async () => {
  const world = makeWorld({ fail: true });
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const validated = jsonOf(run(path.join(SCRIPTS, '02-validate-config.mjs'), ['--config', world.cfgPath]));
  const ready = jsonOf(run(path.join(SCRIPTS, '03-dependencies.mjs'), ['--config', world.cfgPath, '--artifact-dir', world.art, '--confirm-write', '--input-json', JSON.stringify(validated)]));
  const failed = run(path.join(SCRIPTS, '04-prompt-model.mjs'), ['--config', world.cfgPath, '--artifact-dir', world.art, '--confirm-write', '--task', 'fail', '--service-timeout-ms', '2000', '--input-json', JSON.stringify(ready)]);
  assert.equal(failed.status, 5);
  assert.equal(jsonOf(failed).realModelOutput, false);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await portOpen(world.cfg.llamaPort), false);
  assert.equal(alive(unrelated.pid), true);
  unrelated.kill('SIGKILL');
});

test('a wrong prior stage does not start the fixture', () => {
  const world = makeWorld();
  const pre = jsonOf(run(path.join(SCRIPTS, '01-preflight.mjs'), []));
  const result = run(path.join(SCRIPTS, '04-prompt-model.mjs'), ['--config', world.cfgPath, '--artifact-dir', world.art, '--confirm-write', '--task', 'nope', '--input-json', JSON.stringify(pre)]);
  assert.equal(result.status, 5);
  assert.equal(jsonOf(result).protocolMismatch, true);
  assert.equal(fs.existsSync(path.join(world.root, 'started-llama.txt')), false);
});

test('each packaged script runs from its own directory', () => {
  for (const name of fs.readdirSync(SCRIPTS)) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen alone 测试-'));
    const script = path.join(dir, name);
    fs.copyFileSync(path.join(SCRIPTS, name), script);
    fs.writeFileSync(path.join(dir, 'launch-me.mjs'), 'import fs from "node:fs"; fs.writeFileSync("ran.txt", "RAN");\n');
    const result = spawnSync(process.execPath, ['--experimental-permission', '--allow-fs-read=' + script, script, '--help'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, name + ' ' + result.stderr);
    assert.equal(fs.existsSync(path.join(dir, 'ran.txt')), false);
  }
});

test('orchestrator CLI rejects a bad mode and a missing image before starting a server', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-orch-'));
  const env = { ...process.env, QWEN_COMFY_ROOT: root };
  const program = path.join(ROOT, 'orchestrator', 'orchestrator.mjs');
  assert.equal(run(program, ['--run'], { env, timeout: 5000 }).status, 2);
  assert.equal(run(program, ['--run', 'task', '--mode', '4k'], { env, timeout: 5000 }).status, 2);
  const absent = run(program, ['--run', 'task', '--image', path.join(root, 'missing image 测试.png')], { env, timeout: 5000 });
  assert.equal(absent.status, 2);
});

test('zip has one top-level folder and is reproducible', () => {
  const first = packSkill(fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-zip-')));
  const second = packSkill(fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-zip-')));
  assert.equal(first.sha256, second.sha256);
  const listed = spawnSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); names=z.namelist(); assert all(n.startswith("qwen-duo-12g/") and ".." not in n.split("/") for n in names); assert names.count("qwen-duo-12g/SKILL.md")==1; assert set(n.split("/")[0] for n in names)=={"qwen-duo-12g"}; print(len(names))', first.zipPath], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(listed.stdout.trim(), '17');
});

test('a missing executable returns structured JSON and does not crash', () => {
  const world = makeWorld();
  const validated = jsonOf(run(path.join(SCRIPTS, '02-validate-config.mjs'), ['--config', world.cfgPath]));
  const deps = jsonOf(run(path.join(SCRIPTS, '03-dependencies.mjs'), ['--config', world.cfgPath, '--artifact-dir', world.art, '--confirm-write', '--input-json', JSON.stringify(validated)]));
  assert.equal(deps.ok, true);
  const broken = JSON.parse(fs.readFileSync(world.cfgPath, 'utf8'));
  broken.llamaExe = path.join(world.root, 'missing-llama');
  const brokenPath = path.join(world.root, 'broken.json');
  fs.writeFileSync(brokenPath, JSON.stringify(broken));
  const result = run(path.join(SCRIPTS, '04-prompt-model.mjs'), ['--config', brokenPath, '--artifact-dir', world.art, '--confirm-write', '--task', 'x', '--service-timeout-ms', '1000', '--input-json', JSON.stringify(deps)]);
  assert.equal(result.status, 5);
  assert.match(result.stdout, /could not be started/);
  assert.equal(result.stderr.includes('Unhandled'), false);
});

test('cleanup does not signal a process whose invocation token does not match', () => {
  const world = makeWorld();
  const sleeper = path.join(world.root, 'sleeper.mjs');
  fs.writeFileSync(sleeper, 'setInterval(() => {}, 1000);\n');
  const token = '0123456789abcdef0123456789abcdef';
  const victim = spawn(process.execPath, [sleeper, '--qwen-owned-token', token], { stdio: 'ignore' });
  const decoy = spawn(process.execPath, [sleeper, 'victim-marker.mjs'], { stdio: 'ignore' });
  waitPid(victim.pid);
  waitPid(decoy.pid);
  fs.writeFileSync(path.join(world.art, 'owned-prompt-model.json'), JSON.stringify({
    pid: decoy.pid, exe: fs.readlinkSync('/proc/' + decoy.pid + '/exe'), starttime: procStart(decoy.pid), token,
  }));
  fs.writeFileSync(path.join(world.art, 'service-output.png'), PNG_B64);
  const outputs = { stage: 'outputs', ok: true, artifactDir: world.art, serviceDeclaredFixture: true };
  const result = run(path.join(SCRIPTS, '08-cleanup.mjs'), ['--config', world.cfgPath, '--artifact-dir', world.art, '--confirm-write', '--input-json', JSON.stringify(outputs)]);
  assert.equal(jsonOf(result).stoppedOwnedPids.includes(decoy.pid), false);
  assert.equal(alive(decoy.pid), true);
  assert.equal(alive(victim.pid), true);
  victim.kill('SIGKILL');
  decoy.kill('SIGKILL');
});

test('cleanup stops only a process whose exe, start time, and token all match', () => {
  const world = makeWorld();
  const token = 'abcdef0123456789abcdef0123456789';
  const sleeper = path.join(world.root, 'sleeper.mjs');
  fs.writeFileSync(sleeper, 'setInterval(() => {}, 1000);\n');
  const owned = spawn(process.execPath, [sleeper, '--qwen-owned-token', token], { stdio: 'ignore' });
  const other = spawn(process.execPath, [sleeper], { stdio: 'ignore' });
  waitPid(owned.pid);
  waitPid(other.pid);
  fs.writeFileSync(path.join(world.art, 'owned-image-stage.json'), JSON.stringify({
    pid: owned.pid, exe: fs.readlinkSync('/proc/' + owned.pid + '/exe'), starttime: procStart(owned.pid), token,
  }));
  fs.writeFileSync(path.join(world.art, 'service-output.png'), Buffer.from(PNG_B64, 'base64'));
  const outputs = { stage: 'outputs', ok: true, artifactDir: world.art };
  const result = run(path.join(SCRIPTS, '08-cleanup.mjs'), ['--config', world.cfgPath, '--artifact-dir', world.art, '--confirm-write', '--input-json', JSON.stringify(outputs)]);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(jsonOf(result).stoppedOwnedPids, [owned.pid]);
  assert.equal(alive(other.pid), true);
  other.kill('SIGKILL');
});

test('handoff does not treat a closed port as a stopped process', () => {
  const world = makeWorld();
  const sleeper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  waitPid(sleeper.pid);
  fs.writeFileSync(path.join(world.art, 'prompt.txt'), 'FIXTURE text');
  const prior = {
    stage: 'prompt-model', ok: true, artifactDir: world.art, ownedProcessReleased: true,
    promptSha256: sha(fs.readFileSync(path.join(world.art, 'prompt.txt'))),
    ownerPid: sleeper.pid, ownerStarttime: procStart(sleeper.pid), serviceDeclaredFixture: true,
  };
  const result = run(path.join(SCRIPTS, '05-gpu-handoff.mjs'), ['--config', world.cfgPath, '--artifact-dir', world.art, '--confirm-write', '--input-json', JSON.stringify(prior)]);
  assert.equal(result.status, 5);
  assert.equal(jsonOf(result).ownedProcessReleased, false);
  assert.equal(alive(sleeper.pid), true);
  sleeper.kill('SIGKILL');
});

test('image output rejects traversal and symlinks, and reads subfolder or temp bytes', () => {
  const outside = Buffer.from('OUTSIDE-PNG-BYTES-NOT-REALLY');
  const batch = Buffer.from(PNG_B64, 'base64');
  const rootFile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const rejected = runImage({ filename: '../outside.png' }, (world) => {
    fs.writeFileSync(path.join(world.root, 'outside.png'), outside);
  });
  assert.equal(rejected.status, 5);
  assert.equal(fs.existsSync(path.join(rejected.world.art, 'service-output.png')), false);
  const linked = runImage({ filename: 'linked.png', skipWrite: true }, (world) => {
    fs.writeFileSync(path.join(world.root, 'secret.png'), batch);
    fs.symlinkSync(path.join(world.root, 'secret.png'), path.join(world.output, 'linked.png'));
  });
  assert.equal(linked.status, 5);
  assert.equal(fs.existsSync(path.join(linked.world.art, 'service-output.png')), false);
  const nested = runImage({ filename: 'pic.png', subfolder: 'batch', skipWrite: true }, (world) => {
    fs.mkdirSync(path.join(world.output, 'batch'));
    fs.writeFileSync(path.join(world.output, 'pic.png'), rootFile);
    fs.writeFileSync(path.join(world.output, 'batch', 'pic.png'), batch);
    const old = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(path.join(world.output, 'batch', 'pic.png'), old, old);
  });
  assert.equal(nested.status, 0, nested.stdout);
  assert.equal(sha(fs.readFileSync(path.join(nested.world.art, 'service-output.png'))), sha(batch));
  const temp = runImage({ filename: 'pic.png', type: 'temp', fixture: false, skipWrite: true }, (world) => {
    const tempDir = path.join(world.root, 'temp');
    fs.mkdirSync(tempDir);
    fs.writeFileSync(path.join(world.output, 'pic.png'), rootFile);
    fs.writeFileSync(path.join(tempDir, 'pic.png'), batch);
  });
  assert.equal(temp.status, 0, temp.stdout);
  assert.equal(sha(fs.readFileSync(path.join(temp.world.art, 'service-output.png'))), sha(batch));
  assert.equal(jsonOf(temp).realModelOutput, false);
});

test('a graph without node 5 is not submitted', () => {
  const world = makeWorld();
  fs.writeFileSync(world.cfg.graph, '{"1":{"inputs":{"text":"SEED"}}}\n');
  const result = runPreparedImage(world, {});
  assert.equal(result.status, 5);
  assert.match(result.stdout, /node 5/);
  assert.equal(fs.existsSync(path.join(world.root, 'started-comfy.txt')), false);
});

test('a reference image is uploaded before the prompt is submitted', () => {
  const world = makeWorld();
  const image = path.join(world.root, 'reference.png');
  fs.writeFileSync(image, Buffer.from(PNG_B64, 'base64'));
  fs.writeFileSync(world.cfg.graph, '{"5":{"inputs":{"prompt":""}},"10":{"inputs":{}}}\n');
  const result = runPreparedImage(world, { image });
  assert.equal(result.status, 0, result.stdout);
  const body = JSON.parse(fs.readFileSync(path.join(world.output, 'prompt-body.json'), 'utf8'));
  assert.equal(body.prompt['5'].inputs.prompt.includes('FIXTURE'), true);
  assert.equal(body.prompt['14'].inputs.image, 'ref.png');
  assert.equal(jsonOf(result).referenceUploaded, true);
});

function waitPid(pid) {
  const end = Date.now() + 1000;
  while (Date.now() < end) {
    try { fs.readlinkSync('/proc/' + pid + '/exe'); return; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); }
  }
  throw new Error('process did not appear: ' + pid);
}
function sha(bytes) {
  return spawnSync(process.execPath, ['-e', 'process.stdout.write(require("crypto").createHash("sha256").update(Buffer.from(process.argv[1],"base64")).digest("hex"))', Buffer.from(bytes).toString('base64')], { encoding: 'utf8' }).stdout;
}
function procStart(pid) {
  const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
}
function runPreparedImage(world, options) {
  fs.writeFileSync(path.join(world.art, 'prompt.txt'), 'FIXTURE prompt');
  const prior = { stage: 'gpu-handoff', ok: true, ownedProcessReleased: true, artifactDir: world.art, promptSha256: sha(Buffer.from('FIXTURE prompt')), serviceDeclaredFixture: true };
  const args = ['--config', world.cfgPath, '--artifact-dir', world.art, '--confirm-write', '--service-timeout-ms', '3000', '--input-json', JSON.stringify(prior)];
  if (options.image) args.push('--image', options.image);
  return run(path.join(SCRIPTS, '06-image-stage.mjs'), args, options.env ? { env: { ...process.env, ...options.env } } : {});
}
function runImage(spec, arrange) {
  const world = makeWorld();
  if (arrange) arrange(world);
  const env = { QWEN_FIXTURE_IMAGE: JSON.stringify({ ...spec, fixture: spec.fixture !== false }) };
  const result = runPreparedImage(world, { env });
  return Object.assign(result, { world });
}

let nextPort = 22000 + (process.pid % 4000);
function argsFor(name, world, prev) {
  if (name.startsWith('01')) return [];
  const common = ['--config', world.cfgPath];
  if (name.startsWith('02')) return prev ? common.concat(['--input-json', prev]) : common;
  const art = common.concat(['--artifact-dir', world.art, '--confirm-write']);
  if (name.startsWith('03')) return art.concat(['--input-json', prev]);
  if (name.startsWith('04')) return art.concat(['--task', 'a cat $(touch ' + path.join(world.root, 'pwned') + ')', '--service-timeout-ms', '3000', '--input-json', prev]);
  if (name.startsWith('06')) return art.concat(['--service-timeout-ms', '3000', '--input-json', prev]);
  return art.concat(['--input-json', prev]);
}

function makeWorld(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-fix-'));
  const art = path.join(root, 'artifacts');
  const output = path.join(root, 'comfy-out');
  const project = path.join(root, 'project');
  fs.mkdirSync(art);
  fs.mkdirSync(output);
  fs.mkdirSync(path.join(project, 'orchestrator'), { recursive: true });
  fs.writeFileSync(path.join(project, 'orchestrator', 'orchestrator.mjs'), 'import fs from "node:fs"; fs.writeFileSync("ran.txt", "ran");\n');
  fs.writeFileSync(path.join(root, 'graph.json'), '{"5":{"inputs":{"prompt":""}}}\n');
  for (const name of ['model.gguf', 'mm.gguf', 'main.py']) fs.writeFileSync(path.join(root, name), 'x');
  fs.writeFileSync(path.join(root, 'fake-llama.mjs'), llamaFixture(Boolean(options.fail)));
  fs.writeFileSync(path.join(root, 'fake-comfy.mjs'), comfyFixture());
  fs.chmodSync(path.join(root, 'fake-llama.mjs'), 0o755);
  fs.chmodSync(path.join(root, 'fake-comfy.mjs'), 0o755);
  const base = nextPort;
  nextPort += 40;
  const cfg = {
    schema: 'qwen-duo-12g.config/v1', projectRoot: project,
    llamaExe: path.join(root, 'fake-llama.mjs'), model: path.join(root, 'model.gguf'), mmproj: path.join(root, 'mm.gguf'),
    python: path.join(root, 'fake-comfy.mjs'), comfyMain: path.join(root, 'main.py'), comfyCwd: root,
    comfyOutput: output, graph: path.join(root, 'graph.json'), imageDit: '', imageEncoder: '', imageVae: '',
    thinking: 'off', mode: '1080p',
    llamaPort: base + (options.fail ? 10 : 0), comfyPort: base + 20, uiPort: base + 30,
    allowDownloads: false, allowSystemChanges: false, expectedBytes: {},
  };
  const cfgPath = path.join(root, 'cfg.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  return { root, art, output, project, cfg, cfgPath };
}

function llamaFixture(fail) {
  return `#!/usr/bin/env node
// controlled fixture, not a model
import http from 'node:http';
import fs from 'node:fs';
fs.writeFileSync(new URL('./started-llama.txt', import.meta.url), 'yes');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  if (req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (${fail ? 'true' : 'false'}) { res.writeHead(500); return res.end('no'); }
      const task = JSON.parse(raw).messages[1].content;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ fixture: true, choices: [{ message: { content: 'FIXTURE ' + task } }] }));
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(port, '127.0.0.1');
`;
}

function comfyFixture() {
  return `#!/usr/bin/env node
// controlled fixture, not a model
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
fs.writeFileSync(new URL('./started-comfy.txt', import.meta.url), 'yes');
const port = Number(process.env.QWEN_COMFY_PORT);
const png = Buffer.from('${PNG_B64}', 'base64');
const server = http.createServer((req, res) => {
  if (req.url === '/system_stats') { res.writeHead(200); return res.end('{}'); }
  if (req.method === 'POST' && req.url === '/upload/image') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ name: 'ref.png' }));
  }
  if (req.method === 'POST' && req.url === '/prompt') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      fs.writeFileSync(path.join(process.env.QWEN_COMFY_OUTPUT, 'prompt-body.json'), raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prompt_id: 'p1' }));
    });
    return;
  }
  if (req.url.startsWith('/history/')) {
    const spec = process.env.QWEN_FIXTURE_IMAGE ? JSON.parse(process.env.QWEN_FIXTURE_IMAGE) : { filename: 'fixture.png', subfolder: '', type: 'output' };
    if (!spec.skipWrite) {
      const base = spec.type && spec.type !== 'output' ? path.resolve(path.dirname(process.env.QWEN_COMFY_OUTPUT), spec.type) : process.env.QWEN_COMFY_OUTPUT;
      const dir = spec.subfolder ? path.join(base, spec.subfolder) : base;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, spec.filename), spec.bytesB64 ? Buffer.from(spec.bytesB64, 'base64') : png);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ p1: { fixture: spec.fixture !== false, status: { completed: true, status_str: 'success', messages: spec.cached ? [['execution_cached']] : [] }, outputs: { a: { images: [{ filename: spec.filename, subfolder: spec.subfolder || '', type: spec.type || 'output' }] } } } }));
  }
  res.writeHead(404); res.end();
});
server.listen(port, '127.0.0.1');
`;
}
