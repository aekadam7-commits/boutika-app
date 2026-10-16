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

  const net = document.getElementById('netSettings');
  if (net) {
    const m = DB.mode();
    const devId = (typeof Device !== 'undefined' && Device.getId) ? Device.getId() : '—';
    net.innerHTML = `
      <div class="cart-item"><span>الوضع:</span><strong>${m.current === 'host' ? '🖥️ مضيف' : (m.current === 'client' ? '📱 عميل' : '—')}</strong></div>
      ${m.host ? '<div class="cart-item"><span>الخادم:</span><strong dir="ltr">' + m.host.ip + ':' + m.host.port + '</strong></div>' : ''}
      <div class="cart-item"><span>معرّف الجهاز:</span><strong dir="ltr" style="font-size:11px">${devId}</strong></div>
      <button class="btn btn-primary btn-block" onclick="scanForHosts()">🔄 البحث عن أجهزة رئيسية</button>
      <button class="btn btn-info btn-block" onclick="Sync.flush()">📤 مزامنة الآن</button>
    `;
  }

  if (typeof renderDataManagement === 'function') renderDataManagement();
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
    <div class="cart-item"><span>WebSocket:</span><strong>${Sync.ws && Sync.ws.readyState === 1 ? '🟢 متصل' : '🔴 غير متصل'}</strong></div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="Sync.flush().then(()=>toast('تم الإرسال'))">📤 إرسال الآن</button>
      <button class="btn btn-info" onclick="Sync.pull()">📥 استلام</button>
      <button class="btn btn-danger" onclick="closeModal()">إغلاق</button>
    </div>`);
}
