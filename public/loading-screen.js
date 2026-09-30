/* Createur d'ecran de chargement FiveM : 100% cote navigateur, export .zip */
(function () {
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEFAULTS = {
    name: 'MON SERVEUR', sub: 'Roleplay sérieux · discord.gg/monserveur', accent: '#ff4a00',
    preset: 'grid', overlay: 55, particles: true, volume: 40, author: '', folder: 'mon_loadingscreen',
    tips: "Reste dans ton personnage à tout moment.\nRespecte les règles du serveur.\nBesoin d'aide ? Rejoins notre Discord.",
    logo: null, bg: null, music: null
  };
  const LIMITS = { logo: 2, bg: 6, music: 15 }; // Mo

  const safeJson = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ' ');
  const ext = (file, fallback) => (file.name.split('.').pop() || fallback).toLowerCase().replace(/[^a-z0-9]/g, '') || fallback;

  /* ---------- generation des fichiers ---------- */
  function build(S, mode) {
    const src = (o, p) => (o ? (mode === 'preview' ? o.data : p) : '');
    const logoP = S.logo ? 'assets/logo.' + S.logo.ext : '';
    const bgP = S.bg ? 'assets/background.' + S.bg.ext : '';
    const musicP = S.music ? 'assets/music.' + S.music.ext : '';
    const acc = /^#[0-9a-f]{6}$/i.test(S.accent) ? S.accent : '#ff4a00';
    const cls = S.bg ? 'img' : S.preset;

    const css = [
      ':root{--a:' + acc + '}',
      '*{margin:0;padding:0;box-sizing:border-box}',
      "html,body{height:100%;overflow:hidden;background:#07070a;color:#f2f2f4;font-family:'Segoe UI',system-ui,sans-serif}",
      '.bg{position:fixed;inset:0;background:#07070a center/cover no-repeat}',
      '.bg.grid{background-image:linear-gradient(#ffffff09 1px,transparent 1px),linear-gradient(90deg,#ffffff09 1px,transparent 1px);background-size:56px 56px}',
      '.bg.halo{background:radial-gradient(ellipse at 50% 42%,' + acc + '38,transparent 62%),#07070a}',
      S.bg ? '.bg.img{background-image:url("' + src(S.bg, bgP) + '")}' : '',
      '.ov{position:fixed;inset:0;background:rgba(0,0,0,' + (S.bg ? (S.overlay / 100).toFixed(2) : '0') + ')}',
      '.center{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:16px;padding:0 6vw}',
      '#logo{max-width:min(220px,40vw);max-height:26vh;object-fit:contain;filter:drop-shadow(0 6px 24px #000a)}',
      'h1{font-size:clamp(1.6rem,5.2vw,4rem);letter-spacing:.28em;text-transform:uppercase;line-height:1.05}',
      'h1::after{content:"";display:block;width:56px;height:3px;background:var(--a);margin:16px auto 0}',
      '#sub{color:#a9a9b3;font-size:clamp(.8rem,1.6vw,1.05rem)}',
      '.foot{position:fixed;left:6vw;right:6vw;bottom:7vh}',
      '.row{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:12px;font-size:clamp(.7rem,1.3vw,.9rem)}',
      '.st{color:#8a8a93;text-transform:uppercase;letter-spacing:.14em;font-size:.72em}',
      '#tip{color:#8a8a93;max-width:46%;text-align:right;transition:opacity .4s}',
      '#pct{font-weight:700;color:#fff}',
      '.bar{height:3px;background:#ffffff1a;overflow:hidden}',
      '.bar i{display:block;height:100%;width:0;background:var(--a);transition:width .35s ease-out}',
      '.p{position:fixed;width:3px;height:3px;background:var(--a);opacity:.5;animation:fl linear infinite}',
      '@keyframes fl{from{transform:translateY(105vh)}to{transform:translateY(-10vh)}}'
    ].join('\n');

    const cfg = {
      name: S.name || 'MON SERVEUR', sub: S.sub || '',
      tips: S.tips.split('\n').map(t => t.trim()).filter(Boolean), particles: !!S.particles,
      music: src(S.music, musicP), volume: S.volume / 100, demo: mode === 'preview'
    };
    const js = [
      '(function(){',
      'var C=' + safeJson(cfg) + ';',
      'var $=function(i){return document.getElementById(i)};',
      '$("name").textContent=C.name;$("sub").textContent=C.sub;document.title=C.name;',
      'var bar=$("bar"),pct=$("pct"),st=$("st"),tip=$("tip");',
      'function setP(p){p=Math.max(0,Math.min(100,p));bar.style.width=p+"%";pct.textContent=Math.round(p)+" %";',
      ' st.textContent=p<25?"Initialisation":p<70?"Chargement des ressources":p<100?"Connexion au serveur":"Terminé"}',
      'window.addEventListener("message",function(e){var d=e.data||{};if(d.eventName==="loadProgress")setP(d.loadFraction*100)});',
      'if(C.demo||typeof window.invokeNative==="undefined"){var v=0;setInterval(function(){v+=Math.random()*3.2;if(v>103)v=0;setP(v)},380)}else{setP(0)}',
      'var ti=0;function nextTip(){if(!C.tips.length)return;tip.style.opacity=0;setTimeout(function(){tip.textContent=C.tips[ti++%C.tips.length];tip.style.opacity=1},400)}',
      'nextTip();setInterval(nextTip,6000);',
      'if(C.particles){for(var i=0;i<28;i++){var p=document.createElement("div");p.className="p";p.style.left=(Math.random()*100)+"vw";',
      ' p.style.animationDuration=(9+Math.random()*14)+"s";p.style.animationDelay="-"+(Math.random()*20)+"s";document.body.appendChild(p)}}',
      'if(C.music&&!C.demo){var a=new Audio(C.music);a.loop=true;a.volume=C.volume;var go=function(){a.play().catch(function(){})};go();document.addEventListener("click",go,{once:true})}',
      '})();'
    ].join('\n');

    const html = '<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loading</title>\n' +
      '<link rel="stylesheet" href="style.css"></head><body>\n' +
      '<div class="bg ' + cls + '"></div><div class="ov"></div>\n' +
      '<div class="center">' + (S.logo ? '<img id="logo" src="' + src(S.logo, logoP) + '" alt="">' : '') + '<h1 id="name"></h1><p id="sub"></p></div>\n' +
      '<div class="foot"><div class="row"><span class="st" id="st">Initialisation</span><span id="tip"></span><span id="pct">0 %</span></div><div class="bar"><i id="bar"></i></div></div>\n' +
      '<script src="script.js"></script></body></html>';

    const assets = [];
    if (S.logo) assets.push([logoP, S.logo]);
    if (S.bg) assets.push([bgP, S.bg]);
    if (S.music) assets.push([musicP, S.music]);
    const files = ['index.html', 'style.css', 'script.js', ...assets.map(a => a[0])];
    const manifest = [
      "fx_version 'cerulean'", "game 'gta5'", '',
      "author '" + (S.author || 'LEGEND').replace(/['\\\n]/g, '') + "'",
      "description 'Ecran de chargement genere avec LEGEND'", "version '1.0.0'", '',
      "loadscreen 'index.html'", '',
      'files {', files.map(f => "  '" + f + "'").join(',\n'), '}'
    ].join('\n');
    return { html, css, js, assets, manifest };
  }

  const dataSize = o => Math.ceil((o.data.length - o.data.indexOf(',') - 1) * 0.75);
  const estimate = S => {
    const b = build(S, 'export');
    return b.html.length + b.css.length + b.js.length + b.manifest.length + b.assets.reduce((a, [, o]) => a + dataSize(o), 0);
  };
  const fmt = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko');
  const folderName = S => (S.folder || 'loadingscreen').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40) || 'loadingscreen';

  async function download(S) {
    if (!window.JSZip) { alert('Bibliothèque zip non chargée, vérifie ta connexion.'); return; }
    const b = build(S, 'export'), z = new JSZip(), f = z.folder(folderName(S));
    f.file('fxmanifest.lua', b.manifest); f.file('index.html', b.html); f.file('style.css', b.css); f.file('script.js', b.js);
    for (const [p, o] of b.assets) f.file(p, o.data.slice(o.data.indexOf(',') + 1), { base64: true });
    const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = folderName(S) + '.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------- interface ---------- */
  window.loadingScreen = function () {
    const S = JSON.parse(JSON.stringify(DEFAULTS));
    let tab = 'id', timer = 0;
    const app = q('#app');
    app.innerHTML = `<div class="wrap" style="padding-bottom:90px">
      <div class="crumb"><a href="#/">← Retour au site</a></div>
      <h1 class="t">Écrans de chargement</h1>
      <p class="mut" style="margin:6px 0 24px">Compose l'écran de chargement de ton serveur FiveM, et repars avec la ressource prête à poser.</p>
      <div class="ls"><div><div class="lsview"><iframe id="lsf" sandbox="allow-scripts" title="Aperçu"></iframe></div>
        <div class="lsbar"><div><b>Ressource FiveM</b><div class="mut" id="lsz" style="font-size:.82rem"></div></div>
        <div style="display:flex;gap:8px"><button class="btn ghost sm" id="lsr">Réinitialiser</button><button class="btn sm" id="lsd">Télécharger le .zip</button></div></div></div>
      <div class="lsside" id="lsp"></div></div></div>`;

    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const b = build(S, 'preview');
        q('#lsf').srcdoc = b.html.replace('<link rel="stylesheet" href="style.css">', () => '<style>' + b.css + '</style>')
          .replace('<script src="script.js"></script>', () => '<script>' + b.js.replace(/<\/script/gi, '<\\/script') + '<\/script>');
        q('#lsz').textContent = 'Environ ' + fmt(estimate(S)) + ' une fois l\'archive constituée';
      }, 120);
    };
    const pick = (key, file) => {
      if (!file) return;
      const lim = LIMITS[key];
      if (file.size > lim * 1048576) { alert('Fichier trop lourd (max ' + lim + ' Mo).'); return; }
      const ok = key === 'music' ? /^audio\//.test(file.type) : /^image\/(png|jpe?g|webp|gif)$/.test(file.type);
      if (!ok) { alert(key === 'music' ? 'Format audio attendu (mp3, ogg…).' : 'Image attendue (png, jpg, webp).'); return; }
      const r = new FileReader();
      r.onload = () => { S[key] = { name: file.name, data: r.result, ext: ext(file, key === 'music' ? 'mp3' : 'png') }; panel(); refresh(); };
      r.readAsDataURL(file);
    };
    const upl = (key, label) => `<div class="fld"><label>${label}</label><input type="file" id="f-${key}" hidden accept="${key === 'music' ? 'audio/*' : 'image/png,image/jpeg,image/webp,image/gif'}">
      <button class="btn ghost full sm" data-up="${key}">${S[key] ? '↻ Remplacer' : '⬆ Choisir un fichier'}</button>
      ${S[key] ? `<div class="fileok"><span>${h(S[key].name)}</span><button class="btn ghost sm" data-rm="${key}">Retirer</button></div>` : `<small>Max ${LIMITS[key]} Mo</small>`}</div>`;

    const panel = () => {
      let p = document.createElement('div');
      if (tab === 'id') p.innerHTML = `<div class="fld"><label>Nom du serveur</label><input data-k="name" maxlength="40" value="${h(S.name)}"></div>
        <div class="fld"><label>Sous-titre</label><input data-k="sub" maxlength="90" value="${h(S.sub)}"></div>${upl('logo', 'Logo')}`;
      if (tab === 'vis') p.innerHTML = `<div class="fld"><label>Fond</label><select data-k="preset"><option value="grid">Grille</option><option value="plain">Uni</option><option value="halo">Halo</option></select><small>Ignoré si tu ajoutes une image de fond.</small></div>
        <div class="fld"><label>Couleur d'accent</label><input type="color" data-k="accent" value="${h(S.accent)}" style="height:42px;padding:3px"></div>
        ${upl('bg', 'Image de fond')}
        <div class="fld"><label>Assombrissement de l'image : <span id="ovv">${S.overlay}</span>%</label><input type="range" data-k="overlay" min="0" max="90" value="${S.overlay}"></div>
        <label class="check" style="margin:0"><input type="checkbox" data-k="particles" ${S.particles ? 'checked' : ''}><span>Particules animées</span></label>`;
      if (tab === 'ct') p.innerHTML = `<div class="fld"><label>Astuces (une par ligne)</label><textarea data-k="tips" style="min-height:130px">${h(S.tips)}</textarea><small>Elles défilent toutes les 6 secondes.</small></div>
        ${upl('music', 'Musique (optionnel)')}<div class="fld"><label>Volume : <span id="vlv">${S.volume}</span>%</label><input type="range" data-k="volume" min="0" max="100" value="${S.volume}"></div>`;
      if (tab === 'ex') p.innerHTML = `<div class="fld"><label>Nom du dossier</label><input data-k="folder" maxlength="40" value="${h(S.folder)}"><small>Lettres, chiffres, _ et - uniquement.</small></div>
        <div class="fld"><label>Auteur</label><input data-k="author" maxlength="40" value="${h(S.author)}" placeholder="LEGEND"></div>
        <div class="flash"><b style="color:var(--txt)">Installation</b><br>1. Dézippe dans <code>resources/</code><br>2. Ajoute <code>ensure ${h(folderName(S))}</code> dans <code>server.cfg</code><br>3. Redémarre le serveur.</div>
        <button class="btn full" style="margin-top:14px" data-dl>Télécharger le .zip</button>`;
      q('#lsp').innerHTML = [['id', 'Identité'], ['vis', 'Visuel'], ['ct', 'Contenu'], ['ex', 'Export']].map(([id, t]) =>
        `<div class="acc ${id === tab ? 'open' : ''}"><button class="acch" data-t="${id}">${t}<i>▾</i></button>${id === tab ? '<div class="accb"></div>' : ''}</div>`).join('');
      q('.acc.open .accb').append(...p.childNodes);
      p = q('.acc.open .accb');
      qa('.acch', app).forEach(b => b.onclick = () => { tab = b.dataset.t; panel(); });
      const sel = q('select[data-k=preset]', p); if (sel) sel.value = S.preset;
      qa('[data-k]', p).forEach(el => el.oninput = () => {
        S[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
        if (el.dataset.k === 'overlay') q('#ovv').textContent = S.overlay;
        if (el.dataset.k === 'volume') q('#vlv').textContent = S.volume;
        refresh();
      });
      qa('[data-up]', p).forEach(b => b.onclick = () => q('#f-' + b.dataset.up).click());
      ['logo', 'bg', 'music'].forEach(k => { const f = q('#f-' + k, p); if (f) f.onchange = () => pick(k, f.files[0]); });
      qa('[data-rm]', p).forEach(b => b.onclick = () => { S[b.dataset.rm] = null; panel(); refresh(); });
      const dl = q('[data-dl]', p); if (dl) dl.onclick = () => download(S);
    };
    q('#lsd').onclick = () => download(S);
    q('#lsr').onclick = () => { if (confirm('Tout réinitialiser ?')) { Object.assign(S, JSON.parse(JSON.stringify(DEFAULTS))); panel(); refresh(); } };
    panel(); refresh();
  };
})();
