import { Bullets } from './bullets';
import {
  BULLET_SPEED, MAP_SIZE as S, MAX_ALIVE, PLAYER_MAX_HP, PLAYER_RADIUS, PLAYER_SPEED, ZOMBIE_RADIUS,
} from './config';
import { Effects } from './effects';
import { FlowField, UNREACHABLE } from './flow';
import { SpatialGrid } from './grid';
import { GameMap, pushed } from './map';
import { Player } from './player';
import { Zombies } from './zombies';

/** Per-frame player intent, already converted to world space. */
export interface Controls {
  moveX: number;
  moveZ: number;
  aimX: number;
  aimZ: number;
  firing: boolean;
}

const HIT_RADIUS = 0.42;
const SEPARATION = ZOMBIE_RADIUS * 2;
const ATTACK_RANGE = ZOMBIE_RADIUS + PLAYER_RADIUS + 0.25;
const ZOMBIE_DAMAGE = 10;
const PISTOL_DAMAGE = 25;
const PISTOL_COOLDOWN = 0.15;

export class Game {
  readonly map: GameMap;
  readonly flow: FlowField;
  readonly zombies = new Zombies();
  readonly grid = new SpatialGrid();
  readonly bullets = new Bullets();
  readonly fx = new Effects();
  readonly player: Player;

  time = 0;
  kills = 0;
  wave = 0;
  fighting = false;
  over = false;
  /** Camera shake strength, decays every tick. */
  shake = 0;
  /** Seconds left on the muzzle flash. */
  muzzle = 0;

  /** Banner text for the HUD; bannerSeq changes whenever a new one is posted. */
  bannerTitle = '';
  bannerSub = '';
  bannerSeq = 0;

  private breakTimer = 3;
  private toSpawn = 0;
  private spawnTimer = 0;
  private spawnInterval = 1;
  private waveHp = 0;
  private waveSpeed = 0;

  constructor(seed: number) {
    this.map = new GameMap(seed);
    this.flow = new FlowField(this.map);
    this.player = new Player(S / 2, S / 2);
    this.announce('Get ready', 'The first wave is coming');
  }

  get zombiesLeft(): number {
    return this.toSpawn + this.zombies.n;
  }

  update(dt: number, c: Controls): void {
    if (this.over) return;
    this.time += dt;
    this.updatePlayer(dt, c);
    this.flow.update(this.player.x, this.player.z);
    this.updateWaves(dt);
    this.grid.build(this.zombies.x, this.zombies.z, this.zombies.n);
    this.updateZombies(dt);
    this.updateBullets(dt);
    this.removeDead();
    this.fx.update(dt);
    this.shake *= Math.exp(-10 * dt);
    this.muzzle = Math.max(0, this.muzzle - dt);
  }

  private announce(title: string, sub: string) {
    this.bannerTitle = title;
    this.bannerSub = sub;
    this.bannerSeq++;
  }

  private updatePlayer(dt: number, c: Controls) {
    const p = this.player;
    let mx = c.moveX, mz = c.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const k = 1 - Math.exp(-14 * dt);
    p.vx += (mx * PLAYER_SPEED - p.vx) * k;
    p.vz += (mz * PLAYER_SPEED - p.vz) * k;
    this.map.collideCircle(p.x + p.vx * dt, p.z + p.vz * dt, PLAYER_RADIUS);
    p.x = pushed.x;
    p.z = pushed.z;

    p.angle = Math.atan2(c.aimX - p.x, c.aimZ - p.z);
    p.fireCd -= dt;
    p.hurt = Math.max(0, p.hurt - dt);
    if (c.firing && p.fireCd <= 0) this.fire();
  }

  private fire() {
    const p = this.player;
    const a = p.angle + (Math.random() - 0.5) * 0.06;
    const dx = Math.sin(a), dz = Math.cos(a);
    this.bullets.spawn(p.x + dx * 0.8, p.z + dz * 0.8, dx * BULLET_SPEED, dz * BULLET_SPEED, PISTOL_DAMAGE, 0.9);
    p.fireCd = PISTOL_COOLDOWN;
    this.muzzle = 0.05;
    this.shake = Math.max(this.shake, 0.06);
  }

  private updateWaves(dt: number) {
    if (!this.fighting) {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) this.startWave();
      return;
    }
    if (this.toSpawn > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.zombies.n < MAX_ALIVE) {
        this.spawnTimer = this.spawnInterval;
        const group = Math.min(this.toSpawn, 1 + Math.floor(Math.random() * 3));
        this.toSpawn -= this.spawnGroup(group);
      }
    } else if (this.zombies.n === 0) {
      this.fighting = false;
      this.breakTimer = 7;
      this.player.hp = Math.min(PLAYER_MAX_HP, this.player.hp + 15);
      this.announce(`Wave ${this.wave} cleared`, '+15 health. Next wave incoming');
    }
  }

  private startWave() {
    const w = ++this.wave;
    this.fighting = true;
    this.toSpawn = Math.round(8 + w * 6 + w * w * 0.6);
    this.spawnInterval = Math.max(0.08, 0.9 - w * 0.06);
    this.spawnTimer = 0;
    this.waveHp = 50 * (1 + 0.15 * (w - 1));
    this.waveSpeed = 1.9 + Math.min(1.5, w * 0.1);
    this.announce(`Wave ${w}`, `${this.toSpawn} zombies`);
  }

  /** Spawn up to `count` zombies on one reachable cell away from the player. Returns how many spawned. */
  private spawnGroup(count: number): number {
    const p = this.player;
    for (let tries = 0; tries < 40; tries++) {
      const cx = 1 + Math.floor(Math.random() * (S - 2));
      const cz = 1 + Math.floor(Math.random() * (S - 2));
      if (this.flow.dist[cz * S + cx] === UNREACHABLE) continue;
      if (Math.hypot(cx + 0.5 - p.x, cz + 0.5 - p.z) < 20) continue;
      for (let k = 0; k < count; k++) {
        const runner = Math.random() < Math.min(0.25, 0.04 * this.wave);
        const speed = this.waveSpeed * (0.8 + Math.random() * 0.4) * (runner ? 1.6 : 1);
        this.zombies.spawn(cx + 0.2 + Math.random() * 0.6, cz + 0.2 + Math.random() * 0.6, this.waveHp, speed);
      }
      return count;
    }
    return 0;
  }

  private updateZombies(dt: number) {
    const zs = this.zombies, p = this.player, flow = this.flow, grid = this.grid;
    const turn = 1 - Math.exp(-6 * dt);
    for (let i = 0; i < zs.n; i++) {
      zs.flash[i] = Math.max(0, zs.flash[i] - dt);
      if (zs.rise[i] < 1) {
        zs.rise[i] = Math.min(1, zs.rise[i] + dt / 0.9);
        continue;
      }
      let x = zs.x[i], z = zs.z[i];
      const dx = p.x - x, dz = p.z - z;
      const d = Math.hypot(dx, dz) || 1e-6;

      // Close by: lunge straight at the player. Otherwise follow the flow field.
      let tx = dx / d, tz = dz / d;
      if (d > 2.5) {
        const c = SpatialGrid.cell(x, z);
        if (flow.dirX[c] !== 0 || flow.dirZ[c] !== 0) { tx = flow.dirX[c]; tz = flow.dirZ[c]; }
      }
      const sp = zs.speed[i];
      zs.vx[i] += (tx * sp - zs.vx[i]) * turn;
      zs.vz[i] += (tz * sp - zs.vz[i]) * turn;
      x += zs.vx[i] * dt;
      z += zs.vz[i] * dt;

      // Separation from neighbours in the surrounding 3x3 cells.
      const gx = x | 0, gz = z | 0;
      for (let cz = gz - 1; cz <= gz + 1; cz++) {
        if (cz < 0 || cz >= S) continue;
        for (let cx = gx - 1; cx <= gx + 1; cx++) {
          if (cx < 0 || cx >= S) continue;
          const c = cz * S + cx;
          for (let q = grid.start[c], end = grid.start[c + 1]; q < end; q++) {
            const j = grid.items[q];
            if (j === i) continue;
            const ox = x - zs.x[j], oz = z - zs.z[j];
            const d2 = ox * ox + oz * oz;
            if (d2 >= SEPARATION * SEPARATION || d2 < 1e-8) continue;
            const dd = Math.sqrt(d2);
            const push = ((SEPARATION - dd) / dd) * 0.5;
            x += ox * push;
            z += oz * push;
          }
        }
      }

      // Body contact with the player: zombies give way most, but a crowd still shoves you.
      const px = x - p.x, pz = z - p.z;
      const pd = Math.hypot(px, pz);
      const minD = ZOMBIE_RADIUS + PLAYER_RADIUS;
      if (pd < minD && pd > 1e-6) {
        const o = (minD - pd) / pd;
        x += px * o * 0.85;
        z += pz * o * 0.85;
        p.x -= px * o * 0.15;
        p.z -= pz * o * 0.15;
      }
      zs.attackCd[i] -= dt;
      if (pd < ATTACK_RANGE && zs.attackCd[i] <= 0) {
        zs.attackCd[i] = 1;
        this.hurtPlayer(ZOMBIE_DAMAGE, -px / (pd || 1), -pz / (pd || 1));
      }

      this.map.collideCircle(x, z, ZOMBIE_RADIUS);
      zs.x[i] = pushed.x;
      zs.z[i] = pushed.z;

      const want = d < 2.5 ? Math.atan2(dx, dz) : Math.atan2(zs.vx[i], zs.vz[i]);
      let da = want - zs.angle[i];
      da = Math.atan2(Math.sin(da), Math.cos(da));
      zs.angle[i] += da * turn * 1.5;
      zs.phase[i] += dt * sp * 4.5;
    }
    // Zombies may have shoved the player into a wall.
    this.map.collideCircle(p.x, p.z, PLAYER_RADIUS);
    p.x = pushed.x;
    p.z = pushed.z;
  }

  private hurtPlayer(dmg: number, dx: number, dz: number) {
    const p = this.player;
    p.hp -= dmg;
    p.hurt = 0.3;
    this.shake = Math.max(this.shake, 0.35);
    this.fx.blood(p.x, 1, p.z, dx, dz, 8);
    if (p.hp <= 0) {
      p.hp = 0;
      this.over = true;
    }
  }

  private updateBullets(dt: number) {
    const b = this.bullets, zs = this.zombies, grid = this.grid;
    const STEPS = 3;
    for (let i = b.n - 1; i >= 0; i--) {
      b.life[i] -= dt;
      if (b.life[i] <= 0) { b.remove(i); continue; }
      const sx = (b.vx[i] * dt) / STEPS, sz = (b.vz[i] * dt) / STEPS;
      const dirX = b.vx[i] / BULLET_SPEED, dirZ = b.vz[i] / BULLET_SPEED;
      let x = b.x[i], z = b.z[i];
      let dead = false;
      for (let s = 0; s < STEPS && !dead; s++) {
        x += sx;
        z += sz;
        if (this.map.isSolid(Math.floor(x), Math.floor(z))) {
          this.fx.sparks(x, z, dirX, dirZ);
          dead = true;
          break;
        }
        const gx = x | 0, gz = z | 0;
        for (let cz = gz - 1; cz <= gz + 1 && !dead; cz++) {
          if (cz < 0 || cz >= S) continue;
          for (let cx = gx - 1; cx <= gx + 1 && !dead; cx++) {
            if (cx < 0 || cx >= S) continue;
            const c = cz * S + cx;
            for (let q = grid.start[c], end = grid.start[c + 1]; q < end; q++) {
              const j = grid.items[q];
              if (zs.hp[j] <= 0 || zs.rise[j] < 0.6) continue;
              const ox = zs.x[j] - x, oz = zs.z[j] - z;
              if (ox * ox + oz * oz > HIT_RADIUS * HIT_RADIUS) continue;
              this.damageZombie(j, b.damage[i], dirX, dirZ);
              dead = true;
              break;
            }
          }
        }
      }
      if (dead) { b.remove(i); continue; }
      b.x[i] = x;
      b.z[i] = z;
    }
  }

  private damageZombie(j: number, dmg: number, dx: number, dz: number) {
    const zs = this.zombies;
    zs.hp[j] -= dmg;
    zs.flash[j] = 0.08;
    zs.vx[j] += dx * 2.5;
    zs.vz[j] += dz * 2.5;
    this.fx.blood(zs.x[j], 1, zs.z[j], dx, dz, 5);
    if (zs.hp[j] <= 0) {
      this.kills++;
      this.fx.blood(zs.x[j], 0.8, zs.z[j], dx, dz, 16);
      this.fx.decal(zs.x[j] + dx * 0.4, zs.z[j] + dz * 0.4, 1);
      this.shake = Math.max(this.shake, 0.12);
    }
  }

  private removeDead() {
    const zs = this.zombies;
    for (let i = zs.n - 1; i >= 0; i--) if (zs.hp[i] <= 0) zs.remove(i);
  }
}
