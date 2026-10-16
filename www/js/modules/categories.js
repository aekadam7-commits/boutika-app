/* ============================================================
   Boutik v4 — الفئات
   ============================================================ */

function openCategoriesModal() {
  renderCategoriesModal();
}

function renderCategoriesModal() {
  const cats = DB.categories();
  openModal(`
    <h3>🏷️ الفئات</h3>
    <div style="margin-bottom:12px">
      <input id="newCatName" placeholder="اسم الفئة الجديدة">
      <button class="btn btn-primary btn-block" onclick="addCategory()">➕ إضافة</button>
    </div>
    <div>
      ${cats.length ? cats.map(c => `
        <div class="cart-item">
          <span>${escapeHtml(c.name)}</span>
          <button class="btn btn-danger btn-sm" onclick="deleteCategory('${c.id}')">🗑️</button>
        </div>`).join('') : '<div class="empty">لا فئات</div>'}
    </div>
    <div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">إغلاق</button></div>
  `);
}

function addCategory() {
  const name = document.getElementById('newCatName').value.trim();
  if (!name) return;
  const c = { id: uuid(), name, created_at: now() };
  upsertRow('categories', c);
  renderCategoriesModal();
}

function deleteCategory(id) {
  if (!confirm('حذف الفئة؟')) return;
  removeRow('categories', id);
  renderCategoriesModal();
}
