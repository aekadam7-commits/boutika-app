/* ============================================================
   Boutik v4 — نقطة البيع (خصومات + حاسبة + حجز + ➕➖)
   ============================================================ */

let cart = [];
let payType = 'cash';
let remoteScanListenerRegistered = false;
let invoiceDiscount = { type: 'none', value: 0 };
let calcState = { display: '0', prev: null, op: null, waitNext: false };

function renderPOSCustomers() {
  const sel = document.getElementById('posCustomer');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">زبون عادي</option>' +
    DB.customers().map(c => {
      const disc = c.discount ? ' [خصم ' + c.discount + '%]' : '';
      return `<option value="${c.id}">${escapeHtml(c.name)}${disc} (${fmtNum(c.balance || 0)})</option>`;
    }).join('');
  if (cur) sel.value = cur;
}

function registerRemoteScanListener() {
  if (remoteScanListenerRegistered) return;
  if (typeof Sync === 'undefined' || !Sync.onScan) return;
  Sync.onScan((barcode) => {
    const p = DB.products().find(x => x.barcode === barcode);
    if (p) { addToCart(p.id); toast('📡 مسح بعيد: ' + p.name); playSuccessBeep(); vibrate([60, 30, 60]); }
    else { toast('📡 مسح بعيد — منتج غير معروف: ' + barcode, true); playErrorBeep(); }
  });
  remoteScanListenerRegistered = true;
}

function searchPOS() {
  const q = (document.getElementById('posSearch').value || '').trim().toLowerCase();
  const res = document.getElementById('posResults');
  if (!q) { res.innerHTML = ''; return; }
  const products = DB.products().filter(p =>
    (p.name && p.name.toLowerCase().includes(q)) || (p.barcode && p.barcode.toLowerCase().includes(q))
  ).slice(0, 20);
  if (!products.length) { res.innerHTML = '<div class="empty">لا نتائج</div>'; return; }
  res.innerHTML = products.map(p => {
    const isExp = typeof isExpired === 'function' && isExpired(p);
    return `<div class="cart-item" onclick="addToCart('${p.id}')" style="cursor:pointer;${isExp ? 'background:#ffecec;' : ''}">
      <div><strong>${escapeHtml(p.name)} ${isExp ? '🚨' : ''}</strong>
      <div class="small">${escapeHtml(p.barcode || '')} — ${fmt(p.price)}</div></div>
      <div><b>${p.qty}</b></div></div>`;
  }).join('');
}

function addToCart(productId) {
  const p = DB.products().find(x => x.id === productId);
  if (!p) return;
  if (p.qty <= 0) { toast('⚠️ الكمية نفدت', true); return; }
  const item = cart.find(x => x.product_id === productId);
  if (item) {
    if (item.qty + 1 > p.qty) { toast('⚠️ الكمية غير كافية (متوفر: ' + p.qty + ')', true); return; }
    item.qty++;
  } else {
    cart.push({ product_id: p.id, name: p.name, barcode: p.barcode || '', price: p.price, cost: p.cost || 0, qty: 1 });
  }
  renderCart();
}

function increaseQty(index) {
  const item = cart[index];
  if (!item) return;
  if (item.product_id) {
    const p = DB.products().find(x => x.id === item.product_id);
    if (p && item.qty + 1 > p.qty) { toast('⚠️ الكمية غير كافية', true); return; }
  }
  item.qty++;
  renderCart();
}

function decreaseQty(index) {
  const item = cart[index];
  if (!item) return;
  item.qty--;
  if (item.qty <= 0) cart.splice(index, 1);
  renderCart();
}

function setQty(index, value) {
  const item = cart[index];
  if (!item) return;
  let qty = parseInt(value) || 0;
  if (qty <= 0) { cart.splice(index, 1); }
  else {
    if (item.product_id) {
      const p = DB.products().find(x => x.id === item.product_id);
      if (p && qty > p.qty) { toast('⚠️ الكمية أكبر من المخزون', true); qty = p.qty; }
    }
    item.qty = qty;
  }
  renderCart();
}

function removeFromCart(index) { cart.splice(index, 1); renderCart(); }

function openDiscountModal() {
  const subtotal = subtotalCart();
  openModal(`
    <h3>💸 خصم على الفاتورة</h3>
    <div class="cart-item"><span>المجموع الحالي:</span><strong>${fmt(subtotal)}</strong></div>
    <label class="lbl">نوع الخصم</label>
    <select id="discType" onchange="onDiscTypeChange()">
      <option value="none">بدون</option>
      <option value="percent">نسبة %</option>
      <option value="amount">مبلغ ثابت</option>
    </select>
    <div id="discValueWrap" style="display:none">
      <label class="lbl">القيمة</label>
      <input id="discValue" type="number" inputmode="decimal" value="0" min="0">
    </div>
    <div class="modal-actions">
      <button class="btn btn-success" onclick="applyDiscount()">✅ تطبيق</button>
      <button class="btn btn-danger" onclick="clearDiscount()">❌ إلغاء</button>
    </div>`);
}

function onDiscTypeChange() {
  const t = document.getElementById('discType').value;
  const wrap = document.getElementById('discValueWrap');
  if (wrap) wrap.style.display = t === 'none' ? 'none' : 'block';
}

function applyDiscount() {
  const t = document.getElementById('discType').value;
  const v = +document.getElementById('discValue').value || 0;
  if (t === 'none' || v <= 0) invoiceDiscount = { type: 'none', value: 0 };
  else invoiceDiscount = { type: t, value: v };
  closeModal();
  renderCart();
  toast('✅ تم تطبيق الخصم');
}

function clearDiscount() {
  invoiceDiscount = { type: 'none', value: 0 };
  closeModal();
  renderCart();
  toast('🗑️ تم إلغاء الخصم');
}

function customerDiscount() {
  const cid = document.getElementById('posCustomer')?.value;
  if (!cid) return 0;
  const c = DB.customers().find(x => x.id === cid);
  return c && c.discount ? +c.discount : 0;
}

function subtotalCart() {
  return cart.reduce((s, it) => s + it.price * it.qty, 0);
}

function discountAmount() {
  const subtotal = subtotalCart();
  let amt = 0;
  const cd = customerDiscount();
  if (cd > 0) amt += subtotal * (cd / 100);
  if (invoiceDiscount.type === 'percent') amt += subtotal * (invoiceDiscount.value / 100);
  else if (invoiceDiscount.type === 'amount') amt += invoiceDiscount.value;
  return Math.min(amt, subtotal);
}

function totalCart() { return Math.max(0, subtotalCart() - discountAmount()); }

function openCalculator() {
  calcState = { display: '0', prev: null, op: null, waitNext: false };
  openModal(`
    <h3>🧮 آلة حاسبة</h3>
    <div style="background:#172033;color:#0f0;font-family:monospace;font-size:32px;text-align:right;padding:18px;border-radius:12px;margin-bottom:12px;direction:ltr;overflow:hidden;word-break:break-all" id="calcDisplay">0</div>
    <div class="calc-grid">
      <button class="calc-btn calc-fn" onclick="calcClear()">C</button>
      <button class="calc-btn calc-fn" onclick="calcBack()">⌫</button>
      <button class="calc-btn calc-fn" onclick="calcOp('%')">%</button>
      <button class="calc-btn calc-op" onclick="calcOp('÷')">÷</button>
      <button class="calc-btn" onclick="calcNum('7')">7</button>
      <button class="calc-btn" onclick="calcNum('8')">8</button>
      <button class="calc-btn" onclick="calcNum('9')">9</button>
      <button class="calc-btn calc-op" onclick="calcOp('×')">×</button>
      <button class="calc-btn" onclick="calcNum('4')">4</button>
      <button class="calc-btn" onclick="calcNum('5')">5</button>
      <button class="calc-btn" onclick="calcNum('6')">6</button>
      <button class="calc-btn calc-op" onclick="calcOp('-')">−</button>
      <button class="calc-btn" onclick="calcNum('1')">1</button>
      <button class="calc-btn" onclick="calcNum('2')">2</button>
      <button class="calc-btn" onclick="calcNum('3')">3</button>
      <button class="calc-btn calc-op" onclick="calcOp('+')">+</button>
      <button class="calc-btn calc-wide" onclick="calcNum('0')">0</button>
      <button class="calc-btn" onclick="calcNum('.')">.</button>
      <button class="calc-btn calc-eq" onclick="calcEquals()">=</button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-success" onclick="calcToCart()">➕ إضافة للسلة</button>
      <button class="btn btn-danger" onclick="closeModal()">إغلاق</button>
    </div>
  `);
}

function calcRefresh() { const el = document.getElementById('calcDisplay'); if (el) el.textContent = calcState.display; }

function calcNum(n) {
  if (calcState.waitNext) { calcState.display = n === '.' ? '0.' : n; calcState.waitNext = false; }
  else {
    if (n === '.' && calcState.display.includes('.')) return;
    calcState.display = calcState.display === '0' && n !== '.' ? n : calcState.display + n;
    if (calcState.display.length > 14) calcState.display = calcState.display.slice(0, 14);
  }
  calcRefresh();
}

function calcOp(op) {
  if (op === '%') { calcState.display = String((parseFloat(calcState.display) || 0) / 100); calcRefresh(); return; }
  const cur = parseFloat(calcState.display) || 0;
  if (calcState.prev !== null && calcState.op && !calcState.waitNext) {
    calcState.prev = calcCompute(calcState.prev, cur, calcState.op);
    calcState.display = String(calcState.prev);
  } else { calcState.prev = cur; }
  calcState.op = op;
  calcState.waitNext = true;
  calcRefresh();
}

function calcCompute(a, b, op) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? 0 : a / b;
    default: return b;
  }
}

function calcEquals() {
  if (calcState.prev === null || !calcState.op) return;
  const cur = parseFloat(calcState.display) || 0;
  calcState.display = String(calcCompute(calcState.prev, cur, calcState.op));
  calcState.prev = null;
  calcState.op = null;
  calcState.waitNext = true;
  calcRefresh();
}

function calcClear() { calcState = { display: '0', prev: null, op: null, waitNext: false }; calcRefresh(); }
function calcBack() { calcState.display = calcState.display.length > 1 ? calcState.display.slice(0, -1) : '0'; calcRefresh(); }

function calcToCart() {
  const v = parseFloat(calcState.display) || 0;
  if (v <= 0) { toast('القيمة صفر', true); return; }
  cart.push({ product_id: null, name: 'من الحاسبة', price: v, cost: 0, qty: 1, free: true });
  closeModal();
  renderCart();
  toast('✅ تمت الإضافة: ' + fmt(v));
}

function addFreeItem() {
  openModal(`
    <h3>➕ مادة حرة</h3>
    <label class="lbl">الاسم</label><input id="freeName">
    <label class="lbl">السعر</label><input id="freePrice" type="number" inputmode="decimal" value="0">
    <label class="lbl">الكمية</label><input id="freeQty" type="number" inputmode="numeric" value="1">
    <label class="lbl">سعر الشراء</label><input id="freeCost" type="number" inputmode="decimal" value="0">
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="confirmFreeItem()">إضافة</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function confirmFreeItem() {
  const name = document.getElementById('freeName').value.trim();
  const price = +document.getElementById('freePrice').value || 0;
  const qty = +document.getElementById('freeQty').value || 1;
  const cost = +document.getElementById('freeCost').value || 0;
  if (!name) return;
  cart.push({ product_id: null, name, price, cost, qty, free: true });
  renderCart();
  closeModal();
}

function addCashLoan() {
  openModal(`
    <h3>💵 سلفة مالية</h3>
    <label class="lbl">المبلغ</label><input id="loanAmt" type="number" inputmode="decimal" value="0">
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="confirmCashLoan()">إضافة</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function confirmCashLoan() {
  const amt = +document.getElementById('loanAmt').value || 0;
  if (!amt) return;
  cart.push({ product_id: null, name: 'سلفة مالية', price: amt, cost: 0, qty: 1, loan: true });
  renderCart();
  closeModal();
}

function renderCart() {
  const el = document.getElementById('cartItems');
  const countEl = document.getElementById('cartCount');
  const totalEl = document.getElementById('cartTotal');
  const discEl = document.getElementById('cartDiscount');
  const subEl = document.getElementById('cartSubtotal');
  if (!el) return;

  if (!cart.length) {
    el.innerHTML = '<div class="empty">السلة فارغة</div>';
    if (countEl) countEl.textContent = '0';
    if (totalEl) totalEl.textContent = fmt(0);
    if (discEl) discEl.innerHTML = '';
    if (subEl) subEl.innerHTML = '';
    return;
  }

  el.innerHTML = cart.map((it, i) => `
    <div class="cart-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:10px 4px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong style="font-size:14px">${escapeHtml(it.name)}</strong>
        <button class="btn btn-danger btn-sm" onclick="removeFromCart(${i})" title="حذف" style="padding:4px 8px;font-size:12px">🗑️</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="display:flex;align-items:center;gap:6px;flex:1">
          <button class="btn btn-warning btn-sm" onclick="decreaseQty(${i})" style="min-width:34px;padding:6px 10px;font-size:16px;font-weight:700">➖</button>
          <input type="number" value="${it.qty}" onchange="setQty(${i}, this.value)" oninput="setQty(${i}, this.value)"
                 style="width:60px;text-align:center;padding:6px;font-size:14px;font-weight:700;border:1px solid var(--border);border-radius:8px;background:var(--bg-2);color:var(--text)"
                 inputmode="numeric" min="1">
          <button class="btn btn-success btn-sm" onclick="increaseQty(${i})" style="min-width:34px;padding:6px 10px;font-size:16px;font-weight:700">➕</button>
        </div>
        <div style="text-align:left;font-size:13px">
          <div class="small">${fmt(it.price)} × ${it.qty}</div>
          <b style="color:#138a45">${fmt(it.price * it.qty)}</b>
        </div>
      </div>
    </div>
  `).join('');

  const subtotal = subtotalCart();
  const disc = discountAmount();
  const total = Math.max(0, subtotal - disc);
  const count = cart.reduce((s, it) => s + it.qty, 0);
  if (countEl) countEl.textContent = count;

  if (subEl) {
    if (disc > 0) {
      subEl.innerHTML = `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px;color:#666"><span>المجموع الفرعي:</span><span>${fmt(subtotal)}</span></div>`;
    } else { subEl.innerHTML = ''; }
  }
  if (discEl) {
    if (disc > 0) {
      const cd = customerDiscount();
      let label = 'الخصم';
      if (cd > 0) label += ' (زبون مميز ' + cd + '%)';
      if (invoiceDiscount.type === 'percent') label += ' + ' + invoiceDiscount.value + '%';
      else if (invoiceDiscount.type === 'amount') label += ' + ' + fmt(invoiceDiscount.value);
      discEl.innerHTML = `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px;color:#e74c3c"><span>${label}:</span><span>-${fmt(disc)}</span></div>`;
    } else { discEl.innerHTML = ''; }
  }
  if (totalEl) totalEl.textContent = fmt(total);
}

function setPayType(t) {
  payType = t;
  document.querySelectorAll('.payment-options button').forEach(b => {
    b.classList.toggle('active', b.dataset.pay === t);
  });
  const pf = document.getElementById('partialField');
  if (pf) pf.classList.toggle('hidden', t !== 'partial');
  if (t === 'partial') {
    const paid = document.getElementById('posPaid');
    if (paid && !paid.value) paid.value = totalCart();
  }
}

function checkExpiredInCart() {
  const expired = cart.filter(it => {
    if (!it.product_id) return false;
    const p = DB.products().find(x => x.id === it.product_id);
    return p && typeof isExpired === 'function' && isExpired(p);
  });
  if (expired.length) {
    const names = expired.map(e => e.name).join(', ');
    if (!confirm(`⚠️ تحذير: المنتجات التالية منتهية الصلاحية:\n\n${names}\n\nمتابعة البيع؟`)) return false;
  }
  return true;
}

function finalizeSale() {
  if (!cart.length) { toast('السلة فارغة', true); return; }
  if (!currentShift) { toast('⚠️ يجب فتح وردية أولًا', true); return; }
  if (!checkExpiredInCart()) return;

  const subtotal = subtotalCart();
  const disc = discountAmount();
  const total = Math.max(0, subtotal - disc);
  const customerId = document.getElementById('posCustomer').value;
  let paid = total, due = 0;

  if (payType === 'credit') {
    if (!customerId) { toast('⚠️ اختر زبونًا للبيع بالدين', true); return; }
    paid = 0; due = total;
  } else if (payType === 'partial') {
    paid = +document.getElementById('posPaid').value || 0;
    due = Math.max(0, total - paid);
    if (due > 0 && !customerId) { toast('⚠️ اختر زبونًا', true); return; }
  }

  const settings = DB.settings();
  const counter = (DB.counters().invoice || 0) + 1;
  const invoiceNumber = (settings.invPrefix || 'INV-') + String(counter).padStart(5, '0');

  const invoice = {
    id: uuid(), number: invoiceNumber, type: 'sale',
    customer_id: customerId || null,
    customer_name: customerId ? (DB.customers().find(c => c.id === customerId) || {}).name : 'زبون عادي',
    subtotal: subtotal, discount: disc,
    discount_type: invoiceDiscount.type, discount_value: invoiceDiscount.value,
    customer_discount_pct: customerDiscount(),
    total: total, paid: paid, due: due,
    status: due === 0 ? 'paid' : (paid === 0 ? 'credit' : 'partial'),
    user: currentUser.username,
    shift_id: currentShift.id,
    created_at: now()
  };
  upsertRow('invoices', invoice);

  cart.forEach(it => {
    upsertRow('invoiceItems', {
      id: uuid(), invoice_id: invoice.id,
      product_id: it.product_id, name: it.name,
      price: it.price, cost: it.cost, qty: it.qty,
      subtotal: it.price * it.qty
    });

    if (it.product_id) {
      const p = DB.products().find(x => x.id === it.product_id);
      if (p) {
        const before = p.qty || 0;
        p.qty = Math.max(0, before - it.qty);
        upsertRow('products', p);
        if (typeof recordStockMovement === 'function') {
          recordStockMovement(p.id, p.name, 'out', it.qty, before, p.qty, `بيع ${invoiceNumber}`);
        }
      }
    }
  });

  if (customerId && due > 0) {
    const c = DB.customers().find(x => x.id === customerId);
    if (c) { c.balance = (c.balance || 0) + due; upsertRow('customers', c); }
  }

  const counters = DB.counters();
  counters.invoice = counter;
  DB.setObj('counters', counters);

  audit('sale', invoiceNumber + ' — ' + fmt(total));
  toast('✅ تم البيع: ' + invoiceNumber);

  const invoiceId = invoice.id;
  cart = [];
  payType = 'cash';
  invoiceDiscount = { type: 'none', value: 0 };
  setPayType('cash');
  renderCart();
  refreshAll();

  setTimeout(() => {
    if (typeof printInvoice === 'function') printInvoice(invoiceId);
  }, 500);
}
