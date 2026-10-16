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

function openPurchaseModal() {
  openModal(`
    <h3>🛒 فاتورة شراء جديدة</h3>
    <label class="lbl">المورد</label>
    <select id="purSupplier">
      <option value="">— اختر مورد —</option>
      ${DB.suppliers().map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
    </select>
    <label class="lbl">المنتج</label>
    <select id="purProduct">
      <option value="">— اختر منتج —</option>
      ${DB.products().map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
    </select>
    <div class="row">
      <div><label class="lbl">الكمية</label><input id="purQty" type="number" value="1"></div>
      <div><label class="lbl">سعر الشراء</label><input id="purCost" type="number" value="0"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-success" onclick="savePurchase()">💾 حفظ</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function savePurchase() {
  const supplierId = document.getElementById('purSupplier').value;
  const productId = document.getElementById('purProduct').value;
  const qty = +document.getElementById('purQty').value || 0;
  const cost = +document.getElementById('purCost').value || 0;
  if (!productId || qty <= 0) { toast('اختر منتجًا وكمية صحيحة', true); return; }

  const product = DB.products().find(p => p.id === productId);
  const supplier = supplierId ? DB.suppliers().find(s => s.id === supplierId) : null;
  const total = qty * cost;

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

  upsertRow('purchaseItems', {
    id: uuid(),
    purchase_id: purchase.id,
    product_id: productId,
    qty, cost,
    subtotal: total
  });

  if (product) {
    const before = product.qty || 0;
    product.qty = before + qty;
    product.cost = cost;
    upsertRow('products', product);
    if (typeof recordStockMovement === 'function') {
      recordStockMovement(product.id, product.name, 'in', qty, before, product.qty, `فاتورة شراء ${number}`);
    }
  }

  if (supplier) {
    supplier.balance = (supplier.balance || 0) + total;
    upsertRow('suppliers', supplier);
  }

  const counters = DB.counters();
  counters.purchase = counter;
  DB.setObj('counters', counters);

  audit('purchase', number + ' — ' + fmt(total));
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
