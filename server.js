require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const createStore = require('./store');
const startBot = require('./bot');
const badgeLib = require('./badges');
const pay = require('./payments');

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
  let bot = null;                                                  // demarre en fin de fichier
  const B = (fn, ...a) => { try { if (bot) bot[fn](...a); } catch (e) { console.error('[bot]', e.message); } };
  const grantVip = async (uid, days, by) => {                      // utilise par le panel admin ET par la commande Discord /vip
    const cur = await store.vip(uid), now = Date.now();
    let until;
    if (days === null || (cur && cur.until === null && vipActive(cur))) until = null;                       // a vie
    else until = Math.max(now, cur && vipActive(cur) ? cur.until : 0) + days * 864e5;                       // prolonge si deja VIP
    await store.setVip({ userId: uid, until, grantedBy: by, grantedAt: now });
    B('vipChanged', uid, 'grant', until, by); return until;
  };
  const revokeVip = async (uid, by) => { await store.delVip(uid); B('vipChanged', uid, 'remove', null, by); };
  setInterval(async () => {            // retire automatiquement les VIP expires (et leur role Discord)
    try { for (const v of await store.vips()) if (v.until !== null && v.until <= Date.now()) { await store.delVip(v.userId); B('vipChanged', v.userId, 'expired', null, null); } } catch (e) { console.error(e); }
  }, 10 * 60 * 1000).unref();

  // ---------- Badges : automatiques (activite) + speciaux (donnes a la main) ----------
  const statsOf = async uid => {
    const mine = (await store.resources()).filter(r => r.authorId === uid && r.status === 'approved'), u = await store.user(uid);
    const first = (u && (u.firstSeen || u.lastLogin)) || (mine.length ? Math.min(...mine.map(r => r.createdAt)) : Date.now());
    return { resources: mine.length, downloads: mine.reduce((a, r) => a + (r.downloads || 0), 0), days: Math.floor((Date.now() - first) / 864e5), since: first };
  };
  const badgeDefs = async () => badgeLib.catalogue(await store.badges());
  const pubBadge = (b, at) => ({ id: b.id, name: b.name, emoji: b.emoji, description: b.description, color: b.color, auto: !!b.auto, at: at || null });
  const awardBadge = async (uid, badgeId, by, auto) => {      // true si le badge vient d'etre obtenu (=> annonce Discord)
    const def = (await badgeDefs()).find(b => b.id === badgeId); if (!def) return false;
    const fresh = await store.grantBadge({ userId: uid, badgeId, at: Date.now(), grantedBy: by || null, auto: !!auto });
    if (fresh) B('badgeAwarded', uid, pubBadge(def, Date.now()));
    return fresh;
  };
  const evaluateUser = async (uid, silent) => {                // attribue les badges automatiques merites
    if (!uid) return [];
    const s = await statsOf(uid), have = new Set((await store.userBadges(uid)).map(b => b.badgeId)), won = [];
    for (const b of badgeLib.AUTO) if (b.test && !have.has(b.id) && b.test(s)) {
      const fresh = await store.grantBadge({ userId: uid, badgeId: b.id, at: Date.now(), grantedBy: null, auto: true });
      if (fresh) { won.push(b.id); if (!silent) B('badgeAwarded', uid, pubBadge(b, Date.now())); }
    }
    return won;
  };
  const evalSoon = uid => evaluateUser(uid).catch(e => console.error('[badges]', e.message));
  const iconsFor = async uids => {                              // emojis des badges (4 max par membre) pour le classement
    const [manual, all] = await Promise.all([store.badges(), store.allUserBadges()]), defs = new Map(badgeLib.catalogue(manual).map(b => [b.id, b])), by = new Map();
    for (const x of all) { if (!by.has(x.userId)) by.set(x.userId, []); by.get(x.userId).push(x.badgeId); }
    return new Map(uids.map(u => [u, badgeLib.sortForDisplay(by.get(u) || [], manual).slice(0, 4).map(id => defs.get(id) && defs.get(id).emoji).filter(Boolean)]));
  };

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
      evalSoon(user.id);
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
      fileName: r.fileName, fileSize: r.fileSize, authorName: r.authorName, authorId: r.authorId,
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
        B('resourceAdded', item);
        if (item.status === 'approved') evalSoon(uid);
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
    evalSoon(r.authorId);
    res.download(path.join(FILES, r.file), r.fileName);
  }));

  app.post('/api/resources/:id/report', requireUser, ah(async (req, res) => {
    const reason = String(req.body?.reason || '').slice(0, 500);
    if (!reason) return res.status(400).json({ error: 'raison requise' });
    await store.addReport({ id: crypto.randomUUID(), resourceId: req.params.id, reason, by: req.session.user.name, at: Date.now() });
    B('reportAdded', { reason, by: req.session.user.name }, await store.resource(req.params.id));
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
    const list = [...by.values()].filter(a => all || a.downloads > 0).sort((x, y) => y.downloads - x.downloads || y.resources - x.resources);
    const icons = await iconsFor(list.slice(0, 50).map(a => a.id));
    return list.map(a => ({ ...a, admin: admins.has(a.id), badges: icons.get(a.id) || [] }));
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
    const before = await store.resource(req.params.id);
    if (!(await store.setStatus(req.params.id, s))) return res.status(404).json({ error: 'not found' });
    if (s === 'approved' && before && before.status !== 'approved') { B('resourceApproved', { ...before, status: 'approved' }); evalSoon(before.authorId); }
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
    const until = await grantVip(uid, days, req.session.user.name);
    res.json({ ok: true, until });
  }));
  app.delete('/api/admin/vip/:uid', requireAdmin, ah(async (req, res) => { await revokeVip(req.params.uid, req.session.user.name); res.json({ ok: true }); }));

  // ---------- Badges : catalogue, profils, administration ----------
  const catalogueWithHolders = async () => {
    const [defs, all] = await Promise.all([badgeDefs(), store.allUserBadges()]), n = new Map();
    for (const x of all) n.set(x.badgeId, (n.get(x.badgeId) || 0) + 1);
    return defs.map(b => ({ ...pubBadge(b), holders: n.get(b.id) || 0 }));
  };
  const memberBadges = async uid => {
    const [manual, mine] = await Promise.all([store.badges(), store.userBadges(uid)]), defs = new Map(badgeLib.catalogue(manual).map(b => [b.id, b])), at = new Map(mine.map(x => [x.badgeId, x.at]));
    return badgeLib.sortForDisplay(mine.map(x => x.badgeId), manual).map(id => defs.get(id) && pubBadge(defs.get(id), at.get(id))).filter(Boolean);
  };
  app.get('/api/badges', ah(async (req, res) => res.json({ badges: await catalogueWithHolders(), mine: req.session.user ? (await store.userBadges(req.session.user.id)).map(b => b.badgeId) : [] })));

  app.get('/api/members/:id', ah(async (req, res) => {
    const uid = req.params.id; if (!/^[\w-]{1,40}$/.test(uid)) return res.status(404).json({ error: 'not found' });
    const [user, all, cats] = await Promise.all([store.user(uid), store.resources(), store.categories()]), mine = all.filter(r => r.authorId === uid && r.status === 'approved');
    if (!user && !mine.length) return res.status(404).json({ error: 'not found' });
    const stats = await statsOf(uid);
    res.json({
      id: uid, name: (user && user.name) || mine[0].authorName, avatar: (user && user.avatar) || (mine[0] && mine[0].authorAvatar) || '', since: stats.since,
      admin: admins.has(uid), vip: (await vipOf(uid)).active, stats: { resources: stats.resources, downloads: stats.downloads },
      badges: await memberBadges(uid), resources: mine.map(r => pub(r, cats))
    });
  }));

  const cleanBadge = b => {
    const name = String(b.name || '').trim().slice(0, 30), emoji = String(b.emoji || '').trim(), description = String(b.description || '').trim().slice(0, 120);
    if (!name || !emoji || Array.from(emoji).length > 4 || emoji.length > 12) return null;
    return { name, emoji, description, color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#a1a1aa' };
  };
  app.get('/api/admin/badges', requireAdmin, ah(async (req, res) => {
    const [manual, all, users] = await Promise.all([store.badges(), store.allUserBadges(), store.users()]), names = new Map(users.map(u => [u.id, u.name]));
    const holders = id => all.filter(x => x.badgeId === id).map(x => ({ userId: x.userId, name: names.get(x.userId) || null, at: x.at }));
    res.json({ manual: manual.map(b => ({ ...pubBadge({ ...b, auto: false }), holders: holders(b.id) })), auto: badgeLib.AUTO.map(b => ({ ...pubBadge(b), holders: holders(b.id).length })) });
  }));
  app.post('/api/admin/badges', requireAdmin, ah(async (req, res) => {
    const c = cleanBadge(req.body || {}); if (!c) return res.status(400).json({ error: 'nom et emoji requis (1 seul emoji)' });
    const taken = new Set((await badgeDefs()).map(b => b.id)), manual = await store.badges();
    const b = { id: uniqueId(slug(c.name), taken), ...c, position: manual.length ? Math.max(...manual.map(x => x.position)) + 1 : 1 };
    await store.addBadge(b); B('badgesChanged'); res.json(b);
  }));
  app.put('/api/admin/badges/:id', requireAdmin, ah(async (req, res) => {
    const c = cleanBadge(req.body || {}); if (!c) return res.status(400).json({ error: 'nom et emoji requis (1 seul emoji)' });
    if (!(await store.updateBadge(req.params.id, c))) return res.status(404).json({ error: 'badge speciaux uniquement' });
    B('badgesChanged'); res.json({ ok: true });
  }));
  app.delete('/api/admin/badges/:id', requireAdmin, ah(async (req, res) => { await store.removeBadge(req.params.id); B('badgesChanged'); res.json({ ok: true }); }));
  app.post('/api/admin/badges/:id/grant', requireAdmin, ah(async (req, res) => {
    const uid = String(req.body?.userId || '').trim(); if (!/^\d{15,25}$/.test(uid)) return res.status(400).json({ error: 'ID Discord invalide (15 a 25 chiffres).' });
    if (!(await badgeDefs()).some(b => b.id === req.params.id)) return res.status(404).json({ error: 'badge inconnu' });
    res.json({ ok: true, granted: await awardBadge(uid, req.params.id, req.session.user.name, false) });
  }));
  app.delete('/api/admin/badges/:id/grant/:uid', requireAdmin, ah(async (req, res) => { await store.revokeBadge(req.params.uid, req.params.id); res.json({ ok: true }); }));

  // ---------- Achat du VIP (paiement unique en crypto) ----------
  // Les formules sont desactivees par defaut : rien ne se vend tant que l'admin n'a pas regle les prix et active une formule.
  const DEFAULT_PLANS = [
    { id: '30d', label: '30 jours', days: 30, price: 5, enabled: false }, { id: '90d', label: '90 jours', days: 90, price: 12, enabled: false },
    { id: '365d', label: '1 an', days: 365, price: 40, enabled: false }, { id: 'life', label: 'À vie', days: null, price: 80, enabled: false }
  ];
  const CURRENCY = 'eur';
  const getPlans = async () => (await store.setting('vipPlans')) || DEFAULT_PLANS;
  const pubOrder = o => ({ id: o.id, label: o.label, amount: o.amount, currency: o.currency, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt });

  app.get('/api/vip/plans', ah(async (req, res) => {
    const plans = (await getPlans()).filter(p => p.enabled && p.price > 0).map(p => ({ id: p.id, label: p.label, days: p.days, price: p.price }));
    res.json({ plans, currency: CURRENCY, methods: { crypto: pay.configured() } });
  }));
  app.get('/api/vip/orders', requireUser, ah(async (req, res) => res.json((await store.orders(10, req.session.user.id)).map(pubOrder))));

  app.post('/api/vip/checkout', requireUser, ah(async (req, res) => {
    if (req.body?.method !== 'crypto') return res.status(400).json({ error: 'Moyen de paiement inconnu.' });
    if (!pay.configured()) return res.status(503).json({ error: 'Le paiement crypto n\'est pas encore activé.' });
    const plan = (await getPlans()).find(p => p.id === req.body?.planId && p.enabled && p.price > 0);
    if (!plan) return res.status(400).json({ error: 'Formule indisponible.' });
    const u = req.session.user, since = Date.now() - 36e5;
    if ((await store.orders(50, u.id)).filter(o => o.status === 'pending' && o.createdAt > since).length >= 5) return res.status(429).json({ error: 'Trop de paiements en attente, réessaie plus tard.' });
    const o = { id: crypto.randomUUID(), userId: u.id, userName: u.name, planId: plan.id, label: plan.label, days: plan.days, amount: Math.round(plan.price * 100) / 100, currency: CURRENCY, provider: 'nowpayments', providerRef: null, status: 'pending', createdAt: Date.now(), paidAt: null };
    await store.addOrder(o);
    try {
      const inv = await pay.createInvoice({ amount: o.amount, currency: o.currency, orderId: o.id, description: `VIP LEGEND · ${o.label}`, ipnUrl: `${BASE_URL}/api/pay/nowpayments/ipn`, successUrl: `${BASE_URL}/#/vip/paid`, cancelUrl: `${BASE_URL}/#/vip/cancel` });
      await store.updateOrder(o.id, { providerRef: inv.id });
      res.json({ url: inv.url });
    } catch (e) { console.error('[paiement]', e.message); await store.updateOrder(o.id, { status: 'failed' }); res.status(502).json({ error: 'Le service de paiement ne répond pas, réessaie dans un instant.' }); }
  }));

  // Notification du service de paiement : signature obligatoire. Le VIP n'est donne qu'une fois, quand le paiement est TOTALEMENT recu.
  app.post('/api/pay/nowpayments/ipn', ah(async (req, res) => {
    if (!pay.verify(req.body, req.get('x-nowpayments-sig'))) return res.status(401).json({ error: 'signature' });
    const b = req.body, o = await store.order(String(b.order_id || ''));
    if (!o) return res.status(404).json({ error: 'commande inconnue' });
    if (Math.abs(Number(b.price_amount) - o.amount) > 0.001 || String(b.price_currency || '').toLowerCase() !== o.currency) return res.status(400).json({ error: 'montant incoherent' });
    const st = String(b.payment_status);
    if (st === 'finished') {
      if (await store.claimPaid(o.id, String(b.payment_id || ''))) { await grantVip(o.userId, o.days, 'Paiement crypto'); B('orderPaid', { ...o, status: 'paid' }); }
    } else if (st === 'partially_paid' && o.status === 'pending') await store.updateOrder(o.id, { status: 'partial' });
    else if ((st === 'failed' || st === 'expired') && ['pending', 'partial'].includes(o.status)) await store.updateOrder(o.id, { status: st });
    else if (st === 'refunded' && o.status !== 'refunded') await store.updateOrder(o.id, { status: 'refunded' });
    res.json({ ok: true });
  }));

  app.get('/api/admin/pay', requireAdmin, ah(async (req, res) =>
    res.json({ crypto: { configured: pay.configured(), sandbox: pay.sandbox(), ipnUrl: `${BASE_URL}/api/pay/nowpayments/ipn` }, plans: await getPlans(), currency: CURRENCY, orders: await store.orders(100) })));
  app.put('/api/admin/vip-plans', requireAdmin, ah(async (req, res) => {
    const cur = await getPlans(), inc = Array.isArray(req.body?.plans) ? req.body.plans : [], out = [];
    for (const p of cur) {
      const n = inc.find(x => x.id === p.id) || p, price = Math.round(Number(n.price) * 100) / 100, label = String(n.label || '').trim().slice(0, 30);
      if (!label || !(price >= 0 && price <= 10000)) return res.status(400).json({ error: 'libelle ou prix invalide' });
      out.push({ id: p.id, label, days: p.days, price, enabled: !!n.enabled && price > 0 });
    }
    await store.setSetting('vipPlans', out); res.json({ ok: true, plans: out });
  }));
  app.post('/api/admin/orders/:id/mark-paid', requireAdmin, ah(async (req, res) => {   // validation manuelle (virement, incident de notification…)
    const o = await store.order(req.params.id); if (!o) return res.status(404).json({ error: 'commande inconnue' });
    if (!(await store.claimPaid(o.id, o.providerRef))) return res.status(409).json({ error: 'deja payee' });
    await grantVip(o.userId, o.days, req.session.user.name); B('orderPaid', { ...o, status: 'paid' }); res.json({ ok: true });
  }));
  app.post('/api/admin/orders/:id/status', requireAdmin, ah(async (req, res) => {
    const s = req.body?.status; if (!['refunded', 'failed', 'expired'].includes(s)) return res.status(400).json({ error: 'status' });
    if (!(await store.updateOrder(req.params.id, { status: s }))) return res.status(404).json({ error: 'commande inconnue' }); res.json({ ok: true });
  }));

  // ---------- Bot Discord (meme processus) ----------
  bot = startBot({
    store, ranking, admins, baseUrl: BASE_URL, grantVip, revokeVip,
    badgeCatalogue: catalogueWithHolders, memberBadges, evaluateUser, awardBadge, statsOf, userName: async uid => { const u = await store.user(uid); return u && u.name; },
    categories: () => store.categories(),
    readImage: name => fs.promises.readFile(path.join(IMGS, path.basename(String(name)))),   // image de couverture (basename : pas de remontee de dossier)
    describe: async r => { const c = catOf(await store.categories(), r); return { categoryId: c ? c.id : slug(String(r.category)), categoryName: c ? c.name : String(r.category), vipOnly: !!(c && c.vipOnly) }; }
  });
  app.get('/api/admin/bot', requireAdmin, ah(async (req, res) => res.json(await bot.status())));

  app.get('/admin', (req, res) => isAdmin(req) ? res.sendFile(path.join(__dirname, 'public', 'admin.html')) : res.redirect('/'));
  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
  app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Erreur serveur.' }); });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Site sur ${BASE_URL} - ecoute sur le port ${PORT} (${admins.size} admin(s))`);
    // 1er demarrage avec les badges : on attribue en silence ceux deja merites (pas d'annonce en rafale)
    (async () => {
      if (await store.setting('badgesBackfill')) return;
      const ids = new Set([...(await store.resources()).map(r => r.authorId), ...(await store.users()).map(u => u.id)]);
      for (const uid of ids) await evaluateUser(uid, true).catch(() => {});
      await store.setSetting('badgesBackfill', true);
    })().catch(e => console.error('[badges]', e.message));
  });
}).catch(e => { console.error('Impossible d\'initialiser le stockage :', e.message); process.exit(1); });
