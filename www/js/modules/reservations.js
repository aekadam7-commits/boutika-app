/* ============================================================
   Boutik v4 — حجز المنتجات
   ============================================================ */

function renderReservations() {
  const el = document.getElementById('reservationsList');
  if (!el) return;

  const list = DB.get('reservations').filter(r => r.status === 'active' || r.status === 'delivered').slice().reverse();
  const active = list.filter(r => r.status === 'active');
  const totalActive = active.reduce((s, r) => s + r.total, 0);

  el.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="label">حجوزات نشطة</div><div class="value">${active.length}</div></div>
      <div class="stat"><div class="label">قيمة الحجوزات</div><div class="value">${fmt(totalActive)}</div></div>
    </div>
    ${list.length ? list.map(r => {
      const statusLabel = r.status === 'delivered' ? '✅ مُسلَّم' : '🟢 نشط';
      const statusColor = r.status === 'delivered' ? '#138a45' : '#27ae60';
      return `
        <div class="card" style="border-right:4px solid ${statusColor}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong>#${escapeHtml(r.number)} — ${escapeHtml(r.customer_name || 'زبون')}</strong>
            <span style="color:${statusColor};font-weight:700">${statusLabel}</span>
          </div>
          <div class="small" style="margin-bottom:8px">🕐 ${fmtDate(r.created_at)}</div>
          <div style="background:var(--bg);padding:10px;border-radius:8px;margin-bottom:8px">
            ${r.items.map(it => `
              <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px">
                <span>${escapeHtml(it.name)} × ${it.qty}</span>
                <b>${fmt(it.price * it.qty)}</b>
              </div>
            `).join('')}
          </div>
          <div class="cart-item"><span>الإجمالي:</span><strong>${fmt(r.total)}</strong></div>
          <div class="cart-item"><span>المدفوع:</span><strong style="color:#138a45">${fmt(r.paid)}</strong></div>
          <div class="cart-item"><span>الباقي:</span><strong style="color:#e74c3c">${fmt(r.due)}</strong></div>
          ${r.status === 'active' ? `
            <div class="flex-actions" style="margin-top:10px">
              <button class="btn btn-success btn-sm" onclick="deliverReservation('${r.id}')">✅ تسليم</button>
              <button class="btn btn-warning btn-sm" onclick="openPayReservationModal('${r.id}')">💰 دفعة</button>
              <button class="btn btn-danger btn-sm" onclick="cancelReservation('${r.id}')">❌ إلغاء</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('') : '<div class="empty">لا حجوزات</div>'}
  `;
}

function createReservation() {
  if (!cart.length) { toast('السلة فارغة', true); return; }
  const customerId = document.getElementById('posCustomer')?.value;
  if (!customerId) { toast('⚠️ اختر زبونًا للحجز', true); return; }

  const c = DB.customers().find(x => x.id === customerId);
  const total = cart.reduce((s, it) => s + it.price * it.qty, 0);

  openModal(`
    <h3>📦 حجز منتجات</h3>
    <div class="cart-item"><span>الزبون:</span><strong>${escapeHtml(c.name)}</strong></div>
    <div class="cart-item"><span>عدد المنتجات:</span><strong>${cart.length}</strong></div>
    <div class="cart-item"><span>الإجمالي:</span><strong>${fmt(total)}</strong></div>
    <label class="lbl">دفعة مقدّمة (اختياري)</label>
    <input id="resPaid" type="number" inputmode="decimal" value="0" min="0" max="${total}">
    <label class="lbl">تاريخ الانتهاء (اختياري)</label>
    <input id="resExpiry" type="date">
    <label class="lbl">ملاحظات</label>
    <input id="resNote" placeholder="مثال: سيأتي غدًا">
    <div class="modal-actions">
      <button class="btn btn-success" onclick="confirmReservation()">💾 حفظ</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>
  `);
}

function confirmReservation() {
  const customerId = document.getElementById('posCustomer')?.value;
  if (!customerId) return;
  const c = DB.customers().find(x => x.id === customerId);
  const total = cart.reduce((s, it) => s + it.price * it.qty, 0);
  let paid = +document.getElementById('resPaid').value || 0;
  if (paid > total) paid = total;
  const due = total - paid;
  const expiry = document.getElementById('resExpiry').value || null;
  const note = (document.getElementById('resNote').value || '').trim();

  const counter = (DB.counters().reservation || 0) + 1;
  const number = 'RES-' + String(counter).padStart(5, '0');

  const reservation = {
    id: uuid(), number,
    customer_id: customerId,
    customer_name: c.name,
    items: cart.map(it => ({
      product_id: it.product_id, name: it.name,
      price: it.price, cost: it.cost, qty: it.qty
    })),
    total, paid, due,
    status: 'active',
    expiry: expiry, note: note,
    user: currentUser.username,
    created_at: now(),
    _updated_at: Date.now()
  };

  cart.forEach(it => {
    if (it.product_id) {
      const p = DB.products().find(x => x.id === it.product_id);
      if (p) {
        const before = p.qty || 0;
        p.qty = Math.max(0, before - it.qty);
        upsertRow('products', p);
        if (typeof recordStockMovement === 'function') {
          recordStockMovement(p.id, p.name, 'out', it.qty, before, p.qty, `حجز ${number}`);
        }
      }
    }
  });

  if (due > 0) {
    c.balance = (c.balance || 0) + due;
    upsertRow('customers', c);
  }

  const reservations = DB.get('reservations');
  reservations.push(reservation);
  DB.set('reservations', reservations);

  const counters = DB.counters();
  counters.reservation = counter;
  DB.setObj('counters', counters);

  audit('reservation', `${number} — ${c.name}`);
  cart = [];
  if (typeof renderCart === 'function') renderCart();
  closeModal();
  toast('✅ تم الحجز: ' + number);
  if (typeof refreshAll === 'function') refreshAll();
}

function deliverReservation(id) {
  const reservations = DB.get('reservations');
  const r = reservations.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`تسليم الحجز #${r.number}؟`)) return;

  r.status = 'delivered';
  r.delivered_at = now();
  r._updated_at = Date.now();

  const settings = DB.settings();
  const counter = (DB.counters().invoice || 0) + 1;
  const invoiceNumber = (settings.invPrefix || 'INV-') + String(counter).padStart(5, '0');

  const invoice = {
    id: uuid(), number: invoiceNumber, type: 'sale',
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    subtotal: r.total, discount: 0, total: r.total,
    paid: r.paid, due: r.due,
    status: r.due === 0 ? 'paid' : (r.paid === 0 ? 'credit' : 'partial'),
    reservation_id: r.id,
    user: currentUser.username,
    shift_id: currentShift ? currentShift.id : null,
    created_at: now()
  };
  upsertRow('invoices', invoice);

  r.items.forEach(it => {
    upsertRow('invoiceItems', {
      id: uuid(), invoice_id: invoice.id,
      product_id: it.product_id, name: it.name,
      price: it.price, cost: it.cost, qty: it.qty,
      subtotal: it.price * it.qty
    });
  });

  const counters = DB.counters();
  counters.invoice = counter;
  DB.setObj('counters', counters);

  DB.set('reservations', reservations);
  audit('reservation_deliver', r.number);
  toast('✅ تم التسليم — فاتورة: ' + invoiceNumber);
  renderReservations();
}

function cancelReservation(id) {
  const reservations = DB.get('reservations');
  const r = reservations.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`إلغاء الحجز #${r.number}؟`)) return;

  r.items.forEach(it => {
    if (it.product_id) {
      const p = DB.products().find(x => x.id === it.product_id);
      if (p) {
        const before = p.qty || 0;
        p.qty = before + it.qty;
        upsertRow('products', p);
        if (typeof recordStockMovement === 'function') {
          recordStockMovement(p.id, p.name, 'in', it.qty, before, p.qty, `إلغاء حجز ${r.number}`);
        }
      }
    }
  });

  if (r.due > 0) {
    const c = DB.customers().find(x => x.id === r.customer_id);
    if (c) {
      c.balance = Math.max(0, (c.balance || 0) - r.due);
      upsertRow('customers', c);
    }
  }

  r.status = 'cancelled';
  r.cancelled_at = now();
  r._updated_at = Date.now();
  DB.set('reservations', reservations);

  audit('reservation_cancel', r.number);
  toast('🗑️ تم إلغاء الحجز');
  renderReservations();
}

function openPayReservationModal(id) {
  const r = DB.get('reservations').find(x => x.id === id);
  if (!r) return;
  openModal(`
    <h3>💰 دفعة على الحجز #${escapeHtml(r.number)}</h3>
    <div class="cart-item"><span>الباقي:</span><strong style="color:#e74c3c">${fmt(r.due)}</strong></div>
    <label class="lbl">المبلغ</label>
    <input id="resPayAmt" type="number" inputmode="decimal" value="${r.due}" min="0" max="${r.due}">
    <div class="modal-actions">
      <button class="btn btn-success" onclick="confirmPayReservation('${id}')">💾</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function confirmPayReservation(id) {
  const reservations = DB.get('reservations');
  const r = reservations.find(x => x.id === id);
  if (!r) return;
  let amt = +document.getElementById('resPayAmt').value || 0;
  if (amt <= 0) return;
  if (amt > r.due) amt = r.due;

  r.paid += amt;
  r.due -= amt;
  r._updated_at = Date.now();
  DB.set('reservations', reservations);

  if (r.customer_id) {
    const c = DB.customers().find(x => x.id === r.customer_id);
    if (c) {
      c.balance = Math.max(0, (c.balance || 0) - amt);
      upsertRow('customers', c);
    }
  }

  audit('reservation_payment', `${r.number} — ${fmt(amt)}`);
  closeModal();
  toast('✅ تم تسجيل الدفعة');
  renderReservations();
}
