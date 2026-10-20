// Executável (Electron): serve o build do Vite (dist/) por um protocolo próprio e faz a ponte
// /ninja -> poe.ninja, o mesmo papel do proxy do Vite em desenvolvimento (o poe.ninja não envia CORS).
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const UA = 'poe2-crafting-assistant desktop app';

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function handleRequest(req) {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/ninja/')) {
    return net.fetch(`https://poe.ninja${url.pathname.slice('/ninja'.length)}${url.search}`, { headers: { 'User-Agent': UA } });
  }
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 380,
    backgroundColor: '#0f0d0b',
    autoHideMenuBar: true,
    title: 'POE2 Crafting Assistant',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links externos (fontes, documentação) abrem no navegador padrão.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://bundle/index.html');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle('app', handleRequest);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
