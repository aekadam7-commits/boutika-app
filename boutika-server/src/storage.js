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
  const logicalId = e && e.data && e.data.id != null ? e.data.id : '__obj__';
  latest.set(e.table + ':' + String(logicalId), e);
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

// استعادة آمنة من نسخة الخادم: لا تستبدل هوية الجهاز أو رمز الوصول.
function restoreBackup(name) {
  const safeName = path.basename(String(name || ''));
  if (!/^backup-[A-Za-z0-9T._-]+\.json$/.test(safeName)) throw new Error('invalid backup name');
  const file = path.join(BACKUP_DIR, safeName);
  if (!fs.existsSync(file)) throw new Error('backup not found');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || !Array.isArray(parsed.entries)) throw new Error('invalid backup format');

  // نسخة أمان للحالة الحالية قبل أي تغيير.
  const safety = backup();
  const current = fullState();
  const saved = parsed.entries;
  const now = Date.now();
  const keyOf = e => String(e.table) + ':' + String(e.data && e.data.id != null ? e.data.id : '__obj__');
  const savedKeys = new Set(saved.map(keyOf));
  const currentKeys = new Set(current.map(keyOf));
  const restored = [];

  // إعادة سجلات النسخة كأحداث جديدة كي تصل إلى الأجهزة المتصلة بالمزامنة.
  for (const original of saved) {
    if (!original || !original.table || !original.data) continue;
    const e = JSON.parse(JSON.stringify(original));
    e.id = crypto.randomBytes(16).toString('hex');
    e.deviceId = meta.deviceId;
    e.ts = now;
    e.baseSeq = meta.seq;
    e.synced = true;
    if (Array.isArray(e.data)) {
      e.data = e.data.map(row => row && typeof row === 'object' ? { ...row, _updated_at: now } : row);
    } else if (e.data && typeof e.data === 'object') {
      e.data._updated_at = now;
      if (e.data._obj && typeof e.data._obj === 'object') e.data._obj = { ...e.data._obj };
    }
    restored.push(append(e));
  }

  // حذف منطقي للسجلات التي أُنشئت بعد النسخة القديمة.
  for (const e of current) {
    if (!e || !e.table || !e.data) continue;
    const key = keyOf(e);
    if (savedKeys.has(key) || !currentKeys.has(key)) continue;
    if (e.data.id === '__obj__' || (e.data._obj && typeof e.data._obj === 'object')) {
      restored.push(append({ id: crypto.randomBytes(16).toString('hex'), table: e.table,
        data: { id: '__obj__', _obj: {}, _updated_at: now }, ts: now,
        deviceId: meta.deviceId, baseSeq: meta.seq, synced: true }));
    } else if (e.data.id != null && !e.data._deleted) {
      restored.push(append({ id: crypto.randomBytes(16).toString('hex'), table: e.table,
        data: { id: e.data.id, _deleted: true, _updated_at: now }, ts: now,
        deviceId: meta.deviceId, baseSeq: meta.seq, synced: true }));
    }
  }
  saveMeta();
  snapshot();
  return { restored: restored.length, safetyBackup: safety.name, seq: meta.seq };
}

function flush() { saveMeta(); }

module.exports = {
  load, append, since, getLatest, hasEntry, fullState, snapshot, compact, stats, backup, restoreBackup, flush,
  getMeta: () => meta, saveMeta,
  paths: { DATA_DIR, UPLOAD_DIR, BACKUP_DIR }
};
