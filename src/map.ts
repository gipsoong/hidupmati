import { MAP_SIZE as S } from './config';
import { mulberry32 } from './rng';

export type BlockKind = 'wall' | 'prop';

/** Prop models, keyed by the file name under public/assets/props. */
export type PropModel =
  | 'DeadTree_1' | 'DeadTree_3' | 'CommonTree_2' | 'Rock_Medium_1'
  | 'Grass_Wispy_Short' | 'Prop_ACUnit' | 'Prop_Planter_Single';

export interface Block {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  kind: BlockKind;
  /** Walls only: true for the town's outer wall. */
  outer?: boolean;
  model?: PropModel;
  rot?: number;
  scale?: number;
}

/** Cosmetic, non-colliding scenery. */
export interface Decor {
  model: PropModel;
  x: number;
  z: number;
  rot: number;
  scale: number;
}

export const FLOOR_GRASS = 0;
export const FLOOR_ROAD = 1;
export const FLOOR_INDOOR = 2;
export const FLOOR_SIDEWALK = 3;

/** Sidewalks sit on a raised curb. */
export const SIDEWALK_HEIGHT = 0.08;

/** Scratch output for collideCircle, avoids allocating per call. */
export const pushed = { x: 0, z: 0 };

/** Tile map: every cell is 1x1 world units, solid cells block movement and bullets. */
export class GameMap {
  readonly solid = new Uint8Array(S * S);
  readonly floor = new Uint8Array(S * S);
  readonly blocks: Block[] = [];
  readonly decor: Decor[] = [];

  constructor(seed: number) {
    this.generate(mulberry32(seed));
  }

  isSolid(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= S || cz >= S) return true;
    return this.solid[cz * S + cx] === 1;
  }

  /** Push a circle out of any solid cells it overlaps. Result goes to `pushed`. */
  collideCircle(x: number, z: number, r: number): void {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    const z0 = Math.floor(z - r), z1 = Math.floor(z + r);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.isSolid(cx, cz)) continue;
        const nx = Math.max(cx, Math.min(x, cx + 1));
        const nz = Math.max(cz, Math.min(z, cz + 1));
        const dx = x - nx, dz = z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const k = (r - d) / d;
          x += dx * k;
          z += dz * k;
        } else {
          // Centre is inside the cell: leave along the shortest axis.
          const l = x - cx, rr = cx + 1 - x, t = z - cz, b = cz + 1 - z;
          const m = Math.min(l, rr, t, b);
          if (m === l) x = cx - r;
          else if (m === rr) x = cx + 1 + r;
          else if (m === t) z = cz - r;
          else z = cz + 1 + r;
        }
      }
    }
    pushed.x = x;
    pushed.z = z;
  }

  /** Ground height for drawing feet on raised sidewalks. */
  groundHeight(x: number, z: number): number {
    const cx = x | 0, cz = z | 0;
    if (cx < 0 || cz < 0 || cx >= S || cz >= S) return 0;
    return this.floor[cz * S + cx] === FLOOR_SIDEWALK ? SIDEWALK_HEIGHT : 0;
  }

  private addBlock(x: number, z: number, w: number, d: number, h: number, extra: Partial<Block> = {}) {
    if (w <= 0 || d <= 0) return;
    this.blocks.push({ x, z, w, d, h, kind: 'wall', ...extra });
    for (let cz = z; cz < z + d; cz++) for (let cx = x; cx < x + w; cx++) this.solid[cz * S + cx] = 1;
  }

  /** True when the rectangle (plus margin) is open ground of the given floor type. */
  private areaFree(x: number, z: number, w: number, d: number, margin: number, floor: number): boolean {
    for (let cz = z - margin; cz < z + d + margin; cz++) {
      for (let cx = x - margin; cx < x + w + margin; cx++) {
        if (cx < 1 || cz < 1 || cx >= S - 1 || cz >= S - 1) return false;
        const i = cz * S + cx;
        if (this.solid[i] || this.floor[i] !== floor) return false;
      }
    }
    return true;
  }

  private generate(rnd: () => number) {
    const mid = S / 2;
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const dx = Math.abs(x + 0.5 - mid), dz = Math.abs(z + 0.5 - mid);
        const i = z * S + x;
        if (dx < 2.5 || dz < 2.5) this.floor[i] = FLOOR_ROAD;
        else if (dx < 4.5 || dz < 4.5) this.floor[i] = FLOOR_SIDEWALK;
      }
    }

    const outer = { outer: true };
    this.addBlock(0, 0, S, 1, 2.6, outer);
    this.addBlock(0, S - 1, S, 1, 2.6, outer);
    this.addBlock(0, 1, 1, S - 2, 2.6, outer);
    this.addBlock(S - 1, 1, 1, S - 2, 2.6, outer);

    let placed = 0;
    for (let i = 0; i < 300 && placed < 10; i++) {
      const w = 7 + Math.floor(rnd() * 6);
      const d = 6 + Math.floor(rnd() * 5);
      const x = 2 + Math.floor(rnd() * (S - w - 4));
      const z = 2 + Math.floor(rnd() * (S - d - 4));
      if (!this.areaFree(x, z, w, d, 2, FLOOR_GRASS)) continue;
      this.building(x, z, w, d, rnd);
      placed++;
    }

    const prop = (x: number, z: number, model: PropModel, h: number, scale = 1) =>
      this.addBlock(x, z, 1, 1, h, { kind: 'prop', model, rot: rnd() * Math.PI * 2, scale });

    // Planters line the sidewalks, away from the spawn crossroads.
    for (let i = 0, n = 0; i < 300 && n < 14; i++) {
      const x = 2 + Math.floor(rnd() * (S - 4));
      const z = 2 + Math.floor(rnd() * (S - 4));
      if (Math.abs(x - mid) < 7 && Math.abs(z - mid) < 7) continue;
      if (!this.areaFree(x, z, 1, 1, 1, FLOOR_SIDEWALK)) continue;
      prop(x, z, 'Prop_Planter_Single', 0.8);
      n++;
    }

    // Trees and rocks in the overgrown lots.
    for (let i = 0, n = 0; i < 500 && n < 34; i++) {
      const x = 2 + Math.floor(rnd() * (S - 4));
      const z = 2 + Math.floor(rnd() * (S - 4));
      if (!this.areaFree(x, z, 1, 1, 1, FLOOR_GRASS)) continue;
      const r = rnd();
      if (r < 0.45) prop(x, z, rnd() < 0.5 ? 'DeadTree_1' : 'DeadTree_3', 4, 0.55 + rnd() * 0.25);
      else if (r < 0.7) prop(x, z, 'CommonTree_2', 4, 0.5 + rnd() * 0.2);
      else prop(x, z, 'Rock_Medium_1', 0.9, 0.6 + rnd() * 0.3);
      n++;
    }

    // Loose scenery: grass tufts on open grass.
    for (let i = 0; i < 900; i++) {
      const x = 1 + rnd() * (S - 2), z = 1 + rnd() * (S - 2);
      const c = (z | 0) * S + (x | 0);
      if (this.floor[c] !== FLOOR_GRASS || this.solid[c]) continue;
      this.decor.push({ model: 'Grass_Wispy_Short', x, z, rot: rnd() * Math.PI * 2, scale: 0.5 + rnd() * 0.5 });
    }
  }

  /** Hollow building with doorways; one door always faces the town centre. */
  private building(x: number, z: number, w: number, d: number, rnd: () => number) {
    for (let cz = z; cz < z + d; cz++) for (let cx = x; cx < x + w; cx++) this.floor[cz * S + cx] = FLOOR_INDOOR;

    const mid = S / 2;
    const dx = x + w / 2 - mid, dz = z + d / 2 - mid;
    // Sides: 0 = top (z), 1 = bottom (z+d-1), 2 = left (x), 3 = right (x+w-1)
    const facing = Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 3 : 2) : dz < 0 ? 1 : 0;
    const doors = new Set([facing, Math.floor(rnd() * 4)]);
    const h = 2.0;

    const hwall = (row: number, door: boolean) => {
      if (!door) return this.addBlock(x, row, w, 1, h);
      const o = 1 + Math.floor(rnd() * (w - 4));
      this.addBlock(x, row, o, 1, h);
      this.addBlock(x + o + 2, row, w - o - 2, 1, h);
    };
    const vwall = (col: number, door: boolean) => {
      const len = d - 2;
      if (!door || len < 4) return this.addBlock(col, z + 1, 1, len, h);
      const o = 1 + Math.floor(rnd() * (len - 3));
      this.addBlock(col, z + 1, 1, o, h);
      this.addBlock(col, z + 1 + o + 2, 1, len - o - 2, h);
    };
    hwall(z, doors.has(0));
    hwall(z + d - 1, doors.has(1));
    vwall(x, doors.has(2));
    vwall(x + w - 1, doors.has(3));

    // An AC unit against a wall outside, where it doesn't block a door.
    for (let tries = 0; tries < 10; tries++) {
      const side = Math.floor(rnd() * 4);
      const along = (n: number) => 1 + Math.floor(rnd() * (n - 2));
      const [cx, cz] =
        side === 0 ? [x + along(w), z - 1] : side === 1 ? [x + along(w), z + d]
        : side === 2 ? [x - 1, z + along(d)] : [x + w, z + along(d)];
      const [wx, wz] = side === 0 ? [cx, z] : side === 1 ? [cx, z + d - 1] : side === 2 ? [x, cz] : [x + w - 1, cz];
      if (this.isSolid(cx, cz) || !this.isSolid(wx, wz)) continue;
      const rot = [Math.PI, 0, -Math.PI / 2, Math.PI / 2][side];
      this.addBlock(cx, cz, 1, 1, 1, { kind: 'prop', model: 'Prop_ACUnit', rot, scale: 0.9 });
      break;
    }
  }
}
