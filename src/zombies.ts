import { ZOMBIE_CAP } from './config';

/** Struct-of-arrays horde storage; live zombies are packed in [0, n). */
export class Zombies {
  n = 0;
  readonly x = new Float32Array(ZOMBIE_CAP);
  readonly z = new Float32Array(ZOMBIE_CAP);
  readonly vx = new Float32Array(ZOMBIE_CAP);
  readonly vz = new Float32Array(ZOMBIE_CAP);
  readonly hp = new Float32Array(ZOMBIE_CAP);
  readonly speed = new Float32Array(ZOMBIE_CAP);
  readonly angle = new Float32Array(ZOMBIE_CAP);
  readonly phase = new Float32Array(ZOMBIE_CAP);
  /** 0..1 while climbing out of the ground; zombies can't act until 1. */
  readonly rise = new Float32Array(ZOMBIE_CAP);
  readonly flash = new Float32Array(ZOMBIE_CAP);
  readonly attackCd = new Float32Array(ZOMBIE_CAP);
  readonly tint = new Float32Array(ZOMBIE_CAP);

  private readonly fields = [
    this.x, this.z, this.vx, this.vz, this.hp, this.speed, this.angle,
    this.phase, this.rise, this.flash, this.attackCd, this.tint,
  ];

  spawn(x: number, z: number, hp: number, speed: number): void {
    if (this.n >= ZOMBIE_CAP) return;
    const i = this.n++;
    for (const f of this.fields) f[i] = 0;
    this.x[i] = x;
    this.z[i] = z;
    this.hp[i] = hp;
    this.speed[i] = speed;
    this.angle[i] = Math.random() * Math.PI * 2;
    this.phase[i] = Math.random() * 10;
    this.attackCd[i] = 0.5;
    this.tint[i] = 0.75 + Math.random() * 0.35;
  }

  /** Swap-remove; callers iterating should walk indices downwards. */
  remove(i: number): void {
    const last = --this.n;
    if (i === last) return;
    for (const f of this.fields) f[i] = f[last];
  }
}
