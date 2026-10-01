/* Createur de banniere de serveur Discord (GIF anime) : 100% cote navigateur.
   Chaque modele est une fonction de t dans [0,1[ construite pour boucler parfaitement. */
(function () {
  const TAU = Math.PI * 2;
  const q = (s, r = document) => r.querySelector(s);
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- outils de dessin ---------- */
  const rnd = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c) || [0, 'ff5a1f']; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const rgba = (c, a) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; };
  const mix = (c1, c2, t) => { const a = hex(c1), b = hex(c2); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; };
  const toHue = c => { const [r, g, b] = hex(c).map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return 20; const d = mx - mn; const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return hh * 60; };
  const hsl = (hh, s, l, a = 1) => `hsla(${((hh % 360) + 360) % 360},${s}%,${l}%,${a})`;
  const bgFill = (c, w, hh, P, lift = 0.12) => { const g = c.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, P.bg); g.addColorStop(1, mix(P.bg, P.accent, lift)); c.fillStyle = g; c.fillRect(0, 0, w, hh); };
  const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };

  /* ---------- couche de texte commune ---------- */
  const FONTS = { sans: 'Geist, "Segoe UI", system-ui, sans-serif', mono: '"Geist Mono", Consolas, monospace', display: 'Impact, "Arial Black", sans-serif', serif: 'Georgia, "Times New Roman", serif' };
  function textLayer(c, w, hh, P, o = {}) {
    const k = w / 960, ff = FONTS[P.font] || FONTS.sans, left = P.align === 'left', x = left ? 72 * k : w / 2;
    const title = String(P.title || '').toUpperCase(), sub = String(P.sub || '');
    c.save(); c.textAlign = left ? 'left' : 'center'; c.textBaseline = 'middle';
    let size = 88 * k; const setF = () => { c.font = `700 ${size}px ${ff}`; if ('letterSpacing' in c) c.letterSpacing = (0.06 * size) + 'px'; };
    setF(); const maxW = w * (left ? 0.8 : 0.84);
    while (c.measureText(title).width > maxW && size > 24 * k) { size -= 3 * k; setF(); }
    const logoH = P.logoImg ? 120 * k : 0, subSize = Math.max(18 * k, size * 0.34);
    const total = logoH + (P.logoImg ? 18 * k : 0) + size + (sub ? subSize * 1.8 : 0);
    let y = hh / 2 - total / 2;
    if (P.logoImg) { const ar = P.logoImg.width / P.logoImg.height, lw = logoH * ar; c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 16 * k; c.drawImage(P.logoImg, left ? x : x - lw / 2, y, lw, logoH); y += logoH + 18 * k; }
    c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 18 * k; c.fillStyle = o.color || '#fff';
    y += size / 2; c.fillText(title, x + (o.dx || 0), y + (o.dy || 0));
    if (sub) { y += size / 2 + subSize * 0.9; if ('letterSpacing' in c) c.letterSpacing = (0.03 * subSize) + 'px'; c.font = `500 ${subSize}px ${ff}`; c.fillStyle = o.sub || 'rgba(255,255,255,.72)'; c.fillText(sub, x + (o.dx || 0), y + (o.dy || 0)); }
    c.restore();
  }

  /* ---------- modeles gratuits ---------- */
  function minimal(c, w, hh, t, P) {
    const k = w / 960; c.fillStyle = P.bg; c.fillRect(0, 0, w, hh);
    c.strokeStyle = 'rgba(255,255,255,.045)'; c.lineWidth = 1;
    for (let x = 0; x <= w; x += 48 * k) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, hh); c.stroke(); }
    for (let y = 0; y <= hh; y += 48 * k) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    const L = 320 * k, sweep = (x, y, dir) => { const g = c.createLinearGradient(x, 0, x + L, 0); g.addColorStop(0, rgba(P.accent, 0)); g.addColorStop(.5, P.accent); g.addColorStop(1, rgba(P.accent, 0)); c.fillStyle = g; c.fillRect(0, y, w, 3 * k); };
    const xa = t * (w + L) - L; c.save(); c.beginPath(); c.rect(0, hh - 3 * k - 24 * k, w, 3 * k + 24 * k); c.clip(); const g1 = c.createLinearGradient(xa, 0, xa + L, 0); g1.addColorStop(0, rgba(P.accent, 0)); g1.addColorStop(.5, P.accent); g1.addColorStop(1, rgba(P.accent, 0)); c.fillStyle = g1; c.fillRect(0, hh - 28 * k, w, 3 * k); c.restore();
    const xb = w - xa - L; const g2 = c.createLinearGradient(xb, 0, xb + L, 0); g2.addColorStop(0, rgba(P.accent, 0)); g2.addColorStop(.5, P.accent); g2.addColorStop(1, rgba(P.accent, 0)); c.fillStyle = g2; c.fillRect(0, 25 * k, w, 3 * k);
    c.strokeStyle = P.accent; c.lineWidth = 3 * k; const m = 34 * k, s = 36 * k;
    [[m, m, 1, 1], [w - m, m, -1, 1], [m, hh - m, 1, -1], [w - m, hh - m, -1, -1]].forEach(([x, y, dx, dy]) => { c.beginPath(); c.moveTo(x, y + dy * s); c.lineTo(x, y); c.lineTo(x + dx * s, y); c.stroke(); });
  }
  function neon(c, w, hh, t, P) {
    const k = w / 960, hy = hh * 0.56; bgFill(c, w, hh, P, 0.22);
    const r = rnd(5); c.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 50; i++) { const x = r() * w, y = r() * hy * 0.9, s = (0.6 + r() * 1.4) * k; c.globalAlpha = 0.3 + 0.7 * (Math.sin(t * TAU * (1 + (i % 2)) + i) * 0.5 + 0.5); circle(c, x, y, s); } c.globalAlpha = 1;
    const sx = w / 2, sr = 150 * k, g = c.createLinearGradient(0, hy - sr, 0, hy); g.addColorStop(0, mix(P.accent, '#ffffff', 0.35)); g.addColorStop(1, P.accent);
    c.save(); c.beginPath(); c.arc(sx, hy, sr, Math.PI, 0); c.clip(); c.fillStyle = g; c.fillRect(sx - sr, hy - sr, sr * 2, sr);
    c.fillStyle = mix(P.bg, P.accent, 0.12); for (let i = 0; i < 6; i++) { const y = hy - sr * 0.1 - i * sr * 0.17, th = (2 + i * 2.2) * k; c.fillRect(sx - sr, y, sr * 2, th); } c.restore();
    c.fillStyle = mix(P.bg, '#000000', 0.55); c.fillRect(0, hy, w, hh - hy);
    c.strokeStyle = rgba(P.accent, 0.8); c.lineWidth = 2 * k; c.beginPath(); c.moveTo(0, hy); c.lineTo(w, hy); c.stroke();
    c.lineWidth = 1.5 * k; for (let i = -14; i <= 14; i++) { c.strokeStyle = rgba(P.accent, 0.45); c.beginPath(); c.moveTo(sx + i * 20 * k, hy); c.lineTo(sx + i * 150 * k, hh); c.stroke(); }
    const N = 12; for (let i = 0; i < N; i++) { const z = ((i + t) % N) / N, y = hy + (hh - hy) * z * z; c.strokeStyle = rgba(P.accent, 0.15 + 0.6 * z); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  }
  function particles(c, w, hh, t, P) {
    const k = w / 960; bgFill(c, w, hh, P, 0.18); const r = rnd(7);
    for (let i = 0; i < 75; i++) {
      const x0 = r() * w, y0 = r() * hh, s = (1.5 + r() * 4.5) * k, m = 1 + Math.floor(r() * 3), amp = (10 + r() * 34) * k, ph = r() * TAU, fq = 1 + Math.floor(r() * 2), al = 0.25 + r() * 0.65;
      const y = (((y0 - t * hh * m) % hh) + hh) % hh, x = x0 + Math.sin(t * TAU * fq + ph) * amp;
      if (s > 3.2 * k) { const g = c.createRadialGradient(x, y, 0, x, y, s * 5); g.addColorStop(0, rgba(P.accent, al * 0.5)); g.addColorStop(1, rgba(P.accent, 0)); c.fillStyle = g; c.fillRect(x - s * 5, y - s * 5, s * 10, s * 10); }
      c.fillStyle = rgba(P.accent, al); circle(c, x, y, s);
    }
    const v = c.createRadialGradient(w / 2, hh / 2, hh * 0.35, w / 2, hh / 2, w * 0.7); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)'); c.fillStyle = v; c.fillRect(0, 0, w, hh);
  }
  function waves(c, w, hh, t, P) {
    const k = w / 960; bgFill(c, w, hh, P, 0.1);
    for (let l = 0; l < 5; l++) {
      const base = hh * (0.5 + l * 0.09), amp = (28 - l * 3) * k, f = 1.4 + l * 0.45, ph = l * 1.3, dir = l % 2 ? 1 : -1, spd = 1 + (l % 2);
      c.beginPath(); c.moveTo(0, hh);
      for (let x = 0; x <= w; x += 8) { const u = x / w; c.lineTo(x, base + Math.sin(u * TAU * f + ph + dir * t * TAU * spd) * amp + Math.sin(u * TAU * f * 2.2 - dir * t * TAU) * amp * 0.35); }
      c.lineTo(w, hh); c.closePath(); c.fillStyle = rgba(P.accent, 0.1 + l * 0.07); c.fill();
      c.strokeStyle = rgba(P.accent, 0.25 + l * 0.1); c.lineWidth = 2 * k; c.stroke();
    }
  }
  function eclipse(c, w, hh, t, P) {
    const k = w / 960, cx = w / 2, cy = hh / 2, R = 175 * k; c.fillStyle = mix(P.bg, '#000000', 0.35); c.fillRect(0, 0, w, hh);
    const halo = c.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 2.6); halo.addColorStop(0, rgba(P.accent, 0.4)); halo.addColorStop(1, rgba(P.accent, 0)); c.fillStyle = halo; c.fillRect(0, 0, w, hh);
    if (c.createConicGradient) { const cg = c.createConicGradient(t * TAU, cx, cy); cg.addColorStop(0, rgba(P.accent, 0)); cg.addColorStop(0.72, rgba(P.accent, 0.25)); cg.addColorStop(0.98, P.accent); cg.addColorStop(1, rgba(P.accent, 0)); c.strokeStyle = cg; c.lineWidth = 12 * k; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke(); c.lineWidth = 3 * k; c.beginPath(); c.arc(cx, cy, R * 1.22, 0, TAU); c.stroke(); }
    c.fillStyle = '#050507'; circle(c, cx, cy, R * 0.96);
    const r = rnd(3); for (let i = 0; i < 28; i++) { const a = r() * TAU + t * TAU, d = R * (1.35 + r() * 0.9); c.fillStyle = rgba(P.accent, 0.2 + r() * 0.5); circle(c, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.6, (1 + r() * 2.2) * k); }
  }
  function matrix(c, w, hh, t, P) {
    const k = w / 960, cs = 22 * k; c.fillStyle = mix(P.bg, '#000000', 0.5); c.fillRect(0, 0, w, hh);
    const CH = '01ABCDEF<>{}/+=*#$%&', cols = Math.floor(w / cs), rows = hh / cs; c.font = `600 ${cs * 0.9}px ${FONTS.mono}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let col = 0; col < cols; col++) {
      const r = rnd(col + 1), sp = 1 + Math.floor(r() * 3), off = r(), len = 8 + Math.floor(r() * 12), head = ((off + t * sp) % 1) * (rows + len);
      for (let j = 0; j < len; j++) {
        const row = head - j, y = row * cs; if (y < -cs || y > hh + cs) continue;
        const idx = Math.abs((col * 31 + Math.floor(row) * 17) % CH.length), a = Math.pow(1 - j / len, 1.6);
        c.fillStyle = j === 0 ? 'rgba(255,255,255,.95)' : rgba(P.accent, a * 0.85); c.fillText(CH[idx], col * cs + cs / 2, y);
      }
    }
    const v = c.createRadialGradient(w / 2, hh / 2, hh * 0.2, w / 2, hh / 2, w * 0.65); v.addColorStop(0, 'rgba(0,0,0,.55)'); v.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = v; c.fillRect(0, 0, w, hh);
  }
  function glitch(c, w, hh, t, P) {
    const k = w / 960; bgFill(c, w, hh, P, 0.08); c.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < hh; y += 4 * k) c.fillRect(0, y, w, 1.5 * k);
    const bucket = Math.floor(t * 30), rr = rnd(bucket * 977 + 13), active = rr() < 0.28, mx = (6 + rr() * 16) * k;
    textLayer(c, w, hh, P);
    if (active) {
      c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = 0.85;
      textLayer(c, w, hh, P, { dx: -mx, color: '#ff2a55', sub: 'rgba(255,42,85,.6)' }); textLayer(c, w, hh, P, { dx: mx, color: '#22e5ff', sub: 'rgba(34,229,255,.6)' }); c.restore();
      for (let i = 0; i < 3; i++) { const y = rr() * hh, th = (6 + rr() * 26) * k, sh = (rr() - 0.5) * 70 * k; c.save(); c.beginPath(); c.rect(0, y, w, th); c.clip(); c.translate(sh, 0); textLayer(c, w, hh, P, { color: i ? P.accent : '#fff' }); c.restore(); }
      c.fillStyle = rgba(P.accent, 0.1); c.fillRect(0, rr() * hh, w, 2 * k);
    }
    return 'own';
  }

  /* ---------- modeles VIP ---------- */
  function aurora(c, w, hh, t, P) {
    const k = w / 960, H = toHue(P.accent); c.fillStyle = mix(P.bg, '#000000', 0.4); c.fillRect(0, 0, w, hh); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const dir = i % 2 ? 1 : -1, a = t * TAU * dir + i * 1.05, cx = w * (0.5 + 0.4 * Math.cos(a + i)), cy = hh * (0.5 + 0.34 * Math.sin(a * 1 + i * 0.7)), r = (230 + i * 38) * k;
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, hsl(H + i * 34, 85, 52, 0.5)); g.addColorStop(1, hsl(H + i * 34, 85, 52, 0)); c.fillStyle = g; c.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    c.globalCompositeOperation = 'source-over'; c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(0, 0, w, hh);
    const r = rnd(21); for (let i = 0; i < 70; i++) { const x = r() * w, y = r() * hh, s = (0.5 + r() * 1.6) * k, fq = 1 + Math.floor(r() * 3); c.fillStyle = `rgba(255,255,255,${0.15 + 0.75 * (Math.sin(t * TAU * fq + i * 2.1) * 0.5 + 0.5)})`; circle(c, x, y, s); }
  }
  function crystal(c, w, hh, t, P) {
    const k = w / 960, cx = w / 2, cy = hh / 2; const g = c.createRadialGradient(cx, cy, 0, cx, cy, w * 0.6); g.addColorStop(0, mix(P.bg, P.accent, 0.3)); g.addColorStop(1, mix(P.bg, '#000000', 0.5)); c.fillStyle = g; c.fillRect(0, 0, w, hh);
    for (let j = 0; j < 14; j++) { const a = t * TAU + j * TAU / 14; c.strokeStyle = rgba(P.accent, 0.07); c.lineWidth = 18 * k; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * w); c.stroke(); }
    for (let i = 0; i < 10; i++) {
      const sides = 3 + (i % 4), r = (46 + i * 30) * k, dir = i % 2 ? 1 : -1, rot = t * TAU * dir * (1 + (i % 3 === 0 ? 1 : 0)) + i * 0.4;
      c.beginPath(); for (let s = 0; s <= sides; s++) { const a = rot + s * TAU / sides; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.78; s ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.fillStyle = rgba(P.accent, 0.03 + 0.02 * (i % 3)); c.fill(); c.strokeStyle = rgba(mix(P.accent, '#ffffff', 0.25 * (i % 4) / 3), 0.18 + 0.5 * (1 - i / 10)); c.lineWidth = 2 * k; c.stroke();
    }
    const cg = c.createRadialGradient(cx, cy, 0, cx, cy, 120 * k); cg.addColorStop(0, rgba('#ffffff', 0.5)); cg.addColorStop(1, rgba(P.accent, 0)); c.fillStyle = cg; c.fillRect(0, 0, w, hh);
  }
  function warp(c, w, hh, t, P) {
    const k = w / 960, cx = w / 2, cy = hh / 2, R = Math.hypot(w, hh) / 2; c.fillStyle = mix(P.bg, '#000000', 0.55); c.fillRect(0, 0, w, hh);
    const glow = c.createRadialGradient(cx, cy, 0, cx, cy, hh * 0.7); glow.addColorStop(0, rgba(P.accent, 0.28)); glow.addColorStop(1, rgba(P.accent, 0)); c.fillStyle = glow; c.fillRect(0, 0, w, hh);
    const r = rnd(11); c.lineCap = 'round';
    for (let i = 0; i < 170; i++) {
      const ang = r() * TAU, ph = r(), z = (ph + t) % 1, z0 = Math.max(0, z - 0.07), d1 = z0 * z0 * R * 1.15, d2 = z * z * R * 1.15, ca = Math.cos(ang), sa = Math.sin(ang);
      c.strokeStyle = z > 0.55 ? `rgba(255,255,255,${z})` : rgba(mix(P.accent, '#ffffff', 0.4), 0.2 + z); c.lineWidth = (0.5 + z * 2.4) * k;
      c.beginPath(); c.moveTo(cx + ca * d1, cy + sa * d1); c.lineTo(cx + ca * d2, cy + sa * d2); c.stroke();
    }
  }

  const TPL = [
    { id: 'minimal', name: 'Minimal', draw: minimal }, { id: 'neon', name: 'Néon', draw: neon }, { id: 'particules', name: 'Particules', draw: particles },
    { id: 'vagues', name: 'Vagues', draw: waves }, { id: 'eclipse', name: 'Éclipse', draw: eclipse }, { id: 'matrice', name: 'Matrice', draw: matrix },
    { id: 'glitch', name: 'Glitch', draw: glitch },
    { id: 'aurore', name: 'Aurore', draw: aurora, vip: true }, { id: 'cristal', name: 'Cristal', draw: crystal, vip: true }, { id: 'hyperespace', name: 'Hyperespace', draw: warp, vip: true }
  ];
  const render = (c, w, hh, t, S, img) => { const P = { ...S, logoImg: img }; const tp = TPL.find(x => x.id === S.tpl) || TPL[0]; if (tp.draw(c, w, hh, t, P) !== 'own') textLayer(c, w, hh, P); };

  /* ---------- bibliotheque GIF (chargee a la demande) ---------- */
  let gifLib = null;
  const loadGif = () => gifLib || (gifLib = (async () => {
    const base = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/';
    await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = base + 'gif.js'; s.onload = ok; s.onerror = () => ko(new Error('Bibliothèque GIF indisponible')); document.head.appendChild(s); });
    const txt = await fetch(base + 'gif.worker.js').then(r => r.text());
    return URL.createObjectURL(new Blob([txt], { type: 'text/javascript' }));
  })().catch(e => { gifLib = null; throw e; }));

  /* ---------- interface ---------- */
  const QUAL = { light: 640, std: 800, high: 960 };
  window.bannerTool = function () {
    const S = { tpl: 'minimal', title: 'MON SERVEUR', sub: 'discord.gg/monserveur', align: 'center', font: 'sans', accent: '#ff5a1f', bg: '#0b0b0e', dur: 3, qual: 'std' };
    let logo = null, raf = 0, busy = false;
    const vipOk = () => (typeof canVip === 'function' ? canVip() : false);
    const tp = () => TPL.find(x => x.id === S.tpl);
    const app = q('#app');
    app.innerHTML = `<div class="wrap" style="padding-bottom:90px"><div class="crumb"><a href="#/">← Retour au site</a></div>
      <h1 class="t">Bannière de serveur Discord</h1><p class="mut" style="margin:6px 0 24px">Choisis un modèle animé, personnalise-le et exporte-le en GIF (960×540 recommandé par Discord).</p>
      <div class="ls"><div><div class="lsview"><canvas id="bc" width="960" height="540" style="width:100%;height:100%;display:block"></canvas></div>
        <div class="lsbar"><div><b id="bn"></b><div class="mut" id="bi" style="font-size:.82rem"></div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" id="bp">Image fixe (PNG)</button><button class="btn sm" id="bg2">Exporter en GIF</button></div></div>
        <div id="bs" style="margin-top:12px"></div></div>
      <div class="lsside" id="side">
        <details class="dacc" open><summary>Modèle</summary><div class="tplgrid" id="tg"></div></details>
        <details class="dacc" open><summary>Texte</summary>
          <div class="fld"><label>Titre</label><input id="f-title" maxlength="40" value="${h(S.title)}"></div>
          <div class="fld"><label>Sous-titre</label><input id="f-sub" maxlength="70" value="${h(S.sub)}"></div>
          <div class="grid2"><div class="fld"><label>Alignement</label><select id="f-align"><option value="center">Centré</option><option value="left">À gauche</option></select></div>
          <div class="fld"><label>Police</label><select id="f-font"><option value="sans">Moderne</option><option value="mono">Code</option><option value="display">Impact</option><option value="serif">Élégante</option></select></div></div>
          <div class="fld"><label>Logo (optionnel)</label><input type="file" id="f-logo" accept="image/png,image/jpeg,image/webp" hidden><button class="btn ghost full sm" id="b-logo">⬆ Choisir un logo</button><div id="logo-st"></div></div></details>
        <details class="dacc"><summary>Couleurs</summary><div class="grid2"><div class="fld"><label>Accent</label><input type="color" id="f-accent" value="${S.accent}"></div><div class="fld"><label>Fond</label><input type="color" id="f-bg" value="${S.bg}"></div></div></details>
        <details class="dacc"><summary>Export</summary>
          <div class="grid2"><div class="fld"><label>Durée de la boucle</label><select id="f-dur"><option value="2">Courte · 2 s</option><option value="3" selected>Normale · 3 s</option><option value="4">Longue · 4 s</option></select></div>
          <div class="fld"><label>Qualité</label><select id="f-qual"><option value="light">Légère · 640×360</option><option value="std" selected>Standard · 800×450</option><option value="high">Haute · 960×540</option></select></div></div>
          <small class="dim">Discord limite le poids des bannières (environ 10 Mo). Si ton GIF est trop lourd, choisis une durée plus courte ou une qualité plus légère. Les bannières animées demandent un serveur avec assez de boosts.</small></details>
      </div></div></div>`;

    const cv = q('#bc'), cx = cv.getContext('2d');
    const info = () => { q('#bn').textContent = tp().name + (tp().vip ? ' · VIP' : ''); q('#bi').textContent = `${S.dur} s en boucle · ${QUAL[S.qual]}×${Math.round(QUAL[S.qual] * 9 / 16)}`; };
    const flash = (m, cls = '') => { q('#bs').innerHTML = m ? `<div class="flash ${cls}">${m}</div>` : ''; };
    const grid = () => {
      q('#tg').innerHTML = TPL.map(t => `<button class="tpl ${t.id === S.tpl ? 'on' : ''}" data-t="${t.id}"><canvas width="240" height="135"></canvas>${t.vip ? `<span class="lock">★ VIP</span>` : ''}<span>${h(t.name)}</span></button>`).join('');
      [...document.querySelectorAll('#tg .tpl')].forEach((b, i) => {
        const c2 = b.querySelector('canvas').getContext('2d'); render(c2, 240, 135, 0.3, { ...S, tpl: TPL[i].id, title: 'LEGEND', sub: '', logoImg: null }, null);
        b.onclick = () => { S.tpl = TPL[i].id; grid(); info(); flash(TPL[i].vip && !vipOk() ? '★ Modèle VIP : tu peux le prévisualiser, mais l\'export est réservé aux VIP. <a href="#/vip" style="text-decoration:underline">Découvrir le VIP</a>' : '', TPL[i].vip && !vipOk() ? 'vip' : ''); };
      });
    };
    const loop = () => { if (!document.body.contains(cv)) return; render(cx, 960, 540, ((performance.now() / 1000) / S.dur) % 1, S, logo); raf = requestAnimationFrame(loop); };

    const bind = (id, key, num) => { const el = q('#' + id); el.oninput = () => { S[key] = num ? +el.value : el.value; if (key === 'tpl') grid(); info(); if (['accent', 'bg', 'font'].includes(key)) grid(); }; };
    bind('f-title', 'title'); bind('f-sub', 'sub'); bind('f-align', 'align'); bind('f-font', 'font'); bind('f-accent', 'accent'); bind('f-bg', 'bg'); bind('f-dur', 'dur', true); bind('f-qual', 'qual');
    q('#b-logo').onclick = () => q('#f-logo').click();
    q('#f-logo').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      if (!/^image\/(png|jpe?g|webp)$/.test(f.type) || f.size > 2 * 1048576) { q('#logo-st').innerHTML = '<small class="dim">Image PNG/JPG/WEBP, 2 Mo max.</small>'; return; }
      const im = new Image(); im.onload = () => { logo = im; q('#logo-st').innerHTML = `<div class="fileok"><span>${h(f.name)}</span><button class="btn ghost sm" id="rm-logo">Retirer</button></div>`; q('#rm-logo').onclick = () => { logo = null; q('#logo-st').innerHTML = ''; }; }; im.src = URL.createObjectURL(f);
    };

    const guard = () => { if (tp().vip && !vipOk()) { flash('★ Ce modèle est réservé aux membres VIP. <a href="#/vip" style="text-decoration:underline">Découvrir le VIP</a>', 'vip'); return false; } return true; };
    q('#bp').onclick = () => {
      if (!guard()) return; const c3 = document.createElement('canvas'); c3.width = 960; c3.height = 540; render(c3.getContext('2d'), 960, 540, 0.3, S, logo);
      c3.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'banniere-' + S.tpl + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
    };
    q('#bg2').onclick = async () => {
      if (busy || !guard()) return; busy = true; const btn = q('#bg2'); btn.disabled = true; flash('Préparation…');
      try {
        const worker = await loadGif(), W = QUAL[S.qual], H = Math.round(W * 9 / 16), fps = 12, n = S.dur * fps;
        const off = document.createElement('canvas'); off.width = W; off.height = H; const oc = off.getContext('2d', { willReadFrequently: true });
        const gif = new GIF({ workers: 2, quality: 12, width: W, height: H, workerScript: worker, repeat: 0 });
        for (let i = 0; i < n; i++) { render(oc, W, H, i / n, S, logo); gif.addFrame(oc, { copy: true, delay: Math.round(1000 / fps) }); }
        gif.on('progress', p => flash(`Encodage du GIF… ${Math.round(p * 100)} %`));
        gif.on('finished', blob => {
          const mb = blob.size / 1048576, a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'banniere-' + S.tpl + '.gif'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 8000);
          flash(`GIF exporté : <b>${mb.toFixed(1)} Mo</b>` + (mb > 10 ? ' — trop lourd pour Discord (max ~10 Mo). Choisis « Légère » ou une durée plus courte.' : ' — sous la limite de Discord.'), mb > 10 ? 'err' : 'ok');
          busy = false; btn.disabled = false;
        });
        gif.render();
      } catch (e) { flash('Erreur : ' + h(e.message), 'err'); busy = false; btn.disabled = false; }
    };

    grid(); info(); cancelAnimationFrame(raf); loop();
  };
})();
