/* ============================================================
   Boutik v4 — المستخدمون
   ============================================================ */

function renderUsers() {
  const list = DB.users();
  const tb = document.getElementById('usersTable');
  if (tb) {
    tb.innerHTML = list.map(u => `
      <tr>
        <td>${escapeHtml(u.username)}</td>
        <td>${u.role}</td>
        <td>
          <button class="btn btn-info btn-sm" onclick="openUserModal('${u.id}')">✏️</button>
          ${list.length > 1 ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">🗑️</button>` : ''}
        </td>
      </tr>`).join('');
  }
  renderAuditLog();
}

function renderAuditLog() {
  const log = DB.auditLog().slice(-200).reverse();
  const el = document.getElementById('auditLog');
  if (!el) return;
  el.innerHTML = log.length ? `<div style="max-height:400px;overflow-y:auto">${
    log.map(l => `
      <div class="audit-row">
        <span class="time">${fmtDate(l.created_at)}</span>
        <span class="who">${escapeHtml(l.user)}</span>
        <span>${escapeHtml(l.action)} ${l.details ? '— ' + escapeHtml(l.details) : ''}</span>
      </div>`).join('')}</div>` : '<div class="empty">لا يوجد سجل</div>';
}

function openUserModal(id) {
  const u = id ? DB.users().find(x => x.id === id) : { username: '', password: '', role: 'cashier' };
  const roles = ['admin','manager','cashier','stock'];
  openModal(`
    <h3>${id ? '✏️ تعديل مستخدم' : '➕ مستخدم جديد'}</h3>
    <label class="lbl">اسم المستخدم</label><input id="uName" value="${escapeHtml(u.username)}">
    <label class="lbl">كلمة السر</label><input id="uPass" type="text" value="${escapeHtml(u.password)}">
    <label class="lbl">الدور</label>
    <select id="uRole">${roles.map(r => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>
    <div class="modal-actions">
      <button class="btn btn-success" onclick="saveUser('${id || ''}')">💾</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

function saveUser(id) {
  const name = document.getElementById('uName').value.trim();
  const pass = document.getElementById('uPass').value.trim();
  if (!name || !pass) { toast('أدخل اسمًا وكلمة سر', true); return; }
  const u = id ? DB.users().find(x => x.id === id) : { id: uuid(), created_at: now() };
  u.username = name;
  u.password = pass;
  u.role = document.getElementById('uRole').value;
  upsertRow('users', u);
  closeModal();
  renderUsers();
  toast('✅ تم الحفظ');
}

function deleteUser(id) {
  if (!confirm('حذف المستخدم؟')) return;
  removeRow('users', id);
  renderUsers();
}

function renderUsersInSettings() {
  const el = document.getElementById('usersListSettings');
  if (!el) return;
  el.innerHTML = DB.users().map(u => `<div class="cart-item"><span>${escapeHtml(u.username)} (${u.role})</span></div>`).join('');
}
