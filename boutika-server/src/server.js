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
const scanClients = new Map();
const deviceMeta = new Map();

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
function broadcastDeviceList() {
  const devices = Array.from(deviceMeta.entries()).map(([id, m]) => ({ id, label: m.label || ('جهاز • ' + id.slice(-5)) }));
  broadcast({ type: 'devices', devices });
}
/* ---------- المسح عبر الشبكة ----------
   scan_request  : جهاز يطلب من آخر أن يمسح (mode: once | stream)
   scan_result   : الجهاز الماسح يرسل الرمز (stream/push تبقى الجلسة مفتوحة)
   scan_ack      : الجهاز المستقبل يؤكد ما فعله بالرمز (اسم المنتج / سبب الفشل)
   scan_cancel   : أيّ طرف ينهي الجلسة
   الجلسات تُتتبّع هنا لإبلاغ الطرف الآخر فورًا إذا انقطع جهاز. */
const scanSessions = new Map();   // requestId -> { a: requesterId, b: scannerId, at }
const SESSION_TTL = 12 * 3600 * 1000;

function deviceWs(id) {
  const w = scanClients.get(String(id || ''));
  return (w && w.readyState === 1) ? w : null;
}
function labelOf(id) {
  const m = deviceMeta.get(String(id || ''));
  return (m && m.label) || ('جهاز • ' + String(id || '').slice(-5));
}
function sendTo(ws, obj) { try { ws.send(JSON.stringify(obj)); return true; } catch (_) { return false; } }

function relayScan(d, fromId) {
  const requestId = d.requestId ? String(d.requestId).slice(0, 80) : null;
  fromId = String(fromId || d.from || '');
  switch (d.type) {
    case 'scan_request': {
      const targetId = String(d.targetDeviceId || '');
      const target = deviceWs(targetId);
      if (!target) return { ok: false, error: 'target device offline' };
      const requester = String(d.requesterDeviceId || fromId);
      if (requestId) scanSessions.set(requestId, { a: requester, b: targetId, at: Date.now() });
      sendTo(target, { type: 'scan_request', requestId, requesterDeviceId: requester, requesterLabel: labelOf(requester), from: requester, targetDeviceId: targetId, kind: d.kind === 'qr' ? 'qr' : 'barcode', mode: d.mode === 'stream' ? 'stream' : 'once', context: d.context || null });
      return { ok: true };
    }
    case 'scan_result': {
      const dest = deviceWs(d.requesterDeviceId);
      if (!dest) return { ok: false, error: 'requester device offline' };
      const stream = !!d.stream, push = !!d.push;
      if (requestId) {
        if (stream || push) { if (!scanSessions.has(requestId)) scanSessions.set(requestId, { a: String(d.requesterDeviceId), b: fromId, at: Date.now() }); }
        else scanSessions.delete(requestId);
      }
      sendTo(dest, { type: 'scan_result', requestId, code: String(d.code || '').slice(0, 256), context: d.context || null, stream, push, from: fromId, fromLabel: labelOf(fromId) });
      return { ok: true };
    }
    case 'scan_ack': {
      const dest = deviceWs(d.to);
      if (!dest) return { ok: false, error: 'target device offline' };
      sendTo(dest, { type: 'scan_ack', requestId, ok: !!d.ok, text: String(d.text || '').slice(0, 200), name: String(d.name || '').slice(0, 120), from: fromId });
      return { ok: true };
    }
    case 'scan_cancel': {
      if (requestId) scanSessions.delete(requestId);
      const dest = deviceWs(d.to);
      if (dest) sendTo(dest, { type: 'scan_cancel', requestId, reason: String(d.reason || 'closed').slice(0, 40), from: fromId });
      return { ok: true };           // الطرف الآخر غائب: لا خطأ
    }
  }
  return { ok: false, error: 'unknown scan message' };
}

// انقطع جهاز: أخبر شريك كل جلسة مفتوحة له
function endSessionsOf(deviceId) {
  scanSessions.forEach((s, rid) => {
    if (s.a !== deviceId && s.b !== deviceId) return;
    const other = deviceWs(s.a === deviceId ? s.b : s.a);
    if (other) sendTo(other, { type: 'scan_cancel', requestId: rid, reason: 'device-disconnected', from: deviceId });
    scanSessions.delete(rid);
  });
}

// الرسالة القديمة scan (بث): تتطلب الآن جهازًا هدفًا محددًا حتى لا تصل لكل الأجهزة
function sendScan(obj, except) {
  const target = deviceWs(obj.targetDeviceId);
  if (!target || target === except) return false;
  sendTo(target, obj);
  return true;
}
function acceptEntries(list, except) {
  const accepted = [], rejected = [], duplicates = [], adjusted = [];
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

    // حقول رقمية بصيغة «فرق» (مخزون/رصيد): نطبّق الفرق فوق القيمة الحالية بدل رفض التعارض،
    // فلا يضيع بيع جهاز بسبب بيع جهاز آخر (والخادم ذو خيط واحد فالعملية ذرّية)
    if (e.deltas && typeof e.deltas === 'object' && current && current.data && !current.data._deleted && !(e.data && e.data._deleted)) {
      const nd = { ...current.data, ...e.data };
      Object.keys(e.deltas).forEach(f => { const d = +e.deltas[f]; if (Number.isFinite(d)) nd[f] = (+current.data[f] || 0) + d; });
      nd._updated_at = Math.max(+current.data._updated_at || 0, +(e.data && e.data._updated_at) || 0);
      const changed = JSON.stringify(nd) !== JSON.stringify(e.data);
      e.data = nd;
      const saved = storage.append(e);
      accepted.push(saved);
      if (changed) adjusted.push(saved);
      continue;
    }

    if (current && current.seq > baseSeq && current.deviceId !== e.deviceId) {
      rejected.push({ id: e.id, reason: 'conflict', current });
      continue;
    }

    accepted.push(storage.append(e));
  }
  if (accepted.length) broadcast({ type: 'batch', entries: accepted }, except);
  return { accepted, rejected, duplicates, adjusted, seq: storage.getMeta().seq };
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
  res.json({ ok: true, count: result.accepted.length, accepted: result.accepted.map(e => e.id), rejected: result.rejected, duplicates: result.duplicates, adjusted: result.adjusted, seq: meta.seq });
});
app.get('/api/sync/pull', guard, (req, res) => {
  res.json({ ok: true, entries: storage.since(+req.query.since || 0), seq: meta.seq });
});
app.get('/api/state', guard, (req, res) => {
  res.json({ ok: true, entries: storage.fullState(), seq: meta.seq });
});
app.get('/api/devices', guard, (req, res) => {
  res.json({ ok: true, devices: Array.from(deviceMeta.entries()).map(([id, m]) => ({ id, label: m.label || ('جهاز • ' + id.slice(-5)) })) });
});
function httpScan(type, fromKey) {
  return (req, res) => {
    const body = req.body || {};
    const r = relayScan(Object.assign({}, body, { type }), body[fromKey] || body.from);
    if (!r.ok) return res.status(409).json({ ok: false, error: r.error });
    res.json({ ok: true });
  };
}
app.post('/api/scan/request', guard, httpScan('scan_request', 'requesterDeviceId'));
app.post('/api/scan/result', guard, httpScan('scan_result', 'from'));
app.post('/api/scan/relay', guard, (req, res) => {
  const body = req.body || {};
  if (body.type !== 'scan_ack' && body.type !== 'scan_cancel') return res.status(400).json({ ok: false, error: 'bad type' });
  const r = relayScan(body, body.from);
  if (!r.ok) return res.status(409).json({ ok: false, error: r.error });
  res.json({ ok: true });
});
app.post('/api/scan', guard, (req, res) => {          // قديم: يتطلب جهازًا هدفًا
  const barcode = req.body && req.body.barcode;
  if (!barcode) return res.status(400).json({ ok: false });
  if (!req.body.targetDeviceId) return res.status(400).json({ ok: false, error: 'targetDeviceId required' });
  const delivered = sendScan({ type: 'scan', barcode: String(barcode), from: req.body.from, targetDeviceId: String(req.body.targetDeviceId), requestId: req.body.requestId || null });
  if (!delivered) return res.status(409).json({ ok: false, error: 'target device offline' });
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
app.post('/api/restore', adminGuard, (req, res) => {
  try {
    const result = storage.restoreBackup(String((req.body && req.body.name) || ''));
    const entries = storage.since(Math.max(0, result.seq - result.restored - 5));
    if (entries.length) broadcast({ type: 'batch', entries });
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = /not found/i.test(e.message) ? 404 : 400;
    res.status(status).json({ ok: false, error: e.message || 'restore failed' });
  }
});
app.post('/api/backup/upload', adminGuard, (req, res) => {   // رفع ملف نسخة واستعادته
  try {
    const b = req.body;
    if (!b || !Array.isArray(b.entries) || !b.entries.every(e => e && e.table && e.data)) return res.status(400).json({ ok: false, error: 'invalid backup format' });
    const name = 'backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '-uploaded.json';
    fs.writeFileSync(path.join(storage.paths.BACKUP_DIR, name), JSON.stringify({ meta: b.meta || {}, entries: b.entries }));
    const result = storage.restoreBackup(name);
    const entries = storage.since(Math.max(0, result.seq - result.restored - 5));
    if (entries.length) broadcast({ type: 'batch', entries });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'restore failed' });
  }
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
  let connectedDeviceId = null;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ type: 'hello', seq: meta.seq }));
  ws.on('message', msg => {
    try {
      const d = JSON.parse(msg);
      if (d.type === 'hello-device' && d.deviceId) { connectedDeviceId = String(d.deviceId); scanClients.set(connectedDeviceId, ws); deviceMeta.set(connectedDeviceId, { label: String(d.label || '').slice(0, 60) }); broadcastDeviceList(); return; }
      if (d.type === 'list-devices') { try { ws.send(JSON.stringify({ type: 'devices', devices: Array.from(deviceMeta.entries()).map(([id, m]) => ({ id, label: m.label || ('جهاز • ' + id.slice(-5)) })) })); } catch (_) {} return; }
      if (d.type === 'scan_request' || d.type === 'scan_result' || d.type === 'scan_ack' || d.type === 'scan_cancel') {
        const r = relayScan(d, connectedDeviceId);
        if (!r.ok) sendTo(ws, { type: 'scan_error', requestId: d.requestId || null, error: r.error });
        return;
      }
      if (d.type === 'push' && Array.isArray(d.entries)) {
        const result = acceptEntries(d.entries, ws);
        try { ws.send(JSON.stringify({ type: 'ack', accepted: result.accepted.map(e => e.id), rejected: result.rejected, duplicates: result.duplicates, adjusted: result.adjusted, seq: result.seq })); } catch (_) {}
      }
      if (d.type === 'scan' && d.barcode) {
        const delivered = sendScan({ type: 'scan', barcode: String(d.barcode), from: d.from, targetDeviceId: d.targetDeviceId || null, requestId: d.requestId || null }, ws);
        if (!delivered) { try { ws.send(JSON.stringify({ type: 'scan_error', requestId: d.requestId || null, error: 'target device offline' })); } catch (_) {} }
      }
    } catch (e) { console.warn('WS msg error:', e.message); }
  });
  ws.on('close', () => {
    // لا نحذف إن كان الجهاز أعاد الاتصال بمقبس جديد قبل إغلاق القديم
    if (connectedDeviceId && scanClients.get(connectedDeviceId) === ws) {
      scanClients.delete(connectedDeviceId); deviceMeta.delete(connectedDeviceId);
      endSessionsOf(connectedDeviceId);
      broadcastDeviceList();
    }
  });
});
// فحص الاتصال كل 30 ثانية (مهم لشبكات الهاتف)
setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
  const now = Date.now();
  scanSessions.forEach((s, rid) => { if (now - s.at > SESSION_TTL) scanSessions.delete(rid); });
}, 30000);

/* ---------- نسخ احتياطي تلقائي يوميًا + إيقاف نظيف ---------- */
const DAY = 24 * 3600 * 1000;
setInterval(() => { try { storage.backup(); } catch (e) { console.error('backup error', e); } }, DAY).unref();
function shutdown() { try { storage.snapshot(); storage.flush(); } catch (_) {} process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// إيقاف آمن يطلبه تطبيق سطح المكتب (يحفظ البيانات ثم يخرج)
process.on('message', m => { if (m && m.type === 'shutdown') shutdown(); });

const onListen = () => {
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
    if (!global.__boutikaInfoListener) { global.__boutikaInfoListener = true; channel.addListener('get-info', announce); }
  } catch (_) {}
};
server.listen(PORT, '0.0.0.0', onListen);
server.on('error', e => {
  console.error('Server error:', e.message);
  if (process.send) { try { process.send({ type: 'server-error', message: e.message }); } catch (_) {} }
});

/* ---------- إيقاف / تشغيل / إعادة تشغيل الخادم من داخل التطبيق (أندرويد عبر قناة Node) ---------- */
function stopListening() {
  return new Promise(resolve => {
    if (!server.listening) return resolve();
    try { storage.snapshot(); storage.flush(); } catch (_) {}
    try { wss.clients.forEach(c => { try { c.terminate(); } catch (_) {} }); } catch (_) {}
    server.close(() => resolve());
    if (server.closeAllConnections) { try { server.closeAllConnections(); } catch (_) {} }
    setTimeout(resolve, 2000);
  });
}
let controlBusy = false;
async function serverControl(action) {
  if (controlBusy) return;
  controlBusy = true;
  try {
    if (action === 'stop' || action === 'restart') await stopListening();
    if ((action === 'start' || action === 'restart') && !server.listening) server.listen(PORT, '0.0.0.0', onListen);
  } finally { controlBusy = false; }
}
try {
  const { channel } = require('bridge');
  channel.addListener('server-control', a => {
    const msg = Array.isArray(a) ? a[0] : a;
    serverControl(typeof msg === 'string' ? msg : msg && msg.action).catch(e => console.error('server-control', e));
  });
} catch (_) {}
