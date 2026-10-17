/* ============================================================
   Boutik v4 — قارئ الباركود (إصلاح الشاشة السوداء)
   ============================================================ */

let scannerInstance = null;
let scannerTarget = null;
let scannerLastCode = '';
let scannerLastTime = 0;
let remoteScannerMode = false;
let remoteScanRequest = null;

function getScannerConfig() {
  try {
    const s = DB.settings();
    return {
      beep: s.scannerBeep !== false,
      vibrate: s.scannerVibrate !== false,
      avoidDuplicate: s.scannerAvoidDuplicate !== false,
      duplicateInterval: s.scannerDuplicateInterval || 2500
    };
  } catch { return { beep: true, vibrate: true, avoidDuplicate: true, duplicateInterval: 2500 }; }
}

function openScanner(target) {
  scannerTarget = target;
  remoteScannerMode = (target === 'remote' || (target && target.kind === 'remote-request'));
  if (target && target.kind === 'remote-request') remoteScanRequest = target;
  scannerLastCode = '';
  scannerLastTime = 0;

  const overlay = document.getElementById('scannerOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');

  if (typeof Html5Qrcode === 'undefined') {
    const st = document.getElementById('scannerStatus');
    if (st) st.textContent = '⚠️ مكتبة المسح غير محمّلة';
    return;
  }

  const container = document.getElementById('scannerContainer');
  if (!container) return;

  // مسح أي فيديو سابق
  container.innerHTML = '<div id="qrReader" style="width:100%;height:100%"></div>';

  const st = document.getElementById('scannerStatus');
  const title = document.getElementById('scannerTitle');
  if (title) title.textContent = (target && target.kind === 'remote-request') ? '📡 مسح مطلوب من جهاز آخر' : '📷 مسح الباركود';
  if (st) st.textContent = (target && target.kind === 'remote-request') ? '📷 جارٍ تشغيل الكاميرا لإتمام الطلب...' : '📷 جارٍ تشغيل الكاميرا...';

  try {
    scannerInstance = new Html5Qrcode('qrReader', { verbose: false });

    scannerInstance.start(
      { facingMode: 'environment' },
      {
        fps: 15,
        qrbox: function (w, h) {
          const min = Math.min(w, h);
          const size = Math.max(200, Math.floor(min * 0.7));
          return { width: size, height: size };
        },
        aspectRatio: 1.0,
        disableFlip: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      },
      (decodedText, decodedResult) => {
        onScanSuccess(decodedText, decodedResult);
      },
      () => {}
    ).then(() => {
      if (st) st.textContent = (target && target.kind === 'remote-request') ? '📡 امسح الرمز الآن — ستعود النتيجة للجهاز الطالب تلقائيًا' : (remoteScannerMode ? '📡 وضع المسح عن بُعد — وجّه الكاميرا...' : '✅ وجّه الكاميرا نحو الباركود...');
      vibrate([30, 60, 30]);

      // ← إصلاح: تأكد من عرض الفيديو
      setTimeout(() => forceVideoDisplay(), 300);
      setTimeout(() => forceVideoDisplay(), 1000);
      setTimeout(() => forceVideoDisplay(), 2000);
    }).catch(err => {
      if (st) st.textContent = '❌ ' + err;
      playErrorBeep();
    });
  } catch (e) {
    console.error('Scanner init:', e);
    if (st) st.textContent = '❌ ' + e.message;
  }
}

function forceVideoDisplay() {
  try {
    const videos = document.querySelectorAll('#scannerContainer video');
    videos.forEach(video => {
      video.style.cssText = 'width:100%!important;height:100%!important;object-fit:cover!important;position:absolute!important;top:0!important;left:0!important;display:block!important;visibility:visible!important;opacity:1!important;z-index:1!important';
      video.setAttribute('playsinline', 'true');
      video.setAttribute('autoplay', 'true');
      video.setAttribute('muted', 'true');
      video.muted = true;
      video.playsInline = true;
      if (video.paused) {
        video.play().catch(e => console.warn('video play:', e));
      }
    });
    const qrBox = document.querySelector('#scannerContainer canvas');
    if (qrBox) {
      qrBox.style.display = 'none';
    }
  } catch (e) { console.warn('forceVideoDisplay:', e); }
}

function onScanSuccess(text, result) {
  if (!text) return;
  const cfg = getScannerConfig();
  const now = Date.now();

  if (cfg.avoidDuplicate && text === scannerLastCode && (now - scannerLastTime) < cfg.duplicateInterval) {
    return;
  }

  scannerLastCode = text;
  scannerLastTime = now;

  if (cfg.beep) playSuccessBeep();
  if (cfg.vibrate) vibrate([80, 40, 80]);

  const last = document.getElementById('scannerLast');
  if (last) last.textContent = '✅ ' + text;

  handleScan(text);
}

function closeScanner() {
  if (remoteScanRequest) remoteScanRequest = null;
  const overlay = document.getElementById('scannerOverlay');
  if (overlay) overlay.classList.add('hidden');
  if (scannerInstance) {
    const inst = scannerInstance;
    scannerInstance = null;
    try {
      inst.stop().then(() => { try { inst.clear(); } catch (e) {} }).catch(() => {});
    } catch (e) {}
  }
}

function handleScan(text) {
  if (remoteScanRequest && remoteScanRequest.kind === 'remote-request') {
    const req = remoteScanRequest;
    remoteScanRequest = null;
    if (typeof Sync !== 'undefined' && Sync.completeRemoteScan) {
      Sync.completeRemoteScan({ requestId: req.requestId, requesterDeviceId: req.requesterDeviceId, code: text, context: req.context })
        .then(ok => { if (!ok) toast('⚠️ تعذّر إرسال نتيجة المسح', true); });
    }
    closeScanner();
    return;
  }
  if (remoteScannerMode) {
    toast('ℹ️ هذا الوضع القديم لم يعد مطلوبًا — استخدم «المسح بجهاز آخر»', true);
    closeScanner();
    return;
  }

  if (scannerTarget === 'pos') {
    const p = DB.products().find(x => x.barcode === text);
    if (p) {
      addToCart(p.id);
      toast('✅ ' + p.name);
    } else {
      if (typeof playErrorBeep === 'function') playErrorBeep();
      toast('⚠️ منتج غير معروف: ' + text, true);
    }
  } else if (scannerTarget === 'product') {
    const p = DB.products().find(x => x.barcode === text);
    if (p) {
      closeScanner();
      if (typeof openProductModal === 'function') {
        openProductModal(p.id);
        toast('📦 منتج موجود: ' + p.name);
      }
    } else {
      closeScanner();
      if (typeof openProductModalWithBarcode === 'function') {
        openProductModalWithBarcode(text);
      }
    }
  } else if (scannerTarget === 'product-barcode') {
    const f = document.getElementById('pBarcode');
    if (f) {
      f.value = text;
      if (typeof onProductBarcodeChange === 'function') onProductBarcodeChange(text);
    }
    closeScanner();
  }
}

// يعمل من أي جهاز (رئيسي أو فرعي، هاتف أو حاسوب): ما تمسحه الكاميرا يظهر مباشرة في الأجهزة الأخرى
function isNetworked() {
  const m = DB.mode();
  return (m.current === 'client' && !!Net.host) || (m.current === 'host' && !m.standalone);
}

async function chooseRemoteScannerDevice() {
  const devices = (typeof Sync !== 'undefined' && Sync.refreshRemoteDevices) ? await Sync.refreshRemoteDevices() : [];
  const list = (devices || []).filter(d => d && d.id);
  if (!list.length) { toast('⚠️ لا يوجد جهاز آخر متصل وقادر على المسح', true); return null; }
  if (list.length === 1) return list[0].id;
  return new Promise(resolve => {
    let box = document.getElementById('remoteScannerPicker');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'remoteScannerPicker';
    box.style.cssText = 'position:fixed;inset:0;background:#0008;z-index:10050;display:flex;align-items:center;justify-content:center;padding:18px';
    const items = list.map(d => `<button data-id="${escapeHtml(String(d.id))}" style="width:100%;padding:14px;margin:6px 0;border:0;border-radius:10px;background:#f5f5f5;text-align:right;font-size:15px">📱 ${escapeHtml(d.label || ('جهاز • ' + String(d.id).slice(-5)))}</button>`).join('');
    box.innerHTML = `<div style="background:#fff;color:#222;border-radius:16px;padding:18px;width:min(420px,100%);direction:rtl"><h3 style="margin:0 0 12px">اختر جهاز المسح</h3><div>${items}</div><button id="remoteScannerCancel" style="width:100%;padding:12px;margin-top:8px;border:0;border-radius:10px">إلغاء</button></div>`;
    document.body.appendChild(box);
    box.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { const id=b.getAttribute('data-id'); box.remove(); resolve(id); });
    box.querySelector('#remoteScannerCancel').onclick = () => { box.remove(); resolve(null); };
  });
}

async function startRemoteScanner(kind = 'barcode', context = null) {
  if (!isNetworked()) { toast('⚠️ هذا الجهاز غير مرتبط بشبكة Boutika', true); return false; }
  const targetDeviceId = await chooseRemoteScannerDevice();
  if (!targetDeviceId) return false;
  try {
    toast('📡 جارٍ طلب المسح من الجهاز المختار...');
    const result = await Sync.requestRemoteScan({ targetDeviceId, kind, context });
    handleIncomingScan(result.code, result.requestId, result.context || context);
    return true;
  } catch (e) {
    toast('⚠️ تعذّر إتمام المسح على الجهاز الآخر', true);
    return false;
  }
}

async function handleRemoteScanRequest(msg) {
  if (!msg || !msg.requestId || !msg.requesterDeviceId) return;
  remoteScanRequest = { kind: 'remote-request', requestId: msg.requestId, requesterDeviceId: msg.requesterDeviceId, context: msg.context || null };
  try { closeScanner(); } catch (_) {}
  toast('📡 طلب مسح من جهاز آخر');
  setTimeout(() => openScanner(remoteScanRequest), 80);
}
window.handleRemoteScanRequest = handleRemoteScanRequest;
window.startRemoteScanner = startRemoteScanner;

// واجهة عامة للوحدات المستقبلية: أي شاشة تستطيع تسجيل معالج للباركود عن بُعد.
let remoteScanHandler = null;
function registerRemoteScanHandler(handler) { remoteScanHandler = typeof handler === 'function' ? handler : null; }
function clearRemoteScanHandler() { remoteScanHandler = null; }

// استقبال باركود جاء من جهاز آخر، ويُعاد إلى العملية التي كانت تنتظر المسح.
function handleIncomingScan(code, requestId, context) {
  code = String(code || '').trim();
  if (!code) return;
  try {
    if (context && context.target === 'license' && typeof activateWithCode === 'function') {
      activateWithCode(code);
      return;
    }
    if (context && context.target === 'product-barcode') {
      const f = document.getElementById('pBarcode');
      if (f) { f.value = code; if (typeof onProductBarcodeChange === 'function') onProductBarcodeChange(code); }
      if (typeof playSuccessBeep === 'function') playSuccessBeep();
      return;
    }
    if (remoteScanHandler) {
      const handled = remoteScanHandler(code, requestId);
      if (handled !== false) return;
    }
    const f = document.getElementById('pBarcode');
    if (f && f.offsetParent !== null) {                       // نافذة منتج مفتوحة: املأ حقل الباركود
      f.value = code;
      if (typeof onProductBarcodeChange === 'function') onProductBarcodeChange(code);
      if (typeof playSuccessBeep === 'function') playSuccessBeep();
      toast('📡 باركود مستلم: ' + code);
      return;
    }
    const open = document.querySelector('.tab-content:not(.hidden)');
    const tab = open ? open.id.replace('tab-', '') : '';
    const p = DB.products().find(x => String(x.barcode || '').trim() === code);

    if (tab === 'products') {
      if (p && typeof openProductModal === 'function') { openProductModal(p.id); toast('📦 ' + p.name); }
      else if (typeof openProductModalWithBarcode === 'function') openProductModalWithBarcode(code);
      if (typeof playSuccessBeep === 'function') playSuccessBeep();
      return;
    }
    if (p) {
      if (tab !== 'pos' && typeof switchTab === 'function') switchTab('pos');
      addToCart(p.id);
      toast('📡 ' + p.name);
      if (typeof playSuccessBeep === 'function') playSuccessBeep();
      if (typeof vibrate === 'function') vibrate([60, 30, 60]);
    } else {
      toast('📡 باركود غير معروف: ' + code, true);
      if (typeof playErrorBeep === 'function') playErrorBeep();
    }
  } catch (e) { console.warn('handleIncomingScan:', e); }
}
window.handleIncomingScan = handleIncomingScan;
window.registerRemoteScanHandler = registerRemoteScanHandler;
window.clearRemoteScanHandler = clearRemoteScanHandler;

function stopRemoteScanner() {
  remoteScannerMode = false;
  closeScanner();
  toast('⏹️ تم إيقاف وضع المسح عن بُعد');
}

function saveScannerSettings() {
  const s = DB.settings();
  s.scannerBeep = document.getElementById('setScannerBeep')?.checked !== false;
  s.scannerVibrate = document.getElementById('setScannerVibrate')?.checked !== false;
  s.scannerAvoidDuplicate = document.getElementById('setScannerAvoidDup')?.checked !== false;
  DB.setObj('settings', s);
  toast('✅ تم الحفظ');
}
