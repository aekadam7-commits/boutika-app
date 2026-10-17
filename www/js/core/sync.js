/* ============================================================
   Boutik v4 — المزامنة الفورية + Remote Scanner
   ============================================================ */

const Sync = {
  ws: null,
  timer: null,
  running: false,
  reconnectTimer: null,
  lastSeq: 0,
  onScanCallback: null,

  start() {
    if (this.running) return;
    this.running = true;
    try { if (typeof ChangeLog !== 'undefined' && ChangeLog.repairAll) ChangeLog.repairAll(); } catch (e) {}
    const mode = DB.mode();
    if (!mode.current) return;

    if (mode.current === 'client' && Net.host) {
      this.connectWS();
      this.timer = setInterval(() => this.flush(), 10000);
    } else if (mode.current === 'host') {
      this.connectWS('ws://localhost:8787/ws');
      this.timer = setInterval(() => this.flush(), 10000);
    }
  },

  connectWS(customUrl) {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;

    let url = customUrl;
    if (!url) {
      if (!Net.host) return;
      url = 'ws://' + Net.host.ip + ':' + Net.host.port + '/ws';
    }

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        Net.online = true;
        if (typeof updateNetStatus === 'function') updateNetStatus();
        console.log('🔌 WebSocket متصل:', url);
        this.afterConnect();
      };

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);

          if (msg.type === 'change' && msg.entry) {
            this.applyMany([msg.entry]);
          }

          if (msg.type === 'batch' && Array.isArray(msg.entries)) {
            this.applyMany(msg.entries);
          }

          if (msg.type === 'scan' && msg.barcode) {
            if (msg.from && msg.from === ChangeLog._deviceId()) return;       // لا نستقبل مسحي أنا
            if (typeof window.handleIncomingScan === 'function') window.handleIncomingScan(String(msg.barcode));
            else if (typeof this.onScanCallback === 'function') this.onScanCallback(msg.barcode);
          }
        } catch (e) { console.warn('WS msg error:', e); }
      };

      this.ws.onclose = () => {
        Net.online = false;
        if (typeof updateNetStatus === 'function') updateNetStatus();
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          if (this.running) this.connectWS(customUrl);
        }, 3000);
      };

      this.ws.onerror = () => { try { this.ws.close(); } catch (e) {} };
    } catch (e) {
      console.error('WS connect error:', e);
    }
  },

  _getSeq() { try { return +(localStorage.getItem('boutika_sync_seq') || 0); } catch (e) { return 0; } },
  _setSeq(n) { try { if (n > this._getSeq()) localStorage.setItem('boutika_sync_seq', String(n)); } catch (e) {} },

  applyMany(entries) {
    let n = 0, maxSeq = 0;
    (entries || []).forEach(e => {
      try { if (ChangeLog.applyRemote(e)) n++; } catch (err) { console.warn('applyRemote:', err); }
      if (e && e.seq > maxSeq) maxSeq = e.seq;
    });
    if (maxSeq) this._setSeq(maxSeq);
    if (n && typeof refreshAll === 'function') { try { refreshAll(); } catch (e) {} }
    return n;
  },

  onRemoteChange(entry) { this.applyMany([entry]); },

  // عند كل اتصال: أرسل المعلّق، استلم ما فاتني، والمضيف يرسل بياناته القديمة مرة واحدة
  async afterConnect() {
    try { await this.flush(); } catch (e) {}
    try { await this.pull(); } catch (e) {}
    try { if (DB.mode().current === 'host') await this.seedOnce(); } catch (e) {}
  },

  async seedOnce() {
    if (localStorage.getItem('boutika_seed_v3')) return;
    const url = Net.baseUrl() || 'http://localhost:8787';
    const entries = ChangeLog.seedEntries();
    for (let i = 0; i < entries.length; i += 500) {
      const r = await fetch(url + '/api/sync/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: entries.slice(i, i + 500) })
      });
      if (!r.ok) return;
    }
    localStorage.setItem('boutika_seed_v3', '1');
  },

  pushImmediate(entry) {
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify({ type: 'push', entries: [entry] }));
        return true;
      } catch (e) { return false; }
    }
    return false;
  },

  async sendScan(barcode) {
    const from = ChangeLog._deviceId();
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify({ type: 'scan', barcode, from })); return true; } catch (e) {}
    }
    try {                                                   // بديل عبر HTTP إن لم يكن WebSocket متصلًا
      const url = Net.baseUrl() || 'http://localhost:8787';
      const r = await fetch(url + '/api/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, from })
      });
      return r.ok;
    } catch (e) { return false; }
  },

  onScan(callback) {
    this.onScanCallback = callback;
  },

  async flush() {
    const pending = ChangeLog.pending();
    if (!pending.length) return;

    const url = Net.baseUrl() || 'http://localhost:8787';
    try {
      const r = await fetch(url + '/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: pending })
      });
      if (r.ok) {
        ChangeLog.markSynced(pending.map(e => e.id));
      }
    } catch (e) {}
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
    } catch (e) { return 0; }
  }
};
