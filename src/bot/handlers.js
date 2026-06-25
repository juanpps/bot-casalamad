const { getSupabaseClient } = require('./supabase');
const { getConversationState, updateConversationState } = require('./conversation');
const { parseOrderMessage } = require('./parser');
const { crearPedidoConTracking } = require('./tracking');

async function handleMessage(sock, msg, emitToPanel) {
  const remoteJid = msg.key.remoteJid;
  const messageContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
  if (!messageContent) return;

  // Intentar parsear si es un mensaje estructurado del carrito
  const parsedOrder = parseOrderMessage(messageContent);
  
  if (parsedOrder) {
    parsedOrder.cliente_wa = remoteJid.split('@')[0];
    const { pedido, trackingUrl, error } = await crearPedidoConTracking(parsedOrder);
    
    if (error) {
      console.error(error);
      await sock.sendMessage(remoteJid, { text: '❌ Hubo un error al guardar tu pedido. Por favor, inténtalo de nuevo más tarde.' });
      return;
    }

    const confirmMsg = `✅ *¡Pedido recibido y confirmado!*\n\nHola ${pedido.cliente_nombre}, ya estamos revisando tu pedido.\n\nPuedes seguir el estado en tiempo real aquí:\n🔗 ${trackingUrl}\n\n¡Gracias por elegir Casa LAMAD! 🥢`;
    await sock.sendMessage(remoteJid, { text: confirmMsg });
    updateConversationState(remoteJid, { status: 'DONE' });
    
    if (emitToPanel) {
      emitToPanel('order:new', pedido);
    }
    return;
  }

  // Si no es un pedido estructurado, mostramos el menú de opciones básico
  const state = getConversationState(remoteJid);
  
  if (state.status === 'IDLE' || state.status === 'DONE') {
    const greeting = `¡Hola! 👋 Bienvenido a *Casa LAMAD — Arroz al Wok* 🥢\n\nSoy el asistente virtual del restaurante. Para ayudarte más rápido, selecciona una opción:\n\n1️⃣ *Hacer un pedido*\n2️⃣ *Ver el menú digital*\n3️⃣ *Hablar con un asesor*\n\nPor favor, responde con el número de la opción.`;
    await sock.sendMessage(remoteJid, { text: greeting });
    updateConversationState(remoteJid, { status: 'AWAITING_OPTION' });
    return;
  }
  
  if (state.status === 'AWAITING_OPTION') {
    const opt = messageContent.trim();
    if (opt === '1' || opt === '2') {
      const linkMsg = `Para hacer tu pedido, por favor entra a nuestro *menú digital*, agrega tus platos al carrito y envíanos el resumen de vuelta por aquí:\n\n🔗 https://casalamad.vercel.app/`;
      await sock.sendMessage(remoteJid, { text: linkMsg });
      updateConversationState(remoteJid, { status: 'IDLE' });
    } else if (opt === '3') {
      await sock.sendMessage(remoteJid, { text: `En un momento uno de nuestros asesores humanos te atenderá. 🧑‍🍳` });
      updateConversationState(remoteJid, { status: 'WAITING_HUMAN' });
    } else {
      await sock.sendMessage(remoteJid, { text: `⚠️ Por favor, responde con un número válido (1, 2 o 3).` });
    }
  }
}

module.exports = { handleMessage };
