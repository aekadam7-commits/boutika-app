/* ============================================================
   Boutik v4 — Electron Preload
   ============================================================ */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('BoutikDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron
});
