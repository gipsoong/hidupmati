/** Progress that survives between runs: scrap earned and the perks bought with it. */
export interface Perk {
  id: string;
  title: string;
  desc: string;
  cost: number;
}

export const PERKS: Perk[] = [
  { id: 'timber', title: 'Hardware store', desc: 'Start every run with 5 extra planks.', cost: 60 },
  { id: 'vigor', title: 'Gym membership', desc: 'Start with +20 max health.', cost: 100 },
  { id: 'scavenger', title: 'Sharp eyes', desc: 'Loot crates give double.', cost: 120 },
  { id: 'smg', title: 'Stashed SMG', desc: 'Start every run with an SMG equipped.', cost: 200 },
  { id: 'shotgun', title: 'Stashed shotgun', desc: 'Start every run with a shotgun.', cost: 250 },
];

export interface Meta {
  scrap: number;
  perks: string[];
}

const KEY = 'hidupmati.meta';

export function loadMeta(): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? '');
    return { scrap: Number(m.scrap) || 0, perks: Array.isArray(m.perks) ? m.perks : [] };
  } catch {
    return { scrap: 0, perks: [] };
  }
}

export function saveMeta(m: Meta): void {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage unavailable */ }
}

/** Buy a perk if affordable and not owned. Returns whether it was bought. */
export function buy(m: Meta, id: string): boolean {
  const perk = PERKS.find((p) => p.id === id);
  if (!perk || m.perks.includes(id) || m.scrap < perk.cost) return false;
  m.scrap -= perk.cost;
  m.perks.push(id);
  saveMeta(m);
  return true;
}
