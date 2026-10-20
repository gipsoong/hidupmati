import { DECAL_CAP, PARTICLE_CAP } from './config';

const GRAVITY = -22;

/** Cosmetic particles (blood, sparks) and floor decals. No gameplay effect. */
export class Effects {
  n = 0;
  readonly px = new Float32Array(PARTICLE_CAP);
  readonly py = new Float32Array(PARTICLE_CAP);
  readonly pz = new Float32Array(PARTICLE_CAP);
  readonly vx = new Float32Array(PARTICLE_CAP);
  readonly vy = new Float32Array(PARTICLE_CAP);
  readonly vz = new Float32Array(PARTICLE_CAP);
  readonly life = new Float32Array(PARTICLE_CAP);
  readonly maxLife = new Float32Array(PARTICLE_CAP);
  readonly size = new Float32Array(PARTICLE_CAP);
  /** Packed 0xRRGGBB colour. */
  readonly color = new Uint32Array(PARTICLE_CAP);

  private readonly fields = [
    this.px, this.py, this.pz, this.vx, this.vy, this.vz,
    this.life, this.maxLife, this.size, this.color,
  ];

  /** Total decals ever written; slot is decalCount % DECAL_CAP (oldest get overwritten). */
  decalCount = 0;
  readonly decalX = new Float32Array(DECAL_CAP);
  readonly decalZ = new Float32Array(DECAL_CAP);
  readonly decalRot = new Float32Array(DECAL_CAP);
  readonly decalScale = new Float32Array(DECAL_CAP);

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number): void {
    if (this.n >= PARTICLE_CAP) return;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size;
    this.color[i] = color;
  }

  /** Spray of blood biased along the hit direction (dx, dz). */
  blood(x: number, y: number, z: number, dx: number, dz: number, count: number): void {
    for (let k = 0; k < count; k++) {
      const s = 2 + Math.random() * 4;
      const color = Math.random() < 0.5 ? 0x8a0f0f : 0x5c0808;
      this.emit(
        x, y, z,
        dx * s + (Math.random() - 0.5) * 3,
        2 + Math.random() * 4,
        dz * s + (Math.random() - 0.5) * 3,
        0.5 + Math.random() * 0.5,
        0.07 + Math.random() * 0.08,
        color,
      );
    }
  }

  sparks(x: number, z: number, dx: number, dz: number): void {
    for (let k = 0; k < 5; k++) {
      const s = 3 + Math.random() * 4;
      this.emit(x, 0.75, z, -dx * s + (Math.random() - 0.5) * 4, 1 + Math.random() * 3, -dz * s + (Math.random() - 0.5) * 4,
        0.15 + Math.random() * 0.15, 0.05, 0xffd27a);
    }
  }

  decal(x: number, z: number, scale: number): void {
    const i = this.decalCount++ % DECAL_CAP;
    this.decalX[i] = x;
    this.decalZ[i] = z;
    this.decalRot[i] = Math.random() * Math.PI * 2;
    this.decalScale[i] = scale * (0.7 + Math.random() * 0.6);
  }

  update(dt: number): void {
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.n;
        for (const f of this.fields) f[i] = f[last];
        continue;
      }
      this.vy[i] += GRAVITY * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.03) {
        this.py[i] = 0.03;
        this.vy[i] *= -0.25;
        this.vx[i] *= 0.6;
        this.vz[i] *= 0.6;
      }
    }
  }
}
