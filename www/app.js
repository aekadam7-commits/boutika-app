/* ============================================================
   Boutik v4 — النواة الرئيسية
   ============================================================ */

function buildNav() {
  const tabs = [
    { id: 'dashboard', label: '📊 الرئيسية', roles: ['admin','manager','cashier'] },
    { id: 'pos', label: '💰 البيع', roles: ['admin','manager','cashier'] },
    { id: 'products', label: '📦 المنتجات', roles: ['admin','manager','stock'] },
    { id: 'customers', label: '👥 الزبائن', roles: ['admin','manager','cashier'] },
    { id: 'suppliers', label: '🚚 الموردين', roles: ['admin','manager','stock'] },
    { id: 'purchases', label: '🛒 المشتريات', roles: ['admin','manager','stock'] },
    { id: 'invoices', label: '🧾 فواتير البيع', roles: ['admin','manager','cashier'] },
    { id: 'inventory', label: '📋 الجرد', roles: ['admin','manager','stock'] },
    { id: 'expenses', label: '💰 المصاريف', roles: ['admin','manager'] },
    { id: 'reservations', label: '📦 الحجوزات', roles: ['admin','manager','cashier'] },
    { id: 'reports', label: '📈 التقارير', roles: ['admin','manager'] },
    { id: 'settings', label: '⚙️ الإعدادات', roles: ['admin'] },
    { id: 'users', label: '👤 المستخدمون', roles: ['admin'] },
    { id: 'contact', label: '📞 تواصل معنا', roles: ['admin','manager','cashier','stock'] }
  ];
  const role = currentUser ? currentUser.role : 'cashier';
  const allowed = tabs.filter(t => t.roles.includes(role));
  const nav = document.getElementById('mainNav');
  if (!nav) return;
  nav.innerHTML = allowed
    .map((t, i) => `<button class="${i === 0 ? 'active' : ''}" data-tab="${t.id}" onclick="switchTab('${t.id}')">${t.label}</button>`)
    .join('');
}

function switchTab(tab) {
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
      bar.style.display = (DB.mode().current === 'client' && Net.host) ? 'block' : 'none';
    }
    if (typeof registerRemoteScanListener === 'function') registerRemoteScanListener();
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

    const mode = DB.mode().current;
    if (mode) {
      const ms = document.getElementById('modeScreen');
      if (ms) ms.classList.add('hidden');
      if (typeof Net !== 'undefined' && Net.current) Net.current();
      afterModeChosen();
      if (typeof tryAutoLogin === 'function') tryAutoLogin();
    }
  } catch (e) {
    console.error('load error:', e);
  }
  console.log('🚀 Boutik v4 جاهز');
});
