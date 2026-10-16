/* ============================================================
   Boutik v4 — الفواتير (مع الإرجاع)
   ============================================================ */

function renderInvoices() {
  const q = (document.getElementById('invSearch')?.value || '').toLowerCase();
  let list = DB.invoices().filter(i => i.type === 'sale').slice().reverse();
  if (q) list = list.filter(i => (i.number || '').toLowerCase().includes(q) || (i.customer_name || '').toLowerCase().includes(q));
  const tb = document.getElementById('invoicesTable');
  if (!tb) return;
  tb.innerHTML = list.length ? list.map(i => `
    <tr${i.returned ? ' style="opacity:.6"' : ''}>
      <td>${escapeHtml(i.number)}</td>
      <td>${fmtDateShort(i.created_at)}</td>
      <td>${escapeHtml(i.customer_name || '—')}</td>
      <td>${fmt(i.total)}</td>
      <td>${statusBadge(i)}</td>
      <td>
        <button class="btn btn-info btn-sm" onclick="printInvoice('${i.id}')" title="طباعة">🖨️</button>
        ${i.due > 0 ? `<button class="btn btn-warning btn-sm" onclick="openPayModal('${i.id}')" title="دفعة">💰</button>` : ''}
        ${!i.returned ? `<button class="btn btn-danger btn-sm" onclick="returnInvoice('${i.id}')" title="إرجاع">🔄</button>` : '<span class="small">مُرجع</span>'}
      </td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">لا فواتير</td></tr>';
}

function statusBadge(inv) {
  if (inv.returned) return '<span style="color:#c62828">🔄 مُرجع</span>';
  if (inv.status === 'paid') return '<span style="color:#138a45">✅ مدفوع</span>';
  if (inv.status === 'partial') return '<span style="color:#f39c12">💰 جزئي</span>';
  return '<span style="color:#e74c3c">📝 دين</span>';
}

function openPayModal(invoiceId) {
  const inv = DB.invoices().find(i => i.id === invoiceId);
  if (!inv) return;
  openModal(`
    <h3>💰 تسجيل دفعة</h3>
    <div class="small">${inv.number} — المتبقي: ${fmt(inv.due)}</div>
    <label class="lbl">المبلغ المدفوع</label>
    <input id="payAmount" type="number" inputmode="decimal" value="${inv.due}" min="0" max="${inv.due}">
    <div class="modal-actions">
      <button class="btn btn-success" onclick="confirmPay('${invoiceId}')">💾</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function confirmPay(invoiceId) {
  const amt = +document.getElementById('payAmount').value || 0;
  if (amt <= 0) return;
  const inv = DB.invoices().find(i => i.id === invoiceId);
  if (!inv) return;
  const actual = Math.min(amt, inv.due);
  inv.paid = (inv.paid || 0) + actual;
  inv.due = Math.max(0, inv.due - actual);
  inv.status = inv.due === 0 ? 'paid' : (inv.paid > 0 ? 'partial' : 'credit');
  upsertRow('invoices', inv);

  upsertRow('payments', {
    id: uuid(), invoice_id: invoiceId, customer_id: inv.customer_id,
    amount: actual, user: currentUser.username, created_at: now()
  });

  if (inv.customer_id) {
    const c = DB.customers().find(x => x.id === inv.customer_id);
    if (c) { c.balance = Math.max(0, (c.balance || 0) - actual); upsertRow('customers', c); }
  }

  audit('payment', `${inv.number} — ${fmt(actual)}`);
  closeModal();
  renderInvoices();
  toast('✅ تم تسجيل الدفعة');
}

/* ============ إرجاع فاتورة ============ */
function returnInvoice(invoiceId) {
  const inv = DB.invoices().find(i => i.id === invoiceId);
  if (!inv) return;
  if (inv.type !== 'sale') { toast('هذه ليست فاتورة بيع', true); return; }
  if (inv.returned) { toast('هذه الفاتورة مُرجَعة بالفعل', true); return; }

  const items = DB.invoiceItems().filter(i => i.invoice_id === invoiceId);

  openModal(`
    <h3>🔄 إرجاع الفاتورة ${escapeHtml(inv.number)}</h3>
    <div class="cart-item"><span>الزبون:</span><strong>${escapeHtml(inv.customer_name)}</strong></div>
    <div class="cart-item"><span>الإجمالي:</span><strong>${fmt(inv.total)}</strong></div>
    <div class="cart-item"><span>المدفوع:</span><strong>${fmt(inv.paid)}</strong></div>
    <div class="cart-item"><span>الباقي:</span><strong>${fmt(inv.due)}</strong></div>
    <label class="lbl">اختر المنتجات للإرجاع</label>
    <div style="max-height:250px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
      ${items.map(it => `
        <label style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border)">
          <input type="checkbox" class="return-item" data-id="${it.id}" style="width:auto" checked>
          <span style="flex:1">${escapeHtml(it.name)} × ${it.qty} — ${fmt(it.price)}</span>
          <b>${fmt(it.subtotal)}</b>
        </label>
      `).join('')}
    </div>
    <label class="lbl">سبب الإرجاع (اختياري)</label>
    <input id="returnReason" placeholder="مثال: منتج معطوب">
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px">
      <input type="checkbox" id="returnStock" style="width:auto" checked>
      <span>إعادة الكميات إلى المخزون</span>
    </label>
    <div class="modal-actions">
      <button class="btn btn-warning" onclick="confirmReturn('${invoiceId}')">🔄 تأكيد الإرجاع</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>
  `);
}

function confirmReturn(invoiceId) {
  const inv = DB.invoices().find(i => i.id === invoiceId);
  if (!inv) return;

  const checked = Array.from(document.querySelectorAll('.return-item:checked')).map(el => el.dataset.id);
  if (!checked.length) { toast('اختر منتجًا واحدًا على الأقل', true); return; }

  const returnStock = document.getElementById('returnStock').checked;
  const reason = (document.getElementById('returnReason').value || '').trim();

  const items = DB.invoiceItems().filter(i => checked.includes(i.id));
  let returnedAmount = 0;

  items.forEach(it => {
    returnedAmount += it.subtotal;
    if (returnStock && it.product_id) {
      const p = DB.products().find(x => x.id === it.product_id);
      if (p) {
        const before = p.qty || 0;
        p.qty = before + it.qty;
        upsertRow('products', p);
        if (typeof recordStockMovement === 'function') {
          recordStockMovement(p.id, p.name, 'in', it.qty, before, p.qty, `إرجاع ${inv.number}`);
        }
      }
    }
  });

  const returns = DB.get('returns');
  returns.push({
    id: uuid(),
    invoice_id: invoiceId,
    invoice_number: inv.number,
    amount: returnedAmount,
    items: items.map(it => ({ id: it.id, name: it.name, qty: it.qty, price: it.price })),
    reason, stock_returned: returnStock,
    user: currentUser.username,
    created_at: now(),
    _updated_at: Date.now()
  });
  DB.set('returns', returns);

  if (items.length === DB.invoiceItems().filter(i => i.invoice_id === invoiceId).length) {
    inv.returned = true;
    inv.returned_at = now();
  }
  inv.return_amount = (inv.return_amount || 0) + returnedAmount;
  inv._updated_at = Date.now();
  upsertRow('invoices', inv);

  if (inv.customer_id) {
    const c = DB.customers().find(x => x.id === inv.customer_id);
    if (c) {
      c.balance = Math.max(0, (c.balance || 0) - returnedAmount);
      upsertRow('customers', c);
    }
  }

  audit('return', `${inv.number} — ${fmt(returnedAmount)}`);
  closeModal();
  renderInvoices();
  toast(`✅ تم الإرجاع: ${fmt(returnedAmount)}`);
}

function printInvoice(invoiceId) {
  const inv = DB.invoices().find(i => i.id === invoiceId);
  if (!inv) return;
  const items = DB.invoiceItems().filter(i => i.invoice_id === invoiceId);
  const s = DB.settings();

  let discountHTML = '';
  if (inv.discount > 0) {
    let label = 'الخصم';
    if (inv.customer_discount_pct > 0) label += ' (زبون مميز ' + inv.customer_discount_pct + '%)';
    if (inv.discount_type === 'percent') label += ' + ' + inv.discount_value + '%';
    else if (inv.discount_type === 'amount') label += ' + ' + fmtNum(inv.discount_value);
    discountHTML = `
      <div class="row"><span>المجموع الفرعي:</span><span>${fmt(inv.subtotal || inv.total)}</span></div>
      <div class="row" style="color:#c00"><span>${label}:</span><span>-${fmt(inv.discount)}</span></div>
    `;
  }

  printHTML(`
    <div class="center">
      <h2>${escapeHtml(s.shopName || 'Boutik')}</h2>
      ${s.shopAddress ? `<div class="small">${escapeHtml(s.shopAddress)}</div>` : ''}
      ${s.shopPhone ? `<div class="small">📞 ${escapeHtml(s.shopPhone)}</div>` : ''}
      ${s.shopRC ? `<div class="small">RC: ${escapeHtml(s.shopRC)}</div>` : ''}
    </div>
    <div class="dashed">
      <div class="row"><span>الفاتورة:</span><b>${escapeHtml(inv.number)}</b></div>
      <div class="row"><span>التاريخ:</span><span>${fmtDate(inv.created_at)}</span></div>
      <div class="row"><span>الزبون:</span><span>${escapeHtml(inv.customer_name || 'زبون عادي')}</span></div>
      <div class="row"><span>البائع:</span><span>${escapeHtml(inv.user || '')}</span></div>
    </div>
    <table>
      <thead><tr><th>المادة</th><th>كمية</th><th>سعر</th><th>مجموع</th></tr></thead>
      <tbody>
        ${items.map(it => `
          <tr>
            <td>${escapeHtml(it.name)}</td>
            <td>${it.qty}</td>
            <td>${fmtNum(it.price)}</td>
            <td>${fmtNum(it.subtotal || it.price * it.qty)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="dashed">
      ${discountHTML}
      <div class="total-row"><span>المجموع:</span><span>${fmt(inv.total)}</span></div>
      <div class="total-row"><span>المدفوع:</span><span>${fmt(inv.paid)}</span></div>
      ${inv.due > 0 ? `<div class="total-row" style="color:#c00"><span>الباقي:</span><span>${fmt(inv.due)}</span></div>` : ''}
    </div>
    <div class="center small">شكرًا لزيارتكم 🌟</div>
  `, 'فاتورة ' + inv.number);
}

function printDailyReport() {
  const today = todayISO();
  const invoices = DB.invoices().filter(i => i.type === 'sale' && i.created_at.startsWith(today));
  const total = invoices.reduce((s, i) => s + i.total, 0);
  const paid = invoices.reduce((s, i) => s + (i.paid || 0), 0);
  const due = invoices.reduce((s, i) => s + (i.due || 0), 0);
  const s = DB.settings();

  printHTML(`
    <div class="center">
      <h2>${escapeHtml(s.shopName || 'Boutik')}</h2>
      <div class="small">تقرير اليوم — ${fmtDateShort(today)}</div>
    </div>
    <div class="dashed">
      <div class="total-row"><span>عدد الفواتير:</span><span>${invoices.length}</span></div>
      <div class="total-row"><span>إجمالي المبيعات:</span><span>${fmt(total)}</span></div>
      <div class="total-row"><span>المدفوع:</span><span>${fmt(paid)}</span></div>
      <div class="total-row"><span>الباقي:</span><span>${fmt(due)}</span></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>فاتورة</th><th>زبون</th><th>إجمالي</th><th>الحالة</th></tr></thead>
      <tbody>
        ${invoices.map((i, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${escapeHtml(i.number)}</td>
            <td>${escapeHtml(i.customer_name || '—')}</td>
            <td>${fmtNum(i.total)}</td>
            <td>${i.status === 'paid' ? 'مدفوع' : 'دين'}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `, 'تقرير اليوم');
}
