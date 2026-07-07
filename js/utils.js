// ==========================================================================
// AERON — utils.js
// Small shared helpers used across modules.
// ==========================================================================

export function buildWhatsAppUrl(phone, message) {
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${phone}?text=${encoded}`;
}
