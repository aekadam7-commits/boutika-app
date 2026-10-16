/* ============================================================
   Boutik v4 — التقارير (مع منتجات راكدة + أفضل زبائن)
   ============================================================ */

function renderReports() {
  const invoices = DB.invoices().filter(i => i.type === 'sale');
  const total = invoices.reduce((s, i) => s + i.total, 0);
  const items = DB.invoiceItems();
  const profit = items.reduce((s, it) => {
    const inv = DB.invoices().find(i => i.id === it.invoice_id);
    if (!inv || inv.type !== 'sale') return s;
    return s + ((it.price - it.cost) * it.qty);
  }, 0);
  const debts = DB.customers().reduce((s, c) => s + (c.balance || 0), 0);
  const stockValue = DB.products().reduce((s, p) => s + (p.qty * p.price), 0);
  const stockCost = DB.products().reduce((s, p) => s + (p.qty * (p.cost || 0)), 0);

  const el = id => document.getElementById(id);
  if (el('repTotalSales')) el('repTotalSales').textContent = fmt(total);
  if (el('repProfit')) el('repProfit').textContent = fmt(profit);
  if (el('repDebts')) el('repDebts').textContent = fmt(debts);
  if (el('repInvoices')) el('repInvoices').textContent = invoices.length;
  if (el('repStockValue')) el('repStockValue').textContent = fmt(stockValue);
  if (el('repStockCost')) el('repStockCost').textContent = fmt(stockCost);

  renderTopProducts();
  renderStagnantProducts();
  renderTopCustomers();
}

function renderTopProducts() {
  const items = DB.invoiceItems();
  const map = {};
  items.forEach(it => {
    const key = it.product_id || it.name;
    if (!map[key]) map[key] = { name: it.name, qty: 0, total: 0 };
    map[key].qty += it.qty;
    map[key].total += it.subtotal || (it.price * it.qty);
  });
  const list = Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 15);
  const el = document.getElementById('topProducts');
  if (!el) return;
  el.innerHTML = list.length ? list.map((p, i) => `
    <div class="cart-item"><span>${i + 1}. ${escapeHtml(p.name)}</span><span>${p.qty} × — ${fmt(p.total)}</span></div>
  `).join('') : '<div class="empty">لا بيانات</div>';
}

function renderStagnantProducts() {
  const el = document.getElementById('stagnantProducts');
  if (!el) return;

  const items = DB.invoiceItems();
  const soldMap = {};
  items.forEach(it => {
    if (it.product_id) soldMap[it.product_id] = (soldMap[it.product_id] || 0) + it.qty;
  });

  const products = DB.products();
  const never = products.filter(p => !soldMap[p.id] && p.qty > 0);
  const low = products.filter(p => soldMap[p.id] && soldMap[p.id] <= 2 && p.qty > 0)
    .sort((a, b) => (soldMap[a.id] || 0) - (soldMap[b.id] || 0));

  let html = '';
  if (never.length) {
    html += `<div class="section-title">❌ لم تُبَع أبدًا (${never.length})</div>`;
    html += never.slice(0, 15).map(p =>
      `<div class="cart-item"><span>${escapeHtml(p.name)}</span><span>${p.qty} قطعة</span></div>`
    ).join('');
  }
  if (low.length) {
    html += `<div class="section-title">⚠️ باعت مرة أو مرتين (${low.length})</div>`;
    html += low.slice(0, 15).map(p =>
      `<div class="cart-item"><span>${escapeHtml(p.name)}</span><span>${soldMap[p.id]} مرة</span></div>`
    ).join('');
  }
  el.innerHTML = html || '<div class="empty">✅ كل المنتجات تُبَاع بانتظام</div>';
}

function renderTopCustomers() {
  const el = document.getElementById('topCustomers');
  if (!el) return;

  const invoices = DB.invoices().filter(i => i.type === 'sale');
  const map = {};
  invoices.forEach(inv => {
    const key = inv.customer_id || inv.customer_name || 'زبون عادي';
    if (!map[key]) map[key] = { name: inv.customer_name || 'زبون عادي', total: 0, count: 0, due: 0 };
    map[key].total += inv.total;
    map[key].count++;
    map[key].due += (inv.due || 0);
  });
  const list = Object.values(map).sort((a, b) => b.total - a.total).slice(0, 15);
  el.innerHTML = list.length ? list.map((c, i) => `
    <div class="cart-item">
      <span>${i + 1}. ${escapeHtml(c.name)} (${c.count} فاتورة)</span>
      <span><b>${fmt(c.total)}</b>${c.due > 0 ? ` <span style="color:#c00">| دين: ${fmt(c.due)}</span>` : ''}</span>
    </div>
  `).join('') : '<div class="empty">لا بيانات</div>';
}

function renderPeriodReport() {
  const from = document.getElementById('repDateFrom').value;
  const to = document.getElementById('repDateTo').value;
  if (!from || !to) return toast('حدّد الفترة', true);
  const invoices = DB.invoices().filter(i =>
    i.type === 'sale' && i.created_at >= from && i.created_at <= to + 'T23:59:59');
  const total = invoices.reduce((s, i) => s + i.total, 0);
  const el = document.getElementById('periodReport');
  if (!el) return;
  el.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="label">عدد الفواتير</div><div class="value">${invoices.length}</div></div>
      <div class="stat"><div class="label">الإجمالي</div><div class="value">${fmt(total)}</div></div>
    </div>`;
}

function printPeriodReport() {
  const from = document.getElementById('repDateFrom').value;
  const to = document.getElementById('repDateTo').value;
  if (!from || !to) return;
  const invoices = DB.invoices().filter(i =>
    i.type === 'sale' && i.created_at >= from && i.created_at <= to + 'T23:59:59');
  const total = invoices.reduce((s, i) => s + i.total, 0);
  printHTML(`
    <div class="center"><h2>تقرير الفترة</h2></div>
    <div class="small">من ${from} إلى ${to}</div>
    <div class="dashed">
      <div class="total-row"><span>عدد الفواتير:</span><span>${invoices.length}</span></div>
      <div class="total-row"><span>الإجمالي:</span><span>${fmt(total)}</span></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>فاتورة</th><th>تاريخ</th><th>إجمالي</th></tr></thead>
      <tbody>${invoices.map((i, idx) => `<tr><td>${idx + 1}</td><td>${i.number}</td><td>${fmtDateShort(i.created_at)}</td><td>${fmtNum(i.total)}</td></tr>`).join('')}</tbody>
    </table>
  `, 'تقرير الفترة');
}

function printTopProducts() {
  const items = DB.invoiceItems();
  const map = {};
  items.forEach(it => {
    const key = it.product_id || it.name;
    if (!map[key]) map[key] = { name: it.name, qty: 0, total: 0 };
    map[key].qty += it.qty;
    map[key].total += it.subtotal || (it.price * it.qty);
  });
  const list = Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 30);
  printHTML(`
    <div class="center"><h2>الأكثر مبيعًا</h2></div>
    <table>
      <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
      <tbody>${list.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td>${p.qty}</td><td>${fmtNum(p.total)}</td></tr>`).join('')}</tbody>
    </table>
  `, 'الأكثر مبيعًا');
}

function printStagnantProducts() {
  const items = DB.invoiceItems();
  const soldMap = {};
  items.forEach(it => {
    if (it.product_id) soldMap[it.product_id] = (soldMap[it.product_id] || 0) + it.qty;
  });
  const products = DB.products();
  const never = products.filter(p => !soldMap[p.id] && p.qty > 0);
  const low = products.filter(p => soldMap[p.id] && soldMap[p.id] <= 2 && p.qty > 0)
    .sort((a, b) => (soldMap[a.id] || 0) - (soldMap[b.id] || 0));

  printHTML(`
    <div class="center"><h2>📉 المنتجات الراكدة</h2></div>
    <div class="dashed">
      <div class="total-row"><span>لم تُبَع أبدًا:</span><span>${never.length}</span></div>
      <div class="total-row"><span>باعت مرة أو مرتين:</span><span>${low.length}</span></div>
    </div>
    <h3>❌ لم تُبَع أبدًا</h3>
    <table>
      <thead><tr><th>#</th><th>المنتج</th><th>الكمية بالمخزون</th><th>القيمة</th></tr></thead>
      <tbody>
        ${never.length ? never.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td>${p.qty}</td><td>${fmtNum(p.qty * p.price)}</td></tr>`).join('') : '<tr><td colspan="4" class="center">لا يوجد</td></tr>'}
      </tbody>
    </table>
    <h3>⚠️ باعت مرة أو مرتين</h3>
    <table>
      <thead><tr><th>#</th><th>المنتج</th><th>مرات البيع</th><th>الكمية بالمخزون</th></tr></thead>
      <tbody>
        ${low.length ? low.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td>${soldMap[p.id]}</td><td>${p.qty}</td></tr>`).join('') : '<tr><td colspan="4" class="center">لا يوجد</td></tr>'}
      </tbody>
    </table>
  `, 'المنتجات الراكدة');
}

function printTopCustomers() {
  const invoices = DB.invoices().filter(i => i.type === 'sale');
  const map = {};
  invoices.forEach(inv => {
    const key = inv.customer_id || inv.customer_name || 'زبون عادي';
    if (!map[key]) map[key] = { name: inv.customer_name || 'زبون عادي', total: 0, count: 0, due: 0 };
    map[key].total += inv.total;
    map[key].count++;
    map[key].due += (inv.due || 0);
  });
  const list = Object.values(map).sort((a, b) => b.total - a.total).slice(0, 30);
  printHTML(`
    <div class="center"><h2>⭐ أفضل الزبائن</h2></div>
    <table>
      <thead><tr><th>#</th><th>الزبون</th><th>الفواتير</th><th>الإجمالي</th><th>الديون</th></tr></thead>
      <tbody>${list.map((c, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(c.name)}</td><td>${c.count}</td><td>${fmtNum(c.total)}</td><td>${fmtNum(c.due)}</td></tr>`).join('')}</tbody>
    </table>
  `, 'أفضل الزبائن');
}

function printExpiredProducts() {
  const expired = DB.products().filter(p => typeof isExpired === 'function' && isExpired(p));
  const expiring = DB.products().filter(p => typeof isExpiringSoon === 'function' && isExpiringSoon(p));
  const s = DB.settings();
  printHTML(`
    <div class="center"><h2>${escapeHtml(s.shopName || 'Boutik')}</h2><div class="small">تقرير المنتجات المنتهية</div></div>
    <div class="small">التاريخ: ${fmtDate(now())}</div>
    <div class="dashed">
      <div class="total-row"><span>منتهية الصلاحية:</span><span>${expired.length}</span></div>
      <div class="total-row"><span>قريبة الانتهاء:</span><span>${expiring.length}</span></div>
    </div>
    <h3>🚨 منتهية الصلاحية</h3>
    <table>
      <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>تاريخ الانتهاء</th><th>سعر البيع</th></tr></thead>
      <tbody>${expired.length ? expired.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td>${p.qty}</td><td>${fmtDateShort(p.expiry_date)}</td><td>${fmtNum(p.price)}</td></tr>`).join('') : '<tr><td colspan="5" class="center">لا يوجد</td></tr>'}</tbody>
    </table>
    <h3>📅 قريبة الانتهاء</h3>
    <table>
      <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>تاريخ الانتهاء</th><th>الأيام المتبقية</th></tr></thead>
      <tbody>${expiring.length ? expiring.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td>${p.qty}</td><td>${fmtDateShort(p.expiry_date)}</td><td>${daysUntilExpiry(p.expiry_date)}</td></tr>`).join('') : '<tr><td colspan="5" class="center">لا يوجد</td></tr>'}</tbody>
    </table>
  `, 'تقرير المنتهية');
}

function printStockMovements() {
  const movements = DB.stockMovements().slice().reverse().slice(0, 500);
  printHTML(`
    <div class="center"><h2>حركات المخزون</h2></div>
    <div class="small">آخر ${movements.length} حركة</div>
    <table>
      <thead><tr><th>#</th><th>التاريخ</th><th>المنتج</th><th>النوع</th><th>الكمية</th><th>قبل</th><th>بعد</th><th>السبب</th></tr></thead>
      <tbody>
        ${movements.length ? movements.map((m, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${fmtDateShort(m.created_at)}</td>
            <td>${escapeHtml(m.product_name || '')}</td>
            <td>${m.type === 'in' ? '🟢+' : (m.type === 'out' ? '🔴-' : '🟡=')}</td>
            <td>${m.qty}</td>
            <td>${m.before}</td>
            <td>${m.after}</td>
            <td>${escapeHtml(m.reason || '')}</td>
          </tr>`).join('') : '<tr><td colspan="8" class="center">لا حركات</td></tr>'}
      </tbody>
    </table>
  `, 'حركات المخزون');
}
