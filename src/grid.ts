import { MAP_SIZE as S, ZOMBIE_CAP } from './config';

/** Uniform spatial hash (1 unit cells), rebuilt each tick with a counting sort. */
export class SpatialGrid {
  /** items[start[c] .. start[c+1]) are the entity indices in cell c. */
  readonly start = new Int32Array(S * S + 1);
  readonly items = new Int32Array(ZOMBIE_CAP);
  private readonly cellOf = new Int32Array(ZOMBIE_CAP);
  private readonly cursor = new Int32Array(S * S);

  static cell(x: number, z: number): number {
    const cx = Math.min(S - 1, Math.max(0, x | 0));
    const cz = Math.min(S - 1, Math.max(0, z | 0));
    return cz * S + cx;
  }

  build(xs: Float32Array, zs: Float32Array, n: number): void {
    const { start, items, cellOf, cursor } = this;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const c = SpatialGrid.cell(xs[i], zs[i]);
      cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < S * S; c++) start[c + 1] += start[c];
    cursor.set(start.subarray(0, S * S));
    for (let i = 0; i < n; i++) items[cursor[cellOf[i]]++] = i;
  }
}
