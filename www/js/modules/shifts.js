/* ============================================================
   Boutik v4 — الورديات
   ============================================================ */

function loadActiveShift() {
  const shifts = DB.shifts();
  currentShift = shifts.find(s => s.user_id === currentUser.id && !s.closed_at) || null;
  updateShiftBadge();
}

function updateShiftBadge() {
  const badge = document.getElementById('shiftBadge');
  if (!badge) return;
  if (currentShift) {
    badge.classList.remove('hidden');
    badge.textContent = '🟢 وردية مفتوحة';
  } else {
    badge.classList.add('hidden');
  }
}

function renderShiftCard() {
  const el = document.getElementById('shiftInfo');
  if (!el) return;
  if (!currentShift) {
    el.innerHTML = `
      <div class="empty">لا توجد وردية مفتوحة</div>
      <button class="btn btn-success btn-block" onclick="openShiftModal()">▶️ فتح وردية</button>`;
    return;
  }
  const invoices = DB.invoices().filter(i =>
    i.type === 'sale' &&
    i.user === currentUser.username &&
    new Date(i.created_at) >= new Date(currentShift.opened_at)
  );
  const total = invoices.reduce((s, i) => s + i.total, 0);
  const cash = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0);
  const credit = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.due || 0), 0);

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div class="stat" style="border-right-color:#27ae60"><div class="label">مبيعات الوردية</div><div class="value">${fmt(total)}</div></div>
      <div class="stat" style="border-right-color:#3498db"><div class="label">فواتير</div><div class="value">${invoices.length}</div></div>
      <div class="stat" style="border-right-color:#f39c12"><div class="label">نقدي</div><div class="value">${fmt(cash)}</div></div>
      <div class="stat" style="border-right-color:#e74c3c"><div class="label">دين</div><div class="value">${fmt(credit)}</div></div>
    </div>
    <div class="small" style="margin-bottom:10px">
      🕐 ${fmtDate(currentShift.opened_at)}<br>
      💵 رصيد افتتاحي: ${fmt(currentShift.opening_balance)}
    </div>
    <button class="btn btn-warning btn-block" onclick="openShiftCloseModal()">⏹️ إغلاق</button>
    <button class="btn btn-info btn-block" onclick="openShiftReport()" style="margin-top:8px">📊 تقرير</button>`;
}

function openShiftModal() {
  openModal(`
    <h3>▶️ فتح وردية</h3>
    <label class="lbl">رصيد افتتاحي</label>
    <input id="shiftOpen" type="number" inputmode="decimal" value="0" min="0">
    <div class="modal-actions">
      <button class="btn btn-success" onclick="confirmOpenShift()">✅ فتح</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function confirmOpenShift() {
  const opening = +document.getElementById('shiftOpen').value || 0;
  const shift = {
    id: uuid(),
    user_id: currentUser.id,
    user: currentUser.username,
    opening_balance: opening,
    opened_at: now(),
    closed_at: null,
    closing_balance: null,
    expected_cash: null,
    difference: null,
    notes: ''
  };
  upsertRow('shifts', shift);
  currentShift = shift;
  audit('shift_open', `رصيد: ${opening}`);
  updateShiftBadge();
  closeModal();
  renderShiftCard();
  toast('✅ تم فتح الوردية');
}

function openShiftCloseModal() {
  if (!currentShift) return;
  const invoices = DB.invoices().filter(i =>
    i.type === 'sale' && i.user === currentUser.username &&
    new Date(i.created_at) >= new Date(currentShift.opened_at));
  const cash = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0);
  const expected = (currentShift.opening_balance || 0) + cash;

  openModal(`
    <h3>⏹️ إغلاق الوردية</h3>
    <div style="background:var(--bg);padding:12px;border-radius:8px;margin-bottom:12px;font-size:13px">
      <div style="display:flex;justify-content:space-between"><span>رصيد افتتاحي:</span><b>${fmt(currentShift.opening_balance)}</b></div>
      <div style="display:flex;justify-content:space-between"><span>مبيعات نقدية:</span><b>${fmt(cash)}</b></div>
      <div style="display:flex;justify-content:space-between;color:#27ae60;font-weight:700"><span>النقد المتوقع:</span><b>${fmt(expected)}</b></div>
    </div>
    <label class="lbl">النقد الفعلي</label>
    <input id="shiftClose" type="number" inputmode="decimal" value="${expected}" min="0">
    <label class="lbl">ملاحظات</label>
    <input id="shiftNote" placeholder="اختياري">
    <div class="modal-actions">
      <button class="btn btn-warning" onclick="confirmCloseShift()">✅ إغلاق</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function confirmCloseShift() {
  const closing = +document.getElementById('shiftClose').value || 0;
  const notes = document.getElementById('shiftNote').value.trim();
  const invoices = DB.invoices().filter(i =>
    i.type === 'sale' && i.user === currentUser.username &&
    new Date(i.created_at) >= new Date(currentShift.opened_at));
  const cash = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0);
  const expected = (currentShift.opening_balance || 0) + cash;

  currentShift.closed_at = now();
  currentShift.closing_balance = closing;
  currentShift.expected_cash = expected;
  currentShift.difference = closing - expected;
  currentShift.notes = notes;
  upsertRow('shifts', currentShift);

  audit('shift_close', `فرق: ${currentShift.difference}`);
  const diffMsg = currentShift.difference === 0 ? '✅ مطابق' :
                  currentShift.difference > 0 ? `⚠️ زيادة: ${fmt(currentShift.difference)}` :
                  `⚠️ نقص: ${fmt(Math.abs(currentShift.difference))}`;
  toast('تم الإغلاق — ' + diffMsg);
  currentShift = null;
  updateShiftBadge();
  closeModal();
  renderShiftCard();
}

function openShiftReport() {
  const shifts = DB.shifts().filter(s => s.user_id === currentUser.id);
  const cur = currentShift || shifts[shifts.length - 1];
  if (!cur) return toast('لا توجد ورديات', true);
  const invoices = DB.invoices().filter(i =>
    i.type === 'sale' && i.user === cur.user &&
    new Date(i.created_at) >= new Date(cur.opened_at) &&
    (!cur.closed_at || new Date(i.created_at) <= new Date(cur.closed_at)));
  const cash = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0);
  const credit = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.due || 0), 0);
  const total = invoices.reduce((s, i) => s + i.total, 0);
  const settings = DB.settings();
  printHTML(`
    <div class="center">
      <h2>🛒 ${escapeHtml(settings.shopName || 'Boutik')}</h2>
      <div class="small">تقرير الوردية</div>
    </div>
    <div class="dashed">
      <div class="row"><span>المستخدم:</span><span>${cur.user}</span></div>
      <div class="row"><span>الفتح:</span><span>${fmtDate(cur.opened_at)}</span></div>
      ${cur.closed_at ? '<div class="row"><span>الإغلاق:</span><span>' + fmtDate(cur.closed_at) + '</span></div>' : ''}
    </div>
    <div class="dashed">
      <div class="total-row"><span>عدد الفواتير:</span><span>${invoices.length}</span></div>
      <div class="total-row"><span>إجمالي المبيعات:</span><span>${fmt(total)}</span></div>
      <div class="total-row"><span>نقدي:</span><span>${fmt(cash)}</span></div>
      <div class="total-row"><span>دين:</span><span>${fmt(credit)}</span></div>
    </div>`, 'تقرير الوردية');
}
