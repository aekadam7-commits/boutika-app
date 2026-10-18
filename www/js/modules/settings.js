/* ============================================================
   Boutik v4 — الإعدادات (مع إدارة البيانات + إعدادات الماسح)
   ============================================================ */

function renderSettings() {
  const s = DB.settings();
  const el = id => document.getElementById(id);
  if (el('setShopName')) el('setShopName').value = s.shopName || '';
  if (el('setShopAddress')) el('setShopAddress').value = s.shopAddress || '';
  if (el('setShopPhone')) el('setShopPhone').value = s.shopPhone || '';
  if (el('setShopRC')) el('setShopRC').value = s.shopRC || '';
  if (el('setInvPrefix')) el('setInvPrefix').value = s.invPrefix || 'INV-';
  if (el('setPurPrefix')) el('setPurPrefix').value = s.purPrefix || 'PUR-';
  if (el('setCurrency')) el('setCurrency').value = s.currency || 'دج';
  if (el('setTaxRate')) el('setTaxRate').value = s.taxRate || 0;
  if (el('setExpiryDays')) el('setExpiryDays').value = s.expiryDays || 30;
  if (el('setPaperSize')) el('setPaperSize').value = s.paperSize || '58';

  if (el('setScannerBeep')) el('setScannerBeep').checked = s.scannerBeep !== false;
  if (el('setScannerVibrate')) el('setScannerVibrate').checked = s.scannerVibrate !== false;
  if (el('setScannerAvoidDup')) el('setScannerAvoidDup').checked = s.scannerAvoidDuplicate !== false;
  if (el('setScannerUsb')) el('setScannerUsb').checked = s.scannerUsb !== false;

  refreshBackupRestoreStatus();

  const net = document.getElementById('netSettings');
  if (net) {
    const m = DB.mode();
    const devId = (typeof Device !== 'undefined' && Device.getId) ? Device.getId() : '—';
    net.innerHTML = `
      <div class="cart-item"><span>الوضع:</span><strong>${m.current === 'host' ? '🖥️ مضيف' : (m.current === 'client' ? '📱 عميل' : '—')}</strong></div>
      ${m.host ? '<div class="cart-item"><span>الخادم:</span><strong dir="ltr">' + m.host.ip + ':' + m.host.port + '</strong></div>' : ''}
      <div class="cart-item"><span>معرّف الجهاز:</span><strong dir="ltr" style="font-size:11px">${devId}</strong></div>
    `;
  }

}

function saveShopSettings() {
  const s = DB.settings();
  s.shopName = (document.getElementById('setShopName').value || '').trim();
  s.shopAddress = (document.getElementById('setShopAddress').value || '').trim();
  s.shopPhone = (document.getElementById('setShopPhone').value || '').trim();
  s.shopRC = (document.getElementById('setShopRC').value || '').trim();
  DB.setObj('settings', s);
  if (typeof loadShopName === 'function') loadShopName();
  toast('✅ تم الحفظ');
}

function saveInvoiceSettings() {
  const s = DB.settings();
  s.invPrefix = (document.getElementById('setInvPrefix').value || '').trim() || 'INV-';
  s.purPrefix = (document.getElementById('setPurPrefix').value || '').trim() || 'PUR-';
  s.currency = (document.getElementById('setCurrency').value || '').trim() || 'دج';
  s.taxRate = +document.getElementById('setTaxRate').value || 0;
  s.expiryDays = +document.getElementById('setExpiryDays').value || 30;
  DB.setObj('settings', s);
  toast('✅ تم الحفظ');
}

function savePrintSettings() {
  const s = DB.settings();
  s.paperSize = document.getElementById('setPaperSize').value || '58';
  DB.setObj('settings', s);
  toast('✅ تم حفظ حجم الورق: ' + s.paperSize);
}

function toggleDark() {
  const s = DB.settings();
  s.darkMode = !s.darkMode;
  DB.setObj('settings', s);
  applyDarkMode();
}

function applyDarkMode() {
  const s = DB.settings();
  document.body.classList.toggle('dark', !!s.darkMode);
}

function changeMode() {
  if (!confirm('تغيير الوضع سيعيد تشغيل التطبيق. متابعة؟')) return;
  DB.setObj('mode', { current: null, host: null });
  location.reload();
}

function showSyncStatus() {
  const log = DB.get('changelog');
  const pending = log.filter(e => !e.synced).length;
  openModal(`
    <h3>📊 حالة المزامنة</h3>
    <div class="cart-item"><span>إجمالي السجلات:</span><strong>${log.length}</strong></div>
    <div class="cart-item"><span>في الانتظار:</span><strong>${pending}</strong></div>
    <div class="cart-item"><span>الوضع:</span><strong>${DB.mode().current || '—'}</strong></div>
    <div class="cart-item"><span>الاتصال:</span><strong>${Sync.ws && Sync.ws.readyState === 1 ? '🟢 متصل' : '🔴 غير متصل'}</strong></div>
    <div class="cart-item"><span>الحالة:</span><strong>${Sync.state === 'synced' ? '✅ تمت المزامنة' : Sync.state === 'syncing' ? '🔄 جارٍ المزامنة' : Sync.state === 'conflict' ? '⚠️ تعارض' : '⏳ بانتظار الاتصال'}</strong></div>
    <div class="cart-item"><span>آخر مزامنة:</span><strong>${Sync.lastSyncAt ? new Date(Sync.lastSyncAt).toLocaleTimeString(BoutikI18n.locale()) : '—'}</strong></div>
    <div class="modal-actions"><button class="btn btn-danger" onclick="closeModal()">إغلاق</button></div>`);
}


async function refreshBackupRestoreStatus() {
  const el = document.getElementById('backupRestoreStatus');
  if (!el) return;
  const mode = (typeof DB !== 'undefined' && DB.mode) ? DB.mode() : {};
  if (mode.current !== 'host') {
    el.textContent = 'لأمان البيانات، افتح هذه الصفحة من الجهاز الرئيسي (المضيف) لتنفيذ الاستعادة.';
    return;
  }
  try {
    const response = await fetch(Net.baseUrl() + '/api/backups');
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error('تعذر قراءة النسخ');
    const list = Array.isArray(data.backups) ? data.backups : [];
    if (!list.length) { el.textContent = 'لا توجد نسخة احتياطية محفوظة بعد.'; return; }
    const latest = list[0];
    el.textContent = 'أحدث نسخة: ' + latest.replace(/^backup-/, '').replace(/\.json$/, '').replace(/T/, ' ') + ' — عدد النسخ: ' + list.length;
  } catch (e) {
    el.textContent = 'تعذر الاتصال بمجلد النسخ الاحتياطية. تأكد أن الخادم يعمل على الجهاز الرئيسي.';
  }
}

async function restoreLatestBackup() {
  const mode = (typeof DB !== 'undefined' && DB.mode) ? DB.mode() : {};
  if (mode.current !== 'host') { alert('نفّذ الاستعادة من الجهاز الرئيسي الذي يستضيف بيانات المحل.'); return; }
  const status = document.getElementById('backupRestoreStatus');
  try {
    const base = Net.baseUrl();
    const listResponse = await fetch(base + '/api/backups');
    const listData = await listResponse.json();
    if (!listResponse.ok || !listData.ok) throw new Error('تعذر الوصول إلى النسخ الاحتياطية');
    const list = Array.isArray(listData.backups) ? listData.backups : [];
    if (!list.length) { alert('لا توجد نسخة احتياطية لاستعادتها حتى الآن.'); return; }
    const name = list[0];
    const date = name.replace(/^backup-/, '').replace(/\.json$/, '').replace(/T/, ' ');
    if (!confirm('سيتم استعادة النسخة المؤرخة ' + date + '. قد تختفي التغييرات التي تمت بعدها. سيحفظ التطبيق نسخة أمان قبل الاستعادة. هل تريد المتابعة؟')) return;
    if (status) status.textContent = 'جارٍ استعادة البيانات، يرجى عدم إغلاق التطبيق...';
    const response = await fetch(base + '/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'فشلت الاستعادة');
    if (status) status.textContent = 'تمت الاستعادة بنجاح. جارٍ تحديث التطبيق...';
    alert('تمت استعادة البيانات. تم حفظ نسخة أمان باسم: ' + result.safetyBackup);
    setTimeout(() => location.reload(), 700);
  } catch (e) {
    if (status) status.textContent = 'تعذرت الاستعادة: ' + (e.message || 'خطأ غير معروف');
    alert('تعذرت استعادة البيانات: ' + (e.message || 'خطأ غير معروف'));
  }
}
