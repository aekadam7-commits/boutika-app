/* ============================================================
   Boutik v4 — الشبكة (مصحّح)
   ============================================================ */

const Net = {
  host: null,
  online: false,
  mode: null,

  current() {
    const m = DB.mode();
    this.mode = m.current;
    this.host = m.host;
    return this;
  },

  setMode(mode, host) {
    DB.setObj('mode', { current: mode, host: host || null });
    this.mode = mode;
    this.host = host || null;
  },

  baseUrl() {
    if (!this.host || !this.host.ip) return 'http://localhost:8787';
    return 'http://' + this.host.ip + ':' + (this.host.port || 8787);
  },

  async ping() {
    if (!this.host) { this.online = false; updateNetStatus(); return false; }
    try {
      const r = await fetch(this.baseUrl() + '/api/ping', { method: 'GET' });
      this.online = r.ok;
    } catch { this.online = false; }
    if (typeof updateNetStatus === 'function') updateNetStatus();
    return this.online;
  },

  async scanForHosts() {
    const list = document.getElementById('hostList');
    if (list) list.innerHTML = '<div class="empty">جارٍ البحث...</div>';
    const found = [];
    const candidates = this.localCandidates();

    // مسح متوازٍ بحد أقصى 8 طلبات
    const CONCURRENCY = 8;
    let idx = 0;

    const worker = async () => {
      while (idx < candidates.length) {
        const ip = candidates[idx++];
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 800);
          const r = await fetch('http://' + ip + ':8787/api/info', { signal: ctrl.signal });
          clearTimeout(t);
          if (r.ok) {
            const info = await r.json();
            found.push({ ip, port: 8787, name: info.shopName || 'Boutik', id: info.deviceId });
          }
        } catch (e) {}
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    this.renderHosts(found);
    return found;
  },

  localCandidates() {
    const list = [];
    // نطاق مختصر — 25 عنوانًا فقط
    for (let i = 1; i <= 15; i++) list.push('192.168.1.' + i);
    for (let i = 100; i <= 110; i++) list.push('192.168.1.' + i);
    return list;
  },

  renderHosts(list) {
    const el = document.getElementById('hostList');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<div class="empty">لم يُعثر على أجهزة رئيسية. جرّب العنوان اليدوي.</div>';
      return;
    }
    el.innerHTML = list.map(h => `
      <div class="host-item" onclick="Net.pickHost('${h.ip}', ${h.port}, '${escapeHtml(h.name)}')">
        <div><b>${escapeHtml(h.name)}</b><span>${h.ip}:${h.port}</span></div>
        <span>➡️</span>
      </div>
    `).join('');
  },

  pickHost(ip, port, name) {
    this.setMode('client', { ip, port, name });
    toast('✅ تم الاتصال بـ ' + name);
    setTimeout(() => location.reload(), 600);
  }
};

function updateNetStatus() {
  const el = document.getElementById('netStatus');
  if (!el) return;
  if (Net.mode === 'host') {
    el.className = 'net-status online';
    el.textContent = '🖥️ مضيف';
  } else if (Net.mode === 'client') {
    el.className = 'net-status ' + (Net.online ? 'online' : 'offline');
    el.textContent = Net.online ? '📡 متصل' : '📴 غير متصل';
  } else {
    el.className = 'net-status offline';
    el.textContent = '❓ غير محدد';
  }
}

function scanForHosts() { Net.scanForHosts(); }
function connectManual() {
  const v = (document.getElementById('manualHost').value || '').trim();
  if (!v) return;
  const [ip, port] = v.split(':');
  Net.pickHost(ip, +(port || 8787), 'Boutik');
}
