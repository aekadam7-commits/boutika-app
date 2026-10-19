/* قاعدة باركودات المنتجات (من algeria_products.xlsx) — اقتراح اسم/حجم عند إضافة منتج جديد.
   تُحمَّل عند أول استعمال فقط (www/data/catalog.js) وتعمل دون إنترنت. */
let _catalogPromise = null;

function loadBarcodeCatalog() {
  if (window.BOUTIKA_CATALOG) return Promise.resolve(window.BOUTIKA_CATALOG);
  if (_catalogPromise) return _catalogPromise;
  _catalogPromise = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'data/catalog.js';
    s.onload = () => resolve(window.BOUTIKA_CATALOG || null);
    s.onerror = () => { _catalogPromise = null; resolve(null); };
    document.head.appendChild(s);
  });
  return _catalogPromise;
}

// يرجع { name, qty } أو null
function lookupBarcodeCatalog(code) {
  const cat = window.BOUTIKA_CATALOG;
  if (!cat || !code) return null;
  const variants = [code];
  if (code.length === 12) variants.push('0' + code);                       // UPC-A ↔ EAN-13
  if (code.length === 13 && code[0] === '0') variants.push(code.slice(1));
  for (const v of variants) {
    const e = cat[v];
    if (e) return { name: e[0], qty: e[1] || '' };
  }
  return null;
}

// يُستدعى من onProductBarcodeChange عندما لا يوجد المنتج في المتجر
function catalogSuggest(barcode, infoEl) {
  if (!/^\d{8,14}$/.test(barcode)) return;
  loadBarcodeCatalog().then(() => {
    const field = document.getElementById('pBarcode');
    if (!field || field.value.trim() !== barcode) return;                  // تغيّر الباركود أو أُغلقت النافذة
    const hit = lookupBarcodeCatalog(barcode);
    if (!hit) return;                                                      // غير موجود: يبقى كما هو (✅ باركود جديد)

    const full = hit.qty ? hit.name + ' ' + hit.qty : hit.name;
    const nameEl = document.getElementById('pName');
    let filled = false;
    // نملأ الاسم فقط إن كان فارغًا أو معبّأً آليًا من قبل ولم يعدّله المستخدم
    if (nameEl && (!nameEl.value.trim() || (nameEl.dataset.auto === '1' && nameEl.value === nameEl.dataset.autoVal))) {
      nameEl.value = full;
      nameEl.dataset.auto = '1';
      nameEl.dataset.autoVal = full;
      filled = true;
    }
    const el = infoEl || document.getElementById('pBarcodeInfo');
    if (el) el.innerHTML = `<div style="background:#d1ecf1;color:#0c5460;padding:10px;border-radius:8px;margin:8px 0;font-size:13px">
      📚 وُجد في قاعدة الباركودات: <b>${escapeHtml(full)}</b><br>
      ${filled ? 'تم ملء الاسم — ' : ''}أكمل الفئة والكمية والأسعار.
    </div>`;
  });
}
