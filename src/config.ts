export const MAP_SIZE = 64;

export const PLAYER_RADIUS = 0.35;
export const PLAYER_SPEED = 4.6;
export const PLAYER_MAX_HP = 100;

export const ZOMBIE_RADIUS = 0.36;
export const ZOMBIE_CAP = 1500;
export const MAX_ALIVE = 600;
/** Seconds a corpse stays (the last part sinking into the ground). */
export const CORPSE_LIFE = 12;
/** Seconds a zombie takes to climb out of the ground. */
export const RISE_TIME = 1.4;

export const BULLET_CAP = 512;
export const BULLET_SPEED = 42;
export const PARTICLE_CAP = 4000;
export const DECAL_CAP = 800;

/** Longest single simulation step; slower frames are split into substeps. */
export const MAX_STEP = 1 / 60;

/** Zombie attack: total swing time and when in the swing the hit lands. */
export const ATTACK_TIME = 1.0;
export const ATTACK_HIT_AT = 0.35;
