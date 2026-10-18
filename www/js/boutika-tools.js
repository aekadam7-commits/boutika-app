/* ============================================================
   Boutika — أدوات إضافية (ويندوز + أندرويد فقط؛ المتصفح العادي لا يتأثر)
   1) تنسيق شريط التنقل لويندوز
   2) نسخة احتياطية: تحميل / رفع ملف
   3) التحكم بالخادم: تشغيل / إيقاف / إعادة تشغيل
   ملف مستقل: لا يعدّل أي ملف أساسي في الواجهة.
   ============================================================ */
(function () {
  const cap = window.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const desktop = window.BoutikDesktop && window.BoutikDesktop.serverStatus ? window.BoutikDesktop : null;
  if (!desktop && !isNative) return;

  const plugin = n => (cap && cap.Plugins && cap.Plugins[n]) || null;
  const nodePlugin = () => plugin('CapacitorNodeJS') || plugin('NodeJS');
  const BASE = 'http://localhost:8787';   // localhost دائمًا: عمليات الإدارة مسموحة من الجهاز نفسه
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const say = m => { if (typeof toast === 'function') toast(m); };

  /* ---------- 1) شريط التنقل: كل الأقسام ظاهرة على ويندوز ---------- */
  if (desktop) {
    const st = document.createElement('style');
    st.textContent = '.is-desktop nav{flex-wrap:wrap;overflow-x:visible}';
    document.head.appendChild(st);
    document.documentElement.classList.add('is-desktop');
  }

  /* ---------- أدوات مشتركة ---------- */
  function needHost() {
    const m = (typeof DB !== 'undefined' && DB.mode) ? DB.mode() : {};
    if (m.current !== 'host') { alert('هذه الميزة متاحة على الجهاز المضيف فقط.'); return false; }
    return true;
  }
  async function ping() {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 1500);
      const r = await fetch(BASE + '/api/ping', { signal: c.signal, cache: 'no-store' });
      clearTimeout(t);
      return r.ok;
    } catch (_) { return false; }
  }
  async function waitFor(state, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if ((await ping()) === state) return true; await sleep(400); }
    return false;
  }

  /* ---------- 2) نسخة احتياطية ---------- */
  // يعيد true إذا حُفظ الملف، وfalse إذا ألغى المستخدم
  async function saveFile(name, text) {
    if (desktop && desktop.saveFile) {                       // ويندوز: نافذة "حفظ باسم"
      const r = await desktop.saveFile(name, text);
      return !r.canceled;
    }
    const svc = plugin('BoutikaService');
    if (isNative && svc && svc.saveFile) {                   // أندرويد: نافذة "حفظ باسم" (اختيار المجلد)
      try { await svc.saveFile({ name, data: text }); return true; }
      catch (e) { if (/cancel/i.test(String(e && (e.message || e)))) return false; throw e; }
    }
    const FS = plugin('Filesystem'), SH = plugin('Share');
    if (isNative && FS && SH) {                              // احتياطي: نافذة المشاركة
      const w = await FS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
      await SH.share({ title: name, text: T('نسخة احتياطية') + ' Boutika', url: w.uri, dialogTitle: T('حفظ النسخة الاحتياطية') });
      return true;
    }
    const file = new File([text], name, { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return true;
  }

  async function downloadBackup() {
    if (!needHost()) return;
    try {
      const r = await (await fetch(BASE + '/api/backup', { method: 'POST' })).json();
      if (!r.ok) throw new Error(r.error || 'فشل إنشاء النسخة');
      const text = await (await fetch(BASE + '/api/backups/' + encodeURIComponent(r.name))).text();
      if (await saveFile(r.name, text)) say('✅ تم حفظ النسخة');
    } catch (e) {
      if (e && /cancel|dismiss/i.test(String(e.message || e))) return;
      alert('تعذر تحميل النسخة. تأكد أن الخادم يعمل.\n' + (e.message || e));
    }
  }

  async function restoreFrom(name, text) {
    if (!needHost()) return;
    try {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.entries)) throw new Error('ملف غير صالح: ليس نسخة احتياطية من Boutika');
      if (!confirm('سيتم استعادة النسخة «' + name + '» (' + data.entries.length + ' سجل). سيحفظ التطبيق نسخة أمان قبل الاستعادة. متابعة؟')) return;
      const r = await fetch(BASE + '/api/backup/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'فشلت الاستعادة');
      alert('تمت استعادة البيانات. سيُعاد تحميل التطبيق.');
      location.reload();
    } catch (e) {
      alert('تعذر رفع النسخة: ' + (e.message || e));
    }
  }

  // اختيار الملف من أي مسار: نافذة ويندوز / منتقي ملفات أندرويد
  async function pickAndRestore(fileInput) {
    if (!needHost()) return;
    if (desktop && desktop.openFile) {
      const r = await desktop.openFile();
      if (!r.canceled) await restoreFrom(r.name, r.text);
    } else {
      fileInput.click();
    }
  }
  async function uploadFromInput(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (file) await restoreFrom(file.name, await file.text());
  }

  /* ---------- 3) التحكم بالخادم ---------- */
  async function isRunning() {
    if (desktop) { try { return !!(await desktop.serverStatus()).running; } catch (_) { return false; } }
    return ping();
  }
  async function refreshStatus() {
    const el = $('bkServerStatus');
    if (!el) return;
    el.textContent = (await isRunning()) ? '🟢 الخادم يعمل' : '🔴 الخادم متوقف';
  }
  async function nativeControl(action) {
    const n = nodePlugin();
    if (!n) throw new Error('مكوّن Node.js غير متوفر');
    try { await n.whenReady(); } catch (_) {}
    await n.send({ eventName: 'server-control', args: [{ action }] });
    if (action === 'stop') { if (!(await waitFor(false, 8000))) throw new Error('لم يتوقف الخادم'); }
    else {
      if (action === 'restart') await sleep(1500);
      if (!(await waitFor(true, 10000))) throw new Error('لم يبدأ الخادم');
    }
  }
  async function serverControl(action) {
    if (!needHost()) return;
    if (action === 'stop' && !confirm('إيقاف الخادم سيقطع اتصال الأجهزة الأخرى حتى تعيد تشغيله. متابعة؟')) return;
    if (action === 'restart' && !confirm('سيُعاد تشغيل الخادم وقد ينقطع اتصال الأجهزة لثوانٍ. متابعة؟')) return;
    const el = $('bkServerStatus');
    if (el) el.textContent = '⏳ جارٍ التنفيذ…';
    try {
      if (desktop) {
        if (action === 'stop') await desktop.stopServer();
        else if (action === 'start') await desktop.startServer();
        else await desktop.restartServer();
      } else {
        await nativeControl(action);
      }
      say(action === 'stop' ? '⏹️ تم إيقاف الخادم' : '✅ الخادم يعمل');
    } catch (e) {
      alert('تعذر تنفيذ العملية: ' + (e.message || e));
    }
    refreshStatus();
  }

  /* ---------- الواجهة: بطاقتان في آخر صفحة الإعدادات ---------- */
  function inject() {
    const tab = $('tab-settings');
    if (!tab || $('bkToolsCard')) return;
    const box = document.createElement('div');
    box.id = 'bkToolsCard';
    box.innerHTML =
      '<div class="card"><h3>💾 النسخ الاحتياطي (ملف)</h3>' +
      '<p class="small">حمّل نسخة من كل البيانات كملف، أو ارفع ملف نسخة سابقة لاستعادتها. يحفظ التطبيق نسخة أمان قبل أي استعادة.</p>' +
      '<button class="btn btn-primary btn-block" id="bkDownload">⬇️ تحميل نسخة احتياطية</button>' +
      '<button class="btn btn-warning btn-block" id="bkUpload" style="margin-top:6px">⬆️ رفع نسخة احتياطية</button>' +
      '<input type="file" id="bkFile" style="display:none"></div>' +
      '<div class="card"><h3>🖥️ الخادم</h3>' +
      '<div id="bkServerStatus" class="small" style="margin:8px 0">—</div>' +
      '<button class="btn btn-success btn-block" id="bkStart">▶️ تشغيل الخادم</button>' +
      '<button class="btn btn-warning btn-block" id="bkRestart" style="margin-top:6px">🔄 إعادة تشغيل / تحديث</button>' +
      '<button class="btn btn-danger btn-block" id="bkStop" style="margin-top:6px">⏹️ إيقاف الخادم</button></div>';
    tab.appendChild(box);
    const file = $('bkFile');
    if (!isNative) file.accept = '.json,application/json';
    $('bkDownload').onclick = downloadBackup;
    $('bkUpload').onclick = () => pickAndRestore(file);
    file.onchange = () => uploadFromInput(file);
    $('bkStart').onclick = () => serverControl('start');
    $('bkRestart').onclick = () => serverControl('restart');
    $('bkStop').onclick = () => serverControl('stop');
    // حدّث الحالة كلما فُتحت صفحة الإعدادات
    new MutationObserver(() => { if (!tab.classList.contains('hidden')) refreshStatus(); })
      .observe(tab, { attributes: true, attributeFilter: ['class'] });
    refreshStatus();
  }
  inject();
})();
