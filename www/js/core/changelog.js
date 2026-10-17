/* ============================================================
   Boutik v4 — سجل التغييرات + المزامنة الشاملة (نسخة مصححة)
   - يلتقط أي تغيير في أي جدول عبر خطاف التخزين (مهما كانت الوحدة التي كتبته)
   - يرسل كل تغيير كصف واحد (وليس الجدول كله)
   - يزامن أيضًا الإعدادات (settings) والعدّادات (counters)
   - لا يحذف أي بيانات: تُنظَّف فقط سجلات المزامنة القديمة المُرسَلة
   ============================================================ */

const ChangeLog = {
  SKIP: ['changelog', 'mode', 'i18n'],              // خاصة بكل جهاز ولا تُزامَن
  OBJECT_TABLES: ['settings', 'counters'],           // كائنات مفردة وليست جداول
  DEVICE_SETTINGS: ['scannerBeep', 'scannerVibrate', 'scannerAvoidDuplicate', 'scannerDuplicateInterval', 'darkMode', 'paperSize'],
  KEEP_SYNCED_DAYS: 7,
  _applying: false,
  _cache: {},

  _uuid() { return (typeof __safeUuid === 'function') ? __safeUuid() : String(Date.now()) + Math.random(); },
  _deviceId() { return (typeof Device !== 'undefined' && Device.getId) ? Device.getId() : 'unknown'; },

  _isRow(r) { return r && typeof r === 'object' && !Array.isArray(r) && r.id != null; },

  _snapshot(rows) {
    const m = new Map();
    if (Array.isArray(rows)) rows.forEach(r => { if (this._isRow(r)) m.set(String(r.id), [JSON.stringify(r), r.id]); });
    return m;
  },

  // تسطيح الجداول المصابة (مصفوفة داخل مصفوفة) وإزالة التكرار
  _clean(arr) {
    const byId = new Map(), noId = [];
    (function walk(a) {
      (a || []).forEach(x => {
        if (Array.isArray(x)) return walk(x);
        if (!x || typeof x !== 'object') return;
        if (x.id == null) return noId.push(x);
        const k = String(x.id), p = byId.get(k);
        if (!p || (x._updated_at || 0) >= (p._updated_at || 0)) byId.set(k, x);
      });
    })(arr);
    return Array.from(byId.values()).concat(noId);
  },

  _syncableObject(table, obj) {
    const out = {};
    Object.keys(obj || {}).forEach(k => {
      if (table === 'settings' && this.DEVICE_SETTINGS.indexOf(k) !== -1) return;
      out[k] = obj[k];
    });
    return out;
  },

  _getObjTs(table) { try { return (JSON.parse(localStorage.getItem('boutika_objts') || '{}'))[table] || 0; } catch (e) { return 0; } },
  _setObjTs(table, ts) {
    try { const m = JSON.parse(localStorage.getItem('boutika_objts') || '{}'); m[table] = ts; localStorage.setItem('boutika_objts', JSON.stringify(m)); } catch (e) {}
  },

  record() { /* قديم: التسجيل يتم الآن عبر onWrite */ },

  /* ---------- يُستدعى من خطاف التخزين عند كل كتابة ---------- */
  onWrite(key, oldStr, newStr) {
    if (this._applying || typeof key !== 'string' || !key.startsWith(DB.PREFIX)) return;
    const table = key.slice(DB.PREFIX.length);
    if (this.SKIP.indexOf(table) !== -1 || oldStr === newStr) return;

    let nv = null;
    if (newStr !== undefined) { try { nv = JSON.parse(newStr); } catch (e) { return; } }
    if (nv === null || typeof nv !== 'object') return;

    const now = Date.now(), dev = this._deviceId();
    const mk = d => ({ id: this._uuid(), table, data: d, ts: now, deviceId: dev, baseSeq: (typeof Sync !== 'undefined' && Sync && Sync._getSeq) ? Sync._getSeq() : +(localStorage.getItem('boutika_sync_seq') || 0), synced: false });
    const entries = [];

    if (this.OBJECT_TABLES.indexOf(table) !== -1) {
      if (Array.isArray(nv) || oldStr === undefined) return;            // الإنشاء الأولي لا يُزامَن
      let ov = {}; try { ov = JSON.parse(oldStr) || {}; } catch (e) {}
      const val = this._syncableObject(table, nv);
      if (JSON.stringify(this._syncableObject(table, ov)) === JSON.stringify(val)) return;
      this._setObjTs(table, now);
      entries.push(mk({ id: '__obj__', _obj: val, _updated_at: now }));
    } else if (Array.isArray(nv)) {
      let prev;
      const c = this._cache[table];
      if (c && c.src === oldStr) prev = c.map;
      else { let ov = []; try { ov = oldStr === undefined ? [] : JSON.parse(oldStr); } catch (e) {} prev = this._snapshot(ov); }

      const seen = new Set(), next = new Map();
      nv.forEach(r => {
        if (!this._isRow(r)) return;
        const id = String(r.id), js = JSON.stringify(r);
        seen.add(id); next.set(id, [js, r.id]);
        if (r._updated_at === 0) return;                                  // صفوف افتراضية أولية لا تُرسَل
        const p = prev.get(id);
        if (!p || p[0] !== js) entries.push(mk(r));
      });
      prev.forEach((v, id) => { if (!seen.has(id)) entries.push(mk({ id: v[1], _deleted: true, _updated_at: now })); });
      this._cache[table] = { src: newStr, map: next };
    } else return;

    if (!entries.length) return;
    this._enqueue(entries);
  },

  _enqueue(entries) {
    try {
      entries.forEach(e => {
        try { if (typeof Sync !== 'undefined' && Sync && Sync.pushImmediate) Sync.pushImmediate(e); } catch (err) {}
      });
      this._applying = true;                                              // كتابة السجل نفسه لا تُسجَّل
      let log = JSON.parse(localStorage.getItem(DB.PREFIX + 'changelog') || '[]');
      entries.forEach(e => log.push(e));
      if (log.length > 3000) {                                            // تنظيف سجل المزامنة فقط (وليس بيانات المحل)
        const cutoff = Date.now() - this.KEEP_SYNCED_DAYS * 86400000;
        log = log.filter(e => !e.synced || (e.ts || 0) > cutoff);
      }
      localStorage.setItem(DB.PREFIX + 'changelog', JSON.stringify(log));
    } catch (e) {
      console.error('ChangeLog enqueue error:', e);
    } finally {
      this._applying = false;
    }
  },

  pending() { return DB.get('changelog').filter(e => !e.synced); },

  markSynced(ids) {
    try {
      this._applying = true;
      const log = DB.get('changelog');
      const set = new Set(ids);
      log.forEach(e => { if (set.has(e.id)) e.synced = true; });
      localStorage.setItem(DB.PREFIX + 'changelog', JSON.stringify(log));
    } catch (e) { console.error('markSynced error:', e); }
    finally { this._applying = false; }
  },

  /* ---------- تطبيق تغيير قادم من جهاز آخر؛ يرجع true إن تغيّر شيء ---------- */
  applyRemote(entry) {
    if (!entry || !entry.table || !entry.data) return false;
    if (this.SKIP.indexOf(entry.table) !== -1) return false;
    if (entry.deviceId && entry.deviceId === this._deviceId()) return false;   // تجاهل صدى تغييراتي
    this._applying = true;
    try {
      if (this.OBJECT_TABLES.indexOf(entry.table) !== -1) return this._applyObject(entry);

      let cur = this._clean(DB.get(entry.table));
      const rows = Array.isArray(entry.data) ? this._clean(entry.data) : [entry.data];
      const index = new Map();
      cur.forEach((x, i) => { if (x.id != null) index.set(String(x.id), i); });
      let changed = false;

      rows.forEach(row => {
        if (!this._isRow(row)) return;
        const key = String(row.id), idx = index.get(key);
        const remoteTs = row._updated_at != null ? row._updated_at : (entry.ts || 0);
        const local = idx !== undefined ? cur[idx] : null;

        if (row._deleted) {
          if (local && remoteTs >= (local._updated_at || 0)) { cur[idx] = null; index.delete(key); changed = true; }
          return;
        }
        if (local) {
          if (remoteTs >= (local._updated_at || 0) && JSON.stringify(local) !== JSON.stringify(row)) { cur[idx] = row; changed = true; }
        } else {
          index.set(key, cur.length); cur.push(row); changed = true;
        }
      });

      if (changed) {
        const out = cur.filter(Boolean);
        localStorage.setItem(DB.PREFIX + entry.table, JSON.stringify(out));
        this._cache[entry.table] = { src: JSON.stringify(out), map: this._snapshot(out) };
      }
      return changed;
    } catch (e) { console.error('applyRemote error:', e); return false; }
    finally { this._applying = false; }
  },

  _applyObject(entry) {
    const d = entry.data, table = entry.table;
    const remote = Array.isArray(d) ? null : (d._obj || null);
    if (!remote) return false;
    const ts = d._updated_at || entry.ts || 0;
    const key = DB.PREFIX + table;
    let local = {}; try { local = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) {}
    const merged = Object.assign({}, local);

    if (table === 'counters') {                       // العدّادات: الأكبر يفوز (لا تتراجع أرقام الفواتير)
      Object.keys(remote).forEach(k => {
        merged[k] = (typeof remote[k] === 'number') ? Math.max(+local[k] || 0, remote[k]) : remote[k];
      });
    } else {                                          // الإعدادات: الأحدث يفوز، دون إعدادات الجهاز الخاصة
      if (ts < this._getObjTs(table)) return false;
      Object.keys(remote).forEach(k => { if (this.DEVICE_SETTINGS.indexOf(k) === -1) merged[k] = remote[k]; });
    }
    if (JSON.stringify(merged) === JSON.stringify(local)) return false;
    localStorage.setItem(key, JSON.stringify(merged));
    if (table !== 'counters') this._setObjTs(table, ts);
    return true;
  },

  /* ---------- كل بيانات هذا الجهاز كصفوف (للمضيف عند أول مزامنة) ---------- */
  seedEntries() {
    const pre = DB.PREFIX, now = Date.now(), dev = this._deviceId(), out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(pre)) continue;
      const t = k.slice(pre.length);
      if (this.SKIP.indexOf(t) !== -1) continue;
      let v; try { v = JSON.parse(localStorage.getItem(k)); } catch (e) { continue; }
      if (!v || typeof v !== 'object') continue;
      const mk = d => ({ id: this._uuid(), table: t, data: d, ts: now, deviceId: dev, baseSeq: (typeof Sync !== 'undefined' && Sync && Sync._getSeq) ? Sync._getSeq() : +(localStorage.getItem('boutika_sync_seq') || 0), synced: false });
      if (this.OBJECT_TABLES.indexOf(t) !== -1) {
        if (!Array.isArray(v)) out.push(mk({ id: '__obj__', _obj: this._syncableObject(t, v), _updated_at: now }));
      } else if (Array.isArray(v)) {
        this._clean(v).forEach(r => { if (this._isRow(r) && r._updated_at !== 0) out.push(mk(r)); });
      }
    }
    return out;
  },

  // إصلاح الجداول التي أفسدتها النسخة القديمة (مصفوفة داخل مصفوفة)
  repairAll() {
    try {
      this._applying = true;
      const pre = DB.PREFIX, keys = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(pre)) keys.push(k); }
      keys.forEach(k => {
        const t = k.slice(pre.length);
        if (this.SKIP.indexOf(t) !== -1) return;
        let v; try { v = JSON.parse(localStorage.getItem(k)); } catch (e) { return; }
        if (Array.isArray(v) && v.some(x => Array.isArray(x))) localStorage.setItem(k, JSON.stringify(this._clean(v)));
      });
    } catch (e) { console.warn('repairAll:', e); }
    finally { this._applying = false; }
  },

  cleanSynced(keepDays) {
    keepDays = keepDays || this.KEEP_SYNCED_DAYS;
    try {
      this._applying = true;
      const cutoff = Date.now() - keepDays * 86400000;
      const log = DB.get('changelog');
      const newLog = log.filter(e => !e.synced || (e.ts || 0) > cutoff);
      const removed = log.length - newLog.length;
      localStorage.setItem(DB.PREFIX + 'changelog', JSON.stringify(newLog));
      return removed;
    } catch (e) { return 0; }
    finally { this._applying = false; }
  }
};

// ربط الخطاف: كل كتابة في أي جدول تمر من هنا
(function () {
  window.BoutikaHook = window.BoutikaHook || {};
  window.BoutikaHook.onWrite = function (k, o, n) { ChangeLog.onWrite(k, o, n); };
})();

function upsertRow(table, row) {
  try {
    row._updated_at = Date.now();
    const cur = DB.get(table);
    const idx = cur.findIndex(x => x && x.id === row.id);
    if (idx >= 0) cur[idx] = row;
    else cur.push(row);
    DB.set(table, cur);
    return row;
  } catch (e) { console.error('upsertRow error:', e); }
}

function removeRow(table, id) {
  try {
    const cur = DB.get(table).filter(x => x && x.id !== id);
    DB.set(table, cur);
  } catch (e) { console.error('removeRow error:', e); }
}
