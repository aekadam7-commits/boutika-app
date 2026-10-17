/* ============================================================
   Boutika Server — يعمل على الحاسوب (Windows/Linux/Mac) والهاتف (Termux)
   متوافق 100% مع واجهات v4: /api/info /api/ping /api/sync/* /api/scan /ws
   ============================================================ */
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const storage = require('./storage');

const PORT = +process.env.PORT || 8787;
// الواجهة: متغير البيئة > nodejs/www (داخل APK) > ../../www (المستودع)
const WWW = path.resolve(process.env.BOUTIKA_WWW ||
  (fs.existsSync(path.join(__dirname, '..', 'www')) ? path.join(__dirname, '..', 'www') : path.join(__dirname, '..', '..', 'www')));
const REQUIRE_TOKEN = process.env.BOUTIKA_REQUIRE_TOKEN === '1';
const MAX_UPLOAD = (+process.env.BOUTIKA_MAX_UPLOAD_MB || 25) * 1024 * 1024;
const MAX_BATCH = 5000;

storage.load();
const meta = storage.getMeta();

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '50mb' }));

/* ---------- حماية اختيارية بالرمز ---------- */
function tokenOk(req) {
  const t = req.headers['x-boutika-token'] || req.query.token;
  if (!t) return false;
  const a = Buffer.from(String(t)), b = Buffer.from(meta.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function guard(req, res, next) {
  if (!REQUIRE_TOKEN || tokenOk(req)) return next();
  res.status(401).json({ ok: false, error: 'token required' });
}
// عمليات الإدارة تتطلب الرمز دائمًا إلا من الجهاز نفسه
function adminGuard(req, res, next) {
  const ip = req.socket.remoteAddress || '';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || tokenOk(req)) return next();
  res.status(403).json({ ok: false, error: 'admin only (use token or localhost)' });
}

/* ---------- البث ---------- */
let wss;
function broadcast(obj, except) {
  const payload = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === 1 && c !== except) c.send(payload); });
}
function acceptEntries(list, except) {
  const accepted = [], rejected = [], duplicates = [];
  for (const raw of (list || []).slice(0, MAX_BATCH)) {
    if (!raw || !raw.id || !raw.table || !raw.data) continue;
    const e = { ...raw };
    const existingEntry = storage.hasEntry(e.id);
    if (existingEntry) {
      duplicates.push(e.id);
      continue;
    }

    // Optimistic concurrency: baseSeq is the last server sequence seen by this device.
    // If another device changed the same logical record after that point, reject the
    // stale write instead of silently overwriting it.
    const logicalId = e.data && e.data.id != null ? e.data.id : '__obj__';
    const current = storage.getLatest(e.table, logicalId);
    const baseSeq = Number.isFinite(+e.baseSeq) ? +e.baseSeq : 0;
    if (current && current.seq > baseSeq && current.deviceId !== e.deviceId) {
      rejected.push({ id: e.id, reason: 'conflict', current });
      continue;
    }

    accepted.push(storage.append(e));
  }
  if (accepted.length) broadcast({ type: 'batch', entries: accepted }, except);
  return { accepted, rejected, duplicates, seq: storage.getMeta().seq };
}

/* ---------- الواجهة الثابتة (نفس مجلد www) ---------- */
app.use(express.static(WWW));

/* ---------- API متوافق مع v4 ---------- */
app.get('/api/info', (req, res) => {
  res.json({ ok: true, shopName: meta.shopName, deviceId: meta.deviceId, version: '5.0.0-boutika', seq: meta.seq, requireToken: REQUIRE_TOKEN });
});
app.get('/api/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.post('/api/sync/push', guard, (req, res) => {
  const result = acceptEntries(req.body && req.body.entries);
  res.json({ ok: true, count: result.accepted.length, accepted: result.accepted.map(e => e.id), rejected: result.rejected, duplicates: result.duplicates, seq: meta.seq });
});
app.get('/api/sync/pull', guard, (req, res) => {
  res.json({ ok: true, entries: storage.since(+req.query.since || 0), seq: meta.seq });
});
app.get('/api/state', guard, (req, res) => {
  res.json({ ok: true, entries: storage.fullState(), seq: meta.seq });
});
app.post('/api/scan', guard, (req, res) => {
  const barcode = req.body && req.body.barcode;
  if (!barcode) return res.status(400).json({ ok: false });
  broadcast({ type: 'scan', barcode: String(barcode), from: req.body.from });
  res.json({ ok: true });
});

/* ---------- الملفات (صور المنتجات، إلخ) — خارج localStorage ---------- */
app.put('/api/files/:name', guard, express.raw({ type: '*/*', limit: MAX_UPLOAD }), (req, res) => {
  const safe = path.basename(req.params.name).replace(/[^\w.\-]/g, '_');
  if (!safe || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ ok: false });
  fs.writeFileSync(path.join(storage.paths.UPLOAD_DIR, safe), req.body);
  res.json({ ok: true, name: safe, url: '/files/' + safe, size: req.body.length });
});
app.use('/files', guard, express.static(storage.paths.UPLOAD_DIR, { maxAge: '7d' }));

/* ---------- التخزين والنسخ الاحتياطي ---------- */
app.get('/api/storage', guard, (req, res) => res.json({ ok: true, ...storage.stats() }));
app.post('/api/backup', adminGuard, (req, res) => res.json({ ok: true, ...storage.backup() }));
app.get('/api/backups', adminGuard, (req, res) => {
  const list = fs.readdirSync(storage.paths.BACKUP_DIR).filter(f => f.startsWith('backup-')).sort().reverse();
  res.json({ ok: true, backups: list });
});
app.get('/api/backups/:name', adminGuard, (req, res) => {
  const f = path.join(storage.paths.BACKUP_DIR, path.basename(req.params.name));
  if (!fs.existsSync(f)) return res.status(404).json({ ok: false });
  res.download(f);
});
app.post('/api/compact', adminGuard, (req, res) => res.json({ ok: true, records: storage.compact() }));

/* ---------- WebSocket ---------- */
const server = http.createServer(app);
wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname !== '/ws') return socket.destroy();
  if (REQUIRE_TOKEN && u.searchParams.get('token') !== meta.token) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ type: 'hello', seq: meta.seq }));
  ws.on('message', msg => {
    try {
      const d = JSON.parse(msg);
      if (d.type === 'push' && Array.isArray(d.entries)) {
        const result = acceptEntries(d.entries, ws);
        try { ws.send(JSON.stringify({ type: 'ack', accepted: result.accepted.map(e => e.id), rejected: result.rejected, duplicates: result.duplicates, seq: result.seq })); } catch (_) {}
      }
      if (d.type === 'scan' && d.barcode) broadcast({ type: 'scan', barcode: String(d.barcode), from: d.from }, ws);
    } catch (e) { console.warn('WS msg error:', e.message); }
  });
});
// فحص الاتصال كل 30 ثانية (مهم لشبكات الهاتف)
setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
}, 30000);

/* ---------- نسخ احتياطي تلقائي يوميًا + إيقاف نظيف ---------- */
const DAY = 24 * 3600 * 1000;
setInterval(() => { try { storage.backup(); } catch (e) { console.error('backup error', e); } }, DAY).unref();
function shutdown() { try { storage.snapshot(); storage.flush(); } catch (_) {} process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  try { // قد يفشل os.networkInterfaces() على بعض إصدارات أندرويد
    const nets = os.networkInterfaces();
    for (const n of Object.keys(nets)) for (const a of nets[n]) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
  } catch (_) {}
  const st = storage.stats();
  console.log('\n🛒 Boutika Server 5.0');
  console.log('   الحاسوب  :  http://localhost:' + PORT);
  ips.forEach(ip => console.log('   الشبكة   :  http://' + ip + ':' + PORT + '   ← افتحه من الهاتف'));
  console.log('   البيانات :  ' + st.dataDir);
  console.log('   السجلات  :  ' + st.records + ' | seq ' + st.seq);
  console.log('   الرمز    :  ' + meta.token + (REQUIRE_TOKEN ? '  (مطلوب)' : '  (غير مفعّل — فعّله بـ BOUTIKA_REQUIRE_TOKEN=1)'));
  if (st.disk) console.log('   المساحة  :  ' + (st.disk.free / 1e9).toFixed(1) + ' GB حرة\n');

  // إبلاغ التطبيق المضيف (Electron عبر IPC / أندرويد عبر bridge)
  const info = { type: 'server-ready', port: PORT, ips, urls: ips.map(ip => 'http://' + ip + ':' + PORT), dataDir: st.dataDir, token: meta.token, requireToken: REQUIRE_TOKEN };
  if (process.send) { try { process.send(info); } catch (_) {} }
  try {
    const { channel } = require('bridge');
    const announce = () => channel.send('server-ready', info);
    announce();
    channel.addListener('get-info', announce);
  } catch (_) {}
});
server.on('error', e => {
  console.error('Server error:', e.message);
  if (process.send) { try { process.send({ type: 'server-error', message: e.message }); } catch (_) {} }
});
