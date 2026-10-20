import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BULLET_CAP, DECAL_CAP, MAP_SIZE as S, PARTICLE_CAP, ZOMBIE_CAP } from './config';
import type { Game } from './game';
import { FLOOR_INDOOR, FLOOR_ROAD, type GameMap } from './map';

/** Fixed isometric-style camera direction (from target towards camera). */
const CAM_OFFSET = new THREE.Vector3(1, 1.35, 1).normalize().multiplyScalar(60);
const VIEW_HEIGHT = 22;
const AIM_HEIGHT = 0.75;

/** World-space ground directions for screen up and screen right. */
export const SCREEN_UP = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
export const SCREEN_RIGHT = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

/** Boxhead-style zombie: feet at y=0, facing +Z. */
function zombieGeometry(): THREE.BufferGeometry {
  const skin = 0x7fa36a, shirt = 0x6b6f4f, pants = 0x3b4a5c;
  return mergeGeometries([
    box(0.18, 0.55, 0.2, -0.12, 0.275, 0, pants),
    box(0.18, 0.55, 0.2, 0.12, 0.275, 0, pants),
    box(0.5, 0.55, 0.3, 0, 0.825, 0, shirt),
    box(0.38, 0.38, 0.38, 0, 1.3, 0, skin),
    box(0.14, 0.14, 0.5, -0.32, 1.0, 0.22, skin),
    box(0.14, 0.14, 0.5, 0.32, 1.0, 0.22, skin),
    box(0.08, 0.06, 0.02, -0.09, 1.34, 0.195, 0xff2a10),
    box(0.08, 0.06, 0.02, 0.09, 1.34, 0.195, 0xff2a10),
  ])!;
}

function playerGeometry(): THREE.BufferGeometry {
  const skin = 0xe0b48c, jacket = 0x2f5d8a, pants = 0x2a2a30, hair = 0x3a2616, gun = 0x222222;
  return mergeGeometries([
    box(0.18, 0.55, 0.2, -0.12, 0.275, 0, pants),
    box(0.18, 0.55, 0.2, 0.12, 0.275, 0, pants),
    box(0.5, 0.55, 0.3, 0, 0.825, 0, jacket),
    box(0.38, 0.38, 0.38, 0, 1.3, 0, skin),
    box(0.4, 0.1, 0.4, 0, 1.52, -0.02, hair),
    box(0.14, 0.14, 0.45, 0.24, 0.95, 0.2, jacket),
    box(0.14, 0.14, 0.35, -0.24, 0.95, 0.15, jacket),
    box(0.1, 0.12, 0.45, 0.2, 0.98, 0.5, gun),
  ])!;
}

/** Paint the tile map into a texture once per map. */
function floorTexture(map: GameMap): THREE.CanvasTexture {
  const px = 16;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S * px;
  const ctx = canvas.getContext('2d')!;
  const base = ['#3d5a2c', '#38383b', '#6b5640'];
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const f = map.floor[z * S + x];
      ctx.fillStyle = base[f];
      ctx.fillRect(x * px, z * px, px, px);
      // Speckle noise so large areas don't look flat.
      for (let k = 0; k < 6; k++) {
        const l = Math.random() < 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${l},${l},${l},${0.04 + Math.random() * 0.05})`;
        ctx.fillRect(x * px + Math.random() * px, z * px + Math.random() * px, 2 + Math.random() * 3, 2 + Math.random() * 3);
      }
      if (f === FLOOR_INDOOR) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x * px, z * px + px - 1, px, 1);
      }
    }
  }
  // Dashed centre lines on the road cross.
  ctx.fillStyle = '#c9b35a';
  const mid = (S / 2) * px;
  for (let i = 0; i < S * px; i += 24) {
    if (map.floor[Math.floor(mid / px) * S + Math.floor(i / px)] === FLOOR_ROAD) ctx.fillRect(i, mid - 1, 12, 2);
    if (map.floor[Math.floor(i / px) * S + Math.floor(mid / px)] === FLOOR_ROAD) ctx.fillRect(mid - 1, i, 2, 12);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, shadow: boolean): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.frustumCulled = false;
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

/** Write a Y-rotation + uniform scale + translation matrix straight into an instance buffer. */
function writeMatrix(a: Float32Array, i: number, angle: number, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const c = Math.cos(angle), s = Math.sin(angle), o = i * 16;
  a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}

function markDirty(m: THREE.InstancedMesh, n: number) {
  m.count = n;
  m.instanceMatrix.clearUpdateRanges();
  m.instanceMatrix.addUpdateRange(0, n * 16);
  m.instanceMatrix.needsUpdate = true;
  const col = m.instanceColor!;
  col.clearUpdateRanges();
  col.addUpdateRange(0, n * 3);
  col.needsUpdate = true;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly sun = new THREE.DirectionalLight(0xffe2c0, 2.4);
  private readonly raycaster = new THREE.Raycaster();
  private readonly aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_HEIGHT);
  private readonly camTarget = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();

  private readonly zombieMesh: THREE.InstancedMesh;
  private readonly bulletMesh: THREE.InstancedMesh;
  private readonly particleMesh: THREE.InstancedMesh;
  private readonly decalMesh: THREE.InstancedMesh;
  private readonly player: THREE.Mesh;
  private readonly playerMat: THREE.MeshLambertMaterial;
  private readonly muzzleLight = new THREE.PointLight(0xffc070, 0, 9, 1.5);
  private readonly muzzleMesh: THREE.Mesh;

  private mapGroup = new THREE.Group();
  private decalsDrawn = 0;

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.gl.domElement);

    this.scene.background = new THREE.Color(0x14171c);
    this.scene.add(new THREE.HemisphereLight(0xb8c4d8, 0x3a3328, 1.3));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -26;
    sc.right = sc.top = 26;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target, this.muzzleLight, this.mapGroup);

    const lambert = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.zombieMesh = instanced(zombieGeometry(), lambert, ZOMBIE_CAP, true);

    const bulletGeo = new THREE.BoxGeometry(1, 1, 1);
    this.bulletMesh = instanced(bulletGeo, new THREE.MeshBasicMaterial({ color: 0xfff1a8 }), BULLET_CAP, false);
    this.particleMesh = instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), PARTICLE_CAP, false);

    const decalGeo = new THREE.CircleGeometry(0.5, 9).rotateX(-Math.PI / 2);
    const decalMat = new THREE.MeshLambertMaterial({
      color: 0x4a0606, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.decalMesh = instanced(decalGeo, decalMat, DECAL_CAP, false);
    this.decalMesh.receiveShadow = true;

    this.playerMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.player = new THREE.Mesh(playerGeometry(), this.playerMat);
    this.player.castShadow = true;
    this.muzzleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.3), new THREE.MeshBasicMaterial({ color: 0xffd060 }));
    this.muzzleMesh.position.set(0.2, 0.98, 0.85);
    this.player.add(this.muzzleMesh);

    this.scene.add(this.zombieMesh, this.bulletMesh, this.particleMesh, this.decalMesh, this.player);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h);
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
    this.scene.remove(this.mapGroup);
    this.mapGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.MeshLambertMaterial;
        m.map?.dispose();
        m.dispose();
      }
    });
    this.mapGroup = new THREE.Group();

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: floorTexture(game.map) }),
    );
    floor.position.set(S / 2, 0, S / 2);
    floor.receiveShadow = true;
    this.mapGroup.add(floor);

    const blocks = game.map.blocks;
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const blockMesh = new THREE.InstancedMesh(unit, new THREE.MeshLambertMaterial(), blocks.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    blocks.forEach((b, i) => {
      m.makeScale(b.w, b.h, b.d).setPosition(b.x + b.w / 2, 0, b.z + b.d / 2);
      blockMesh.setMatrixAt(i, m);
      blockMesh.setColorAt(i, col.setHex(b.color).multiplyScalar(0.9 + Math.random() * 0.2));
    });
    blockMesh.castShadow = blockMesh.receiveShadow = true;
    this.mapGroup.add(blockMesh);

    // Car cabins sit on top of the car bodies.
    const cars = blocks.filter((b) => b.kind === 'car');
    if (cars.length) {
      const cabins = new THREE.InstancedMesh(unit.clone(), new THREE.MeshLambertMaterial({ color: 0x9fb4c4 }), cars.length);
      cars.forEach((b, i) => {
        m.makeScale(b.w * (b.w > b.d ? 0.5 : 0.8), 0.5, b.d * (b.d > b.w ? 0.5 : 0.8)).setPosition(b.x + b.w / 2, b.h, b.z + b.d / 2);
        cabins.setMatrixAt(i, m);
      });
      cabins.castShadow = true;
      this.mapGroup.add(cabins);
    }
    this.scene.add(this.mapGroup);

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
    this.camTarget.lerp(this.tmpV.set(p.x, 0, p.z), 1 - Math.exp(-10 * dt));
    const sh = game.shake;
    this.camera.position.copy(this.camTarget).add(CAM_OFFSET);
    this.camera.position.x += (Math.random() - 0.5) * sh;
    this.camera.position.z += (Math.random() - 0.5) * sh;
    this.camera.lookAt(this.camTarget.x, this.camTarget.y, this.camTarget.z);
    this.camera.updateMatrixWorld();
  }

  render(game: Game): void {
    const p = game.player;
    this.player.position.set(p.x, 0, p.z);
    this.player.rotation.y = p.angle;
    this.playerMat.emissive.setRGB(p.hurt * 2.5, 0, 0);
    this.muzzleMesh.visible = game.muzzle > 0;
    this.muzzleMesh.rotation.z = Math.random() * Math.PI;
    this.muzzleLight.intensity = game.muzzle > 0 ? 25 : 0;
    this.muzzleLight.position.set(p.x + Math.sin(p.angle) * 0.9, 1.1, p.z + Math.cos(p.angle) * 0.9);

    // Sun and its shadow box follow the camera target, snapped to whole units to limit shimmer.
    const tx = Math.round(this.camTarget.x), tz = Math.round(this.camTarget.z);
    this.sun.position.set(tx - 14, 30, tz + 8);
    this.sun.target.position.set(tx, 0, tz);
    this.sun.target.updateMatrixWorld();

    this.drawZombies(game);
    this.drawBullets(game);
    this.drawParticles(game);
    this.drawDecals(game);
    this.gl.render(this.scene, this.camera);
  }

  private drawZombies(game: Game) {
    const zs = game.zombies, mesh = this.zombieMesh;
    const a = mesh.instanceMatrix.array as Float32Array;
    const col = mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < zs.n; i++) {
      const fl = zs.flash[i];
      const sc = 1 + fl * 1.5;
      const bob = Math.abs(Math.sin(zs.phase[i])) * 0.07;
      const y = (zs.rise[i] - 1) * 1.6 + bob;
      writeMatrix(a, i, zs.angle[i], sc, sc, sc, zs.x[i], y, zs.z[i]);
      const t = fl > 0 ? 4 : zs.tint[i];
      col[i * 3] = t; col[i * 3 + 1] = t; col[i * 3 + 2] = t;
    }
    markDirty(mesh, zs.n);
  }

  private drawBullets(game: Game) {
    const b = game.bullets, mesh = this.bulletMesh;
    const a = mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < b.n; i++) {
      writeMatrix(a, i, Math.atan2(b.vx[i], b.vz[i]), 0.07, 0.07, 0.7, b.x[i], 0.98, b.z[i]);
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
      const i = k % DECAL_CAP, s = fx.decalScale[i];
      writeMatrix(a, i, fx.decalRot[i], s, 1, s, fx.decalX[i], 0.01, fx.decalZ[i]);
    }
    this.decalsDrawn = fx.decalCount;
    mesh.count = Math.min(fx.decalCount, DECAL_CAP);
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.needsUpdate = true;
  }
}
