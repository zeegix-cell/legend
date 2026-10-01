// Stockage : MySQL si configure (DB_* / MYSQL_* / DATABASE_URL), sinon fichiers JSON.
const fs = require('fs');
const path = require('path');

const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'cat';

/* ------------------------------------------------------------------ JSON */
function jsonStore(dir) {
  const f = n => path.join(dir, n + '.json');
  const rd = (n, d = []) => { try { return JSON.parse(fs.readFileSync(f(n), 'utf8')); } catch { return d; } };
  const wr = (n, d) => fs.writeFileSync(f(n), JSON.stringify(d, null, 2));
  const by = k => (a, b) => (a[k] ?? 0) - (b[k] ?? 0);

  let sess = rd('sessions', {}), timer = null;            // sessions : en memoire, ecriture differee
  const flush = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const now = Date.now();
      for (const k of Object.keys(sess)) if (sess[k].exp < now) delete sess[k];
      wr('sessions', sess);
    }, 3000);
  };

  return {
    kind: 'json',
    async init() {},
    // ressources
    async resources() { return rd('resources'); },
    async resource(id) { return rd('resources').find(r => r.id === id) || null; },
    async addResource(it) { const l = rd('resources'); l.unshift(it); wr('resources', l); },
    async setStatus(id, s) { const l = rd('resources'), r = l.find(x => x.id === id); if (!r) return false; r.status = s; wr('resources', l); return true; },
    async removeResource(id) { const l = rd('resources'), r = l.find(x => x.id === id); if (r) wr('resources', l.filter(x => x.id !== id)); return r || null; },
    async bump(id, k) { const l = rd('resources'), r = l.find(x => x.id === id); if (r) { r[k]++; wr('resources', l); } },
    // signalements / telechargements
    async addReport(r) { const l = rd('reports'); l.unshift(r); wr('reports', l); },
    async reports() { return rd('reports'); },
    async removeReport(id) { wr('reports', rd('reports').filter(x => x.id !== id)); },
    async logDownload(d) { const l = rd('downloads'); l.push(d); wr('downloads', l); },
    async downloadCounts(from, to) {
      const ok = new Set(rd('resources').filter(r => r.status === 'approved').map(r => r.id)), m = new Map();
      for (const d of rd('downloads')) { if (d.at < from || d.at >= to || !ok.has(d.rid)) continue; m.set(d.aid, (m.get(d.aid) || 0) + 1); }
      return m;
    },
    // sur-categories + categories
    async groups() { return rd('groups').sort(by('position')); },
    async addGroup(g) { const l = rd('groups'); l.push(g); wr('groups', l); },
    async updateGroup(id, p) { const l = rd('groups'), g = l.find(x => x.id === id); if (!g) return false; Object.assign(g, p); wr('groups', l); return true; },
    async removeGroup(id) { wr('groups', rd('groups').filter(x => x.id !== id)); },
    async categories() { return rd('categories').sort(by('position')); },
    async addCategory(c) { const l = rd('categories'); l.push(c); wr('categories', l); },
    async updateCategory(id, p) { const l = rd('categories'), c = l.find(x => x.id === id); if (!c) return false; Object.assign(c, p); wr('categories', l); return true; },
    async removeCategory(id) { wr('categories', rd('categories').filter(x => x.id !== id)); },
    // VIP + utilisateurs
    async vips() { return rd('vips'); },
    async vip(uid) { return rd('vips').find(v => v.userId === uid) || null; },
    async setVip(v) { const l = rd('vips'), i = l.findIndex(x => x.userId === v.userId); if (i >= 0) l[i] = v; else l.push(v); wr('vips', l); },
    async delVip(uid) { wr('vips', rd('vips').filter(v => v.userId !== uid)); },
    async upsertUser(u) { const l = rd('users'), i = l.findIndex(x => x.id === u.id); if (i >= 0) l[i] = { ...l[i], ...u }; else l.push(u); wr('users', l); },
    async users() { return rd('users'); },
    // sessions (connexion persistante)
    async sessGet(sid) { const s = sess[sid]; return s && s.exp > Date.now() ? s.data : null; },
    async sessSet(sid, data, exp) { sess[sid] = { data, exp }; flush(); },
    async sessTouch(sid, exp) { if (sess[sid]) { sess[sid].exp = exp; flush(); } },
    async sessDel(sid) { delete sess[sid]; flush(); },
    // reglages cles/valeurs (ex : salons et roles Discord crees par le bot)
    async setting(k) { return rd('settings', {})[k] ?? null; },
    async setSetting(k, v) { const s = rd('settings', {}); s[k] = v; wr('settings', s); }
  };
}

/* ----------------------------------------------------------------- MySQL */
function mysqlStore(cfg) {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({ ...cfg, waitForConnections: true, connectionLimit: 10, charset: 'utf8mb4' });
  const toR = r => ({ ...r, images: JSON.parse(r.images || '[]'), fileSize: Number(r.fileSize), createdAt: Number(r.createdAt) });
  const COLS = ['id', 'title', 'description', 'category', 'version', 'framework', 'images', 'file', 'fileName', 'fileSize',
    'authorId', 'authorName', 'authorAvatar', 'status', 'views', 'downloads', 'createdAt'];
  const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
  const toC = c => ({ ...c, vipOnly: !!c.vipOnly });
  const num = v => (v === null || v === undefined ? null : Number(v));
  return {
    kind: 'mysql',
    async init() {
      const q = s => pool.query(s);
      await q(`CREATE TABLE IF NOT EXISTS resources (
        id VARCHAR(36) PRIMARY KEY, title VARCHAR(180) NOT NULL, description TEXT, category VARCHAR(60) NOT NULL,
        version VARCHAR(20), framework VARCHAR(30), images TEXT, \`file\` VARCHAR(80) NOT NULL, fileName VARCHAR(160),
        fileSize BIGINT, authorId VARCHAR(32) NOT NULL, authorName VARCHAR(100), authorAvatar VARCHAR(255),
        status VARCHAR(12) NOT NULL DEFAULT 'pending', views INT NOT NULL DEFAULT 0, downloads INT NOT NULL DEFAULT 0,
        createdAt BIGINT NOT NULL, INDEX (status, createdAt), INDEX (authorId)) ${T}`);
      await q(`ALTER TABLE resources MODIFY category VARCHAR(60) NOT NULL`).catch(() => {});
      await q(`CREATE TABLE IF NOT EXISTS reports (id VARCHAR(36) PRIMARY KEY, resourceId VARCHAR(36), reason VARCHAR(500), byName VARCHAR(100), at BIGINT) ${T}`);
      await q(`CREATE TABLE IF NOT EXISTS downloads (id BIGINT AUTO_INCREMENT PRIMARY KEY, rid VARCHAR(36), aid VARCHAR(32), at BIGINT, INDEX (at), INDEX (aid)) ${T}`);
      await q(`CREATE TABLE IF NOT EXISTS cat_groups (id VARCHAR(60) PRIMARY KEY, name VARCHAR(60) NOT NULL, position INT NOT NULL DEFAULT 0) ${T}`);
      await q(`CREATE TABLE IF NOT EXISTS categories (id VARCHAR(60) PRIMARY KEY, name VARCHAR(60) NOT NULL, groupId VARCHAR(60) NOT NULL, vipOnly TINYINT(1) NOT NULL DEFAULT 0, position INT NOT NULL DEFAULT 0) ${T}`);
      await q(`CREATE TABLE IF NOT EXISTS vips (userId VARCHAR(32) PRIMARY KEY, until BIGINT NULL, grantedBy VARCHAR(100), grantedAt BIGINT) ${T}`);
      await q(`CREATE TABLE IF NOT EXISTS users (id VARCHAR(32) PRIMARY KEY, name VARCHAR(100), avatar VARCHAR(255), lastLogin BIGINT) ${T}`);
      await q(`CREATE TABLE IF NOT EXISTS sessions (sid VARCHAR(128) PRIMARY KEY, data MEDIUMTEXT, exp BIGINT, INDEX (exp)) ${T}`);
      await q(`CREATE TABLE IF NOT EXISTS settings (k VARCHAR(60) PRIMARY KEY, v MEDIUMTEXT) ${T}`);
    },
    async resources() { const [rows] = await pool.query('SELECT * FROM resources ORDER BY createdAt DESC'); return rows.map(toR); },
    async resource(id) { const [rows] = await pool.query('SELECT * FROM resources WHERE id=?', [id]); return rows[0] ? toR(rows[0]) : null; },
    async addResource(it) {
      await pool.query(`INSERT INTO resources (${COLS.map(c => '`' + c + '`').join(',')}) VALUES (${COLS.map(() => '?').join(',')})`,
        COLS.map(c => (c === 'images' ? JSON.stringify(it.images || []) : it[c])));
    },
    async setStatus(id, s) { const [r] = await pool.query('UPDATE resources SET status=? WHERE id=?', [s, id]); return r.affectedRows > 0; },
    async removeResource(id) { const r = await this.resource(id); if (r) await pool.query('DELETE FROM resources WHERE id=?', [id]); return r; },
    async bump(id, k) { if (['views', 'downloads'].includes(k)) await pool.query(`UPDATE resources SET ${k}=${k}+1 WHERE id=?`, [id]); },
    async addReport(r) { await pool.query('INSERT INTO reports (id,resourceId,reason,byName,at) VALUES (?,?,?,?,?)', [r.id, r.resourceId, r.reason, r.by, r.at]); },
    async reports() { const [rows] = await pool.query('SELECT id, resourceId, reason, byName AS `by`, at FROM reports ORDER BY at DESC'); return rows.map(x => ({ ...x, at: Number(x.at) })); },
    async removeReport(id) { await pool.query('DELETE FROM reports WHERE id=?', [id]); },
    async logDownload(d) { await pool.query('INSERT INTO downloads (rid,aid,at) VALUES (?,?,?)', [d.rid, d.aid, d.at]); },
    async downloadCounts(from, to) {
      const [rows] = await pool.query(`SELECT d.aid, COUNT(*) AS c FROM downloads d JOIN resources r ON r.id=d.rid AND r.status='approved'
        WHERE d.at>=? AND d.at<? GROUP BY d.aid`, [from, Math.min(to, Number.MAX_SAFE_INTEGER)]);
      return new Map(rows.map(r => [r.aid, Number(r.c)]));
    },
    async groups() { const [r] = await pool.query('SELECT * FROM cat_groups ORDER BY position'); return r; },
    async addGroup(g) { await pool.query('INSERT INTO cat_groups (id,name,position) VALUES (?,?,?)', [g.id, g.name, g.position]); },
    async updateGroup(id, p) {
      const k = Object.keys(p); if (!k.length) return true;
      const [r] = await pool.query(`UPDATE cat_groups SET ${k.map(x => '`' + x + '`=?').join(',')} WHERE id=?`, [...k.map(x => p[x]), id]); return r.affectedRows > 0;
    },
    async removeGroup(id) { await pool.query('DELETE FROM cat_groups WHERE id=?', [id]); },
    async categories() { const [r] = await pool.query('SELECT * FROM categories ORDER BY position'); return r.map(toC); },
    async addCategory(c) { await pool.query('INSERT INTO categories (id,name,groupId,vipOnly,position) VALUES (?,?,?,?,?)', [c.id, c.name, c.groupId, c.vipOnly ? 1 : 0, c.position]); },
    async updateCategory(id, p) {
      const k = Object.keys(p); if (!k.length) return true;
      const [r] = await pool.query(`UPDATE categories SET ${k.map(x => '`' + x + '`=?').join(',')} WHERE id=?`, [...k.map(x => (x === 'vipOnly' ? (p[x] ? 1 : 0) : p[x])), id]); return r.affectedRows > 0;
    },
    async removeCategory(id) { await pool.query('DELETE FROM categories WHERE id=?', [id]); },
    async vips() { const [r] = await pool.query('SELECT * FROM vips'); return r.map(v => ({ ...v, until: num(v.until), grantedAt: num(v.grantedAt) })); },
    async vip(uid) { const [r] = await pool.query('SELECT * FROM vips WHERE userId=?', [uid]); return r[0] ? { ...r[0], until: num(r[0].until), grantedAt: num(r[0].grantedAt) } : null; },
    async setVip(v) {
      await pool.query('INSERT INTO vips (userId,until,grantedBy,grantedAt) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE until=VALUES(until), grantedBy=VALUES(grantedBy), grantedAt=VALUES(grantedAt)',
        [v.userId, v.until, v.grantedBy, v.grantedAt]);
    },
    async delVip(uid) { await pool.query('DELETE FROM vips WHERE userId=?', [uid]); },
    async upsertUser(u) {
      await pool.query('INSERT INTO users (id,name,avatar,lastLogin) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), avatar=VALUES(avatar), lastLogin=VALUES(lastLogin)', [u.id, u.name, u.avatar || '', u.lastLogin]);
    },
    async users() { const [r] = await pool.query('SELECT * FROM users'); return r.map(u => ({ ...u, lastLogin: num(u.lastLogin) })); },
    async sessGet(sid) { const [r] = await pool.query('SELECT data FROM sessions WHERE sid=? AND exp>?', [sid, Date.now()]); return r[0] ? JSON.parse(r[0].data) : null; },
    async sessSet(sid, data, exp) { await pool.query('INSERT INTO sessions (sid,data,exp) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data), exp=VALUES(exp)', [sid, JSON.stringify(data), exp]); },
    async sessTouch(sid, exp) { await pool.query('UPDATE sessions SET exp=? WHERE sid=?', [exp, sid]); },
    async sessDel(sid) { await pool.query('DELETE FROM sessions WHERE sid=?', [sid]); },
    async setting(k) { const [r] = await pool.query('SELECT v FROM settings WHERE k=?', [k]); return r[0] ? JSON.parse(r[0].v) : null; },
    async setSetting(k, v) { await pool.query('INSERT INTO settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [k, JSON.stringify(v)]); }
  };
}

function dbConfig(env) {
  const url = env.DATABASE_URL || env.MYSQL_URL;
  if (url) return { uri: url };
  const host = env.DB_HOST || env.MYSQL_HOST;
  if (!host) return null;
  return {
    host, port: +(env.DB_PORT || env.MYSQL_PORT || 3306),
    user: env.DB_USER || env.MYSQL_USER, password: env.DB_PASSWORD || env.MYSQL_PASSWORD,
    database: env.DB_NAME || env.MYSQL_DATABASE || env.MYSQL_DB
  };
}

/* Categories par defaut, creees au premier demarrage uniquement. */
async function seed(store) {
  if ((await store.groups()).length) return;
  await store.addGroup({ id: 'ressources', name: 'Nos ressources', position: 1 });
  await store.addGroup({ id: 'exclusif', name: 'Exclusif', position: 2 });
  const base = ['Armes', 'Autres', 'Bases', 'Bundles', 'Loading Screen', 'Mappings', 'Pack Graphique', 'Scripts', 'Template Discord', 'UI', 'Vehicles', 'Vetements'];
  let p = 1;
  for (const n of base) await store.addCategory({ id: slug(n), name: n, groupId: 'ressources', vipOnly: false, position: p++ });
  await store.addCategory({ id: 'vip', name: 'VIP', groupId: 'exclusif', vipOnly: true, position: 1 });
}

module.exports = async function createStore(dataDir, env = process.env) {
  const cfg = dbConfig(env);
  const store = cfg ? mysqlStore(cfg) : jsonStore(dataDir);
  await store.init();
  await seed(store);
  store.slug = slug;
  return store;
};
