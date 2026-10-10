// ==========================================================================
// HAVAKARE — whatsappPicker.js
// Sitedeki tüm WhatsApp butonları (data-whatsapp-link / data-faq-whatsapp-link)
// tıklanınca iki kişilik seçim penceresi açar: Mertcan Armağan / Emre Armağan.
// Seçilen kişiye, kendi karşılama mesajıyla WhatsApp açılır.
// ==========================================================================

export function initWhatsAppPicker({ contacts }) {
  const modal = buildModal(contacts);
  document.body.appendChild(modal);

  let lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('wa-picker-open');
    const first = modal.querySelector('.wa-option');
    if (first) first.focus();
  }
  function close() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('wa-picker-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // Tüm WhatsApp tetikleyicilerini yakala (tek delegated listener)
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-whatsapp-link], [data-faq-whatsapp-link]');
    if (trigger) {
      e.preventDefault();
      // mobil menü açıksa kapat
      const menu = document.getElementById('mobile-menu');
      if (menu && menu.classList.contains('is-open')) {
        menu.classList.remove('is-open');
        document.body.classList.remove('menu-open');
        const hb = document.getElementById('hamburger');
        if (hb) hb.setAttribute('aria-expanded', 'false');
      }
      open();
      return;
    }
    if (e.target.closest('[data-wa-close]')) close();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
  });

  // Tetikleyici linkleri için href'i seçim penceresine yönlendirme (JS kapalıysa boş '#' kalmasın)
  document.querySelectorAll('[data-whatsapp-link], [data-faq-whatsapp-link]').forEach((a) => {
    a.setAttribute('href', '#whatsapp');
    a.removeAttribute('target');
    a.setAttribute('role', 'button');
  });
}

function buildModal(contacts) {
  const wrap = document.createElement('div');
  wrap.id = 'wa-picker';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `
    <div class="wa-backdrop" data-wa-close></div>
    <div class="wa-dialog" role="dialog" aria-modal="true" aria-labelledby="wa-title">
      <button type="button" class="wa-x" data-wa-close aria-label="Kapat">×</button>
      <h3 id="wa-title">Kiminle iletişime geçmek istersiniz?</h3>
      <p class="wa-sub">Seçtiğiniz kişiye WhatsApp üzerinden mesaj gönderebilirsiniz.</p>
      <div class="wa-options"></div>
    </div>`;
  const list = wrap.querySelector('.wa-options');
  contacts.forEach((c) => {
    const a = document.createElement('a');
    a.className = 'wa-option';
    a.href = c.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = `
      <svg viewBox="0 0 32 32" fill="white" aria-hidden="true"><path d="M16.02 3C9.4 3 4 8.4 4 15.02c0 2.4.66 4.6 1.87 6.53L4 29l7.62-1.86a11.98 11.98 0 0 0 4.4.83c6.62 0 12.02-5.4 12.02-12.02C28.04 8.4 22.64 3 16.02 3zm0 21.8c-1.66 0-3.24-.44-4.65-1.28l-.33-.2-4.52 1.1 1.2-4.4-.22-.34a9.7 9.7 0 0 1-1.5-5.14c0-5.4 4.4-9.8 9.98-9.8 5.4 0 9.8 4.4 9.8 9.8.06 5.4-4.34 9.26-9.76 9.26z"/></svg>
      <span class="wa-name"></span>`;
    a.querySelector('.wa-name').textContent = c.name;
    a.addEventListener('click', () => {
      setTimeout(() => wrap.querySelector('[data-wa-close]').click(), 150);
    });
    if (c.recommended) {
      const item = document.createElement('div');
      item.className = 'wa-item is-recommended';
      item.innerHTML = '<span class="wa-badge"><span class="wa-star" aria-hidden="true">★</span> Önerilen</span>';
      item.appendChild(a);
      list.appendChild(item);
    } else {
      const item = document.createElement('div');
      item.className = 'wa-item';
      item.appendChild(a);
      list.appendChild(item);
    }
  });
  return wrap;
}
