/* ============================================================
   Boutik v4 — Electron Main
   ============================================================ */
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow = null;
let serverProcess = null;

function startServer() {
  try {
    const serverPath = path.join(__dirname, '..', 'server', 'server.js');
    serverProcess = fork(serverPath, [], {
      env: { ...process.env, PORT: '8787' },
      stdio: 'ignore'
    });
    serverProcess.on('error', (e) => console.error('Server error:', e));
  } catch (e) { console.error('Server start error:', e); }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'build', 'icon.png'),
    title: 'Boutik'
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  startServer();
  setTimeout(createWindow, 800);
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
