import { BULLET_CAP } from './config';

export class Bullets {
  n = 0;
  readonly x = new Float32Array(BULLET_CAP);
  readonly z = new Float32Array(BULLET_CAP);
  readonly vx = new Float32Array(BULLET_CAP);
  readonly vz = new Float32Array(BULLET_CAP);
  readonly life = new Float32Array(BULLET_CAP);
  readonly damage = new Float32Array(BULLET_CAP);

  spawn(x: number, z: number, vx: number, vz: number, damage: number, life: number): void {
    if (this.n >= BULLET_CAP) return;
    const i = this.n++;
    this.x[i] = x;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vz[i] = vz;
    this.damage[i] = damage;
    this.life[i] = life;
  }

  remove(i: number): void {
    const last = --this.n;
    this.x[i] = this.x[last];
    this.z[i] = this.z[last];
    this.vx[i] = this.vx[last];
    this.vz[i] = this.vz[last];
    this.damage[i] = this.damage[last];
    this.life[i] = this.life[last];
  }
}
