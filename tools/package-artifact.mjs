// Repackages a production build (dist/) for hosting as a claude.ai Artifact, which serves a fixed
// set of web file types: .glb models become base64 inside a .json file and the page loses
// its document skeleton (the host adds one).
// Usage: VITE_MODEL_EXT=json npm run build && node tools/package-artifact.mjs dist <out-dir>
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: node tools/package-artifact.mjs <dist> <out-dir>');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, 'assets'), join(out, 'assets'), { recursive: true });

function walk(dir) {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
}
// The host's CSP blocks fetch() of data: URIs, so models can't be glTF JSON with embedded buffers.
// Ship each .glb as base64 inside a JSON file instead; src/assets.ts decodes it.
for (const file of walk(join(out, 'assets')).filter((f) => f.endsWith('.glb'))) {
  writeFileSync(file.replace(/\.glb$/, '.json'), JSON.stringify({ glb: readFileSync(file).toString('base64') }));
  rmSync(file);
}

const html = readFileSync(join(src, 'index.html'), 'utf8')
  .replace(/<!doctype html>\s*<html[^>]*>\s*<head>/i, '')
  .replace(/<meta[^>]*>\s*/g, '')
  .replace(/<\/head>|<body>|<\/body>|<\/html>/g, '')
  .trim();
writeFileSync(join(out, 'index.html'), html + '\n');
console.log('packaged', out);
