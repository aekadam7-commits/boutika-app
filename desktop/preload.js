const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('BoutikDesktop', {
  isDesktop: true,
  platform: process.platform,
  startServer: () => ipcRenderer.invoke('boutika:start-server'),
  stopServer: () => ipcRenderer.invoke('boutika:stop-server')
});
