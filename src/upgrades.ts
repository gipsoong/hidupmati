import type { Player } from './player';

export interface Upgrade {
  id: string;
  title: string;
  desc: string;
  /** Times it can be taken; weapons are one-offs. */
  max: number;
  /** Relative chance of being offered. */
  weight: number;
  apply(p: Player): void;
}

export const UPGRADES: Upgrade[] = [
  { id: 'smg', title: 'SMG', desc: 'Fast, spraying automatic. Press 2 to equip.', max: 1, weight: 4, apply: (p) => { p.owned[1] = true; p.weapon = 1; } },
  { id: 'shotgun', title: 'Shotgun', desc: 'Eight pellets per blast, brutal up close. Press 3 to equip.', max: 1, weight: 4, apply: (p) => { p.owned[2] = true; p.weapon = 2; } },
  { id: 'damage', title: 'Hollow points', desc: '+20% damage with every weapon.', max: 6, weight: 3, apply: (p) => { p.dmgMul *= 1.2; } },
  { id: 'rate', title: 'Quick hands', desc: '+15% fire rate.', max: 5, weight: 3, apply: (p) => { p.rateMul *= 1.15; } },
  { id: 'pierce', title: 'Armour piercing', desc: 'Bullets pass through one more zombie.', max: 3, weight: 2, apply: (p) => { p.pierce++; } },
  { id: 'hp', title: 'Thick skin', desc: '+25 max health, and heal that much.', max: 4, weight: 3, apply: (p) => { p.maxHp += 25; p.hp += 25; } },
  { id: 'heal', title: 'First aid', desc: 'Restore all your health.', max: 99, weight: 2, apply: (p) => { p.hp = p.maxHp; } },
  { id: 'speed', title: 'Running shoes', desc: '+8% move speed.', max: 4, weight: 2, apply: (p) => { p.speedMul *= 1.08; } },
  { id: 'regen', title: 'Adrenaline', desc: 'Regain 0.7 health per second.', max: 3, weight: 2, apply: (p) => { p.regen += 0.7; } },
  { id: 'planks', title: 'Lumber', desc: '+8 planks for barricades.', max: 99, weight: 2, apply: (p) => { p.planks += 8; } },
  { id: 'nails', title: 'Reinforced nails', desc: 'New barricades have +50% health.', max: 3, weight: 2, apply: (p) => { p.barricadeMul += 0.5; } },
];

/** Pick `n` distinct upgrades the player can still take, weighted. */
export function offer(p: Player, n: number): Upgrade[] {
  const pool = UPGRADES.filter((u) => (p.taken[u.id] ?? 0) < u.max);
  const out: Upgrade[] = [];
  while (out.length < n && pool.length) {
    let r = Math.random() * pool.reduce((s, u) => s + u.weight, 0);
    let k = 0;
    while (k < pool.length - 1 && (r -= pool[k].weight) > 0) k++;
    out.push(pool.splice(k, 1)[0]);
  }
  return out;
}
