// whatsapp.service.js — Bot de WhatsApp para Casa LAMAD
// Basado en whatsapp-web.js (Puppeteer) — sin problemas de ESM
// Arquitectura inspirada en bug-mate (github.com/ignaciobecher/bug-mate)

const { Client, LocalAuth, MessageTypes } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');
const { customAlphabet } = require('nanoid');
const Store = require('electron-store');

const store = new Store();
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

// ── Estado en memoria ────────────────────────────────────────────────────────
const sessions = new Map();   // jid -> { status, data }
const pausedSenders = new Map(); // jid -> { timer }

function getSession(jid) {
  if (!sessions.has(jid)) sessions.set(jid, { status: 'IDLE', data: {} });
  return sessions.get(jid);
}
function setSession(jid, update) {
  sessions.set(jid, { ...getSession(jid), ...update });
}

// ── Supabase ──────────────────────────────────────────────────────────────────
let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const cfg = store.get('settings') || {};
  const url = cfg.supabaseUrl || 'https://bwdtnlfcdanpusocmvux.supabase.co';
  const key = cfg.supabaseKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3ZHRubGZjZGFucHVzb2NtdnV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NDk1ODYsImV4cCI6MjA5NzIyNTU4Nn0.dIQYr1av-4_NqETqJwBNrwTN3pFNJhDgYiSSa83ltSg';
  supabaseClient = createClient(url, key, {
    auth: { persistSession: false },
    global: { WebSocket: require('ws') }
  });
  return supabaseClient;
}

async function crearPedido(pedidoData) {
  const supabase = getSupabase();
  const token = nanoid();
  const trackingUrl = `https://casalamad.vercel.app/tracking/${token}`;
  const hoy = new Date().toISOString().split('T')[0];

  let esFraude = false;
  try {
    const { data: dbPlatos } = await supabase.from('platos').select('nombre, porciones');
    if (dbPlatos) {
      for (const item of pedidoData.items) {
        // Encontramos el plato por coincidencia parcial o total
        const platoDb = dbPlatos.find(p => item.nombre.toLowerCase().includes(p.nombre.toLowerCase()) || p.nombre.toLowerCase().includes(item.nombre.toLowerCase()));
        if (platoDb && Array.isArray(platoDb.porciones)) {
          // Buscamos si alguno de los precios coincide
          const matchPrecio = platoDb.porciones.some(porc => Number(porc.priceNum) === Number(item.precio_unitario));
          if (!matchPrecio) {
            esFraude = true;
            break;
          }
        }
      }
    }
  } catch (err) {
    console.error('[BOT] Error validando precios:', err);
  }

  const { count } = await supabase
    .from('pedidos')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', hoy);

  // Separar solo los campos que NO existen como columnas en Supabase
  const { notas, ...pedidoInsert } = pedidoData;

  const { data, error } = await supabase
    .from('pedidos')
    .insert({
      ...pedidoInsert,
      numero: (count || 0) + 1,
      tracking_token: token,
      tracking_url: trackingUrl,
      tracking_activo: true,
      wa_tracking_enviado: false,
      estado: esFraude ? 'fraude_potencial' : 'confirmado'
    })
    .select()
    .single();

  // Adjuntar notas al objeto retornado para mostrarlas en el panel (no se persisten en BD)
  const pedido = data ? { ...data, notas } : null;

  return { pedido, trackingUrl, error, esFraude };
}

// ── Parser de pedidos del menú digital ───────────────────────────────────────
function parseCartMessage(text) {
  if (!text) return null;
  const isOrderMsg = text.includes('LAMAD') || text.includes('Lamad') ||
                     (text.includes('Pedido') && text.includes('Total'));
  if (!isOrderMsg) return null;

  try {
    const lines = text.split('\n');
    let nombre = 'Cliente', tipo_entrega = 'recogida', direccion = '', total = 0, notas = '';
    const items = [];
    let inItems = false;

    for (const line of lines) {
      // Limpiar markdown Y emojis/caracteres especiales al inicio
      const l = line.replace(/[*_]/g, '').replace(/^[\s\u{1F000}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}━•\s]+/u, '').trim();
      if (!l) continue;

      if (/^Nombre:/i.test(l))    nombre = l.replace(/^Nombre:\s*/i, '').trim();
      if (/^Tel[eé]fono:/i.test(l)) {/* ignorar, ya tenemos el jid */}
      if (/^Modalidad:/i.test(l)) tipo_entrega = l.toLowerCase().includes('domicilio') ? 'domicilio' : 'recogida';
      if (/^Direcci[oó]n/i.test(l) && l.includes(':')) direccion = l.split(':').slice(1).join(':').trim();
      if (/^Notas?:/i.test(l))    notas = l.replace(/^Notas?:\s*/i, '').trim();

      if (/^TOTAL:/i.test(l) || l.toUpperCase().startsWith('TOTAL')) {
        const m = l.replace(/\./g, '').replace(/,/g, '').match(/\$?\s*(\d+)/);
        if (m) total = parseInt(m[1]);
      }

      if (/Detalle del pedido|platos/i.test(l)) { inItems = true; continue; }
      if (/^Pedido generado/i.test(l)) { inItems = false; continue; }

      if (inItems && line.includes('•')) {
        const raw = line.replace(/[*_]/g, '');
        const cantM = raw.match(/[×x×]\s*(\d+)/i) || raw.match(/(\d+)\s*[×x×]/i);
        const cantidad = cantM ? parseInt(cantM[1]) : 1;
        const nombreItem = raw.split('•')[1]?.split(/[×x×]/i)[0]?.split('→')[0]?.split('(')[0]?.trim() || 'Plato';
        const priceM = raw.replace(/\./g, '').match(/→\s*\$?\s*(\d+)/);
        const subtotal = priceM ? parseInt(priceM[1]) : 0;
        if (nombreItem && subtotal > 0) {
          items.push({ nombre: nombreItem.trim(), cantidad, precio_unitario: Math.round(subtotal / Math.max(cantidad, 1)), subtotal });
        }
      }
    }
    return items.length > 0 ? { cliente_nombre: nombre, tipo_entrega, direccion, items, subtotal: total, total, notas } : null;
  } catch (e) { console.error('[PARSER]', e); return null; }
}

// ── Anti-Ban & Typing Simulation ──────────────────────────────────────────────
async function replyWithDelay(message, text) {
  try {
    const chat = await message.getChat();
    // Enviar estado de escribiendo
    await chat.sendStateTyping();
    // Retraso dinámico: 30ms por carácter, con un mínimo de 1.5s y máximo de 4s
    const delayMs = Math.min(Math.max(text.length * 30, 1500), 4000);
    await new Promise(res => setTimeout(res, delayMs));
    // Enviar mensaje
    await message.reply(text);
  } catch (err) {
    // Fallback si falla el getChat o el typing state
    await message.reply(text);
  }
}

// ── Manejador de mensajes ─────────────────────────────────────────────────────
async function handleMessage(client, message, emitToPanel) {
  const jid = message.from;
  let waNumber = jid.replace(/@.*/, '');
  try {
    const contact = await message.getContact();
    if (contact && contact.number) waNumber = contact.number;
  } catch (e) {}

  // Ignorar grupos y mensajes propios
  if (message.fromMe || jid.endsWith('@g.us') || jid.endsWith('@broadcast')) return;

  // Si el humano pausó este chat, ignorar
  if (pausedSenders.has(jid)) return;

  const text = message.body?.trim() || '';
  if (!text && message.type !== MessageTypes.IMAGE) return;

  // 1. Detectar mensaje de pedido del carrito
  const order = parseCartMessage(text);
  if (order) {
    order.cliente_wa = waNumber;
    const { pedido, trackingUrl, error, esFraude } = await crearPedido(order);

    if (error || !pedido) {
      console.error('[BOT] Error Supabase:', error);
      await replyWithDelay(message, '❌ Hubo un error al registrar tu pedido. Por favor intenta de nuevo o escríbenos directamente.');
      return;
    }

    emitToPanel('order:new', pedido);
    setSession(jid, { status: 'DONE', data: {} });
    
    if (esFraude) {
      await replyWithDelay(message,
        `⚠️ *Tu pedido requiere revisión manual.*\n\n` +
        `Hemos detectado una inconsistencia en los precios. Un asesor revisará tu pedido en breve y se pondrá en contacto contigo.`
      );
      // Pausar y alertar asesor
      pauseSender(jid, waNumber);
      emitToPanel('advisor-alert', { waNumber: waNumber, msg: 'Inconsistencia de precios en pedido del carrito.' });
    } else {
      await replyWithDelay(message,
        `✅ *¡Pedido #${String(pedido.numero).padStart(3, '0')} confirmado!* 🥢\n\n` +
        `Hola ${order.cliente_nombre}, recibimos tu pedido con *${order.items.length} plato(s)*.\n\n` +
        `🔗 Sigue el estado en tiempo real:\n${trackingUrl}\n\n` +
        `¡Gracias por elegir Casa LAMAD! 🙏`
      );
    }
    return;
  }

  // 2. Menú de opciones
  const sess = getSession(jid);
  const txt = text.toLowerCase();

  if (sess.status === 'IDLE' || sess.status === 'DONE' || txt === 'hola' || txt === 'menu' || txt === 'menú' || txt === 'inicio') {
    setSession(jid, { status: 'MENU', data: {} });
    await replyWithDelay(message,
      `¡Hola! 👋 Bienvenido a *Casa LAMAD — Arroz al Wok* 🥢\n\n` +
      `¿En qué te podemos ayudar hoy?\n\n` +
      `*1️⃣* 🥢 Ver Menú y Hacer Pedido\n` +
      `*2️⃣* 🛵 Rastrear mi Pedido\n` +
      `*3️⃣* 🕘 Horarios y Ubicación\n` +
      `*4️⃣* 👨‍🍳 Hablar con un Asesor\n\n` +
      `_Responde con el número de la opción._`
    );
    return;
  }

  if (sess.status === 'MENU') {
    if (txt === '1') {
      setSession(jid, { status: 'WAITING_ORDER' });
      await replyWithDelay(message,
        `¡Perfecto! 🍜 Entra al menú digital, arma tu pedido y al finalizar *envía el resumen directamente por aquí*:\n\n` +
        `🔗 https://casalamad.vercel.app/\n\n` +
        `_El bot lo registrará y te enviará el tracking al instante._`
      );
    } else if (txt === '2') {
      await replyWithDelay(message, `🔍 Para ver el estado de tu pedido, usa el enlace de tracking que te enviamos al confirmar.\n\nSi no lo tienes, escríbenos tu nombre y número de pedido.`);
      setSession(jid, { status: 'IDLE' });
    } else if (txt === '3') {
      await replyWithDelay(message,
        `🕘 *Horario de Atención:*\n11:00 am – 10:00 pm (Lunes a Domingo)\n\n` +
        `📍 *Ubicación:*\nCra 24e #14-08 · Sector 25 Manzanares\n` +
        `🔗 https://maps.app.goo.gl/JERm3cEdqyYrPNAK7`
      );
      setSession(jid, { status: 'IDLE' });
    } else if (txt === '4') {
      await replyWithDelay(message, `👨‍🍳 ¡Claro! Un asesor tomará el control en breve. ¡Gracias por tu paciencia!`);
      setSession(jid, { status: 'HUMAN' });
      pauseSender(jid, waNumber);
      emitToPanel('advisor-alert', { waNumber: waNumber, msg: 'El cliente solicitó atención de un asesor.' });
    } else {
      await replyWithDelay(message, `Por favor responde con un número del *1* al *4*. 😊`);
    }
    return;
  }

  if (sess.status === 'WAITING_ORDER') {
    if (txt === 'menu' || txt === 'menú' || txt === 'inicio' || txt === 'hola') {
      setSession(jid, { status: 'IDLE' });
      await replyWithDelay(message, `¡Claro! Volvemos al inicio 😊`);
    } else {
      await replyWithDelay(message,
        `⏳ Estoy esperando el resumen de tu pedido desde el menú.\n\n` +
        `🔗 https://casalamad.vercel.app/\n\n` +
        `Escribe *menú* para volver al inicio.`
      );
    }
    return;
  }

  // Catch-all
  await replyWithDelay(message, `¡Hola! 😊 Escribe *hola* o *menú* para ver las opciones.`);
}

// ── Servicio principal ────────────────────────────────────────────────────────
let waClient = null;
let emitter = null;
let readyAt = null;
let globalPause = false;

function setBotState(status, message, qr = null) {
  if (emitter) emitter('bot-state-update', { status, message, qr });
}

function startWhatsAppBot(emitToPanel) {
  emitter = emitToPanel;
  setBotState('Iniciando', '🔄 Iniciando bot de WhatsApp...');

  waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    },
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote']
    }
  });

  waClient.on('qr', async (qr) => {
    console.log('[BOT] QR generado — esperando escaneo...');
    const qrDataUrl = await QRCode.toDataURL(qr);
    setBotState('QR esperando escaneo', '📱 Escanea el QR con WhatsApp', qrDataUrl);
  });

  waClient.on('authenticated', () => {
    setBotState('Autenticado', '🔐 Sesión autenticada...');
  });

  waClient.on('auth_failure', (msg) => {
    console.error('[BOT] Auth falló:', msg);
    setBotState('Error', '⛔ Error de autenticación. Revisa la sesión.');
  });

  waClient.on('ready', () => {
    readyAt = Date.now();
    console.log('[BOT] ¡Conectado! Bot de Casa LAMAD listo.');
    setBotState('Conectado', '🟢 Conectado a WhatsApp');
  });

  waClient.on('disconnected', (reason) => {
    console.warn('[BOT] Desconectado:', reason);
    setBotState('Desconectado', '🔄 Desconectado. Reiniciando...');
    setTimeout(() => startWhatsAppBot(emitToPanel), 5000);
  });

  waClient.on('message', async (message) => {
    const msgTs = message.timestamp * 1000;
    if (readyAt && msgTs < readyAt) return; // Ignorar mensajes offline

    try {
      if (globalPause && !pausedSenders.has(message.from) && !message.fromMe && message.from.endsWith('@c.us')) {
        await replyWithDelay(message, "En este momento no estamos tomando pedidos automáticos, un asesor te atenderá en breve.");
        pauseSender(message.from);
        return;
      }
      await handleMessage(waClient, message, emitToPanel);
    } catch (err) {
      console.error('[BOT] Error en handleMessage:', err.message);
    }
  });

  // Dev tomó control manualmente → pausar bot para ese número
  waClient.on('message_create', async (message) => {
    if (!message.fromMe) return;
    const jid = message.to;
    if (jid.endsWith('@c.us') && !pausedSenders.has(jid)) {
      pauseSender(jid);
      console.log(`[BOT] Bot pausado para ${jid} (control manual)`);
    }
  });

  waClient.initialize();
}

function getWaClient() {
  return waClient;
}

function emitActiveChats() {
  if (emitter) {
    const list = Array.from(pausedSenders.values()).map(data => data.waNumber);
    emitter('active-chats', list);
  }
}

function pauseSender(jid, waNumber = null) { 
  if (pausedSenders.has(jid)) {
    clearTimeout(pausedSenders.get(jid).timer);
    if (!waNumber) waNumber = pausedSenders.get(jid).waNumber;
  }
  
  if (!waNumber) waNumber = jid.replace(/@.*/, '');

  // Pausa por 30 minutos
  const timer = setTimeout(() => {
    resumeSender(jid);
    if (waClient) {
      waClient.sendMessage(jid, '🤖 _Hola nuevamente, el bot ha retomado el control automático de este chat._');
    }
  }, 1000 * 60 * 30);

  pausedSenders.set(jid, { timer, waNumber });
  emitActiveChats();
}

function resumeSender(jid) { 
  if (pausedSenders.has(jid)) {
    clearTimeout(pausedSenders.get(jid).timer);
    pausedSenders.delete(jid);
  }
  setSession(jid, { status: 'IDLE', data: {} });
  emitActiveChats();
}

function setGlobalPause(isPaused) {
  globalPause = isPaused;
  setBotState(isPaused ? 'Pausado' : 'Conectado', isPaused ? '⏸ Bot Pausado Globalmente' : '🟢 Conectado a WhatsApp');
}

module.exports = { startWhatsAppBot, getWaClient, pauseSender, resumeSender, setGlobalPause };
