/* ============================================================
   Boutik v4 — قارئ الباركود (إصلاح الشاشة السوداء)
   ============================================================ */

let scannerInstance = null;
let scannerTarget = null;
let scannerLastCode = '';
let scannerLastTime = 0;
let remoteScannerMode = false;

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
  if (st) st.textContent = '📷 جارٍ تشغيل الكاميرا...';

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
      if (st) st.textContent = remoteScannerMode ? '📡 وضع المسح عن بُعد — وجّه الكاميرا...' : '✅ وجّه الكاميرا نحو الباركود...';
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
  if (remoteScannerMode) {
    const sent = (typeof Sync !== 'undefined' && Sync.sendScan) ? Sync.sendScan(text) : false;
    if (sent) {
      toast('📡 تم إرسال: ' + text);
    } else {
      toast('⚠️ لا يوجد اتصال بالسيرفر', true);
      playErrorBeep();
    }
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

function startRemoteScanner() {
  if (DB.mode().current !== 'client') {
    toast('⚠️ يجب أن تكون جهازًا فرعيًا (عميل)', true);
    return;
  }
  if (!Net.host) {
    toast('⚠️ غير متصل بمضيف', true);
    return;
  }
  remoteScannerMode = true;
  toast('📡 وضع المسح عن بُعد مُفعَّل — سيُرسَل إلى الحاسوب');
  openScanner('remote');
}

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
