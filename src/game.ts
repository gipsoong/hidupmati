import { Bullets } from './bullets';
import {
  ATTACK_HIT_AT, ATTACK_TIME, BARRICADE_CAP, BARRICADE_HP, BULLET_SPEED, CORPSE_LIFE, KIND_BRUTE, KIND_DAMAGE, KIND_KNOCK, KIND_RUNNER, KIND_SCALE,
  KIND_WALKER, MAP_SIZE as S, MAX_ALIVE, PLAYER_RADIUS, PLAYER_SPEED, RISE_TIME, ZOMBIE_RADIUS,
} from './config';
import { Effects } from './effects';
import { FlowField, UNREACHABLE } from './flow';
import { SpatialGrid } from './grid';
import { GameMap, pushed } from './map';
import { Player } from './player';
import { offer, type Upgrade } from './upgrades';
import { WEAPONS } from './weapons';
import { Corpses, Zombies } from './zombies';

/** Per-frame player intent, already converted to world space. */
export interface Controls {
  moveX: number;
  moveZ: number;
  aimX: number;
  aimZ: number;
  firing: boolean;
  /** Weapon slot to switch to, or -1. */
  weapon: number;
  /** Place a barricade this frame. */
  build: boolean;
}

const HIT_RADIUS = 0.42;
const SEPARATION = ZOMBIE_RADIUS * 2;
const ATTACK_RANGE = ZOMBIE_RADIUS + PLAYER_RADIUS + 0.25;
/** Wave clears also refill the planks by this much. */
const PLANKS_PER_WAVE = 3;
const KILLS_PER_PLANK = 10;
/** Seconds of death animation before the game-over screen. */
const DEATH_TIME = 2.2;

export class Game {
  readonly map: GameMap;
  readonly flow: FlowField;
  readonly zombies = new Zombies();
  readonly corpses = new Corpses();
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
  /** Upgrades on offer between waves; the game waits until one is picked. */
  choices: Upgrade[] | null = null;
  /** Scrap picked up from loot this run. */
  lootScrap = 0;
  /** Loot payouts are multiplied by this (a meta perk doubles it). */
  private lootMul = 1;

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

  /** Scrap this run is worth: kills, cleared waves and loot. */
  get scrap(): number {
    return this.kills + Math.max(0, this.wave - 1) * 10 + this.lootScrap;
  }

  constructor(seed: number, perks: string[] = []) {
    this.map = new GameMap(seed);
    this.flow = new FlowField(this.map);
    const p = this.player = new Player(S / 2, S / 2);
    if (perks.includes('timber')) p.planks += 5;
    if (perks.includes('vigor')) { p.maxHp += 20; p.hp += 20; }
    if (perks.includes('scavenger')) this.lootMul = 2;
    if (perks.includes('smg')) { p.owned[1] = true; p.weapon = 1; }
    if (perks.includes('shotgun')) { p.owned[2] = true; p.weapon = 2; }
    this.announce('Get ready', 'The first wave is coming');
  }

  get zombiesLeft(): number {
    return this.toSpawn + this.zombies.n;
  }

  update(dt: number, c: Controls): void {
    if (this.over || this.choices) return;
    this.time += dt;
    const p = this.player;
    if (p.deadT >= 0) {
      p.deadT += dt;
      if (p.deadT > DEATH_TIME) this.over = true;
    } else {
      this.updatePlayer(dt, c);
    }
    this.updateLoot();
    this.flow.update(this.player.x, this.player.z);
    this.updateWaves(dt);
    this.grid.build(this.zombies.x, this.zombies.z, this.zombies.n);
    this.updateZombies(dt);
    this.updateBullets(dt);
    this.removeDead();
    this.corpses.update(dt, CORPSE_LIFE);
    this.fx.update(dt);
    this.shake *= Math.exp(-10 * dt);
    this.muzzle = Math.max(0, this.muzzle - dt);
  }

  /** Take the upgrade at `index` of the current offer and resume play. */
  pickUpgrade(index: number): void {
    const u = this.choices?.[index];
    if (!u) return;
    const p = this.player;
    u.apply(p);
    p.taken[u.id] = (p.taken[u.id] ?? 0) + 1;
    this.choices = null;
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
    const top = PLAYER_SPEED * p.speedMul;
    p.vx += (mx * top - p.vx) * k;
    p.vz += (mz * top - p.vz) * k;
    this.map.collideCircle(p.x + p.vx * dt, p.z + p.vz * dt, PLAYER_RADIUS);
    p.x = pushed.x;
    p.z = pushed.z;

    p.angle = Math.atan2(c.aimX - p.x, c.aimZ - p.z);
    p.fireCd -= dt;
    p.hurt = Math.max(0, p.hurt - dt);
    if (p.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
    if (c.weapon >= 0 && c.weapon < WEAPONS.length && p.owned[c.weapon]) p.weapon = c.weapon;
    if (c.firing && p.fireCd <= 0) this.fire();
    if (c.build) this.placeBarricade();
  }

  private updateLoot() {
    const p = this.player;
    if (p.deadT >= 0) return;
    for (const l of this.map.loot) {
      if (l.open || Math.abs(l.x - p.x) > 0.9 || Math.abs(l.z - p.z) > 0.9) continue;
      l.open = true;
      const m = this.lootMul, r = Math.random();
      if (r < 0.35) { p.planks += 4 * m; this.announce('Found planks', `+${4 * m} planks`); }
      else if (r < 0.65) { p.hp = Math.min(p.maxHp, p.hp + 30 * m); this.announce('Found bandages', `+${30 * m} health`); }
      else if (r < 0.9) { this.lootScrap += 15 * m; this.announce('Found scrap', `+${15 * m} scrap`); }
      else { this.choices = offer(p, 3); this.announce('Rare find', 'Pick a free upgrade'); }
    }
  }

  /** Board up the cell in front of the player. */
  private placeBarricade() {
    const p = this.player, zs = this.zombies;
    if (p.planks < 1 || this.map.barricades.length >= BARRICADE_CAP) return;
    const cx = Math.floor(p.x + Math.sin(p.angle) * 1.2), cz = Math.floor(p.z + Math.cos(p.angle) * 1.2);
    if (this.map.isSolid(cx, cz)) return;
    const mx = cx + 0.5, mz = cz + 0.5;
    if (Math.hypot(p.x - mx, p.z - mz) < 0.9) return;
    for (let i = 0; i < zs.n; i++) if (Math.abs(zs.x[i] - mx) < 0.9 && Math.abs(zs.z[i] - mz) < 0.9) return;
    p.planks--;
    this.map.addBarricade(cx, cz, BARRICADE_HP * p.barricadeMul);
    this.fx.sparks(mx, mz, 0, 0);
  }

  private fire() {
    const p = this.player;
    const w = WEAPONS[p.weapon];
    for (let k = 0; k < w.pellets; k++) {
      const a = p.angle + (Math.random() - 0.5) * w.spread;
      const dx = Math.sin(a), dz = Math.cos(a);
      const speed = w.speed * (0.9 + Math.random() * 0.2);
      this.bullets.spawn(p.x + dx * w.muzzle, p.z + dz * w.muzzle, dx * speed, dz * speed, w.damage * p.dmgMul, w.life, p.pierce);
    }
    p.fireCd = w.cooldown / p.rateMul;
    p.lastShot = this.time;
    this.muzzle = 0.05;
    this.shake = Math.max(this.shake, w.shake);
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
      this.breakTimer = 4;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 15);
      this.player.planks += PLANKS_PER_WAVE;
      this.announce(`Wave ${this.wave} cleared`, `+15 health, +${PLANKS_PER_WAVE} planks`);
      this.choices = offer(this.player, 3);
    }
  }

  private startWave() {
    const w = ++this.wave;
    this.fighting = true;
    this.toSpawn = Math.round(8 + w * 6 + w * w * 0.6);
    this.spawnInterval = Math.max(0.08, 0.9 - w * 0.06);
    this.spawnTimer = 0;
    this.waveHp = 50 * (1 + 0.15 * (w - 1));
    this.waveSpeed = 1.3 + Math.min(0.9, w * 0.07);
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
        const w = this.wave, r = Math.random();
        const brute = w >= 3 && r < (w % 5 === 0 ? 0.2 : Math.min(0.1, 0.02 * (w - 2)));
        const kind = brute ? KIND_BRUTE : r > 1 - Math.min(0.25, 0.04 * w) ? KIND_RUNNER : KIND_WALKER;
        const jitter = 0.8 + Math.random() * 0.4;
        const speed = kind === KIND_RUNNER ? 3.2 + Math.min(1, w * 0.05) + Math.random() * 0.4
          : kind === KIND_BRUTE ? this.waveSpeed * 0.75
          : this.waveSpeed * jitter;
        const hp = kind === KIND_BRUTE ? this.waveHp * 7 : this.waveHp;
        this.zombies.spawn(cx + 0.2 + Math.random() * 0.6, cz + 0.2 + Math.random() * 0.6, hp, speed, kind);
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
      if (zs.hitT[i] >= 0 && (zs.hitT[i] += dt) > 0.4) zs.hitT[i] = -1;
      if (zs.rise[i] < 1) {
        zs.rise[i] = Math.min(1, zs.rise[i] + dt / RISE_TIME);
        continue;
      }
      // Mid-attack zombies mostly stand their ground; the hit lands partway through the swing.
      let attacking = false;
      if (zs.atkT[i] >= 0) {
        const before = zs.atkT[i];
        zs.atkT[i] += dt;
        if (before < ATTACK_HIT_AT && zs.atkT[i] >= ATTACK_HIT_AT) this.zombieHits(i);
        if (zs.atkT[i] > ATTACK_TIME) zs.atkT[i] = -1;
        else attacking = true;
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
      const kind = zs.kind[i];
      // Something boarded up in the way: start breaking it.
      if (!attacking && zs.attackCd[i] <= 0) {
        const bx = Math.floor(x + tx * 0.6), bz = Math.floor(z + tz * 0.6);
        if (bx >= 0 && bz >= 0 && bx < S && bz < S && this.map.barricadeHp[bz * S + bx] > 0) {
          zs.atkT[i] = 0;
          zs.attackCd[i] = 1.3;
          zs.bash[i] = bz * S + bx;
          attacking = true;
        }
      }
      const sp = zs.speed[i] * (attacking ? 0.15 : 1);
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
      if (pd < ATTACK_RANGE + (KIND_SCALE[kind] - 1) * 0.5 && zs.attackCd[i] <= 0 && p.deadT < 0) {
        zs.attackCd[i] = 1.3;
        zs.atkT[i] = 0;
        zs.bash[i] = -1;
      }

      this.map.collideCircle(x, z, ZOMBIE_RADIUS);
      zs.x[i] = pushed.x;
      zs.z[i] = pushed.z;

      const want = d < 2.5 ? Math.atan2(dx, dz) : Math.atan2(zs.vx[i], zs.vz[i]);
      let da = want - zs.angle[i];
      da = Math.atan2(Math.sin(da), Math.cos(da));
      zs.angle[i] += da * turn * 1.5;
      zs.phase[i] += dt * Math.hypot(zs.vx[i], zs.vz[i]);
    }
    // Zombies may have shoved the player into a wall.
    this.map.collideCircle(p.x, p.z, PLAYER_RADIUS);
    p.x = pushed.x;
    p.z = pushed.z;
  }

  /** The swing connects only if the player is still in reach. */
  private zombieHits(i: number) {
    const p = this.player, zs = this.zombies;
    const dmg = KIND_DAMAGE[zs.kind[i]];
    if (zs.bash[i] >= 0) {
      const c = zs.bash[i];
      zs.bash[i] = -1;
      if (this.map.damageBarricade(c, dmg * 2.5)) this.fx.sparks((c % S) + 0.5, ((c / S) | 0) + 0.5, 0, 0);
      return;
    }
    const dx = p.x - zs.x[i], dz = p.z - zs.z[i];
    const d = Math.hypot(dx, dz);
    if (d > ATTACK_RANGE + 0.3 + (KIND_SCALE[zs.kind[i]] - 1) * 0.5 || p.deadT >= 0) return;
    this.hurtPlayer(dmg, dx / (d || 1), dz / (d || 1));
  }

  private hurtPlayer(dmg: number, dx: number, dz: number) {
    const p = this.player;
    p.hp -= dmg;
    p.hurt = 0.3;
    this.shake = Math.max(this.shake, 0.35);
    this.fx.blood(p.x, 1, p.z, dx, dz, 8);
    if (p.hp <= 0) {
      p.hp = 0;
      p.deadT = 0;
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
        if (this.map.isWall(Math.floor(x), Math.floor(z))) {
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
              if (j === b.lastHit[i]) continue;
              const ox = zs.x[j] - x, oz = zs.z[j] - z;
              const reach = HIT_RADIUS * KIND_SCALE[zs.kind[j]];
              if (ox * ox + oz * oz > reach * reach) continue;
              this.damageZombie(j, b.damage[i], dirX, dirZ);
              if (b.pierce[i] > 0) { b.pierce[i]--; b.lastHit[i] = j; continue; }
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
    zs.hitT[j] = 0;
    const knock = KIND_KNOCK[zs.kind[j]];
    zs.vx[j] += dx * 2.5 * knock;
    zs.vz[j] += dz * 2.5 * knock;
    this.fx.blood(zs.x[j], 1, zs.z[j], dx, dz, 5);
    if (zs.hp[j] <= 0) {
      if (++this.kills % KILLS_PER_PLANK === 0) this.player.planks++;
      this.fx.blood(zs.x[j], 0.8, zs.z[j], dx, dz, 16);
      this.fx.decal(zs.x[j] + dx * 0.4, zs.z[j] + dz * 0.4, 1);
      this.shake = Math.max(this.shake, 0.12);
    }
  }

  private removeDead() {
    const zs = this.zombies;
    for (let i = zs.n - 1; i >= 0; i--) {
      if (zs.hp[i] > 0) continue;
      this.corpses.add(zs.x[i], zs.z[i], zs.angle[i], zs.tint[i], zs.kind[i]);
      zs.remove(i);
    }
  }
}
