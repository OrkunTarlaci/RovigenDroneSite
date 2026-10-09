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
import { initWhatsAppPicker } from './whatsappPicker.js';

const PHONE_DISPLAY = '0534 376 88 29';
const PHONE_TEL = 'tel:+905343768829';
const WHATSAPP_PHONE = '905343768829';

// Emre Armağan
const PHONE2_DISPLAY = '0541 523 11 89';
const PHONE2_TEL = 'tel:+905415231189';
const WHATSAPP2_PHONE = '905415231189';
const WHATSAPP2_MESSAGE = 'Merhaba Emre Bey, drone çekimi için sizlere ulaşıyorum.';
const WHATSAPP_MESSAGE = 'Merhaba Mertcan Bey, drone çekimi için sizlere ulaşıyorum.';
const WHATSAPP_URL = buildWhatsAppUrl(WHATSAPP_PHONE, WHATSAPP_MESSAGE);
const WHATSAPP2_URL = buildWhatsAppUrl(WHATSAPP2_PHONE, WHATSAPP2_MESSAGE);

document.addEventListener('DOMContentLoaded', () => {
  injectContactLinks();
  setYear();
  initNavbar();
  initMobileMenu();
  initHeroVideo();
  initRevealAnimations();
  initWhatsAppPicker({
    contacts: [
      { name: 'Mertcan Armağan', url: WHATSAPP_URL, recommended: true },
      { name: 'Emre Armağan', url: WHATSAPP2_URL },
    ],
  });
  initApp();
});

function injectContactLinks() {
  document.querySelectorAll('[data-phone-link]').forEach((el) => (el.href = PHONE_TEL));
  document.querySelectorAll('[data-phone-text]').forEach((el) => (el.textContent = PHONE_DISPLAY));
  document.querySelectorAll('[data-whatsapp-link]').forEach((el) => (el.href = WHATSAPP_URL));
  document.querySelectorAll('[data-phone2-link]').forEach((el) => (el.href = PHONE2_TEL));
  document.querySelectorAll('[data-phone2-text]').forEach((el) => (el.textContent = PHONE2_DISPLAY));
  document.querySelectorAll('[data-whatsapp1-link]').forEach((el) => (el.href = WHATSAPP_URL));
  document.querySelectorAll('[data-whatsapp2-link]').forEach((el) => (el.href = WHATSAPP2_URL));
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

// Smooth scroll artık js/smoothScroll.js içinde (three.js'ten bağımsız).

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

  // HIZLI YÜKLEME: açılış ekranı 3D modelleri beklemez. Sayfa içeriği hazır
  // olur olmaz (en geç ~700 ms sonra) ekran kalkar; drone arka planda yüklenir.
  const ready = Promise.race([
    (document.fonts && document.fonts.ready) || Promise.resolve(),
    new Promise((r) => setTimeout(r, 700)),
  ]);

  try {
    droneSystem = await initDroneStages(); // anında döner, modeller arka planda iner
  } catch (err) {
    console.error('Drone stages failed to start:', err);
  }

  await ready;
  hideLoadingScreen(loadingScreen);
  document.body.classList.add('is-ready');
  playHeroTextIntro();
  if (droneSystem) droneSystem.startHeroIntro();

  function tick() {
    if (droneSystem && !document.hidden) droneSystem.render();
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

// ---------------------------------------------------------------------
// Hero arka plan videosu: hero ekrandan çıkınca durur (3D drone + sayfa
// akıcı kalsın), geri gelince devam eder. Otomatik oynatma engellenirse
// sessizce yok sayılır; perde altında sayfa yine düzgün görünür.
// ---------------------------------------------------------------------
function initHeroVideo() {
  const video = document.querySelector('.hero-bg-video');
  const hero = document.getElementById('hero');
  if (!video || !hero) return;

  // Yalnızca veri tasarrufu / 2G'de indirme atlanır. (3G artık atlanmaz: iOS bu bilgiyi
  // vermediği için Android ile iPhone farklı davranıyordu; ikisi de aynı davranır.)
  const conn = navigator.connection || {};
  const slow = conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || '');
  if (slow) { video.removeAttribute('data-src'); return; }

  // iOS Safari'de muted/playsinline özniteliği JS ile de açıkça ayarlanmalı.
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');

  const play = () => { const p = video.play(); if (p && p.catch) p.catch(() => {}); };

  // Video DOMContentLoaded'da hemen başlar (window 'load' beklenmez: iOS'ta 3D/model/font
  // yüklenene kadar gecikiyordu). Telefonda daha küçük (854px) sürüm, aynı H.264 MP4 formatı.
  const small = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
  const src = (small && video.getAttribute('data-src-mobile')) || video.getAttribute('data-src');
  function startVideo() {
    if (!src || video.src) return;
    const fallback = video.getAttribute('data-src-fallback');
    video.addEventListener('error', () => {
      if (fallback && video.src !== fallback) { video.src = fallback; video.load(); play(); }
    }, { once: true });
    video.src = src;
    video.load();
    play();
  }
  // FPS / bant genişliği: video, 3D drone modeli hazır olana kadar (en geç
  // 3.5 sn) beklenir; ilk açılışta ikisi aynı anda indirilip çözülmesin.
  window.addEventListener('havakare:hero-ready', () => setTimeout(startVideo, 300), { once: true });
  setTimeout(startVideo, 3500);

  // iOS Düşük Güç Modu / otomatik oynatma engeli: ilk dokunuş veya kaydırmada başlat.
  const kick = () => { if (video.paused) play(); };
  ['touchstart', 'pointerdown', 'scroll', 'click'].forEach((ev) =>
    window.addEventListener(ev, kick, { once: true, passive: true }));
  video.addEventListener('loadeddata', kick);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  if (!('IntersectionObserver' in window)) return;
  new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? play() : video.pause()));
  }, { threshold: 0.05 }).observe(hero);
}
