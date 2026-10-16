/* ============================================================
   Boutik v4 — مصاريف المحل
   ============================================================ */

function renderExpenses() {
  const el = document.getElementById('expensesList');
  if (!el) return;

  const list = DB.get('expenses').slice().reverse();
  const today = todayISO();
  const monthStart = today.slice(0, 7) + '-01';

  const totalToday = list.filter(e => e.date === today).reduce((s, e) => s + e.amount, 0);
  const totalMonth = list.filter(e => e.date >= monthStart).reduce((s, e) => s + e.amount, 0);
  const totalAll = list.reduce((s, e) => s + e.amount, 0);

  el.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="label">مصاريف اليوم</div><div class="value">${fmt(totalToday)}</div></div>
      <div class="stat"><div class="label">هذا الشهر</div><div class="value">${fmt(totalMonth)}</div></div>
      <div class="stat"><div class="label">الإجمالي</div><div class="value">${fmt(totalAll)}</div></div>
    </div>
    <div class="flex-actions" style="margin-bottom:12px">
      <button class="btn btn-primary" onclick="openExpenseModal()">➕ مصروف جديد</button>
      <button class="btn btn-info btn-sm" onclick="printExpensesReport()">🖨️ طباعة</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th><th></th></tr></thead>
        <tbody>
          ${list.length ? list.slice(0, 100).map(e => `
            <tr>
              <td>${fmtDateShort(e.date)}</td>
              <td>${escapeHtml(e.category || '—')}</td>
              <td style="color:#e74c3c;font-weight:700">${fmt(e.amount)}</td>
              <td>${escapeHtml((e.note || '').slice(0, 40))}</td>
              <td><button class="btn btn-danger btn-sm" onclick="deleteExpense('${e.id}')">🗑️</button></td>
            </tr>`).join('') : '<tr><td colspan="5" class="empty">لا مصاريف</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function openExpenseModal(id) {
  const categories = ['كراء', 'كهرباء', 'ماء', 'غاز', 'إنترنت', 'هاتف', 'نقل', 'صيانة', 'رواتب', 'ضرائب', 'متفرقات'];
  const e = id ? DB.get('expenses').find(x => x.id === id) : { category: '', amount: 0, date: todayISO(), note: '' };
  openModal(`
    <h3>${id ? '✏️ تعديل' : '➕ مصروف جديد'}</h3>
    <label class="lbl">التاريخ</label><input id="expDate" type="date" value="${e.date || todayISO()}">
    <label class="lbl">النوع</label>
    <select id="expCategory">
      <option value="">— اختر —</option>
      ${categories.map(c => `<option value="${c}" ${c === e.category ? 'selected' : ''}>${c}</option>`).join('')}
    </select>
    <label class="lbl">المبلغ</label><input id="expAmount" type="number" inputmode="decimal" value="${e.amount || 0}">
    <label class="lbl">ملاحظة</label><input id="expNote" value="${escapeHtml(e.note || '')}">
    <div class="modal-actions">
      <button class="btn btn-success" onclick="saveExpense('${id || ''}')">💾</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function saveExpense(id) {
  const date = document.getElementById('expDate').value;
  const category = document.getElementById('expCategory').value || 'متفرقات';
  const amount = +document.getElementById('expAmount').value || 0;
  const note = document.getElementById('expNote').value.trim();

  if (amount <= 0) { toast('أدخل مبلغًا صحيحًا', true); return; }

  const list = DB.get('expenses');
  if (id) {
    const idx = list.findIndex(x => x.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], date, category, amount, note, _updated_at: Date.now() };
    }
  } else {
    list.push({
      id: uuid(),
      date, category, amount, note,
      user: currentUser.username,
      created_at: now(),
      _updated_at: Date.now()
    });
  }
  DB.set('expenses', list);
  audit('expense', `${category} — ${fmt(amount)}`);
  closeModal();
  renderExpenses();
  toast('✅ تم الحفظ');
}

function deleteExpense(id) {
  if (!confirm('حذف المصروف؟')) return;
  const list = DB.get('expenses').filter(x => x.id !== id);
  DB.set('expenses', list);
  renderExpenses();
  toast('🗑️ تم الحذف');
}

function printExpensesReport() {
  const list = DB.get('expenses').slice().reverse();
  const total = list.reduce((s, e) => s + e.amount, 0);
  const s = DB.settings();

  printHTML(`
    <div class="center">
      <h2>${escapeHtml(s.shopName || 'Boutik')}</h2>
      <div class="small">تقرير المصاريف</div>
    </div>
    <div class="dashed">
      <div class="total-row"><span>عدد المصاريف:</span><span>${list.length}</span></div>
      <div class="total-row"><span>الإجمالي:</span><span>${fmt(total)}</span></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead>
      <tbody>
        ${list.map((e, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${fmtDateShort(e.date)}</td>
            <td>${escapeHtml(e.category || '')}</td>
            <td>${fmtNum(e.amount)}</td>
            <td>${escapeHtml(e.note || '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `, 'تقرير المصاريف');
}
