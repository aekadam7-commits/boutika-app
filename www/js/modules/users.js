/* ============================================================
   Boutik v4 — المستخدمون
   ============================================================ */

const USER_ROLES = ['admin', 'manager', 'cashier', 'stock'];
const MIN_PASSWORD_LEN = 6;

function adminCount() { return DB.users().filter(u => u.role === 'admin').length; }

function renderUsers() {
  const list = DB.users();
  const tb = document.getElementById('usersTable');
  if (tb) {
    tb.innerHTML = list.map(u => {
      const isMe = currentUser && u.id === currentUser.id;
      const lastAdmin = u.role === 'admin' && adminCount() <= 1;
      const canDelete = list.length > 1 && !isMe && !lastAdmin;
      return `
      <tr>
        <td>${escapeHtml(u.username)}${isMe ? ' <small>(أنت)</small>' : ''}</td>
        <td>${escapeHtml(u.role)}</td>
        <td>
          <button class="btn btn-info btn-sm" onclick="openUserModal('${escapeHtml(u.id)}')">✏️</button>
          ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${escapeHtml(u.id)}')">🗑️</button>` : ''}
        </td>
      </tr>`;
    }).join('');
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
  const u = id ? DB.users().find(x => x.id === id) : { username: '', role: 'cashier' };
  if (!u) return;
  const isMe = !!(id && currentUser && id === currentUser.id);
  openModal(`
    <h3>${id ? '✏️ تعديل مستخدم' : '➕ مستخدم جديد'}</h3>
    <label class="lbl">اسم المستخدم</label><input id="uName" value="${escapeHtml(u.username)}" autocomplete="off">
    <label class="lbl">كلمة السر ${id ? '<small>(اتركها فارغة للإبقاء على الحالية)</small>' : ''}</label>
    <input id="uPass" type="password" autocomplete="new-password" placeholder="${MIN_PASSWORD_LEN}+ أحرف">
    <label class="lbl">الدور</label>
    <select id="uRole" ${isMe ? 'disabled title="لا يمكنك تغيير دورك بنفسك"' : ''}>${USER_ROLES.map(r => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>
    <div class="modal-actions">
      <button class="btn btn-success" onclick="saveUser('${id ? escapeHtml(id) : ''}')">💾</button>
      <button class="btn btn-danger" onclick="closeModal()">إلغاء</button>
    </div>`);
}

async function saveUser(id) {
  const name = document.getElementById('uName').value.trim();
  const pass = document.getElementById('uPass').value.trim();
  const role = document.getElementById('uRole').value;
  const users = DB.users();
  const existing = id ? users.find(x => x.id === id) : null;

  if (id && !existing) { toast('المستخدم غير موجود', true); return; }
  if (!name) { toast('أدخل اسم المستخدم', true); return; }
  if (!existing && !pass) { toast('أدخل كلمة سر', true); return; }
  if (pass && pass.length < MIN_PASSWORD_LEN) { toast('كلمة السر قصيرة (' + MIN_PASSWORD_LEN + ' أحرف على الأقل)', true); return; }
  if (!USER_ROLES.includes(role)) { toast('دور غير صالح', true); return; }
  if (users.some(x => x.username === name && x.id !== id)) { toast('اسم المستخدم مستعمل', true); return; }

  const isMe = !!(existing && currentUser && existing.id === currentUser.id);
  if (isMe && role !== existing.role) { toast('لا يمكنك تغيير دورك بنفسك', true); return; }
  if (existing && existing.role === 'admin' && role !== 'admin' && adminCount() <= 1) {
    toast('يجب أن يبقى مدير واحد على الأقل', true); return;
  }

  const u = existing ? Object.assign({}, existing) : { id: uuid(), created_at: now() };
  u.username = name;
  u.role = role;
  if (pass) {
    Object.assign(u, await Security.hashPassword(pass));
    delete u.password;                      // لا يبقى أي نص صريح
    delete u.must_change;
  }
  upsertRow('users', u);
  audit(existing ? 'user_update' : 'user_create', name + ' (' + role + ')' + (pass ? ' + كلمة سر' : ''));
  closeModal();
  renderUsers();
  toast('✅ تم الحفظ');
}

function deleteUser(id) {
  const u = DB.users().find(x => x.id === id);
  if (!u) return;
  if (currentUser && id === currentUser.id) { toast('لا يمكنك حذف حسابك وأنت داخل به', true); return; }
  if (u.role === 'admin' && adminCount() <= 1) { toast('لا يمكن حذف آخر مدير', true); return; }
  if (!confirm('حذف المستخدم؟')) return;
  removeRow('users', id);
  audit('user_delete', u.username);
  renderUsers();
}

/* ---------- تغيير المستخدم لكلمة سره بنفسه ---------- */
function openChangePasswordModal(force) {
  if (!currentUser) return;
  openModal(`
    <h3>🔑 تغيير كلمة السر</h3>
    ${force ? '<p style="color:#c62828">⚠️ كلمة السر الحالية افتراضية. يجب تغييرها الآن.</p>' : ''}
    <label class="lbl">كلمة السر الحالية</label><input id="cpOld" type="password" autocomplete="current-password">
    <label class="lbl">كلمة السر الجديدة</label><input id="cpNew" type="password" autocomplete="new-password" placeholder="${MIN_PASSWORD_LEN}+ أحرف">
    <label class="lbl">تأكيد كلمة السر الجديدة</label><input id="cpNew2" type="password" autocomplete="new-password">
    <div class="modal-actions">
      <button class="btn btn-success" onclick="saveOwnPassword()">💾</button>
      ${force ? '' : '<button class="btn btn-danger" onclick="closeModal()">إلغاء</button>'}
    </div>`);
}

async function saveOwnPassword() {
  const oldP = document.getElementById('cpOld').value.trim();
  const newP = document.getElementById('cpNew').value.trim();
  const new2 = document.getElementById('cpNew2').value.trim();
  const me = currentUser && DB.users().find(x => x.id === currentUser.id);
  if (!me) { toast('المستخدم غير موجود', true); return; }
  if (Security.guard.remainingMs() > 0) { toast('محاولات كثيرة، انتظر قليلًا', true); return; }

  const okOld = Security.hasHash(me) ? await Security.verifyPassword(oldP, me)
              : (Security.isLegacy(me) && Security.safeEqual(me.password, oldP));
  if (!okOld) { Security.guard.fail(); toast('كلمة السر الحالية خاطئة', true); return; }
  if (newP.length < MIN_PASSWORD_LEN) { toast('كلمة السر قصيرة (' + MIN_PASSWORD_LEN + ' أحرف على الأقل)', true); return; }
  if (newP !== new2) { toast('التأكيد لا يطابق', true); return; }
  if (newP === oldP) { toast('اختر كلمة سر مختلفة عن الحالية', true); return; }
  if (newP === '1234') { toast('كلمة السر هذه ضعيفة جدًا', true); return; }

  Security.guard.reset();
  const u = Object.assign({}, me);
  Object.assign(u, await Security.hashPassword(newP));
  delete u.password;
  delete u.must_change;
  upsertRow('users', u);
  audit('password_change', me.username);
  closeModal();
  toast('✅ تم تغيير كلمة السر');
}

function renderUsersInSettings() {
  const el = document.getElementById('usersListSettings');
  if (!el) return;
  el.innerHTML = DB.users().map(u => `<div class="cart-item"><span>${escapeHtml(u.username)} (${u.role})</span></div>`).join('');
}
