/* ============================================================
   Boutik v4 — النسخ الاحتياطي + الحذف الانتقائي
   ============================================================ */

function openBackup() {
  openModal(`
    <h3>💾 النسخ الاحتياطي</h3>
    <p class="small" style="margin-bottom:12px">صدّر كل بياناتك أو استوردها.</p>
    <div class="modal-actions" style="flex-direction:column">
      <button class="btn btn-primary" onclick="exportData()">📤 تصدير JSON</button>
      <button class="btn btn-warning" onclick="document.getElementById('importFile').click()">📥 استيراد JSON</button>
      <input type="file" id="importFile" accept=".json" onchange="importData(event)" class="hidden">
      <button class="btn btn-info" onclick="exportAllCSV()">📊 تصدير CSV</button>
      <button class="btn btn-danger" onclick="wipeAll()">🗑️ حذف الكل</button>
      <button class="btn btn-primary" onclick="closeModal()">إغلاق</button>
    </div>`);
}

function exportData() {
  const data = {};
  ['users','products','categories','customers','suppliers','invoices','invoiceItems',
   'purchases','purchaseItems','payments','stockMovements','shifts','auditLog',
   'inventorySessions','inventoryItems','changelog'
  ].forEach(k => { data[k] = DB.get(k); });
  data.counters = DB.counters();
  data.settings = DB.settings();
  data.mode = DB.mode();
  data.exported_at = now();

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'boutik-backup-' + todayISO() + '-' + Date.now() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  audit('backup_export', '');
  toast('✅ تم التصدير');
}

function importData(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!confirm('⚠️ سيتم استبدال كل البيانات الحالية. متابعة؟')) return;
      ['users','products','categories','customers','suppliers','invoices','invoiceItems',
       'purchases','purchaseItems','payments','stockMovements','shifts','auditLog',
       'inventorySessions','inventoryItems','changelog'
      ].forEach(k => { if (data[k]) DB.set(k, data[k]); });
      if (data.counters) DB.setObj('counters', data.counters);
      if (data.settings) DB.setObj('settings', data.settings);
      audit('backup_import', '');
      toast('✅ تم الاستيراد');
      closeModal();
      setTimeout(() => location.reload(), 800);
    } catch { toast('❌ ملف غير صالح', true); }
  };
  reader.readAsText(file);
}

function exportAllCSV() {
  const products = DB.products();
  const headers = ['الباركود','الاسم','الفئة','الكمية','سعر الشراء','سعر البيع','تاريخ الانتهاء'];
  const rows = products.map(p => [p.barcode || '', p.name, p.category || '', p.qty, p.cost, p.price, p.expiry_date || '']);
  exportCSV('boutik-products-' + todayISO() + '.csv', headers, rows);
}

function wipeAll() {
  if (!confirm('⚠️ سيتم حذف كل البيانات نهائيًا! متأكد؟')) return;
  if (!confirm('⚠️⚠️ تأكيد أخير؟')) return;
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith(DB.PREFIX)) localStorage.removeItem(k);
  });
  location.reload();
}

/* ============================================================
   الحذف الانتقائي — لا يحذف الديون
   ============================================================ */

function getStorageSize() {
  let total = 0;
  try {
    for (let k in localStorage) {
      if (k && k.startsWith('boutik_v4_')) total += (localStorage[k] || '').length;
    }
  } catch (e) {}
  return { bytes: total, mb: parseFloat((total / 1024 / 1024).toFixed(2)) };
}

function exportDataSilent() {
  try {
    const data = {};
    ['users','products','categories','customers','suppliers','invoices','invoiceItems',
     'purchases','purchaseItems','payments','stockMovements','shifts','auditLog',
     'inventorySessions','inventoryItems','changelog'
    ].forEach(k => { data[k] = DB.get(k); });
    data.counters = DB.counters();
    data.settings = DB.settings();
    data.exported_at = now();

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'boutik-autobackup-' + todayISO() + '-' + Date.now() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return true;
  } catch (e) { return false; }
}

function purgeInvoicesBefore(dateStr) {
  if (!dateStr) { toast('اختر التاريخ', true); return; }

  exportDataSilent();

  const all = DB.invoices();
  const keep = [];
  const removed = [];
  const protected_ = [];

  all.forEach(inv => {
    const old = inv.created_at < dateStr + 'T00:00:00';
    const hasDebt = (inv.due || 0) > 0;
    if (!old) { keep.push(inv); return; }
    if (hasDebt) { protected_.push(inv); return; }
    removed.push(inv);
  });

  if (!removed.length) {
    toast('لا توجد فواتير قابلة للحذف', true);
    return;
  }

  const removedIds = new Set(removed.map(i => i.id));
  const items = DB.invoiceItems().filter(it => !removedIds.has(it.invoice_id));
  localStorage.setItem(DB.PREFIX + 'invoiceItems', JSON.stringify(items));
  localStorage.setItem(DB.PREFIX + 'invoices', JSON.stringify(keep));

  audit('purge_invoices', `${removed.length} فاتورة`);
  toast(`✅ حُذفت ${removed.length} فاتورة. المحفوظة: ${protected_.length} (دين)`);
  if (typeof renderDataManagement === 'function') renderDataManagement();
}

function purgeStockMovementsBefore(dateStr) {
  if (!dateStr) { toast('اختر التاريخ', true); return; }
  exportDataSilent();
  const all = DB.stockMovements();
  const keep = all.filter(m => (m.created_at || '') >= dateStr + 'T00:00:00');
  const removed = all.length - keep.length;
  if (!removed) { toast('لا يوجد ما يمكن حذفه', true); return; }
  localStorage.setItem(DB.PREFIX + 'stockMovements', JSON.stringify(keep));
  audit('purge_movements', `${removed} حركة`);
  toast(`✅ حُذفت ${removed} حركة مخزون`);
  if (typeof renderDataManagement === 'function') renderDataManagement();
}

function purgeAuditLogBefore(dateStr) {
  if (!dateStr) { toast('اختر التاريخ', true); return; }
  const all = DB.auditLog();
  const keep = all.filter(a => (a.created_at || '') >= dateStr + 'T00:00:00');
  const removed = all.length - keep.length;
  if (!removed) { toast('لا يوجد ما يمكن حذفه', true); return; }
  localStorage.setItem(DB.PREFIX + 'auditLog', JSON.stringify(keep));
  toast(`✅ حُذف ${removed} سجل تدقيق`);
  if (typeof renderDataManagement === 'function') renderDataManagement();
}

function purgeChangelogSynced() {
  if (typeof ChangeLog !== 'undefined' && ChangeLog.cleanSynced) {
    const removed = ChangeLog.cleanSynced(7);
    toast(`✅ حُذف ${removed} سجل مُزامَن`);
    if (typeof renderDataManagement === 'function') renderDataManagement();
  }
}

function renderDataManagement() {
  const el = document.getElementById('dataManagement');
  if (!el) return;

  const size = getStorageSize();
  const pct = Math.min(100, Math.round((size.mb / 10) * 100));
  const barColor = size.mb > 7 ? '#e74c3c' : (size.mb > 5 ? '#f39c12' : '#138a45');

  const invoices = DB.invoices();
  const paid = invoices.filter(i => (i.due || 0) === 0).length;
  const withDebt = invoices.filter(i => (i.due || 0) > 0).length;

  el.innerHTML = `
    <div class="cart-item"><span>حجم التخزين:</span><strong style="color:${barColor}">${size.mb} MB / 10 MB</strong></div>
    <div style="background:#eee;height:10px;border-radius:5px;overflow:hidden;margin:8px 0">
      <div style="width:${pct}%;background:${barColor};height:100%"></div>
    </div>

    <div class="cart-item"><span>🧾 الفواتير:</span><strong>${invoices.length} (${paid} مدفوعة، ${withDebt} دين)</strong></div>
    <div class="cart-item"><span>📜 حركات المخزون:</span><strong>${DB.stockMovements().length}</strong></div>
    <div class="cart-item"><span>📝 سجل التدقيق:</span><strong>${DB.auditLog().length}</strong></div>
    <div class="cart-item"><span>🔄 changelog:</span><strong>${DB.get('changelog').length}</strong></div>

    <hr style="margin:12px 0;border:0;border-top:1px dashed #ccc">

    <label class="lbl">🧾 حذف الفواتير المدفوعة الأقدم من</label>
    <input type="date" id="purgeInvDate" value="${new Date(Date.now() - 180 * 86400000).toISOString().slice(0,10)}">
    <button class="btn btn-warning btn-block" onclick="purgeInvoicesBefore(document.getElementById('purgeInvDate').value)">
      🗑️ حذف الفواتير المدفوعة القديمة
    </button>
    <div class="small" style="margin-top:4px;color:#c00">🛡️ لن تُحذف أي فاتورة فيها دين</div>

    <label class="lbl" style="margin-top:12px">📜 حذف حركات المخزون الأقدم من</label>
    <input type="date" id="purgeMovDate" value="${new Date(Date.now() - 365 * 86400000).toISOString().slice(0,10)}">
    <button class="btn btn-warning btn-block" onclick="purgeStockMovementsBefore(document.getElementById('purgeMovDate').value)">
      🗑️ حذف الحركات القديمة
    </button>
    <div class="small" style="margin-top:4px;color:#666">لا يؤثر على كميات المخزون الحالية</div>

    <label class="lbl" style="margin-top:12px">📝 حذف سجل التدقيق الأقدم من</label>
    <input type="date" id="purgeAuditDate" value="${new Date(Date.now() - 180 * 86400000).toISOString().slice(0,10)}">
    <button class="btn btn-warning btn-block" onclick="purgeAuditLogBefore(document.getElementById('purgeAuditDate').value)">
      🗑️ حذف السجل القديم
    </button>

    <button class="btn btn-info btn-block" style="margin-top:12px" onclick="purgeChangelogSynced()">
      🔄 تنظيف changelog المُزامَن (آمن)
    </button>

    <div class="small" style="margin-top:12px;color:#666;text-align:center">
      ✅ تصدير نسخة احتياطية تلقائيًا قبل كل حذف
    </div>
  `;
               }
