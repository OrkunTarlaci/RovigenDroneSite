// ==========================================================================
// AERON — droneModel.js
// Loads each drone GLB ONCE, analyzes its true geometry (bounding box,
// front/rear hints from node names) and builds a SIMPLE, static rig:
//
//   orientationGroup   <- fixed local forward-axis correction (from real
//                          GLB geometry, so canonical "forward" = +Z)
//        └── normalizedDroneModel  <- centered + normalized GLB
//
// There is no flight/curve/bank/idle hierarchy any more. Each drone stage
// (see droneStage.js) wraps this in exactly ONE extra group — a "spin" group
// that owns rotation.y only, animated between two fixed angles. Position is
// never touched after creation.
//
// The GLB is analyzed at runtime rather than assuming a fixed export
// convention: node names are inspected for front-sensor / battery hints to
// compute a real forward vector, and a debug calibration mode (?debug=1)
// lets you fine-tune the correction visually and read the exact value to
// hard-code once you're happy with it.
// ==========================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

// Hero stage model ("Gökyüzünden bakınca hikâye değişir.") — the site's
// MAIN drone. Relative path so it keeps resolving correctly under a GitHub
// Pages project subpath (e.g. https://user.github.io/repo/) — never made
// absolute/root-based.
export const MODEL_URL_MINI3 = './models/dji_mini_3_pro.glb';

// Cinematic (dark, "KADRAJ BİZİM İÇİN HER ŞEY" / "Görmek değil. Doğru
// yerden göstermek.") stage model. Also used by the manifesto ("Doğru
// görüntüyü yakalamak başka bir iş.") stage. Same relative-path rule
// applies.
export const MODEL_URL_MAVIC3 = './models/dji_mavic_3.glb';

// Target size (world units) for the model's largest bounding-box dimension
// after normalization. Shared by every model so all stages read at a
// visually consistent "product photography" scale.
const NORMALIZED_SIZE = 1.6;

// Manual correction fallback (radians) applied on top of the auto-detected
// forward vector, in case the auto heuristic needs a nudge. Tune this via
// the debug calibration panel (?debug=1) then copy the value here.
// dji_mini_3_pro.glb has usable FRONT_VISION / BAT_TOP_COVER node-name hints,
// so its auto-detected forward vector is normally accurate on its own.
export const MANUAL_ORIENTATION_OFFSET_Y = 0;

// dji_mavic_3.glb (Sketchfab export) ships with generic node names
// (Object_7, JT_01_11, polySurface184_2, ...) with no front/rear hints, so
// the name-based auto-detection cannot find a forward vector for it and
// autoYawCorrection resolves to 0.
//
// Best-effort starting value below was determined from the model's raw
// bounding-box geometry (the end of the model with the narrower/lower
// profile — consistent with a camera/gimbal nose tapering in front of the
// wider battery/body mass — was taken as the front, at +Z, needing no
// additional flip). This is a geometry-only estimate, not a name-based
// certainty. Re-verify with `?debug=1` (look at the cinematic/manifesto
// stage's drone with the AxesHelper shown) and drag the yaw slider if a
// visual check ever suggests the nose is reading backwards, then copy the
// corrected value here.
export const MANUAL_ORIENTATION_OFFSET_Y_MAVIC3 = 0;

const isDebug = new URLSearchParams(window.location.search).has('debug');

function isFrontHintName(name) {
  const n = name.toLowerCase();
  return n.includes('vision') || n.includes('front_rear') || n.includes('front_cg');
}

function isRearHintName(name) {
  const n = name.toLowerCase();
  return n.includes('bat_top_cover') || n.includes('bat_bot_cover') || n.includes('power_button');
}

// Each distinct GLB URL is fetched over the network exactly ONCE and
// cached here (keyed by URL) as a template scene. Every caller (hero
// stage, cinematic stage, capture stage, ...) gets its own independent
// THREE.Group by cloning the matching template (via SkeletonUtils.clone),
// then runs the SAME analysis/rig-building pipeline on that clone. So
// there is exactly one network request per unique model URL, no matter
// how many stages end up using it.
const templatePromises = new Map();

function loadTemplateScene(modelUrl) {
  if (!templatePromises.has(modelUrl)) {
    templatePromises.set(
      modelUrl,
      new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
          modelUrl,
          (gltf) => resolve(gltf.scene),
          undefined,
          (err) => reject(err)
        );
      })
    );
  }
  return templatePromises.get(modelUrl);
}

/**
 * Loads a model (once per URL, network-wise) and returns a fresh,
 * independent rig: { orientationGroup, normalizedDroneModel, autoYawCorrection }.
 * Safe to call multiple times, including with different `modelUrl` values —
 * repeated calls for the same URL clone the already-loaded template
 * instead of re-downloading the GLB.
 *
 * `manualOrientationOffsetY` is the per-model manual yaw correction (see
 * MANUAL_ORIENTATION_OFFSET_Y / MANUAL_ORIENTATION_OFFSET_Y_MAVIC3 above)
 * — it MUST match whichever model `modelUrl` points at, since each model
 * has its own unrelated auto-detected forward vector.
 */
export async function loadDroneRig(modelUrl = MODEL_URL_MINI3, manualOrientationOffsetY = MANUAL_ORIENTATION_OFFSET_Y) {
  const template = await loadTemplateScene(modelUrl);
  const rawModel = cloneSkeleton(template);
  return buildRig(rawModel, manualOrientationOffsetY);
}

function buildRig(rawModel, manualOrientationOffsetY) {
  // ---- 1. Real bounding box analysis (THREE.Box3) ----
  const box = new THREE.Box3().setFromObject(rawModel);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const scaleFactor = maxDim > 0 ? NORMALIZED_SIZE / maxDim : 1;

  // ---- 2. Collect front / rear hint positions from real node names ----
  const frontPoints = [];
  const rearPoints = [];
  const materialLog = new Set();
  const materialCloneCache = new WeakMap();

  rawModel.traverse((node) => {
    if (node.isMesh) {
      const worldPos = new THREE.Vector3();
      node.getWorldPosition(worldPos);

      if (isFrontHintName(node.name)) frontPoints.push(worldPos);
      if (isRearHintName(node.name)) rearPoints.push(worldPos);

      applyMaterialFixes(node, materialCloneCache, materialLog);
    }
  });

  // ---- 3. Compute forward vector on the XZ plane from real geometry ----
  let autoYawCorrection = 0;
  if (frontPoints.length && rearPoints.length) {
    const frontAvg = averageVectors(frontPoints);
    const rearAvg = averageVectors(rearPoints);
    const forward = new THREE.Vector3().subVectors(frontAvg, rearAvg);
    forward.y = 0;
    if (forward.lengthSq() > 1e-6) {
      // We want "forward" to end up pointing toward +Z (toward the camera/user).
      const angleToPositiveZ = Math.atan2(forward.x, forward.z);
      autoYawCorrection = angleToPositiveZ;
    }
  }

  if (isDebug) {
    console.log('[Drone Orientation] front hint meshes:', frontPoints.length);
    console.log('[Drone Orientation] rear hint meshes:', rearPoints.length);
    console.log('[Drone Orientation] auto yaw correction (rad):', autoYawCorrection);
    console.log('[Drone BBox] size:', size, 'center:', center, 'scaleFactor:', scaleFactor);
    console.log(
      '[AERON Drone Axis] Detected forward axis: +Z (canonical, after orientationGroup correction)\n' +
        `  Forward correction yaw (rad): ${(autoYawCorrection + manualOrientationOffsetY).toFixed(3)}` +
        ` (auto ${autoYawCorrection.toFixed(3)} + manual ${manualOrientationOffsetY.toFixed(3)})\n` +
        '  Each drone stage adds its own static three-quarter offset + animated spin on top of this.'
    );
  }

  // ---- 4. Build normalized model: center at origin, uniform scale ----
  const normalizedDroneModel = new THREE.Group();
  normalizedDroneModel.name = 'normalizedDroneModel';
  rawModel.position.sub(center);
  const centeringWrapper = new THREE.Group();
  centeringWrapper.add(rawModel);
  centeringWrapper.scale.setScalar(scaleFactor);
  normalizedDroneModel.add(centeringWrapper);

  // ---- 5. Orientation group: fixed correction so canonical "forward" = +Z ----
  const orientationGroup = new THREE.Group();
  orientationGroup.name = 'orientationGroup';
  orientationGroup.rotation.y = autoYawCorrection + manualOrientationOffsetY;
  orientationGroup.add(normalizedDroneModel);

  if (isDebug) {
    const axes = new THREE.AxesHelper(1.2);
    orientationGroup.add(axes);
    console.log(`[Drone Material] ${materialLog.size} unique materials logged above.`);
  }

  return {
    orientationGroup,
    normalizedDroneModel,
    autoYawCorrection,
  };
}

/**
 * Computes the real world-space bounding box of a rig's orientationGroup as
 * currently posed (whatever rotation its ancestors have right now), using
 * an actual THREE.Box3().setFromObject() pass — not a guessed size. Used by
 * each drone stage to fit its own camera distance to the model via real
 * geometry rather than assuming a fixed distance (each stage's container
 * has a different aspect ratio / size).
 */
export function computeFrameBox(orientationGroup) {
  orientationGroup.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(orientationGroup);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return { box, size, center };
}

function averageVectors(vectors) {
  const sum = new THREE.Vector3();
  vectors.forEach((v) => sum.add(v));
  sum.divideScalar(vectors.length);
  return sum;
}

// Ensures materials are not accidentally transparent/incorrect, preserves
// existing maps (albedo/normal/roughness/metalness), and only treats
// meshes as optical/glass when their name genuinely hints at it.
function applyMaterialFixes(mesh, cloneCache, materialLog) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  materials.forEach((mat, idx) => {
    if (!mat) return;

    const nameHint = `${mesh.name} ${mat.name || ''}`.toLowerCase();
    const isOpticalCandidate = /glass|crystal|optic|lens|sensor/.test(nameHint);

    // Clone once per unique source material (WeakMap keeps a single clone).
    let workingMat = mat;
    if (!isOpticalCandidate) {
      if (!cloneCache.has(mat)) {
        cloneCache.set(mat, mat);
      }
      workingMat = cloneCache.get(mat);

      if (workingMat.transparent && !isOpticalCandidate) {
        workingMat.transparent = false;
        workingMat.opacity = 1;
      }
      workingMat.depthWrite = true;
      workingMat.depthTest = true;
      workingMat.side = THREE.FrontSide;
    }

    if (Array.isArray(mesh.material)) {
      mesh.material[idx] = workingMat;
    } else {
      mesh.material = workingMat;
    }

    if (isDebug && !materialLog.has(workingMat.uuid)) {
      materialLog.add(workingMat.uuid);
      console.log(
        `[Drone Material] name="${workingMat.name || '(unnamed)'}" ` +
          `transparent=${workingMat.transparent} opacity=${workingMat.opacity} ` +
          `side=${workingMat.side} depthWrite=${workingMat.depthWrite} ` +
          `hasMap=${!!workingMat.map} hasNormalMap=${!!workingMat.normalMap} ` +
          `roughness=${workingMat.roughness} metalness=${workingMat.metalness}`
      );
    }
  });
}

// ---- Debug calibration panel (only when ?debug=1) ----
// `constantName` tells the person which exported constant in this file to
// paste the final value into (MANUAL_ORIENTATION_OFFSET_Y for the Mini 3
// Pro model, MANUAL_ORIENTATION_OFFSET_Y_MAVIC3 for the Mavic 3 model,
// used by both the cinematic and manifesto stages) so a multi-stage page
// doesn't get them mixed up.
let debugPanelCount = 0;

export function mountDebugPanel(orientationGroup, autoYawCorrection, constantName = 'MANUAL_ORIENTATION_OFFSET_Y') {
  if (!isDebug) return;

  const bottomOffset = 16 + debugPanelCount * 190;
  debugPanelCount += 1;

  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed; left: 16px; bottom: ${bottomOffset}px; z-index: 9998;
    background: rgba(20,20,15,0.9); color: #F2F2F0; padding: 14px 16px;
    font-family: monospace; font-size: 12px; border-radius: 8px; width: 280px;
  `;
  panel.innerHTML = `
    <div style="margin-bottom:8px;">DEBUG: forward-axis calibration (${constantName})</div>
    <label>Yaw correction (rad): <span id="dbg-yaw-val-${constantName}">${orientationGroup.rotation.y.toFixed(3)}</span></label><br/>
    <input id="dbg-yaw-${constantName}" type="range" min="-3.1416" max="3.1416" step="0.01"
      value="${orientationGroup.rotation.y}" style="width:100%" />
    <div style="margin-top:8px;opacity:0.7;">Auto-detected: ${autoYawCorrection.toFixed(3)} rad.<br/>
    Copy the final value into <strong>${constantName}</strong> in droneModel.js.<br/>
    Per-stage three-quarter start angles live in droneStage.js.</div>
  `;
  document.body.appendChild(panel);

  const slider = panel.querySelector(`#dbg-yaw-${constantName}`);
  const valLabel = panel.querySelector(`#dbg-yaw-val-${constantName}`);
  slider.addEventListener('input', () => {
    orientationGroup.rotation.y = parseFloat(slider.value);
    valLabel.textContent = slider.value;
    console.log(`[Drone Orientation] ${constantName} manual yaw ->`, slider.value);
  });
}
