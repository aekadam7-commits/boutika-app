/* ============================================================
   Boutik — مزامنة فورية موثوقة + منع الكتابة المتعارضة + حالة مزامنة
   ============================================================ */

const Sync = {
  ws: null, timer: null, running: false, reconnectTimer: null,
  onScanCallback: null,
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
        Net.online = true;
        if (typeof updateNetStatus === 'function') updateNetStatus();
        this._setState('syncing');
        this.afterConnect();
      };
      this.ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'hello') { if (msg.seq) this._setSeq(msg.seq); return; }
          if (msg.type === 'ack') {
            if (msg.accepted && msg.accepted.length) ChangeLog.markSynced(msg.accepted);
            if (msg.rejected && msg.rejected.length) this.handleRejected(msg.rejected);
            if (msg.seq) this._setSeq(msg.seq);
            this._updateStateFromQueue();
            return;
          }
          if (msg.type === 'change' && msg.entry) this.applyMany([msg.entry]);
          if (msg.type === 'batch' && Array.isArray(msg.entries)) this.applyMany(msg.entries);
          if (msg.type === 'scan' && msg.barcode) {
            if (msg.from && msg.from === ChangeLog._deviceId()) return;
            if (typeof window.handleIncomingScan === 'function') window.handleIncomingScan(String(msg.barcode));
            else if (typeof this.onScanCallback === 'function') this.onScanCallback(msg.barcode);
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
    let n = 0, maxSeq = 0;
    (entries || []).forEach(e => {
      try { if (ChangeLog.applyRemote(e)) n++; } catch (err) { console.warn('applyRemote:', err); }
      if (e && e.seq > maxSeq) maxSeq = e.seq;
    });
    if (maxSeq) this._setSeq(maxSeq);
    if (n && typeof refreshAll === 'function') { try { refreshAll(); } catch (_) {} }
    try { if (typeof loadActiveShift === 'function' && typeof currentUser !== 'undefined' && currentUser) loadActiveShift(); } catch (_) {}
    this._updateStateFromQueue();
    return n;
  },

  onRemoteChange(entry) { return this.applyMany([entry]); },

  async afterConnect() {
    try { await this.pull(); } catch (_) {}
    try { await this.flush(); } catch (_) {}
  },

  async syncNow() {
    if (!this.running || this._inflight) return;
    if (!Net.online) { this._setState('offline'); return; }
    this._inflight = true;
    try { await this.pull(); await this.flush(); await this.pull(); }
    finally { this._inflight = false; this._updateStateFromQueue(); }
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
      if (data.seq) this._setSeq(data.seq);
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

  onScan(callback) { this.onScanCallback = callback; }
};
