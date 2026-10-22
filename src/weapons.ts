export interface Weapon {
  name: string;
  damage: number;
  /** Seconds between shots. */
  cooldown: number;
  pellets: number;
  /** Total spread cone in radians. */
  spread: number;
  speed: number;
  /** Bullet lifetime in seconds; speed * life is the range. */
  life: number;
  shake: number;
  /** Distance from the player to the muzzle. */
  muzzle: number;
}

export const WEAPONS: Weapon[] = [
  { name: 'Pistol', damage: 25, cooldown: 0.15, pellets: 1, spread: 0.06, speed: 42, life: 0.9, shake: 0.06, muzzle: 0.8 },
  { name: 'SMG', damage: 13, cooldown: 0.065, pellets: 1, spread: 0.13, speed: 46, life: 0.8, shake: 0.05, muzzle: 0.9 },
  { name: 'Shotgun', damage: 17, cooldown: 0.75, pellets: 8, spread: 0.34, speed: 40, life: 0.38, shake: 0.22, muzzle: 1.1 },
];
