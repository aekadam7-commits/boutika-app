/* ============================================================
   Boutik v5 — ماسح USB / بلوتوث (يعمل كلوحة مفاتيح)
   يميّز المسح عن الكتابة اليدوية بالسرعة: أحرف متلاحقة (< 60ms) ثم Enter.
   • يعمل في أي نافذة دون الحاجة للنقر على حقل البحث.
   • في حقل «posSearch» يُضيف المنتج للسلة ويفرّغ الحقل.
   • في حقل «pBarcode» يملأ الحقل كما هو.
   • في أي حقل آخر (اسم، كمية...) لا يتدخل أبدًا.
   ============================================================ */
(function () {
  if (window.__scanWedgeInstalled) return;
  window.__scanWedgeInstalled = true;

  const MAX_GAP = 60;     // ms بين حرفين داخل نفس المسح
  const END_GAP = 150;    // ms بين آخر حرف وEnter
  const MIN_LEN = 4;

  let buf = '';
  let lastT = 0;

  function isEditable(el) {
    if (!el) return false;
    const t = (el.tagName || '').toUpperCase();
    if (t === 'TEXTAREA' || t === 'SELECT') return true;
    if (t === 'INPUT') {
      const ty = (el.type || 'text').toLowerCase();
      return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color'].includes(ty);
    }
    return !!el.isContentEditable;
  }

  // يدعم تخطيط لوحة المفاتيح العربية: نعيد الحرف اللاتيني من e.code
  function charOf(e) {
    const k = e.key;
    if (k && k.length === 1 && k.charCodeAt(0) < 128) return k;
    const m = /^(Key([A-Z])|Digit([0-9]))$/.exec(e.code || '');
    if (!m) return (k && k.length === 1) ? k : '';
    if (m[3] !== undefined) return m[3];
    const caps = e.getModifierState && e.getModifierState('CapsLock');
    return (!!e.shiftKey !== !!caps) ? m[2] : m[2].toLowerCase();
  }

  function appActive() {
    const a = document.getElementById('app');
    return !a || a.classList.contains('active');
  }

  function finish(res) {
    try {
      const cfg = getScannerConfig();
      if (res.ok) { if (cfg.beep) playSuccessBeep(); if (cfg.vibrate) vibrate([60, 30, 60]); }
      else playErrorBeep();
    } catch (e) {}
  }

  function onKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    let cfg;
    try { cfg = getScannerConfig(); } catch (_) { cfg = { usb: true }; }
    if (!cfg.usb) return;
    const now = performance.now();

    if (e.key === 'Enter' || e.key === 'Tab') {
      const code = buf;
      const fast = (now - lastT) <= END_GAP;
      buf = '';
      if (!fast || code.length < MIN_LEN) return;

      const el = document.activeElement;
      const scanOverlayOpen = !document.getElementById('scannerOverlay')?.classList.contains('hidden');
      if (scanOverlayOpen) return;                    // الكاميرا مفتوحة: لا نتدخل

      if (isEditable(el)) {
        if (el.id === 'posSearch') {
          e.preventDefault(); e.stopPropagation();
          if (el.value.endsWith(code)) el.value = el.value.slice(0, el.value.length - code.length);
          const res = routeScan(code, { target: 'pos', source: 'usb' });
          finish(res);
          if (res.ok) el.value = '';
          if (typeof searchPOS === 'function') searchPOS();
          return;
        }
        if (el.id === 'pBarcode') { e.preventDefault(); return; }   // الحقل امتلأ أصلاً
        return;                                                      // أي حقل آخر: اترك الكتابة كما هي
      }

      if (!appActive()) return;                                      // شاشة الدخول/الترخيص
      const modal = document.getElementById('modal');
      const modalOpen = modal && !modal.classList.contains('hidden');
      const pb = document.getElementById('pBarcode');
      if (modalOpen && !(pb && pb.offsetParent !== null)) {
        e.preventDefault(); e.stopPropagation();
        toast('⚠️ أغلق النافذة المفتوحة ثم امسح', true);
        playErrorBeep();
        return;
      }
      e.preventDefault(); e.stopPropagation();                       // يمنع Enter من الضغط على زر ممركّز
      finish(routeScan(code, { target: null, source: 'usb' }));
      return;
    }

    if (['Shift', 'CapsLock', 'Control', 'Alt', 'AltGraph', 'Meta'].includes(e.key)) return;   // Shift قبل الحرف الكبير
    const ch = charOf(e);
    if (!ch || ch.length !== 1) { buf = ''; return; }
    if (now - lastT > MAX_GAP) buf = '';             // بداية تسلسل جديد
    buf += ch;
    lastT = now;
    if (buf.length > 128) buf = buf.slice(-128);
  }

  document.addEventListener('keydown', onKey, true);
})();
