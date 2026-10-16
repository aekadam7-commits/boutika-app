/* ============================================================
   Boutika — معرّف الجهاز الثابت + رمز QR الخاص بالجهاز
   ============================================================ */

const Device = {
  KEY: 'boutik_v4_device_id',
  QR_PREFIX: 'BTK1:',

  getId() {
    let id = localStorage.getItem(this.KEY);
    if (!id || !/^[0-9A-F]{32}$/.test(id)) {
      id = this.generate();
      localStorage.setItem(this.KEY, id);
    }
    return id;
  },

  generate() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  },

  /** المعرّف مقسّم لمجموعات من 4 أحرف لسهولة القراءة */
  grouped() { return this.getId().match(/.{4}/g).join('-'); },

  /** النص الذي يُرمَّز في QR الجهاز */
  qrText() { return this.QR_PREFIX + this.getId(); },

  reset() { localStorage.removeItem(this.KEY); }
};

function copyDeviceId() {
  const text = Device.qrText();
  const done = () => toast('✅ تم نسخ رمز الجهاز');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text, done));
  } else legacyCopy(text, done);
}

function legacyCopy(text, cb) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); if (cb) cb(); } catch (e) {}
  ta.remove();
}
