import { MAP_SIZE as S } from './config';
import type { GameMap } from './map';

export const UNREACHABLE = 0x7fffffff;

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NZ = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Breadth-first distance field from the player's cell. Every zombie reads its
 * next step from here, so pathing cost is one BFS per player cell change
 * regardless of horde size.
 */
export class FlowField {
  readonly dist = new Int32Array(S * S);
  readonly dirX = new Float32Array(S * S);
  readonly dirZ = new Float32Array(S * S);
  private readonly queue = new Int32Array(S * S);
  private origin = -1;

  constructor(private readonly map: GameMap) {}

  /** Diagonal moves only when both orthogonal neighbours are open, so zombies don't clip corners. */
  private canStep(cx: number, cz: number, k: number): boolean {
    const nx = cx + NX[k], nz = cz + NZ[k];
    if (this.map.isSolid(nx, nz)) return false;
    return k < 4 || (!this.map.isSolid(nx, cz) && !this.map.isSolid(cx, nz));
  }

  update(px: number, pz: number): void {
    const ox = Math.min(S - 1, Math.max(0, Math.floor(px)));
    const oz = Math.min(S - 1, Math.max(0, Math.floor(pz)));
    const origin = oz * S + ox;
    if (origin === this.origin) return;
    this.origin = origin;

    const { dist, dirX, dirZ, queue } = this;
    dist.fill(UNREACHABLE);
    dist[origin] = 0;
    let head = 0, tail = 0;
    queue[tail++] = origin;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % S, cz = (c / S) | 0;
      const nd = dist[c] + 1;
      for (let k = 0; k < 8; k++) {
        if (!this.canStep(cx, cz, k)) continue;
        const n = (cz + NZ[k]) * S + cx + NX[k];
        if (dist[n] !== UNREACHABLE) continue;
        dist[n] = nd;
        queue[tail++] = n;
      }
    }

    dirX.fill(0);
    dirZ.fill(0);
    for (let q = 1; q < tail; q++) {
      const c = queue[q];
      const cx = c % S, cz = (c / S) | 0;
      let best = dist[c], bk = -1;
      for (let k = 0; k < 8; k++) {
        if (!this.canStep(cx, cz, k)) continue;
        const nd = dist[(cz + NZ[k]) * S + cx + NX[k]];
        if (nd < best) { best = nd; bk = k; }
      }
      if (bk < 0) continue;
      const inv = bk < 4 ? 1 : Math.SQRT1_2;
      dirX[c] = NX[bk] * inv;
      dirZ[c] = NZ[bk] * inv;
    }
  }
}
