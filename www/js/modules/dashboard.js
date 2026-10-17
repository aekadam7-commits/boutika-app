/* ============================================================
   Boutik v4 — لوحة المعلومات (مع المصاريف + تنبيه الحجم)
   ============================================================ */

function renderDashboard() {
  const today = todayISO();
  const invoices = DB.invoices().filter(i => i.type === 'sale' && i.created_at.startsWith(today));
  const total = invoices.reduce((s, i) => s + i.total, 0);
  const products = DB.products();

  const items = DB.invoiceItems();
  const todayItems = items.filter(it => {
    const inv = DB.invoices().find(i => i.id === it.invoice_id);
    return inv && inv.type === 'sale' && inv.created_at.startsWith(today);
  });
  const grossProfit = todayItems.reduce((s, it) => s + ((it.price - it.cost) * it.qty), 0);

  // طرح المصاريف
  const expenses = DB.get('expenses').filter(e => e.date === today);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const netProfit = grossProfit - totalExpenses;

  const debts = DB.customers().reduce((s, c) => s + (c.balance || 0), 0);
  const stockValue = products.reduce((s, p) => s + (p.qty * (p.price || 0)), 0);

  const el = id => document.getElementById(id);
  if (el('statTodaySales')) el('statTodaySales').textContent = fmt(total);
  if (el('statTodayInvoices')) el('statTodayInvoices').textContent = invoices.length;
  if (el('statProducts')) el('statProducts').textContent = products.length;
  if (el('statDebts')) el('statDebts').textContent = fmt(debts);
  if (el('statTodayProfit')) el('statTodayProfit').textContent = fmt(netProfit);
  if (el('statStockValue')) el('statStockValue').textContent = fmt(stockValue);

  const low = products.filter(p => p.qty <= (p.min_qty || 5) && p.qty > 0);
  const out = products.filter(p => p.qty <= 0);
  const lowList = el('lowStockList');
  if (lowList) {
    if (!low.length && !out.length) {
      lowList.innerHTML = '<div class="empty">✅ لا توجد تنبيهات</div>';
    } else {
      let html = '';
      if (out.length) {
        html += `<div class="section-title">❌ نفد (${out.length})</div>`;
        html += out.slice(0, 10).map(p =>
          `<div class="cart-item"><span>❌ <strong>${escapeHtml(p.name)}</strong></span><span style="color:#e74c3c;font-weight:700">0</span></div>`
        ).join('');
      }
      if (low.length) {
        html += `<div class="section-title">⚠️ منخفض (${low.length})</div>`;
        html += low.slice(0, 10).map(p =>
          `<div class="cart-item"><span>⚠️ <strong>${escapeHtml(p.name)}</strong></span><span style="color:#f39c12;font-weight:700">${p.qty}</span></div>`
        ).join('');
      }
      lowList.innerHTML = html;
    }
  }

  const expiring = products.filter(isExpiringSoon);
  const expired = products.filter(isExpired);
  const expList = el('expiryList');
  if (expList) {
    if (!expiring.length && !expired.length) {
      expList.innerHTML = '<div class="empty">✅ لا توجد منتجات قريبة الانتهاء</div>';
    } else {
      let html = '';
      if (expired.length) {
        html += `<div class="section-title">🚨 منتهية (${expired.length})</div>`;
        html += expired.slice(0, 10).map(p =>
          `<div class="cart-item"><span>🚨 <strong>${escapeHtml(p.name)}</strong></span><span style="color:#e74c3c;font-size:11px">${fmtDateShort(p.expiry_date)}</span></div>`
        ).join('');
      }
      if (expiring.length) {
        html += `<div class="section-title">📅 قريبة الانتهاء (${expiring.length})</div>`;
        html += expiring.slice(0, 10).map(p => {
          const days = daysUntilExpiry(p.expiry_date);
          return `<div class="cart-item"><span>📅 <strong>${escapeHtml(p.name)}</strong></span><span style="color:#f39c12;font-size:11px">${days} يوم</span></div>`;
        }).join('');
      }
      expList.innerHTML = html;
    }
  }

  renderNetworkInfo();
  if (typeof renderShiftCard === 'function') renderShiftCard();

  // (أُلغي تنبيه حجم 10MB: التخزين غير محدود ولا يُحذف شيء تلقائيًا)
  try { const elWarn = document.getElementById('storageWarning'); if (elWarn) elWarn.style.display = 'none'; } catch (e) {}
}

function renderNetworkInfo() {
  const el = document.getElementById('networkInfo');
  if (!el) return;
  const mode = DB.mode();
  if (!mode.current) {
    el.innerHTML = '<div class="empty">لم يتم اختيار الوضع بعد</div>';
    return;
  }
  let html = `<div class="cart-item"><span>الوضع:</span><strong>${mode.current === 'host' ? '🖥️ مضيف' : '📱 عميل'}</strong></div>`;
  if (mode.current === 'client' && mode.host) {
    html += `<div class="cart-item"><span>الخادم:</span><strong>${escapeHtml(mode.host.name || '')}</strong></div>`;
    html += `<div class="cart-item"><span>العنوان:</span><strong dir="ltr">${mode.host.ip}:${mode.host.port}</strong></div>`;
    html += `<div class="cart-item"><span>الحالة:</span><strong>${Net.online ? '✅ متصل' : '❌ غير متصل'}</strong></div>`;
  } else if (mode.current === 'host') {
    html += `<div class="cart-item"><span>منفذ السيرفر:</span><strong dir="ltr">8787</strong></div>`;
    html += `<div class="cart-item"><span>حالة السيرفر:</span><strong>🟢 محلي</strong></div>`;
  }
  if (typeof Device !== 'undefined' && Device.getId) {
    html += `<div class="cart-item"><span>معرّف الجهاز:</span><strong dir="ltr" style="font-size:11px">${Device.getId()}</strong></div>`;
  }
  el.innerHTML = html;
}
