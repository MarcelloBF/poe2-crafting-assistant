// Atualização automática do app instalado: procura uma Release nova no GitHub (latest.yml),
// baixa em segundo plano e oferece reiniciar. Se o jogador escolher "Depois", instala ao fechar o app.
const { app, dialog, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

const TEXT = {
  pt: {
    title: 'Atualização disponível',
    message: (v) => `A versão ${v} do POE2 Crafting Assistant foi baixada.`,
    detail: 'Reinicie para usar a versão nova. Se escolher "Depois", ela será instalada quando você fechar o app.',
    now: 'Reiniciar agora',
    later: 'Depois',
  },
  en: {
    title: 'Update available',
    message: (v) => `POE2 Crafting Assistant ${v} has been downloaded.`,
    detail: 'Restart to use the new version. If you choose "Later", it will be installed when you close the app.',
    now: 'Restart now',
    later: 'Later',
  },
};

function logger() {
  const file = path.join(app.getPath('userData'), 'updater.log');
  const write = (level) => (...args) => {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${args.map(String).join(' ')}\n`);
    } catch {
      // Sem log não impede a atualização.
    }
  };
  return { info: write('info'), warn: write('warn'), error: write('error'), debug: () => {} };
}

function setupAutoUpdate() {
  // Só o app instalado se atualiza (rodando com "npm run app" não há o que atualizar).
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  const t = app.getLocale().toLowerCase().startsWith('pt') ? TEXT.pt : TEXT.en;
  autoUpdater.logger = logger();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let prompted = false;

  autoUpdater.on('update-downloaded', async (info) => {
    if (prompted) return;
    prompted = true;
    const win = BrowserWindow.getAllWindows()[0];
    const opts = { type: 'info', title: t.title, message: t.message(info.version), detail: t.detail, buttons: [t.now, t.later], defaultId: 0, cancelId: 1 };
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall(false, true));
  });
  autoUpdater.on('error', (e) => autoUpdater.logger.error(e?.stack ?? e));

  const check = () => autoUpdater.checkForUpdates().catch((e) => autoUpdater.logger.error(e?.stack ?? e));
  check();
  setInterval(check, CHECK_EVERY_MS);
}

module.exports = { setupAutoUpdate };
