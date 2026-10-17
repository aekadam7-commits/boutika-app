/* ============================================================
   Boutik v4 — المشتريات (مع حركة مخزون)
   ============================================================ */

function renderPurchases() {
  const list = DB.purchases().slice().reverse();
  const tb = document.getElementById('purchasesTable');
  if (!tb) return;
  tb.innerHTML = list.length ? list.map(p => `
    <tr>
      <td>${escapeHtml(p.number)}</td>
      <td>${fmtDateShort(p.created_at)}</td>
      <td>${escapeHtml(p.supplier_name || '—')}</td>
      <td>${fmt(p.total)}</td>
      <td>${p.status === 'paid' ? '✅ مدفوع' : '📝 دين'}</td>
      <td><button class="btn btn-info btn-sm" onclick="viewPurchase('${p.id}')">👁️</button></td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">لا فواتير شراء</td></tr>';
}

let purchaseCart = [];

function openPurchaseModal() {
  purchaseCart = [];
  openModal(`
    <h3>🛒 فاتورة شراء جديدة</h3>
    <label class="lbl">المورد</label>
    <select id="purSupplier">
      <option value="">— اختر مورد —</option>
      ${DB.suppliers().map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
    </select>
    <label class="lbl">إضافة منتج</label>
    <div class="scan-row">
      <input id="purScan" data-scan="modal" dir="ltr" placeholder="امسح الباركود أو اكتب الاسم ثم Enter"
             onkeydown="if(event.key==='Enter'){event.preventDefault();purchaseScanSubmit();}">
      <button type="button" class="btn btn-primary" onclick="openScanner('modal')" title="مسح بالكاميرا">📷</button>
      <button type="button" class="btn btn-info" onclick="startRemoteScanner('barcode', {target:'modal'}, {mode:'stream'})" title="المسح بجهاز آخر">📱</button>
    </div>
    <div class="scan-row">
      <select id="purProduct">
        <option value="">— أو اختر من القائمة —</option>
        ${DB.products().map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-success" onclick="purchaseAddFromSelect()">➕</button>
    </div>
    <div id="purItems" style="max-height:260px;overflow-y:auto"></div>
    <div class="cart-total"><span>المجموع:</span><span id="purTotal">0</span></div>
    <div class="modal-actions">
      <button class="btn btn-success" onclick="savePurchase()">💾 حفظ</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);

  renderPurchaseItems();
  registerModalScan(purchaseScanHandler);
  setTimeout(() => { const i = document.getElementById('purScan'); if (i) i.focus(); }, 50);
}

function purchaseAddProduct(p) {
  const it = purchaseCart.find(x => x.product_id === p.id);
  if (it) it.qty++;
  else purchaseCart.push({ product_id: p.id, name: p.name, qty: 1, cost: +p.cost || 0 });
  renderPurchaseItems();
}

function purchaseTotal() { return purchaseCart.reduce((s, it) => s + it.qty * it.cost, 0); }

function renderPurchaseItems() {
  const el = document.getElementById('purItems');
  if (!el) return;
  el.innerHTML = purchaseCart.length ? purchaseCart.map((it, i) => `
    <div class="cart-item" style="flex-direction:column;align-items:stretch;gap:6px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>${escapeHtml(it.name)}</strong>
        <button class="btn btn-danger btn-sm" onclick="purchaseRemove(${i})">🗑️</button>
      </div>
      <div class="row">
        <div><label class="small">الكمية</label>
          <input type="number" inputmode="numeric" min="1" value="${it.qty}" onchange="purchaseSetField(${i},'qty',this.value)"></div>
        <div><label class="small">سعر الشراء</label>
          <input type="number" inputmode="decimal" min="0" value="${it.cost}" onchange="purchaseSetField(${i},'cost',this.value)"></div>
      </div>
    </div>`).join('') : '<div class="empty">لم تُضف منتجات بعد</div>';
  const t = document.getElementById('purTotal');
  if (t) t.textContent = fmt(purchaseTotal());
}

function purchaseSetField(i, field, v) {
  const it = purchaseCart[i];
  if (!it) return;
  it[field] = Math.max(0, +v || 0);
  if (field === 'qty' && it.qty <= 0) it.qty = 1;
  const t = document.getElementById('purTotal');
  if (t) t.textContent = fmt(purchaseTotal());
}

function purchaseRemove(i) { purchaseCart.splice(i, 1); renderPurchaseItems(); }

function purchaseAddFromSelect() {
  const sel = document.getElementById('purProduct');
  const p = sel && DB.products().find(x => x.id === sel.value);
  if (!p) { toast('اختر منتجًا', true); return; }
  purchaseAddProduct(p);
  sel.value = '';
}

// مسح (كاميرا / USB / جهاز آخر): يضيف المنتج للفاتورة، والمسحة المتكررة تزيد الكمية
function purchaseScanHandler(code) {
  const p = scanFindProduct(code);
  if (!p) { toast('⚠️ منتج غير معروف: ' + code, true); return { ok: false, status: 'unknown', text: '⚠️ غير معروف: ' + code, keepOpen: true }; }
  purchaseAddProduct(p);
  const it = purchaseCart.find(x => x.product_id === p.id);
  return { ok: true, status: 'added', name: p.name, text: '✅ ' + p.name + ' × ' + it.qty, keepOpen: true };
}

// إدخال يدوي: باركود، وإلا بحث بالاسم (أول نتيجة)
function purchaseScanSubmit() {
  const inp = document.getElementById('purScan');
  if (!inp) return;
  const v = inp.value.trim();
  if (!v) return;
  const p = scanFindProduct(v) || DB.products().find(x => (x.name || '').toLowerCase().includes(v.toLowerCase()));
  if (!p) { toast('⚠️ لا نتائج: ' + v, true); return; }
  purchaseAddProduct(p);
  toast('✅ ' + p.name);
  inp.value = '';
}

function savePurchase() {
  const supplierId = document.getElementById('purSupplier').value;
  if (!purchaseCart.length) { toast('أضف منتجًا واحدًا على الأقل', true); return; }
  if (purchaseCart.some(it => it.qty <= 0)) { toast('كمية غير صحيحة', true); return; }

  const supplier = supplierId ? DB.suppliers().find(s => s.id === supplierId) : null;
  const total = purchaseTotal();

  const counter = (DB.counters().purchase || 0) + 1;
  const prefix = DB.settings().purPrefix || 'PUR-';
  const number = prefix + String(counter).padStart(5, '0');

  const purchase = {
    id: uuid(), number,
    supplier_id: supplierId || null,
    supplier_name: supplier ? supplier.name : '—',
    total, paid: 0, status: 'credit',
    created_at: now()
  };
  upsertRow('purchases', purchase);

  purchaseCart.forEach(it => {
    upsertRow('purchaseItems', {
      id: uuid(),
      purchase_id: purchase.id,
      product_id: it.product_id,
      qty: it.qty, cost: it.cost,
      subtotal: it.qty * it.cost
    });
    const product = DB.products().find(x => x.id === it.product_id);
    if (product) {
      const before = product.qty || 0;
      product.qty = before + it.qty;
      product.cost = it.cost;
      upsertRow('products', product);
      if (typeof recordStockMovement === 'function') {
        recordStockMovement(product.id, product.name, 'in', it.qty, before, product.qty, `فاتورة شراء ${number}`);
      }
    }
  });

  if (supplier) {
    supplier.balance = (supplier.balance || 0) + total;
    upsertRow('suppliers', supplier);
  }

  const counters = DB.counters();
  counters.purchase = counter;
  DB.setObj('counters', counters);

  audit('purchase', number + ' — ' + fmt(total));
  purchaseCart = [];
  closeModal();
  renderPurchases();
  toast('✅ تم الحفظ');
}

function viewPurchase(id) {
  const p = DB.purchases().find(x => x.id === id);
  if (!p) return;
  const items = DB.purchaseItems().filter(i => i.purchase_id === id);
  openModal(`
    <h3>🛒 ${p.number}</h3>
    <div class="small">${fmtDate(p.created_at)}</div>
    <div class="small">المورد: ${escapeHtml(p.supplier_name)}</div>
    <table style="margin-top:10px">
      <thead><tr><th>منتج</th><th>كمية</th><th>سعر</th></tr></thead>
      <tbody>${items.map(it => {
        const pr = DB.products().find(x => x.id === it.product_id);
        return `<tr><td>${pr ? escapeHtml(pr.name) : '—'}</td><td>${it.qty}</td><td>${fmt(it.cost)}</td></tr>`;
      }).join('')}</tbody>
    </table>
    <div class="cart-total"><span>المجموع:</span><span>${fmt(p.total)}</span></div>
    <div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">إغلاق</button></div>
  `);
}
