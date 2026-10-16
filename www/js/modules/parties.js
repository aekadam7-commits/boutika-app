/* ============================================================
   Boutik v4 — الزبائن والموردين (مع خصم للزبائن المميزين)
   ============================================================ */

function renderCustomers() {
  const q = (document.getElementById('custSearch')?.value || '').toLowerCase();
  let list = DB.customers();
  if (q) list = list.filter(c => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q));
  const tb = document.getElementById('customersTable');
  if (!tb) return;
  tb.innerHTML = list.length ? list.map(c => {
    const disc = c.discount ? `<span style="color:#27ae60;font-weight:700">-${c.discount}%</span>` : '—';
    return `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td dir="ltr">${escapeHtml(c.phone || '—')}</td>
      <td style="color:${(c.balance || 0) > 0 ? '#e74c3c' : '#138a45'};font-weight:700">${fmt(c.balance || 0)}</td>
      <td>${disc}</td>
      <td>
        ${(c.balance || 0) > 0 ? `<button class="btn btn-success btn-sm" onclick="openPayCustomerModal('${c.id}')" title="دفعة">💰</button>` : ''}
        <button class="btn btn-info btn-sm" onclick="openCustomerModal('${c.id}')" title="تعديل">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCustomer('${c.id}')" title="حذف">🗑️</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="empty">لا زبائن</td></tr>';
}

function openCustomerModal(id) {
  const c = id ? DB.customers().find(x => x.id === id) : { name: '', phone: '', balance: 0, note: '', discount: 0 };
  openModal(`
    <h3>${id ? '✏️ تعديل زبون' : '➕ زبون جديد'}</h3>
    <label class="lbl">الاسم</label><input id="cName" value="${escapeHtml(c.name || '')}">
    <label class="lbl">الهاتف</label><input id="cPhone" dir="ltr" value="${escapeHtml(c.phone || '')}">
    <label class="lbl">الرصيد (دين)</label><input id="cBalance" type="number" inputmode="decimal" value="${c.balance || 0}">
    <label class="lbl">💸 خصم دائم للزبون المميز (%)</label>
    <input id="cDiscount" type="number" inputmode="decimal" value="${c.discount || 0}" min="0" max="100">
    <div class="small" style="color:#666;margin-top:4px">يُطبَّق تلقائيًا عند كل بيع</div>
    <label class="lbl">ملاحظات</label><input id="cNote" value="${escapeHtml(c.note || '')}">
    <div class="modal-actions">
      <button class="btn btn-success" onclick="saveCustomer('${id || ''}')">💾</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function saveCustomer(id) {
  const name = document.getElementById('cName').value.trim();
  if (!name) return;
  const c = id ? DB.customers().find(x => x.id === id) : { id: uuid(), created_at: now() };
  c.name = name;
  c.phone = document.getElementById('cPhone').value.trim();
  c.balance = +document.getElementById('cBalance').value || 0;
  c.discount = Math.min(100, Math.max(0, +document.getElementById('cDiscount').value || 0));
  c.note = document.getElementById('cNote').value.trim();
  upsertRow('customers', c);
  closeModal();
  renderCustomers();
  renderPOSCustomers();
  toast('✅ تم الحفظ');
}

function deleteCustomer(id) {
  if (!confirm('حذف الزبون؟')) return;
  removeRow('customers', id);
  renderCustomers();
}

function openPayCustomerModal(id) {
  const c = DB.customers().find(x => x.id === id);
  if (!c) return;
  const balance = c.balance || 0;
  const unpaidInvoices = DB.invoices().filter(i => i.customer_id === id && i.type === 'sale' && i.due > 0);

  openModal(`
    <h3>💰 تسجيل دفعة — ${escapeHtml(c.name)}</h3>
    <div style="background:var(--bg);padding:10px;border-radius:8px;margin-bottom:12px;font-size:13px">
      <div style="display:flex;justify-content:space-between"><span>الرصيد الحالي (دين):</span><b style="color:#e74c3c">${fmt(balance)}</b></div>
      <div style="display:flex;justify-content:space-between"><span>عدد الفواتير المعلقة:</span><b>${unpaidInvoices.length}</b></div>
    </div>
    <label class="lbl">المبلغ المدفوع</label>
    <input id="payCustAmt" type="number" inputmode="decimal" value="${balance}" min="0" max="${balance}">
    <label class="lbl">ملاحظة (اختياري)</label>
    <input id="payCustNote" placeholder="مثال: دفعة نقدية">
    <div class="modal-actions">
      <button class="btn btn-success" onclick="confirmPayCustomer('${id}')">💾 حفظ</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function confirmPayCustomer(id) {
  const c = DB.customers().find(x => x.id === id);
  if (!c) return;
  let amt = +document.getElementById('payCustAmt').value || 0;
  const note = (document.getElementById('payCustNote').value || '').trim();
  const balance = c.balance || 0;

  if (amt <= 0) { toast('أدخل مبلغًا صحيحًا', true); return; }
  if (amt > balance) amt = balance;

  let remaining = amt;
  const unpaidInvoices = DB.invoices()
    .filter(i => i.customer_id === id && i.type === 'sale' && i.due > 0)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  unpaidInvoices.forEach(inv => {
    if (remaining <= 0) return;
    const pay = Math.min(remaining, inv.due);
    inv.paid = (inv.paid || 0) + pay;
    inv.due = Math.max(0, inv.due - pay);
    inv.status = inv.due === 0 ? 'paid' : (inv.paid > 0 ? 'partial' : 'credit');
    upsertRow('invoices', inv);

    upsertRow('payments', {
      id: uuid(), invoice_id: inv.id, customer_id: id,
      amount: pay, note: note,
      user: currentUser.username, created_at: now()
    });

    remaining -= pay;
  });

  c.balance = Math.max(0, balance - amt);
  upsertRow('customers', c);

  audit('customer_payment', `${c.name} — ${fmt(amt)}`);
  toast(`✅ تم تسجيل ${fmt(amt)} — الرصيد الجديد: ${fmt(c.balance)}`);
  closeModal();
  renderCustomers();
}

function printCustomersList() {
  const list = DB.customers();
  printHTML(`
    <div class="center"><h2>قائمة الزبائن</h2></div>
    <table><thead><tr><th>#</th><th>الاسم</th><th>الهاتف</th><th>الخصم</th><th>الرصيد</th></tr></thead>
    <tbody>${list.map((c, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(c.name)}</td><td dir="ltr">${escapeHtml(c.phone || '')}</td><td>${c.discount || 0}%</td><td>${fmtNum(c.balance || 0)}</td></tr>`).join('')}</tbody></table>
  `, 'قائمة الزبائن');
}

function renderSuppliers() {
  const list = DB.suppliers();
  const tb = document.getElementById('suppliersTable');
  if (!tb) return;
  tb.innerHTML = list.length ? list.map(s => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td dir="ltr">${escapeHtml(s.phone || '—')}</td>
      <td style="color:${(s.balance || 0) > 0 ? '#e74c3c' : '#138a45'};font-weight:700">${fmt(s.balance || 0)}</td>
      <td>
        ${(s.balance || 0) > 0 ? `<button class="btn btn-success btn-sm" onclick="openPaySupplierModal('${s.id}')" title="دفعة">💰</button>` : ''}
        <button class="btn btn-info btn-sm" onclick="openSupplierModal('${s.id}')" title="تعديل">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSupplier('${s.id}')" title="حذف">🗑️</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="4" class="empty">لا موردين</td></tr>';
}

function openSupplierModal(id) {
  const s = id ? DB.suppliers().find(x => x.id === id) : { name: '', phone: '', balance: 0, note: '' };
  openModal(`
    <h3>${id ? '✏️ تعديل مورد' : '➕ مورد جديد'}</h3>
    <label class="lbl">الاسم</label><input id="sName" value="${escapeHtml(s.name || '')}">
    <label class="lbl">الهاتف</label><input id="sPhone" dir="ltr" value="${escapeHtml(s.phone || '')}">
    <label class="lbl">الرصيد</label><input id="sBalance" type="number" inputmode="decimal" value="${s.balance || 0}">
    <label class="lbl">ملاحظات</label><input id="sNote" value="${escapeHtml(s.note || '')}">
    <div class="modal-actions">
      <button class="btn btn-success" onclick="saveSupplier('${id || ''}')">💾</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function saveSupplier(id) {
  const name = document.getElementById('sName').value.trim();
  if (!name) return;
  const s = id ? DB.suppliers().find(x => x.id === id) : { id: uuid(), created_at: now() };
  s.name = name;
  s.phone = document.getElementById('sPhone').value.trim();
  s.balance = +document.getElementById('sBalance').value || 0;
  s.note = document.getElementById('sNote').value.trim();
  upsertRow('suppliers', s);
  closeModal();
  renderSuppliers();
  toast('✅ تم الحفظ');
}

function deleteSupplier(id) {
  if (!confirm('حذف المورد؟')) return;
  removeRow('suppliers', id);
  renderSuppliers();
}

function openPaySupplierModal(id) {
  const s = DB.suppliers().find(x => x.id === id);
  if (!s) return;
  const balance = s.balance || 0;
  openModal(`
    <h3>💰 تسجيل دفعة للمورد — ${escapeHtml(s.name)}</h3>
    <div style="background:var(--bg);padding:10px;border-radius:8px;margin-bottom:12px;font-size:13px">
      <div style="display:flex;justify-content:space-between"><span>الرصيد الحالي (علينا):</span><b style="color:#e74c3c">${fmt(balance)}</b></div>
    </div>
    <label class="lbl">المبلغ المدفوع</label>
    <input id="paySupAmt" type="number" inputmode="decimal" value="${balance}" min="0" max="${balance}">
    <label class="lbl">ملاحظة (اختياري)</label>
    <input id="paySupNote" placeholder="مثال: دفع نقدي">
    <div class="modal-actions">
      <button class="btn btn-success" onclick="confirmPaySupplier('${id}')">💾 حفظ</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function confirmPaySupplier(id) {
  const s = DB.suppliers().find(x => x.id === id);
  if (!s) return;
  let amt = +document.getElementById('paySupAmt').value || 0;
  const note = (document.getElementById('paySupNote').value || '').trim();
  const balance = s.balance || 0;

  if (amt <= 0) { toast('أدخل مبلغًا صحيحًا', true); return; }
  if (amt > balance) amt = balance;

  s.balance = Math.max(0, balance - amt);
  upsertRow('suppliers', s);

  audit('supplier_payment', `${s.name} — ${fmt(amt)}`);
  toast(`✅ تم تسجيل ${fmt(amt)} — الرصيد الجديد: ${fmt(s.balance)}`);
  closeModal();
  renderSuppliers();
}

function printSuppliersList() {
  const list = DB.suppliers();
  printHTML(`
    <div class="center"><h2>قائمة الموردين</h2></div>
    <table><thead><tr><th>#</th><th>الاسم</th><th>الهاتف</th><th>الرصيد</th></tr></thead>
    <tbody>${list.map((s, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(s.name)}</td><td dir="ltr">${escapeHtml(s.phone || '')}</td><td>${fmtNum(s.balance || 0)}</td></tr>`).join('')}</tbody></table>
  `, 'قائمة الموردين');
}
