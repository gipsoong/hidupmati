// Builds the game's runtime assets in public/assets from the original CC0 packs.
// Usage: node tools/build-assets.mjs <source-dir>
// See CREDITS.md for where each pack comes from. The source packs are not kept in this repo.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, resample } from '@gltf-transform/functions';

const src = process.argv[2];
if (!src) throw new Error('usage: node tools/build-assets.mjs <source-dir>');
const out = 'public/assets';
mkdirSync(out, { recursive: true });
const io = new NodeIO();

async function trimClips(input, output, keep) {
  const doc = await io.read(input);
  for (const anim of doc.getRoot().listAnimations()) {
    if (keep.includes(anim.getName())) continue;
    // Samplers and channels outlive their animation unless disposed; prune() then drops their data.
    for (const s of anim.listSamplers()) s.dispose();
    for (const c of anim.listChannels()) c.dispose();
    anim.dispose();
  }
  const missing = keep.filter((k) => !doc.getRoot().listAnimations().some((a) => a.getName() === k));
  if (missing.length) throw new Error(`${input}: missing clips ${missing}`);
  await doc.transform(resample(), dedup(), prune());
  await io.write(output, doc);
}

const UAL1 = join(src, 'tilak/quaternius/universal-animation-library/Unreal-Godot/UAL1.glb');
await trimClips(UAL1, join(out, 'player.glb'), [
  'Idle_Loop', 'Jog_Fwd_Loop', 'Jog_Bwd_Loop', 'Jog_Left_Loop', 'Jog_Right_Loop',
  'Pistol_Aim_Neutral', 'Hit_Chest', 'Death01',
]);

// The zombie's glTF expects its texture under textures/, the repo keeps it next to the file.
const zdir = mkdtempSync(join(tmpdir(), 'zombie-'));
cpSync(join(src, 'Animated-Zombie'), zdir, { recursive: true });
mkdirSync(join(zdir, 'textures'), { recursive: true });
cpSync(join(zdir, 'zombie_MAT_baseColor.jpeg'), join(zdir, 'textures/zombie_MAT_baseColor.jpeg'));
await trimClips(join(zdir, 'scene.gltf'), join(out, 'zombie.glb'), ['SPAWN', 'WALK', 'RUN', 'ATK', 'HIT', 'DEAD']);

// Environment textures, downsized for the web.
const city = join(src, 'tilak/quaternius/downtown-city-megakit/Exports/glTF (Godot)');
const tex = [
  ['T_RedBrick_BaseColor.png', 'brick.jpg', 1024],
  ['T_RedBrick_Normal.png', 'brick_n.jpg', 512],
  ['T_Concrete_BaseColor.png', 'concrete.jpg', 1024],
  ['T_Concrete_Normal.png', 'concrete_n.jpg', 512],
  ['T_Concrete_Asphalt_BaseColor.png', 'asphalt.jpg', 1024],
  ['T_MarbleFloor_BaseColor.png', 'marble.jpg', 512],
  ['T_Dirt_BaseColor.png', 'dirt.jpg', 1024],
  ['T_Dirt_Normal.png', 'dirt_n.jpg', 512],
  ['T_Street_Decals.png', 'decals.png', 512],
];
for (const [from, to, size] of tex) {
  const args = [join(city, from), '-resize', `${size}x${size}`, '-strip'];
  if (to.endsWith('.jpg')) args.push('-alpha', 'off', '-quality', '82');
  execFileSync('convert', [...args, join(out, to)]);
}
// Props: each model becomes one .glb with its textures shrunk to 512px.
const nature = join(src, 'tilak/quaternius/stylized-nature-megakit/glTF');
const props = [
  [nature, 'DeadTree_1'], [nature, 'DeadTree_3'], [nature, 'CommonTree_2'],
  [nature, 'Rock_Medium_1'], [nature, 'Grass_Wispy_Short'],
  [city, 'Prop_ACUnit'], [city, 'Prop_Planter_Single'],
];
mkdirSync(join(out, 'props'), { recursive: true });
for (const [dir, name] of props) {
  const tmp = mkdtempSync(join(tmpdir(), 'prop-'));
  const gltf = JSON.parse(readFileSync(join(dir, `${name}.gltf`), 'utf8'));
  for (const b of gltf.buffers) cpSync(join(dir, b.uri), join(tmp, b.uri));
  for (const img of gltf.images ?? []) {
    // Leaf and grass cards need alpha; everything else ships as JPEG.
    const alpha = /_C\.png$|^Grass\.png$/.test(img.uri);
    const to = alpha ? img.uri : img.uri.replace(/\.png$/, '.jpg');
    const args = [join(dir, img.uri), '-resize', alpha ? '256x256>' : '512x512>', '-strip'];
    if (!alpha) args.push('-alpha', 'off', '-quality', '80');
    execFileSync('convert', [...args, join(tmp, to)]);
    img.uri = to;
    if (!alpha) img.mimeType = 'image/jpeg';
  }
  writeFileSync(join(tmp, `${name}.gltf`), JSON.stringify(gltf));
  const doc = await io.read(join(tmp, `${name}.gltf`));
  await doc.transform(dedup(), prune());
  await io.write(join(out, 'props', `${name}.glb`), doc);
}
console.log('assets built in', out);
