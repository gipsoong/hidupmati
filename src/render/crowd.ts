import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

/** Baked animation sample rate. Frames are not interpolated, so this keeps motion smooth. */
const FPS = 60;

export interface BakedClip {
  /** First texture row of this clip. */
  start: number;
  frames: number;
  duration: number;
}

const VAT_PARS = /* glsl */ `
uniform highp sampler2D vatBones;
attribute vec3 vatFrames;
#ifndef USE_SKINNING
attribute vec4 skinIndex;
attribute vec4 skinWeight;
#endif
mat4 vatBone(int row, float bone) {
  int x = int(bone) * 3;
  vec4 r0 = texelFetch(vatBones, ivec2(x, row), 0);
  vec4 r1 = texelFetch(vatBones, ivec2(x + 1, row), 0);
  vec4 r2 = texelFetch(vatBones, ivec2(x + 2, row), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
mat4 vatSkin(float rowF) {
  int row = int(rowF);
  return vatBone(row, skinIndex.x) * skinWeight.x + vatBone(row, skinIndex.y) * skinWeight.y
       + vatBone(row, skinIndex.z) * skinWeight.z + vatBone(row, skinIndex.w) * skinWeight.w;
}
`;
const VAT_MATRIX = /* glsl */ `mat4 vatM = vatSkin(vatFrames.x);
if (vatFrames.z > 0.001) vatM = vatM * (1.0 - vatFrames.z) + vatSkin(vatFrames.y) * vatFrames.z;`;

/** Patch a built-in material so each instance plays a baked skeletal animation. */
function patchMaterial(mat: THREE.Material, tex: THREE.DataTexture, withNormals: boolean) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.vatBones = { value: tex };
    let vs = shader.vertexShader.replace('#include <common>', `#include <common>\n${VAT_PARS}`);
    if (withNormals) {
      vs = vs
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${VAT_MATRIX}\nobjectNormal = mat3(vatM) * objectNormal;`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = (vatM * vec4(transformed, 1.0)).xyz;');
    } else {
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VAT_MATRIX}\ntransformed = (vatM * vec4(transformed, 1.0)).xyz;`);
    }
    shader.vertexShader = vs;
  };
  mat.customProgramCacheKey = () => (withNormals ? 'vat' : 'vat-depth');
}

/**
 * Skinned glTF character drawn as one InstancedMesh. Every clip is sampled once into a float
 * texture of bone matrices; the vertex shader skins each instance from its own frame, so
 * hundreds of animated characters cost one draw call and no per-character CPU skinning.
 */
export class BakedCrowd {
  readonly mesh: THREE.InstancedMesh;
  readonly clips: Record<string, BakedClip> = {};
  private readonly frames: THREE.InstancedBufferAttribute;

  constructor(gltf: GLTF, clipNames: string[], cap: number, height: number) {
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const skinned: THREE.SkinnedMesh[] = [];
    root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
    const ref = skinned[0];
    const skeleton = ref.skeleton;
    const boneCount = skeleton.bones.length;

    // Scale to the wanted height, feet on y = 0, centred on the origin.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const s = height / size.y;
    const norm = new THREE.Matrix4().makeScale(s, s, s)
      .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));

    const clips = clipNames.map((n) => {
      const c = THREE.AnimationClip.findByName(gltf.animations, n);
      if (!c) throw new Error(`missing clip ${n}`);
      return c;
    });
    let rows = 0;
    for (const c of clips) {
      const frames = Math.max(1, Math.ceil(c.duration * FPS));
      this.clips[c.name] = { start: rows, frames, duration: c.duration };
      rows += frames;
    }

    // Per bone and frame: norm * meshWorld * bindInverse * boneMatrix * bind, stored as 3 rows of 4.
    const data = new Float32Array(boneCount * 3 * 4 * rows);
    const mixer = new THREE.AnimationMixer(root);
    const pre = new THREE.Matrix4().multiplyMatrices(norm, ref.matrixWorld).multiply(ref.bindMatrixInverse);
    const m = new THREE.Matrix4(), bm = new THREE.Matrix4();
    for (const clip of clips) {
      const info = this.clips[clip.name];
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      for (let f = 0; f < info.frames; f++) {
        mixer.setTime(Math.min(f / FPS, clip.duration));
        root.updateMatrixWorld(true);
        skeleton.update();
        for (let b = 0; b < boneCount; b++) {
          bm.fromArray(skeleton.boneMatrices!, b * 16);
          m.multiplyMatrices(pre, bm).multiply(ref.bindMatrix);
          const e = m.elements, o = ((info.start + f) * boneCount + b) * 12;
          data[o] = e[0]; data[o + 1] = e[4]; data[o + 2] = e[8]; data[o + 3] = e[12];
          data[o + 4] = e[1]; data[o + 5] = e[5]; data[o + 6] = e[9]; data[o + 7] = e[13];
          data[o + 8] = e[2]; data[o + 9] = e[6]; data[o + 10] = e[10]; data[o + 11] = e[14];
        }
      }
      action.stop();
    }
    const tex = new THREE.DataTexture(data, boneCount * 3, rows, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;

    // All parts share one skeleton; merge them into a single geometry with material groups.
    const geos = skinned.map((sm) => {
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
        g.setAttribute(name, sm.geometry.getAttribute(name));
      }
      g.setIndex(sm.geometry.getIndex());
      return g;
    });
    const geometry = mergeGeometries(geos, true)!;
    const materials = skinned.map((sm) => {
      const src = sm.material as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshLambertMaterial({ map: src.map });
      patchMaterial(mat, tex, true);
      return mat;
    });

    this.frames = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.frames.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('vatFrames', this.frames);

    this.mesh = new THREE.InstancedMesh(geometry, materials, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    patchMaterial(depth, tex, false);
    this.mesh.customDepthMaterial = depth;
  }

  /** Texture row for a clip at time t (looping or clamped to the last frame). */
  row(clip: string, t: number, loop: boolean): number {
    const c = this.clips[clip];
    let f = Math.floor(t * FPS);
    f = loop ? ((f % c.frames) + c.frames) % c.frames : Math.min(c.frames - 1, Math.max(0, f));
    return c.start + f;
  }

  /** Set instance i: show `row`, cross-faded from `prevRow` by `fade` (1 = all previous). */
  setFrame(i: number, row: number, prevRow: number, fade: number): void {
    const a = this.frames.array as Float32Array;
    a[i * 3] = row;
    a[i * 3 + 1] = prevRow;
    a[i * 3 + 2] = fade;
  }

  commit(n: number): void {
    const m = this.mesh;
    m.count = n;
    for (const attr of [m.instanceMatrix, m.instanceColor!, this.frames]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
}
