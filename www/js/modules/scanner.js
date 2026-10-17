/* ============================================================
   Boutik v5 — الماسح الموحّد
   • كاميرا (باركود / QR) + فلاش + تبديل الكاميرا + إدخال يدوي
   • routeScan(): نقطة التوجيه الوحيدة لأي باركود، أيًّا كان مصدره:
       الكاميرا  |  ماسح USB/بلوتوث (scan-wedge.js)  |  جهاز آخر (scan-remote.js)
   ============================================================ */

let scannerInstance = null;
let scannerStartPromise = null;
let scannerTarget = null;        // 'pos' | 'product' | 'product-barcode'
let scannerSession = null;       // جلسة مسح لجهاز آخر (انظر scan-remote.js)
let scannerKind = 'barcode';     // 'barcode' | 'qr'
let scannerLastCode = '';
let scannerLastTime = 0;
let scannerGen = 0;              // يُبطل أي فتح/تبديل معلّق عند الإغلاق
let scannerTorchOn = false;
let scannerFacing = (function () {
  try { return localStorage.getItem('boutika_cam_facing') === 'user' ? 'user' : 'environment'; } catch (e) { return 'environment'; }
})();

function getScannerConfig() {
  try {
    const s = DB.settings();
    return {
      beep: s.scannerBeep !== false,
      vibrate: s.scannerVibrate !== false,
      avoidDuplicate: s.scannerAvoidDuplicate !== false,
      duplicateInterval: s.scannerDuplicateInterval || 2500,
      usb: s.scannerUsb !== false
    };
  } catch (e) { return { beep: true, vibrate: true, avoidDuplicate: true, duplicateInterval: 2500, usb: true }; }
}

/* ---------------- أدوات مشتركة ---------------- */
function scanNormalize(c) {
  return String(c == null ? '' : c).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\ufeff]/g, '').trim();
}

// مطابقة الباركود: تطابق تام، ثم تسامح الأصفار البادئة (UPC-A ↔ EAN-13)
function scanFindProduct(code) {
  const list = DB.products();
  const exact = list.find(x => String(x.barcode || '').trim() === code);
  if (exact) return exact;
  if (/^\d{6,}$/.test(code)) {
    const z = code.replace(/^0+/, '');
    return list.find(x => { const b = String(x.barcode || '').trim(); return /^\d{6,}$/.test(b) && b.replace(/^0+/, '') === z; });
  }
  return null;
}

function scanCurrentTab() {
  const open = document.querySelector('.tab-content:not(.hidden)');
  return open ? open.id.replace('tab-', '') : '';
}

function scanSetStatus(t) { const e = document.getElementById('scannerStatus'); if (e) e.textContent = t; }
function scanSetLast(t, ok) {
  const e = document.getElementById('scannerLast');
  if (!e) return;
  e.textContent = t || '';
  e.style.color = ok === false ? '#feb2b2' : '#9ae6b4';
}

/* ---------------- التوجيه المركزي ----------------
   ctx.target: 'pos' | 'product' | 'product-barcode' | 'modal' | 'license' | null(تلقائي)
   يعيد: { ok, status, name?, text }
   status: added | nostock | unknown | opened | created | filled | locked | custom | empty */
let remoteScanHandler = null;
function registerRemoteScanHandler(handler) { remoteScanHandler = typeof handler === 'function' ? handler : null; }
function clearRemoteScanHandler() { remoteScanHandler = null; }

/* ---- مسح النوافذ (Modals): أي نافذة تسجّل معالجًا خاصًا بها ----
   handler(code) → { ok, text, keepOpen? }   (keepOpen: تبقى الكاميرا مفتوحة للمسح المتتابع)
   يُمسح المعالج تلقائيًا عند openModal/closeModal فلا يبقى معالج قديم. */
let modalScanHandler = null;
function registerModalScan(handler) { modalScanHandler = typeof handler === 'function' ? handler : null; }
function clearModalScan() { modalScanHandler = null; }
function hasModalScan() {
  const m = document.getElementById('modal');
  return !!(modalScanHandler && m && !m.classList.contains('hidden'));
}
window.registerModalScan = registerModalScan;
window.clearModalScan = clearModalScan;
window.hasModalScan = hasModalScan;

function routeScan(code, ctx) {
  ctx = ctx || {};
  code = scanNormalize(code);
  if (!code) return { ok: false, status: 'empty', text: '' };
  const target = ctx.target || null;
  try {
    if (target === 'license') {
      if (typeof activateWithCode === 'function') activateWithCode(code);
      return { ok: true, status: 'filled', text: '🔑 ' + code.slice(0, 24) };
    }

    const appEl = document.getElementById('app');
    if (appEl && !appEl.classList.contains('active')) {
      return { ok: false, status: 'locked', text: '🔒 سجّل الدخول أولاً' };
    }

    // نافذة مفتوحة سجّلت معالج مسح (مشتريات، جرد، ...)
    if (hasModalScan()) {
      const r = modalScanHandler(code, ctx);
      if (r) return r;
    }
    if (target === 'modal') return { ok: false, status: 'nomodal', text: '⚠️ لا توجد نافذة مفتوحة تستقبل المسح' };

    const f = document.getElementById('pBarcode');
    const modalHasField = !!(f && f.offsetParent !== null);

    if (target === 'product-barcode' || (modalHasField && target !== 'pos' && target !== 'product')) {
      if (!f) return { ok: false, status: 'nofield', text: '⚠️ لا يوجد حقل باركود مفتوح' };
      f.value = code;
      if (typeof onProductBarcodeChange === 'function') onProductBarcodeChange(code);
      return { ok: true, status: 'filled', text: '✅ ' + code };
    }

    if (remoteScanHandler) {
      const handled = remoteScanHandler(code, ctx);
      if (handled !== false) return { ok: true, status: 'custom', text: '✅ ' + code };
    }

    const tab = scanCurrentTab();
    const p = scanFindProduct(code);

    if (target === 'product' || ((!target || target === 'auto') && tab === 'products')) {
      if (p && typeof openProductModal === 'function') {
        openProductModal(p.id);
        toast('📦 ' + p.name);
        return { ok: true, status: 'opened', name: p.name, text: '📦 ' + p.name };
      }
      if (typeof openProductModalWithBarcode === 'function') openProductModalWithBarcode(code);
      return { ok: true, status: 'created', text: '➕ منتج جديد: ' + code };
    }

    // نقطة البيع
    if (!p) {
      toast('⚠️ منتج غير معروف: ' + code, true);
      return { ok: false, status: 'unknown', text: '⚠️ غير معروف: ' + code };
    }
    if (tab !== 'pos' && typeof switchTab === 'function') switchTab('pos');
    const added = addToCart(p.id);
    if (added === false) return { ok: false, status: 'nostock', name: p.name, text: '⚠️ ' + p.name + ' — الكمية غير كافية' };
    toast('✅ ' + p.name);
    return { ok: true, status: 'added', name: p.name, text: '✅ ' + p.name };
  } catch (e) {
    console.warn('routeScan:', e);
    return { ok: false, status: 'error', text: '⚠️ خطأ: ' + (e && e.message || e) };
  }
}

// باركود وصل من جهاز آخر (أو من رسالة scan القديمة)
function handleIncomingScan(code, requestId, context) {
  const res = routeScan(code, { target: context && context.target, source: 'remote' });
  try {
    const cfg = getScannerConfig();
    if (res.ok) { if (cfg.beep) playSuccessBeep(); if (cfg.vibrate) vibrate([60, 30, 60]); }
    else playErrorBeep();
  } catch (e) {}
  return res;
}
window.handleIncomingScan = handleIncomingScan;
window.registerRemoteScanHandler = registerRemoteScanHandler;
window.clearRemoteScanHandler = clearRemoteScanHandler;

/* ---------------- رسائل الأخطاء ---------------- */
function scanFriendlyError(err) {
  const name = (err && err.name) || '';
  const msg = String((err && err.message) || err || '');
  if (!navigator.mediaDevices || window.isSecureContext === false) {
    return '🔒 المتصفح يمنع الكاميرا في صفحة http — استعمل تطبيق Boutika (APK أو سطح المكتب)';
  }
  if (/NotAllowed|Permission|denied/i.test(name + msg)) return '🚫 الإذن مرفوض — اسمح للتطبيق باستعمال الكاميرا من إعدادات الجهاز';
  if (/NotFound|Overconstrained|Requested device not found|no camera/i.test(name + msg)) return '📷 لا توجد كاميرا متاحة على هذا الجهاز';
  if (/NotReadable|TrackStart|in use|Could not start video/i.test(name + msg)) return '📷 الكاميرا مستعملة من تطبيق آخر — أغلقه وأعد المحاولة';
  return '❌ ' + msg;
}

function scanFormats(kind) {
  try {
    const F = window.Html5QrcodeSupportedFormats;
    if (!F) return null;
    const names = kind === 'qr' ? ['QR_CODE']
      : ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR', 'QR_CODE'];
    const out = names.filter(n => F[n] !== undefined).map(n => F[n]);
    return out.length ? out : null;
  } catch (e) { return null; }
}

/* ---------------- واجهة الماسح ---------------- */
function scanBuildContainer() {
  const c = document.getElementById('scannerContainer');
  if (!c) return false;
  c.innerHTML = '<div id="qrReader" style="width:100%;height:100%"></div>' +
    '<div class="scan-guide ' + (scannerKind === 'qr' ? 'sq' : 'wide') + '"><i></i></div>';
  return true;
}

function scanBuildTexts() {
  const s = scannerSession;
  const title = document.getElementById('scannerTitle');
  let t = scannerKind === 'qr' ? '📷 مسح QR' : '📷 مسح الباركود';
  if (s && s.push) t = '📲 ماسح لـ «' + (s.peerLabel || 'جهاز') + '»';
  else if (s) t = '📡 مسح مطلوب من «' + (s.peerLabel || 'جهاز') + '»';
  if (title) title.textContent = t;
  scanSetStatus('📷 جارٍ تشغيل الكاميرا...');
  scanSetLast('', true);
  const tb = document.getElementById('scannerTorchBtn');
  if (tb) { tb.classList.add('hidden'); tb.classList.remove('on'); }
}

function scanReadyText() {
  const s = scannerSession;
  if (s && s.mode === 'stream') return '📡 مسح مستمر — كل باركود يصل مباشرة إلى «' + (s.peerLabel || 'الجهاز الآخر') + '»';
  if (s) return '📡 امسح الرمز الآن — ستعود النتيجة إلى «' + (s.peerLabel || 'الجهاز الآخر') + '» تلقائيًا';
  return scannerKind === 'qr' ? '✅ وجّه الكاميرا نحو رمز QR...' : '✅ وجّه الكاميرا نحو الباركود...';
}

async function openScanner(target, opts) {
  opts = opts || {};
  const overlay = document.getElementById('scannerOverlay');
  if (!overlay) return;
  const gen = ++scannerGen;
  const session = (target && target.role === 'scanner') ? target : null;

  // جلسة سابقة لجهاز آخر ستُستبدل: أبلِغ صاحبها
  if (scannerSession && scannerSession !== session) {
    const old = scannerSession; scannerSession = null;
    try { ScanRemote.onScannerClosed(old, 'replaced'); } catch (e) {}
  }
  try { if (typeof stopLicenseScan === 'function') await stopLicenseScan(); } catch (e) {}
  await stopScannerInstance();
  if (gen !== scannerGen) return;

  scannerSession = session;
  scannerTarget = session ? null : (target || null);
  scannerKind = ((session ? session.kind : opts.kind) === 'qr') ? 'qr' : 'barcode';
  scannerLastCode = '';
  scannerLastTime = 0;
  scannerTorchOn = false;

  overlay.classList.remove('hidden');
  scanBuildContainer();
  scanBuildTexts();

  if (typeof Html5Qrcode === 'undefined') { scanSetStatus('⚠️ مكتبة المسح غير محمّلة'); return; }
  await scanStartCamera(gen);
}

async function scanStartCamera(gen) {
  if (!navigator.mediaDevices || window.isSecureContext === false) {
    scanSetStatus(scanFriendlyError(null)); playErrorBeep(); return;
  }
  const isQr = scannerKind === 'qr';
  const scanCfg = {
    fps: 15,
    aspectRatio: 1.0,
    disableFlip: false,
    qrbox: function (w, h) {
      const m = Math.min(w, h);
      if (isQr) { const s = Math.min(m, Math.max(200, Math.floor(m * 0.7))); return { width: s, height: s }; }
      const bw = Math.min(w, Math.max(200, Math.floor(Math.min(w * 0.92, 640))));
      return { width: bw, height: Math.min(h, Math.floor(bw * 0.5)) };
    }
  };

  let inst;
  try {
    const cfg = { verbose: false, useBarCodeDetectorIfSupported: true };
    const fm = scanFormats(scannerKind);
    if (fm) cfg.formatsToSupport = fm;
    inst = new Html5Qrcode('qrReader', cfg);
  } catch (e) { console.error('Scanner init:', e); scanSetStatus(scanFriendlyError(e)); return; }
  scannerInstance = inst;

  const tryStart = (camera) => {
    scannerStartPromise = inst.start(camera, scanCfg, (txt) => onScanSuccess(txt), () => {});
    return scannerStartPromise;
  };

  try {
    try {
      await tryStart({ facingMode: scannerFacing });
    } catch (err1) {
      // حواسيب بدون كاميرا خلفية: جرّب أي كاميرا متاحة
      if (!/NotFound|Overconstrained|Requested device not found/i.test((err1 && err1.name || '') + String(err1))) throw err1;
      const cams = await Html5Qrcode.getCameras();
      if (!cams || !cams.length) throw err1;
      await tryStart(cams[cams.length - 1].id);
    }
  } catch (err) {
    if (gen === scannerGen) { scanSetStatus(scanFriendlyError(err)); playErrorBeep(); }
    if (scannerInstance === inst) scannerInstance = null;
    return;
  }

  if (gen !== scannerGen) { await stopScannerInstance(); return; }
  scanSetStatus(scanReadyText());
  vibrate([30, 60, 30]);
  [300, 1000, 2000].forEach(ms => setTimeout(() => { if (gen === scannerGen) forceVideoDisplay(); }, ms));
  [500, 1500].forEach(ms => setTimeout(() => { if (gen === scannerGen) scanSetupTrack(); }, ms));
}

function forceVideoDisplay() {
  try {
    document.querySelectorAll('#scannerContainer video').forEach(video => {
      video.style.cssText = 'width:100%!important;height:100%!important;object-fit:cover!important;position:absolute!important;top:0!important;left:0!important;display:block!important;visibility:visible!important;opacity:1!important;z-index:1!important';
      video.setAttribute('playsinline', 'true');
      video.setAttribute('autoplay', 'true');
      video.setAttribute('muted', 'true');
      video.muted = true;
      video.playsInline = true;
      if (video.paused) video.play().catch(e => console.warn('video play:', e));
    });
    const qrBox = document.querySelector('#scannerContainer canvas');
    if (qrBox) qrBox.style.display = 'none';
  } catch (e) { console.warn('forceVideoDisplay:', e); }
}

/* ---- الفلاش والتركيز ---- */
function scanGetTrack() {
  try {
    const v = document.querySelector('#scannerContainer video');
    const s = v && v.srcObject;
    return (s && s.getVideoTracks && s.getVideoTracks()[0]) || null;
  } catch (e) { return null; }
}

function scanSetupTrack() {
  const t = scanGetTrack();
  if (!t) return;
  let caps = {};
  try { caps = t.getCapabilities ? t.getCapabilities() : {}; } catch (e) {}
  try {
    if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) {
      t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }
  } catch (e) {}
  const tb = document.getElementById('scannerTorchBtn');
  if (tb) tb.classList.toggle('hidden', !caps.torch);
}

async function toggleScannerTorch() {
  const t = scanGetTrack();
  if (!t) return;
  const next = !scannerTorchOn;
  try {
    await t.applyConstraints({ advanced: [{ torch: next }] });
    scannerTorchOn = next;
    const tb = document.getElementById('scannerTorchBtn');
    if (tb) tb.classList.toggle('on', next);
  } catch (e) { toast('⚠️ الفلاش غير مدعوم في هذه الكاميرا', true); }
}

async function switchScannerCamera() {
  const overlay = document.getElementById('scannerOverlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  scannerFacing = scannerFacing === 'environment' ? 'user' : 'environment';
  try { localStorage.setItem('boutika_cam_facing', scannerFacing); } catch (e) {}
  const gen = ++scannerGen;
  await stopScannerInstance();
  if (gen !== scannerGen) return;
  scannerTorchOn = false;
  scanBuildContainer();
  scanBuildTexts();
  await scanStartCamera(gen);
}

/* ---- إدخال يدوي (باركود تالف أو الكاميرا لا تقرأه) ---- */
function scannerManualSubmit() {
  const inp = document.getElementById('scannerManual');
  if (!inp) return;
  const v = scanNormalize(inp.value);
  inp.value = '';
  if (v) onScanSuccess(v, true);
}

/* ---------------- نتيجة المسح ---------------- */
function onScanSuccess(text, force) {
  text = scanNormalize(text);
  if (!text) return;
  const cfg = getScannerConfig();
  const now = Date.now();
  if (!force && cfg.avoidDuplicate && text === scannerLastCode && (now - scannerLastTime) < cfg.duplicateInterval) return;
  scannerLastCode = text;
  scannerLastTime = now;
  handleScan(text);
}

function scanFeedback(res) {
  const cfg = getScannerConfig();
  if (res.ok) { if (cfg.beep) playSuccessBeep(); if (cfg.vibrate) vibrate([80, 40, 80]); }
  else { playErrorBeep(); vibrate([250]); }
  scanSetLast(res.text, res.ok);
}

function handleScan(text) {
  if (scannerSession) { ScanRemote.sendCode(scannerSession, text); return; }
  const res = routeScan(text, { target: scannerTarget, source: 'camera' });
  scanFeedback(res);
  // نقطة البيع تبقى مفتوحة للمسح المتتابع؛ غيرها يُغلق بعد النجاح
  if (scannerTarget !== 'pos' && res.ok && !res.keepOpen) closeScanner('done');
}

/* ---------------- الإغلاق ---------------- */
async function stopScannerInstance() {
  const inst = scannerInstance;
  scannerInstance = null;
  scannerTorchOn = false;
  if (!inst) return;
  try { if (scannerStartPromise) await scannerStartPromise; } catch (e) {}   // لا نوقف قبل اكتمال التشغيل
  try { await inst.stop(); } catch (e) {}
  try { inst.clear(); } catch (e) {}
}

function closeScanner(reason) {
  scannerGen++;
  const s = scannerSession;
  scannerSession = null;
  scannerTarget = null;
  const overlay = document.getElementById('scannerOverlay');
  if (overlay) overlay.classList.add('hidden');
  stopScannerInstance();
  if (s && reason !== 'done') { try { ScanRemote.onScannerClosed(s, 'closed'); } catch (e) {} }
}

function saveScannerSettings() {
  const s = DB.settings();
  s.scannerBeep = document.getElementById('setScannerBeep')?.checked !== false;
  s.scannerVibrate = document.getElementById('setScannerVibrate')?.checked !== false;
  s.scannerAvoidDuplicate = document.getElementById('setScannerAvoidDup')?.checked !== false;
  s.scannerUsb = document.getElementById('setScannerUsb')?.checked !== false;
  DB.setObj('settings', s);
  toast('✅ تم الحفظ');
}
