// whatsapp.service.js — Bot de WhatsApp para Casa LAMAD
// Basado en whatsapp-web.js (Puppeteer) — sin problemas de ESM
// Arquitectura inspirada en bug-mate (github.com/ignaciobecher/bug-mate)

const { Client, LocalAuth, MessageTypes, MessageMedia } = require('whatsapp-web.js');
const { app } = require('electron');
const path = require('path');
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

  // Validación de precios (solo informativa, no bloquea pedidos)
  try {
    const { data: dbPlatos } = await supabase.from('platos').select('nombre, porciones');
    if (dbPlatos) {
      for (const item of pedidoData.items) {
        const platoDb = dbPlatos.find(p => item.nombre.toLowerCase().includes(p.nombre.toLowerCase()) || p.nombre.toLowerCase().includes(item.nombre.toLowerCase()));
        if (platoDb && Array.isArray(platoDb.porciones)) {
          const matchPrecio = platoDb.porciones.some(porc => Number(porc.priceNum) === Number(item.precio_unitario));
          if (!matchPrecio) {
            console.log(`[BOT] ⚠ Precio no coincide exacto para "${item.nombre}" ($${item.precio_unitario}) vs DB "${platoDb.nombre}". Puede ser diferencia de porción.`);
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
      estado: 'confirmado'
    })
    .select()
    .single();

  // Adjuntar notas al objeto retornado para mostrarlas en el panel (no se persisten en BD)
  const pedido = data ? { ...data, notas } : null;

  return { pedido, trackingUrl, error, esFraude: false };
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

// ── Anti-Ban Suite ─────────────────────────────────────────────────────────────
const _lastReply = new Map(); // jid -> timestamp, para rate limiting

async function humanDelay(min = 800, max = 2500) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(res => setTimeout(res, ms));
}

async function replyWithDelay(message, text) {
  const jid = message.from;

  // 1. Rate limiting: mínimo 1.5s entre respuestas al mismo chat
  const lastTime = _lastReply.get(jid) || 0;
  const gap = Date.now() - lastTime;
  if (gap < 1500) await new Promise(res => setTimeout(res, 1500 - gap));

  try {
    // 2. Marcar mensaje como leído (simula comportamiento humano)
    await message.getChat().then(c => c.sendSeen()).catch(() => {});

    // 3. Pausa inicial breve antes de empezar a "escribir"
    await humanDelay(400, 900);

    // 4. Mostrar indicador de escritura
    const chat = await message.getChat();
    await chat.sendStateTyping();

    // 5. Retraso proporcional al largo del texto + jitter aleatorio
    const baseDelay = Math.min(Math.max(text.length * 28, 1200), 4500);
    const jitter = Math.floor(Math.random() * 800);
    await new Promise(res => setTimeout(res, baseDelay + jitter));

    // 6. Enviar respuesta
    await message.reply(text);
  } catch (err) {
    // Fallback silencioso si falla el typing state
    await humanDelay(1000, 2000);
    try { await message.reply(text); } catch (e) { console.error('[BOT] Error enviando mensaje:', e.message); }
  }

  _lastReply.set(jid, Date.now());
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

  // 1. Detectar mensaje de pedido del carrito (Legacy - por si alguien usa link viejo)
  const order = parseCartMessage(text);
  if (order) {
    order.cliente_wa = waNumber;
    const { pedido, trackingUrl, error, esFraude } = await crearPedido(order);
    if (error || !pedido) {
      await replyWithDelay(message, '❌ Hubo un error al registrar tu pedido. Por favor intenta de nuevo o escríbenos directamente.');
      return;
    }
    emitToPanel('order:new', pedido);
    setSession(jid, { status: 'DONE', data: {} });
    await replyWithDelay(message, `✅ *¡Pedido confirmado!* 🥢\n\nHola ${order.cliente_nombre}, recibimos tu pedido.\n\n🔗 Sigue el estado en tiempo real:\n${trackingUrl}`);
    return;
  }

  // 2. State Machine para Toma de Pedidos 100% WhatsApp
  const sess = getSession(jid);
  const txt = text.toLowerCase();
  let data = sess.data || {};

  // Función para obtener menú desde Supabase (Lista plana, sin categorías)
  const getMenu = async () => {
    const supabase = getSupabase();
    const { data: platos } = await supabase.from('platos').select('*').eq('visible', true).order('orden');
    return platos || [];
  };

  // Comandos globales para reiniciar
  const isGreeting = /hola|buenas|buenos|que tal|menu|menú|inicio|quiero|pedir/i.test(txt);
  
  if (isGreeting && (sess.status === 'IDLE' || sess.status === 'DONE' || sess.status === 'MENU_ITEMS')) {
    const platos = await getMenu();
    data = { menuPlatos: platos, cart: [], tempItem: null };
    setSession(jid, { status: 'MENU_ITEMS', data });
    
    // Enviar imagen del menú si existe
    try {
      const menuImgPath = path.join(__dirname, '../../assets/menu.png');
      if (require('fs').existsSync(menuImgPath)) {
        const media = MessageMedia.fromFilePath(menuImgPath);
        await client.sendMessage(jid, media);
      }
    } catch (e) {
      console.error('[BOT] Error enviando imagen del menú:', e.message || e);
    }

    let msg = `¡Hola! 👋 Bienvenido a *Casa LAMAD — Arroz al Wok* 🥢\n\n¿Qué te gustaría pedir hoy?\n_Escribe el nombre del plato o el número correspondiente:_\n\n`;
    platos.forEach((item, index) => {
      msg += `*${index + 1}.* ${item.nombre}\n`;
    });
    msg += `\n*0.* 👨‍🍳 Hablar con un Asesor`;
    
    await replyWithDelay(message, msg);
    return;
  }

  // Si está inactivo o terminó, incitar a escribir hola
  if (sess.status === 'IDLE' || sess.status === 'DONE') {
    await replyWithDelay(message, `¡Hola! 😊 Escribe *hola* o *menú* para ver nuestras opciones y hacer un pedido.`);
    return;
  }

  if (sess.status === 'MENU_ITEMS') {
    if (txt === '0' || txt.includes('asesor') || txt.includes('humano')) {
      await replyWithDelay(message, `👨‍🍳 ¡Claro! Un asesor tomará el control en breve. ¡Gracias por tu paciencia!`);
      setSession(jid, { status: 'HUMAN', data: {} });
      pauseSender(jid, waNumber);
      emitToPanel('advisor-alert', { waNumber: waNumber, msg: 'El cliente solicitó atención de un asesor.' });
      return;
    }

    let itemIndex = parseInt(txt) - 1;
    if (isNaN(itemIndex) && data.menuPlatos) {
      itemIndex = data.menuPlatos.findIndex(i => txt.includes(i.nombre.toLowerCase()) || i.nombre.toLowerCase().includes(txt));
    }

    if (itemIndex >= 0 && data.menuPlatos && itemIndex < data.menuPlatos.length) {
      const item = data.menuPlatos[itemIndex];
      data.tempItem = { plato: item };
      
      if (item.porciones && item.porciones.length > 0) {
        setSession(jid, { status: 'MENU_PORCIONES', data });
        let msg = `Has seleccionado *${item.nombre}*.\n_Elige el tamaño/porción:_\n\n`;
        item.porciones.forEach((p, idx) => {
          msg += `*${idx + 1}.* ${p.label} - ${p.priceStr}\n`;
        });
        msg += `\n*0.* Cancelar y volver`;
        await replyWithDelay(message, msg);
      } else {
        await replyWithDelay(message, `Elegiste *${item.nombre}*. ¿Qué cantidad deseas? (Escribe el número, ej: 1)`);
        data.tempItem.porcion = { label: 'Única', priceNum: 0, priceStr: '$0' }; // fallback temporal
        setSession(jid, { status: 'MENU_CANTIDAD', data });
      }
    } else {
      await replyWithDelay(message, `⚠️ No entendí tu selección. Por favor responde con un número válido de producto.`);
    }
    return;
  }

  if (sess.status === 'MENU_PORCIONES') {
    if (txt === '0') {
      setSession(jid, { status: 'MENU_ITEMS', data });
      await replyWithDelay(message, `❌ Selección cancelada. Elige otro producto de la categoría, o *0* para volver a inicio.`);
      return;
    }
    
    const pIndex = parseInt(txt) - 1;
    const porciones = data.tempItem.plato.porciones;
    if (!isNaN(pIndex) && pIndex >= 0 && pIndex < porciones.length) {
      data.tempItem.porcion = porciones[pIndex];
      setSession(jid, { status: 'MENU_CANTIDAD', data });
      await replyWithDelay(message, `Excelente. ¿Cuántas unidades de *${data.tempItem.plato.nombre} (${data.tempItem.porcion.label})* deseas? (Escribe un número, ej: 2)`);
    } else {
      await replyWithDelay(message, `⚠️ Responde con el número del tamaño, o *0* para cancelar.`);
    }
    return;
  }

  if (sess.status === 'MENU_CANTIDAD') {
    const qty = parseInt(txt);
    if (!isNaN(qty) && qty > 0) {
      const cartItem = {
        nombre: `${data.tempItem.plato.nombre} (${data.tempItem.porcion.label})`,
        cantidad: qty,
        precio_unitario: Number(data.tempItem.porcion.priceNum),
        subtotal: Number(data.tempItem.porcion.priceNum) * qty
      };
      if (!data.cart) data.cart = [];
      data.cart.push(cartItem);
      data.tempItem = null;
      
      setSession(jid, { status: 'MENU_MAS', data });
      await replyWithDelay(message, `✅ Añadido al carrito: *${qty}x ${cartItem.nombre}*\n\n¿Deseas agregar algo más?\n*1.* Sí, seguir viendo el menú\n*2.* No, finalizar mi pedido`);
    } else {
      await replyWithDelay(message, `⚠️ Por favor escribe una cantidad válida (Ej: 1).`);
    }
    return;
  }

  if (sess.status === 'MENU_MAS') {
    if (txt === '1') {
      setSession(jid, { status: 'MENU_ITEMS', data });
      let msg = `_Menú disponible:_\n\n`;
      data.menuPlatos.forEach((item, index) => {
        msg += `*${index + 1}.* ${item.nombre}\n`;
      });
      await replyWithDelay(message, msg);
    } else if (txt === '2') {
      let total = data.cart.reduce((sum, item) => sum + item.subtotal, 0);
      data.total = total;
      setSession(jid, { status: 'CHECKOUT_DIR', data });
      await replyWithDelay(message, `Perfecto. Tu total actual es *$${total.toLocaleString('es-CO')}*.\n\nPara enviártelo, por favor escribe tu *dirección completa* (Ej: Calle 123 #45-67 Barrio Centro) o escribe *RECOGER* si lo buscas en el local.`);
    } else {
      await replyWithDelay(message, `⚠️ Responde *1* para seguir pidiendo o *2* para finalizar.`);
    }
    return;
  }

  if (sess.status === 'CHECKOUT_DIR') {
    data.direccion = text;
    data.tipo_entrega = text.toUpperCase().includes('RECOGER') ? 'recogida' : 'domicilio';
    setSession(jid, { status: 'CHECKOUT_PAGO', data });
    await replyWithDelay(message, `¡Anotado! 📝\n\n¿Cuál será tu método de pago?\n*1.* Efectivo\n*2.* Transferencia (Nequi/Daviplata/Bancolombia)`);
    return;
  }

  if (sess.status === 'CHECKOUT_PAGO') {
    if (txt === '1' || txt === '2') {
      data.notas = txt === '1' ? 'Pago en Efectivo' : 'Pago por Transferencia';
      setSession(jid, { status: 'CHECKOUT_NOMBRE', data });
      await replyWithDelay(message, `Casi listos. Por favor, escribe tu *Nombre* para el pedido:`);
    } else {
      await replyWithDelay(message, `⚠️ Selecciona *1* (Efectivo) o *2* (Transferencia).`);
    }
    return;
  }

  if (sess.status === 'CHECKOUT_NOMBRE') {
    data.cliente_nombre = text;
    
    // Crear el objeto del pedido final
    const finalOrder = {
      cliente_nombre: data.cliente_nombre,
      cliente_wa: waNumber,
      tipo_entrega: data.tipo_entrega,
      direccion: data.direccion,
      items: data.cart,
      subtotal: data.total,
      total: data.total,
      notas: data.notas
    };

    const { pedido, error } = await crearPedido(finalOrder);

    if (error || !pedido) {
      await replyWithDelay(message, `❌ Ocurrió un error al guardar tu pedido. Por favor avísanos o intenta escribir 'menu' nuevamente.`);
    } else {
      emitToPanel('order:new', pedido);
      await replyWithDelay(message, `✅ *¡Pedido #${String(pedido.numero).padStart(3, '0')} Confirmado!* 🚀\n\nResumen:\n${data.cart.map(i => `▪ ${i.cantidad}x ${i.nombre}`).join('\n')}\n\n*Total:* $${data.total.toLocaleString('es-CO')}\n*Dirección:* ${data.direccion}\n\nTe avisaremos por aquí cuando tu pedido esté en camino. ¡Gracias! 🥢`);
    }
    
    setSession(jid, { status: 'DONE', data: {} });
    return;
  }

  // Fallback final
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

const fs = require('fs');

function getBrowserExecutablePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null; // fallback
}

function startWhatsAppBot(emitToPanel) {
  emitter = emitToPanel;
  setBotState('Iniciando', '🔄 Iniciando bot de WhatsApp...');

  const sessionPath = path.join(app.getPath('userData'), '.wwebjs_auth');
  waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionPath }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    },
    puppeteer: {
      headless: true,
      executablePath: getBrowserExecutablePath() || undefined,
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

  console.log('[BOT] Ejecutando waClient.initialize()...');
  waClient.initialize().catch(error => {
    console.error('[BOT] CRÍTICO: Fallo asíncrono al inicializar WhatsApp Client:', error);
    setBotState('Error', '❌ Falló al arrancar el motor de Chrome. Revisa el archivo debug.log.');
  });
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

async function logoutWhatsApp() {
  if (waClient) {
    console.log('[BOT] Cerrando sesión de WhatsApp...');
    try {
      await waClient.logout();
    } catch (e) {
      console.error('[BOT] Error al cerrar sesión:', e);
    }
  }
}

module.exports = {
  startWhatsAppBot,
  getWaClient,
  pauseSender,
  resumeSender,
  setGlobalPause,
  logoutWhatsApp
};
