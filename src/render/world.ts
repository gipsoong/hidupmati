import * as THREE from 'three';
import type { Assets } from '../assets';
import { MAP_SIZE as S } from '../config';
import {
  FLOOR_GRASS, FLOOR_INDOOR, FLOOR_ROAD, FLOOR_SIDEWALK, SIDEWALK_HEIGHT, type GameMap, type PropModel,
} from '../map';

/** Texture repeat lengths in metres. */
const TILE = { asphalt: 6, concrete: 2.5, dirt: 5, marble: 3, brick: 2 };
const CAP_HEIGHT = 0.12;

/** How a prop model is sized: to fill its 1x1 cell, or relative to its own size. */
const FOOTPRINT: Partial<Record<PropModel, number>> = {
  Prop_ACUnit: 0.9, Prop_Planter_Single: 0.95, Rock_Medium_1: 0.95,
};

/** Smooth value noise for ground colour variation. */
function noise(x: number, z: number): number {
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(h(i, j), h(i + 1, j), u),
    THREE.MathUtils.lerp(h(i, j + 1), h(i + 1, j + 1), u), v);
}

/** Accumulates quads into one indexed geometry. */
class QuadBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  /** Corners in order a, b, c, d (counter-clockwise seen from the front). */
  quad(p: number[][], n: number[], uv: number[][], colors?: number[][]) {
    const base = this.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      this.pos.push(...p[k]);
      this.nor.push(...n);
      this.uv.push(...uv[k]);
      this.col.push(...(colors ? colors[k] : [1, 1, 1]));
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Axis-aligned box with world-scaled UVs (top face optional). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tile: number, top = true) {
    const t = (a: number) => a / tile;
    // +x, -x, +z, -z faces; u runs along the face, v up.
    this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0],
      [[t(z1), t(y0)], [t(z0), t(y0)], [t(z0), t(y1)], [t(z1), t(y1)]]);
    this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0],
      [[t(z0), t(y0)], [t(z1), t(y0)], [t(z1), t(y1)], [t(z0), t(y1)]]);
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1],
      [[t(x0), t(y0)], [t(x1), t(y0)], [t(x1), t(y1)], [t(x0), t(y1)]]);
    this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1],
      [[t(x1), t(y0)], [t(x0), t(y0)], [t(x0), t(y1)], [t(x1), t(y1)]]);
    if (top) {
      this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0],
        [[t(x0), t(z1)], [t(x1), t(z1)], [t(x1), t(z0)], [t(x0), t(z0)]]);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/** Builds every static mesh of a map. */
export function buildWorld(map: GameMap, assets: Assets): THREE.Group {
  const group = new THREE.Group();
  const T = assets.textures;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = cast;
    group.add(m);
    return m;
  };

  // Ground, one quad per cell, grouped by surface.
  const grass = new QuadBuilder(), road = new QuadBuilder(), walk = new QuadBuilder(), indoor = new QuadBuilder();
  const grassCol = (x: number, z: number) => {
    const n = noise(x * 0.18, z * 0.18) * 0.7 + noise(x * 0.6, z * 0.6) * 0.3;
    // Multiplies the brown dirt texture: green where the grass is thick, bare earth elsewhere.
    const g = new THREE.Color(0x9fd06a).lerp(new THREE.Color(0xd8c49a), n).multiplyScalar(1.45);
    return [g.r, g.g, g.b];
  };
  const up = [0, 1, 0];
  const floorAt = (x: number, z: number) => (x < 0 || z < 0 || x >= S || z >= S ? -1 : map.floor[z * S + x]);
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const f = map.floor[z * S + x];
      const y = f === FLOOR_SIDEWALK ? SIDEWALK_HEIGHT : 0;
      const p = [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z], [x, y, z]];
      const uvFor = (tile: number) => p.map((q) => [q[0] / tile, -q[2] / tile]);
      if (f === FLOOR_GRASS) {
        grass.quad(p, up, uvFor(TILE.dirt), p.map((q) => grassCol(q[0], q[2])));
      } else if (f === FLOOR_ROAD) {
        road.quad(p, up, uvFor(TILE.asphalt));
      } else if (f === FLOOR_INDOOR) {
        const v = 0.85 + noise(x * 0.5, z * 0.5) * 0.15;
        indoor.quad(p, up, uvFor(TILE.marble), p.map(() => [v, v * 0.97, v * 0.92]));
      } else {
        walk.quad(p, up, uvFor(TILE.concrete));
        // Curb faces where the sidewalk drops to a lower surface.
        const h = SIDEWALK_HEIGHT, t = TILE.concrete;
        if (floorAt(x + 1, z) !== FLOOR_SIDEWALK) walk.quad([[x + 1, 0, z + 1], [x + 1, 0, z], [x + 1, h, z], [x + 1, h, z + 1]], [1, 0, 0], [[0, 0], [1 / t, 0], [1 / t, h / t], [0, h / t]]);
        if (floorAt(x - 1, z) !== FLOOR_SIDEWALK) walk.quad([[x, 0, z], [x, 0, z + 1], [x, h, z + 1], [x, h, z]], [-1, 0, 0], [[0, 0], [1 / t, 0], [1 / t, h / t], [0, h / t]]);
        if (floorAt(x, z + 1) !== FLOOR_SIDEWALK) walk.quad([[x, 0, z + 1], [x + 1, 0, z + 1], [x + 1, h, z + 1], [x, h, z + 1]], [0, 0, 1], [[0, 0], [1 / t, 0], [1 / t, h / t], [0, h / t]]);
        if (floorAt(x, z - 1) !== FLOOR_SIDEWALK) walk.quad([[x + 1, 0, z], [x, 0, z], [x, h, z], [x + 1, h, z]], [0, 0, -1], [[0, 0], [1 / t, 0], [1 / t, h / t], [0, h / t]]);
      }
    }
  }
  add(grass.build(), new THREE.MeshStandardMaterial({ map: T.dirt, normalMap: T.dirt_n, vertexColors: true, roughness: 1 }));
  add(road.build(), new THREE.MeshStandardMaterial({ map: T.asphalt, roughness: 0.95, color: 0xb0b0b0 }));
  add(walk.build(), new THREE.MeshStandardMaterial({ map: T.concrete, normalMap: T.concrete_n, roughness: 0.9, color: 0xd8d4cc }));
  add(indoor.build(), new THREE.MeshStandardMaterial({ map: T.marble, vertexColors: true, roughness: 0.6 }));

  group.add(roadMarkings(T.decals));

  // Walls in brick with a concrete cap.
  const walls = new QuadBuilder(), caps = new QuadBuilder();
  for (const b of map.blocks) {
    if (b.kind !== 'wall') continue;
    walls.box(b.x, 0, b.z, b.x + b.w, b.h, b.z + b.d, TILE.brick, false);
    const e = 0.06;
    caps.box(b.x - e, b.h, b.z - e, b.x + b.w + e, b.h + CAP_HEIGHT, b.z + b.d + e, TILE.concrete);
  }
  add(walls.build(), new THREE.MeshStandardMaterial({ map: T.brick, normalMap: T.brick_n, roughness: 0.9 }), true);
  add(caps.build(), new THREE.MeshStandardMaterial({ map: T.concrete, roughness: 0.85, color: 0xcfc8bc }), true);

  // Props and scenery, one InstancedMesh per model part.
  const placements = new Map<PropModel, THREE.Matrix4[]>();
  const place = (model: PropModel, x: number, z: number, rot: number, scale: number, y = 0) => {
    const src = assets.props[model];
    let s = scale;
    const fp = FOOTPRINT[model];
    if (fp) {
      const size = new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3());
      s = (fp / Math.max(size.x, size.z)) * scale;
    }
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(s, s, s));
    if (!placements.has(model)) placements.set(model, []);
    placements.get(model)!.push(m);
  };
  for (const b of map.blocks) {
    if (b.kind === 'prop' && b.model) place(b.model, b.x + 0.5, b.z + 0.5, b.rot ?? 0, b.scale ?? 1, map.groundHeight(b.x, b.z));
  }
  for (const d of map.decor) place(d.model, d.x, d.z, d.rot, d.scale);

  for (const [model, mats] of placements) {
    const src = assets.props[model];
    src.updateMatrixWorld(true);
    const small = model === 'Grass_Wispy_Short';
    src.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length);
      const tmp = new THREE.Matrix4();
      mats.forEach((m, i) => inst.setMatrixAt(i, tmp.multiplyMatrices(m, mesh.matrixWorld)));
      inst.castShadow = !small;
      inst.receiveShadow = true;
      group.add(inst);
    });
  }
  return group;
}

/** Crosswalks around the central intersection and a double yellow centre line. */
function roadMarkings(decals: THREE.Texture): THREE.Mesh {
  const q = new QuadBuilder();
  const mid = S / 2;
  const y = 0.012;
  // Crosswalk stripes occupy the top band of the decal sheet; the double yellow line sits under it.
  const cw = { u0: 0, u1: 1, v0: 0.585, v1: 0.92 };
  const line = { u0: 0.02, u1: 0.98, v0: 0.505, v1: 0.53 };
  const half = 2.5, depth = 2.2, gap = 0.6;
  // North / south arms run along z, so the stripes' length runs along z.
  for (const sgn of [-1, 1]) {
    const z0 = mid + sgn * (half + gap), z1 = mid + sgn * (half + gap + depth);
    const [za, zb] = sgn < 0 ? [z1, z0] : [z0, z1];
    q.quad([[mid - half, y, zb], [mid + half, y, zb], [mid + half, y, za], [mid - half, y, za]], [0, 1, 0],
      [[cw.u0, cw.v0], [cw.u1, cw.v0], [cw.u1, cw.v1], [cw.u0, cw.v1]]);
    const x0 = mid + sgn * (half + gap), x1 = mid + sgn * (half + gap + depth);
    const [xa, xb] = sgn < 0 ? [x1, x0] : [x0, x1];
    // East / west arms: rotate the UVs so the stripes run along x.
    q.quad([[xa, y, mid + half], [xb, y, mid + half], [xb, y, mid - half], [xa, y, mid - half]], [0, 1, 0],
      [[cw.u0, cw.v0], [cw.u0, cw.v1], [cw.u1, cw.v1], [cw.u1, cw.v0]]);
  }
  // Centre lines from the crosswalks to the town wall, in 4 m pieces.
  const w = 0.16;
  for (let t = half + gap + depth + 0.5; t < mid - 1.5; t += 4) {
    for (const sgn of [-1, 1]) {
      const a = mid + sgn * t, b = mid + sgn * Math.min(t + 4, mid - 1.5);
      const [z0, z1] = sgn < 0 ? [b, a] : [a, b];
      q.quad([[mid - w, y, z1], [mid + w, y, z1], [mid + w, y, z0], [mid - w, y, z0]], [0, 1, 0],
        [[line.u0, line.v0], [line.u0, line.v1], [line.u1, line.v1], [line.u1, line.v0]]);
      const [x0, x1] = sgn < 0 ? [b, a] : [a, b];
      q.quad([[x0, y, mid + w], [x1, y, mid + w], [x1, y, mid - w], [x0, y, mid - w]], [0, 1, 0],
        [[line.u0, line.v1], [line.u1, line.v1], [line.u1, line.v0], [line.u0, line.v0]]);
    }
  }
  const mat = new THREE.MeshStandardMaterial({
    map: decals, transparent: true, depthWrite: false, roughness: 0.9,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const m = new THREE.Mesh(q.build(), mat);
  m.receiveShadow = true;
  return m;
}
