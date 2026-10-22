import { PLAYER_MAX_HP } from './config';

export class Player {
  x: number;
  z: number;
  vx = 0;
  vz = 0;
  angle = 0;
  maxHp = PLAYER_MAX_HP;
  hp = PLAYER_MAX_HP;
  fireCd = 0;
  /** Seconds left on the red hurt flash. */
  hurt = 0;
  /** Game time of the last shot; the aim pose holds for a moment after. */
  lastShot = -10;
  /** Seconds since death, or -1 while alive. */
  deadT = -1;

  /** Index into WEAPONS, and which ones have been found. */
  weapon = 0;
  readonly owned = [true, false, false];
  planks = 5;

  // Upgrade stats.
  dmgMul = 1;
  rateMul = 1;
  speedMul = 1;
  pierce = 0;
  regen = 0;
  barricadeMul = 1;
  /** How many times each upgrade has been taken. */
  readonly taken: Record<string, number> = {};

  constructor(x: number, z: number) {
    this.x = x;
    this.z = z;
  }
}
