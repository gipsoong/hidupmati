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
/** Models ship as .glb; the Artifact build repackages them as glTF JSON (see tools/package-artifact.mjs). */
const MODEL = '.' + (import.meta.env.VITE_MODEL_EXT ?? 'glb');

/** Load everything the game draws. `onProgress` gets 0..1. */
export async function loadAssets(onProgress: (f: number) => void): Promise<Assets> {
  const gltf = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();
  const total = 2 + PROPS.length + TEXTURES.length;
  let done = 0;
  const tick = <T>(p: Promise<T>) => p.then((v) => { onProgress(++done / total); return v; });

  const [player, zombie, props, textures] = await Promise.all([
    tick(gltf.loadAsync(base + 'player' + MODEL)),
    tick(gltf.loadAsync(base + 'zombie' + MODEL)),
    Promise.all(PROPS.map((p) => tick(gltf.loadAsync(`${base}props/${p}${MODEL}`)))),
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
