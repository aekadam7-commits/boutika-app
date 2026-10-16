/* ============================================================
   Boutik v4 — قاعدة البيانات
   ============================================================ */

const DB = {
  PREFIX: 'boutik_v4_',

  get(k) {
    try { return JSON.parse(localStorage.getItem(this.PREFIX + k) || '[]'); }
    catch { return []; }
  },
  set(k, v) {
    localStorage.setItem(this.PREFIX + k, JSON.stringify(v));
    if (typeof ChangeLog !== 'undefined' && ChangeLog && ChangeLog.record) {
      if (['changelog', 'auditLog', 'settings', 'counters', 'mode', 'i18n'].indexOf(k) === -1) {
        try { ChangeLog.record(k, v); } catch (e) { console.warn('ChangeLog error:', e); }
      }
    }
  },
  getObj(k) {
    try { return JSON.parse(localStorage.getItem(this.PREFIX + k) || '{}'); }
    catch { return {}; }
  },
  setObj(k, v) {
    localStorage.setItem(this.PREFIX + k, JSON.stringify(v));
  },
  remove(k) { localStorage.removeItem(this.PREFIX + k); },

  users()            { return this.get('users'); },
  products()         { return this.get('products'); },
  categories()       { return this.get('categories'); },
  customers()        { return this.get('customers'); },
  suppliers()        { return this.get('suppliers'); },
  invoices()         { return this.get('invoices'); },
  invoiceItems()     { return this.get('invoiceItems'); },
  purchases()        { return this.get('purchases'); },
  purchaseItems()    { return this.get('purchaseItems'); },
  payments()         { return this.get('payments'); },
  stockMovements()   { return this.get('stockMovements'); },
  shifts()           { return this.get('shifts'); },
  auditLog()         { return this.get('auditLog'); },
  inventorySessions(){ return this.get('inventorySessions'); },
  inventoryItems()   { return this.get('inventoryItems'); },

  settings() { return this.getObj('settings'); },
  counters() { return this.getObj('counters'); },
  mode()     { return this.getObj('mode'); }
};

function __safeUuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function __safeNow() { return new Date().toISOString(); }

function initDB() {
  try {
    const s = DB.settings();
    if (s.initialized) return;

    DB.setObj('settings', {
      initialized: true, version: 4,
      shopName: 'محل Boutik', shopAddress: '', shopPhone: '', shopRC: '',
      invPrefix: 'INV-', purPrefix: 'PUR-', currency: 'دج',
      taxRate: 0, expiryDays: 30, paperSize: '58', darkMode: false,
      scannerBeep: true, scannerVibrate: true, scannerAvoidDuplicate: true
    });

    const defaultUser = {
      id: 'default-admin-0001',
      username: 'user',
      password: '1234',
      role: 'admin',
      created_at: __safeNow(),
      _updated_at: Date.now()
    };
    localStorage.setItem(DB.PREFIX + 'users', JSON.stringify([defaultUser]));

    ['products','categories','customers','suppliers','invoices','invoiceItems',
     'purchases','purchaseItems','payments','stockMovements','shifts','auditLog',
     'inventorySessions','inventoryItems','changelog','expenses','reservations','returns'
    ].forEach(k => {
      localStorage.setItem(DB.PREFIX + k, '[]');
    });

    DB.setObj('mode', { current: null, host: null });
    DB.setObj('counters', { invoice: 0, purchase: 0, reservation: 0 });

    console.log('✅ Boutik v4: قاعدة البيانات جاهزة');
  } catch (e) {
    console.error('❌ initDB error:', e);
  }
}

function audit(action, details = '') {
  try {
    const log = DB.get('auditLog');
    log.push({
      id: __safeUuid(),
      action, details,
      user: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.username : 'system',
      created_at: __safeNow()
    });
    if (log.length > 2000) log.splice(0, log.length - 2000);
    localStorage.setItem(DB.PREFIX + 'auditLog', JSON.stringify(log));
  } catch (e) {
    console.error('audit error:', e);
  }
}

initDB();
