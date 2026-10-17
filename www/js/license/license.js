/* ============================================================
   Boutika — نظام الترخيص
   ------------------------------------------------------------
   1) تجربة مجانية: يومان من أول تشغيل، بلا أي كود
   2) التفعيل: يعرض التطبيق QR خاصًا بالجهاز، فيُصدر المالك
      رمز ترخيص (QR أو نص) من مولّد التراخيص، ويُدخله المستخدم
      بمسح الكاميرا أو باختيار صورة أو بلصق النص
   3) التوقيع: ECDSA P-256 — التحقق محليًا بلا إنترنت
   ============================================================ */

const BOUTIK_PUBLIC_KEY = {
  kty: 'EC', crv: 'P-256',
  x: 'GJMDXiTkDjpUP05jz62Be8ap5_QDWXt-ZyQrF4t4xac',
  y: 'Rz1VRxQiHGd5eAiJkaM0tQAqBqFr82LC5eBmPl-jjRE'
};

const LICENSE_STORAGE = 'boutik_v4_license';
const TRIAL_STORAGE = 'boutik_v4_trial';
const SEEN_STORAGE = 'boutik_v4_lastseen';
const TRIAL_MS = 2 * 24 * 3600 * 1000;           // يومان
const DAY_MS = 86400000;
const PLAN_LABELS = { m1: 'شهري', m3: '3 أشهر', m6: '6 أشهر', y1: 'سنوي', life: 'دائم', custom: 'مخصّص' };

/* ============ أدوات ============ */
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** هاش بسيط (cyrb53) للكشف عن العبث العفوي بسجل التجربة */
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** الوقت الفعلي: لا يرجع للوراء حتى لو غُيّرت ساعة الجهاز */
let _lastSeenWrite = 0;
function nowMs() {
  const n = Date.now();
  let seen = 0;
  try { seen = parseInt(localStorage.getItem(SEEN_STORAGE) || '0', 10) || 0; } catch (e) {}
  if (n > seen && n - _lastSeenWrite > 30000) {
    try { localStorage.setItem(SEEN_STORAGE, String(n)); _lastSeenWrite = n; } catch (e) {}
  }
  return Math.max(n, seen);
}

function clockTampered() {
  let seen = 0;
  try { seen = parseInt(localStorage.getItem(SEEN_STORAGE) || '0', 10) || 0; } catch (e) {}
  return Date.now() < seen - 10 * 60 * 1000;
}

/* ============ التجربة المجانية ============ */
const Trial = {
  _read() {
    try {
      const rec = JSON.parse(localStorage.getItem(TRIAL_STORAGE) || 'null');
      if (rec && typeof rec.s === 'number' && rec.h === cyrb53(rec.s + '|boutika-trial')) return rec;
    } catch (e) {}
    return null;
  },
  _write(s) {
    localStorage.setItem(TRIAL_STORAGE, JSON.stringify({ s, h: cyrb53(s + '|boutika-trial') }));
  },
  /** تُستدعى عند تحميل التطبيق: تبدأ التجربة في أول تشغيل فقط */
  ensure() {
    if (this._read()) return;
    const tampered = !!localStorage.getItem(TRIAL_STORAGE);       // سجل موجود لكنه معدَّل
    const hadDevice = !!localStorage.getItem(Device.KEY);          // التطبيق شُغّل سابقًا
    const hadLicense = !!localStorage.getItem(LICENSE_STORAGE);
    if (tampered || (hadDevice && !hadLicense)) this._write(1);    // تُعدّ التجربة منتهية
    else this._write(nowMs());
  },
  state() {
    const rec = this._read();
    if (!rec) return { active: false, left: 0, days: 0 };
    const end = rec.s + TRIAL_MS;
    const left = end - nowMs();
    return { active: left > 0, left: Math.max(0, left), end, days: Math.max(0, Math.ceil(left / DAY_MS)) };
  }
};
try { Trial.ensure(); } catch (e) { console.warn('trial', e); }

function formatLeft(ms) {
  const h = Math.floor(ms / 3600000);
  if (h >= 48) return Math.ceil(ms / DAY_MS) + ' يوم';
  if (h >= 1) return h + ' ساعة';
  return Math.max(1, Math.ceil(ms / 60000)) + ' دقيقة';
}

/* ============ التحقق من الترخيص ============ */
async function verifyLicense(code) {
  code = (code || '').replace(/\s+/g, '');
  if (!code || !code.startsWith('B3-')) {
    return { ok: false, reason: 'تنسيق الكود غير صحيح' };
  }

  const body = code.slice(3);
  const SIG_LEN = 86;
  if (body.length < SIG_LEN + 2) return { ok: false, reason: 'كود مبتور' };

  const sig64 = body.slice(-SIG_LEN);
  let payload64 = body.slice(0, -SIG_LEN);
  if (payload64.endsWith('-')) payload64 = payload64.slice(0, -1);
  if (payload64.endsWith('=')) payload64 = payload64.replace(/=+$/, '');

  let payloadBytes, sigBytes;
  try {
    payloadBytes = b64urlDecode(payload64);
    sigBytes = b64urlDecode(sig64);
  } catch (e) {
    return { ok: false, reason: 'base64 غير صالح' };
  }
  if (sigBytes.length !== 64) return { ok: false, reason: 'طول التوقيع غير صحيح' };

  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(payloadBytes)); }
  catch { return { ok: false, reason: 'payload غير صالح' }; }

  if (!window.crypto || !crypto.subtle) {
    return { ok: false, reason: 'المتصفح لا يدعم التحقق (يتطلب اتصالًا آمنًا)' };
  }
  try {
    const key = await crypto.subtle.importKey(
      'jwk', BOUTIK_PUBLIC_KEY,
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, payloadBytes
    );
    if (!valid) return { ok: false, reason: 'التوقيع غير صحيح' };
  } catch (e) {
    return { ok: false, reason: 'خطأ في التحقق: ' + e.message };
  }

  if (payload.d && payload.d !== Device.getId()) {
    return { ok: false, reason: 'الكود مخصص لجهاز آخر' };
  }
  const now = nowMs();
  if (payload.s && now < payload.s - DAY_MS) return { ok: false, reason: 'لم يبدأ الترخيص بعد' };
  if (payload.e && now > payload.e) return { ok: false, reason: 'انتهت صلاحية الترخيص' };

  return { ok: true, payload, code };
}

/* ============ التخزين ============ */
function getStoredLicense() {
  try { return JSON.parse(localStorage.getItem(LICENSE_STORAGE) || 'null'); }
  catch { return null; }
}
function saveLicense(code, payload) {
  localStorage.setItem(LICENSE_STORAGE, JSON.stringify({ code: code.replace(/\s+/g, ''), payload, savedAt: Date.now() }));
}

/* ============ الحالة ============ */
function licenseState() {
  const stored = getStoredLicense();
  const now = nowMs();
  if (stored && stored.payload) {
    const p = stored.payload;
    if (!(p.e && now > p.e)) {
      return {
        active: true, kind: 'license', payload: p, code: stored.code,
        left: p.e ? p.e - now : null,
        days: p.e ? Math.max(0, Math.ceil((p.e - now) / DAY_MS)) : null
      };
    }
  }
  const t = Trial.state();
  if (t.active) return { active: true, kind: 'trial', left: t.left, days: t.days, end: t.end };
  return { active: false, kind: stored ? 'expired' : 'trial-ended', payload: stored && stored.payload };
}

/** فحص كامل (بالتحقق من التوقيع) قبل الدخول وأثناء العمل */
async function checkLicenseBeforeLogin() {
  const mode = DB.mode().current;
  if (mode === 'client') return true;
  const stored = getStoredLicense();
  if (stored) {
    const res = await verifyLicense(stored.code);
    if (res.ok) return true;
  }
  return Trial.state().active;
}

/* ============ التفعيل ============ */
function extractLicenseCode(text) {
  text = (text || '').trim();
  const m = text.replace(/\s+/g, '').match(/B3-[A-Za-z0-9_\-=]+/);
  return m ? m[0] : '';
}

async function activateWithCode(raw) {
  const err = document.getElementById('licenseError');
  const st = document.getElementById('licenseStatus');
  if (err) err.textContent = '';
  const code = extractLicenseCode(raw);
  if (!code) {
    if (err) err.textContent = '❌ لم يُعثر على رمز ترخيص صالح';
    return false;
  }
  if (st) { st.textContent = '⏳ جارٍ التحقق...'; st.style.color = ''; }
  const res = await verifyLicense(code);
  if (!res.ok) {
    if (st) st.textContent = '';
    if (err) err.textContent = '❌ ' + res.reason;
    return false;
  }
  saveLicense(code, res.payload);
  if (st) { st.textContent = '✅ تم التفعيل بنجاح'; st.style.color = '#138a45'; }
  setTimeout(() => location.reload(), 700);
  return true;
}

async function activateLicense() {
  const el = document.getElementById('licenseCode');
  const code = el ? el.value : '';
  if (!code.trim()) {
    const err = document.getElementById('licenseError');
    if (err) err.textContent = 'ألصق كود الترخيص أو امسح الـ QR';
    return;
  }
  await activateWithCode(code);
}

/* ---- مسح QR بالكاميرا ---- */
let _licScanner = null;

async function stopLicenseScan() {
  const box = document.getElementById('licenseScanBox');
  if (box) box.classList.add('hidden');
  if (_licScanner) {
    try { await _licScanner.stop(); } catch (e) {}
    try { _licScanner.clear(); } catch (e) {}
    _licScanner = null;
  }
}

async function startRemoteLicenseScan() {
  if (typeof startRemoteScanner !== 'function') {
    const err = document.getElementById('licenseError');
    if (err) err.textContent = '⚠️ المسح عن بُعد غير متاح حاليًا';
    return;
  }
  await startRemoteScanner('qr', { target: 'license' });
}

async function startLicenseScan() {
  const err = document.getElementById('licenseError');
  if (err) err.textContent = '';
  if (typeof Html5Qrcode === 'undefined') {
    if (err) err.textContent = '⚠️ مكتبة المسح غير محمّلة';
    return;
  }
  await stopLicenseScan();
  const box = document.getElementById('licenseScanBox');
  box.classList.remove('hidden');
  try {
    _licScanner = new Html5Qrcode('licenseReader', { verbose: false });
    await _licScanner.start(
      { facingMode: 'environment' },
      { fps: 12, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.8); return { width: s, height: s }; } },
      async (text) => {
        if (!extractLicenseCode(text)) return;           // تجاهل أي QR آخر
        await stopLicenseScan();
        activateWithCode(text);
      },
      () => {}
    );
  } catch (e) {
    await stopLicenseScan();
    if (err) err.textContent = '⚠️ تعذّر تشغيل الكاميرا — استعمل «صورة QR» أو الصق الكود';
  }
}

/* ---- قراءة QR من صورة ---- */
function pickLicenseImage() {
  const f = document.getElementById('licenseFile');
  if (f) { f.value = ''; f.click(); }
}

async function onLicenseImage(input) {
  const file = input.files && input.files[0];
  const err = document.getElementById('licenseError');
  if (!file) return;
  if (err) err.textContent = '';
  if (typeof Html5Qrcode === 'undefined') {
    if (err) err.textContent = '⚠️ مكتبة المسح غير محمّلة';
    return;
  }
  await stopLicenseScan();
  try {
    const reader = new Html5Qrcode('licenseReader', { verbose: false });
    const text = await reader.scanFile(file, false);
    try { reader.clear(); } catch (e) {}
    await activateWithCode(text);
  } catch (e) {
    if (err) err.textContent = '❌ لم يُعثر على QR في الصورة — جرّب صورة أوضح';
  }
}

/* ============ عرض شاشة التفعيل ============ */
function renderDeviceQR() {
  const canvas = document.getElementById('deviceQR');
  if (!canvas) return;
  try { BoutikQR.draw(canvas, Device.qrText(), { size: 360, ecc: 'M' }); }
  catch (e) { console.error('QR', e); }
}

function canvasBlob(canvas) {
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

async function shareDeviceQR() {
  const canvas = document.getElementById('deviceQR');
  const text = 'رمز جهازي لتفعيل Boutika:\n' + Device.qrText();
  try {
    const blob = await canvasBlob(canvas);
    const file = new File([blob], 'boutika-device.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return;
    }
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  copyDeviceId();
}

function saveDeviceQR() {
  const canvas = document.getElementById('deviceQR');
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'boutika-device-' + Device.getId().slice(0, 8) + '.png';
  document.body.appendChild(a); a.click(); a.remove();
  toast('💾 تم حفظ الصورة — وإن لم تظهر فالتقط لقطة شاشة للرمز');
}

function showSubscription() {
  const st = licenseState();
  const screen = document.getElementById('licenseScreen');
  if (!screen) return;
  const status = document.getElementById('licenseStatus');
  const info = document.getElementById('licenseInfo');
  const cont = document.getElementById('licenseContinue');
  const dev = document.getElementById('deviceIdDisplay');
  const codeInp = document.getElementById('licenseCode');
  const err = document.getElementById('licenseError');
  if (err) err.textContent = '';
  screen.classList.remove('hidden');
  if (dev) dev.textContent = Device.grouped();
  renderDeviceQR();
  if (cont) cont.classList.add('hidden');

  const fmt = ms => new Date(ms).toLocaleDateString('ar-DZ');
  if (st.kind === 'license') {
    status.textContent = '✅ الترخيص فعّال';
    status.style.color = '#138a45';
    const p = st.payload;
    info.innerHTML =
      (p.n ? `<div>المرخّص له: ${escapeHtml(p.n)}</div>` : '') +
      `<div>النوع: ${escapeHtml(PLAN_LABELS[p.t] || p.t || '—')}</div>` +
      `<div>ينتهي: ${p.e ? fmt(p.e) : 'دائم ♾️'}</div>` +
      (st.days != null ? `<div>يتبقى: ${st.days} يوم</div>` : '');
    if (codeInp) codeInp.value = st.code || '';
  } else if (st.kind === 'trial') {
    status.textContent = '🎁 فترة تجريبية مجانية';
    status.style.color = '#1e6fd9';
    info.innerHTML = `<div>يتبقى: <b>${formatLeft(st.left)}</b></div><div>فعّل الآن لمواصلة الاستعمال دون انقطاع</div>`;
    if (cont) cont.classList.remove('hidden');
  } else {
    status.textContent = st.kind === 'expired' ? '⛔ انتهى الترخيص' : '⛔ انتهت الفترة التجريبية';
    status.style.color = '#c62828';
    info.innerHTML = '<div>أرسل رمز جهازك (QR) للحصول على رمز التفعيل</div>';
  }
  if (clockTampered()) {
    info.innerHTML += '<div style="color:#c62828">⚠️ تم رصد رجوع في ساعة الجهاز — صحّح التاريخ والوقت</div>';
  }
}

function closeLicenseScreen() {
  stopLicenseScan();
  const st = licenseState();
  if (st.active) {
    const s = document.getElementById('licenseScreen');
    if (s) s.classList.add('hidden');
    if (!document.getElementById('app').classList.contains('active')) showLogin();
  } else {
    location.reload();
  }
}

function continueTrial() {
  stopLicenseScan();
  const s = document.getElementById('licenseScreen');
  if (s) s.classList.add('hidden');
  if (!document.getElementById('app').classList.contains('active')) showLogin();
}

/* ============ شريط التنبيه داخل التطبيق ============ */
function updateLicenseBar() {
  const bar = document.getElementById('trialBar');
  if (!bar) return;
  const m = DB.mode();
  if (m.current !== 'host') { bar.classList.add('hidden'); return; }
  const st = licenseState();
  let html = '';
  if (st.kind === 'trial') {
    html = `🎁 فترة تجريبية — يتبقى <b>${formatLeft(st.left)}</b>`;
  } else if (st.kind === 'license' && st.days != null && st.days <= 7) {
    html = `⏳ ينتهي الترخيص خلال <b>${st.days}</b> يوم`;
  }
  if (!html) { bar.classList.add('hidden'); return; }
  bar.innerHTML = `<span>${html}</span><button onclick="showSubscription()">🔑 تفعيل / تجديد</button>`;
  bar.classList.remove('hidden');
}

/* فحص دوري: يمنع الاستمرار بعد انتهاء التجربة أو الترخيص أثناء العمل */
setInterval(async () => {
  try {
    const app = document.getElementById('app');
    if (!app || !app.classList.contains('active')) return;
    if (DB.mode().current !== 'host') return;
    const ok = await checkLicenseBeforeLogin();
    updateLicenseBar();
    if (!ok) showSubscription();
  } catch (e) { console.warn('license tick', e); }
}, 60000);
