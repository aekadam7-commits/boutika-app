/* ============================================================
   Boutik — الأمان: تشفير كلمات السر + الصلاحيات + تقييد المحاولات
   ------------------------------------------------------------
   - كلمة السر لا تُخزَّن أبدًا كنص: PBKDF2-HMAC-SHA256 + ملح عشوائي لكل مستخدم.
   - يستعمل Web Crypto عند توفره، وإلا (مثل http://192.168.x.x على الشبكة
     المحلية حيث crypto.subtle غير متاح) يستعمل تنفيذًا JS يعطي نفس الناتج تمامًا،
     فيبقى الهاش صالحًا على كل الأجهزة.
   - الصلاحيات: منع بالرفض افتراضيًا (deny by default) + حراسة الإجراءات الحساسة،
     وليس فقط إخفاء التبويبات.
   ============================================================ */

const Security = (() => {
  const ALGO = 'pbkdf2-sha256';
  const ITER = 100000;                 // يُخزَّن مع كل مستخدم فيمكن رفعه لاحقًا دون كسر القديم
  const SALT_BYTES = 16;
  const te = new TextEncoder();

  /* ---------- SHA-256 بلغة JS (احتياطي) ---------- */
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const IV = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const W = new Uint32Array(64);
  const ror = (x, n) => (x >>> n) | (x << (32 - n));

  function compress(st, b, o) {
    for (let i = 0; i < 16; i++) { const j = o + i * 4; W[i] = (b[j] << 24) | (b[j+1] << 16) | (b[j+2] << 8) | b[j+3]; }
    for (let i = 16; i < 64; i++) {
      const x = W[i-15], y = W[i-2];
      W[i] = (W[i-16] + (ror(x,7) ^ ror(x,18) ^ (x >>> 3)) + W[i-7] + (ror(y,17) ^ ror(y,19) ^ (y >>> 10))) | 0;
    }
    let a = st[0], bb = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (ror(e,6) ^ ror(e,11) ^ ror(e,25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((ror(a,2) ^ ror(a,13) ^ ror(a,22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    st[0] = (st[0] + a) | 0; st[1] = (st[1] + bb) | 0; st[2] = (st[2] + c) | 0; st[3] = (st[3] + d) | 0;
    st[4] = (st[4] + e) | 0; st[5] = (st[5] + f) | 0; st[6] = (st[6] + g) | 0; st[7] = (st[7] + h) | 0;
  }
  function stateToBytes(st, out) {
    for (let i = 0; i < 8; i++) { out[i*4] = st[i] >>> 24; out[i*4+1] = (st[i] >>> 16) & 255; out[i*4+2] = (st[i] >>> 8) & 255; out[i*4+3] = st[i] & 255; }
    return out;
  }
  // يكمل التجزئة من حالة معيّنة؛ prefixLen = عدد البايتات التي سبق ضغطها
  function finish(state, msg, prefixLen) {
    const st = Int32Array.from(state);
    const total = prefixLen + msg.length;
    const padded = new Uint8Array(Math.ceil((msg.length + 9) / 64) * 64);
    padded.set(msg); padded[msg.length] = 0x80;
    const bits = total * 8, dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(bits / 4294967296));
    dv.setUint32(padded.length - 4, bits >>> 0);
    for (let o = 0; o < padded.length; o += 64) compress(st, padded, o);
    return stateToBytes(st, new Uint8Array(32));
  }
  const sha256 = msg => finish(IV, msg, 0);

  async function pbkdf2Js(pw, salt, iter) {
    let key = pw.length > 64 ? sha256(pw) : pw;
    const ik = new Uint8Array(64).fill(0x36), ok = new Uint8Array(64).fill(0x5c);
    for (let i = 0; i < key.length; i++) { ik[i] ^= key[i]; ok[i] ^= key[i]; }
    const istate = Int32Array.from(IV), ostate = Int32Array.from(IV);
    compress(istate, ik, 0); compress(ostate, ok, 0);

    const s1 = new Uint8Array(salt.length + 4); s1.set(salt); s1[s1.length - 1] = 1;
    let u = finish(ostate, finish(istate, s1, 64), 64);
    const t = Uint8Array.from(u);

    const blk = new Uint8Array(64), st = new Int32Array(8);
    blk[32] = 0x80; blk[62] = 0x03;                 // طول الرسالة = (64+32)*8 = 768 بت
    for (let i = 1; i < iter; i++) {
      blk.set(u);
      st.set(istate); compress(st, blk, 0); stateToBytes(st, u);
      blk.set(u);
      st.set(ostate); compress(st, blk, 0); stateToBytes(st, u);
      for (let j = 0; j < 32; j++) t[j] ^= u[j];
      if (i % 5000 === 0) await new Promise(r => setTimeout(r, 0));   // لا نجمّد الواجهة
    }
    return t;
  }

  /* ---------- أدوات ---------- */
  const toHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  function fromHex(h) {
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  function safeEqual(a, b) {                          // مقارنة بزمن ثابت
    a = String(a || ''); b = String(b || '');
    let d = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return d === 0;
  }

  async function derive(password, saltBytes, iter) {
    const pw = te.encode(String(password).normalize('NFC'));
    const c = (typeof crypto !== 'undefined') ? crypto : null;
    if (c && c.subtle && c.subtle.importKey) {
      try {
        const k = await c.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
        return new Uint8Array(await c.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: iter }, k, 256));
      } catch (_) { /* نرجع للتنفيذ البديل */ }
    }
    return pbkdf2Js(pw, saltBytes, iter);
  }

  function randomSalt() {
    if (typeof crypto === 'undefined' || !crypto.getRandomValues) throw new Error('لا يوجد مولّد أرقام عشوائية آمن في هذا المتصفح');
    return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  }

  /* ---------- API ---------- */
  async function hashPassword(password) {
    const salt = randomSalt();
    const hash = await derive(password, salt, ITER);
    return { pass_algo: ALGO, pass_iter: ITER, pass_salt: toHex(salt), pass_hash: toHex(hash) };
  }

  async function verifyPassword(password, user) {
    if (!user || !user.pass_hash || !user.pass_salt) return false;
    const hash = await derive(password, fromHex(user.pass_salt), +user.pass_iter || ITER);
    return safeEqual(toHex(hash), user.pass_hash);
  }

  const hasHash = u => !!(u && u.pass_hash && u.pass_salt);
  const isLegacy = u => !!(u && !u.pass_hash && typeof u.password === 'string');

  /* ---------- تقييد محاولات الدخول (لكل جهاز) ---------- */
  const GUARD_KEY = 'boutika_login_guard';
  const guard = {
    _read() { try { return JSON.parse(localStorage.getItem(GUARD_KEY) || '{}'); } catch (_) { return {}; } },
    remainingMs() { const g = this._read(); return Math.max(0, (g.until || 0) - Date.now()); },
    fail() {
      const g = this._read(); g.n = (g.n || 0) + 1;
      if (g.n >= 5) g.until = Date.now() + Math.min(15 * 60000, 30000 * Math.pow(2, g.n - 5));
      try { localStorage.setItem(GUARD_KEY, JSON.stringify(g)); } catch (_) {}
    },
    reset() { try { localStorage.removeItem(GUARD_KEY); } catch (_) {} }
  };

  /* ---------- ترحيل المستخدمين القدامى (نص صريح ← هاش) ---------- */
  let migrating = false;
  async function migrateUsers() {
    if (migrating) return 0;
    migrating = true;
    let n = 0;
    try {
      const mode = (DB.mode() || {});
      const isClient = mode.current === 'client';
      const users = DB.users();
      if (!users.some(isLegacy)) return 0;
      const key = DB.PREFIX + 'users';
      let changedSynced = false;

      for (const u of users) {
        if (!isLegacy(u)) continue;
        const placeholder = u._updated_at === 0;       // المستخدم الافتراضي المحلي: لا يُزامَن
        if (isClient && !placeholder) continue;        // العميل ينتظر ترحيل المضيف حتى لا تتضارب الأملاح
        if (u.password === '1234') u.must_change = true;      // كلمة السر الافتراضية: يجب تغييرها
        Object.assign(u, await hashPassword(u.password));
        delete u.password;
        if (!placeholder) { u._updated_at = Date.now(); changedSynced = true; }
        n++;
      }
      if (n) {
        localStorage.setItem(key, JSON.stringify(users));
        scrubChangeLog();
        if (changedSynced && !isClient) setTimeout(scrubServerHistory, 6000);
      }
    } catch (e) {
      console.error('migrateUsers:', e);
    } finally { migrating = false; }
    return n;
  }

  // إزالة كلمات السر النصية القديمة من سجل المزامنة المحلي
  function scrubChangeLog() {
    try {
      const k = DB.PREFIX + 'changelog';
      const log = JSON.parse(localStorage.getItem(k) || '[]');
      let touched = false;
      log.forEach(e => { if (e && e.table === 'users' && e.data && 'password' in e.data) { delete e.data.password; touched = true; } });
      if (touched) {
        if (typeof ChangeLog !== 'undefined') ChangeLog._applying = true;
        try { localStorage.setItem(k, JSON.stringify(log)); } finally { if (typeof ChangeLog !== 'undefined') ChangeLog._applying = false; }
      }
    } catch (_) {}
  }

  // المضيف: بعد وصول الصفوف المُشفَّرة للخادم نضغط السجل فتختفي النسخ القديمة التي فيها نص صريح
  async function scrubServerHistory() {
    try {
      if (typeof Sync !== 'undefined' && Sync.flush) await Sync.flush();
      if (typeof ChangeLog !== 'undefined' && ChangeLog.pending().some(e => e.table === 'users')) return setTimeout(scrubServerHistory, 6000);
      const base = (typeof Net !== 'undefined' && Net.baseUrl && Net.baseUrl()) || 'http://localhost:8787';
      await fetch(base + '/api/compact', { method: 'POST' });
    } catch (_) {}
  }

  return { hashPassword, verifyPassword, hasHash, isLegacy, safeEqual, migrateUsers, guard, ITER, ALGO, _pbkdf2Js: pbkdf2Js, _toHex: toHex };
})();

/* ============================================================
   الصلاحيات — رفض افتراضي: أي دور أو صلاحية غير معرّفة = ممنوع
   ============================================================ */
const Perms = {
  // أيّ الأدوار يرى كل تبويب (نفس القواعد السابقة بدون تغيير)
  TAB_ROLES: {
    dashboard:    ['admin', 'manager', 'cashier'],
    pos:          ['admin', 'manager', 'cashier'],
    products:     ['admin', 'manager', 'stock'],
    customers:    ['admin', 'manager', 'cashier'],
    suppliers:    ['admin', 'manager', 'stock'],
    purchases:    ['admin', 'manager', 'stock'],
    invoices:     ['admin', 'manager', 'cashier'],
    inventory:    ['admin', 'manager', 'stock'],
    expenses:     ['admin', 'manager'],
    reservations: ['admin', 'manager', 'cashier'],
    reports:      ['admin', 'manager'],
    settings:     ['admin'],
    users:        ['admin'],
    contact:      ['admin', 'manager', 'cashier', 'stock']
  },
  // الإجراءات الحساسة (تُفرَض عند التنفيذ لا عند العرض فقط)
  ACTION_ROLES: {
    'users.manage':    ['admin'],
    'settings.edit':   ['admin'],
    'backup.restore':  ['admin'],
    'product.delete':  ['admin', 'manager', 'stock'],
    'category.delete': ['admin', 'manager', 'stock'],
    'supplier.delete': ['admin', 'manager', 'stock'],
    'customer.delete': ['admin', 'manager'],
    'expense.delete':  ['admin', 'manager']
  },
  // اسم الدالة العامة ← الصلاحية المطلوبة
  GUARDED: {
    openUserModal: 'users.manage', saveUser: 'users.manage', deleteUser: 'users.manage',
    saveShopSettings: 'settings.edit', saveInvoiceSettings: 'settings.edit',
    restoreLatestBackup: 'backup.restore',
    deleteProduct: 'product.delete', deleteCategory: 'category.delete',
    deleteSupplier: 'supplier.delete', deleteCustomer: 'customer.delete',
    deleteExpense: 'expense.delete'
  },

  // الدور الحالي يُقرأ طازجًا من قاعدة البيانات: تعديل الدور أو حذف المستخدم من جهاز آخر يسري فورًا
  role() {
    if (typeof currentUser === 'undefined' || !currentUser) return null;
    const u = DB.users().find(x => x.id === currentUser.id);
    return u ? u.role : null;
  },
  canTab(tab) { const r = this.role(); return !!r && (this.TAB_ROLES[tab] || []).includes(r); },
  can(action) { const r = this.role(); return !!r && (this.ACTION_ROLES[action] || []).includes(r); },

  deny() { if (typeof toast === 'function') toast('⛔ ليست لديك صلاحية لهذا الإجراء', true); },

  install() {
    Object.keys(this.GUARDED).forEach(name => {
      const orig = window[name], perm = this.GUARDED[name];
      if (typeof orig !== 'function' || orig.__guarded) return;
      const wrapped = function () {
        if (!Perms.can(perm)) { Perms.deny(); return; }
        return orig.apply(this, arguments);
      };
      wrapped.__guarded = true;
      window[name] = wrapped;
    });
  }
};
