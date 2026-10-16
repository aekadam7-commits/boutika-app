/* ============================================================
   Boutik v4 — الجرد
   ============================================================ */

function renderInventoryTab() {
  const sessions = DB.inventorySessions().slice().reverse();
  const el = document.getElementById('inventoryContent');
  if (!el) return;
  if (!sessions.length) {
    el.innerHTML = '<div class="empty">لا توجد جلسات.</div>';
    return;
  }
  el.innerHTML = sessions.map(s => `
    <div class="cart-item">
      <div>
        <strong>${fmtDate(s.created_at)}</strong>
        <div class="small">${s.closed_at ? '✅ مغلقة' : '🟢 مفتوحة'} — ${(DB.inventoryItems().filter(i => i.session_id === s.id).length)} منتج</div>
      </div>
      <div>
        <button class="btn btn-info btn-sm" onclick="openInventorySession('${s.id}')">👁️</button>
        ${!s.closed_at ? `<button class="btn btn-danger btn-sm" onclick="closeInventorySession('${s.id}')">🔒</button>` : ''}
      </div>
    </div>
  `).join('');
}

function startInventorySession() {
  if (!confirm('بدء جلسة جرد جديدة؟')) return;
  const s = { id: uuid(), created_at: now(), closed_at: null, user: currentUser.username };
  upsertRow('inventorySessions', s);

  // إنشاء عناصر لكل منتج
  DB.products().forEach(p => {
    const it = {
      id: uuid(),
      session_id: s.id,
      product_id: p.id,
      expected_qty: p.qty,
      actual_qty: p.qty,
      diff: 0
    };
    upsertRow('inventoryItems', it);
  });
  audit('inventory_start', s.id);
  renderInventoryTab();
  openInventorySession(s.id);
}

function openInventorySession(id) {
  const s = DB.inventorySessions().find(x => x.id === id);
  if (!s) return;
  const items = DB.inventoryItems().filter(i => i.session_id === id);
  openModal(`
    <h3>📋 جلسة جرد — ${fmtDate(s.created_at)}</h3>
    <div style="max-height:400px;overflow-y:auto">
      ${items.map(it => {
        const p = DB.products().find(x => x.id === it.product_id);
        return `
          <div class="cart-item">
            <div>
              <strong>${p ? escapeHtml(p.name) : '—'}</strong>
              <div class="small">متوقع: ${it.expected_qty}</div>
            </div>
            <input type="number" value="${it.actual_qty}" style="width:70px;padding:5px"
              onchange="updateInventoryItem('${it.id}', this.value)">
          </div>`;
      }).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="closeModal()">إغلاق</button>
    </div>`);
}

function updateInventoryItem(itemId, val) {
  const it = DB.inventoryItems().find(x => x.id === itemId);
  if (!it) return;
  it.actual_qty = +val || 0;
  it.diff = it.actual_qty - it.expected_qty;
  upsertRow('inventoryItems', it);
}

function closeInventorySession(id) {
  if (!confirm('إغلاق الجلسة وتطبيق الفروقات؟')) return;
  const items = DB.inventoryItems().filter(i => i.session_id === id);
  items.forEach(it => {
    const p = DB.products().find(x => x.id === it.product_id);
    if (p) {
      p.qty = it.actual_qty;
      upsertRow('products', p);
    }
  });
  const s = DB.inventorySessions().find(x => x.id === id);
  s.closed_at = now();
  upsertRow('inventorySessions', s);
  audit('inventory_close', id);
  renderInventoryTab();
  toast('✅ تم إغلاق الجلسة');
}
