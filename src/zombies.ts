import { KIND_RUNNER, ZOMBIE_CAP } from './config';

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
  /** Distance walked; drives the walk cycle. */
  readonly phase = new Float32Array(ZOMBIE_CAP);
  /** 0..1 while climbing out of the ground; zombies can't act until 1. */
  readonly rise = new Float32Array(ZOMBIE_CAP);
  readonly flash = new Float32Array(ZOMBIE_CAP);
  readonly attackCd = new Float32Array(ZOMBIE_CAP);
  readonly tint = new Float32Array(ZOMBIE_CAP);
  readonly runner = new Uint8Array(ZOMBIE_CAP);
  /** KIND_WALKER, KIND_RUNNER or KIND_BRUTE. */
  readonly kind = new Uint8Array(ZOMBIE_CAP);
  /** Barricade cell the current swing is aimed at, or -1. */
  readonly bash = new Int32Array(ZOMBIE_CAP);
  /** Seconds since the current attack started, or -1. */
  readonly atkT = new Float32Array(ZOMBIE_CAP);
  /** Seconds since the last bullet hit, or -1. */
  readonly hitT = new Float32Array(ZOMBIE_CAP);
  /** Render-only animation state; lives here so it moves with swap-removes. */
  readonly animClip = new Int8Array(ZOMBIE_CAP);
  readonly animTime = new Float32Array(ZOMBIE_CAP);
  readonly animPrevRow = new Float32Array(ZOMBIE_CAP);
  readonly animFade = new Float32Array(ZOMBIE_CAP);

  private readonly fields = [
    this.x, this.z, this.vx, this.vz, this.hp, this.speed, this.angle,
    this.phase, this.rise, this.flash, this.attackCd, this.tint, this.runner, this.kind, this.bash,
    this.atkT, this.hitT, this.animClip, this.animTime, this.animPrevRow, this.animFade,
  ];

  spawn(x: number, z: number, hp: number, speed: number, kind: number): void {
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
    this.tint[i] = 0.8 + Math.random() * 0.3;
    this.kind[i] = kind;
    this.runner[i] = kind === KIND_RUNNER ? 1 : 0;
    this.bash[i] = -1;
    this.atkT[i] = -1;
    this.hitT[i] = -1;
    this.animClip[i] = -1;
  }

  /** Swap-remove; callers iterating should walk indices downwards. */
  remove(i: number): void {
    const last = --this.n;
    if (i === last) return;
    for (const f of this.fields) f[i] = f[last];
  }
}

const CORPSE_CAP = 200;

/** Dead zombies lying around; the oldest is dropped when full. */
export class Corpses {
  n = 0;
  readonly x = new Float32Array(CORPSE_CAP);
  readonly z = new Float32Array(CORPSE_CAP);
  readonly angle = new Float32Array(CORPSE_CAP);
  readonly tint = new Float32Array(CORPSE_CAP);
  readonly kind = new Uint8Array(CORPSE_CAP);
  /** Seconds since death. */
  readonly t = new Float32Array(CORPSE_CAP);

  add(x: number, z: number, angle: number, tint: number, kind: number): void {
    if (this.n >= CORPSE_CAP) this.remove(0);
    const i = this.n++;
    this.x[i] = x;
    this.z[i] = z;
    this.angle[i] = angle;
    this.tint[i] = tint;
    this.kind[i] = kind;
    this.t[i] = 0;
  }

  update(dt: number, life: number): void {
    for (let i = this.n - 1; i >= 0; i--) {
      this.t[i] += dt;
      if (this.t[i] > life) this.remove(i);
    }
  }

  private remove(i: number): void {
    const last = --this.n;
    this.x[i] = this.x[last];
    this.z[i] = this.z[last];
    this.angle[i] = this.angle[last];
    this.tint[i] = this.tint[last];
    this.kind[i] = this.kind[last];
    this.t[i] = this.t[last];
  }
}
