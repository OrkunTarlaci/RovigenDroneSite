// ==========================================================================
// HAVAKARE — faq.js
// Standalone, self-contained module for the FAQ / "Merak Edilenler" section.
// Does NOT touch main.js, droneStage.js, droneModel.js or scene.js — it only
// wires up the FAQ accordion and the FAQ-section WhatsApp CTA button.
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  initFaqAccordion();
  initFaqWhatsAppLink();
});

// ---------------------------------------------------------------------
// Accordion: single-open-at-a-time, soft CSS-driven expand (grid-template-
// rows 0fr -> 1fr in styles.css), no height math needed in JS.
// ---------------------------------------------------------------------
function initFaqAccordion() {
  const items = document.querySelectorAll('#faq .faq-item');
  if (!items.length) return;

  items.forEach((item) => {
    const trigger = item.querySelector('.faq-question');
    if (!trigger) return;

    trigger.addEventListener('click', () => {
      const wasOpen = item.classList.contains('is-open');

      items.forEach((other) => {
        other.classList.remove('is-open');
        const otherTrigger = other.querySelector('.faq-question');
        if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
      });

      if (!wasOpen) {
        item.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

// ---------------------------------------------------------------------
// FAQ WhatsApp CTA: reuses the exact phone number already injected by
// main.js into the site's existing [data-whatsapp-link] elements (contact
// section / floating button), just with its own message text. Never
// hardcodes or guesses a new number — reads it straight from the existing
// link on the page.
// ---------------------------------------------------------------------
function initFaqWhatsAppLink() {
  const targets = document.querySelectorAll('[data-faq-whatsapp-link]');
  if (!targets.length) return;

  const existingLink = document.querySelector('[data-whatsapp-link]');
  if (!existingLink) return;

  const existingHref = existingLink.getAttribute('href');
  if (!existingHref) return;

  const faqMessage = "Merhaba, HAVAKARE drone çekimleri hakkında bir sorum olacaktı.";
  let newHref = existingHref;

  try {
    const url = new URL(existingHref, window.location.href);
    const phone = url.pathname.replace(/\//g, '');
    if (phone) {
      newHref = `https://wa.me/${phone}?text=${encodeURIComponent(faqMessage)}`;
    }
  } catch (err) {
    // Fallback: reuse the existing href as-is (same number, default message)
    // rather than ever inventing a new phone number.
    newHref = existingHref;
  }

  targets.forEach((el) => (el.href = newHref));
}
