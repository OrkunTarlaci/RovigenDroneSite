// ==========================================================================
// AERON — main.js
// Orchestrates: loading screen, navbar, mobile menu, section reveal
// animations, and boots the drone stage system (see droneStage.js) — three
// independent, always-on 3D stages (hero, cinematic, manifesto/"capture"),
// each with its own canvas, static position, and its own slow yaw-only
// spin. There is no separate desktop/mobile drone system any more: the
// same stages run at every viewport width, and only their CSS sizing
// changes per breakpoint.
// ==========================================================================

import { initDroneStages } from './droneStage.js';
import { buildWhatsAppUrl } from './utils.js';

const PHONE_DISPLAY = '0534 376 88 29';
const PHONE_TEL = 'tel:+905343768829';
const WHATSAPP_PHONE = '905343768829';
const WHATSAPP_MESSAGE = 'Merhaba Mertcan Bey, drone çekimi için sizlere ulaşıyorum.';
const WHATSAPP_URL = buildWhatsAppUrl(WHATSAPP_PHONE, WHATSAPP_MESSAGE);

document.addEventListener('DOMContentLoaded', () => {
  injectContactLinks();
  setYear();
  initNavbar();
  initMobileMenu();
  initSmoothScroll();
  initRevealAnimations();
  initApp();
});

function injectContactLinks() {
  document.querySelectorAll('[data-phone-link]').forEach((el) => (el.href = PHONE_TEL));
  document.querySelectorAll('[data-phone-text]').forEach((el) => (el.textContent = PHONE_DISPLAY));
  document.querySelectorAll('[data-whatsapp-link]').forEach((el) => (el.href = WHATSAPP_URL));
}

function setYear() {
  const el = document.getElementById('current-year');
  if (el) el.textContent = new Date().getFullYear();
}

// ---------------------------------------------------------------------
// Navbar: transparent at top, frosted after scroll, light text on dark
// section (cinematic) via IntersectionObserver.
// ---------------------------------------------------------------------
function initNavbar() {
  const navbar = document.getElementById('navbar');

  window.addEventListener(
    'scroll',
    () => {
      navbar.classList.toggle('is-scrolled', window.scrollY > 40);
    },
    { passive: true }
  );

  const cinematic = document.getElementById('cinematic');
  if (cinematic && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          navbar.classList.toggle('on-dark', entry.isIntersecting);
        });
      },
      { rootMargin: `-${getComputedNavHeight()}px 0px -70% 0px` }
    );
    io.observe(cinematic);
  }
}

function getComputedNavHeight() {
  return document.getElementById('navbar').offsetHeight || 76;
}

// ---------------------------------------------------------------------
// Mobile menu
// ---------------------------------------------------------------------
function initMobileMenu() {
  const btn = document.getElementById('hamburger');
  const menu = document.getElementById('mobile-menu');
  if (!btn || !menu) return;

  function closeMenu() {
    menu.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
  }
  function openMenu() {
    menu.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('menu-open');
  }

  btn.addEventListener('click', () => {
    const isOpen = menu.classList.contains('is-open');
    isOpen ? closeMenu() : openMenu();
  });

  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeMenu));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
}

// ---------------------------------------------------------------------
// Smooth scroll for in-page anchor links only (nav, mobile menu, footer,
// hero CTA). External links (WhatsApp, tel:, mailto:) are untouched since
// they never match the a[href^="#"] selector below. One delegated
// listener on document — no per-link duplicate handlers, and it naturally
// fires after the mobile menu's own close-on-click listener since that
// listener lives on the link itself and runs first during bubbling.
//
// Custom rAF-based easing (no native scrollIntoView smooth behavior, no
// external library) so the motion has a cinematic ease-in/ease-out feel
// instead of the browser's abrupt native smooth scroll. Duration scales
// with distance (clamped) so short hops stay snappy and long hops feel
// heavy without dragging. Single active animation at a time — a new
// anchor click, or any manual user scroll input, cancels the running one
// so the user's control is never locked out.
// ---------------------------------------------------------------------
let activeScrollFrame = null;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function cancelActiveScroll() {
  if (activeScrollFrame !== null) {
    cancelAnimationFrame(activeScrollFrame);
    activeScrollFrame = null;
  }
}

function getNavHeight() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--nav-height');
  return parseFloat(raw) || 0;
}

function getScrollDuration(distance) {
  const abs = Math.abs(distance);
  // Short hops: ~700-900ms, medium: ~1000-1300ms, long: ~1300-1700ms.
  const MIN_DURATION = 700;
  const MAX_DURATION = 1700;
  const MAX_DISTANCE = 2400; // distance (px) beyond which duration caps out

  const t = Math.min(abs / MAX_DISTANCE, 1);
  return MIN_DURATION + t * (MAX_DURATION - MIN_DURATION);
}

function smoothScrollTo(targetY) {
  cancelActiveScroll();

  const startY = window.scrollY;
  const distance = targetY - startY;
  const duration = getScrollDuration(distance);
  const startTime = performance.now();

  // Any manual scroll input from the user during the animation cancels
  // it immediately, without preventDefault — the user always keeps
  // control of native wheel/touch/key scrolling.
  const cancelEvents = ['wheel', 'touchstart', 'keydown'];
  function onManualInput(e) {
    if (e.type === 'keydown' && !['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(e.key)) {
      return;
    }
    stop();
  }
  function bindCancelListeners() {
    cancelEvents.forEach((evt) => window.addEventListener(evt, onManualInput, { passive: true }));
  }
  function unbindCancelListeners() {
    cancelEvents.forEach((evt) => window.removeEventListener(evt, onManualInput));
  }

  function stop() {
    cancelActiveScroll();
    unbindCancelListeners();
  }

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeInOutCubic(progress);

    window.scrollTo(0, startY + distance * eased);

    if (progress < 1) {
      activeScrollFrame = requestAnimationFrame(animate);
    } else {
      stop();
    }
  }

  bindCancelListeners();
  activeScrollFrame = requestAnimationFrame(animate);
}

function initSmoothScroll() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;

    const targetId = link.getAttribute('href');
    if (!targetId || targetId === '#') return;

    const target = document.querySelector(targetId);
    if (!target) return;

    e.preventDefault();

    const targetY = target.getBoundingClientRect().top + window.scrollY - getNavHeight();

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      cancelActiveScroll();
      window.scrollTo(0, targetY);
      return;
    }

    smoothScrollTo(targetY);
  });
}

// ---------------------------------------------------------------------
// Gentle section reveal animations (opacity/translateY), independent of
// the 3D drone stages.
// ---------------------------------------------------------------------
function initRevealAnimations() {
  const targets = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || targets.length === 0) return;

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          entry.target.style.animationDelay = `${(i % 4) * 0.08}s`;
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  targets.forEach((t) => io.observe(t));
}

// ---------------------------------------------------------------------
// Boots the three drone stages and starts a single shared render loop for
// all of them. Simple by design: model load -> model clone (one per
// stage) -> scene -> camera -> light -> fixed position -> slow yaw spin ->
// render.
// ---------------------------------------------------------------------
async function initApp() {
  const loadingScreen = document.getElementById('loading-screen');
  let droneSystem = null;

  try {
    droneSystem = await initDroneStages();
  } catch (err) {
    console.error('Drone model failed to load:', err);
  }

  hideLoadingScreen(loadingScreen);
  document.body.classList.add('is-ready');
  playHeroTextIntro();
  // Starts the hero drone's one-time intro flight (see js/droneStage.js)
  // right here, so it's in sync with the loading screen hiding and the
  // hero text reveal above, and so its GSAP timing lines up with frames
  // that are actually being rendered (see startHeroIntro's own comment).
  if (droneSystem) droneSystem.startHeroIntro();

  function tick() {
    if (droneSystem) droneSystem.render();
    requestAnimationFrame(tick);
  }
  tick();
}

function hideLoadingScreen(loadingScreen) {
  if (!loadingScreen) return;
  loadingScreen.classList.add('is-hidden');
  setTimeout(() => loadingScreen.remove(), 600);
}

// ---------------------------------------------------------------------
// Hero text: a plain fade/rise on load. No longer tied to a drone intro
// spin timeline — the drone's own spin is independent and continuous.
// ---------------------------------------------------------------------
function playHeroTextIntro() {
  const items = ['.hero-text .eyebrow', '.hero-title', '.hero-desc', '.hero-cta-group', '.hero-trust'];
  gsap.fromTo(
    items,
    { opacity: 0, y: 20 },
    { opacity: 1, y: 0, duration: 0.8, stagger: 0.08, ease: 'power2.out' }
  );
}
