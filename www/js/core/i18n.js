/* ============================================================
   Boutik v4 — نظام الترجمة (ar / fr / en)
   ------------------------------------------------------------
   - النص المصدر في الكود يبقى عربيًا، والقاموس يحوّله إلى fr/en.
   - الترجمة تُطبَّق على كل الواجهة تلقائيًا: النصوص، placeholder،
     title، الرسائل المنبثقة (alert/confirm/prompt)، التصدير، الطباعة.
   - البيانات المخزّنة (فواتير، منتجات...) لا تتغير أبدًا؛ التغيير في العرض فقط.
   - القواميس: js/i18n/fr.js و js/i18n/en.js
   - لإضافة ترجمة: أضف سطرًا في القاموس  'العبارة العربية': 'Traduction'
     وللجمع: 'sing|plur' (يُستعمل الجمع إذا سبق العبارة رقم غير 1).
   ============================================================ */

const BoutikI18n = {
  lang: 'ar',
  packs: {},            // { fr: {...}, en: {...} }
  _maps: {},            // قواميس مُطبَّعة لكل لغة
  _maxWords: 1,
  _ver: 0,
  _obs: null,
  _busy: false,

  LOCALES: { ar: 'ar-DZ', fr: 'fr-FR', en: 'en-GB' },
  NUM_LOCALES: { ar: 'fr-DZ', fr: 'fr-DZ', en: 'en-US' },

  locale()    { return this.LOCALES[this.lang] || 'ar-DZ'; },
  numLocale() { return this.NUM_LOCALES[this.lang] || 'fr-DZ'; },
  dir()       { return this.lang === 'ar' ? 'rtl' : 'ltr'; },
  isRTL()     { return this.lang === 'ar'; },

  /* ---------- التطبيع: يتجاهل التشكيل واختلاف الألف والياء ---------- */
  norm(s) {
    return String(s)
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي');
  },

  /* ---------- بناء الخريطة لغةً واحدة ---------- */
  _build(lang) {
    const pack = this.packs[lang];
    if (!pack) return null;
    const map = new Map();
    let max = 1;
    Object.keys(pack).forEach(k => {
      const nk = this.norm(k).trim().replace(/\s+/g, ' ');
      if (!nk) return;
      map.set(nk, pack[k]);
      const w = nk.split(' ').length;
      if (w > max) max = w;
    });
    this._maps[lang] = { map, max };
    return this._maps[lang];
  },

  register(lang, entries) {
    this.packs[lang] = Object.assign(this.packs[lang] || {}, entries);
    delete this._maps[lang];
    if (lang === this.lang && this._ready) this.apply();
  },

  /* ---------- الترجمة الأساسية لسلسلة نصية ---------- */
  AR_WORD: /[\u0621-\u064A\u064B-\u065F\u0670-\u06D3\u0750-\u077F]+/g,

  tr(str) {
    if (str == null || str === '') return str == null ? '' : str;
    str = String(str);
    if (this.lang === 'ar') return str;
    if (!/[\u0621-\u064A\u0670-\u06D3\u0750-\u077F]/.test(str)) return str;
    const m = this._maps[this.lang] || this._build(this.lang);
    if (!m) return str;

    // نقسّم النص إلى كلمات عربية وما بينها
    const words = [];                       // {w, start, end, n}
    let mt;
    const re = new RegExp(this.AR_WORD.source, 'g');
    while ((mt = re.exec(str))) words.push({ w: mt[0], n: this.norm(mt[0]), start: mt.index, end: mt.index + mt[0].length });

    let out = '';
    let pos = 0;
    let i = 0;
    while (i < words.length) {
      let hit = null;
      const lim = Math.min(m.max, words.length - i);
      for (let len = lim; len >= 1; len--) {
        // الكلمات يجب أن تكون متجاورة بمسافة واحدة فقط
        let ok = true;
        for (let j = i; j < i + len - 1; j++) {
          if (str.slice(words[j].end, words[j + 1].start) !== ' ') { ok = false; break; }
        }
        if (!ok) continue;
        const key = words.slice(i, i + len).map(x => x.n).join(' ');
        if (m.map.has(key)) { hit = { len, val: m.map.get(key) }; break; }
      }
      if (hit) {
        const first = words[i], last = words[i + hit.len - 1];
        out += str.slice(pos, first.start);
        out += this._cap(this._pick(hit.val, str.slice(0, first.start)), str.slice(0, first.start));
        pos = last.end;
        i += hit.len;
      } else {
        i++;
      }
    }
    out += str.slice(pos);
    return out;
  },

  // أول حرف كبير إذا بدأت الترجمة النص (مثل عناوين الأعمدة)
  _cap(val, before) {
    if (!val) return val;
    // الترجمة تبدأ النص (بعد رموز/إيموجي فقط) → حرف كبير
    const b = before.replace(/[\s\u2022\u2014\-\u00A0\uFE0F\u200D]/g, '');
    if (!/^[^\w\u00C0-\u024F\u0600-\u06FF()\[\]«"'“:.,;!?؟،#]*$/.test(b)) return val;
    return val.charAt(0).toUpperCase() + val.slice(1);
  },

  // اختيار المفرد/الجمع حسب الرقم السابق
  _pick(val, before) {
    if (val.indexOf('|') === -1) return val;
    const parts = val.split('|');
    const mm = /(\d+(?:[.,]\d+)?)\s*$/.exec(before);
    if (mm) {
      const n = parseFloat(mm[1].replace(',', '.'));
      return n === 1 || n === 0 && this.lang === 'fr' ? parts[0] : parts[1];
    }
    return parts[0];
  },

  /* اسم مختصر للاستعمال داخل الكود: t('نص') */
  t(s) { return this.tr(s); },

  /* ---------- ترجمة عقد DOM ---------- */
  ATTRS: ['placeholder', 'title', 'aria-label', 'alt'],
  SKIP_TAGS: { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1 },

  _skip(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (this.SKIP_TAGS[e.tagName]) return true;
      if (e.hasAttribute && e.hasAttribute('data-no-i18n')) return true;
    }
    return false;
  },

  _textNode(node) {
    const cur = node.data;
    // أول مرة، أو غيّر الكود النص من الخارج → النص الحالي هو الأصل
    if (node.__i18n === undefined || cur !== node.__i18nOut) {
      node.__i18n = cur;
      node.__i18nVer = -1;
    }
    if (node.__i18nVer === this._ver) return;
    const out = this.tr(node.__i18n);
    node.__i18nVer = this._ver;
    node.__i18nOut = out;
    if (out !== cur) node.data = out;
  },

  _attrs(el) {
    if (!el.getAttribute) return;
    const store = el.__i18nA || (el.__i18nA = {});
    const names = this.ATTRS.slice();
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type)) names.push('value');
    for (const a of names) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      let s = store[a];
      if (!s || cur !== s.out) { s = store[a] = { orig: cur, out: cur, ver: -1 }; }
      if (s.ver === this._ver) continue;
      const out = this.tr(s.orig);
      s.ver = this._ver; s.out = out;
      if (out !== cur) el.setAttribute(a, out);
    }
  },

  _walk(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      if (root.parentNode && !this._skip(root.parentNode)) this._textNode(root);
      return;
    }
    if (root.nodeType !== 1) return;
    if (this._skip(root)) return;
    this._attrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n.nodeType === 1) {
          if (this.SKIP_TAGS[n.tagName] || (n.hasAttribute && n.hasAttribute('data-no-i18n'))) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) this._textNode(n);
      else this._attrs(n);
    }
  },

  /* ---------- مراقبة التغييرات الديناميكية ---------- */
  _observe() {
    if (this._obs || typeof MutationObserver === 'undefined') return;
    this._obs = new MutationObserver((muts) => {
      if (this._busy) return;
      this._busy = true;
      try {
        for (const mu of muts) {
          if (mu.type === 'childList') mu.addedNodes.forEach(n => this._walk(n));
          else if (mu.type === 'characterData') {
            if (mu.target.parentNode && !this._skip(mu.target.parentNode)) this._textNode(mu.target);
          } else if (mu.type === 'attributes') {
            this._attrs(mu.target);
          }
        }
      } finally { this._busy = false; }
    });
    this._obs.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: this.ATTRS.concat(['value'])
    });
  },

  /* تطبيق اللغة الحالية على كل الصفحة */
  apply() {
    this._ver++;
    document.documentElement.lang = this.lang;
    document.documentElement.dir = this.dir();
    document.body && document.body.classList.toggle('lang-rtl', this.isRTL());
    document.body && document.body.classList.toggle('lang-ltr', !this.isRTL());
    if (this._obs) this._obs.disconnect();
    this._busy = true;
    try { this._walk(document.body); } finally { this._busy = false; }
    this._obs = null;
    this._observe();
    if (document.title) document.title = this.tr(document.title);
  },

  /* ---------- اللغة ---------- */
  setLang(l) {
    if (!['ar', 'fr', 'en'].includes(l)) l = 'ar';
    this.lang = l;
    try { DB.setObj('i18n', { lang: l }); } catch {}
    try { localStorage.setItem('boutika_lang', l); } catch {}
    document.querySelectorAll('select.lang-sel').forEach(x => { x.value = l; });

    // أعد بناء القوائم بعد تحديد اللغة، مع الحفاظ على التبويب المفتوح
    const active = document.querySelector('nav button.active');
    const activeTab = active && active.getAttribute('data-tab');
    if (typeof buildNav === 'function') {
      try {
        buildNav();
        if (activeTab) {
          document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
          const b = document.querySelector('nav button[data-tab="' + activeTab + '"]');
          if (b) b.classList.add('active');
        }
      } catch (e) { console.warn('i18n nav', e); }
    }
    this.apply();
    // أعد رسم المحتوى ليأخذ تنسيق الأرقام والتواريخ للغة الجديدة
    if (typeof refreshAll === 'function') { try { refreshAll(); } catch (e) {} }
  },

  init() {
    let l = 'ar';
    try { l = (DB.getObj('i18n') || {}).lang || localStorage.getItem('boutika_lang') || 'ar'; }
    catch { try { l = localStorage.getItem('boutika_lang') || 'ar'; } catch {} }
    this.lang = ['ar', 'fr', 'en'].includes(l) ? l : 'ar';
    this._ready = true;
    document.querySelectorAll('select.lang-sel').forEach(sel => {
      sel.setAttribute('data-no-i18n', '');
      sel.value = this.lang;
      sel.onchange = (e) => this.setLang(e.target.value);
    });
    this.apply();
  }
};

/* اختصار عام + ترجمة الرسائل المنبثقة */
function T(s) { return BoutikI18n.tr(s); }

(function () {
  ['alert', 'confirm', 'prompt'].forEach(name => {
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__i18n) return;
    window[name] = function (msg, def) {
      return name === 'prompt' ? orig.call(window, T(msg), def) : orig.call(window, T(msg));
    };
    window[name].__i18n = true;
  });
  // ابدأ المراقبة مبكرًا حتى تُترجَم الشاشات التي تظهر قبل تحميل app.js
  try { BoutikI18n._observe(); } catch (e) {}
})();
