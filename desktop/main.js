/* Boutika Desktop — نافذة التطبيق + السيرفر المدمج (يبدأ عند اختيار وضع "مضيف") */
const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');

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
        if (m && m.type === 'server-error') finish({ ...fallback, error: m.message });
      });
      srv.on('exit', () => { srv = null; srvInfo = null; finish(fallback); });
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

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: 'Boutika',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => { stopServer(); app.quit(); });
}
