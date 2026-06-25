// bot-worker.mjs — Proceso hijo ESM, validado con Node.js v25 + Baileys 6.4.0
import pino from 'pino';
import * as baileysModule from '@whiskeysockets/baileys';
import { createRequire } from 'module';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ✅ PATRÓN VALIDADO: makeWASocket está en los exports nombrados
const makeWASocket = baileysModule.default?.default || baileysModule.makeWASocket;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileysModule;

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const QRCode = require('qrcode');

// ── IPC con el proceso principal ──────────────────────────────────────────────
function emit(event, payload) {
  if (process.send) {
    process.send({ event, payload });
  }
}

// ── Estado de conversaciones ──────────────────────────────────────────────────
const states = new Map();
function getState(jid) {
  if (!states.has(jid)) states.set(jid, { status: 'IDLE' });
  return states.get(jid);
}
function setState(jid, update) {
  states.set(jid, { ...getState(jid), ...update });
}

// ── Config Supabase (llega via IPC) ──────────────────────────────────────────
let config = {
  supabaseUrl: 'https://bwdtnlfcdanpusocmvux.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3ZHRubGZjZGFucHVzb2NtdnV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NDk1ODYsImV4cCI6MjA5NzIyNTU4Nn0.dIQYr1av-4_NqETqJwBNrwTN3pFNJhDgYiSSa83ltSg'
};

process.on('message', (msg) => {
  if (!msg) return;
  if (msg.type === 'config') config = { ...config, ...msg.config };
});

// ── Supabase ──────────────────────────────────────────────────────────────────
async function getSupabase() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(config.supabaseUrl, config.supabaseKey);
}

async function crearPedido(pedidoData) {
  const { customAlphabet } = await import('nanoid');
  const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);
  const supabase = await getSupabase();

  const token = nanoid();
  const trackingUrl = `https://casalamad.vercel.app/tracking/${token}`;
  const hoy = new Date().toISOString().split('T')[0];

  const { count } = await supabase
    .from('pedidos')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', hoy);

  const { data, error } = await supabase
    .from('pedidos')
    .insert({
      ...pedidoData,
      numero: (count || 0) + 1,
      tracking_token: token,
      tracking_url: trackingUrl,
      tracking_activo: true,
      wa_tracking_enviado: false,
      estado: 'confirmado'
    })
    .select()
    .single();

  return { pedido: data, trackingUrl, error };
}

// ── Parser de pedidos del carrito ────────────────────────────────────────────
function parseCartMessage(text) {
  if (!text || (!text.includes('Casa Lamad') && !text.includes('LAMAD') && !text.includes('Pedido'))) return null;
  try {
    const lines = text.split('\n');
    let nombre = 'Cliente', tipo_entrega = 'recogida', direccion = '', total = 0;
    const items = [];
    let inItems = false;

    for (const line of lines) {
      const l = line.replace(/\*/g, '').trim();
      if (l.match(/^Nombre:/i)) nombre = l.split(':').slice(1).join(':').trim();
      if (l.match(/Modalidad:|Entrega:/i)) tipo_entrega = l.toLowerCase().includes('domicilio') ? 'domicilio' : 'recogida';
      if (l.match(/Direcci/i) && l.includes(':')) direccion = l.split(':').slice(1).join(':').trim();
      if (l.match(/TOTAL|Total/)) {
        const m = l.replace(/\./g, '').match(/\$?\s*(\d+)/);
        if (m) total = parseInt(m[1]);
      }
      if (l.match(/Detalle|detalle/i)) { inItems = true; continue; }
      if (inItems && l.includes('•')) {
        const cantM = l.match(/[×x]\s*(\d+)/i) || l.match(/(\d+)\s*[×x]/i);
        const cantidad = cantM ? parseInt(cantM[1]) : 1;
        const nombreItem = l.split('•')[1]?.split(/[×x]/i)[0]?.split('→')[0]?.trim() || 'Plato';
        const priceM = l.replace(/\./g, '').match(/→\s*\$?\s*(\d+)/);
        const subtotal = priceM ? parseInt(priceM[1]) : 0;
        items.push({ nombre: nombreItem, cantidad, precio_unitario: Math.round(subtotal / Math.max(cantidad, 1)), subtotal });
      }
    }
    return items.length > 0 ? { cliente_nombre: nombre, tipo_entrega, direccion, items, subtotal: total, total } : null;
  } catch { return null; }
}

// ── Manejador de mensajes ────────────────────────────────────────────────────
async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast')) return;

  const text = msg.message?.conversation ||
               msg.message?.extendedTextMessage?.text ||
               msg.message?.imageMessage?.caption || '';
  if (!text.trim()) return;

  // 1. Detectar pedido del carrito del menú
  const order = parseCartMessage(text);
  if (order) {
    order.cliente_wa = jid.replace('@s.whatsapp.net', '');
    const { pedido, trackingUrl, error } = await crearPedido(order);
    if (error) {
      console.error('[WORKER] Error Supabase:', error);
      await sock.sendMessage(jid, { text: '❌ Hubo un error al registrar tu pedido. Intenta de nuevo.' });
      return;
    }
    emit('order:new', pedido);
    setState(jid, { status: 'DONE' });
    await sock.sendMessage(jid, {
      text: `✅ *¡Pedido #${String(pedido.numero).padStart(3,'0')} confirmado!* 🥢\n\nHola ${order.cliente_nombre}, ya registramos tu pedido.\n\nSigue el estado en tiempo real:\n🔗 ${trackingUrl}\n\n¡Gracias por elegir Casa LAMAD!`
    });
    return;
  }

  // 2. Menú de opciones
  const state = getState(jid);
  const txt = text.trim();

  if (state.status === 'IDLE' || state.status === 'DONE') {
    await sock.sendMessage(jid, {
      text: `¡Hola! 👋 Bienvenido a *Casa LAMAD — Arroz al Wok* 🥢\n\nSelecciona una opción:\n\n*1️⃣* Hacer un pedido (ver menú)\n*2️⃣* Estado de mi pedido\n*3️⃣* Hablar con un asesor\n\n_Responde con el número._`
    });
    setState(jid, { status: 'MENU' });
    return;
  }

  if (state.status === 'MENU') {
    if (txt === '1') {
      await sock.sendMessage(jid, {
        text: `¡Perfecto! 🍜 Ingresa al menú, arma tu pedido y al finalizar *envía el resumen aquí* para confirmarlo:\n\n🔗 https://casalamad.vercel.app/`
      });
      setState(jid, { status: 'WAITING_ORDER' });
    } else if (txt === '2') {
      await sock.sendMessage(jid, { text: `🔍 Usa el enlace de tracking que te enviamos al confirmar tu pedido.\n\nSi no lo tienes, escríbenos tu nombre y número de pedido.` });
      setState(jid, { status: 'IDLE' });
    } else if (txt === '3') {
      await sock.sendMessage(jid, { text: `👨‍🍳 En un momento un asesor te atenderá. ¡Gracias por tu paciencia!` });
      setState(jid, { status: 'HUMAN' });
    } else {
      await sock.sendMessage(jid, { text: `Por favor responde con *1*, *2* o *3*. 😊` });
    }
    return;
  }

  if (state.status === 'WAITING_ORDER') {
    const reset = txt === 'menu' || txt === 'menú' || txt === 'inicio' || txt === 'hola';
    if (reset) { setState(jid, { status: 'IDLE' }); }
    await sock.sendMessage(jid, {
      text: reset
        ? `¡Claro! Volvemos al inicio 😊`
        : `⏳ Estoy esperando el resumen de tu pedido desde el menú.\n\n🔗 https://casalamad.vercel.app/\n\nEscribe *menú* para volver al inicio.`
    });
    return;
  }

  // Cualquier mensaje no reconocido
  await sock.sendMessage(jid, { text: `¡Hola! 😊 Escribe *hola* o *menú* para ver las opciones.` });
}

// ── Conexión principal ────────────────────────────────────────────────────────
let sock = null;

async function startBot() {
  emit('status', { status: 'Iniciando', message: '🔄 Iniciando bot...', qr: null });

  const authPath = join(__dirname, '..', '..', 'auth');
  mkdirSync(authPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr);
      emit('status', { status: 'QR esperando escaneo', message: '📱 Escanea el QR con WhatsApp', qr: qrDataUrl });
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log('[WORKER] Conexión cerrada. Código:', code, 'Reconectar:', shouldReconnect);
      emit('status', { status: 'Desconectado', message: '🔄 Reconectando en 3s...', qr: null });
      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      } else {
        emit('status', { status: 'Error fatal', message: '⛔ Sesión cerrada. Borra la carpeta auth y reinicia.', qr: null });
      }
    } else if (connection === 'open') {
      emit('status', { status: 'Conectado', message: '🟢 Conectado a WhatsApp', qr: null });
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.key.fromMe && msg.message) {
        await handleMessage(sock, msg).catch(console.error);
      }
    }
  });
}

startBot().catch((err) => {
  console.error('[BOT WORKER]', err.message);
  emit('status', { status: 'Error fatal', message: '⛔ ' + err.message, qr: null });
});
