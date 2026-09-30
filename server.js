require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const createStore = require('./store');

const {
  PORT = 3000, BASE_URL = 'http://localhost:3000', SESSION_SECRET,
  DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, ADMIN_IDS = '', MAX_UPLOAD_MB = '200',
  STORAGE_DIR = __dirname   // dossier des donnees et des fichiers : pointe-le vers un volume persistant
} = process.env;

if (!SESSION_SECRET || !DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
  console.error('Configure les variables SESSION_SECRET, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET.');
  process.exit(1);
}
const admins = new Set(ADMIN_IDS.split(',').map(s => s.trim()).filter(Boolean).slice(0, 2));
const REDIRECT = `${BASE_URL}/auth/callback`;
const SESSION_TTL = 365 * 864e5;   // la connexion reste active 1 an, renouvelee a chaque visite

const DATA = path.join(STORAGE_DIR, 'data');
const FILES = path.join(STORAGE_DIR, 'uploads', 'files');    // archives : jamais servies en statique
const IMGS = path.join(STORAGE_DIR, 'uploads', 'images');
[DATA, FILES, IMGS].forEach(d => fs.mkdirSync(d, { recursive: true }));

const app = express();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));

const isAdmin = req => !!req.session.user && admins.has(req.session.user.id);
const requireUser = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'login' });
const requireAdmin = (req, res, next) => isAdmin(req) ? next() : res.status(403).json({ error: 'forbidden' });

createStore(DATA).then(store => {
  console.log('Stockage des donnees :', store.kind);
  const slug = store.slug;

  // ---------- Sessions persistantes (survivent aux redemarrages) ----------
  class DbSessionStore extends session.Store {
    exp(sess) { return sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + SESSION_TTL; }
    get(sid, cb) { store.sessGet(sid).then(d => cb(null, d), cb); }
    set(sid, sess, cb) { store.sessSet(sid, sess, this.exp(sess)).then(() => cb && cb(), e => cb && cb(e)); }
    touch(sid, sess, cb) { store.sessTouch(sid, this.exp(sess)).then(() => cb && cb(), e => cb && cb(e)); }
    destroy(sid, cb) { store.sessDel(sid).then(() => cb && cb(), e => cb && cb(e)); }
  }
  app.use(session({
    name: 'legend.sid', store: new DbSessionStore(), secret: SESSION_SECRET,
    resave: false, saveUninitialized: false, rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: BASE_URL.startsWith('https'), maxAge: SESSION_TTL }
  }));

  // Anti-CSRF simple : les ecritures doivent venir de notre propre site
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const o = req.get('origin');
    if (o && o !== new URL(BASE_URL).origin) return res.status(403).json({ error: 'origin' });
    next();
  });

  // ---------- VIP ----------
  const vipActive = v => !!v && (v.until === null || v.until > Date.now());
  const vipOf = async uid => { const v = uid ? await store.vip(uid) : null; return { active: vipActive(v), until: v ? v.until : null }; };
  setInterval(async () => {            // retire automatiquement les VIP expires
    try { for (const v of await store.vips()) if (v.until !== null && v.until <= Date.now()) await store.delVip(v.userId); } catch (e) { console.error(e); }
  }, 10 * 60 * 1000).unref();

  // ---------- Discord OAuth2 ----------
  app.get('/auth/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.state = state;
    const q = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: 'identify', state, prompt: 'none' });
    res.redirect('https://discord.com/oauth2/authorize?' + q);
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.state) return res.status(400).send('Etat invalide.');
    delete req.session.state;
    try {
      const tok = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT })
      }).then(r => r.json());
      if (!tok.access_token) throw new Error('token');
      const u = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tok.access_token}` } }).then(r => r.json());
      const user = {
        id: u.id, name: u.global_name || u.username,
        avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null
      };
      await store.upsertUser({ ...user, lastLogin: Date.now() });
      req.session.regenerate(err => {
        if (err) return res.status(500).send('Connexion impossible.');
        req.session.user = user;
        req.session.save(() => res.redirect(admins.has(u.id) ? '/admin' : '/'));
      });
    } catch { res.status(500).send('Connexion Discord impossible.'); }
  });
  app.post('/auth/logout', (req, res) => req.session.destroy(() => { res.clearCookie('legend.sid'); res.json({ ok: true }); }));
  app.get('/api/me', ah(async (req, res) =>
    res.json({ user: req.session.user || null, admin: isAdmin(req), vip: await vipOf(req.session.user?.id) })));

  // ---------- Categories ----------
  const catOf = (cats, r) => cats.find(c => c.id === r.category) || cats.find(c => c.id === slug(r.category)) || null;
  const pub = (r, cats) => {
    const c = catOf(cats, r);
    return {
      id: r.id, title: r.title, description: r.description, category: c ? c.id : r.category, categoryName: c ? c.name : r.category,
      vipOnly: !!(c && c.vipOnly), version: r.version, framework: r.framework, images: r.images,
      fileName: r.fileName, fileSize: r.fileSize, authorName: r.authorName,
      views: r.views, downloads: r.downloads, createdAt: r.createdAt, status: r.status
    };
  };
  const uniqueId = (base, taken) => { let id = base, i = 2; while (taken.has(id)) id = `${base}-${i++}`; return id; };

  app.get('/api/catalog', ah(async (req, res) => {
    const [groups, cats, resources] = await Promise.all([store.groups(), store.categories(), store.resources()]);
    const count = new Map();
    for (const r of resources) if (r.status === 'approved') { const c = catOf(cats, r); if (c) count.set(c.id, (count.get(c.id) || 0) + 1); }
    res.json({ groups: groups.map(g => ({ ...g, categories: cats.filter(c => c.groupId === g.id).map(c => ({ ...c, count: count.get(c.id) || 0 })) })) });
  }));

  // ---------- Ressources ----------
  app.get('/api/resources', ah(async (req, res) => {
    const [list, cats] = await Promise.all([store.resources(), store.categories()]);
    res.json(list.filter(r => r.status === 'approved').map(r => pub(r, cats)));
  }));

  app.get('/api/resources/:id', ah(async (req, res) => {
    const r = await store.resource(req.params.id);
    if (!r || (r.status !== 'approved' && !isAdmin(req) && r.authorId !== req.session.user?.id)) return res.status(404).json({ error: 'not found' });
    if (r.status === 'approved') { await store.bump(r.id, 'views'); r.views++; }
    res.json(pub(r, await store.categories()));
  }));

  const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
  const ARC_EXT = ['.zip', '.rar', '.7z'];
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, f, cb) => cb(null, f.fieldname === 'file' ? FILES : IMGS),
      filename: (req, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(f.originalname).toLowerCase())
    }),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 6 },
    fileFilter: (req, f, cb) => {
      const ext = path.extname(f.originalname).toLowerCase();
      const ok = f.fieldname === 'file' ? ARC_EXT.includes(ext) : f.fieldname === 'images' && IMG_EXT.includes(ext) && f.mimetype.startsWith('image/');
      cb(ok ? null : new Error('type de fichier refuse'), ok);
    }
  }).fields([{ name: 'file', maxCount: 1 }, { name: 'images', maxCount: 5 }]);

  const hits = new Map(); // limite : 10 publications / heure / utilisateur
  app.post('/api/resources', requireUser, (req, res) => {
    const now = Date.now(), uid = req.session.user.id;
    const recent = (hits.get(uid) || []).filter(t => now - t < 36e5);
    if (recent.length >= 10 && !isAdmin(req)) return res.status(429).json({ error: 'Trop de publications, reessaie plus tard.' });
    upload(req, res, async err => {
      const cleanup = () => Object.values(req.files || {}).flat().forEach(f => fs.unlink(f.path, () => {}));
      if (err) { cleanup(); return res.status(400).json({ error: err.message }); }
      try {
        const b = req.body, file = req.files?.file?.[0], cat = (await store.categories()).find(c => c.id === b.category);
        if (!file || !b.title || b.title.length > 180 || !cat || b.rights !== 'true') {
          cleanup(); return res.status(400).json({ error: 'Champs invalides (titre, categorie, archive, confirmation des droits).' });
        }
        if (cat.vipOnly && !isAdmin(req)) { cleanup(); return res.status(403).json({ error: 'Seuls les admins publient dans une categorie VIP.' }); }
        const item = {
          id: crypto.randomUUID(), title: b.title.trim(), description: String(b.description || '').slice(0, 5000),
          category: cat.id, version: String(b.version || '').slice(0, 20), framework: String(b.framework || '').slice(0, 30),
          images: (req.files.images || []).map(f => f.filename), file: file.filename,
          fileName: path.basename(file.originalname).slice(0, 120), fileSize: file.size,
          authorId: uid, authorName: req.session.user.name, authorAvatar: req.session.user.avatar || '',
          status: isAdmin(req) ? 'approved' : 'pending', views: 0, downloads: 0, createdAt: now
        };
        await store.addResource(item);
        hits.set(uid, [...recent, now]);
        res.json({ id: item.id, status: item.status });
      } catch (e) { console.error(e); cleanup(); res.status(500).json({ error: 'Erreur serveur.' }); }
    });
  });

  app.get('/api/resources/:id/download', requireUser, ah(async (req, res) => {
    const r = await store.resource(req.params.id);
    if (!r || (r.status !== 'approved' && !isAdmin(req))) return res.status(404).send('Introuvable');
    const c = catOf(await store.categories(), r);
    if (c?.vipOnly && !isAdmin(req) && !(await vipOf(req.session.user.id)).active) return res.status(403).send('Reserve aux membres VIP.');
    await store.bump(r.id, 'downloads');
    await store.logDownload({ rid: r.id, aid: r.authorId, at: Date.now() });
    res.download(path.join(FILES, r.file), r.fileName);
  }));

  app.post('/api/resources/:id/report', requireUser, ah(async (req, res) => {
    const reason = String(req.body?.reason || '').slice(0, 500);
    if (!reason) return res.status(400).json({ error: 'raison requise' });
    await store.addReport({ id: crypto.randomUUID(), resourceId: req.params.id, reason, by: req.session.user.name, at: Date.now() });
    res.json({ ok: true });
  }));

  // ---------- Classement des createurs ----------
  const DAY = 864e5;
  async function ranking(from, to) {
    const res = (await store.resources()).filter(r => r.status === 'approved');
    const by = new Map();
    for (const r of res) {
      const a = by.get(r.authorId) || { id: r.authorId, name: r.authorName, avatar: r.authorAvatar || '', downloads: 0, resources: 0 };
      a.resources++; a.avatar = a.avatar || r.authorAvatar || ''; by.set(r.authorId, a);
    }
    const all = from === 0 && to === Infinity;
    for (const [aid, c] of await store.downloadCounts(from, to)) { const a = by.get(aid); if (a) a.downloads = c; }
    return [...by.values()].filter(a => all || a.downloads > 0)
      .sort((x, y) => y.downloads - x.downloads || y.resources - x.resources).map(a => ({ ...a, admin: admins.has(a.id) }));
  }
  app.get('/api/ranking', ah(async (req, res) => {
    const now = Date.now();
    const p = { week: [now - 7 * DAY, Infinity], month: [now - 30 * DAY, Infinity], all: [0, Infinity] }[req.query.period] || [now - 7 * DAY, Infinity];
    res.json({ list: (await ranking(...p)).slice(0, 50), lastWeekWinner: (await ranking(now - 14 * DAY, now - 7 * DAY))[0] || null });
  }));

  app.use('/img', express.static(IMGS, { maxAge: '7d', index: false, dotfiles: 'deny' }));

  // ---------- Admin : moderation ----------
  app.get('/api/admin/resources', requireAdmin, ah(async (req, res) => {
    const [l, cats] = await Promise.all([store.resources(), store.categories()]);
    res.json(l.map(r => pub(r, cats)));
  }));
  app.get('/api/admin/reports', requireAdmin, ah(async (req, res) => res.json(await store.reports())));
  app.post('/api/admin/resources/:id/status', requireAdmin, ah(async (req, res) => {
    const s = req.body?.status;
    if (!['approved', 'rejected', 'pending'].includes(s)) return res.status(400).json({ error: 'status' });
    if (!(await store.setStatus(req.params.id, s))) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  }));
  app.delete('/api/admin/resources/:id', requireAdmin, ah(async (req, res) => {
    const r = await store.removeResource(req.params.id);
    if (r) { fs.unlink(path.join(FILES, r.file), () => {}); r.images.forEach(i => fs.unlink(path.join(IMGS, i), () => {})); }
    res.json({ ok: true });
  }));
  app.delete('/api/admin/reports/:id', requireAdmin, ah(async (req, res) => { await store.removeReport(req.params.id); res.json({ ok: true }); }));

  // ---------- Admin : sur-categories et categories ----------
  const cleanName = s => String(s || '').trim().slice(0, 40);
  const swap = async (list, id, dir, update) => {
    const i = list.findIndex(x => x.id === id), j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return;
    const pos = list.map((x, k) => ({ id: x.id, position: k + 1 }));
    [pos[i].position, pos[j].position] = [pos[j].position, pos[i].position];
    for (const p of pos) await update(p.id, { position: p.position });
  };

  app.post('/api/admin/groups', requireAdmin, ah(async (req, res) => {
    const name = cleanName(req.body?.name); if (!name) return res.status(400).json({ error: 'nom requis' });
    const gs = await store.groups();
    const g = { id: uniqueId(slug(name), new Set(gs.map(x => x.id))), name, position: gs.length ? Math.max(...gs.map(x => x.position)) + 1 : 1 };
    await store.addGroup(g); res.json(g);
  }));
  app.put('/api/admin/groups/:id', requireAdmin, ah(async (req, res) => {
    const name = cleanName(req.body?.name); if (!name) return res.status(400).json({ error: 'nom requis' });
    if (!(await store.updateGroup(req.params.id, { name }))) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  }));
  app.post('/api/admin/groups/:id/move', requireAdmin, ah(async (req, res) => {
    await swap(await store.groups(), req.params.id, +req.body?.dir, (id, p) => store.updateGroup(id, p)); res.json({ ok: true });
  }));
  app.delete('/api/admin/groups/:id', requireAdmin, ah(async (req, res) => {
    if ((await store.categories()).some(c => c.groupId === req.params.id)) return res.status(409).json({ error: 'Deplace ou supprime d\'abord les categories de ce groupe.' });
    await store.removeGroup(req.params.id); res.json({ ok: true });
  }));

  app.post('/api/admin/categories', requireAdmin, ah(async (req, res) => {
    const name = cleanName(req.body?.name), gs = await store.groups(), cats = await store.categories();
    if (!name || !gs.some(g => g.id === req.body?.groupId)) return res.status(400).json({ error: 'nom ou groupe invalide' });
    const sib = cats.filter(c => c.groupId === req.body.groupId);
    const c = { id: uniqueId(slug(name), new Set(cats.map(x => x.id))), name, groupId: req.body.groupId, vipOnly: !!req.body.vipOnly, position: sib.length ? Math.max(...sib.map(x => x.position)) + 1 : 1 };
    await store.addCategory(c); res.json(c);
  }));
  app.put('/api/admin/categories/:id', requireAdmin, ah(async (req, res) => {
    const p = {}, b = req.body || {};
    if (b.name !== undefined) { p.name = cleanName(b.name); if (!p.name) return res.status(400).json({ error: 'nom requis' }); }
    if (b.vipOnly !== undefined) p.vipOnly = !!b.vipOnly;
    if (b.groupId !== undefined) { if (!(await store.groups()).some(g => g.id === b.groupId)) return res.status(400).json({ error: 'groupe invalide' }); p.groupId = b.groupId; }
    if (!(await store.updateCategory(req.params.id, p))) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  }));
  app.post('/api/admin/categories/:id/move', requireAdmin, ah(async (req, res) => {
    const cats = await store.categories(), c = cats.find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    await swap(cats.filter(x => x.groupId === c.groupId), c.id, +req.body?.dir, (id, p) => store.updateCategory(id, p)); res.json({ ok: true });
  }));
  app.delete('/api/admin/categories/:id', requireAdmin, ah(async (req, res) => {
    const cats = await store.categories();
    if ((await store.resources()).some(r => catOf(cats, r)?.id === req.params.id)) return res.status(409).json({ error: 'Cette categorie contient des ressources : deplace-les d\'abord.' });
    await store.removeCategory(req.params.id); res.json({ ok: true });
  }));

  // ---------- Admin : VIP ----------
  app.get('/api/admin/users', requireAdmin, ah(async (req, res) => {
    const q = String(req.query.q || '').toLowerCase().trim();
    const l = (await store.users()).filter(u => !q || u.id.includes(q) || String(u.name).toLowerCase().includes(q))
      .sort((a, b) => b.lastLogin - a.lastLogin).slice(0, 20);
    res.json(l.map(u => ({ id: u.id, name: u.name, avatar: u.avatar })));
  }));
  app.get('/api/admin/vip', requireAdmin, ah(async (req, res) => {
    const users = new Map((await store.users()).map(u => [u.id, u]));
    res.json((await store.vips()).map(v => ({ ...v, name: users.get(v.userId)?.name || null, avatar: users.get(v.userId)?.avatar || '', active: vipActive(v) }))
      .sort((a, b) => (a.until === null ? Infinity : a.until) - (b.until === null ? Infinity : b.until)));
  }));
  app.post('/api/admin/vip', requireAdmin, ah(async (req, res) => {
    const uid = String(req.body?.userId || '').trim(), days = req.body?.days;
    if (!/^\d{15,25}$/.test(uid)) return res.status(400).json({ error: 'ID Discord invalide (15 a 25 chiffres).' });
    if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 3650)) return res.status(400).json({ error: 'duree invalide' });
    const cur = await store.vip(uid), now = Date.now();
    let until;
    if (days === null || (cur && cur.until === null && vipActive(cur))) until = null;                       // a vie
    else until = Math.max(now, cur && vipActive(cur) ? cur.until : 0) + days * DAY;                          // prolonge si deja VIP
    await store.setVip({ userId: uid, until, grantedBy: req.session.user.name, grantedAt: now });
    res.json({ ok: true, until });
  }));
  app.delete('/api/admin/vip/:uid', requireAdmin, ah(async (req, res) => { await store.delVip(req.params.uid); res.json({ ok: true }); }));

  app.get('/admin', (req, res) => isAdmin(req) ? res.sendFile(path.join(__dirname, 'public', 'admin.html')) : res.redirect('/'));
  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
  app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Erreur serveur.' }); });

  app.listen(PORT, () => console.log(`Site sur ${BASE_URL} (${admins.size} admin(s))`));
}).catch(e => { console.error('Impossible d\'initialiser le stockage :', e.message); process.exit(1); });
