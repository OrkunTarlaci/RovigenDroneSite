// ==========================================================================
// AERON — droneStage.js
//
// Replaces the old S-curve / screen-space flight-path system entirely.
// There are exactly three 3D drone stages on the whole page, and exactly
// three drone models in the whole project — one per stage, 1:1:
//
//   1. .hero-drone-stage       (inside #hero)       — dji_mini_3_pro.glb
//      "Gökyüzünden bakınca hikâye değişir." — the site's MAIN drone.
//   2. .capture-drone-stage    (inside #manifesto)   — dji_mavic_3.glb
//      "Doğru görüntüyü yakalamak başka bir iş." — drone sits left of text.
//   3. .cinematic-drone-stage  (inside #cinematic, dark section) — dji_mavic_3.glb
//      "KADRAJ BİZİM İÇİN HER ŞEY" / "Görmek değil. Doğru yerden göstermek."
//      — drone sits left of text.
//
// Nowhere else, and no other GLB is ever loaded. Each stage:
//   - gets its OWN <canvas>, scene, camera and renderer, mounted directly
//     inside its own container by normal DOM flow (no fixed full-page
//     canvas, no getBoundingClientRect chasing, no scroll-driven position).
//   - loads its assigned GLB (one of the three model URLs, see
//     droneModel.js) and clones its own rig instance from a per-URL cached
//     template — one network request per unique model URL, however many
//     stages end up using it.
//   - keeps its model's POSITION fixed at the origin forever. Position is
//     set once and never written to again.
//   - only ever animates rotation.y (yaw), using a plain time-based GSAP
//     tween (never tied to scroll progress) so it keeps turning even while
//     the user is standing still on the page. All three stages spin
//     continuously through a full 360°, forever, in one direction — no
//     S-curve, no position animation, no scroll-driven animation.
//   - pauses its render loop while its container is off-screen
//     (IntersectionObserver) and resumes from wherever the yaw currently
//     is — no jump, no reset.
//
// This is the SAME code for mobile and desktop; only the CSS sizing of
// .hero-drone-stage / .cinematic-drone-stage / .capture-drone-stage differs
// per breakpoint. There is no separate "desktop system" / "mobile system"
// any more.
//
// ONE MOBILE-ONLY EXCEPTION — "the hero drone takes over the manifesto
// spot": on mobile (see initDroneStages), stage #2 above (.capture-drone-
// stage, dji_mavic_3.glb) is never instantiated at all — no canvas, no
// model, no second drone instance. Instead, the hero drone's one-time
// intro flight (see playHeroFlightIntro / HERO_FLIGHT_MOBILE) no longer
// stops inside the hero section: it keeps flying, past the hero's own
// old resting spot, down to the exact screen position the manifesto
// stage's drone would otherwise occupy (measured live off
// .capture-drone-stage's own getBoundingClientRect, see
// getMobileHeroScreenPoints), and parks there for good. It is still the
// SAME mini3Pro rig instance the whole time — never a clone, never a
// teleport, never a model swap/crossfade — just one continuous flight
// curve that now happens to be longer. Desktop is completely unaffected:
// stage #2 is always created on desktop and dji_mavic_3.glb still renders
// there exactly as before.
// ==========================================================================

import * as THREE from 'three';
import { createStudioLights } from './scene.js';
import {
  loadDroneRig,
  computeFrameBox,
  mountDebugPanel,
  MODEL_URL_MINI3,
  MODEL_URL_MAVIC3,
  MANUAL_ORIENTATION_OFFSET_Y,
  MANUAL_ORIENTATION_OFFSET_Y_MAVIC3,
} from './droneModel.js';

const CAMERA_FOV_DEG = 32;
const FRAME_OCCUPANCY = 0.82; // drone fills ~82% of its stage's frustum at rest

const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)';

// ---------------------------------------------------------------------
// DESKTOP fit multiplier — byte-for-byte the same values/formula this
// project already shipped with. Desktop composition is NOT touched by
// this revision.
const DESKTOP_VISUAL_SCALE = {
  mini3Pro: 1.25, // hero
  manifesto: 1.25, // manifesto ("Doğru görüntüyü yakalamak başka bir iş.") — now dji_mavic_3.glb
  mavic3: 1.0, // cinematic (dark section)
};

// ---------------------------------------------------------------------
// MOBILE fit — a precise, per-model, per-axis camera fit (replaces the
// old single-multiplier-on-a-conservative-radius approach for mobile
// only; desktop is unaffected).
//
// The previous mobile fit bounded every model with one "radius" = half of
// its full 3D bounding-box diagonal. That radius is safe but wasteful for
// a drone shape: a drone is much thinner top-to-bottom than it is wide,
// so a lot of the frustum's vertical headroom was reserved for a height
// the model never actually uses, which is exactly why the drones still
// read small on a real phone despite already having a >1x mobile
// multiplier.
//
// Here we fit height and width independently:
//   halfY       — the model's real half-height. This never changes as
//                 the model spins around Y, so it is an EXACT bound, not
//                 a worst-case guess.
//   halfXWorst  — the true worst-case half-width the model's silhouette
//                 ever reaches on screen during a full continuous 360°
//                 spin. Found by normalizing each GLB exactly the way
//                 buildRig() does (center + scale to NORMALIZED_SIZE),
//                 then numerically sweeping every real mesh vertex
//                 through a full rotation (0.5° steps) and recording the
//                 maximum world-space X extent reached — the actual
//                 measured worst case for this specific, irregular drone
//                 mesh, not an idealized bounding-box-corner estimate
//                 (which is a poor stand-in for a shape this irregular —
//                 arms/props don't sit at the box's corners).
// Both values are already in NORMALIZED_SIZE (1.6) units — the same space
// buildRig() normalizes every model into — so they can be used directly
// with no extra scaling.
//
// These numbers are tied to the exact geometry of the three shipped
// GLBs. They only need to be recalculated (re-run the same offline
// normalize + full-rotation sweep) if one of the three models is ever
// swapped for a different one.
const MOBILE_FIT = {
  mini3Pro: { halfY: 0.2326, halfXWorst: 0.8413 }, // dji_mini_3_pro.glb
  // manifesto stage now renders dji_mavic_3.glb, so it uses the same
  // measured figures as the mavic3 entry below (same GLB, same geometry).
  manifesto: { halfY: 0.1961, halfXWorst: 0.8583 }, // dji_mavic_3.glb
  mavic3: { halfY: 0.1961, halfXWorst: 0.8583 }, // dji_mavic_3.glb
};

// Fraction of the frustum the worst-case footprint above is allowed to
// fill. 0.98 leaves a hair of margin under an exact edge-to-edge fit.
// Because halfXWorst is a real measured worst case (not an
// approximation), this guarantees the drone — props, arms, body — never
// leaves the canvas at ANY point of its continuous spin on mobile, not
// only at the specific angles used for QA.
const MOBILE_TARGET_FILL = 0.98;

function isMobileViewport() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches
  );
}

// ---------------------------------------------------------------------
// Per-stage tuning. `startAngleDeg` is the STATIC three-quarter product
// angle each stage holds at rest before its spin picks up from there.
//
// All three stages (hero: dji_mini_3_pro.glb, manifesto + cinematic:
// dji_mavic_3.glb) spin CONTINUOUSLY through a full 360°, forever,
// starting from this angle — never a back-and-forth yoyo, never a
// position change.
//
// These angles are deliberately different per stage: the hero shows a
// front three-quarter (nose + one side + gimbal readable), the manifesto
// stage shows the front camera/gimbal + one side + arms/props at once, and
// the cinematic stage shows a different three-quarter (a bit lower /
// opposite side) so the gimbal/underside reads differently there. All are
// authored on top of each model's own auto-detected forward correction
// (see droneModel.js), so they stay correct even if a GLB is swapped.
//
// Tune these numbers visually (?debug=1 + eyeballing each stage) if the
// angle doesn't look right for a given model.
// ---------------------------------------------------------------------
const HERO_START_ANGLE_DEG = 35; // dji_mini_3_pro.glb — front three-quarter, nose+side+gimbal readable
const MANIFESTO_START_ANGLE_DEG = 35; // dji_mavic_3.glb (manifesto stage) — front three-quarter, gimbal/arms/props readable
const CINEMATIC_START_ANGLE_DEG = -150; // dji_mavic_3.glb (dark stage) — opposite three-quarter, lower/gimbal-forward feel

// Every stage's duration is "seconds per full 360° revolution" — a slow,
// continuous, single-direction turn, never a yoyo.
const HERO_SPIN_DURATION_SEC = 28;
const MANIFESTO_SPIN_DURATION_SEC = 30;
const CINEMATIC_SPIN_DURATION_SEC = 32;

// ---------------------------------------------------------------------
// HERO INTRO FLIGHT — a one-time, position+banking entrance for the hero
// drone only. Manifesto and cinematic stages never use any of this.
//
// Architecture (see createStageScene): mount -> flightRig -> spinRig ->
// orientationGroup. flightRig.position is used ONLY by this intro flight;
// flightRig.rotation.x/z is used ONLY for the very light in-flight
// banking. spinRig.rotation.y keeps doing exactly what it always did
// (the continuous 360° yaw spin) — it is never touched by this system
// except for one static hold (the entry yaw below) and one settle-tween
// into the resting product angle, and those two things always finish
// strictly before startContinuousSpin ever starts, so nothing fights
// over the same property at the same time.
//
// MOTION MODEL — single continuous parametric curve, not three separate
// position tweens. Desktop builds a THREE.CatmullRomCurve3 through its
// existing start/wp1/wp2/final points (same visual route it always had);
// mobile builds a dedicated THREE.CubicBezierCurve3 (see
// createDesktopHeroFlightCurve / createMobileHeroFlightCurve below).
// Either way GSAP only ever animates one scalar progress value
// (flightProgress.t, 0 -> 1); every frame reads flightRig's position off
// curve.getPointAt(t) (arc-length parameterized, so motion doesn't
// silently speed up/slow down at any particular point on the curve
// itself — all deliberate acceleration/deceleration comes from the GSAP
// ease on t, not the curve geometry). This removes any waypoint seam:
// there is no frame at which velocity direction can jump, because there
// is no second tween starting where a first one ends.
//
// Banking (flightRig.rotation.x/z only — spinRig.rotation.y, the
// continuous yaw spin, is untouched by this) is likewise derived from
// the curve itself via curve.getTangentAt(t) instead of a third set of
// waypoint rotation tweens — see updateHeroFlightBanking. It fades out
// (via bankTuning.settleFrom) as the drone nears its final position, and
// the completion handler pins flightRig.rotation to exactly (0,0,0) as a
// safety net against any float drift.
//
// Points are in the same normalized scene units buildRig() uses
// (NORMALIZED_SIZE = 1.6). Desktop's are untouched from the previous
// revision (composition/on-screen route unchanged). Mobile's are a new,
// screen-geometry-specific set: entry from the upper right, cutting down
// and left, settling into the final position — see createMobileHeroFlightCurve.
//
// Tune these visually (?debug=1 + eyeballing the hero stage) — they are
// starting points, not exact required values.
const HERO_ENTRY_YAW_DEG = -50; // static yaw the drone holds while flying in
const HERO_FLIGHT_DESKTOP_DURATION_SEC = 3.0; // desktop intro length — unchanged
// Mobile intro length. Longer than before (was 2.5s) because the route no
// longer ends inside the hero section — it now continues all the way down
// to the manifesto stage's screen position (see the "MOBILE TAKEOVER" note
// at the top of this file), so it needs a bit more time to still read as a
// smooth, unhurried glide rather than a rushed dash across two sections.
const HERO_FLIGHT_MOBILE_DURATION_SEC = 6.0;

const HERO_FLIGHT_DESKTOP = {
  // Same three route points as before, byte-for-byte — only HOW they're
  // connected changed (one continuous curve instead of two chained
  // tweens). Desktop's on-screen path/composition is unchanged.
  start: { x: 2.05, y: 1.35, z: -0.5 },
  wp1: { x: 1.3, y: 0.85, z: -0.05 },
  wp2: { x: 0.55, y: 0.32, z: 0.16 },
  bank: { start: -0.08 }, // flightRig.rotation.z at t=0
  pitch: { start: 0.05 }, // flightRig.rotation.x at t=0
  startDistanceMultiplier: 1.6, // camera pulled back 60% further at flight start
  bankTuning: {
    bankGainZ: 0.09, // rotation.z response to curve tangent.x
    bankGainX: 0.05, // rotation.x response to curve tangent.y
    maxBank: 0.1, // radians — clamp for both axes
    bankLerp: 0.07, // smoothing factor toward target bank each frame
    settleFrom: 0.85, // progress (0-1) at which banking starts fading to 0
  },
  // Yaw (spinRig.rotation.y) re-orientation from HERO_ENTRY_YAW_DEG to the
  // resting product angle. Starts well before the banking settle above so
  // the turn is spread across a long, continuous stretch of the flight
  // instead of being squeezed into its last few frames — see
  // updateHeroFlightYaw / the "TAK" fix note above playHeroFlightIntro.
  yawSettle: {
    from: 0.5, // progress (0-1) at which the yaw starts easing toward its resting angle
    lerp: 0.035, // per-frame shortest-angle smoothing factor (lower = slower/heavier turn)
  },
};

const HERO_FLIGHT_MOBILE = {
  // Dedicated mobile entry: starts near the hero title (upper-right of
  // the stage, comfortably INSIDE the camera's actual frustum at flight
  // start — not just "upper-right" in the abstract — so the drone is
  // visibly present from frame one instead of parked outside the visible
  // area and only becoming visible partway through the flight), glides
  // down and slightly left through control1, then control2 pulls
  // horizontal motion in and lets the curve settle vertically into the
  // final position without ever needing to cross over the hero title. A
  // single continuous CubicBezierCurve3 (see createMobileHeroFlightCurve)
  // — NOT three independent waypoint tweens. Existing MOBILE_FIT
  // sizing/visibility and the final (0,0,0) resting position/scale are
  // untouched.
  start: { x: 0.5, y: 0.42, z: -0.22 },
  control1: { x: 0.32, y: 0.22, z: -0.1 },
  control2: { x: 0.1, y: 0.08, z: 0.05 },
  bank: { start: -0.06 }, // flightRig.rotation.z at t=0
  pitch: { start: 0.04 }, // flightRig.rotation.x at t=0
  // Modest pull-back — just enough headroom for the curve's gentle
  // lateral motion. Kept low (vs. desktop's 1.6) so the drone reads at a
  // natural, prominent size immediately at flight start rather than
  // looking distant/zoomed-out.
  startDistanceMultiplier: 1.05,
  bankTuning: {
    bankGainZ: 0.1,
    bankGainX: 0.06,
    maxBank: 0.11,
    bankLerp: 0.08,
    settleFrom: 0.82,
  },
  yawSettle: {
    from: 0.45,
    lerp: 0.04,
  },
};

/**
 * Shortest-angle lerp — interpolates from `current` to `target` the short
 * way around the circle (never the "long way" through +-PI), so a yaw
 * re-orientation that straddles the -PI/+PI wraparound never reads as a
 * sudden 180-360° snap to the wrong side. `alpha` is a per-frame damping
 * factor (0-1), not an absolute duration, so the turn naturally eases out
 * as `current` approaches `target`.
 */
function lerpAngle(current, target, alpha) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * alpha;
}

function clampNum(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Converts a viewport pixel coordinate (`screenX`/`screenY`, e.g. from a
 * DOM `getBoundingClientRect()`) into a world-space X/Y on the flight
 * plane `planeZ`, for a stage's camera. Valid because every stage camera
 * is a plain axis-aligned perspective camera sitting on the +Z axis and
 * looking straight at the origin (see createStageScene) — no rotation,
 * no roll — so screen -> NDC -> world is just the FOV/aspect/distance
 * closed form below, no THREE.Camera.unproject() needed.
 *
 * `distance` is passed explicitly (rather than read off camera.position.z)
 * because the camera's actual live distance can be temporarily pulled
 * back by the hero intro flight's distanceMultiplier — callers need to
 * choose whether a given screen point should be interpreted at the
 * flight-start distance or the resting (1x) fit distance.
 */
function screenToWorldXY(container, camera, distance, screenX, screenY, planeZ) {
  const rect = container.getBoundingClientRect();
  const width = rect.width || 1;
  const height = rect.height || 1;
  const ndcX = ((screenX - rect.left) / width) * 2 - 1;
  const ndcY = -(((screenY - rect.top) / height) * 2 - 1);

  const vFovHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const distanceToPlane = distance - planeZ; // camera sits at +Z looking toward the origin
  const worldHalfHeight = distanceToPlane * Math.tan(vFovHalf);
  const worldHalfWidth = worldHalfHeight * camera.aspect;

  return { x: ndcX * worldHalfWidth, y: ndcY * worldHalfHeight, z: planeZ };
}

/**
 * Reconstructs, purely from the CURRENT DOM layout, the screen-space
 * START and END points the mobile hero flight should use — instead of
 * hardcoded pixel guesses — now that `.hero-drone-stage` is a full-hero
 * overlay (see the mobile CSS) rather than a small boxed stage:
 *
 *   START — beside "Gökyüzünden bakınca hikâye değişir.", measured off
 *   the title's real boundingClientRect, clamped so it never sits under
 *   the fixed navbar and never falls outside the stage.
 *
 *   END — NOT an arbitrary point: it's where the OLD boxed stage's
 *   center used to be (world (0,0,0) always renders at dead-center of
 *   whatever box a stage camera is looking at). That old box no longer
 *   exists in the DOM, but its geometry is fully determined by values
 *   that still do exist — `.hero-text`'s current rendered bottom edge,
 *   plus the old stage's own `margin-top: 28px` and
 *   `height: clamp(250px, 32svh, 340px)` — so it's reconstructed here
 *   rather than baked in as static numbers, and it keeps working
 *   correctly across every mobile width, not just 390px.
 */
function getMobileHeroScreenPoints(container) {
  const heroTitle = document.querySelector('.hero-title');
  const heroText = document.querySelector('.hero-text');
  const containerRect = container.getBoundingClientRect();

  if (!heroTitle || !heroText || !containerRect.width || !containerRect.height) return null;

  const titleRect = heroTitle.getBoundingClientRect();
  const heroTextRect = heroText.getBoundingClientRect();
  const navHeight =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 64;

  // START — right of the title, first-frame visible, never under the navbar.
  const startX = clampNum(
    containerRect.left + containerRect.width * 0.78,
    containerRect.left + containerRect.width * 0.55,
    containerRect.left + containerRect.width - 12
  );
  const startY = clampNum(
    titleRect.top + titleRect.height * 0.48,
    containerRect.top + navHeight + 20,
    containerRect.top + containerRect.height - 20
  );

  // END — MOBILE TAKEOVER. The hero drone no longer stops inside the hero
  // section at all: it keeps flying down and parks exactly where the
  // manifesto section's own drone stage (.capture-drone-stage — normally
  // dji_mavic_3.glb, but never instantiated on mobile; see
  // initDroneStages) sits on screen, so the SAME hero drone instance
  // visually takes that second drone's place. This is measured live off
  // .capture-drone-stage's own getBoundingClientRect() center — never a
  // hardcoded pixel guess — so it keeps landing in the right spot across
  // every mobile width and any future copy/layout change. Desktop is
  // untouched: this function is mobile-only, and desktop always
  // instantiates its own dji_mavic_3.glb in that stage instead.
  const captureStage = document.querySelector('.capture-drone-stage');
  let endX;
  let endY;
  if (captureStage) {
    const captureRect = captureStage.getBoundingClientRect();
    endX = captureRect.left + captureRect.width / 2;
    endY = captureRect.top + captureRect.height / 2;
  } else {
    // Fallback only — reconstructs the old in-hero resting spot so the
    // flight still lands somewhere sane if the manifesto stage element
    // isn't present for some reason (e.g. markup changed elsewhere).
    const OLD_STAGE_MARGIN_TOP = 28; // matches the previous `.hero-drone-stage { margin-top: 28px }`
    const oldBoxHeight = clampNum(window.innerHeight * 0.32, 250, 340); // matches clamp(250px, 32svh, 340px)
    const oldBoxTop = heroTextRect.bottom + OLD_STAGE_MARGIN_TOP;
    endX = containerRect.left + containerRect.width / 2;
    endY = oldBoxTop + oldBoxHeight / 2;
  }

  return { startX, startY, endX, endY };
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// ---------------------------------------------------------------------
// MOBILE HERO — bottom-only canvas/frustum extension.
//
// Root cause of the "drone's bottom half gets cut off" problem:
// `.hero-drone-stage` is a full-hero overlay on mobile (position:
// absolute; top: 0; bottom: 0 inside #hero), so its own box is exactly
// as tall as #hero happens to render. The hero drone's FINAL resting
// spot, though, is now the manifesto stage's own live screen position
// (see getMobileHeroScreenPoints / the "MOBILE TAKEOVER" note at the top
// of this file) — a screen point that is, by design, well BELOW
// `.hero-drone-stage`'s own box, since it sits inside the next section
// entirely, not inside the hero.
//
// That is a canvas *raster* problem, not a CSS overflow problem:
// `.hero-drone-stage` already has `overflow: visible`, but a WebGL
// canvas's drawable area is bounded by its own width/height (its pixel
// buffer), not by any parent's CSS overflow value — so once the drone's
// projected position falls past the bottom of that buffer, it is
// genuinely never drawn there, no matter what overflow says.
//
// Fix: on the mobile hero stage only, if the drone's actual final
// resting position would land below the container's own (symmetric)
// vertical frustum, extend ONLY the bottom bound of the frustum — via
// an asymmetric perspective projection matrix — by exactly enough world
// space to cover it (plus a small safety margin), and grow the canvas's
// own pixel buffer + DOM height to match. The top/left/right bounds
// (and therefore the drone's on-screen size at rest) are left byte-for-
// byte identical to the existing symmetric fit — this deliberately does
// NOT touch camera.fov/camera.aspect/distance (that would rescale the
// whole image and change the drone's apparent size). Every other stage,
// and desktop entirely, take the untouched `else` branch in
// fitAndResize below and are unaffected.
const HERO_MOBILE_BOTTOM_SAFETY_PX = 30;

// Reused across calls so fitAndResize (which can run repeatedly, e.g. on
// resize/orientation-change) never allocates a fresh Box3/Vector3 set per
// call.
const _mobileBottomExtBox = new THREE.Box3();
const _mobileBottomExtCorner = new THREE.Vector3();

/**
 * Measures the rig's REAL rendered bounding box at its exact final resting
 * pose (position + zero rotation — the same pose playHeroFlightIntro's
 * onComplete settles into) and projects it through the camera exactly the
 * way the GPU will, instead of trusting a single offline-measured
 * half-height constant (MOBILE_FIT.mini3Pro.halfY). A real projected Box3
 * catches anything that constant could miss or under-measure for this
 * specific mesh (landing legs, gimbal, drooping arms, whatever) — it's a
 * direct measurement of what will actually be drawn, not an assumption.
 *
 * `flightRig`/`orientationGroup` are temporarily moved/rotated to the
 * final pose to take the measurement, then restored to their exact prior
 * values before returning — this runs synchronously inside fitAndResize,
 * strictly before the next render() call, so nothing is ever visibly
 * disturbed by the probe.
 */
function computeHeroMobileBottomExtension(container, camera, width, height, distance, flightRig, orientationGroup) {
  const points = getMobileHeroScreenPoints(container);
  if (!points) return null;

  // Same unprojection computeMobileHeroFlightConfig uses for the actual
  // flight's FINAL point (rest distance, z = 0 plane) — kept in sync by
  // construction since both read off the live container rect + camera.
  const final = screenToWorldXY(container, camera, distance, points.endX, points.endY, 0);

  // Measure the rig at its real final pose (position = final, rotation =
  // 0 — exactly what onComplete pins it to) rather than trusting it's
  // still centered at the origin.
  const savedPos = flightRig.position.clone();
  const savedRot = flightRig.rotation.clone();
  flightRig.position.copy(final);
  flightRig.rotation.set(0, 0, 0);
  flightRig.updateMatrixWorld(true);

  _mobileBottomExtBox.setFromObject(orientationGroup);
  const box = _mobileBottomExtBox;

  // A symmetric baseline projection (matches the "canvas before any
  // extension" frame) so the measured screen-space Y values are relative
  // to the same bottom edge (`height`) the deficit check below compares
  // against.
  camera.updateProjectionMatrix();
  // camera.position/lookAt were already set earlier this same
  // fitAndResize call, but Vector3.project() reads camera.matrixWorldInverse,
  // which THREE only refreshes inside updateMatrixWorld() — never
  // implicitly on position/quaternion changes — so without this the
  // projection below could still use a stale matrix from the previous
  // frame.
  camera.updateMatrixWorld(true);

  // Only the box's bottom face can clip the bottom edge, so only those 4
  // corners need projecting.
  let worstScreenY = -Infinity;
  for (let xi = 0; xi < 2; xi++) {
    for (let zi = 0; zi < 2; zi++) {
      _mobileBottomExtCorner.set(xi ? box.max.x : box.min.x, box.min.y, zi ? box.max.z : box.min.z);
      _mobileBottomExtCorner.project(camera);
      const screenY = ((1 - _mobileBottomExtCorner.y) / 2) * height; // NDC [-1,1] -> pixels, 0 at top
      if (screenY > worstScreenY) worstScreenY = screenY;
    }
  }

  // Restore the probe's temporary pose immediately — nothing else has
  // rendered a frame in between.
  flightRig.position.copy(savedPos);
  flightRig.rotation.copy(savedRot);
  flightRig.updateMatrixWorld(true);

  const overflowPx = worstScreenY - height;
  if (overflowPx <= 0) return null; // already fully inside — nothing to do

  const worldHalfHeight = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const pxPerWorld = height / (2 * worldHalfHeight);
  const extraWorld = (overflowPx + HERO_MOBILE_BOTTOM_SAFETY_PX) / pxPerWorld;
  return { extraWorld, worldHalfHeight, pxPerWorld };
}

/**
 * Builds one independent scene/camera/renderer mounted inside `container`,
 * fit to the rig's real bounding-sphere so it fills the container nicely
 * regardless of the container's own aspect ratio.
 */
function createStageScene(container, orientationGroup, { dark = false, stageKey = null } = {}) {
  const scene = new THREE.Scene();
  scene.background = null;
  createStudioLights(scene, { dark });

  // `mount` is the ONLY object ever added to the scene. Its position is
  // set once, right here, and never touched again by anything.
  const mount = new THREE.Group();
  mount.position.set(0, 0, 0);
  scene.add(mount);

  // `flightRig` sits between the fixed mount and spinRig. It exists on
  // every stage for structural consistency, but only the hero stage's
  // intro flight (see playHeroFlightIntro) ever animates it — manifesto
  // and cinematic stages leave it at identity (0 position, 0 rotation)
  // forever, so nothing about their existing look or behavior changes.
  const flightRig = new THREE.Group();
  mount.add(flightRig);

  // `spinRig` only ever animates rotation.y. It sits between flightRig
  // and the model's own forward-axis correction group.
  const spinRig = new THREE.Group();
  spinRig.add(orientationGroup);
  flightRig.add(spinRig);

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.1, 100);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.domElement.classList.add('drone-stage-canvas');
  container.appendChild(renderer.domElement);

  // Camera distance multiplier — always 1 (normal, tight framing) except
  // during the hero stage's intro flight, which temporarily raises it
  // (pulling the camera back so the wider flight path stays inside the
  // frustum) then eases it back to exactly 1 by the time the drone
  // reaches its final position. `lastDistance` caches the last computed
  // "real" fit distance so setDistanceMultiplier can re-apply it
  // instantly, without re-running the fit math on every animation frame.
  let lastDistance = 0;
  const cameraState = { distanceMultiplier: 1 };

  function setDistanceMultiplier(multiplier) {
    cameraState.distanceMultiplier = multiplier;
    camera.position.set(0, 0, lastDistance * multiplier);
    camera.lookAt(0, 0, 0);
  }

  function fitAndResize() {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    camera.aspect = width / height;
    const vFov = THREE.MathUtils.degToRad(camera.fov);

    const mobileFit = stageKey ? MOBILE_FIT[stageKey] : null;
    let distance;

    if (mobileFit && isMobileViewport()) {
      // MOBILE — precise per-axis fit against each model's real half-height
      // and its true measured worst-case half-width across a full spin.
      // See MOBILE_FIT above for how these two numbers were derived.
      const { halfY, halfXWorst } = mobileFit;
      const fill = MOBILE_TARGET_FILL;
      const distanceForHeight = halfY / (fill * Math.tan(vFov / 2));
      const distanceForWidth = halfXWorst / (fill * Math.tan(vFov / 2) * camera.aspect);
      distance = Math.max(distanceForHeight, distanceForWidth);
    } else {
      // DESKTOP — unchanged. Fit distance computed from the rig's REAL
      // geometry (Box3), using the bounding-diagonal as a radius so the
      // fit is correct regardless of whether the container is wider or
      // taller than the model. Computed once, before any spin rotation is
      // applied. Because the model is normalized to be centered exactly
      // at this same origin (see buildRig() in droneModel.js) and every
      // stage only ever rotates around that origin, this radius safely
      // bounds the model at EVERY yaw angle it will ever pass through —
      // a full continuous 360° spin included, not just a 180° yoyo — so
      // the drone (props, arms, body) never clips outside its own canvas
      // at any point in the rotation.
      const { size } = computeFrameBox(orientationGroup);
      const radius = size.length() / 2 || 0.8;
      // Visual-size-only adjustment: multiplies how much of the frustum
      // the drone fills (bigger multiplier = camera sits closer = bigger
      // drone on screen). Does not touch radius/geometry, position, or
      // rotation.
      const desktopMultiplier = (stageKey && DESKTOP_VISUAL_SCALE[stageKey]) || 1.0;
      const occupancy = FRAME_OCCUPANCY * desktopMultiplier;
      const distanceForHeight = radius / (occupancy * Math.tan(vFov / 2));
      const hFovHalfTan = Math.tan(vFov / 2) * camera.aspect;
      const distanceForWidth = radius / (occupancy * hFovHalfTan);
      distance = Math.max(distanceForHeight, distanceForWidth);
    }

    lastDistance = distance;
    camera.position.set(0, 0, distance * cameraState.distanceMultiplier);
    camera.lookAt(0, 0, 0);

    // Mobile hero only — see computeHeroMobileBottomExtension above.
    // Every other stage/breakpoint takes the plain `else` path, byte-
    // for-byte identical to before this fix.
    const heroMobileExt =
      stageKey === 'mini3Pro' && isMobileViewport()
        ? computeHeroMobileBottomExtension(container, camera, width, height, distance, flightRig, orientationGroup)
        : null;

    if (heroMobileExt) {
      const { extraWorld, worldHalfHeight, pxPerWorld } = heroMobileExt;
      const worldHalfWidth = worldHalfHeight * camera.aspect;
      const extendedHeight = height + extraWorld * pxPerWorld;

      // Asymmetric frustum at the near plane: top/left/right identical
      // to the existing symmetric fit (camera.updateProjectionMatrix()
      // would produce the exact same top/left/right internally); only
      // bottom is pushed further down to cover the reconstructed final
      // resting point. Position/rotation/scale of the drone itself are
      // never touched — only how much of the scene the canvas shows.
      const nearScale = camera.near / distance;
      const topN = worldHalfHeight * nearScale;
      const bottomN = -(worldHalfHeight + extraWorld) * nearScale;
      const leftN = -worldHalfWidth * nearScale;
      const rightN = worldHalfWidth * nearScale;
      camera.projectionMatrix.makePerspective(leftN, rightN, topN, bottomN, camera.near, camera.far);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

      renderer.domElement.style.height = `${extendedHeight}px`;
      renderer.setSize(width, extendedHeight, false);
    } else {
      if (renderer.domElement.style.height) renderer.domElement.style.height = '';
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }
  }

  fitAndResize();

  const resizeObserver = new ResizeObserver(() => fitAndResize());
  resizeObserver.observe(container);

  function render() {
    renderer.render(scene, camera);
  }

  function destroy() {
    resizeObserver.disconnect();
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  // `getRestDistance` returns the plain fit distance (multiplier-free) —
  // i.e. exactly what the camera sits at once distanceMultiplier is back
  // to 1 — so callers unprojecting a screen point that's meant to
  // describe the drone's RESTING size/position (not its intro-flight
  // pulled-back framing) always use the right depth, regardless of
  // whatever the camera's distanceMultiplier happens to be at the moment
  // they're called.
  function getRestDistance() {
    return lastDistance;
  }

  return { flightRig, spinRig, camera, container, setDistanceMultiplier, getRestDistance, render, destroy };
}

/**
 * Starts (and returns a handle to control) the slow yaw-only yoyo spin.
 * Purely time-based — never reads scroll position — so it keeps turning
 * whether the user is scrolling, idle, or reading text.
 */
function startSpin(spinRig, startAngleDeg, durationSec) {
  const startRad = THREE.MathUtils.degToRad(startAngleDeg);
  spinRig.rotation.y = startRad;

  const tween = gsap.to(spinRig.rotation, {
    y: startRad + Math.PI,
    duration: durationSec,
    ease: 'sine.inOut',
    repeat: -1,
    yoyo: true,
  });

  return tween;
}

/**
 * Starts (and returns a handle to control) a slow, CONTINUOUS 360° yaw
 * spin — never reverses, never yoyos. Purely time-based (never reads
 * scroll position, never touches position), so the drone stays perfectly
 * still in place and only ever turns in place around its own (already
 * centered) origin. Uses a relative "+=" tween with linear easing and
 * infinite repeat so each lap is identical and seamless — no jump, no
 * pause, no reset — no matter how many laps have already played.
 */
function startContinuousSpin(spinRig, startAngleDeg, durationSecPerRevolution, options = {}) {
  const { preserveCurrentAngle = false } = options;
  if (!preserveCurrentAngle) {
    spinRig.rotation.y = THREE.MathUtils.degToRad(startAngleDeg);
  }
  // preserveCurrentAngle: continue from whatever angle spinRig.rotation.y
  // already is (e.g. mid-way through the desktop intro's yaw settle)
  // instead of snapping it to startAngleDeg first — see the desktop
  // intro/idle handoff in playHeroFlightIntro for why this matters: an
  // instant reset here would itself reintroduce a small visible jump.

  const tween = gsap.to(spinRig.rotation, {
    y: `+=${Math.PI * 2}`,
    duration: durationSecPerRevolution,
    ease: 'none',
    repeat: -1,
  });

  return tween;
}

// Depth (world Z) the START pose sits at — kept slightly forward of the
// z=0 resting plane (matching the old HERO_FLIGHT_MOBILE.start.z), purely
// for a touch of parallax/depth during the entry; the FINAL point is
// always unprojected at exactly z=0, since that's the plane the
// MOBILE_FIT resting-scale math assumes.
const MOBILE_START_PLANE_Z = -0.22;

/**
 * Builds this run's mobile hero flight config: START, two Bezier control
 * points, and FINAL, all derived from real DOM rects (see
 * getMobileHeroScreenPoints) and converted to world space via
 * screenToWorldXY — instead of the fixed, hand-picked world coordinates
 * HERO_FLIGHT_MOBILE used previously. Falls back to HERO_FLIGHT_MOBILE's
 * static points if the DOM isn't in a measurable state yet (e.g. a
 * layout still at 0×0 during an early paint).
 *
 * START is unprojected at the flight's actual start distance (camera
 * pulled back by startDistanceMultiplier), since that's what the camera
 * is really showing on the very first rendered frame. FINAL is
 * unprojected at the plain resting (1x) distance, since that's what the
 * camera returns to by the time the drone arrives — this is what keeps
 * the old final screen position AND final visual size intact even
 * though the stage container is now the whole hero, not a small box.
 */
function computeMobileHeroFlightConfig(stage) {
  const { camera, container, getRestDistance } = stage;
  const points = getMobileHeroScreenPoints(container);
  if (!points) return { ...HERO_FLIGHT_MOBILE, final: { x: 0, y: 0, z: 0 } };

  const restDistance = getRestDistance();
  const startDistance = restDistance * HERO_FLIGHT_MOBILE.startDistanceMultiplier;

  const start = screenToWorldXY(container, camera, startDistance, points.startX, points.startY, MOBILE_START_PLANE_Z);
  const final = screenToWorldXY(container, camera, restDistance, points.endX, points.endY, 0);

  // Control points are designed in screen-space (per the brief) — lean
  // left-and-down early, then pull back in and settle vertically toward
  // END — then converted to world-space individually. They don't need to
  // sit exactly on the eventual path (Bezier control points never do);
  // they only need to shape it, so a lerp-based screen-space estimate at
  // an interpolated depth is enough.
  const spanX = points.endX - points.startX;
  const spanY = points.endY - points.startY;

  const control1Screen = {
    x: points.startX + spanX * 0.28 - Math.abs(spanX) * 0.14,
    y: points.startY + spanY * 0.3,
  };
  const control2Screen = {
    x: points.endX + spanX * -0.04,
    y: points.endY + spanY * -0.08,
  };

  const control1Distance = THREE.MathUtils.lerp(startDistance, restDistance, 0.3);
  const control2Distance = THREE.MathUtils.lerp(startDistance, restDistance, 0.75);
  const control1PlaneZ = THREE.MathUtils.lerp(MOBILE_START_PLANE_Z, 0, 0.3);
  const control2PlaneZ = THREE.MathUtils.lerp(MOBILE_START_PLANE_Z, 0, 0.75);

  const control1 = screenToWorldXY(
    container,
    camera,
    control1Distance,
    control1Screen.x,
    control1Screen.y,
    control1PlaneZ
  );
  const control2 = screenToWorldXY(
    container,
    camera,
    control2Distance,
    control2Screen.x,
    control2Screen.y,
    control2PlaneZ
  );

  return {
    ...HERO_FLIGHT_MOBILE,
    start,
    control1,
    control2,
    final,
  };
}

/**
 * Poses the hero stage at its intro-flight START frame right away
 * (parked, not yet animating): flightRig sits at the off-screen start
 * waypoint, spinRig holds the static entry yaw, and the camera is
 * already pulled back to its flight-start distance. This runs the
 * moment the hero stage is built, well before the shared render loop
 * or the flight timeline itself actually starts — so whenever the
 * first real frame gets rendered, it already shows the correct
 * "about to fly in" pose instead of a flash of the resting composition.
 */
function primeHeroFlightStart(stage) {
  const { flightRig, spinRig, setDistanceMultiplier } = stage;
  const mobile = isMobileViewport();

  if (prefersReducedMotion()) {
    if (mobile) {
      // Mobile's resting position is no longer always (0,0,0) — it's
      // wherever the old boxed-stage center maps to in the new overlay's
      // world space (see computeMobileHeroFlightConfig) — so reduced
      // motion still needs to land the drone in the right screen spot.
      const cfg = computeMobileHeroFlightConfig(stage);
      flightRig.position.copy(cfg.final);
    } else {
      flightRig.position.set(0, 0, 0);
    }
    flightRig.rotation.set(0, 0, 0);
    setDistanceMultiplier(1);
    return;
  }

  const cfg = mobile ? computeMobileHeroFlightConfig(stage) : HERO_FLIGHT_DESKTOP;
  flightRig.position.set(cfg.start.x, cfg.start.y, cfg.start.z);
  flightRig.rotation.set(cfg.pitch.start, 0, cfg.bank.start);
  setDistanceMultiplier(cfg.startDistanceMultiplier);
  spinRig.rotation.y = THREE.MathUtils.degToRad(HERO_ENTRY_YAW_DEG);
}

/**
 * Builds the DESKTOP hero intro flight curve — a CatmullRomCurve3 through
 * the same start -> wp1 -> wp2 -> final(0,0,0) points the previous
 * three-tween system used, so the on-screen route/composition is
 * unchanged. 'centripetal' parameterization avoids the loop/cusp
 * artifacts a plain Catmull-Rom can produce when points aren't evenly
 * spaced (which these aren't — the flight decelerates toward the end).
 */
function createDesktopHeroFlightCurve(cfg) {
  return new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(cfg.start.x, cfg.start.y, cfg.start.z),
      new THREE.Vector3(cfg.wp1.x, cfg.wp1.y, cfg.wp1.z),
      new THREE.Vector3(cfg.wp2.x, cfg.wp2.y, cfg.wp2.z),
      new THREE.Vector3(0, 0, 0),
    ],
    false,
    'centripetal'
  );
}

/**
 * Builds the MOBILE hero intro flight curve — a true CubicBezierCurve3
 * from cfg.start through cfg.control1/control2 into final(0,0,0). Unlike
 * a Catmull-Rom spline, a Bezier's control points don't sit ON the path,
 * which is exactly what's needed here: control1/control2 pull the curve
 * into the "swoop down-and-left, then settle" shape described in the
 * design brief without forcing the drone to actually pass through any
 * literal midpoint on screen.
 */
function createMobileHeroFlightCurve(cfg) {
  const final = cfg.final || { x: 0, y: 0, z: 0 };
  return new THREE.CubicBezierCurve3(
    new THREE.Vector3(cfg.start.x, cfg.start.y, cfg.start.z),
    new THREE.Vector3(cfg.control1.x, cfg.control1.y, cfg.control1.z),
    new THREE.Vector3(cfg.control2.x, cfg.control2.y, cfg.control2.z),
    new THREE.Vector3(final.x, final.y, final.z)
  );
}

/** Picks the right curve builder for the given config/platform. */
function createHeroFlightCurve(cfg, mobile) {
  return mobile ? createMobileHeroFlightCurve(cfg) : createDesktopHeroFlightCurve(cfg);
}

/**
 * Derives flightRig's in-flight banking (rotation.z) and pitch
 * (rotation.x) from the flight curve's own tangent at progress `t`,
 * instead of a separate set of waypoint rotation tweens. Smoothly lerped
 * toward the target each call (not snapped) so banking never jitters
 * frame-to-frame, clamped to tuning.maxBank so it always reads as gentle
 * cinematic product-shot banking rather than FPV-freestyle tilting, and
 * faded out via tuning.settleFrom as the drone nears its final position
 * so it always arrives level. spinRig.rotation.y (the continuous yaw
 * spin) is never touched here.
 */
function updateHeroFlightBanking(flightRig, curve, t, tuning) {
  const clampedT = THREE.MathUtils.clamp(t, 0, 1);
  const tangent = curve.getTangentAt(clampedT);

  const targetBankZ = THREE.MathUtils.clamp(-tangent.x * tuning.bankGainZ, -tuning.maxBank, tuning.maxBank);
  const targetPitchX = THREE.MathUtils.clamp(tangent.y * tuning.bankGainX, -tuning.maxBank, tuning.maxBank);

  // 1 for most of the flight, easing down to 0 as t crosses settleFrom -> 1
  // so the drone always arrives level, never banked, at its final pose.
  const settleFactor = 1 - THREE.MathUtils.smoothstep(clampedT, tuning.settleFrom, 1);

  flightRig.rotation.z = THREE.MathUtils.lerp(flightRig.rotation.z, targetBankZ * settleFactor, tuning.bankLerp);
  flightRig.rotation.x = THREE.MathUtils.lerp(flightRig.rotation.x, targetPitchX * settleFactor, tuning.bankLerp);
}

/**
 * Turns spinRig.rotation.y (yaw) from its static HERO_ENTRY_YAW_DEG entry
 * heading toward the resting product angle (`targetYawRad`) — gradually,
 * every frame, via shortest-angle lerp (see lerpAngle above), instead of a
 * separate short/fixed-duration GSAP tween tacked onto the tail of the
 * flight. That previous approach was the actual cause of the "TAK" —
 * because it was its own tween with its own easing curve, squeezed into
 * only the flight's last ~15% (well under a second), a fairly large
 * heading change (entry yaw to product angle) ended up playing out fast
 * enough to read as a sudden snap, right as everything else was settling
 * into place. Driving it from this same per-frame update, starting much
 * earlier (tuning.from) and using a damping factor rather than a fixed
 * duration, spreads the turn across roughly a second or more of real
 * time — long enough to read as a natural, weighted re-orientation
 * instead of an instant flick — and its rate naturally tapers off as it
 * approaches the target instead of stopping abruptly. Before `from`, yaw
 * is left completely untouched (still the static entry heading).
 */
function updateHeroFlightYaw(spinRig, t, targetYawRad, tuning) {
  const clampedT = THREE.MathUtils.clamp(t, 0, 1);
  if (clampedT < tuning.from) return;

  // Re-map [from, 1] -> [0, 1] just to fade the damping factor in gently
  // over the first bit of the window, so the turn itself doesn't have a
  // hard start either.
  const windowT = (clampedT - tuning.from) / (1 - tuning.from);
  const easeIn = THREE.MathUtils.smoothstep(windowT, 0, 0.35);
  const alpha = tuning.lerp * easeIn;

  spinRig.rotation.y = lerpAngle(spinRig.rotation.y, targetYawRad, alpha);
}

// ---------------------------------------------------------------------
// MOBILE-ONLY cinematic orbit — layered ON TOP of updateHeroFlightYaw
// above (which is completely untouched: it still owns the entry-yaw ->
// product-angle re-orientation exactly as it always did). Without this,
// the mobile drone's heading barely changes across the whole flight, so
// it reads as a flat object sliding across the screen rather than a
// drone actually flying. This adds a slow, continuous Y-axis turn — not
// an aggressive spin — so the user sees different sides of the model as
// it travels.
//
// It is a pure function of flight progress `t`, never accumulated
// frame-to-frame, so it can never drift or compound: `orbitAngleForT(t)`
// rises smoothly across the first `fadeOutFrom` (~78%) of the flight,
// then eases back down to EXACTLY 0 over the final ~22% — at the same
// stretch updateHeroFlightYaw's own lerp is converging on the resting
// angle — so the two blend into one smooth turn into the park pose
// instead of fighting, and there is never a snap when the flight's
// onComplete pins the final angle. Each frame only the DELTA between
// this frame's and last frame's orbit angle is added to
// spinRig.rotation.y (via `orbitState.applied`), so it layers cleanly on
// top of whatever updateHeroFlightYaw already wrote that same frame.
// Desktop is entirely unaffected — this is only ever called when mobile.
const MOBILE_ORBIT_TUNING = {
  totalRad: THREE.MathUtils.degToRad(300), // ~270-360deg total requested; mid-range pick
  fadeOutFrom: 0.78, // progress at which the orbit starts easing back to 0
};

function orbitAngleForT(t, tuning) {
  const clampedT = THREE.MathUtils.clamp(t, 0, 1);
  const eased = THREE.MathUtils.smoothstep(clampedT, 0, tuning.fadeOutFrom);
  const fade = 1 - THREE.MathUtils.smoothstep(clampedT, tuning.fadeOutFrom, 1);
  return eased * tuning.totalRad * fade;
}

function updateHeroFlightOrbit(spinRig, t, orbitState, tuning) {
  const target = orbitAngleForT(t, tuning);
  spinRig.rotation.y += target - orbitState.applied;
  orbitState.applied = target;
}

/**
 * Plays the hero drone's one-time intro flight along a single continuous
 * curve (desktop: CatmullRomCurve3 through the existing route points;
 * mobile: a dedicated CubicBezierCurve3 — see the two curve builders
 * above) into its existing resting position, with light curve-tangent-
 * driven banking, then hands off to the exact same startContinuousSpin()
 * every other stage uses. Not scroll-linked, not repeated, not a yoyo —
 * it runs once, driven purely by GSAP time.
 *
 * GSAP animates exactly ONE scalar — flightProgress.t, 0 -> 1 — never
 * flightRig.position directly. Every onUpdate reads the current point
 * (curve.getPointAt(t), arc-length parameterized) and tangent off the
 * curve and applies them. Because there is only one tween driving
 * position, there is no waypoint boundary anywhere in time where
 * velocity direction can discontinuously change.
 *
 * flightRig.position, flightRig.rotation.x/z, and spinRig.rotation.y are
 * all touched here. spinRig.rotation.y is held static for the entry, then
 * gradually re-oriented toward the resting product angle from within the
 * same per-frame onUpdate as position/banking (see updateHeroFlightYaw)
 * — not a separate tween — so the turn is smooth and continuous rather
 * than a fixed-duration segment bolted onto the tail of the flight. It
 * always finishes (or is imperceptibly close) before `onComplete` fires
 * startContinuousSpin, so the two never visibly fight over the same
 * property at the same time.
 *
 * If prefers-reduced-motion is on, the flight is skipped entirely: the
 * drone starts directly at its final (0,0,0) position/rotation and the
 * continuous spin begins immediately, exactly like every other stage.
 *
 * Returns the active GSAP tween/timeline so the caller can pause/resume
 * it via the same IntersectionObserver visibility logic every stage
 * already uses.
 */
// DESKTOP ONLY — progress at which rotation.y ownership hands off from
// the yaw settle (updateHeroFlightYaw, untouched) to the idle continuous
// spin, a little before the flight timeline itself actually completes.
// See the "stop then spin" note on the onUpdate branch below and on the
// tl onComplete handler for why this exists. Mobile's own yaw
// settle/orbit timing is completely unaffected by this constant.
const DESKTOP_IDLE_HANDOFF_T = 0.85;

function playHeroFlightIntro(stage, startAngleDeg, spinDurationSec, onComplete, idleHandoff = {}) {
  const { flightRig, spinRig, setDistanceMultiplier } = stage;
  const mobile = isMobileViewport();

  if (prefersReducedMotion()) {
    // Mobile's resting position is derived from live DOM geometry (see
    // computeMobileHeroFlightConfig), not always the origin — desktop is
    // unchanged.
    const restPosition = mobile ? computeMobileHeroFlightConfig(stage).final : { x: 0, y: 0, z: 0 };
    flightRig.position.set(restPosition.x, restPosition.y, restPosition.z);
    flightRig.rotation.set(0, 0, 0);
    setDistanceMultiplier(1);
    spinRig.rotation.y = THREE.MathUtils.degToRad(startAngleDeg);
    const tween = startContinuousSpin(spinRig, startAngleDeg, spinDurationSec);
    if (onComplete) onComplete();
    return tween;
  }

  const cfg = mobile ? computeMobileHeroFlightConfig(stage) : HERO_FLIGHT_DESKTOP;
  const flightDurationSec = mobile ? HERO_FLIGHT_MOBILE_DURATION_SEC : HERO_FLIGHT_DESKTOP_DURATION_SEC;
  const curve = createHeroFlightCurve(cfg, mobile);
  const finalPosition = mobile ? cfg.final : { x: 0, y: 0, z: 0 };

  // Re-assert the start pose (primeHeroFlightStart already set this, but
  // this keeps the function correct/self-contained on its own too).
  flightRig.position.set(cfg.start.x, cfg.start.y, cfg.start.z);
  flightRig.rotation.set(cfg.pitch.start, 0, cfg.bank.start);
  setDistanceMultiplier(cfg.startDistanceMultiplier);
  spinRig.rotation.y = THREE.MathUtils.degToRad(HERO_ENTRY_YAW_DEG);

  const flightProgress = { t: 0 };
  const distProxy = { m: cfg.startDistanceMultiplier };
  const targetYawRad = THREE.MathUtils.degToRad(startAngleDeg);
  const orbitState = { applied: 0 }; // mobile-only cinematic orbit (see updateHeroFlightOrbit)

  const tl = gsap.timeline({
    onComplete: () => {
      // Safety net: pin every animated value to its exact rest state so
      // easing float-drift never leaves the composition a hair off. By
      // this point updateHeroFlightYaw/updateHeroFlightBanking have
      // already brought rotation visually all the way (or all but
      // imperceptibly close) to this exact pose, so this assignment
      // itself is never seen as a jump.
      flightRig.position.set(finalPosition.x, finalPosition.y, finalPosition.z);
      flightRig.rotation.set(0, 0, 0);
      setDistanceMultiplier(1);
      // Mobile: unchanged — pin the exact resting yaw here, same as
      // before. Desktop: only pin it here if the idle-spin handoff below
      // never actually fired (safety net for an extremely short/
      // throttled flight) — otherwise the idle tween already owns
      // rotation.y and is mid-revolution from it, so forcing it back to
      // this fixed value would itself introduce the very snap this
      // revision is removing.
      if (mobile || !idleHandoff.tween) {
        spinRig.rotation.y = targetYawRad;
      }
      if (onComplete) onComplete();
    },
  });

  // The ONE position tween: progress along the curve, 0 -> 1. No
  // bounce/elastic/back/steps — power2.inOut gives a gentle controlled
  // entry that builds speed through the middle of the flight and
  // decelerates smoothly into the final position, with no overshoot.
  tl.to(
    flightProgress,
    {
      t: 1,
      duration: flightDurationSec,
      // Mobile: sine.inOut for a balanced, unhurried glide — soft
      // acceleration at the start, steady controlled motion through the
      // middle, and a gradual ease into the park position (never a hard
      // stop and never a rushed launch) — desktop's power2.inOut
      // (unchanged) already had its own gentle settle for the shorter
      // in-hero route, so it's left exactly as it was.
      ease: mobile ? 'sine.inOut' : 'power2.inOut',
      onUpdate: () => {
        const t = flightProgress.t;
        flightRig.position.copy(curve.getPointAt(t));
        updateHeroFlightBanking(flightRig, curve, t, cfg.bankTuning);
        if (mobile) {
          // Yaw is re-oriented here too — same per-frame onUpdate as
          // position/banking, not a separate tween — so there is no
          // second timeline segment that can start abruptly partway
          // through the flight. See updateHeroFlightYaw for why this
          // replaced the old fixed-duration end-of-flight yaw tween.
          updateHeroFlightYaw(spinRig, t, targetYawRad, cfg.yawSettle);
          // Mobile-only cinematic orbit layered on top (see
          // updateHeroFlightOrbit) — purely additive, never fights the
          // line above.
          updateHeroFlightOrbit(spinRig, t, orbitState, MOBILE_ORBIT_TUNING);
        } else if (t < DESKTOP_IDLE_HANDOFF_T) {
          updateHeroFlightYaw(spinRig, t, targetYawRad, cfg.yawSettle);
        } else if (!idleHandoff.tween) {
          // DESKTOP ONLY — hand rotation.y ownership to the idle
          // continuous spin a little before this timeline actually
          // completes, continuing from whatever angle the settle lerp
          // has already reached (never reset to a fixed value — see
          // startContinuousSpin's preserveCurrentAngle option). The
          // settle lerp's angular velocity naturally decays toward 0 as
          // it converges on its target, while a plain constant-rate idle
          // spin is already at full speed on its very first frame — left
          // to start only once this timeline fully finishes, that
          // mismatch reads as a tiny stop-then-go. Starting it here
          // instead, slightly early and from the current angle, removes
          // the seam: the settle lerp and the idle spin overlap for a
          // moment instead of handing off with a beat of silence.
          idleHandoff.tween = startContinuousSpin(spinRig, startAngleDeg, spinDurationSec, {
            preserveCurrentAngle: true,
          });
        }
      },
    },
    0
  );

  // Camera eases from its wider flight-start distance back to exactly 1x
  // (its normal resting distance) across the whole flight, so there is
  // never a visible "pop" the instant position reaches (0,0,0).
  tl.to(
    distProxy,
    {
      m: 1,
      duration: flightDurationSec,
      ease: 'power2.out',
      onUpdate: () => setDistanceMultiplier(distProxy.m),
    },
    0
  );

  return tl;
}

/**
 * Creates one full drone stage inside `container`: loads its own rig
 * clone, mounts its own scene/camera/renderer, and starts its own
 * time-based yaw spin. Rendering (and the spin tween) pause while the
 * container is off-screen and resume — from whatever angle they were
 * already at — once it's back in view.
 */
async function createStage(
  container,
  {
    startAngleDeg,
    durationSec,
    debugLabel,
    dark = false,
    modelUrl = MODEL_URL_MAVIC3,
    manualOrientationOffsetY = MANUAL_ORIENTATION_OFFSET_Y_MAVIC3,
    debugConstantName = 'MANUAL_ORIENTATION_OFFSET_Y_MAVIC3',
    stageKey = null,
    spinMode = 'yoyo',
    flightIntro = false,
  }
) {
  const rig = await loadDroneRig(modelUrl, manualOrientationOffsetY);
  const stage = createStageScene(container, rig.orientationGroup, { dark, stageKey });

  let isVisible = true;
  const tweenRef = { current: null };

  function applyVisibility() {
    if (!tweenRef.current) return;
    if (isVisible) tweenRef.current.play();
    else tweenRef.current.pause();
  }

  // `startIntro` stays null for every stage except the hero one. It is
  // deliberately NOT called here: if it ran immediately, the GSAP
  // timeline would start advancing on its own ticker while
  // initDroneStages() might still be awaiting the OTHER stages' model
  // loads — before main.js's shared render loop has even started calling
  // render() once. That would silently "eat" part of the flight before a
  // single frame of it ever got drawn. Instead the hero stage is primed
  // to its parked flight-start pose right away (so the first real
  // rendered frame is already correct), and initDroneStages() hands the
  // actual start trigger back to main.js to fire once rendering begins.
  let startIntro = null;

  if (flightIntro) {
    primeHeroFlightStart(stage);
    startIntro = () => {
      // Desktop only: playHeroFlightIntro may already have started the
      // idle continuous spin itself a little before the timeline
      // finishes (see DESKTOP_IDLE_HANDOFF_T), writing its tween into
      // this shared object as soon as it does — that's what closes the
      // small stop-then-spin gap. Mobile leaves idleHandoff.tween null,
      // so its onComplete below behaves exactly as it always did.
      const idleHandoff = { tween: null };
      tweenRef.current = playHeroFlightIntro(
        stage,
        startAngleDeg,
        durationSec,
        () => {
          tweenRef.current = idleHandoff.tween || startContinuousSpin(stage.spinRig, startAngleDeg, durationSec);
          applyVisibility();
        },
        idleHandoff
      );
      applyVisibility();
    };
  } else {
    tweenRef.current =
      spinMode === 'continuous'
        ? startContinuousSpin(stage.spinRig, startAngleDeg, durationSec)
        : startSpin(stage.spinRig, startAngleDeg, durationSec);
  }

  if (debugLabel) mountDebugPanel(rig.orientationGroup, rig.autoYawCorrection, debugConstantName);

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isVisible = entry.isIntersecting;
          applyVisibility();
        });
      },
      { threshold: 0.05 }
    );
    io.observe(container);
  }

  function render() {
    if (isVisible) stage.render();
  }

  function destroy() {
    if (tweenRef.current) tweenRef.current.kill();
    stage.destroy();
  }

  return { render, destroy, startIntro };
}

/**
 * Boots the whole (three-stage) drone system: one stage per real container
 * found in the DOM. Safe to call once at startup; there is no
 * mobile/desktop split any more, so this never needs to be rebuilt on
 * resize/breakpoint changes.
 */
export async function initDroneStages() {
  const heroContainer = document.querySelector('.hero-drone-stage');
  const cinematicContainer = document.querySelector('.cinematic-drone-stage');
  const captureContainer = document.querySelector('.capture-drone-stage');

  const stages = [];
  let heroStartIntro = null;
  // Hero ("Gökyüzünden bakınca hikâye değişir.") — the site's MAIN drone.
  // The only stage with a one-time intro flight (flightIntro: true); see
  // playHeroFlightIntro. Its `startIntro` handle is deliberately not
  // called here — see the comment on `startIntro` inside createStage.
  if (heroContainer) {
    const heroStage = await createStage(heroContainer, {
      startAngleDeg: HERO_START_ANGLE_DEG,
      durationSec: HERO_SPIN_DURATION_SEC,
      modelUrl: MODEL_URL_MINI3,
      manualOrientationOffsetY: MANUAL_ORIENTATION_OFFSET_Y,
      debugLabel: 'hero',
      debugConstantName: 'MANUAL_ORIENTATION_OFFSET_Y',
      stageKey: 'mini3Pro',
      spinMode: 'continuous',
      flightIntro: true,
    });
    stages.push(heroStage);
    heroStartIntro = heroStage.startIntro;
  }
  // Manifesto ("Doğru görüntüyü yakalamak başka bir iş.") — drone sits in
  // the left-hand column (see .manifesto-inner grid in styles.css), text
  // in the right-hand column. Entirely independent scene/camera/canvas/
  // model instance, using the same GLB as the cinematic stage
  // (dji_mavic_3.glb).
  //
  // MOBILE EXCEPTION: this stage is intentionally never created on
  // mobile. The hero drone's intro flight now continues on past the hero
  // section and parks in this exact screen spot instead (see the "MOBILE
  // TAKEOVER" note at the top of this file and getMobileHeroScreenPoints)
  // — .capture-drone-stage itself is left in the DOM untouched (same
  // size/margins, same document flow, same layout height) purely so it
  // still works as a live measurement landmark for that park position;
  // it's just never given a canvas/model on mobile. Desktop is completely
  // unaffected — this stage is always created there, exactly as before.
  if (captureContainer && !isMobileViewport()) {
    stages.push(
      await createStage(captureContainer, {
        startAngleDeg: MANIFESTO_START_ANGLE_DEG,
        durationSec: MANIFESTO_SPIN_DURATION_SEC,
        modelUrl: MODEL_URL_MAVIC3,
        manualOrientationOffsetY: MANUAL_ORIENTATION_OFFSET_Y_MAVIC3,
        debugLabel: 'manifesto',
        debugConstantName: 'MANUAL_ORIENTATION_OFFSET_Y_MAVIC3',
        stageKey: 'manifesto',
        spinMode: 'continuous',
      })
    );
  }
  // Dark cinematic section ("KADRAJ BİZİM İÇİN HER ŞEY" / "Görmek değil.
  // Doğru yerden göstermek.") — drone sits in the left-hand column (see
  // .cinematic-inner grid in styles.css), text in the right-hand column.
  // `dark: true` boosts hemisphere fill + adds a cool rim light (see
  // scene.js) so the light gray/white body stays readable against the
  // charcoal background without blowing out to white.
  if (cinematicContainer) {
    stages.push(
      await createStage(cinematicContainer, {
        startAngleDeg: CINEMATIC_START_ANGLE_DEG,
        durationSec: CINEMATIC_SPIN_DURATION_SEC,
        modelUrl: MODEL_URL_MAVIC3,
        manualOrientationOffsetY: MANUAL_ORIENTATION_OFFSET_Y_MAVIC3,
        dark: true,
        debugLabel: 'cinematic',
        debugConstantName: 'MANUAL_ORIENTATION_OFFSET_Y_MAVIC3',
        stageKey: 'mavic3',
        spinMode: 'continuous',
      })
    );
  }

  function render() {
    stages.forEach((s) => s.render());
  }

  function destroy() {
    stages.forEach((s) => s.destroy());
  }

  // Called by main.js right when the shared render loop actually starts
  // (i.e. right after the loading screen begins hiding), so the hero
  // intro flight's GSAP timing lines up with the first frames that are
  // actually drawn instead of starting early while other stages were
  // still loading in the background.
  function startHeroIntro() {
    if (heroStartIntro) heroStartIntro();
  }

  return { render, destroy, startHeroIntro };
}
