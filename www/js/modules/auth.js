/* ============================================================
   Boutik v4 — المصادقة (مصحّح)
   ============================================================ */

let currentUser = null;
let currentShift = null;

async function doLogin() {
  const errEl = document.getElementById('loginError');
  if (errEl) { errEl.textContent = ''; errEl.style.color = '#c62828'; }
  const __sb = document.getElementById('subscriptionBtn');

  try {
    const mode = DB.mode().current;

    // فحص الترخيص فقط في وضع المضيف
    if (mode === 'host') {
      let licenseOK = true;
      if (typeof checkLicenseBeforeLogin === 'function') {
        try { licenseOK = await checkLicenseBeforeLogin(); }
        catch (e) { console.error('License check:', e); licenseOK = false; }
      }
      if (!licenseOK) {
        if (errEl) {
          errEl.textContent = '⚠️ يجب تفعيل الترخيص أولًا';
          errEl.style.color = '#f39c12';
        }
        if (typeof showSubscription === 'function') showSubscription();
        if (__sb) __sb.classList.remove('hidden');
        return;
      }
    }

    const u = (document.getElementById('loginUser').value || '').trim();
    const p = (document.getElementById('loginPass').value || '').trim();

    if (!u || !p) {
      if (errEl) errEl.textContent = '❌ أدخل اسم المستخدم وكلمة السر';
      return;
    }

    const users = DB.users();
    if (!users.length) {
      if (errEl) errEl.textContent = '❌ لا يوجد مستخدمون — امسح بيانات التطبيق';
      return;
    }

    const found = users.find(x => x.username === u && x.password === p);
    if (!found) {
      if (errEl) errEl.textContent = '❌ بيانات خاطئة — جرّب: user / 1234';
      return;
    }

    currentUser = found;
    audit('login', 'تسجيل دخول');
    sessionStorage.setItem('boutik_user_id', found.id);

    ['loginScreen', 'licenseScreen', 'modeScreen'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    document.getElementById('app').classList.add('active');
    document.getElementById('currentUser').textContent = '👤 ' + found.username;
    if (__sb) __sb.classList.remove('hidden');

    if (typeof applyDarkMode === 'function') applyDarkMode();
    if (typeof loadShopName === 'function') loadShopName();
    if (typeof buildNav === 'function') buildNav();
    if (typeof loadActiveShift === 'function') loadActiveShift();
    if (typeof refreshAll === 'function') refreshAll();
    if (typeof Sync !== 'undefined' && Sync.start) Sync.start();
    if (typeof updateLicenseBar === 'function') updateLicenseBar();
  } catch (e) {
    console.error('Login error:', e);
    if (errEl) errEl.textContent = '❌ خطأ: ' + (e.message || e);
  }
}

function logout() {
  if (!confirm('هل تريد الخروج؟')) return;
  audit('logout', 'تسجيل خروج');
  currentUser = null;
  currentShift = null;
  sessionStorage.removeItem('boutik_user_id');
  document.getElementById('app').classList.remove('active');
  document.getElementById('loginScreen').classList.remove('hidden');
  const el = document.getElementById('loginError');
  if (el) el.textContent = '';
}

function loadShopName() {
  const s = DB.settings();
  const el = document.getElementById('shopNameHeader');
  if (el) el.textContent = '— ' + (s.shopName || '');
}

function tryAutoLogin() {
  const uid = sessionStorage.getItem('boutik_user_id');
  if (!uid) return;
  const u = DB.users().find(x => x.id === uid);
  if (u) {
    document.getElementById('loginUser').value = u.username;
    document.getElementById('loginPass').value = u.password;
    doLogin();
  }
}
