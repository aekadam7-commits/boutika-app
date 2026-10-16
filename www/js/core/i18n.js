/* ============================================================
   Boutik v4 — الترجمة
   ============================================================ */

const BoutikI18n = {
  lang: 'ar',
  dict: {
    ar: {
      'الرئيسية': 'الرئيسية', 'البيع': 'البيع', 'المنتجات': 'المنتجات',
      'الزبائن': 'الزبائن', 'الموردين': 'الموردين', 'المشتريات': 'المشتريات',
      'الفواتير': 'الفواتير', 'الجرد': 'الجرد', 'التقارير': 'التقارير',
      'الإعدادات': 'الإعدادات', 'المستخدمون': 'المستخدمون', 'تواصل معنا': 'تواصل معنا'
    },
    fr: {
      'الرئيسية': 'Accueil', 'البيع': 'Vente', 'المنتجات': 'Produits',
      'الزبائن': 'Clients', 'الموردين': 'Fournisseurs', 'المشتريات': 'Achats',
      'الفواتير': 'Factures', 'الجرد': "Inventaire", 'التقارير': 'Rapports',
      'الإعدادات': 'Paramètres', 'المستخدمون': 'Utilisateurs', 'تواصل معنا': 'Contact'
    },
    en: {
      'الرئيسية': 'Dashboard', 'البيع': 'Sale', 'المنتجات': 'Products',
      'الزبائن': 'Customers', 'الموردين': 'Suppliers', 'المشتريات': 'Purchases',
      'الفواتير': 'Invoices', 'الجرد': 'Inventory', 'التقارير': 'Reports',
      'الإعدادات': 'Settings', 'المستخدمون': 'Users', 'تواصل معنا': 'Contact'
    }
  },
  t(str) {
    if (!str) return '';
    const map = this.dict[this.lang] || {};
    return map[str] || str;
  },
  setLang(l) {
    this.lang = l || 'ar';
    try { DB.setObj('i18n', { lang: this.lang }); } catch {}
    document.documentElement.lang = this.lang;
    document.documentElement.dir = this.lang === 'ar' ? 'rtl' : 'ltr';
    if (typeof buildNav === 'function') buildNav();
  },
  init() {
    const s = DB.getObj('i18n');
    this.lang = s.lang || 'ar';
    const sel = document.getElementById('languageSelect');
    if (sel) {
      sel.value = this.lang;
      sel.onchange = (e) => this.setLang(e.target.value);
    }
  }
};
