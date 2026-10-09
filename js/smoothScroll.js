// ==========================================================================
// HAVAKARE — smoothScroll.js
// Sayfa içi (#hero, #services, #fleet, #about, #contact, #faq) bağlantılar için
// yumuşak kaydırma. Bağımsız modül: three.js / main.js yüklenmesini BEKLEMEZ,
// bu yüzden menü linkleri her zaman animasyonlu kayar.
// ==========================================================================

let frame = null;
let stopListening = null;

const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function navHeight() {
  const nav = document.getElementById('navbar');
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--nav-height');
  return (nav && nav.offsetHeight) || parseFloat(raw) || 0;
}

function duration(distance) {
  const t = Math.min(Math.abs(distance) / 2400, 1);
  return 700 + t * 700; // kısa mesafe ~700ms, uzun mesafe ~1400ms
}

function cancel() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  if (stopListening) stopListening();
  stopListening = null;
}

function scrollToTarget(target) {
  cancel();

  const startY = window.scrollY;
  const getTargetY = () => {
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    const y = target.getBoundingClientRect().top + window.scrollY - navHeight();
    return Math.max(0, Math.min(y, maxY));
  };
  const dur = duration(getTargetY() - startY);
  const t0 = performance.now();

  // Kullanıcı kendisi kaydırmaya başlarsa animasyon hemen bırakılır.
  const keys = ['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '];
  const onUser = (e) => {
    if (e.type === 'keydown' && !keys.includes(e.key)) return;
    cancel();
  };
  const evts = ['wheel', 'touchstart', 'keydown'];
  evts.forEach((n) => window.addEventListener(n, onUser, { passive: true }));
  stopListening = () => evts.forEach((n) => window.removeEventListener(n, onUser));

  const step = (now) => {
    const p = Math.min((now - t0) / dur, 1);
    // Hedef her karede yeniden hesaplanır: sayfa düzeni kayarsa bile doğru yere biter.
    const y = startY + (getTargetY() - startY) * easeInOutCubic(p);
    window.scrollTo(0, y);
    if (p < 1) frame = requestAnimationFrame(step);
    else cancel();
  };
  frame = requestAnimationFrame(step);
}

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  const link = e.target.closest('a[href^="#"]');
  if (!link) return;
  const id = link.getAttribute('href');
  if (!id || id === '#') return;

  let target = null;
  try { target = document.querySelector(id); } catch (_) { return; }
  if (!target) return;

  e.preventDefault();

  // Not: 'hareketi azalt' (prefers-reduced-motion) ayarı bilerek yok sayılıyor;
  // Windows'ta 'animasyon efektleri' kapalıysa bu ayar açık görünür ve kaydırma anında atlardı.
  scrollToTarget(target);

  if (history.replaceState) history.replaceState(null, '', id);
});
