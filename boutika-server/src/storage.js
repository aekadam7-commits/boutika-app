/* ============================================================
   Boutika Server — طبقة التخزين
   - لا حدّ لعدد التغييرات (سجل JSONL يُلحق فقط)
   - لقطة (snapshot) دورية لتسريع الإقلاع
   - مجلد البيانات قابل للتغيير: بطاقة SD / قرص خارجي / مجلد آخر
   - بدون مكتبات native => يعمل على Termux بدون ترجمة
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// مسار البيانات: متغير البيئة > مسار تطبيق الهاتف (nodejs-mobile) > مجلد data بجانب السيرفر
function resolveDataDir() {
  if (process.env.BOUTIKA_DATA) return path.resolve(process.env.BOUTIKA_DATA);
  try { return path.join(require('bridge').getDataPath(), 'boutika'); } catch (_) {}
  return path.join(__dirname, '..', 'data');
}
const DATA_DIR = resolveDataDir();
const LOG_FILE = path.join(DATA_DIR, 'changelog.jsonl');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

let meta = { seq: 0, deviceId: null, shopName: 'Boutika Host', token: null, createdAt: null };
let logFd = null;
let sinceSnapshot = 0;
const SNAPSHOT_EVERY = +process.env.BOUTIKA_SNAPSHOT_EVERY || 5000;

// فهرس في الذاكرة: آخر نسخة لكل (table:id) — يمنع تضخم الذاكرة
const latest = new Map();
const entryIds = new Map();
// سجل التغييرات الكامل يبقى على القرص، وفي الذاكرة نحتفظ بنافذة حديثة فقط
const RECENT_MAX = +process.env.BOUTIKA_RECENT || 20000;
let recent = [];

function ensureDirs() {
  [DATA_DIR, SNAP_DIR, UPLOAD_DIR, BACKUP_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
}

function saveMeta() {
  const tmp = META_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
  fs.renameSync(tmp, META_FILE);
}

function indexEntry(e) {
  latest.set(e.table + ':' + e.id, e);
  if (e && e.id) entryIds.set(String(e.id), e);
  recent.push(e);
  if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX);
}

function load() {
  ensureDirs();
  if (fs.existsSync(META_FILE)) {
    try { meta = { ...meta, ...JSON.parse(fs.readFileSync(META_FILE, 'utf8')) }; } catch (e) { console.error('meta error', e); }
  }
  if (!meta.deviceId) meta.deviceId = crypto.randomBytes(16).toString('hex').toUpperCase();
  if (!meta.token) meta.token = process.env.BOUTIKA_TOKEN || crypto.randomBytes(12).toString('hex');
  if (!meta.createdAt) meta.createdAt = new Date().toISOString();

  // ترحيل تلقائي من سيرفر v4 القديم (server/data/boutik.json) عند أول تشغيل
  if (!fs.existsSync(LOG_FILE)) {
    const legacy = path.join(__dirname, '..', '..', 'server', 'data', 'boutik.json');
    if (fs.existsSync(legacy)) {
      try {
        const old = JSON.parse(fs.readFileSync(legacy, 'utf8'));
        const out = (old.changelog || []).map(e => JSON.stringify(e)).join('\n');
        fs.writeFileSync(LOG_FILE, out ? out + '\n' : '');
        meta.seq = old.seq || (old.changelog || []).length;
        console.log('↪ تم ترحيل', (old.changelog || []).length, 'تغيير من السيرفر القديم');
      } catch (e) { console.error('legacy migrate error', e); }
    }
  }

  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        indexEntry(e);
        if (e.seq > meta.seq) meta.seq = e.seq;
      } catch (_) { /* سطر تالف: يُتجاهل */ }
    }
  }
  logFd = fs.openSync(LOG_FILE, 'a');
  saveMeta();
}

function append(entry) {
  const existing = entry && entry.id ? entryIds.get(String(entry.id)) : null;
  if (existing) return existing;
  entry.seq = ++meta.seq;
  entry._at = Date.now();
  fs.writeSync(logFd, JSON.stringify(entry) + '\n');
  indexEntry(entry);
  if (++sinceSnapshot >= SNAPSHOT_EVERY) { sinceSnapshot = 0; snapshot(); }
  if (meta.seq % 50 === 0) saveMeta();
  return entry;
}

function getLatest(table, id) { return latest.get(String(table) + ':' + String(id)) || null; }
function hasEntry(id) { return !!(id && entryIds.has(String(id))); }

function since(seq) {
  if (recent.length && recent[0].seq > seq + 1) {
    // العميل متأخر جدًا عن النافذة الحديثة: نعيد آخر نسخة من كل سجل
    return Array.from(latest.values()).filter(e => e.seq > seq).sort((a, b) => a.seq - b.seq);
  }
  return recent.filter(e => e.seq > seq);
}

function fullState() {
  return Array.from(latest.values()).sort((a, b) => a.seq - b.seq);
}

function snapshot() {
  const file = path.join(SNAP_DIR, 'snap-' + String(meta.seq).padStart(10, '0') + '.json');
  fs.writeFileSync(file, JSON.stringify({ seq: meta.seq, at: new Date().toISOString(), entries: fullState() }));
  const snaps = fs.readdirSync(SNAP_DIR).filter(f => f.startsWith('snap-')).sort();
  while (snaps.length > 3) fs.unlinkSync(path.join(SNAP_DIR, snaps.shift()));
  saveMeta();
}

// ضغط السجل: يكتب آخر نسخة من كل سجل فقط (يوفّر مساحة كبيرة)
function compact() {
  const tmp = LOG_FILE + '.compact';
  const entries = fullState();
  fs.writeFileSync(tmp, entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
  fs.closeSync(logFd);
  fs.renameSync(tmp, LOG_FILE);
  logFd = fs.openSync(LOG_FILE, 'a');
  recent = entries.slice(-RECENT_MAX);
  saveMeta();
  return entries.length;
}

function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    total += f.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

function stats() {
  let disk = null;
  try { const s = fs.statfsSync(DATA_DIR); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch (_) {}
  return {
    dataDir: DATA_DIR,
    seq: meta.seq,
    records: latest.size,
    bytes: { total: dirSize(DATA_DIR), log: fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0, uploads: dirSize(UPLOAD_DIR), backups: dirSize(BACKUP_DIR) },
    disk
  };
}

function backup() {
  const name = 'backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  const file = path.join(BACKUP_DIR, name);
  fs.writeFileSync(file, JSON.stringify({ meta: { ...meta, token: undefined }, entries: fullState() }));
  const all = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup-')).sort();
  const keep = +process.env.BOUTIKA_KEEP_BACKUPS || 14;
  while (all.length > keep) fs.unlinkSync(path.join(BACKUP_DIR, all.shift()));
  return { name, file };
}

function flush() { saveMeta(); }

module.exports = {
  load, append, since, getLatest, hasEntry, fullState, snapshot, compact, stats, backup, flush,
  getMeta: () => meta, saveMeta,
  paths: { DATA_DIR, UPLOAD_DIR, BACKUP_DIR }
};
