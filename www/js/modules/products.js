/* ============================================================
   Boutik v4 — المنتجات (إضافة كمية + سجل حركات + بحث تلقائي)
   ============================================================ */

function renderProducts() {
  const q = (document.getElementById('prodSearch')?.value || '').trim().toLowerCase();
  const catFilter = document.getElementById('prodFilterCategory')?.value || '';
  const statusFilter = document.getElementById('prodFilterStatus')?.value || '';

  let list = DB.products();
  if (q) list = list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.barcode || '').includes(q));
  if (catFilter) list = list.filter(p => p.category === catFilter);
  if (statusFilter === 'low') list = list.filter(p => p.qty > 0 && p.qty <= (p.min_qty || 5));
  if (statusFilter === 'out') list = list.filter(p => p.qty <= 0);
  if (statusFilter === 'expiring') list = list.filter(isExpiringSoon);
  if (statusFilter === 'expired') list = list.filter(isExpired);

  const tb = document.getElementById('productsTable');
  if (!tb) return;
  tb.innerHTML = list.length ? list.map(p => {
    const isExp = typeof isExpired === 'function' && isExpired(p);
    const rowStyle = isExp ? 'background:#ffecec;' : '';
    return `
    <tr style="${rowStyle}">
      <td dir="ltr">${escapeHtml(p.barcode || '—')}</td>
      <td>${escapeHtml(p.name)} ${isExp ? '🚨' : ''}</td>
      <td>${escapeHtml(p.category || '—')}</td>
      <td style="color:${p.qty <= 0 ? '#e74c3c' : (p.qty <= (p.min_qty || 5) ? '#f39c12' : '#138a45')};font-weight:700">${p.qty}</td>
      <td>${fmt(p.price)}</td>
      <td>${p.expiry_date ? fmtDateShort(p.expiry_date) : '—'}</td>
      <td>
        <button class="btn btn-success btn-sm" onclick="openAddQtyModal('${p.id}')" title="إضافة كمية">➕</button>
        <button class="btn btn-info btn-sm" onclick="openProductModal('${p.id}')" title="تعديل">✏️</button>
        <button class="btn btn-warning btn-sm" onclick="openStockHistory('${p.id}')" title="سجل الحركات">📜</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')" title="حذف">🗑️</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">لا توجد منتجات</td></tr>';

  const sel = document.getElementById('prodFilterCategory');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">كل الفئات</option>' +
      DB.categories().map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
    sel.value = cur;
  }
}

function openAddQtyModal(id) {
  const p = DB.products().find(x => x.id === id);
  if (!p) return;
  openModal(`
    <h3>➕ إضافة كمية — ${escapeHtml(p.name)}</h3>
    <div style="background:var(--bg);padding:10px;border-radius:8px;margin-bottom:12px;font-size:13px">
      <div style="display:flex;justify-content:space-between"><span>الكمية الحالية:</span><b>${p.qty}</b></div>
    </div>
    <label class="lbl">الكمية المضافة</label>
    <input id="addQtyVal" type="number" inputmode="numeric" value="0" min="1">
    <label class="lbl">سعر الشراء (اختياري)</label>
    <input id="addQtyCost" type="number" inputmode="decimal" value="${p.cost || 0}">
    <label class="lbl">ملاحظة (اختياري)</label>
    <input id="addQtyNote" placeholder="مثال: شراء من المورد">
    <div class="modal-actions">
      <button class="btn btn-success" onclick="confirmAddQty('${id}')">💾 حفظ</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function confirmAddQty(id) {
  const p = DB.products().find(x => x.id === id);
  if (!p) return;
  const qty = +document.getElementById('addQtyVal').value || 0;
  if (qty <= 0) { toast('أدخل كمية صحيحة', true); return; }
  const cost = +document.getElementById('addQtyCost').value || p.cost || 0;
  const note = (document.getElementById('addQtyNote').value || '').trim();

  const before = p.qty || 0;
  p.qty = before + qty;
  if (cost) p.cost = cost;
  upsertRow('products', p);

  if (typeof recordStockMovement === 'function') {
    recordStockMovement(p.id, p.name, 'in', qty, before, p.qty, note || 'إضافة يدوية');
  }

  audit('stock_add', `${p.name} +${qty}`);
  toast(`✅ تمت إضافة ${qty} (المخزون: ${p.qty})`);
  closeModal();
  renderProducts();
}

function recordStockMovement(productId, productName, type, qty, before, after, reason) {
  try {
    const movements = DB.get('stockMovements');
    movements.push({
      id: uuid(),
      product_id: productId,
      product_name: productName,
      type: type,
      qty: qty,
      before: before,
      after: after,
      reason: reason || '',
      user: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.username : 'system',
      created_at: now()
    });
    if (movements.length > 5000) movements.splice(0, movements.length - 5000);
    localStorage.setItem(DB.PREFIX + 'stockMovements', JSON.stringify(movements));
  } catch (e) { console.error('recordStockMovement:', e); }
}

function openStockHistory(id) {
  const p = DB.products().find(x => x.id === id);
  if (!p) return;
  const list = DB.stockMovements().filter(m => m.product_id === id).slice().reverse();

  openModal(`
    <h3>📜 حركات — ${escapeHtml(p.name)}</h3>
    <div style="max-height:400px;overflow-y:auto">
      ${list.length ? list.map(m => {
        const color = m.type === 'in' ? '#138a45' : (m.type === 'out' ? '#e74c3c' : '#f39c12');
        const sign = m.type === 'in' ? '+' : (m.type === 'out' ? '-' : '=');
        const label = m.type === 'in' ? '🟢 إضافة' : (m.type === 'out' ? '🔴 خصم' : '🟡 تعديل');
        return `
          <div class="cart-item">
            <div>
              <strong style="color:${color}">${label} ${sign}${m.qty}</strong>
              <div class="small">${m.before} → ${m.after} | ${escapeHtml(m.reason || '')}</div>
              <div class="small">${fmtDate(m.created_at)} — ${escapeHtml(m.user || '')}</div>
            </div>
          </div>`;
      }).join('') : '<div class="empty">لا توجد حركات</div>'}
    </div>
    <div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">إغلاق</button></div>
  `);
}

function onProductBarcodeChange(barcode) {
  barcode = (barcode || '').trim();
  if (!barcode) return;
  const existing = DB.products().find(p => p.barcode === barcode);
  const infoEl = document.getElementById('pBarcodeInfo');
  if (!infoEl) return;

  if (existing) {
    infoEl.innerHTML = `<div style="background:#fff3cd;color:#856404;padding:10px;border-radius:8px;margin:8px 0;font-size:13px">
      ⚠️ يوجد منتج بنفس الباركود: <b>${escapeHtml(existing.name)}</b> (الكمية: ${existing.qty})
      <div style="margin-top:8px">
        <button class="btn btn-info btn-sm" onclick="loadExistingProduct('${existing.id}')">✏️ تحميل بياناته</button>
        <button class="btn btn-success btn-sm" onclick="addQtyToExisting('${existing.id}')">➕ إضافة كمية له</button>
      </div>
    </div>`;
  } else {
    infoEl.innerHTML = `<div style="background:#d4edda;color:#155724;padding:10px;border-radius:8px;margin:8px 0;font-size:13px">
      ✅ باركود جديد — أدخل بيانات المنتج
    </div>`;
  }
}

function loadExistingProduct(id) { closeModal(); openProductModal(id); }
function addQtyToExisting(id) { closeModal(); openAddQtyModal(id); }

function openProductModal(id) {
  const p = id ? DB.products().find(x => x.id === id) : {
    name: '', barcode: '', category: '', qty: 0, min_qty: 5, price: 0, cost: 0, expiry_date: ''
  };
  const cats = DB.categories();
  openModal(`
    <h3>${id ? '✏️ تعديل' : '➕ منتج جديد'}</h3>
    <label class="lbl">الباركود</label>
    <div style="display:flex;gap:6px;align-items:stretch">
      <input id="pBarcode" dir="ltr" style="flex:1" value="${escapeHtml(p.barcode || '')}"
             oninput="onProductBarcodeChange(this.value)"
             onchange="onProductBarcodeChange(this.value)">
      <button type="button" class="btn btn-primary" onclick="openScanner('product-barcode')" title="مسح">📷</button>
    </div>
    <div id="pBarcodeInfo"></div>
    <label class="lbl">الاسم</label><input id="pName" value="${escapeHtml(p.name || '')}">
    <label class="lbl">الفئة</label>
    <select id="pCategory">
      <option value="">— بدون —</option>
      ${cats.map(c => `<option value="${escapeHtml(c.name)}" ${c.name === p.category ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
    </select>
    <div class="row">
      <div><label class="lbl">الكمية</label><input id="pQty" type="number" inputmode="numeric" value="${p.qty}"></div>
      <div><label class="lbl">حد التنبيه</label><input id="pMinQty" type="number" inputmode="numeric" value="${p.min_qty || 5}"></div>
    </div>
    <div class="row">
      <div><label class="lbl">سعر الشراء</label><input id="pCost" type="number" inputmode="decimal" value="${p.cost || 0}"></div>
      <div><label class="lbl">سعر البيع</label><input id="pPrice" type="number" inputmode="decimal" value="${p.price || 0}"></div>
    </div>
    <label class="lbl">تاريخ الانتهاء</label><input id="pExpiry" type="date" value="${p.expiry_date || ''}">
    <div class="modal-actions">
      <button class="btn btn-success" onclick="saveProduct('${id || ''}')">💾 حفظ</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);

  if (p.barcode) setTimeout(() => onProductBarcodeChange(p.barcode), 100);
}

function openProductModalWithBarcode(barcode) {
  openProductModal();
  setTimeout(() => {
    const f = document.getElementById('pBarcode');
    if (f) { f.value = barcode; onProductBarcodeChange(barcode); }
  }, 100);
}

function saveProduct(id) {
  const barcode = (document.getElementById('pBarcode').value || '').trim();
  const name = (document.getElementById('pName').value || '').trim();
  if (!name) { toast('أدخل الاسم', true); return; }

  if (barcode) {
    const duplicate = DB.products().find(p => p.barcode === barcode && p.id !== id);
    if (duplicate) {
      if (!confirm(`⚠️ الباركود مستعمل للمنتج: ${duplicate.name}\n\nمتابعة؟`)) return;
    }
  }

  const isNew = !id;
  const p = id ? DB.products().find(x => x.id === id) : { id: uuid(), created_at: now() };
  const beforeQty = p.qty || 0;

  p.barcode = barcode;
  p.name = name;
  p.category = document.getElementById('pCategory').value;
  p.qty = +document.getElementById('pQty').value || 0;
  p.min_qty = +document.getElementById('pMinQty').value || 5;
  p.cost = +document.getElementById('pCost').value || 0;
  p.price = +document.getElementById('pPrice').value || 0;
  p.expiry_date = document.getElementById('pExpiry').value || '';
  upsertRow('products', p);

  if (!isNew && beforeQty !== p.qty) {
    if (typeof recordStockMovement === 'function') {
      recordStockMovement(p.id, p.name, 'adjust', Math.abs(p.qty - beforeQty), beforeQty, p.qty, 'تصحيح يدوي');
    }
  }

  audit('product_save', name);
  closeModal();
  renderProducts();
  toast('✅ تم الحفظ');
}

function deleteProduct(id) {
  if (!confirm('حذف المنتج؟')) return;
  removeRow('products', id);
  audit('product_delete', id);
  renderProducts();
  toast('🗑️ تم الحذف');
}

function printInventoryList() {
  const products = DB.products();
  const s = DB.settings();
  printHTML(`
    <div class="center"><h2>${escapeHtml(s.shopName || 'Boutik')}</h2><div class="small">جرد المخزون</div></div>
    <div class="small">التاريخ: ${fmtDate(now())}</div>
    <table>
      <thead><tr><th>#</th><th>باركود</th><th>الاسم</th><th>الكمية</th><th>سعر البيع</th><th>القيمة</th></tr></thead>
      <tbody>${products.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.barcode || '')}</td><td>${escapeHtml(p.name)}</td><td>${p.qty}</td><td>${fmtNum(p.price)}</td><td>${fmtNum((p.qty * p.price))}</td></tr>`).join('')}</tbody>
    </table>
  `, 'جرد المخزون');
}

function printBarcodeLabels() {
  const products = DB.products().filter(p => p.barcode);
  if (!products.length) return toast('لا توجد منتجات بباركود', true);
  const s = DB.settings();
  printHTML(`
    <div class="center small">${escapeHtml(s.shopName || 'Boutik')}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px">
      ${products.map(p => `
        <div class="label-box">
          <div style="font-size:10px;margin-bottom:4px">${escapeHtml(p.name).slice(0, 20)}</div>
          <div style="font-family:monospace;font-size:10px;direction:ltr;word-break:break-all">${escapeHtml(p.barcode)}</div>
          <div style="font-size:11px;font-weight:700;margin-top:3px">${fmtNum(p.price)}</div>
        </div>`).join('')}
    </div>
  `, 'ملصقات الباركود');
                                                                                                                                              }
