/* ============================================================
   Boutik — مزامنة فورية موثوقة + منع الكتابة المتعارضة + حالة مزامنة
   ============================================================ */

const Sync = {
  ws: null, timer: null, running: false, reconnectTimer: null,
  onScanCallback: null,
  remoteDevices: [],
  _remoteScanWaiters: new Map(),
  _remoteScanSessions: new Map(),
  state: 'offline', // syncing | synced | offline | conflict
  lastError: '',
  lastSyncAt: 0,
  _inflight: false,
  _customWsUrl: null,

  _setState(state, error) {
    this.state = state;
    this.lastError = error || '';
    if (state === 'synced') this.lastSyncAt = Date.now();
    try { localStorage.setItem('boutika_sync_state', JSON.stringify({ state, at: this.lastSyncAt, error: this.lastError })); } catch (_) {}
    if (typeof updateSyncStatus === 'function') updateSyncStatus();
  },

  start() {
    if (this.running) return;
    this.running = true;
    try { if (typeof ChangeLog !== 'undefined' && ChangeLog.repairAll) ChangeLog.repairAll(); } catch (_) {}
    const mode = DB.mode();
    if (!mode.current || mode.standalone) { this._setState('offline'); return; }
    this._customWsUrl = mode.current === 'host' ? 'ws://localhost:8787/ws' : null;
    this.connectWS(this._customWsUrl);
    this.timer = setInterval(() => this.syncNow(), 2500);
    this.syncNow();
  },

  connectWS(customUrl) {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    let url = customUrl;
    if (!url) { if (!Net.host) return; url = 'ws://' + Net.host.ip + ':' + Net.host.port + '/ws'; }
    this._customWsUrl = customUrl || null;
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        try { this.ws.send(JSON.stringify({ type: 'hello-device', deviceId: ChangeLog._deviceId(), label: this.deviceLabel() })); } catch (_) {}
        Net.online = true;
        if (typeof updateNetStatus === 'function') updateNetStatus();
        this._setState('syncing');
        this.afterConnect();
      };
      this.ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'devices' && Array.isArray(msg.devices)) {
            this.remoteDevices = msg.devices.filter(d => d && d.id && d.id !== ChangeLog._deviceId());
            if (typeof window.updateRemoteScannerDevices === 'function') window.updateRemoteScannerDevices(this.remoteDevices);
            return;
          }
          if (msg.type === 'scan_request') {
            if (msg.targetDeviceId && msg.targetDeviceId !== ChangeLog._deviceId()) return;
            if (typeof window.handleRemoteScanRequest === 'function') window.handleRemoteScanRequest(msg);
            return;
          }
          if (msg.type === 'scan_result') {
            const id = String(msg.requestId || '');
            const waiter = this._remoteScanWaiters.get(id);
            if (waiter) {                                   // مسح لمرة واحدة
              this._remoteScanWaiters.delete(id);
              waiter.resolve({ code: String(msg.code || ''), requestId: msg.requestId || null, context: msg.context || null, from: msg.from || null });
              return;
            }
            const sess = this._remoteScanSessions.get(id);
            if (sess) { try { sess.onCode(String(msg.code || ''), msg); } catch (e) { console.warn('scan stream:', e); } return; }
            if (msg.push) this._handlePushedScan(msg);       // جهاز ماسح يدفع لهذا الجهاز
            return;
          }
          if (msg.type === 'scan_ack') {
            if (typeof window.handleScanAck === 'function') window.handleScanAck(msg);
            return;
          }
          if (msg.type === 'scan_cancel') {
            this._endRemoteScan(String(msg.requestId || ''), msg.reason || 'cancelled');
            if (typeof window.handleScanCancel === 'function') window.handleScanCancel(msg);
            return;
          }
          if (msg.type === 'scan_error') {
            this._endRemoteScan(String(msg.requestId || ''), msg.error || 'remote scan failed');
            if (typeof window.handleScanError === 'function') window.handleScanError(msg);
            return;
          }

          if (msg.type === 'hello') {
            // لا نرفع seq عند hello: يجب أولًا سحب كل ما فاتنا من آخر seq محلي.
            this.afterConnect();
            return;
          }
          if (msg.type === 'ack') {
            if (msg.accepted && msg.accepted.length) ChangeLog.markSynced(msg.accepted);
            if (msg.rejected && msg.rejected.length) this.handleRejected(msg.rejected);
            if (msg.adjusted && msg.adjusted.length) this.applyAdjusted(msg.adjusted);
            // لا نرفع seq من ack: قد يقفز فوق تغييرات أجهزة أخرى لم نسحبها بعد؛ يرتفع فقط بالسحب
            this._updateStateFromQueue();
            return;
          }
          if (msg.type === 'change' || msg.type === 'batch') { this.syncSoon(); return; }   // السحب هو المسار الوحيد الذي يرفع seq بترتيب سليم
          if (msg.type === 'scan' && msg.barcode) {
            if (msg.from && msg.from === ChangeLog._deviceId()) return;
            if (typeof window.handleIncomingScan === 'function') window.handleIncomingScan(String(msg.barcode), msg.requestId || null);
            else if (typeof this.onScanCallback === 'function') this.onScanCallback(msg.barcode, msg.requestId || null);
          }
        } catch (e) { console.warn('WS msg error:', e); }
      };
      this.ws.onclose = () => {
        Net.online = false;
        if (typeof updateNetStatus === 'function') updateNetStatus();
        this._setState('offline');
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => { if (this.running) this.connectWS(this._customWsUrl); }, 1500);
      };
      this.ws.onerror = () => { try { this.ws.close(); } catch (_) {} };
    } catch (e) { this._setState('offline', String(e)); }
  },

  _getSeq() { try { return +(localStorage.getItem('boutika_sync_seq') || 0); } catch (_) { return 0; } },
  _setSeq(n) { try { if (+n > this._getSeq()) localStorage.setItem('boutika_sync_seq', String(n)); } catch (_) {} },

  _updateStateFromQueue() {
    const pending = ChangeLog.pending().length;
    if (this.state === 'conflict') return;
    if (pending === 0 && Net.online) this._setState('synced');
    else if (Net.online) this._setState('syncing');
    else this._setState('offline');
  },

  applyMany(entries) {
    entries = entries || [];
    let n = 0, maxSeq = 0, settingsTouched = false;
    if (entries.length) { try { ChangeLog._pend = ChangeLog._pendingSet(); } catch (_) { ChangeLog._pend = null; } }
    try {
      entries.forEach(e => {
        try { if (ChangeLog.applyRemote(e)) { n++; if (e && e.table === 'settings') settingsTouched = true; } } catch (err) { console.warn('applyRemote:', err); }
        if (e && e.seq > maxSeq) maxSeq = e.seq;
      });
    } finally { ChangeLog._pend = null; }
    // seq لا يرتفع هنا: يحدده pull() فقط، وإلا نتخطى تغييرات لم تصلنا (مثلًا بعد رفض تعارض)
    if (settingsTouched) this._applySettingsUI();
    // الترتيب مهم: نحدّث الوردية الحالية أولًا ثم نعيد الرسم، وإلا تظهر بطاقة الوردية بحالتها القديمة
    try { if (typeof loadActiveShift === 'function' && typeof currentUser !== 'undefined' && currentUser) loadActiveShift(); } catch (_) {}
    if (n && typeof refreshAll === 'function') { try { refreshAll(); } catch (_) {} }
    this._updateStateFromQueue();
    return n;
  },

  // الخادم طبّق «فرق» المخزون/الرصيد فوق قيمته الحالية: نتبنّى القيمة الصحيحة محليًا
  applyAdjusted(list) {
    let n = 0;
    try {
      ChangeLog._pend = ChangeLog._pendingSet();
      (list || []).forEach(e => {
        if (!e || !e.data || ChangeLog._hasPending(e.table, e.data.id)) return;   // لي تعديل لاحق معلّق: ردّه سيصحّح القيمة
        try { if (ChangeLog.applyRemote(e, true)) n++; } catch (err) { console.warn('applyAdjusted:', err); }
      });
    } finally { ChangeLog._pend = null; }
    if (n && typeof refreshAll === 'function') { try { refreshAll(); } catch (_) {} }
    return n;
  },

  // الوضع الليلي واللغة القادمان من جهاز آخر
  _applySettingsUI() {
    try { if (typeof applyDarkMode === 'function') applyDarkMode(); } catch (_) {}
    try { if (typeof BoutikI18n !== 'undefined' && BoutikI18n.syncFromSettings) BoutikI18n.syncFromSettings(); } catch (_) {}
  },

  onRemoteChange(entry) { return this.applyMany([entry]); },

  async afterConnect() {
    if (this._connectingSync) return;
    this._connectingSync = true;
    try { await this.pull(); await this.flush(); await this.pull(); }
    finally { this._connectingSync = false; this._updateStateFromQueue(); }
  },

  syncSoon() {
    if (this._inflight) { this._again = true; return; }
    clearTimeout(this._soonT);
    this._soonT = setTimeout(() => this.syncNow(), 30);
  },

  async syncNow() {
    if (!this.running || this._inflight) return;
    if (!Net.online) { this._setState('offline'); return; }
    this._inflight = true;
    try { await this.pull(); await this.flush(); await this.pull(); }
    finally { this._inflight = false; this._updateStateFromQueue(); if (this._again) { this._again = false; this.syncSoon(); } }
  },

  async seedOnce() { return; },

  pushImmediate(entry) {
    if (!(this.ws && this.ws.readyState === 1)) return false;
    try { this.ws.send(JSON.stringify({ type: 'push', entries: [entry] })); this._setState('syncing'); return true; }
    catch (_) { return false; }
  },

  handleRejected(rejected) {
    if (!rejected || !rejected.length) return;
    this._setState('conflict', 'تم رفض تعديل متعارض وحُفظت النسخة على الخادم');
    try {
      rejected.forEach(r => {
        if (!r || !r.id) return;
        const log = ChangeLog.pending().find(e => e.id === r.id);
        if (log) {
          ChangeLog.markSynced([r.id]);
          let conflicts = DB.get('syncConflicts');
          conflicts.push({ id: this._uuid(), entry: log, server: r.current || null, created_at: new Date().toISOString() });
          DB.set('syncConflicts', conflicts.slice(-100));
        }
        if (r.current) this.applyMany([r.current]);
      });
      if (typeof refreshAll === 'function') refreshAll();
      if (typeof toast === 'function') toast('⚠️ تم منع تعديل متعارض وحفظ النسخة الصحيحة من الخادم');
      setTimeout(() => { if (this.state === 'conflict') this._updateStateFromQueue(); }, 3500);
    } catch (_) {}
  },

  _uuid() { return (typeof __safeUuid === 'function') ? __safeUuid() : String(Date.now()) + Math.random(); },

  async flush() {
    const pending = ChangeLog.pending();
    if (!pending.length) return 0;
    if (!Net.online) { this._setState('offline'); return 0; }
    this._setState('syncing');
    const url = Net.baseUrl() || 'http://localhost:8787';
    try {
      const r = await fetch(url + '/api/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: pending }) });
      if (!r.ok) throw new Error('push ' + r.status);
      const data = await r.json();
      if (data.accepted) ChangeLog.markSynced(data.accepted);
      if (data.rejected) this.handleRejected(data.rejected);
      if (data.duplicates) ChangeLog.markSynced(data.duplicates);
      if (data.adjusted && data.adjusted.length) this.applyAdjusted(data.adjusted);
      // لا نرفع seq هنا (انظر ack): السحب وحده يحرّكه
      return (data.accepted || []).length;
    } catch (e) { this._setState('offline', String(e)); return 0; }
  },

  async pull() {
    const url = Net.baseUrl() || 'http://localhost:8787';
    try {
      const r = await fetch(url + '/api/sync/pull?since=' + this._getSeq());
      if (!r.ok) return 0;
      const data = await r.json();
      const n = this.applyMany(data.entries || []);
      if (data.seq) this._setSeq(data.seq);
      return n;
    } catch (_) { return 0; }
  },

  deviceLabel() {
    try {
      const saved = localStorage.getItem('boutika_device_name');
      if (saved) return saved;
    } catch (_) {}
    const id = (typeof ChangeLog !== 'undefined' && ChangeLog._deviceId) ? ChangeLog._deviceId() : 'device';
    return 'جهاز • ' + String(id).slice(-5);
  },

  async refreshRemoteDevices() {
    const url = Net.baseUrl() || 'http://localhost:8787';
    try {
      const r = await fetch(url + '/api/devices');
      if (r.ok) {
        const data = await r.json();
        this.remoteDevices = (data.devices || []).filter(d => d.id !== ChangeLog._deviceId());
        return this.remoteDevices;
      }
    } catch (_) {}
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify({ type: 'list-devices' })); } catch (_) {}
    }
    return this.remoteDevices;
  },

  _newRequestId() { return (typeof __safeUuid === 'function') ? __safeUuid() : String(Date.now()) + Math.random(); },

  // يرسل رسالة مسح عبر WebSocket وإلا عبر HTTP. يعيد true/false
  async _relay(payload, httpPath) {
    try {
      if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(payload)); return true; }
    } catch (_) {}
    const url = Net.baseUrl() || 'http://localhost:8787';
    try {
      const r = await fetch(url + httpPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return r.ok;
    } catch (_) { return false; }
  },

  // طلب مسح لمرة واحدة: يعيد وعدًا بالرمز. يُرفض عند الإلغاء/الانقطاع/المهلة
  async requestRemoteScan({ targetDeviceId, kind = 'barcode', context = null } = {}) {
    if (!targetDeviceId) throw new Error('scanner device required');
    const requestId = this._newRequestId();
    const key = String(requestId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._remoteScanWaiters.delete(key)) {
          this.sendScanCancel({ requestId, to: targetDeviceId, reason: 'timeout' });
          reject(new Error('remote scan timeout'));
        }
      }, 60000);
      this._remoteScanWaiters.set(key, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      const payload = { type: 'scan_request', requestId, requesterDeviceId: ChangeLog._deviceId(), from: ChangeLog._deviceId(), targetDeviceId, kind, mode: 'once', context };
      this._relay(payload, '/api/scan/request').then(ok => {
        if (!ok) { this._remoteScanWaiters.get(key) && this._remoteScanWaiters.get(key).reject(new Error('scanner device offline')); this._remoteScanWaiters.delete(key); }
      });
    });
  },

  // مسح مستمر: يعيد { requestId, stop() }. onCode يُستدعى لكل باركود، onEnd عند النهاية
  async openRemoteScanStream({ targetDeviceId, kind = 'barcode', context = null, onCode, onEnd } = {}) {
    if (!targetDeviceId) throw new Error('scanner device required');
    const requestId = this._newRequestId();
    const key = String(requestId);
    const self = this;
    const sess = {
      requestId, targetDeviceId, ended: false,
      onCode: (code, msg) => { if (typeof onCode === 'function') onCode(code, msg); },
      onEnd: (reason) => { if (sess.ended) return; sess.ended = true; self._remoteScanSessions.delete(key); if (typeof onEnd === 'function') onEnd(reason); },
      stop() { if (sess.ended) return; self.sendScanCancel({ requestId, to: targetDeviceId, reason: 'closed' }); sess.ended = true; self._remoteScanSessions.delete(key); }
    };
    this._remoteScanSessions.set(key, sess);
    const payload = { type: 'scan_request', requestId, requesterDeviceId: ChangeLog._deviceId(), from: ChangeLog._deviceId(), targetDeviceId, kind, mode: 'stream', context };
    const ok = await this._relay(payload, '/api/scan/request');
    if (!ok) { this._remoteScanSessions.delete(key); throw new Error('scanner device offline'); }
    return sess;
  },

  // إنهاء طلب/جلسة عند الإلغاء أو الخطأ (من الطرف الآخر أو الخادم)
  _endRemoteScan(key, reason) {
    const waiter = this._remoteScanWaiters.get(key);
    if (waiter) { this._remoteScanWaiters.delete(key); waiter.reject(new Error(String(reason))); }
    const sess = this._remoteScanSessions.get(key);
    if (sess) sess.onEnd(String(reason));
  },

  // جهاز ماسح يدفع باركود لهذا الجهاز دون طلب سابق: نعالجه ونردّ بتأكيد
  _handlePushedScan(msg) {
    let res = { ok: false, text: '' };
    try {
      res = (typeof window.handleIncomingScan === 'function')
        ? window.handleIncomingScan(String(msg.code || ''), msg.requestId || null, msg.context || null)
        : res;
    } catch (e) { console.warn('pushed scan:', e); }
    this.sendScanAck({ requestId: msg.requestId, to: msg.from, ok: !!(res && res.ok), text: (res && res.text) || '', name: (res && res.name) || '' });
  },

  // الجهاز الماسح يرسل الرمز (للمرة الواحدة أو المستمر أو الدفع)
  async completeRemoteScan({ requestId, requesterDeviceId, code, context = null, stream = false, push = false } = {}) {
    const payload = { type: 'scan_result', requestId, requesterDeviceId, from: ChangeLog._deviceId(), code: String(code || ''), context, stream: !!stream, push: !!push };
    return this._relay(payload, '/api/scan/result');
  },

  sendScanAck({ requestId, to, ok = true, text = '', name = '' } = {}) {
    if (!to) return Promise.resolve(false);
    return this._relay({ type: 'scan_ack', requestId, to, from: ChangeLog._deviceId(), ok: !!ok, text: String(text || ''), name: String(name || '') }, '/api/scan/relay');
  },

  sendScanCancel({ requestId, to, reason = 'closed' } = {}) {
    if (!to) return Promise.resolve(false);
    return this._relay({ type: 'scan_cancel', requestId, to, from: ChangeLog._deviceId(), reason }, '/api/scan/relay');
  },

  async sendScan(barcode, targetDeviceId, requestId) {
    return this.completeRemoteScan({ requestId, requesterDeviceId: targetDeviceId, code: barcode });
  },

  onScan(callback) { this.onScanCallback = callback; }
};
