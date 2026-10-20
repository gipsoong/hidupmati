import { MAP_SIZE as S } from './config';
import { mulberry32 } from './rng';

export type BlockKind = 'wall' | 'crate' | 'car';

export interface Block {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  kind: BlockKind;
  color: number;
}

export const FLOOR_GRASS = 0;
export const FLOOR_ROAD = 1;
export const FLOOR_INDOOR = 2;

const WALL_COLOR = 0x9a9183;
const CRATE_COLOR = 0x8b5a2b;
const CAR_COLORS = [0x7a2a24, 0x2f4f6f, 0xb8b0a0, 0x3d3d3d, 0x5d6b3a];

/** Scratch output for collideCircle, avoids allocating per call. */
export const pushed = { x: 0, z: 0 };

/** Tile map: every cell is 1x1 world units, solid cells block movement and bullets. */
export class GameMap {
  readonly solid = new Uint8Array(S * S);
  readonly floor = new Uint8Array(S * S);
  readonly blocks: Block[] = [];

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

  private addBlock(x: number, z: number, w: number, d: number, h: number, kind: BlockKind, color: number) {
    if (w <= 0 || d <= 0) return;
    this.blocks.push({ x, z, w, d, h, kind, color });
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
        if (Math.abs(x + 0.5 - mid) < 2.5 || Math.abs(z + 0.5 - mid) < 2.5) this.floor[z * S + x] = FLOOR_ROAD;
      }
    }

    this.addBlock(0, 0, S, 1, 2.4, 'wall', WALL_COLOR);
    this.addBlock(0, S - 1, S, 1, 2.4, 'wall', WALL_COLOR);
    this.addBlock(0, 1, 1, S - 2, 2.4, 'wall', WALL_COLOR);
    this.addBlock(S - 1, 1, 1, S - 2, 2.4, 'wall', WALL_COLOR);

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

    // Cars along the roads, kept away from the spawn crossroads.
    for (let i = 0, cars = 0; i < 200 && cars < 7; i++) {
      const alongX = rnd() < 0.5;
      const w = alongX ? 4 : 2, d = alongX ? 2 : 4;
      const x = Math.floor(rnd() * (S - w));
      const z = Math.floor(rnd() * (S - d));
      if (Math.abs(x + w / 2 - mid) < 8 && Math.abs(z + d / 2 - mid) < 8) continue;
      if (!this.areaFree(x, z, w, d, 0, FLOOR_ROAD) || !this.clearAround(x, z, w, d)) continue;
      this.addBlock(x, z, w, d, 1.1, 'car', CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)]);
      cars++;
    }

    for (let i = 0, crates = 0; i < 400 && crates < 45; i++) {
      const w = rnd() < 0.3 ? 2 : 1;
      const x = 2 + Math.floor(rnd() * (S - 4));
      const z = 2 + Math.floor(rnd() * (S - 4));
      if (!this.areaFree(x, z, w, 1, 1, FLOOR_GRASS)) continue;
      this.addBlock(x, z, w, 1, 0.9, 'crate', CRATE_COLOR);
      crates++;
    }
  }

  private clearAround(x: number, z: number, w: number, d: number): boolean {
    for (let cz = z - 1; cz <= z + d; cz++)
      for (let cx = x - 1; cx <= x + w; cx++) if (this.isSolid(cx, cz)) return false;
    return true;
  }

  /** Hollow building with doorways; one door always faces the town centre. */
  private building(x: number, z: number, w: number, d: number, rnd: () => number) {
    for (let cz = z; cz < z + d; cz++) for (let cx = x; cx < x + w; cx++) this.floor[cz * S + cx] = FLOOR_INDOOR;

    const mid = S / 2;
    const dx = x + w / 2 - mid, dz = z + d / 2 - mid;
    // Sides: 0 = top (z), 1 = bottom (z+d-1), 2 = left (x), 3 = right (x+w-1)
    const facing = Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 3 : 2) : dz < 0 ? 1 : 0;
    const doors = new Set([facing, Math.floor(rnd() * 4)]);
    const h = 1.7;

    const hwall = (row: number, door: boolean) => {
      if (!door) return this.addBlock(x, row, w, 1, h, 'wall', WALL_COLOR);
      const o = 1 + Math.floor(rnd() * (w - 4));
      this.addBlock(x, row, o, 1, h, 'wall', WALL_COLOR);
      this.addBlock(x + o + 2, row, w - o - 2, 1, h, 'wall', WALL_COLOR);
    };
    const vwall = (col: number, door: boolean) => {
      const len = d - 2;
      if (!door || len < 4) return this.addBlock(col, z + 1, 1, len, h, 'wall', WALL_COLOR);
      const o = 1 + Math.floor(rnd() * (len - 3));
      this.addBlock(col, z + 1, 1, o, h, 'wall', WALL_COLOR);
      this.addBlock(col, z + 1 + o + 2, 1, len - o - 2, h, 'wall', WALL_COLOR);
    };
    hwall(z, doors.has(0));
    hwall(z + d - 1, doors.has(1));
    vwall(x, doors.has(2));
    vwall(x + w - 1, doors.has(3));

    if (rnd() < 0.6) {
      const cx = x + 2 + Math.floor(rnd() * (w - 4));
      const cz = z + 2 + Math.floor(rnd() * (d - 4));
      if (!this.isSolid(cx, cz)) this.addBlock(cx, cz, 1, 1, 0.9, 'crate', CRATE_COLOR);
    }
  }
}
