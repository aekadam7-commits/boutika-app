/* ============================================================
   Boutik v4 — النواة الرئيسية
   ============================================================ */

function buildNav() {
  const tabs = [
    { id: 'dashboard', label: '📊 الرئيسية' },
    { id: 'pos', label: '💰 البيع' },
    { id: 'products', label: '📦 المنتجات' },
    { id: 'customers', label: '👥 الزبائن' },
    { id: 'suppliers', label: '🚚 الموردين' },
    { id: 'purchases', label: '🛒 المشتريات' },
    { id: 'invoices', label: '🧾 فواتير البيع' },
    { id: 'inventory', label: '📋 الجرد' },
    { id: 'expenses', label: '💰 المصاريف' },
    { id: 'reservations', label: '📦 الحجوزات' },
    { id: 'reports', label: '📈 التقارير' },
    { id: 'settings', label: '⚙️ الإعدادات' },
    { id: 'users', label: '👤 المستخدمون' },
    { id: 'contact', label: '📞 تواصل معنا' }
  ];
  const allowed = tabs.filter(t => Perms.canTab(t.id));       // الصلاحيات من Perms.TAB_ROLES (رفض افتراضي)
  const nav = document.getElementById('mainNav');
  if (!nav) return;
  nav.innerHTML = allowed
    .map((t, i) => `<button class="${i === 0 ? 'active' : ''}" data-tab="${t.id}" onclick="switchTab('${t.id}')">${t.label}</button>`)
    .join('');
}

function switchTab(tab) {
  if (!Perms.canTab(tab)) { Perms.deny(); return; }          // لا نكتفي بإخفاء الزر
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById('tab-' + tab);
  if (target) target.classList.remove('hidden');
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`nav button[data-tab="${tab}"]`);
  if (btn) btn.classList.add('active');

  const actions = {
    dashboard: 'renderDashboard',
    products: 'renderProducts',
    customers: 'renderCustomers',
    suppliers: 'renderSuppliers',
    purchases: 'renderPurchases',
    invoices: 'renderInvoices',
    inventory: 'renderInventoryTab',
    expenses: 'renderExpenses',
    reservations: 'renderReservations',
    reports: 'renderReports',
    settings: 'renderSettings',
    users: 'renderUsers'
  };
  if (tab === 'pos') {
    if (typeof renderPOSCustomers === 'function') renderPOSCustomers();
    if (typeof searchPOS === 'function') searchPOS();
    if (typeof renderCart === 'function') renderCart();
    // إظهار/إخفاء شريط Remote Scanner
    const bar = document.getElementById('remoteScannerBar');
    if (bar) {
      bar.style.display = (typeof isNetworked === 'function' && isNetworked()) ? 'block' : 'none';
    }
  } else if (actions[tab]) {
    const fn = window[actions[tab]];
    if (typeof fn === 'function') { try { fn(); } catch (e) { console.error(tab + ':', e); } }
  }
}

function refreshAll() {
  const safe = (n) => { if (typeof window[n] === 'function') { try { window[n](); } catch (e) { console.warn(n, e); } } };
  ['renderDashboard','renderProducts','renderCustomers','renderSuppliers',
   'renderInvoices','renderPurchases','renderReports','renderPOSCustomers',
   'renderCart','renderSettings','renderUsers','renderExpenses',
   'renderReservations'].forEach(safe);
}

function chooseMode(mode) {
  if (typeof Net === 'undefined') { alert('Net module missing'); return; }
  if (mode === 'host') {
    Net.setMode('host', null);
    toast('✅ تم اختيار الوضع: مضيف');
    afterModeChosen();
  } else {
    Net.setMode('client', null);
    const mn = document.getElementById('modeNetwork');
    if (mn) mn.classList.remove('hidden');
    if (typeof Net.scanForHosts === 'function') Net.scanForHosts();
  }
}

function afterModeChosen() {
  try {
    const m = DB.mode();
    const ms = document.getElementById('modeScreen');
    if (ms) ms.classList.add('hidden');

    if (m.current === 'host') {
      if (typeof licenseState !== 'function') { showLogin(); return; }
      const st = licenseState();
      if (!st || !st.active) showSubscription();
      else showLogin();
    } else {
      showLogin();
    }
  } catch (e) {
    console.error('afterModeChosen:', e);
    showLogin();
  }
}

function showLogin() {
  const lic = document.getElementById('licenseScreen');
  if (lic) lic.classList.add('hidden');
  const login = document.getElementById('loginScreen');
  if (login) login.classList.remove('hidden');

  const m = DB.mode();
  const badge = document.getElementById('netBadge');
  if (badge) {
    badge.classList.remove('hidden');
    if (m.current === 'host') { badge.className = 'net-badge host'; badge.textContent = '🖥️ وضع المضيف'; }
    else { badge.className = 'net-badge client'; badge.textContent = '📱 وضع العميل' + (m.host ? ' — ' + m.host.ip + ':' + m.host.port : ''); }
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (typeof closeModal === 'function') closeModal();
    if (typeof closeScanner === 'function') closeScanner();
  }
  if (e.key === 'Enter') {
    const ls = document.getElementById('loginScreen');
    if (ls && !ls.classList.contains('hidden')) doLogin();
  }
});

window.addEventListener('load', () => {
  try {
    if (typeof BoutikI18n !== 'undefined' && BoutikI18n.init) BoutikI18n.init();
    if (typeof applyDarkMode === 'function') applyDarkMode();
    if (typeof updateNetStatus === 'function') updateNetStatus();

    const migrated = Security.migrateUsers();                    // تشفير كلمات السر القديمة
    const mode = DB.mode().current;
    if (mode) {
      const ms = document.getElementById('modeScreen');
      if (ms) ms.classList.add('hidden');
      if (typeof Net !== 'undefined' && Net.current) Net.current();
      afterModeChosen();
      migrated.then(() => { if (typeof tryAutoLogin === 'function') tryAutoLogin(); });
    }
  } catch (e) {
    console.error('load error:', e);
  }
  console.log('🚀 Boutik v4 جاهز');
});

// حراسة الإجراءات الحساسة (حذف/إعدادات/مستخدمون/استعادة) بعد تحميل كل الوحدات
Perms.install();
