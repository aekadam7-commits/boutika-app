/* ============================================================
   Boutik v5 — المسح عبر الشبكة (هاتف ← → حاسوب)
   ثلاثة أنماط:
   1) مسح لمرة واحدة      startRemoteScanner(kind, context)                    — المنتجات، التفعيل
   2) ماسح لاسلكي مستمر   startRemoteScanner('barcode', ctx, {mode:'stream'})  — نقطة البيع
   3) هذا الجهاز ماسح      startScannerForDevice({target:'pos'})                — الهاتف يدفع المسح للحاسوب
   ============================================================ */

function isNetworked() {
  const m = DB.mode();
  return (m.current === 'client' && !!Net.host) || (m.current === 'host' && !m.standalone);
}

const ScanRemote = {
  link: null,            // جلسة مسح مستمر نشطة (طرف الطلب)

  /* ---------- اختيار الجهاز ---------- */
  _pref() { try { return JSON.parse(localStorage.getItem('boutika_scan_device') || 'null'); } catch (e) { return null; } },
  _setPref(d) { try { localStorage.setItem('boutika_scan_device', JSON.stringify({ id: d.id, label: d.label || '' })); } catch (e) {} },

  async pickDevice(title) {
    const devices = (typeof Sync !== 'undefined' && Sync.refreshRemoteDevices) ? await Sync.refreshRemoteDevices() : [];
    const list = (devices || []).filter(d => d && d.id);
    if (!list.length) { toast('⚠️ لا يوجد جهاز آخر متصل على الشبكة', true); return null; }
    const pref = this._pref();
    const rank = d => (pref && d.id === pref.id) ? 0 : 1;
    list.sort((a, b) => rank(a) - rank(b));
    const dev = list.length === 1 ? list[0] : await this._dialog(list, title, pref);
    if (dev) this._setPref(dev);
    return dev;
  },

  _dialog(list, title, pref) {
    return new Promise(resolve => {
      let box = document.getElementById('remoteScannerPicker');
      if (box) box.remove();
      box = document.createElement('div');
      box.id = 'remoteScannerPicker';
      box.style.cssText = 'position:fixed;inset:0;background:#0008;z-index:10050;display:flex;align-items:center;justify-content:center;padding:18px';
      const items = list.map((d, i) =>
        `<button data-i="${i}" style="width:100%;padding:14px;margin:6px 0;border:0;border-radius:10px;background:#f5f5f5;text-align:right;font-size:15px">${pref && d.id === pref.id ? '⭐' : '📱'} ${escapeHtml(d.label || ('جهاز • ' + String(d.id).slice(-5)))}</button>`).join('');
      box.innerHTML = `<div style="background:#fff;color:#222;border-radius:16px;padding:18px;width:min(420px,100%);direction:rtl"><h3 style="margin:0 0 12px">${escapeHtml(title || 'اختر الجهاز')}</h3><div>${items}</div><button id="remoteScannerCancel" style="width:100%;padding:12px;margin-top:8px;border:0;border-radius:10px">إلغاء</button></div>`;
      document.body.appendChild(box);
      box.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const d = list[+b.getAttribute('data-i')]; box.remove(); resolve(d); });
      box.querySelector('#remoteScannerCancel').onclick = () => { box.remove(); resolve(null); };
    });
  },

  /* ---------- طرف الطلب: أطلب من جهاز آخر أن يمسح ---------- */
  async start(kind, context, opts) {
    kind = kind || 'barcode';
    opts = opts || {};
    if (!isNetworked()) { toast('⚠️ هذا الجهاز غير مرتبط بشبكة Boutika', true); return false; }
    if (opts.mode === 'stream') return this.startStream(kind, context);

    const dev = await this.pickDevice('اختر جهاز المسح');
    if (!dev) return false;
    try {
      toast('📡 جارٍ طلب المسح من «' + (dev.label || 'الجهاز') + '»...');
      const result = await Sync.requestRemoteScan({ targetDeviceId: dev.id, kind, context, mode: 'once' });
      handleIncomingScan(result.code, result.requestId, result.context || context);
      return true;
    } catch (e) {
      const m = String(e && e.message || '');
      toast(/cancel|disconnect|closed|replaced/i.test(m) ? 'ℹ️ أُلغي المسح على الجهاز الآخر'
        : /timeout/i.test(m) ? '⚠️ انتهت مهلة المسح'
        : '⚠️ تعذّر إتمام المسح على الجهاز الآخر', true);
      return false;
    }
  },

  async startStream(kind, context) {
    if (this.link) { toast('ℹ️ الماسح اللاسلكي متصل بالفعل'); return true; }
    const dev = await this.pickDevice('اختر الجهاز الذي سيعمل كماسح');
    if (!dev) return false;
    const link = { dev, count: 0, context, sess: null, ended: false };
    try {
      link.sess = await Sync.openRemoteScanStream({
        targetDeviceId: dev.id, kind, context,
        onCode: (code, msg) => this._onStreamCode(link, code, msg),
        onEnd: (reason) => this._onLinkEnd(link, reason)
      });
    } catch (e) { toast('⚠️ تعذّر الاتصال بالجهاز الماسح', true); return false; }
    if (link.ended) return false;
    this.link = link;
    this._renderLink();
    toast('📡 الماسح متصل: ' + (dev.label || 'جهاز'));
    return true;
  },

  _onStreamCode(link, code, msg) {
    const res = handleIncomingScan(code, link.sess && link.sess.requestId, link.context);
    link.count++;
    this._renderLink();
    try {
      Sync.sendScanAck({
        requestId: link.sess.requestId, to: (msg && msg.from) || link.dev.id,
        ok: !!res.ok, text: res.text || '', name: res.name || ''
      });
    } catch (e) {}
  },

  _onLinkEnd(link, reason) {
    link.ended = true;
    if (this.link === link) {
      this.link = null;
      this._renderLink();
      toast(/disconnect|offline/i.test(String(reason || '')) ? '⚠️ انقطع اتصال الجهاز الماسح' : 'ℹ️ انتهى المسح اللاسلكي', /disconnect|offline/i.test(String(reason || '')));
    }
  },

  stopLink() {
    const l = this.link;
    if (!l) return;
    this.link = null;
    try { l.sess && l.sess.stop(); } catch (e) {}
    this._renderLink();
    toast('⏹️ تم إيقاف الماسح اللاسلكي');
  },

  _renderLink() {
    let bar = document.getElementById('scanLinkBar');
    const l = this.link;
    if (!l) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'scanLinkBar'; bar.className = 'scan-link'; document.body.appendChild(bar); }
    bar.innerHTML = `<span>📡 الماسح: <b>${escapeHtml(l.dev.label || 'جهاز')}</b> · ${l.count}</span><button onclick="stopRemoteScanLink()">إيقاف</button>`;
  },

  /* ---------- طرف الماسح: جهاز يمسح لحساب جهاز آخر ---------- */
  // يصل طلب من جهاز آخر (شاشة الكاميرا تفتح هنا)
  handleRequest(msg) {
    if (!msg || !msg.requestId) return;
    const peer = String(msg.requesterDeviceId || msg.from || '');
    if (!peer) return;
    const label = msg.requesterLabel || this._labelOf(peer);
    const session = {
      role: 'scanner', requestId: String(msg.requestId), peerDeviceId: peer, peerLabel: label,
      context: msg.context || null, mode: msg.mode === 'stream' ? 'stream' : 'once',
      kind: msg.kind === 'qr' ? 'qr' : 'barcode', push: false
    };
    toast('📡 طلب مسح من «' + label + '»');
    openScanner(session);
  },

  // هذا الجهاز يبدأ بنفسه ويدفع كل باركود إلى جهاز آخر
  async startPush(context) {
    if (!isNetworked()) { toast('⚠️ هذا الجهاز غير مرتبط بشبكة Boutika', true); return false; }
    const dev = await this.pickDevice('أرسل نتائج المسح إلى:');
    if (!dev) return false;
    const uuid = (typeof __safeUuid === 'function') ? __safeUuid() : String(Date.now()) + Math.random();
    openScanner({
      role: 'scanner', requestId: String(uuid), peerDeviceId: dev.id, peerLabel: dev.label || 'جهاز',
      context: context || { target: 'pos' }, mode: 'stream', kind: 'barcode', push: true
    });
    return true;
  },

  _labelOf(id) {
    try {
      const d = (Sync.remoteDevices || []).find(x => x.id === id);
      if (d && d.label) return d.label;
    } catch (e) {}
    return 'جهاز • ' + String(id).slice(-5);
  },

  async sendCode(session, code) {
    const stream = session.mode === 'stream';
    scanSetLast('⏳ ' + code, true);
    const ok = await Sync.completeRemoteScan({
      requestId: session.requestId, requesterDeviceId: session.peerDeviceId,
      code, context: session.context, stream: stream && !session.push, push: !!session.push
    });
    if (scannerSession !== session) return;            // أُغلق أثناء الإرسال
    const cfg = getScannerConfig();
    if (!ok) {
      toast('⚠️ تعذّر إرسال نتيجة المسح', true);
      scanSetLast('⚠️ لم يصل: ' + code, false);
      playErrorBeep();
      return;
    }
    if (cfg.beep) playSuccessBeep();
    if (cfg.vibrate) vibrate([60, 30, 60]);
    if (!stream) { closeScanner('done'); return; }      // مرة واحدة: أغلق
    // المستمر: ننتظر scan_ack لعرض اسم المنتج / سبب الفشل
  },

  // أُغلق الماسح بدون نتيجة: أخبر الطرف الآخر ليتوقف عن الانتظار
  onScannerClosed(session, reason) {
    try { Sync.sendScanCancel({ requestId: session.requestId, to: session.peerDeviceId, reason: reason || 'closed' }); } catch (e) {}
  }
};

/* ---------- واجهات عامة (تستعملها الأزرار وSync) ---------- */
function startRemoteScanner(kind, context, opts) { return ScanRemote.start(kind, context, opts); }
function startScannerForDevice(context) { return ScanRemote.startPush(context); }
function stopRemoteScanLink() { ScanRemote.stopLink(); }
function handleRemoteScanRequest(msg) { ScanRemote.handleRequest(msg); }

// تأكيد من الجهاز المستقبل: يُعرض اسم المنتج على شاشة الماسح
function handleScanAck(msg) {
  if (!msg || !scannerSession || String(msg.requestId) !== scannerSession.requestId) return;
  const txt = msg.text || (msg.name ? ((msg.ok ? '✅ ' : '⚠️ ') + msg.name) : (msg.ok ? '✅' : '⚠️'));
  scanSetLast(txt, !!msg.ok);
  if (!msg.ok) { playErrorBeep(); vibrate([250]); }
}

// الطرف الآخر أنهى الجلسة أو انقطع
function handleScanCancel(msg) {
  if (!msg || !scannerSession || String(msg.requestId) !== scannerSession.requestId) return;
  closeScanner('done');
  toast(/disconnect/i.test(String(msg.reason || '')) ? '⚠️ انقطع اتصال الجهاز الآخر' : 'ℹ️ أنهى الجهاز الآخر المسح', /disconnect/i.test(String(msg.reason || '')));
}

// الجهاز المستقبل غير متصل (الكاميرا تبقى تعمل)
function handleScanError(msg) {
  if (!msg || !scannerSession || String(msg.requestId) !== scannerSession.requestId) return;
  scanSetLast('⚠️ الجهاز المستقبل غير متصل', false);
  playErrorBeep();
}

// تحديث عدد الأجهزة المتاحة في الأزرار
function updateRemoteScannerDevices(list) {
  const n = (list || []).length;
  document.querySelectorAll('[data-remote-count]').forEach(el => { el.textContent = n ? '(' + n + ')' : ''; });
}
window.updateRemoteScannerDevices = updateRemoteScannerDevices;
window.handleRemoteScanRequest = handleRemoteScanRequest;
window.startRemoteScanner = startRemoteScanner;
window.startScannerForDevice = startScannerForDevice;
window.stopRemoteScanLink = stopRemoteScanLink;
window.handleScanAck = handleScanAck;
window.handleScanCancel = handleScanCancel;
window.handleScanError = handleScanError;
