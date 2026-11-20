#!/usr/bin/env node
// Checks the skill folder and writes a deterministic ZIP. Not a marketplace script.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { exampleText, renderAll } from './render-stage-scripts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = path.join(ROOT, 'skill', 'qwen-duo-12g');
const LOGIC_LIMIT = 20 * 1024;
const FILES = [
  'LICENSE',
  'SKILL.md',
  'references/DESIGN-SPLIT.md',
  'references/INVENTORY.md',
  'references/LISTING-DRAFT.md',
  'references/PREREQUISITES.md',
  'references/REQUIREMENTS.md',
  'references/TRACEABILITY.md',
  'scripts/01-preflight.mjs',
  'scripts/02-validate-config.mjs',
  'scripts/03-dependencies.mjs',
  'scripts/04-prompt-model.mjs',
  'scripts/05-gpu-handoff.mjs',
  'scripts/06-image-stage.mjs',
  'scripts/07-outputs.mjs',
  'scripts/08-cleanup.mjs',
  'templates/config.example.json',
];
const FORBIDDEN = ['/home/', '/Users/', 'C:\\Users', 'C:/Users', '.codex', '.grok-review', 'Jxbbbbbyan'];
const STAGE_IDS = ['preflight', 'validate-config', 'dependencies', 'prompt-model', 'gpu-handoff', 'image-stage', 'outputs', 'cleanup'];

export function logicBytes(source) {
  const start = source.indexOf('/* __INLINE_DATA_START__ */');
  const end = source.indexOf('/* __INLINE_DATA_END__ */');
  if (start < 0 || end < start) return null;
  const marker = '/* __INLINE_DATA_END__ */';
  return Buffer.byteLength(source.slice(0, start) + source.slice(end + marker.length));
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(SKILL, path.join(dir, entry.name)).split(path.sep).join('/');
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name)));
    else out.push(rel);
  }
  return out.sort();
}

function frontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return null;
  return { yaml: text.slice(4, end), body: text.slice(end + 5) };
}

function markdownLinks(text) {
  const links = [];
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let match;
  while ((match = re.exec(text))) links.push(match[1]);
  return links;
}

function cliCalls(source) {
  const start = source.indexOf('if (isCli) {');
  const end = source.indexOf('} else {\n  server.listen', start);
  const region = source.slice(start, end);
  const re = /(?:await\s+)?(startLlama|writePrompt|stopLlama|startComfy|uploadImage|render|deliverImage|stopComfy)\s*\(/g;
  const calls = [];
  let match;
  while ((match = re.exec(region))) calls.push(match[1]);
  return calls;
}

function traceIds(text) {
  return text.split('\n')
    .filter((line) => line.startsWith('| ') && !line.includes('---') && !line.includes('| id |'))
    .map((line) => line.split('|')[1].trim());
}

function stepHeadings(text) {
  const start = text.indexOf('## Steps\n');
  const end = text.indexOf('\n## ', start + 1);
  const section = text.slice(start, end < 0 ? text.length : end);
  return [...section.matchAll(/^### ([a-z0-9-]+)\s*$/gm)].map((match) => match[1]);
}

export function checkSkill() {
  const errors = [];
  const found = walk(SKILL);
  if (found.join() !== FILES.join()) errors.push('skill file list mismatch: ' + found.join(', '));
  const skillMd = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const fm = frontmatter(skillMd);
  if (!fm || !fm.body.trim()) errors.push('SKILL.md frontmatter or body is missing');
  else {
    if (!/^name:\s*qwen-duo-12g\s*$/m.test(fm.yaml)) errors.push('name must be qwen-duo-12g');
    if (!/^description:\s+"/m.test(fm.yaml)) errors.push('description must be present');
    const summary = fm.yaml.match(/^summary:\s+"(.*)"\s*$/m);
    if (!summary) errors.push('summary must be one double-quoted line');
    else if (summary[1].length > 300) errors.push('summary is longer than 300 characters');
    if (!/^version:\s+/m.test(fm.yaml)) errors.push('version is missing');
    if (fm.yaml.includes('docs_url')) errors.push('docs_url is omitted until a docs link is chosen');
  }
  if (stepHeadings(skillMd).join() !== STAGE_IDS.join()) errors.push('SKILL step headings do not match stage ids');
  const trace = traceIds(fs.readFileSync(path.join(SKILL, 'references', 'TRACEABILITY.md'), 'utf8'));
  if (trace.join() !== ['blocker', 'local-program'].concat(STAGE_IDS).join()) errors.push('traceability ids drifted: ' + trace.join(','));
  const rendered = renderAll();
  const symbols = [];
  for (const item of rendered) {
    const onDisk = fs.readFileSync(path.join(SKILL, 'scripts', item.file), 'utf8');
    if (onDisk !== item.source) errors.push(item.file + ' is not the generated source');
    const size = logicBytes(onDisk);
    const limit = item.file === '04-prompt-model.mjs' || item.file === '06-image-stage.mjs' ? 32 * 1024 : LOGIC_LIMIT;
    if (size == null || size > limit) errors.push(item.file + ' logic is ' + size + ' bytes');
    if (onDisk.includes('import.meta.url')) errors.push(item.file + ' reads its own path');
    const rel = 'scripts/' + item.file;
    const serviceStage = rel === 'scripts/04-prompt-model.mjs' || rel === 'scripts/06-image-stage.mjs' || rel === 'scripts/08-cleanup.mjs';
    if ((onDisk.includes('child_process') || onDisk.includes('spawn(')) && !serviceStage) errors.push(item.file + ' spawns outside a service stage');
    if (serviceStage && onDisk.includes('spawn(') && !onDisk.includes('shell: false')) errors.push(item.file + ' spawn must set shell false');
    if (onDisk.includes("'/IM'") || onDisk.includes('"/IM"')) errors.push(item.file + ' kills by image name');
    if ((rel === 'scripts/04-prompt-model.mjs' || rel === 'scripts/06-image-stage.mjs') && onDisk.includes('orchestrator.mjs')) {
      errors.push(item.file + ' references the repository orchestrator');
    }
    const inline = JSON.parse(onDisk.match(/const INLINE = (\{[\s\S]*?\});\n\/\* __INLINE_DATA_END__ \*\//)[1]);
    symbols.push(...inline.symbols);
  }
  const calls = cliCalls(fs.readFileSync(path.join(ROOT, 'orchestrator', 'orchestrator.mjs'), 'utf8'));
  const expected = symbols.concat(['startLlama', 'stopComfy', 'stopLlama']);
  if (calls.join() !== expected.join()) errors.push('CLI order is ' + calls.join(','));
  const printed = spawnSync(process.execPath, [path.join(SKILL, 'scripts', '02-validate-config.mjs'), '--print-example-config'], { encoding: 'utf8' });
  if (printed.status !== 0 || printed.stdout !== exampleText()) errors.push('example config does not match the validate script');
  if (fs.readFileSync(path.join(SKILL, 'templates', 'config.example.json'), 'utf8') !== exampleText()) errors.push('template config drifted');
  if (fs.readFileSync(path.join(SKILL, 'LICENSE'), 'utf8') !== fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8')) errors.push('LICENSE copy drifted');
  for (const rel of FILES) {
    const text = fs.readFileSync(path.join(SKILL, rel), 'utf8');
    for (const token of FORBIDDEN) if (text.includes(token)) errors.push(rel + ' contains ' + token);
    if (rel.endsWith('.md')) {
      for (const link of markdownLinks(text)) {
        if (link.startsWith('http://') || link.startsWith('https://')) continue;
        if (link.startsWith('/') || link.includes('\\') || link.includes('..')) errors.push(rel + ' has a bad link ' + link);
        const target = path.resolve(path.dirname(path.join(SKILL, rel)), link);
        const inside = path.relative(SKILL, target);
        if (inside.startsWith('..') || path.isAbsolute(inside) || !fs.existsSync(target)) errors.push(rel + ' link missing ' + link);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function crc(buf) {
  return zlib.crc32(buf) >>> 0;
}

export function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = entry.data;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, data);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat(locals.concat([centralBuf, end]));
}

export function laStamp(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    file: parts.year + parts.month + parts.day + '-' + parts.hour + parts.minute + '-Asia-Shanghai',
    text: parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute + ' Asia/Shanghai',
  };
}

export function packSkill(outDir) {
  const entries = FILES.map((rel) => ({
    name: 'qwen-duo-12g/' + rel,
    data: fs.readFileSync(path.join(SKILL, rel)),
  }));
  const zip = zipStore(entries);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = laStamp();
  const zipName = 'qwen-duo-12g-skill-' + stamp.file + '.zip';
  const zipPath = path.join(outDir, zipName);
  fs.writeFileSync(zipPath, zip);
  const manifest = {
    timezone: 'Asia/Shanghai',
    generatedAt: stamp.text,
    zip: zipName,
    zipSha256: crypto.createHash('sha256').update(zip).digest('hex'),
    zipBytes: zip.length,
    fileCount: entries.length,
    marketplaceApproved: false,
    liveHardwareVerified: false,
    implementationPresent: true,
    files: entries.map((entry) => ({
      name: entry.name,
      bytes: entry.data.length,
      sha256: crypto.createHash('sha256').update(entry.data).digest('hex'),
    })),
  };
  const manifestPath = path.join(outDir, 'qwen-duo-12g-skill-manifest-' + stamp.file + '.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { zipPath, manifestPath, sha256: manifest.zipSha256 };
}

function main() {
  const checked = checkSkill();
  if (!checked.ok) {
    process.stderr.write(checked.errors.join('\n') + '\n');
    process.exit(1);
  }
  if (!process.argv.includes('--pack')) {
    process.stdout.write('ok\n');
    return;
  }
  const outIdx = process.argv.indexOf('--out');
  const out = outIdx >= 0 ? process.argv[outIdx + 1] : '/opt/cursor/artifacts';
  process.stdout.write(JSON.stringify(packSkill(out), null, 2) + '\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
