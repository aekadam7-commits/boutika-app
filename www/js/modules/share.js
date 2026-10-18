/* ============================================================
   Boutik v4 — مشاركة التطبيق (QR + رابط التحميل)
   ============================================================ */

const BOUTIK_DOWNLOAD_URL = 'https://github.com/aekadam7-commits/boutika-app/releases/latest/download/Boutika.apk';

function openShareModal() {
  const url = BOUTIK_DOWNLOAD_URL;

  openModal(`
    <h3>📤 مشاركة التطبيق</h3>
    <p class="small" style="text-align:center;margin-bottom:12px">
      امسح الرمز أو انسخ الرابط لمشاركته
    </p>

    <div id="shareQR" style="text-align:center;padding:16px;background:#fff;border-radius:12px;border:1px solid var(--border);margin-bottom:12px">
      <div style="width:200px;height:200px;margin:auto;display:flex;align-items:center;justify-content:center;background:#f5f5f5;border-radius:8px">
        <span class="small">جارٍ توليد QR...</span>
      </div>
    </div>

    <label class="lbl">رابط التحميل المباشر</label>
    <input id="shareUrl" dir="ltr" value="${escapeHtml(url)}" readonly onclick="this.select()">

    <div class="modal-actions" style="flex-direction:column">
      <button class="btn btn-primary" onclick="copyShareUrl()">📋 نسخ الرابط</button>
      <button class="btn btn-info" onclick="shareNative()">📤 مشاركة عبر التطبيقات</button>
      <button class="btn btn-success" onclick="openDownloadLink()">⬇️ فتح رابط التحميل</button>
      <button class="btn btn-danger" onclick="closeModal()">إغلاق</button>
    </div>
  `);

  generateQR(url);
}

function generateQR(url) {
  const container = document.getElementById('shareQR');
  if (!container) return;

  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(url);
  const img = new Image();
  img.src = qrUrl;
  img.alt = 'QR Code';
  img.style.width = '200px';
  img.style.height = '200px';
  img.style.borderRadius = '8px';
  img.style.background = '#fff';

  img.onload = () => {
    container.innerHTML = '';
    container.appendChild(img);
  };

  img.onerror = () => {
    container.innerHTML = '<div class="small" style="color:#c00;padding:30px 0">⚠️ فشل توليد QR<br>تحقق من الإنترنت</div>';
  };
}

function copyShareUrl() {
  const input = document.getElementById('shareUrl');
  if (!input) return;
  input.select();
  try {
    document.execCommand('copy');
    toast('✅ تم نسخ الرابط');
  } catch (e) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(input.value).then(() => toast('✅ تم نسخ الرابط'));
    }
  }
}

function shareNative() {
  const text = T(`🛒 Boutik — نظام إدارة المحل\n\nحمّل التطبيق من:\n`) + BOUTIK_DOWNLOAD_URL;
  if (navigator.share) {
    navigator.share({ title: 'Boutik', text: text, url: BOUTIK_DOWNLOAD_URL }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('✅ تم نسخ النص'));
  }
}

function openDownloadLink() {
  if (typeof window.Android !== 'undefined' && window.Android.openUrl) {
    window.Android.openUrl(BOUTIK_DOWNLOAD_URL);
  } else {
    window.open(BOUTIK_DOWNLOAD_URL, '_blank');
  }
}
