const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Bot status
  getBotState: () => ipcRenderer.send('get-bot-state'),
  onBotState: (cb) => ipcRenderer.on('bot-state-update', (_, data) => cb(data)),

  // Orders
  loadOrders: () => ipcRenderer.invoke('load-orders'),
  archiveHistory: () => ipcRenderer.invoke('archive-history'),
  updateOrderStatus: (payload) => ipcRenderer.invoke('update-order-status', payload),
  onOrderNew: (cb) => ipcRenderer.on('order:new', (_, data) => cb(data)),

  // Settings
  getSettings: () => ipcRenderer.send('get-settings'),
  onSettingsLoaded: (cb) => ipcRenderer.on('settings-loaded', (_, data) => cb(data)),
  saveSettings: (settings) => ipcRenderer.send('save-settings', settings),
  onSettingsSaved: (cb) => ipcRenderer.on('settings-saved', (_, ok) => cb(ok)),

  // Chat control
  pauseSender: (jid) => ipcRenderer.send('pause-sender', jid),
  resumeSender: (jid) => ipcRenderer.send('resume-sender', jid),

  // Global bot control
  pauseBot: () => ipcRenderer.send('pause-bot'),
  resumeBot: () => ipcRenderer.send('resume-bot'),
  shutdownBot: () => ipcRenderer.send('shutdown-bot'),

  // Alerts & Active Chats
  onAdvisorAlert: (cb) => ipcRenderer.on('advisor-alert', (_, data) => cb(data)),
  onActiveChats: (cb) => ipcRenderer.on('active-chats', (_, data) => cb(data)),

  // Auto-updater
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, data) => cb(data)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, data) => cb(data)),
  installUpdate: () => ipcRenderer.send('install-update'),
});
