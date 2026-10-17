/* Boutika Desktop — نافذة التطبيق + السيرفر المدمج (يبدأ عند اختيار وضع "مضيف") */
const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

// تعطيل تسريع الرسوميات: سبب شائع للشاشة البيضاء على ويندوز (كروت قديمة / برامج تشغيل)
app.disableHardwareAcceleration();

// سجل أخطاء يُكتب في %APPDATA%/Boutika/boutika-log.txt لتشخيص أي مشكلة
function log(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'boutika-log.txt');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, '[' + new Date().toISOString() + '] ' + msg + '\n');
  } catch (_) {}
}
process.on('uncaughtException', e => log('uncaughtException: ' + (e && e.stack || e)));

const PORT = 8787;
let win = null;
let srv = null;
let srvInfo = null;

function startServer() {
  if (srv && srvInfo) return Promise.resolve(srvInfo);
  return new Promise(resolve => {
    const fallback = { port: PORT, urls: [], ips: [] };
    let done = false;
    const finish = v => { if (!done) { done = true; srvInfo = v; resolve(v); } };
    try {
      srv = fork(path.join(__dirname, 'boutika-server', 'src', 'server.js'), [], {
        env: {
          ...process.env,
          PORT: String(PORT),
          BOUTIKA_DATA: path.join(app.getPath('userData'), 'boutika-data'),
          BOUTIKA_WWW: path.join(__dirname, 'www')
        },
        stdio: 'ignore'
      });
      srv.on('message', m => {
        if (m && m.type === 'server-ready') finish(m);
        if (m && m.type === 'server-error') { log('server-error ' + m.message); finish({ ...fallback, error: m.message }); }
      });
      srv.on('exit', code => { log('server exit ' + code); srv = null; srvInfo = null; finish(fallback); });
      srv.on('error', e => log('server error: ' + e));
      setTimeout(() => finish(fallback), 6000);
    } catch (e) { finish({ ...fallback, error: String(e) }); }
  });
}

function stopServer() {
  if (srv) { try { srv.kill(); } catch (_) {} }
  srv = null; srvInfo = null;
  return true;
}

ipcMain.handle('boutika:start-server', startServer);
ipcMain.handle('boutika:stop-server', stopServer);

function errorPage(title, detail) {
  const html = '<html dir="rtl"><body style="font-family:Tahoma,sans-serif;padding:40px;background:#fff;color:#222">' +
    '<h2>' + title + '</h2><pre style="white-space:pre-wrap;direction:ltr;background:#f3f3f3;padding:12px;border-radius:8px">' +
    String(detail).replace(/</g, '&lt;') + '</pre>' +
    '<p>ملف السجل: ' + path.join(app.getPath('userData'), 'boutika-log.txt').replace(/</g, '&lt;') + '</p></body></html>';
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function createWindow() {
  const indexFile = path.join(__dirname, 'www', 'index.html');
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: 'Boutika',
    show: false,
    backgroundColor: '#edf3ff',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  setTimeout(() => { if (win && !win.isVisible()) win.show(); }, 4000);

  // F12 أو Ctrl+Shift+I لفتح أدوات المطوّر عند الحاجة
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && String(input.key).toLowerCase() === 'i'))) {
      win.webContents.toggleDevTools();
    }
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log('did-fail-load ' + code + ' ' + desc + ' ' + url);
    win.loadURL(errorPage('تعذّر تحميل الواجهة', code + ' ' + desc + '\n' + url));
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    log('render-process-gone ' + JSON.stringify(d));
    win.loadURL(errorPage('توقفت عملية العرض', JSON.stringify(d)));
  });
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) log('renderer error: ' + message + ' (' + source + ':' + line + ')');
  });

  if (!fs.existsSync(indexFile)) {
    log('index.html missing: ' + indexFile);
    win.loadURL(errorPage('ملف الواجهة غير موجود', indexFile + '\nشغّل: node tools/prepare-desktop.js قبل البناء'));
    return;
  }
  win.loadFile(indexFile);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => { stopServer(); app.quit(); });
}
