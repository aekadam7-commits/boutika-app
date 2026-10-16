/* ============================================================
   Boutika — ربط الأوضاع (مضيف / فرعي / مستقل) بالسيرفر المدمج
   - أندرويد: Node.js داخل التطبيق + خدمة أمامية (Foreground Service)
   - حاسوب: Electron يشغّل boutika-server عبر IPC
   - المتصفح العادي: لا شيء يتغيّر
   يُحمَّل بعد app.js ولا يعدّل أي ملف قديم.
   ============================================================ */
(function () {
  const cap = window.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const desktop = window.BoutikDesktop && window.BoutikDesktop.startServer ? window.BoutikDesktop : null;
  const plugin = n => (cap && cap.Plugins && cap.Plugins[n]) || null;
  let runtimeStarted = false;

  /* ---------- 1) بطاقة "جهاز مستقل" ---------- */
  function addStandaloneCard() {
    const box = document.querySelector('.mode-cards');
    if (!box || box.querySelector('[data-standalone]')) return;
    const b = document.createElement('button');
    b.className = 'mode-card';
    b.setAttribute('data-standalone', '1');
    b.innerHTML = '<div class="mode-icon">💼</div><div class="mode-name">جهاز مستقل</div>' +
                  '<div class="mode-desc">يعمل وحده دون شبكة أو سيرفر</div>';
    b.onclick = function () {
      DB.setObj('mode', { current: 'host', host: null, standalone: true });
      if (typeof Net !== 'undefined' && Net.current) Net.current();
      if (typeof toast === 'function') toast('✅ تم اختيار الوضع: مستقل');
      afterModeChosen();
    };
    box.appendChild(b);
    box.style.gridTemplateColumns = window.innerWidth > 700 ? '1fr 1fr 1fr' : '';
  }

  /* ---------- 2) المستقل لا يفتح اتصال مزامنة ---------- */
  if (typeof Sync !== 'undefined' && Sync.start) {
    const origStart = Sync.start.bind(Sync);
    Sync.start = function () {
      if (DB.mode().standalone) return;
      return origStart();
    };
  }

  /* ---------- 3) قائمة عناوين أوسع عند البحث عن مضيف ---------- */
  if (typeof Net !== 'undefined') {
    Net.localCandidates = function () {
      const list = [];
      ['192.168.1.', '192.168.0.'].forEach(p => {
        for (let i = 1; i <= 60; i++) list.push(p + i);
        for (let i = 100; i <= 120; i++) list.push(p + i);
      });
      return list;
    };
  }

  /* ---------- 4) شارة تعرض عنوان السيرفر ليتصل به الآخرون ---------- */
  function showPill(info) {
    if (!info) return;
    const url = (info.urls && info.urls[0]) || ('http://localhost:' + (info.port || 8787));
    let el = document.getElementById('boutikaPill');
    if (!el) {
      el = document.createElement('div');
      el.id = 'boutikaPill';
      el.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:9999;background:#1e3c72;color:#fff;' +
        'padding:6px 12px;border-radius:16px;font:12px sans-serif;direction:ltr;opacity:.9;cursor:pointer';
      el.title = 'اضغط للنسخ';
      el.onclick = function () {
        try { navigator.clipboard.writeText(el.dataset.url); if (typeof toast === 'function') toast('📋 تم نسخ العنوان'); } catch (e) {}
      };
      document.body.appendChild(el);
    }
    el.dataset.url = url;
    el.textContent = '🖥️ ' + url.replace('http://', '');
  }

  /* ---------- 5) تشغيل السيرفر المدمج عند وضع المضيف ---------- */
  async function startRuntime() {
    const m = DB.mode();
    if (m.current !== 'host' || m.standalone || runtimeStarted) return;
    runtimeStarted = true;
    try {
      if (desktop) {
        showPill(await desktop.startServer());
      } else if (isNative) {
        const node = plugin('CapacitorNodeJS') || plugin('NodeJS');
        const svc = plugin('BoutikaService');
        if (!node) { console.warn('Node.js plugin missing'); return; }
        try { if (svc) await svc.start(); } catch (e) { console.warn('service', e); }
        await node.addListener('server-ready', ev => showPill(ev && ev.args && ev.args[0]));
        await node.start({});
        try { await node.whenReady(); node.send({ eventName: 'get-info', args: [] }); } catch (e) {}
        try { if (svc && !localStorage.getItem('boutika_battery_asked')) {
          localStorage.setItem('boutika_battery_asked', '1');
          svc.ignoreBattery();
        } } catch (e) {}
      }
    } catch (e) {
      runtimeStarted = false;
      console.error('Boutika runtime:', e);
    }
  }

  /* ---------- 6) التقاط نقاط الدخول الموجودة ---------- */
  if (typeof window.afterModeChosen === 'function') {
    const orig = window.afterModeChosen;
    window.afterModeChosen = function () {
      const r = orig.apply(this, arguments);
      startRuntime();
      return r;
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addStandaloneCard);
  else addStandaloneCard();
})();
