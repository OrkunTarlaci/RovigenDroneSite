// ==========================================================================
// AERON — scene.js
// Shared studio lighting rig, used identically by every drone stage (hero
// + cinematic — see droneStage.js) so the drone is lit consistently
// everywhere it appears. No postprocessing (bloom/DOF/SSAO) — clean
// product lighting instead, tuned to keep the light gray/white drone
// readable against both the light hero background and the dark cinematic
// section.
// ==========================================================================

import * as THREE from 'three';

/**
 * `dark: true` is used for the cinematic stage, which sits on a charcoal
 * background: hemisphere fill and rim light are boosted a little so the
 * light gray/white body, gimbal and props stay readable (not a black
 * silhouette) without blowing out to pure white.
 */
export function createStudioLights(scene, { dark = false } = {}) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3d3d3a, dark ? 1.05 : 0.85);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
  keyLight.position.set(3.2, 3.6, 4.2);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, dark ? 0.75 : 0.55);
  fillLight.position.set(-3.6, 1.2, 2.2);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 1.1);
  rimLight.position.set(-1.4, 2.4, -4.4);
  scene.add(rimLight);

  // A cooler rim specifically for the dark cinematic section so the light
  // gray body separates cleanly from the charcoal background.
  const cinematicRim = new THREE.DirectionalLight(0xf5f5f0, dark ? 0.9 : 0);
  cinematicRim.position.set(0.6, 1.8, -3.8);
  scene.add(cinematicRim);

  return { hemi, keyLight, fillLight, rimLight, cinematicRim };
}
