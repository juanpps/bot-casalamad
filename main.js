const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron');
const path = require('path');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const { autoUpdater } = require('electron-updater');
const { startWhatsAppBot, getWaClient, pauseSender, resumeSender, setGlobalPause, logoutWhatsApp } = require('./src/bot/whatsapp.service');
const { createClient } = require('@supabase/supabase-js');

globalThis.WebSocket = require('ws');

const store = new Store();

const autoLauncher = new AutoLaunch({
  name: 'Casa LAMAD Bot',
  path: app.getPath('exe'),
  isHidden: false
});

// ── Credenciales por defecto (del .env del menú digital) ────────────────────
if (!store.get('settings.supabaseUrl')) {
  store.set('settings', {
    supabaseUrl: 'https://bwdtnlfcdanpusocmvux.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3ZHRubGZjZGFucHVzb2NtdnV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NDk1ODYsImV4cCI6MjA5NzIyNTU4Nn0.dIQYr1av-4_NqETqJwBNrwTN3pFNJhDgYiSSa83ltSg',
  });
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'Casa LAMAD — Panel Admin',
    backgroundColor: '#0F0F11',
    // icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile('src/panel/index.html');
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  const emit = (event, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(event, payload);
    }
  };

  // Iniciar bot de WhatsApp
  startWhatsAppBot(emit);

  // ── Auto-Updater (solo en producción, no en desarrollo) ─────────────────────
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('update-available', (info) => {
      console.log(`[UPDATER] Nueva versión disponible: ${info.version}`);
      emit('update-available', { version: info.version });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log(`[UPDATER] Versión ${info.version} descargada. Se instalará al cerrar.`);
      emit('update-downloaded', { version: info.version });
    });

    autoUpdater.on('error', (err) => {
      console.error('[UPDATER] Error:', err.message);
    });

    // IPC: instalar update ahora (reiniciar app)
    ipcMain.on('install-update', () => {
      autoUpdater.quitAndInstall();
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => { 
  app.isQuitting = true;
  console.log('[MAIN] Ejecutando Graceful Shutdown...');
  const wa = getWaClient();
  if (wa) {
    try {
      await wa.destroy();
      console.log('[MAIN] Cliente WhatsApp destruido correctamente.');
    } catch (err) {
      console.error('[MAIN] Error destruyendo cliente WhatsApp:', err);
    }
  }
});

// ── IPC: Estado inicial del bot ──────────────────────────────────────────────
ipcMain.on('get-bot-state', (event) => {
  // El estado se emitirá cuando el bot arranque
  event.sender.send('bot-state-update', { status: 'Iniciando', message: '🔄 Iniciando...', qr: null });
});

// ── IPC: Configuración ───────────────────────────────────────────────────────
ipcMain.on('get-settings', (event) => {
  const settings = store.get('settings') || {};
  // Adjuntar estado real del auto-inicio
  autoLauncher.isEnabled().then(enabled => {
    settings.autoLaunch = enabled;
    event.sender.send('settings-loaded', settings);
  }).catch(() => {
    event.sender.send('settings-loaded', settings);
  });
});

ipcMain.on('save-settings', (event, settings) => {
  // Separar el flag de auto-inicio antes de guardar
  const { autoLaunch, ...rest } = settings;
  store.set('settings', rest);

  // Aplicar auto-inicio al sistema operativo
  if (autoLaunch !== undefined) {
    if (autoLaunch) {
      autoLauncher.enable().catch(e => console.error('[AUTO-LAUNCH] Error activando:', e));
    } else {
      autoLauncher.disable().catch(e => console.error('[AUTO-LAUNCH] Error desactivando:', e));
    }
  }

  event.sender.send('settings-saved', true);
});

// ── IPC: Cargar pedidos del día ──────────────────────────────────────────────
ipcMain.handle('load-orders', async () => {
  const cfg = store.get('settings') || {};
  const supabase = createClient(
    cfg.supabaseUrl || 'https://bwdtnlfcdanpusocmvux.supabase.co',
    cfg.supabaseKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3ZHRubGZjZGFucHVzb2NtdnV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NDk1ODYsImV4cCI6MjA5NzIyNTU4Nn0.dIQYr1av-4_NqETqJwBNrwTN3pFNJhDgYiSSa83ltSg',
    {
      auth: { persistSession: false },
      global: { WebSocket: require('ws') }
    }
  );
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('pedidos')
    .select('*')
    .gte('created_at', today)
    .order('created_at', { ascending: false });

  if (error) console.error('[MAIN] Error cargando pedidos:', error.message);
  return data || [];
});

// ── IPC: Actualizar estado de pedido ────────────────────────────────────────
ipcMain.handle('update-order-status', async (_, { id, status, waNumber, trackingUrl }) => {
  const cfg = store.get('settings') || {};
  const supabase = createClient(
    cfg.supabaseUrl || 'https://bwdtnlfcdanpusocmvux.supabase.co',
    cfg.supabaseKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3ZHRubGZjZGFucHVzb2NtdnV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NDk1ODYsImV4cCI6MjA5NzIyNTU4Nn0.dIQYr1av-4_NqETqJwBNrwTN3pFNJhDgYiSSa83ltSg',
    {
      auth: { persistSession: false },
      global: { WebSocket: require('ws') }
    }
  );

  const { error } = await supabase.from('pedidos').update({ estado: status }).eq('id', id);
  if (error) return { success: false, error: error.message };

  // Enviar mensaje WhatsApp al cliente
  const wa = getWaClient();
  if (wa && waNumber) {
    const jid = `${waNumber}@c.us`;
    let msg = '';
    if (status === 'en_preparacion') msg = `🍳 *¡Tu pedido está en preparación!* ⏱\n\nEn breve estará listo. Sigue el estado:\n🔗 ${trackingUrl}`;
    else if (status === 'en_camino') msg = `🛵 *¡Tu pedido ya va en camino!* 🚀\n\nSigue el estado:\n🔗 ${trackingUrl}`;
    else if (status === 'listo_recoger') msg = `✅ *¡Tu pedido está listo para recoger!* 🥢\n\nPuedes pasar cuando quieras.`;
    else if (status === 'entregado') msg = `🎉 *¡Pedido entregado!* Gracias por elegir *Casa LAMAD*. ¡Hasta la próxima! 🥢`;
    else if (status === 'cancelado') msg = `❌ Tu pedido fue cancelado. Para más info escríbenos por aquí.`;

    if (msg) {
      try {
        await wa.sendMessage(jid, msg);
      } catch (e) {
        console.error('[MAIN] Error enviando WA:', e.message);
      }
    }
  }

  return { success: true, id, status };
});

// ── IPC: Control de chat (pausar/reanudar) ───────────────────────────────────
ipcMain.on('pause-sender', (_, jid) => pauseSender(jid));
ipcMain.on('resume-sender', (_, jid) => resumeSender(jid));

ipcMain.on('pause-bot', () => setGlobalPause(true));
ipcMain.on('resume-bot', () => setGlobalPause(false));

ipcMain.on('shutdown-bot', async () => {
  console.log('[MAIN] Apagado solicitado desde la UI.');
  const wa = getWaClient();
  if (wa) {
    try {
      await wa.destroy();
    } catch (err) {}
  }
  app.quit();
});

ipcMain.on('logout-whatsapp', async () => {
  await logoutWhatsApp();
  // Reiniciar la app o relanzarla para que pida el QR
  app.relaunch();
  app.exit(0);
});

// ── IPC: Archivar historial ──────────────────────────────────────────────────
const fs = require('fs');

ipcMain.handle('archive-history', async () => {
  const cfg = store.get('settings') || {};
  const supabase = createClient(
    cfg.supabaseUrl || 'https://bwdtnlfcdanpusocmvux.supabase.co',
    cfg.supabaseKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3ZHRubGZjZGFucHVzb2NtdnV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NDk1ODYsImV4cCI6MjA5NzIyNTU4Nn0.dIQYr1av-4_NqETqJwBNrwTN3pFNJhDgYiSSa83ltSg',
    { auth: { persistSession: false }, global: { WebSocket: require('ws') } }
  );

  const today = new Date().toISOString().split('T')[0];
  
  const { data, error } = await supabase
    .from('pedidos')
    .select('*')
    .lt('created_at', today);

  if (error) {
    console.error('[MAIN] Error buscando historial:', error);
    return false;
  }

  if (!data || data.length === 0) return true;

  const archivePath = path.join(app.getPath('userData'), 'historial_archivado.json');
  let existing = [];
  if (fs.existsSync(archivePath)) {
    try { existing = JSON.parse(fs.readFileSync(archivePath, 'utf8')); } catch(e){}
  }

  const newArchive = [...existing, ...data];
  fs.writeFileSync(archivePath, JSON.stringify(newArchive, null, 2));

  const ids = data.map(d => d.id);
  const { error: delErr } = await supabase
    .from('pedidos')
    .delete()
    .in('id', ids);

  if (delErr) {
    console.error('[MAIN] Error borrando de supabase:', delErr);
    return false;
  }

  return true;
});
