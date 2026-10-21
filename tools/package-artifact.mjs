// Repackages a production build (dist/) for hosting as a claude.ai Artifact, which serves a fixed
// set of web file types: .glb models become self-contained glTF JSON (.json) and the page loses
// its document skeleton (the host adds one).
// Usage: VITE_MODEL_EXT=json npm run build && node tools/package-artifact.mjs dist <out-dir>
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: node tools/package-artifact.mjs <dist> <out-dir>');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, 'assets'), join(out, 'assets'), { recursive: true });

const io = new NodeIO();
const mime = { '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
function walk(dir) {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
}
for (const file of walk(join(out, 'assets')).filter((f) => f.endsWith('.glb'))) {
  const doc = await io.read(file);
  const { json, resources } = await io.writeJSON(doc);
  const embed = (item) => {
    if (!item.uri || item.uri.startsWith('data:')) return;
    const ext = item.uri.slice(item.uri.lastIndexOf('.'));
    item.uri = `data:${item.mimeType ?? mime[ext] ?? 'application/octet-stream'};base64,${Buffer.from(resources[item.uri]).toString('base64')}`;
  };
  (json.buffers ?? []).forEach(embed);
  (json.images ?? []).forEach(embed);
  writeFileSync(file.replace(/\.glb$/, '.json'), JSON.stringify(json));
  rmSync(file);
}

const html = readFileSync(join(src, 'index.html'), 'utf8')
  .replace(/<!doctype html>\s*<html[^>]*>\s*<head>/i, '')
  .replace(/<meta[^>]*>\s*/g, '')
  .replace(/<\/head>|<body>|<\/body>|<\/html>/g, '')
  .trim();
writeFileSync(join(out, 'index.html'), html + '\n');
console.log('packaged', out);
