/* Images generees pour le bot Discord : cartes d'annonce et bannieres de salons.
   Utilise @napi-rs/canvas (aucune dependance systeme) et la police Geist (@fontsource/geist). */
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const ORANGE = '#ff5a1f', GOLD = '#f5b942', GREEN = '#4ade80';
let fontsDone = false, logo = null;

function initFonts() {
  if (fontsDone) return; fontsDone = true;
  const dir = path.join(__dirname, 'node_modules', '@fontsource', 'geist', 'files');
  for (const f of ['geist-latin-500-normal.woff', 'geist-latin-700-normal.woff', 'geist-latin-800-normal.woff']) {
    try { GlobalFonts.registerFromPath(path.join(dir, f), 'Geist'); } catch (e) { console.error('[cards] police :', e.message); }
  }
}
const font = (w, s) => `${w} ${Math.round(s)}px Geist, "Segoe UI", Arial, sans-serif`;
const hex = c => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const rgba = (c, a) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; };

function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function spacedWidth(c, text, sp) { let w = 0; for (const ch of text) w += c.measureText(ch).width + sp; return w - sp; }
function spaced(c, text, x, y, sp) { for (const ch of text) { c.fillText(ch, x, y); x += c.measureText(ch).width + sp; } return x; }
function wrap(c, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (c.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); let last = keep[maxLines - 1]; while (c.measureText(last + '…').width > maxW && last.length > 1) last = last.slice(0, -1); keep[maxLines - 1] = last + '…'; return keep; }
  return lines;
}
function drawStar(c, cx, cy, r) {
  c.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? r * 0.45 : r; const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad; i ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.closePath(); c.fill();
}
async function getLogo() { if (!logo) logo = await loadImage(path.join(__dirname, 'public', 'logo-transparent.png')).catch(() => null); return logo; }

/* fond de marque quand il n'y a pas d'image : quadrillage, halos et filigrane */
async function brandBackground(c, W, H, accent) {
  c.fillStyle = '#09090b'; c.fillRect(0, 0, W, H);
  const g1 = c.createRadialGradient(W * 0.86, H * 0.18, 0, W * 0.86, H * 0.18, W * 0.62); g1.addColorStop(0, rgba(accent, 0.55)); g1.addColorStop(1, rgba(accent, 0)); c.fillStyle = g1; c.fillRect(0, 0, W, H);
  const g2 = c.createRadialGradient(W * 0.05, H * 1.05, 0, W * 0.05, H * 1.05, W * 0.5); g2.addColorStop(0, rgba(accent, 0.22)); g2.addColorStop(1, rgba(accent, 0)); c.fillStyle = g2; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(255,255,255,.045)'; c.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (let y = 0; y <= H; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  const lg = await getLogo(); if (lg) { const s = H * 1.25; c.globalAlpha = 0.07; c.drawImage(lg, W - s * 0.78, H / 2 - s / 2, s, s); c.globalAlpha = 1; }
}
function drawCover(c, img, W, H) { const s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s; c.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); }
function brandTag(c, x, y, light) {
  return getLogo().then(lg => {
    if (lg) c.drawImage(lg, x, y - 6, 46, 46);
    c.fillStyle = light || 'rgba(255,255,255,.92)'; c.font = font(800, 24); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    spaced(c, 'LEGEND', x + 60, y + 29, 6);
  });
}

/* carte d'annonce 1200x630 */
async function resourceCard({ title, category, author, vip, cover, teaser }) {
  initFonts();
  const W = 1200, H = 630, cv = createCanvas(W, H), c = cv.getContext('2d'), accent = vip ? GOLD : ORANGE;
  let img = null; if (cover) img = await loadImage(cover).catch(() => null);
  if (img) { c.fillStyle = '#09090b'; c.fillRect(0, 0, W, H); drawCover(c, img, W, H); } else await brandBackground(c, W, H, accent);
  // voiles de lisibilite
  const lr = c.createLinearGradient(0, 0, W, 0); lr.addColorStop(0, 'rgba(9,9,11,.94)'); lr.addColorStop(0.55, `rgba(9,9,11,${img ? 0.62 : 0.4})`); lr.addColorStop(1, `rgba(9,9,11,${img ? 0.12 : 0})`);
  c.fillStyle = lr; c.fillRect(0, 0, W, H);
  const bt = c.createLinearGradient(0, H * 0.55, 0, H); bt.addColorStop(0, 'rgba(9,9,11,0)'); bt.addColorStop(1, 'rgba(9,9,11,.85)'); c.fillStyle = bt; c.fillRect(0, 0, W, H);
  if (teaser) { c.fillStyle = 'rgba(9,9,11,.72)'; c.fillRect(0, 0, W, H); }
  c.fillStyle = accent; c.fillRect(0, 0, 10, H);
  await brandTag(c, 64, 52);
  // pastille de categorie (en haut a droite)
  c.font = font(700, 19); const cat = String(category || '').toUpperCase(), cw = spacedWidth(c, cat, 3) + 52;
  rr(c, W - 64 - cw, 50, cw, 46, 23); c.fillStyle = 'rgba(9,9,11,.62)'; c.fill(); c.strokeStyle = rgba(accent, 0.8); c.lineWidth = 2; c.stroke();
  c.fillStyle = '#fff'; c.textAlign = 'left'; spaced(c, cat, W - 64 - cw + 26, 80, 3);
  // titre
  c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 24;
  let size = 96, lines; c.fillStyle = '#fff';
  for (; size >= 46; size -= 4) {            // on reduit la taille jusqu'a ce que tout le titre tienne sur 2 lignes
    c.font = font(800, size); lines = wrap(c, title, 860, 99);
    if (lines.length <= 2 && lines.every(l => c.measureText(l).width <= 860)) break;
  }
  if (size < 46) { size = 46; c.font = font(800, size); lines = wrap(c, title, 860, 2); }   // vraiment trop long : on coupe avec « … »
  const lh = size * 1.12, startY = 330 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => c.fillText(l, 64, startY + i * lh));
  c.shadowBlur = 0;
  // pied : createur + badge d'acces
  c.font = font(500, 30); c.fillStyle = 'rgba(255,255,255,.78)'; c.fillText('par ', 64, H - 64);
  const pw = c.measureText('par ').width; c.font = font(700, 30); c.fillStyle = '#fff'; c.fillText(String(author || '—').slice(0, 28), 64 + pw, H - 64);
  const star = vip || teaser, badge = teaser ? 'RÉSERVÉ AUX VIP' : vip ? 'VIP' : 'GRATUIT';
  c.font = font(800, 24); const bw = spacedWidth(c, badge, 3) + 56 + (star ? 32 : 0);
  rr(c, W - 64 - bw, H - 64 - 36, bw, 52, 26); c.fillStyle = star ? GOLD : GREEN; c.fill();
  c.fillStyle = '#0a0a0b';
  if (star) drawStar(c, W - 64 - bw + 40, H - 64 - 10, 11);   // la police n'a pas de « ★ » : on la dessine
  spaced(c, badge, W - 64 - bw + 28 + (star ? 32 : 0), H - 64 - 0, 3);
  return cv.toBuffer('image/png');
}

/* banniere d'entete 1200x300 pour les salons d'information */
async function sectionBanner({ title, subtitle, accent = ORANGE }) {
  initFonts();
  const W = 1200, H = 300, cv = createCanvas(W, H), c = cv.getContext('2d');
  await brandBackground(c, W, H, accent);
  const lr = c.createLinearGradient(0, 0, W, 0); lr.addColorStop(0, 'rgba(9,9,11,.8)'); lr.addColorStop(1, 'rgba(9,9,11,0)'); c.fillStyle = lr; c.fillRect(0, 0, W, H);
  c.fillStyle = accent; c.fillRect(0, 0, 10, H);
  await brandTag(c, 64, 48);
  c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 20; c.fillStyle = '#fff';
  let size = 92; do { c.font = font(800, size); size -= 4; } while (c.measureText(String(title).toUpperCase()).width > 940 && size > 40);
  c.fillText(String(title).toUpperCase(), 64, 180); c.shadowBlur = 0;
  if (subtitle) { c.font = font(500, 28); c.fillStyle = 'rgba(255,255,255,.7)'; c.fillText(cutTo(c, subtitle, 940), 64, 232); }
  return cv.toBuffer('image/png');
}
function cutTo(c, s, maxW) { s = String(s); while (c.measureText(s).width > maxW && s.length > 3) s = s.slice(0, -2); return s; }

module.exports = { resourceCard, sectionBanner };
