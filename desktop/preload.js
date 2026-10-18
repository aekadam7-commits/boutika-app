const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('BoutikDesktop', {
  isDesktop: true,
  platform: process.platform,
  startServer: () => ipcRenderer.invoke('boutika:start-server'),
  stopServer: () => ipcRenderer.invoke('boutika:stop-server'),
  restartServer: () => ipcRenderer.invoke('boutika:restart-server'),
  serverStatus: () => ipcRenderer.invoke('boutika:server-status'),
  saveFile: (name, text) => ipcRenderer.invoke('boutika:save-file', name, text),
  openFile: () => ipcRenderer.invoke('boutika:open-file')
});
// علامة تستعملها الواجهة لتنسيقات ويندوز فقط (مثل شريط التنقل)
window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('is-desktop'));
