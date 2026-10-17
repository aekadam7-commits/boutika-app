/* ============================================================
   Boutika — تخزين غير محدود عمليًا (IndexedDB)
   ------------------------------------------------------------
   بدل localStorage (سقف ~5MB) تُحفظ بيانات boutik_v4_* في IndexedDB
   (السقف = جزء كبير من مساحة القرص الحرة).
   الفكرة: كل الوحدات القديمة تستعمل localStorage بشكل متزامن، لذلك:
     1) نحمّل كل البيانات من IndexedDB إلى الذاكرة قبل تشغيل التطبيق
     2) نستبدل window.localStorage بوسيط (Proxy) يقرأ من الذاكرة فورًا
        ويكتب إلى IndexedDB في الخلفية (مجمّعة)
   ولا تتغير أي وحدة قديمة. يبقى معرّف الجهاز والترخيص والتجربة في localStorage الحقيقي.
   إن لم يتوفر IndexedDB يستمر التطبيق بـ localStorage كالمعتاد.
   ============================================================ */
(function () {
  'use strict';

  const PREFIX = 'boutik_v4_';
  const KEEP_REAL = [PREFIX + 'device_id', PREFIX + 'license', PREFIX + 'trial', PREFIX + 'lastseen'];   // تبقى في localStorage الحقيقي
  const DB_NAME = 'boutika';
  const STORE = 'kv';
  const FLUSH_MS = 120;

  const real = window.localStorage;
  const mem = new Map();               // المفتاح -> نص JSON
  const dirty = new Set();             // مفاتيح تنتظر الكتابة
  let db = null;
  let flushTimer = null;
  let flushing = null;
  let failedOnce = false;
  let loadFired = false;
  window.addEventListener('load', () => { loadFired = true; });

  const managed = k => typeof k === 'string' && k.startsWith(PREFIX) && KEEP_REAL.indexOf(k) === -1;

  // خطاف الكتابة: يعرف سجل المزامنة بكل تغيير في أي جدول مهما كانت الوحدة التي كتبته
  window.BoutikaHook = window.BoutikaHook || { onWrite: null };
  function notify(k, oldV, newV) {
    const h = window.BoutikaHook;
    if (h && typeof h.onWrite === 'function') { try { h.onWrite(k, oldV, newV); } catch (e) { console.warn('BoutikaHook:', e); } }
  }

  /* ---------- IndexedDB ---------- */
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }
  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('tx aborted'));
    });
  }
  function readAll() {
    return new Promise((resolve, reject) => {
      const out = new Map();
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) { out.set(c.key, c.value); c.continue(); } else resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /* ---------- الكتابة في الخلفية ---------- */
  function schedule(k) {
    dirty.add(k);
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  }
  function flush() {
    clearTimeout(flushTimer); flushTimer = null;
    if (!db || !dirty.size) return flushing || Promise.resolve();
    const keys = Array.from(dirty); dirty.clear();
    const run = () => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      keys.forEach(k => { if (mem.has(k)) os.put(mem.get(k), k); else os.delete(k); });
      return txDone(tx);
    };
    flushing = (flushing || Promise.resolve()).then(run).catch(err => {
      keys.forEach(k => dirty.add(k));                       // أعد المحاولة لاحقًا
      console.error('Boutika IDB write failed:', err);
      if (!failedOnce) {
        failedOnce = true;
        const full = err && /quota/i.test(String(err.name || err));
        try { alert(full ? '⚠️ مساحة التخزين ممتلئة. احذف بيانات قديمة أو حرّر مساحة في الجهاز.'
                         : '⚠️ تعذّر حفظ البيانات. أعد تشغيل التطبيق وأنشئ نسخة احتياطية.'); } catch (e) {}
      }
      if (!flushTimer) flushTimer = setTimeout(flush, 3000);
    });
    return flushing;
  }
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  /* ---------- وسيط localStorage ---------- */
  function realKeys() {
    const ks = [];
    for (let i = 0; i < real.length; i++) { const k = real.key(i); if (!managed(k)) ks.push(k); }
    return ks;
  }
  function allKeys() { return realKeys().concat(Array.from(mem.keys())); }

  const methods = {
    getItem(k) { k = String(k); return managed(k) ? (mem.has(k) ? mem.get(k) : null) : real.getItem(k); },
    setItem(k, v) { k = String(k); v = String(v); if (managed(k)) { const o = mem.get(k); mem.set(k, v); schedule(k); notify(k, o, v); } else real.setItem(k, v); },
    removeItem(k) { k = String(k); if (managed(k)) { if (mem.has(k)) { const o = mem.get(k); mem.delete(k); schedule(k); notify(k, o, undefined); } } else real.removeItem(k); },
    key(i) { const a = allKeys(); return i >= 0 && i < a.length ? a[i] : null; },
    clear() { Array.from(mem.keys()).forEach(k => { mem.delete(k); schedule(k); }); real.clear(); }
  };

  function makeProxy() {
    return new Proxy({}, {
      get(_, p) {
        if (p === 'length') return allKeys().length;
        if (typeof p === 'symbol') return undefined;
        if (Object.prototype.hasOwnProperty.call(methods, p)) return methods[p];
        const v = methods.getItem(p);
        return v === null ? undefined : v;
      },
      set(_, p, v) { if (typeof p === 'string') methods.setItem(p, v); return true; },
      deleteProperty(_, p) { if (typeof p === 'string') methods.removeItem(p); return true; },
      has(_, p) { return typeof p === 'string' && (Object.prototype.hasOwnProperty.call(methods, p) || methods.getItem(p) !== null); },
      ownKeys() { return allKeys(); },
      getOwnPropertyDescriptor(_, p) {
        if (typeof p !== 'string') return undefined;
        const v = methods.getItem(p);
        return v === null ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
      }
    });
  }

  function installProxy() {
    Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: () => proxy });
  }
  const proxy = makeProxy();

  /* ---------- الإقلاع: تحميل + ترحيل ثم تشغيل بقية السكربتات ---------- */
  async function init() {
    if (!window.indexedDB) throw new Error('no indexedDB');
    db = await openDB();
    const stored = await readAll();
    stored.forEach((v, k) => mem.set(k, v));

    // ترحيل لمرة واحدة من localStorage القديم
    const legacy = [];
    for (let i = 0; i < real.length; i++) { const k = real.key(i); if (managed(k)) legacy.push(k); }
    if (legacy.length) {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      legacy.forEach(k => {
        // ما في IndexedDB أحدث (كُتب بعد ترحيل سابق)؛ لا نكتب فوقه
        if (!mem.has(k)) { const v = real.getItem(k); mem.set(k, v); os.put(v, k); }
      });
      await txDone(tx);                                       // لا نحذف القديم قبل نجاح الكتابة
      legacy.forEach(k => real.removeItem(k));
      console.log('Boutika: رُحّلت ' + legacy.length + ' مفتاحًا إلى IndexedDB');
    }
    installProxy();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  }

  function loadApp() {
    const list = Array.prototype.slice.call(document.querySelectorAll('script[type="boutika/defer"]'));
    if (!list.length) return finish();
    let left = list.length;
    list.forEach(old => {
      const s = document.createElement('script');
      s.src = old.getAttribute('src');
      s.async = false;                                        // يحافظ على ترتيب التنفيذ
      s.onload = s.onerror = () => { if (--left === 0) finish(); };
      old.parentNode.replaceChild(s, old);
    });
  }
  function finish() {
    // السكربتات أُضيفت بعد انتهاء تحميل الصفحة: شغّل مستمعي load يدويًا
    if (loadFired || document.readyState === 'complete') window.dispatchEvent(new Event('load'));
  }

  window.BoutikaStore = {
    engine: 'localStorage',
    flush,
    async estimate() {
      const e = (navigator.storage && navigator.storage.estimate) ? await navigator.storage.estimate() : {};
      return { used: e.usage || 0, quota: e.quota || 0, keys: mem.size };
    }
  };

  init().then(() => { window.BoutikaStore.engine = 'indexeddb'; }, err => {
    console.warn('Boutika: IndexedDB غير متاح، نستمر بـ localStorage', err);
    try {
      const so = Storage.prototype.setItem, ro = Storage.prototype.removeItem;
      Storage.prototype.setItem = function (k, v) {
        const key = String(k), isMine = this === real && managed(key);
        const o = isMine ? this.getItem(key) : null;
        so.call(this, k, v);
        if (isMine) notify(key, o === null ? undefined : o, String(v));
      };
      Storage.prototype.removeItem = function (k) {
        const key = String(k), isMine = this === real && managed(key);
        const o = isMine ? this.getItem(key) : null;
        ro.call(this, k);
        if (isMine && o !== null) notify(key, o, undefined);
      };
    } catch (e) {}
  }).then(loadApp);
})();
