/* Paiement en cryptomonnaies via NOWPayments (https://nowpayments.io).
   Variables : NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET  (+ NOWPAYMENTS_SANDBOX=1 pour tester, NOWPAYMENTS_API_URL pour surcharger l'adresse de l'API). */
const crypto = require('crypto');

const apiUrl = () => process.env.NOWPAYMENTS_API_URL || (process.env.NOWPAYMENTS_SANDBOX === '1' ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1');
const configured = () => !!process.env.NOWPAYMENTS_API_KEY && !!process.env.NOWPAYMENTS_IPN_SECRET;

// NOWPayments signe le corps de la notification trie par ordre alphabetique des cles (recursivement)
const sortDeep = o => (Array.isArray(o) ? o.map(sortDeep) : o && typeof o === 'object' ? Object.keys(o).sort().reduce((a, k) => { a[k] = sortDeep(o[k]); return a; }, {}) : o);
const sign = body => crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET || '').update(JSON.stringify(sortDeep(body))).digest('hex');
function verify(body, sig) {
  if (!configured() || !body || typeof body !== 'object' || typeof sig !== 'string') return false;
  const a = Buffer.from(sign(body)), b = Buffer.from(sig.toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function createInvoice({ amount, currency, orderId, description, ipnUrl, successUrl, cancelUrl }) {
  const r = await fetch(apiUrl() + '/invoice', {
    method: 'POST', headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ price_amount: amount, price_currency: currency, order_id: orderId, order_description: description, ipn_callback_url: ipnUrl, success_url: successUrl, cancel_url: cancelUrl })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.invoice_url) throw new Error(j.message || `NOWPayments ${r.status}`);
  return { id: String(j.id), url: j.invoice_url };
}

module.exports = { configured, verify, sign, createInvoice, sandbox: () => process.env.NOWPAYMENTS_SANDBOX === '1' };
