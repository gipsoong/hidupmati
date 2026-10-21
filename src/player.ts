import { PLAYER_MAX_HP } from './config';

export class Player {
  x: number;
  z: number;
  vx = 0;
  vz = 0;
  angle = 0;
  hp = PLAYER_MAX_HP;
  fireCd = 0;
  /** Seconds left on the red hurt flash. */
  hurt = 0;
  /** Game time of the last shot; the aim pose holds for a moment after. */
  lastShot = -10;
  /** Seconds since death, or -1 while alive. */
  deadT = -1;

  constructor(x: number, z: number) {
    this.x = x;
    this.z = z;
  }
}
