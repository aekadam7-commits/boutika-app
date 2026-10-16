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
      };

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);

          if (msg.type === 'change' && msg.entry) {
            this.onRemoteChange(msg.entry);
          }

          if (msg.type === 'batch' && Array.isArray(msg.entries)) {
            msg.entries.forEach(e => this.onRemoteChange(e));
          }

          if (msg.type === 'scan' && msg.barcode) {
            if (typeof this.onScanCallback === 'function') {
              this.onScanCallback(msg.barcode);
            }
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

  onRemoteChange(entry) {
    try {
      ChangeLog.applyRemote(entry);
      if (typeof refreshAll === 'function') refreshAll();
    } catch (e) { console.warn('onRemoteChange:', e); }
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

  sendScan(barcode) {
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify({ type: 'scan', barcode }));
        return true;
      } catch (e) { return false; }
    }
    return false;
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
      const r = await fetch(url + '/api/sync/pull?since=' + (this.lastSeq || 0));
      if (!r.ok) return;
      const data = await r.json();
      (data.entries || []).forEach(e => ChangeLog.applyRemote(e));
      this.lastSeq = data.seq || this.lastSeq;
    } catch (e) {}
  }
};
