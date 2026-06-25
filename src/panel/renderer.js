// renderer.js — Panel Admin de Casa LAMAD
// Conectado con el bot via Electron IPC

let ordersData = [];

// ── Elementos del DOM ─────────────────────────────────────────────────────────
const statusBadge = document.getElementById('botStatusText');
const qrContainer = document.getElementById('qrContainer');
const ordersGrid = document.getElementById('ordersList');
const configModal = document.getElementById('settingsModal');
const configBtn = document.getElementById('settingsBtn');
const closeModalBtn = document.querySelector('.close');
const configForm = document.getElementById('settingsForm');

// ── Estado del bot ─────────────────────────────────────────────────────────────
window.electronAPI.onBotState((state) => {
  if (!statusBadge) return;
  statusBadge.textContent = state.message || state.status;
  statusBadge.className = 'status-badge';

  if (state.status === 'Conectado') statusBadge.classList.add('connected');
  else if (state.status.includes('QR')) statusBadge.classList.add('qr');
  else if (state.status.includes('Error') || state.status.includes('fatal')) statusBadge.classList.add('error');
  else statusBadge.classList.add('connecting');

  if (state.qr) {
    qrContainer.innerHTML = `<img src="${state.qr}" alt="QR WhatsApp" style="display:block;" />`;
  } else if (state.status === 'Conectado') {
    qrContainer.innerHTML = `<div style="text-align:center;padding:20px;color:#28a745;font-size:48px;">✅</div>`;
  } else {
    qrContainer.innerHTML = `<p style="color:#888;font-size:13px;text-align:center;padding:20px;">Esperando conexión...</p>`;
  }
});

// ── Cargar pedidos del día ─────────────────────────────────────────────────────
async function loadOrders() {
  try {
    const orders = await window.electronAPI.loadOrders();
    ordersData = orders || [];
    renderOrders();
  } catch (err) {
    console.error('Error cargando pedidos:', err);
  }
}

// ── Renderizar tarjetas de pedidos ────────────────────────────────────────────
function renderOrders() {
  if (!ordersGrid) return;

  if (ordersData.length === 0) {
    ordersGrid.innerHTML = `<p class="empty-state">No hay pedidos hoy. ¡El primer pedido aparecerá aquí en tiempo real! 🥢</p>`;
    return;
  }

  ordersGrid.innerHTML = ordersData.map(order => {
    const estadoLabel = {
      confirmado: '⏳ Confirmado',
      en_preparacion: '🍳 En preparación',
      en_camino: '🛵 En camino',
      listo_recoger: '✅ Listo para recoger',
      entregado: '🎉 Entregado',
      cancelado: '❌ Cancelado'
    }[order.estado] || order.estado;

    const itemsHtml = Array.isArray(order.items)
      ? order.items.map(i => `<li>${i.cantidad}x ${i.nombre} — $${Number(i.subtotal).toLocaleString('es-CO')}</li>`).join('')
      : '<li>Sin detalle</li>';

    const btns = buildButtons(order);

    return `
      <div class="order-card ${order.estado}" data-id="${order.id}">
        <div class="order-header">
          <span>#${String(order.numero || '?').padStart(3, '0')} — ${order.cliente_nombre}</span>
          <span class="estado-tag">${estadoLabel}</span>
        </div>
        <div class="order-body">
          <p>📱 ${order.cliente_wa} &nbsp;|&nbsp; 🏍 ${order.tipo_entrega === 'domicilio' ? 'Domicilio' : 'Recogida'}</p>
          ${order.direccion ? `<p>📍 ${order.direccion}</p>` : ''}
          <hr/>
          <ul>${itemsHtml}</ul>
          <hr/>
          <p><strong>Total: $${Number(order.total).toLocaleString('es-CO')}</strong></p>
        </div>
        <div class="order-footer">${btns}</div>
      </div>
    `;
  }).join('');

  // Agregar eventos a botones
  ordersGrid.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { action, id } = btn.dataset;
      const order = ordersData.find(o => o.id === id);
      if (order) updateStatus(order, action);
    });
  });
}

function buildButtons(order) {
  const { estado, id, tipo_entrega } = order;
  const btns = [];

  if (estado === 'confirmado') {
    btns.push(`<button class="btn-preparar" data-action="en_preparacion" data-id="${id}">🍳 Preparar</button>`);
    btns.push(`<button class="btn-cancel" data-action="cancelado" data-id="${id}">✕ Cancelar</button>`);
  }
  if (estado === 'en_preparacion') {
    if (tipo_entrega === 'domicilio') {
      btns.push(`<button class="btn-enviar" data-action="en_camino" data-id="${id}">🛵 Enviar</button>`);
    } else {
      btns.push(`<button class="btn-listo" data-action="listo_recoger" data-id="${id}">✅ Listo</button>`);
    }
    btns.push(`<button class="btn-cancel" data-action="cancelado" data-id="${id}">✕ Cancelar</button>`);
  }
  if (estado === 'en_camino' || estado === 'listo_recoger') {
    btns.push(`<button class="btn-entregado" data-action="entregado" data-id="${id}">🎉 Entregado</button>`);
  }
  return btns.join('');
}

async function updateStatus(order, newStatus) {
  try {
    const result = await window.electronAPI.updateOrderStatus({
      id: order.id,
      status: newStatus,
      waNumber: order.cliente_wa,
      trackingUrl: order.tracking_url
    });

    if (result.success) {
      // Actualizar localmente sin recargar
      const idx = ordersData.findIndex(o => o.id === order.id);
      if (idx !== -1) ordersData[idx].estado = newStatus;
      renderOrders();
      playChime();
    }
  } catch (err) {
    console.error('Error actualizando estado:', err);
    alert('Error al actualizar el estado del pedido.');
  }
}

// ── Nuevo pedido en tiempo real ───────────────────────────────────────────────
window.electronAPI.onOrderNew((newOrder) => {
  ordersData.unshift(newOrder);
  renderOrders();
  playChime();
  // Flash de notificación visual
  document.title = `🔔 ¡Nuevo pedido! — Casa LAMAD`;
  setTimeout(() => { document.title = 'Casa LAMAD — Panel Admin'; }, 5000);
});

// ── Sonido de notificación ────────────────────────────────────────────────────
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const play = (freq, t, dur) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur);
    };
    play(523.25, ctx.currentTime, 0.25);
    play(659.25, ctx.currentTime + 0.13, 0.4);
  } catch {}
}

// ── Configuración ─────────────────────────────────────────────────────────────
configBtn?.addEventListener('click', () => {
  window.electronAPI.getSettings();
  configModal.style.display = 'block';
});

closeModalBtn?.addEventListener('click', () => {
  configModal.style.display = 'none';
});

configModal?.addEventListener('click', (e) => {
  if (e.target === configModal) configModal.style.display = 'none';
});

window.electronAPI.onSettingsLoaded((settings) => {
  if (document.getElementById('supUrl')) {
    document.getElementById('supUrl').value = settings.supabaseUrl || '';
    document.getElementById('supKey').value = settings.supabaseKey || '';
  }
});

configForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  window.electronAPI.saveSettings({
    supabaseUrl: document.getElementById('supUrl').value.trim(),
    supabaseKey: document.getElementById('supKey').value.trim(),
  });
  configModal.style.display = 'none';
  alert('✅ Configuración guardada. Reinicia el bot para aplicar los cambios.');
});

// ── Iniciar ───────────────────────────────────────────────────────────────────
window.electronAPI.getBotState();
loadOrders();

// Recargar pedidos cada 60 segundos
setInterval(loadOrders, 60000);
