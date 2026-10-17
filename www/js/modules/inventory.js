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
  const canScan = !s.closed_at;
  openModal(`
    <h3>📋 جلسة جرد — ${fmtDate(s.created_at)}</h3>
    ${canScan ? `
    <div class="scan-row">
      <input id="invScan" data-scan="modal" dir="ltr" placeholder="امسح الباركود لعدّ المنتج (+1 لكل مسحة)"
             onkeydown="if(event.key==='Enter'){event.preventDefault();inventoryScanSubmit();}">
      <button type="button" class="btn btn-primary" onclick="openScanner('modal')" title="مسح بالكاميرا">📷</button>
      <button type="button" class="btn btn-info" onclick="startRemoteScanner('barcode', {target:'modal'}, {mode:'stream'})" title="المسح بجهاز آخر">📱</button>
    </div>
    <div class="small" style="margin-bottom:6px">أول مسحة لمنتج تجعل العدد 1، وكل مسحة بعدها تزيده 1. المنتجات التي لم تُمسح تبقى كما هي.</div>` : ''}
    <div id="invList" style="max-height:400px;overflow-y:auto">
      ${items.map(it => {
        const p = DB.products().find(x => x.id === it.product_id);
        return `
          <div class="cart-item" id="invrow_${it.id}">
            <div>
              <strong>${p ? escapeHtml(p.name) : '—'}</strong>
              <div class="small">متوقع: ${it.expected_qty}</div>
            </div>
            <input type="number" id="invq_${it.id}" value="${it.actual_qty}" style="width:70px;padding:5px"
              onchange="updateInventoryItem('${it.id}', this.value)">
          </div>`;
      }).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="closeModal()">إغلاق</button>
    </div>`);

  if (canScan) {
    registerModalScan(code => inventoryScanHandler(id, code));
    setTimeout(() => { const i = document.getElementById('invScan'); if (i) i.focus(); }, 50);
  }
}

// مسح منتج داخل جلسة الجرد: يعدّ المنتج ويمرّر الصف إلى الواجهة دون إعادة رسم النافذة
function inventoryScanHandler(sessionId, code) {
  const p = scanFindProduct(code);
  if (!p) { toast('⚠️ منتج غير معروف: ' + code, true); return { ok: false, status: 'unknown', text: '⚠️ غير معروف: ' + code, keepOpen: true }; }
  const it = DB.inventoryItems().find(x => x.session_id === sessionId && x.product_id === p.id);
  if (!it) { toast('⚠️ المنتج ليس ضمن هذه الجلسة', true); return { ok: false, status: 'notinsession', text: '⚠️ ' + p.name + ' — ليس في الجلسة', keepOpen: true }; }

  it.actual_qty = it.counted ? (+it.actual_qty || 0) + 1 : 1;
  it.counted = true;
  it.diff = it.actual_qty - it.expected_qty;
  upsertRow('inventoryItems', it);

  const inp = document.getElementById('invq_' + it.id);
  if (inp) inp.value = it.actual_qty;
  const row = document.getElementById('invrow_' + it.id);
  if (row) {
    row.scrollIntoView({ block: 'nearest' });
    row.classList.add('inv-hit');
    setTimeout(() => row.classList.remove('inv-hit'), 900);
  }
  return { ok: true, status: 'counted', name: p.name, text: '✅ ' + p.name + ' — ' + it.actual_qty, keepOpen: true };
}

function inventoryScanSubmit() {
  const inp = document.getElementById('invScan');
  if (!inp) return;
  const v = inp.value.trim();
  if (!v) return;
  if (typeof routeScan === 'function') {
    const r = routeScan(v, { target: 'modal', source: 'manual' });
    if (r && r.ok) inp.value = '';
  }
}

function updateInventoryItem(itemId, val) {
  const it = DB.inventoryItems().find(x => x.id === itemId);
  if (!it) return;
  it.actual_qty = +val || 0;
  it.counted = true;            // عدّ يدوي: المسحات التالية تزيد عليه
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
