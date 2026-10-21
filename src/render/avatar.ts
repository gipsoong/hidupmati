import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Player } from '../player';

const HEIGHT = 1.78;
/** Jog cycle speed in m/s at timeScale 1, used to keep feet from sliding. */
const JOG_SPEED = 3.1;
/** The aim pose holds this long after the last shot, then the gun drops. */
const AIM_HOLD = 0.7;

const UPPER = /^(spine_02|spine_03|neck_01|Head|clavicle|upperarm|lowerarm|hand|index|middle|pinky|ring|thumb)/;

const OUTFIT = {
  skin: new THREE.Color(0xc79a78),
  hair: new THREE.Color(0x2a1c12),
  jacket: new THREE.Color(0x4f5d3c),
  sleeve: new THREE.Color(0x46532f),
  pants: new THREE.Color(0x37465c),
  belt: new THREE.Color(0x2b2622),
  boots: new THREE.Color(0x2a221c),
};

function regionColor(bone: string): THREE.Color {
  if (/^(Head|neck)/.test(bone)) return OUTFIT.skin;
  if (/^(hand|index|middle|pinky|ring|thumb)/.test(bone)) return OUTFIT.skin;
  if (/^lowerarm/.test(bone)) return OUTFIT.sleeve;
  if (/^(spine_02|spine_03|clavicle|upperarm)/.test(bone)) return OUTFIT.jacket;
  if (/^(spine_01|pelvis|root)/.test(bone)) return OUTFIT.belt;
  if (/^(foot|ball)/.test(bone)) return OUTFIT.boots;
  return OUTFIT.pants;
}

/** Paint clothes onto the bare mannequin by which bone each vertex follows most. */
function dress(mesh: THREE.SkinnedMesh, headPos: THREE.Vector3) {
  const g = mesh.geometry;
  const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const bones = mesh.skeleton.bones;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) { bw = w; best = si.getComponent(i, k); }
    }
    const name = bones[best].name;
    c.copy(regionColor(name));
    if (/^Head/.test(name)) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const up = v.y - headPos.y, back = headPos.z - v.z;
      if (up > 0.1 || (back > 0.04 && up > -0.04)) c.copy(OUTFIT.hair);
    }
    const n = 0.92 + Math.random() * 0.12;
    colors[i * 3] = c.r * n;
    colors[i * 3 + 1] = c.g * n;
    colors[i * 3 + 2] = c.b * n;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  mesh.castShadow = true;
}

function pistol(): THREE.Group {
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.7, roughness: 0.35 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
  const g = new THREE.Group();
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.035, 0.19), metal);
  slide.position.set(0, 0.03, 0.05);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.045), grip);
  handle.position.set(0, -0.02, -0.01);
  handle.rotation.x = 0.25;
  g.add(slide, handle);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

function backpack(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.38, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 }),
  );
  m.castShadow = true;
  return m;
}

/** Split a clip into lower-body and upper-body halves so the two can play different moves. */
function split(clip: THREE.AnimationClip): [THREE.AnimationClip, THREE.AnimationClip] {
  const upper = clip.tracks.filter((t) => UPPER.test(t.name));
  const lower = clip.tracks.filter((t) => !UPPER.test(t.name));
  return [new THREE.AnimationClip(clip.name + '_L', clip.duration, lower), new THREE.AnimationClip(clip.name + '_U', clip.duration, upper)];
}

/** Attach `obj` to `bone` so that, in the current pose, it sits at worldPos with worldQuat. */
function attach(bone: THREE.Object3D, obj: THREE.Object3D, worldPos: THREE.Vector3, worldQuat: THREE.Quaternion) {
  bone.updateWorldMatrix(true, false);
  const inv = bone.matrixWorld.clone().invert();
  obj.position.copy(worldPos).applyMatrix4(inv);
  const bq = new THREE.Quaternion();
  bone.matrixWorld.decompose(new THREE.Vector3(), bq, new THREE.Vector3());
  obj.quaternion.copy(bq.invert().multiply(worldQuat));
  const bs = new THREE.Vector3();
  bone.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), bs);
  obj.scale.set(1 / bs.x, 1 / bs.y, 1 / bs.z);
  bone.add(obj);
}

const DIRS = ['Jog_Fwd_Loop', 'Jog_Bwd_Loop', 'Jog_Left_Loop', 'Jog_Right_Loop'] as const;

/** The player's animated character: legs follow movement, the upper body raises the gun only when firing. */
export class PlayerAvatar {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly lower: THREE.AnimationAction[] = [];
  private readonly upper: THREE.AnimationAction[] = [];
  private readonly idleL: THREE.AnimationAction;
  private readonly idleU: THREE.AnimationAction;
  private readonly aim: THREE.AnimationAction;
  private readonly hit: THREE.AnimationAction;
  private readonly death: THREE.AnimationAction;
  private readonly gun: THREE.Group;
  private readonly gunBase = new THREE.Vector3();
  readonly muzzle = new THREE.Object3D();
  private yaw = 0;
  private aimW = 0;
  private dying = false;

  constructor(gltf: GLTF) {
    const model = cloneSkinned(gltf.scene);
    // Scale to height, feet on the ground.
    const box = new THREE.Box3().setFromObject(model);
    const s = HEIGHT / (box.max.y - box.min.y);
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;
    this.root.add(model);
    this.root.updateMatrixWorld(true);

    const meshes: THREE.SkinnedMesh[] = [];
    model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    const bone = (n: string) => meshes[0].skeleton.bones.find((b) => b.name === n)!;
    const headPos = bone('Head').getWorldPosition(new THREE.Vector3());
    for (const m of meshes) dress(m, headPos);

    this.mixer = new THREE.AnimationMixer(model);
    const clip = (n: string) => {
      const c = THREE.AnimationClip.findByName(gltf.animations, n);
      if (!c) throw new Error(`missing clip ${n}`);
      return c;
    };
    const play = (c: THREE.AnimationClip, w: number) => {
      const a = this.mixer.clipAction(c);
      a.play();
      a.setEffectiveWeight(w);
      return a;
    };
    const [idleLc, idleUc] = split(clip('Idle_Loop'));
    this.idleL = play(idleLc, 1);
    this.idleU = play(idleUc, 1);
    for (const d of DIRS) {
      const [l, u] = split(clip(d));
      this.lower.push(play(l, 0));
      this.upper.push(play(u, 0));
    }
    this.aim = play(split(clip('Pistol_Aim_Neutral'))[1], 0);
    this.hit = play(split(clip('Hit_Chest'))[1], 0);
    this.death = this.mixer.clipAction(clip('Death01'));
    this.death.setLoop(THREE.LoopOnce, 1);
    this.death.clampWhenFinished = true;

    // Fit the gun to the hand in the aiming pose, pointing straight ahead.
    this.aim.setEffectiveWeight(1);
    this.idleU.setEffectiveWeight(0);
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const hand = bone('hand_r');
    const grip = hand.getWorldPosition(new THREE.Vector3())
      .lerp(bone('middle_01_r').getWorldPosition(new THREE.Vector3()), 0.6);
    this.gun = pistol();
    this.muzzle.position.set(0, 0.03, 0.17);
    this.gun.add(this.muzzle);
    attach(hand, this.gun, grip, new THREE.Quaternion());
    this.gunBase.copy(this.gun.position);

    const spine = bone('spine_03');
    const back = spine.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.02, -0.19));
    attach(spine, backpack(), back, new THREE.Quaternion());

    this.aim.setEffectiveWeight(0);
    this.idleU.setEffectiveWeight(1);
  }

  update(p: Player, time: number, dt: number): void {
    this.root.position.set(p.x, this.root.position.y, p.z);

    if (p.deadT >= 0) {
      if (!this.dying) {
        this.dying = true;
        this.death.reset().play();
        this.death.setEffectiveWeight(1);
      }
      for (const a of [this.idleL, this.idleU, this.aim, this.hit, ...this.lower, ...this.upper]) {
        a.setEffectiveWeight(Math.max(0, a.getEffectiveWeight() - dt * 6));
      }
      this.mixer.update(dt);
      return;
    }

    const speed = Math.hypot(p.vx, p.vz);
    const aiming = time - p.lastShot < AIM_HOLD;
    this.aimW += ((aiming ? 1 : 0) - this.aimW) * Math.min(1, dt * (aiming ? 18 : 4));

    // Face the aim while shooting, otherwise the way we're running.
    const target = aiming || speed < 0.5 ? (aiming ? p.angle : this.yaw) : Math.atan2(p.vx, p.vz);
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * (aiming ? 25 : 10));
    this.root.rotation.y = this.yaw;

    // Directional jog weights from movement relative to facing.
    const move = Math.min(1, speed / 1.5);
    const mx = speed > 0.01 ? p.vx / speed : 0, mz = speed > 0.01 ? p.vz / speed : 0;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const fwd = mx * fx + mz * fz, right = mx * -fz + mz * fx;
    const w = [Math.max(0, fwd), Math.max(0, -fwd), Math.max(0, -right), Math.max(0, right)];
    const sum = w[0] + w[1] + w[2] + w[3] || 1;
    const scale = THREE.MathUtils.clamp(speed / JOG_SPEED, 0.6, 1.8);
    const hurt = Math.min(1, p.hurt / 0.3) * 0.8;
    for (let k = 0; k < 4; k++) {
      const wk = (w[k] / sum) * move;
      this.lower[k].setEffectiveWeight(wk).setEffectiveTimeScale(scale);
      this.upper[k].setEffectiveWeight(wk * (1 - this.aimW) * (1 - hurt)).setEffectiveTimeScale(scale);
    }
    this.idleL.setEffectiveWeight(1 - move);
    this.idleU.setEffectiveWeight((1 - move) * (1 - this.aimW) * (1 - hurt));
    this.aim.setEffectiveWeight(this.aimW * (1 - hurt));
    this.hit.setEffectiveWeight(hurt);
    this.mixer.update(dt);

    // A little kick on each shot.
    const since = time - p.lastShot;
    this.gun.position.copy(this.gunBase);
    if (since < 0.08) this.gun.translateZ(-0.04 * (1 - since / 0.08));
  }

  /** Raised sidewalks lift the whole character. */
  setGround(y: number): void {
    this.root.position.y += (y - this.root.position.y) * 0.3;
  }

  reset(): void {
    this.dying = false;
    this.death.stop();
    this.aimW = 0;
  }
}
