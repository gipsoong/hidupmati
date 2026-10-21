import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { PropModel } from './map';

const PROPS: PropModel[] = [
  'DeadTree_1', 'DeadTree_3', 'CommonTree_2', 'Rock_Medium_1',
  'Grass_Wispy_Short', 'Prop_ACUnit', 'Prop_Planter_Single',
];

const TEXTURES = [
  'brick', 'brick_n', 'concrete', 'concrete_n', 'asphalt', 'marble', 'dirt', 'dirt_n', 'decals',
] as const;
export type TextureName = (typeof TEXTURES)[number];

export interface Assets {
  player: GLTF;
  zombie: GLTF;
  props: Record<PropModel, THREE.Group>;
  textures: Record<TextureName, THREE.Texture>;
}

const base = './assets/';
/** Models ship as .glb; the Artifact build wraps them as base64 in .json (see tools/package-artifact.mjs). */
const MODEL = '.' + (import.meta.env.VITE_MODEL_EXT ?? 'glb');

/** Load everything the game draws. `onProgress` gets 0..1. */
const loader = new GLTFLoader();
// Embedded textures default to ImageBitmapLoader, which fetch()es a blob: URL; hosts whose CSP
// blocks that would stall loading. <img>-based loading is governed by img-src instead.
loader.register((parser) => {
  (parser as unknown as { textureLoader: THREE.Loader }).textureLoader = new THREE.TextureLoader(parser.options.manager);
  return { name: 'HM_img_textures' };
});
async function loadModel(url: string): Promise<GLTF> {
  if (MODEL !== '.json') return loader.loadAsync(url);
  const { glb } = (await (await fetch(url)).json()) as { glb: string };
  const bin = Uint8Array.from(atob(glb), (c) => c.charCodeAt(0));
  return loader.parseAsync(bin.buffer, url.slice(0, url.lastIndexOf('/') + 1));
}

export async function loadAssets(onProgress: (f: number) => void): Promise<Assets> {
  const texLoader = new THREE.TextureLoader();
  const total = 2 + PROPS.length + TEXTURES.length;
  let done = 0;
  const tick = <T>(p: Promise<T>) => p.then((v) => { onProgress(++done / total); return v; });

  const [player, zombie, props, textures] = await Promise.all([
    tick(loadModel(base + 'player' + MODEL)),
    tick(loadModel(base + 'zombie' + MODEL)),
    Promise.all(PROPS.map((p) => tick(loadModel(`${base}props/${p}${MODEL}`)))),
    Promise.all(TEXTURES.map((t) => tick(texLoader.loadAsync(base + t + (t === 'decals' ? '.png' : '.jpg'))))),
  ]);

  const texMap = {} as Record<TextureName, THREE.Texture>;
  TEXTURES.forEach((name, i) => {
    const t = textures[i];
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (!name.endsWith('_n')) t.colorSpace = THREE.SRGBColorSpace;
    texMap[name] = t;
  });
  const propMap = {} as Record<PropModel, THREE.Group>;
  PROPS.forEach((name, i) => { propMap[name] = props[i].scene; });
  return { player, zombie, props: propMap, textures: texMap };
}
