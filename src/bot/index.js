// index.js — Bridge entre Electron (CJS) y el worker ESM de Baileys
// Usa child_process.fork para correr el worker en un proceso Node.js separado

const { fork } = require('child_process');
const path = require('path');
const Store = require('electron-store');

const store = new Store();
let workerProcess = null;
let emitToPanel = null;
let _sock = null; // referencia lógica para envío de mensajes

function getBotState() {
  return _lastState || { status: 'Iniciando', message: 'Conectando...', qr: null };
}

let _lastState = { status: 'Iniciando', message: 'Conectando...', qr: null };

function startBot(emitFunction) {
  emitToPanel = emitFunction;

  const workerPath = path.join(__dirname, 'bot-worker.mjs');
  const settings = store.get('settings') || {};

  // Lanzar proceso hijo ESM con Node.js puro (fuera del entorno Electron)
  // Usamos node.exe del sistema (no el de Electron) para poder cargar módulos ESM
  const possibleNodePaths = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    process.env.npm_node_execpath,
    'node' // fallback PATH
  ].filter(Boolean);
  
  const nodePath = possibleNodePaths[0];

  workerProcess = fork(workerPath, [], {
    execPath: nodePath,  // Usar Node.js real, no Electron
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env }
  });

  // Enviar configuración de Supabase al worker
  workerProcess.send({ type: 'config', config: settings });

  // Escuchar mensajes del worker
  workerProcess.on('message', (msg) => {
    if (!msg || !msg.event) return;
    
    if (msg.event === 'status') {
      _lastState = msg.payload;
    }
    
    if (emitToPanel) {
      emitToPanel(msg.event === 'status' ? 'bot-state-update' : msg.event, msg.payload);
    }
  });

  workerProcess.stdout?.on('data', (data) => {
    console.log('[BOT WORKER STDOUT]', data.toString());
  });

  workerProcess.stderr?.on('data', (data) => {
    console.error('[BOT WORKER STDERR]', data.toString());
    if (emitToPanel) {
      emitToPanel('bot-state-update', {
        status: 'Error',
        message: '⚠ ' + data.toString().substring(0, 80),
        qr: null
      });
    }
  });

  workerProcess.on('exit', (code) => {
    console.log('[BOT WORKER] Proceso terminó con código', code);
    if (emitToPanel) {
      emitToPanel('bot-state-update', {
        status: 'Desconectado',
        message: '🔄 Bot detenido. Reiniciando...',
        qr: null
      });
    }
    // Reiniciar automáticamente a los 5 segundos
    setTimeout(() => startBot(emitToPanel), 5000);
  });

  // Crear proxy de sendMessage para que main.js pueda enviar mensajes WA
  _sock = {
    sendMessage: (jid, content) => {
      if (workerProcess) {
        workerProcess.send({ type: 'send-message', jid, text: content.text });
      }
    }
  };
}

function getSock() {
  return _sock;
}

module.exports = { startBot, getBotState, getSock };
