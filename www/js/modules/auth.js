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

    // الجهاز الفرعي يجب أن يسحب آخر تحديثات المستخدمين قبل التحقق من كلمة السر.
    // لا نعتمد على Sync.start داخل enterApp لأنه لا يبدأ إلا بعد نجاح تسجيل الدخول.
    if (mode === 'client') {
      try {
        if (typeof Net === 'undefined' || !Net.host || !Net.host.ip || typeof Sync === 'undefined') {
          throw new Error('لم يتم تحديد الخادم');
        }
        const url = Net.baseUrl() || 'http://localhost:8787';
        const response = await fetch(url + '/api/sync/pull?since=' + Sync._getSeq(), { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const payload = await response.json();
        Sync.applyMany(payload.entries || []);
        if (payload.seq) Sync._setSeq(payload.seq);
      } catch (syncError) {
        console.error('Pre-login user sync failed:', syncError);
        if (errEl) errEl.textContent = '❌ تعذر تحديث بيانات المستخدمين من الخادم. تحقق من الاتصال ثم أعد المحاولة.';
        return; // لا نسمح بتسجيل الدخول بكلمة سر قديمة عند تعذر تحديث الحساب.
      }
    }

    const wait = Security.guard.remainingMs();
    if (wait > 0) {
      if (errEl) errEl.textContent = '⏳ محاولات كثيرة. انتظر ' + Math.ceil(wait / 1000) + ' ثانية';
      return;
    }

    const users = DB.users();
    if (!users.length) {
      if (errEl) errEl.textContent = '❌ لا يوجد مستخدمون — امسح بيانات التطبيق';
      return;
    }

    const found = await authenticate(u, p, users);
    if (!found) {
      Security.guard.fail();
      if (errEl) errEl.textContent = '❌ اسم المستخدم أو كلمة السر خاطئة';
      return;
    }
    Security.guard.reset();

    // مستخدم قديم بكلمة سر نصية: رحّله إلى هاش الآن (نجح الدخول فكلمة السر معروفة)
    if (Security.isLegacy(found)) {
      await Security.migrateUsers();
    }
    const fresh = DB.users().find(x => x.id === found.id) || found;
    const pw = document.getElementById('loginPass');
    if (pw) pw.value = '';
    enterApp(fresh, true);
  } catch (e) {
    console.error('Login error:', e);
    if (errEl) errEl.textContent = '❌ خطأ: ' + (e.message || e);
  }
}


/* التحقق من الهوية: دائمًا نُجري اشتقاق هاش حتى لو كان المستخدم غير موجود (لا نكشف وجود الاسم بالزمن) */
const __DUMMY_USER = { pass_salt: '00112233445566778899aabbccddeeff', pass_hash: '', pass_iter: 100000 };
async function authenticate(username, password, users) {
  const user = users.find(x => x.username === username);
  if (!user) { await Security.verifyPassword(password, __DUMMY_USER); return null; }
  if (Security.hasHash(user)) return (await Security.verifyPassword(password, user)) ? user : null;
  if (Security.isLegacy(user)) return Security.safeEqual(user.password, password) ? user : null;   // نص قديم لم يُرحَّل بعد
  return null;
}

/* بدء الجلسة بعد التحقق. لا نحتفظ في الذاكرة بأي سر: id/اسم/دور فقط */
function enterApp(user, fresh) {
  currentUser = { id: user.id, username: user.username, role: user.role };
  if (fresh) audit('login', 'تسجيل دخول');
  sessionStorage.setItem('boutik_user_id', user.id);

  ['loginScreen', 'licenseScreen', 'modeScreen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  document.getElementById('app').classList.add('active');
  document.getElementById('currentUser').textContent = '👤 ' + user.username;
  const __sb = document.getElementById('subscriptionBtn');
  if (__sb) __sb.classList.remove('hidden');

  if (typeof applyDarkMode === 'function') applyDarkMode();
  if (typeof loadShopName === 'function') loadShopName();
  if (typeof buildNav === 'function') buildNav();
  if (typeof loadActiveShift === 'function') loadActiveShift();
  if (typeof refreshAll === 'function') refreshAll();
  if (typeof Sync !== 'undefined' && Sync.start) Sync.start();
  if (typeof updateLicenseBar === 'function') updateLicenseBar();

  const isClient = DB.mode().current === 'client';
  if (user.must_change && !(isClient && user._updated_at === 0)) {
    if (typeof openChangePasswordModal === 'function') openChangePasswordModal(true);
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

async function tryAutoLogin() {
  const uid = sessionStorage.getItem('boutik_user_id');
  if (!uid) return;
  const u = DB.users().find(x => x.id === uid);
  if (!u) { sessionStorage.removeItem('boutik_user_id'); return; }
  try {
    if (DB.mode().current === 'host' && typeof checkLicenseBeforeLogin === 'function') {
      if (!(await checkLicenseBeforeLogin())) return;
    }
  } catch (_) { return; }
  enterApp(u, false);      // استعادة الجلسة دون لمس كلمة السر
}
