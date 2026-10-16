/* ============================================================
   Boutik v4 — طبقة التخزين المحلي
   (localStorage حاليًا — يمكن استبدالها بـ IndexedDB لاحقًا)
   ============================================================ */

const Store = {
  PREFIX: 'boutik_v4_',
  async get(key, def) {
    try { const v = localStorage.getItem(this.PREFIX + key); return v ? JSON.parse(v) : def; }
    catch { return def; }
  },
  async set(key, val) {
    localStorage.setItem(this.PREFIX + key, JSON.stringify(val));
  },
  async remove(key) { localStorage.removeItem(this.PREFIX + key); },
  async keys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.PREFIX)) out.push(k.slice(this.PREFIX.length));
    }
    return out;
  },
  async clear() {
    const all = await this.keys();
    all.forEach(k => localStorage.removeItem(this.PREFIX + k));
  }
};
