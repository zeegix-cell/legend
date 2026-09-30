// Stockage des metadonnees : MySQL si configure (variables DB_* / MYSQL_* / DATABASE_URL), sinon fichiers JSON.
const fs = require('fs');
const path = require('path');

function jsonStore(dir) {
  const f = n => path.join(dir, n + '.json');
  const rd = n => { try { return JSON.parse(fs.readFileSync(f(n), 'utf8')); } catch { return []; } };
  const wr = (n, d) => fs.writeFileSync(f(n), JSON.stringify(d, null, 2));
  return {
    kind: 'json',
    async init() {},
    async resources() { return rd('resources'); },
    async resource(id) { return rd('resources').find(r => r.id === id) || null; },
    async addResource(it) { const l = rd('resources'); l.unshift(it); wr('resources', l); },
    async setStatus(id, s) {
      const l = rd('resources'), r = l.find(x => x.id === id);
      if (!r) return false; r.status = s; wr('resources', l); return true;
    },
    async removeResource(id) {
      const l = rd('resources'), r = l.find(x => x.id === id);
      if (r) wr('resources', l.filter(x => x.id !== id));
      return r || null;
    },
    async bump(id, k) { const l = rd('resources'), r = l.find(x => x.id === id); if (r) { r[k]++; wr('resources', l); } },
    async addReport(r) { const l = rd('reports'); l.unshift(r); wr('reports', l); },
    async reports() { return rd('reports'); },
    async removeReport(id) { wr('reports', rd('reports').filter(x => x.id !== id)); },
    async logDownload(d) { const l = rd('downloads'); l.push(d); wr('downloads', l); },
    async downloadCounts(from, to) {
      const ok = new Set(rd('resources').filter(r => r.status === 'approved').map(r => r.id)), m = new Map();
      for (const d of rd('downloads')) {
        if (d.at < from || d.at >= to || !ok.has(d.rid)) continue;
        m.set(d.aid, (m.get(d.aid) || 0) + 1);
      }
      return m;
    }
  };
}

function mysqlStore(cfg) {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({ ...cfg, waitForConnections: true, connectionLimit: 10, charset: 'utf8mb4' });
  const toR = r => ({ ...r, images: JSON.parse(r.images || '[]'), fileSize: Number(r.fileSize), createdAt: Number(r.createdAt) });
  const COLS = ['id', 'title', 'description', 'category', 'version', 'framework', 'images', 'file', 'fileName', 'fileSize',
    'authorId', 'authorName', 'authorAvatar', 'status', 'views', 'downloads', 'createdAt'];
  const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
  return {
    kind: 'mysql',
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS resources (
        id VARCHAR(36) PRIMARY KEY, title VARCHAR(180) NOT NULL, description TEXT, category VARCHAR(30) NOT NULL,
        version VARCHAR(20), framework VARCHAR(30), images TEXT, \`file\` VARCHAR(80) NOT NULL, fileName VARCHAR(160),
        fileSize BIGINT, authorId VARCHAR(32) NOT NULL, authorName VARCHAR(100), authorAvatar VARCHAR(255),
        status VARCHAR(12) NOT NULL DEFAULT 'pending', views INT NOT NULL DEFAULT 0, downloads INT NOT NULL DEFAULT 0,
        createdAt BIGINT NOT NULL, INDEX (status, createdAt), INDEX (authorId)) ${T}`);
      await pool.query(`CREATE TABLE IF NOT EXISTS reports (
        id VARCHAR(36) PRIMARY KEY, resourceId VARCHAR(36), reason VARCHAR(500), byName VARCHAR(100), at BIGINT) ${T}`);
      await pool.query(`CREATE TABLE IF NOT EXISTS downloads (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, rid VARCHAR(36), aid VARCHAR(32), at BIGINT, INDEX (at), INDEX (aid)) ${T}`);
    },
    async resources() { const [rows] = await pool.query('SELECT * FROM resources ORDER BY createdAt DESC'); return rows.map(toR); },
    async resource(id) { const [rows] = await pool.query('SELECT * FROM resources WHERE id=?', [id]); return rows[0] ? toR(rows[0]) : null; },
    async addResource(it) {
      await pool.query(`INSERT INTO resources (${COLS.map(c => '`' + c + '`').join(',')}) VALUES (${COLS.map(() => '?').join(',')})`,
        COLS.map(c => (c === 'images' ? JSON.stringify(it.images || []) : it[c])));
    },
    async setStatus(id, s) { const [r] = await pool.query('UPDATE resources SET status=? WHERE id=?', [s, id]); return r.affectedRows > 0; },
    async removeResource(id) {
      const r = await this.resource(id);
      if (r) await pool.query('DELETE FROM resources WHERE id=?', [id]);
      return r;
    },
    async bump(id, k) {
      if (!['views', 'downloads'].includes(k)) return;
      await pool.query(`UPDATE resources SET ${k}=${k}+1 WHERE id=?`, [id]);
    },
    async addReport(r) { await pool.query('INSERT INTO reports (id,resourceId,reason,byName,at) VALUES (?,?,?,?,?)', [r.id, r.resourceId, r.reason, r.by, r.at]); },
    async reports() {
      const [rows] = await pool.query('SELECT id, resourceId, reason, byName AS `by`, at FROM reports ORDER BY at DESC');
      return rows.map(x => ({ ...x, at: Number(x.at) }));
    },
    async removeReport(id) { await pool.query('DELETE FROM reports WHERE id=?', [id]); },
    async logDownload(d) { await pool.query('INSERT INTO downloads (rid,aid,at) VALUES (?,?,?)', [d.rid, d.aid, d.at]); },
    async downloadCounts(from, to) {
      const [rows] = await pool.query(
        `SELECT d.aid, COUNT(*) AS c FROM downloads d JOIN resources r ON r.id=d.rid AND r.status='approved'
         WHERE d.at>=? AND d.at<? GROUP BY d.aid`, [from, Math.min(to, Number.MAX_SAFE_INTEGER)]);
      return new Map(rows.map(r => [r.aid, Number(r.c)]));
    }
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

module.exports = async function createStore(dataDir, env = process.env) {
  const cfg = dbConfig(env);
  const store = cfg ? mysqlStore(cfg) : jsonStore(dataDir);
  await store.init();
  return store;
};
