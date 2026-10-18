/* ============================================================
   Boutik v4 — أدوات مساعدة (طباعة + صوت + اهتزاز)
   ============================================================ */

function now() { return new Date().toISOString(); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

// لغة التواريخ والأرقام حسب لغة الواجهة
function _loc() { return (typeof BoutikI18n !== 'undefined') ? BoutikI18n.locale() : 'ar-DZ'; }
function _numLoc() { return (typeof BoutikI18n !== 'undefined') ? BoutikI18n.numLocale() : 'fr-DZ'; }

function currency() {
  try { return (DB.settings().currency) || 'دج'; }
  catch { return 'دج'; }
}

function fmt(n) {
  const num = Number(n) || 0;
  return num.toLocaleString(_numLoc(), { maximumFractionDigits: 2 }) + ' ' + currency();
}

function fmtNum(n) {
  return (Number(n) || 0).toLocaleString(_numLoc(), { maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString(_loc()) + ' ' + dt.toLocaleTimeString(_loc(), { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function fmtDateShort(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString(_loc()); } catch { return '—'; }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function toast(msg, isError) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.className = 'toast', 3000);
}

function openModal(html) {
  const m = document.getElementById('modal');
  const c = document.getElementById('modalContent');
  if (!m || !c) return;
  if (typeof clearModalScan === 'function') clearModalScan();   // أي نافذة جديدة تسجّل مسحها بنفسها بعد الفتح
  c.innerHTML = html;
  m.classList.remove('hidden');
}

function closeModal() {
  const m = document.getElementById('modal');
  if (m) m.classList.add('hidden');
  if (typeof clearModalScan === 'function') clearModalScan();
}

/* ============================================================
   المبلغ المقبوض / الباقي للزبون (اختياري) — مشترك بين البيع والديون
   ============================================================ */
// يحسب الباقي: given = ما دفعه الزبون، required = المطلوب منه
function calcChange(given, required) {
  given = Number(given) || 0;
  required = Number(required) || 0;
  if (given <= 0) return { given: 0, change: 0, short: 0, active: false };
  return { given, change: Math.max(0, given - required), short: Math.max(0, required - given), active: true };
}

function cashGivenFieldHTML(inputId, onInputJs) {
  return `
    <label class="lbl">💵 المبلغ المقبوض من الزبون (اختياري)</label>
    <input id="${inputId}" type="number" inputmode="decimal" min="0" placeholder="مثال: 200" oninput="${onInputJs}">
    <div id="${inputId}Info" class="change-info"></div>`;
}

function showChangeInfo(inputId, required) {
  const info = document.getElementById(inputId + 'Info');
  const inp = document.getElementById(inputId);
  if (!info || !inp) return;
  const r = calcChange(inp.value, required);
  if (!r.active) { info.innerHTML = ''; info.className = 'change-info'; return; }
  if (r.short > 0) {
    info.className = 'change-info bad';
    info.innerHTML = '⚠️ المبلغ ناقص: <b>' + fmt(r.short) + '</b>';
  } else {
    info.className = 'change-info ok';
    info.innerHTML = '🔙 الباقي للزبون: <b>' + fmt(r.change) + '</b>';
  }
}

function exportCSV(filename, headers, rows) {
  const csv = [headers.map(h => T(h)), ...rows]
    .map(r => r.map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function playBeep(frequency = 900, duration = 180) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!window.__beepCtx) window.__beepCtx = new AudioContext();
    const ctx = window.__beepCtx;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = frequency;
    gain.gain.value = 0.5;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration / 1000);
  } catch (e) { console.warn('beep error:', e); }
}

function playSuccessBeep() {
  playBeep(900, 150);
  setTimeout(() => playBeep(1300, 150), 160);
}

function playErrorBeep() {
  playBeep(250, 400);
}

function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern || [80, 40, 80]);
  } catch (e) {}
}

function printHTML(content, title) {
  let size = '58';
  try { size = DB.settings().paperSize || '58'; } catch {}

  let width, pageSize;
  if (size === 'a4') { width = '190mm'; pageSize = 'A4 portrait'; }
  else if (size === '80') { width = '72mm'; pageSize = '80mm auto'; }
  else { width = '52mm'; pageSize = '58mm auto'; }

  const old = document.getElementById('__print_layer__');
  if (old) old.remove();
  const oldStyle = document.getElementById('__print_style__');
  if (oldStyle) oldStyle.remove();
  const oldBtn = document.getElementById('__print_btn__');
  if (oldBtn) oldBtn.remove();

  const layer = document.createElement('div');
  layer.id = '__print_layer__';
  layer.className = 'print-layer';
  layer.innerHTML = `<div class="print-page" style="width:${width}">${content}</div>`;

  const style = document.createElement('style');
  style.id = '__print_style__';
  style.textContent = `
    .print-layer { position:fixed; inset:0; z-index:99999; background:#fff; color:#000; overflow:auto; padding:12px; direction:${(typeof BoutikI18n !== 'undefined') ? BoutikI18n.dir() : 'rtl'}; font-family:Tahoma,Arial,sans-serif; }
    .print-page { max-width:100%; margin:0 auto; font-size:13px; }
    .print-page h1,.print-page h2,.print-page h3 { text-align:center; margin:4px 0; }
    .print-page table { width:100%; border-collapse:collapse; margin:6px 0; font-size:12px; }
    .print-page th,.print-page td { border-bottom:1px dashed #999; padding:3px 2px; text-align:start; }
    .print-page th { border-bottom:1px solid #333; background:#f0f0f0; }
    .print-page .dashed { border-top:1px dashed #666; padding:4px 0; margin:4px 0; }
    .print-page .row { display:flex; justify-content:space-between; padding:2px 0; }
    .print-page .total-row { display:flex; justify-content:space-between; font-weight:700; padding:2px 0; }
    .print-page .center { text-align:center; }
    .print-page .small { font-size:11px; color:#333; }
    .print-page .code { font-family:monospace; direction:ltr; text-align:center; padding:6px; border:1px dashed #333; margin:6px 0; }
    .print-page .label-box { display:inline-block; border:1px solid #000; padding:6px; margin:3px; width:46mm; text-align:center; vertical-align:top; font-size:11px; }
    #__print_btn__ { position:fixed; top:10px; left:10px; background:#e74c3c; color:#fff; border:0; padding:10px 16px; border-radius:8px; font-weight:700; font-size:14px; z-index:100001; cursor:pointer; }
    @media print {
      @page { size: ${pageSize}; margin: 3mm; }
      body > *:not(.print-layer) { display:none !important; }
      .print-layer { position:static !important; padding:0 !important; background:#fff !important; }
      #__print_btn__ { display:none !important; }
    }
  `;

  const closeBtn = document.createElement('button');
  closeBtn.id = '__print_btn__';
  closeBtn.innerHTML = '✖ إغلاق';
  closeBtn.onclick = () => {
    const l = document.getElementById('__print_layer__'); if (l) l.remove();
    const s = document.getElementById('__print_style__'); if (s) s.remove();
    const b = document.getElementById('__print_btn__'); if (b) b.remove();
  };

  document.body.appendChild(style);
  document.body.appendChild(layer);
  document.body.appendChild(closeBtn);

  setTimeout(() => {
    try { window.print(); }
    catch (e) { console.error('Print error:', e); alert('تعذّر بدء الطباعة.'); }
  }, 300);
}

function isExpiringSoon(p) {
  if (!p || !p.expiry_date) return false;
  const days = daysUntilExpiry(p.expiry_date);
  const limit = (DB.settings().expiryDays) || 30;
  return days >= 0 && days <= limit;
}

function isExpired(p) {
  if (!p || !p.expiry_date) return false;
  return daysUntilExpiry(p.expiry_date) < 0;
}

function daysUntilExpiry(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.floor((d - t) / 86400000);
}

function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function uuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function getQueryParam(name) {
  return new URLSearchParams(location.search).get(name);
     }
