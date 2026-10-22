import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Assets } from './assets';
import {
  ATTACK_TIME, BARRICADE_CAP, BULLET_CAP, CORPSE_LIFE, DECAL_CAP, KIND_BRUTE, KIND_SCALE, MAP_SIZE as S, PARTICLE_CAP, ZOMBIE_CAP,
} from './config';

const PLANKS = 3;
const LOOT_CAP = 64;
import type { Game } from './game';
import { PlayerAvatar } from './render/avatar';
import { BakedCrowd } from './render/crowd';
import { buildWorld } from './render/world';

/** Fixed isometric-style camera direction (from target towards camera). */
const CAM_OFFSET = new THREE.Vector3(1, 1.5, 1).normalize().multiplyScalar(60);
const VIEW_HEIGHT = 17;
const AIM_HEIGHT = 1.2;
const CORPSE_CAP = 200;

/** World-space ground directions for screen up and screen right. */
export const SCREEN_UP = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
export const SCREEN_RIGHT = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };

/** Zombie clip names and how fast each cycles. */
const ZCLIPS = ['SPAWN', 'WALK', 'RUN', 'ATK', 'HIT', 'DEAD'];
const enum ZClip { Spawn, Walk, Run, Attack, Hit, Dead }
/** Metres covered per second of walk / run animation, so feet match ground speed. */
const WALK_STRIDE = 0.85;
const RUN_STRIDE = 3.0;
const FADE_TIME = 0.18;
/** The zombie model faces +Z like the game's angle convention. */
const ZOMBIE_YAW = 0;

const VIGNETTE = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.55 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Slightly desaturated, cool shadows and warm highlights: a dusk palette.
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 graded = mix(vec3(l), c.rgb, 0.9);
      graded *= mix(vec3(0.92, 0.98, 1.06), vec3(1.05, 1.0, 0.92), smoothstep(0.1, 0.7, l));
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * strength * 2.2;
      gl_FragColor = vec4(graded * v, c.a);
    }`,
};

/** Soft irregular blood splat, drawn once. */
function splatTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let k = 0; k < 14; k++) {
    const r = k === 0 ? 34 : 6 + Math.random() * 16;
    const a = Math.random() * Math.PI * 2, d = k === 0 ? 0 : 20 + Math.random() * 30;
    const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.frustumCulled = false;
  return m;
}

/** Write a Y-rotation + scale + translation matrix straight into an instance buffer. */
function writeMatrix(a: Float32Array, i: number, angle: number, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const c = Math.cos(angle), s = Math.sin(angle), o = i * 16;
  a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}

function markDirty(m: THREE.InstancedMesh, n: number) {
  m.count = n;
  for (const attr of [m.instanceMatrix, m.instanceColor!]) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * attr.itemSize);
    attr.needsUpdate = true;
  }
}

export type Quality = 'high' | 'low';

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  quality: Quality = 'high';
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200);
  private readonly sun = new THREE.DirectionalLight(0xffd7aa, 3.0);
  private readonly raycaster = new THREE.Raycaster();
  private readonly aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_HEIGHT);
  private readonly camTarget = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;

  private readonly bulletMesh: THREE.InstancedMesh;
  private readonly plankMesh: THREE.InstancedMesh;
  private readonly lootMesh: THREE.InstancedMesh;
  private readonly particleMesh: THREE.InstancedMesh;
  private readonly decalMesh: THREE.InstancedMesh;
  private readonly muzzleLight = new THREE.PointLight(0xffb060, 0, 10, 1.6);
  private readonly flash: THREE.Mesh;

  private assets: Assets | null = null;
  private crowd: BakedCrowd | null = null;
  private avatar: PlayerAvatar | null = null;
  private world: THREE.Group | null = null;
  private decalsDrawn = 0;

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.3;
    container.appendChild(this.gl.domElement);

    const bg = new THREE.Color(0x1d2126);
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 62, 95);
    this.scene.add(new THREE.HemisphereLight(0xd6e2f2, 0x5c4e3e, 1.7));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -24;
    sc.right = sc.top = 24;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target, this.muzzleLight);

    // Dark ground beyond the town wall so the edges don't float in a void.
    const outside = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x2c2a24 }),
    );
    outside.position.set(S / 2, -0.02, S / 2);
    outside.receiveShadow = true;
    this.scene.add(outside);

    this.bulletMesh = instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }), BULLET_CAP);
    this.plankMesh = instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), BARRICADE_CAP * PLANKS);
    this.plankMesh.castShadow = true;
    this.plankMesh.receiveShadow = true;
    this.lootMesh = instanced(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xd9a441, emissive: 0x5a3c0a }),
      LOOT_CAP,
    );
    this.lootMesh.castShadow = true;
    this.particleMesh = instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), PARTICLE_CAP);
    const decalMat = new THREE.MeshLambertMaterial({
      map: splatTexture(), color: 0x6a0707, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.decalMesh = instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), decalMat, DECAL_CAP);
    this.decalMesh.receiveShadow = true;

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.scene.add(this.bulletMesh, this.plankMesh, this.lootMesh, this.particleMesh, this.decalMesh, this.flash);

    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera);
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1 });
    this.gtao.blendIntensity = 0.85;
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(VIGNETTE));

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Characters need loaded assets; call once before the first setGame. */
  init(assets: Assets): void {
    this.assets = assets;
    this.crowd = new BakedCrowd(assets.zombie, ZCLIPS, ZOMBIE_CAP + CORPSE_CAP, 1.8);
    this.avatar = new PlayerAvatar(assets.player);
    this.scene.add(this.crowd.mesh, this.avatar.root);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.gl.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h);
    this.composer.setPixelRatio(this.gl.getPixelRatio());
    this.composer.setSize(w, h);
    const aspect = w / h;
    // Keep roughly the same visible area on tall (phone) screens.
    const vh = aspect < 1 ? VIEW_HEIGHT / Math.max(aspect, 0.6) : VIEW_HEIGHT;
    this.camera.left = (-vh * aspect) / 2;
    this.camera.right = (vh * aspect) / 2;
    this.camera.top = vh / 2;
    this.camera.bottom = -vh / 2;
    this.camera.updateProjectionMatrix();
  }

  /** Rebuild static map geometry for a new run. */
  setGame(game: Game): void {
    if (this.world) {
      this.scene.remove(this.world);
      // Prop geometry and materials belong to the shared assets; only our own builds are freed.
      this.world.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.world = buildWorld(game.map, this.assets!);
    this.scene.add(this.world);
    this.avatar!.reset();
    this.decalsDrawn = 0;
    this.decalMesh.count = 0;
    this.camTarget.set(game.player.x, 0, game.player.z);
  }

  /** Project a screen point (NDC) onto the aim plane; returns false if it misses. */
  screenToWorld(ndcX: number, ndcY: number, out: { x: number; z: number }): boolean {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    if (!this.raycaster.ray.intersectPlane(this.aimPlane, this.tmpV)) return false;
    out.x = this.tmpV.x;
    out.z = this.tmpV.z;
    return true;
  }

  /** Move the camera to follow the player. Call before screenToWorld each frame. */
  updateCamera(game: Game, dt: number): void {
    const p = game.player;
    this.camTarget.lerp(this.tmpV.set(p.x, 0, p.z), 1 - Math.exp(-8 * dt));
    const sh = game.shake;
    this.camera.position.copy(this.camTarget).add(CAM_OFFSET);
    this.camera.position.x += (Math.random() - 0.5) * sh;
    this.camera.position.z += (Math.random() - 0.5) * sh;
    this.camera.lookAt(this.camTarget.x, this.camTarget.y, this.camTarget.z);
    this.camera.updateMatrixWorld();
  }

  render(game: Game, dt: number): void {
    const p = game.player;
    const av = this.avatar!;
    av.update(p, game.time, dt);
    av.setGround(game.map.groundHeight(p.x, p.z));

    // Muzzle flash at the gun's tip, facing the camera.
    const on = game.muzzle > 0;
    this.flash.visible = on;
    this.muzzleLight.intensity = on ? 30 : 0;
    if (on) {
      av.muzzle.getWorldPosition(this.tmpV);
      this.flash.position.copy(this.tmpV);
      this.flash.quaternion.copy(this.camera.quaternion);
      this.flash.rotateZ(Math.random() * Math.PI);
      this.flash.scale.setScalar(0.6 + Math.random() * 0.5);
      this.muzzleLight.position.copy(this.tmpV);
    }

    // Sun and its shadow box follow the camera target, snapped to whole units to limit shimmer.
    const tx = Math.round(this.camTarget.x), tz = Math.round(this.camTarget.z);
    this.sun.position.set(tx - 22, 34, tz + 14);
    this.sun.target.position.set(tx, 0, tz);
    this.sun.target.updateMatrixWorld();

    this.drawZombies(game, dt);
    this.drawBullets(game);
    this.drawBarricades(game);
    this.drawLoot(game);
    this.drawParticles(game);
    this.drawDecals(game);
    if (this.quality === 'high') this.composer.render(dt);
    else this.gl.render(this.scene, this.camera);
  }

  private drawZombies(game: Game, dt: number) {
    const zs = game.zombies, crowd = this.crowd!, map = game.map;
    const a = crowd.mesh.instanceMatrix.array as Float32Array;
    const col = crowd.mesh.instanceColor!.array as Float32Array;
    const clipDur = (c: string) => crowd.clips[c].duration;
    for (let i = 0; i < zs.n; i++) {
      let clip: ZClip, t: number, loop = false;
      if (zs.rise[i] < 1) { clip = ZClip.Spawn; t = zs.rise[i] * clipDur('SPAWN'); }
      else if (zs.atkT[i] >= 0) { clip = ZClip.Attack; t = (zs.atkT[i] / ATTACK_TIME) * clipDur('ATK'); }
      else if (zs.hitT[i] >= 0) { clip = ZClip.Hit; t = zs.hitT[i] * 1.6; }
      else if (zs.runner[i]) { clip = ZClip.Run; t = zs.phase[i] / RUN_STRIDE; loop = true; }
      else { clip = ZClip.Walk; t = zs.phase[i] / WALK_STRIDE; loop = true; }
      const row = crowd.row(ZCLIPS[clip], t, loop);
      if (clip !== zs.animClip[i]) {
        // Cross-fade from whatever frame was showing.
        zs.animPrevRow[i] = zs.animClip[i] < 0 ? row : zs.animTime[i];
        zs.animFade[i] = zs.animClip[i] < 0 ? 0 : 1;
        zs.animClip[i] = clip;
      }
      zs.animFade[i] = Math.max(0, zs.animFade[i] - dt / FADE_TIME);
      zs.animTime[i] = row;
      crowd.setFrame(i, row, zs.animPrevRow[i], zs.animFade[i]);

      const x = zs.x[i], z = zs.z[i];
      const sc = KIND_SCALE[zs.kind[i]];
      writeMatrix(a, i, zs.angle[i] + ZOMBIE_YAW, sc, sc, sc, x, map.groundHeight(x, z), z);
      if (zs.flash[i] > 0) {
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 3;
      } else {
        // A per-zombie colour cast so the horde isn't one person cloned.
        const t = zs.tint[i] * 1.15, h = zs.tint[i] * 97;
        col[i * 3] = t * (1 + 0.12 * Math.sin(h));
        col[i * 3 + 1] = t * (1 + 0.08 * Math.sin(h * 1.7));
        col[i * 3 + 2] = t * (1 + 0.12 * Math.sin(h * 2.3));
        if (zs.kind[i] === KIND_BRUTE) { col[i * 3 + 1] *= 0.7; col[i * 3 + 2] *= 0.65; }
      }
    }

    // Corpses: the death clip plays out, then they sink away.
    const c = game.corpses, deadRowsEnd = clipDur('DEAD');
    let n = zs.n;
    for (let j = 0; j < c.n && n < ZOMBIE_CAP + CORPSE_CAP; j++, n++) {
      const row = crowd.row('DEAD', Math.min(c.t[j], deadRowsEnd), false);
      crowd.setFrame(n, row, row, 0);
      const sink = Math.max(0, c.t[j] - (CORPSE_LIFE - 3)) / 3;
      const csc = KIND_SCALE[c.kind[j]];
      writeMatrix(a, n, c.angle[j] + ZOMBIE_YAW, csc, csc, csc, c.x[j], map.groundHeight(c.x[j], c.z[j]) - sink * 0.6, c.z[j]);
      const k = c.tint[j] * 0.85;
      col[n * 3] = k; col[n * 3 + 1] = k; col[n * 3 + 2] = k;
    }
    crowd.commit(n);
  }

  /** Each barricade is a stack of rough planks that darken as they take damage. */
  private drawBarricades(game: Game) {
    const map = game.map, mesh = this.plankMesh;
    const a = mesh.instanceMatrix.array as Float32Array;
    const col = mesh.instanceColor!.array as Float32Array;
    let n = 0;
    for (const c of map.barricades) {
      const cx = c % S, cz = (c / S) | 0;
      const hurt = 1 - map.barricadeHp[c] / map.barricadeMax[c];
      const h = (cx * 73856093) ^ (cz * 19349663);
      const yaw = (h & 1) * Math.PI / 2 + ((h >> 3) % 7 - 3) * 0.03;
      for (let k = 0; k < PLANKS; k++) {
        const wob = ((h >> (k + 4)) & 3) * 0.02;
        writeMatrix(a, n, yaw, 1.0 - wob, 0.2, 0.1, cx + 0.5, 0.25 + k * 0.38, cz + 0.5);
        const t = 1 - hurt * 0.55 - (k === 1 ? 0.08 : 0);
        col[n * 3] = 0.55 * t; col[n * 3 + 1] = 0.38 * t; col[n * 3 + 2] = 0.22 * t;
        n++;
      }
    }
    markDirty(mesh, n);
  }

  private drawLoot(game: Game) {
    const mesh = this.lootMesh, a = mesh.instanceMatrix.array as Float32Array;
    let n = 0;
    for (const l of game.map.loot) {
      if (l.open || n >= LOOT_CAP) continue;
      writeMatrix(a, n++, game.time * 1.5 + l.x, 0.45, 0.35, 0.45, l.x, 0.3 + Math.sin(game.time * 3 + l.z) * 0.05, l.z);
    }
    markDirty(mesh, n);
  }

  private drawBullets(game: Game) {
    const b = game.bullets, mesh = this.bulletMesh;
    const a = mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < b.n; i++) {
      writeMatrix(a, i, Math.atan2(b.vx[i], b.vz[i]), 0.05, 0.05, 0.9, b.x[i], AIM_HEIGHT, b.z[i]);
    }
    markDirty(mesh, b.n);
  }

  private drawParticles(game: Game) {
    const fx = game.fx, mesh = this.particleMesh;
    const a = mesh.instanceMatrix.array as Float32Array;
    const col = mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < fx.n; i++) {
      const s = fx.size[i] * Math.min(1, (fx.life[i] / fx.maxLife[i]) * 2);
      writeMatrix(a, i, 0, s, s, s, fx.px[i], fx.py[i], fx.pz[i]);
      const c = fx.color[i];
      col[i * 3] = ((c >> 16) & 255) / 255;
      col[i * 3 + 1] = ((c >> 8) & 255) / 255;
      col[i * 3 + 2] = (c & 255) / 255;
    }
    markDirty(mesh, fx.n);
  }

  private drawDecals(game: Game) {
    const fx = game.fx, mesh = this.decalMesh;
    if (fx.decalCount === this.decalsDrawn) return;
    const a = mesh.instanceMatrix.array as Float32Array;
    const from = Math.max(this.decalsDrawn, fx.decalCount - DECAL_CAP);
    for (let k = from; k < fx.decalCount; k++) {
      const i = k % DECAL_CAP, s = fx.decalScale[i] * 1.4;
      const x = fx.decalX[i], z = fx.decalZ[i];
      writeMatrix(a, i, fx.decalRot[i], s, 1, s, x, game.map.groundHeight(x, z) + 0.015, z);
    }
    this.decalsDrawn = fx.decalCount;
    mesh.count = Math.min(fx.decalCount, DECAL_CAP);
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.needsUpdate = true;
  }
}
