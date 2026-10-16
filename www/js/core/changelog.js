/* ============================================================
   Boutik v4 — سجل التغييرات + إرسال فوري
   ============================================================ */

const ChangeLog = {
  MAX: 5000,
  _recording: false,

  record(table, data) {
    if (this._recording) return;
    if (!table || ['changelog','auditLog','settings','counters','mode','i18n'].indexOf(table) !== -1) return;

    this._recording = true;
    try {
      const log = JSON.parse(localStorage.getItem(DB.PREFIX + 'changelog') || '[]');
      const entry = {
        id: (typeof __safeUuid === 'function') ? __safeUuid() : String(Date.now()) + Math.random(),
        table, data,
        ts: Date.now(),
        deviceId: (typeof Device !== 'undefined' && Device.getId) ? Device.getId() : 'unknown',
        synced: false
      };
      log.push(entry);
      if (log.length > this.MAX) log.splice(0, log.length - this.MAX);
      localStorage.setItem(DB.PREFIX + 'changelog', JSON.stringify(log));

      if (typeof Sync !== 'undefined' && Sync && Sync.pushImmediate) {
        try {
          if (Sync.pushImmediate(entry)) {
            entry.synced = true;
            this.markSynced([entry.id]);
          }
        } catch (e) {}
      }
    } catch (e) {
      console.error('ChangeLog.record error:', e);
    } finally {
      this._recording = false;
    }
  },

  pending() {
    return DB.get('changelog').filter(e => !e.synced);
  },

  markSynced(ids) {
    try {
      const log = DB.get('changelog');
      const set = new Set(ids);
      log.forEach(e => { if (set.has(e.id)) e.synced = true; });
      localStorage.setItem(DB.PREFIX + 'changelog', JSON.stringify(log));
    } catch (e) { console.error('markSynced error:', e); }
  },

  applyRemote(entry) {
    if (!entry || !entry.table || !entry.data) return;
    try {
      const cur = DB.get(entry.table);
      const idx = cur.findIndex(x => x && x.id === entry.data.id);
      const remoteTs = entry.data._updated_at || entry.ts || 0;
      if (idx >= 0) {
        if (remoteTs >= (cur[idx]._updated_at || 0)) cur[idx] = entry.data;
      } else {
        cur.push(entry.data);
      }
      localStorage.setItem(DB.PREFIX + entry.table, JSON.stringify(cur));
    } catch (e) { console.error('applyRemote error:', e); }
  },

  cleanSynced(keepDays) {
    keepDays = keepDays || 7;
    try {
      const cutoff = Date.now() - keepDays * 86400000;
      const log = DB.get('changelog');
      const newLog = log.filter(e => !e.synced || (e.ts || 0) > cutoff);
      const removed = log.length - newLog.length;
      localStorage.setItem(DB.PREFIX + 'changelog', JSON.stringify(newLog));
      return removed;
    } catch (e) { return 0; }
  }
};

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
