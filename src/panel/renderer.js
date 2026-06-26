// renderer.js — Panel Admin de Casa LAMAD
// Conectado con el bot via Electron IPC

let ordersData = [];

// ── Elementos del DOM ─────────────────────────────────────────────────────────
const statusBadge = document.getElementById('botStatusText');
const qrContainer = document.getElementById('qrContainer');

const deliveryList = document.getElementById('deliveryList');
const pickupList = document.getElementById('pickupList');
const countDelivery = document.getElementById('countDelivery');
const countPickup = document.getElementById('countPickup');

const configModal = document.getElementById('settingsModal');
const configBtn = document.getElementById('settingsBtn');
const closeModalBtn = document.querySelector('.close');
const configForm = document.getElementById('settingsForm');

const pauseBotBtn = document.getElementById('pauseBotBtn');
const resumeBotBtn = document.getElementById('resumeBotBtn');
const shutdownBtn = document.getElementById('shutdownBtn');

const currentDateBadge = document.getElementById('currentDateBadge');

// ── Inicialización de Fecha ──────────────────────────────────────────────────
currentDateBadge.textContent = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

// ── Estado del bot ─────────────────────────────────────────────────────────────
window.electronAPI.onBotState((state) => {
  if (!statusBadge) return;
  statusBadge.textContent = state.message || state.status;
  statusBadge.className = 'status-badge';

  if (state.status === 'Conectado') {
    statusBadge.classList.add('online');
    pauseBotBtn.style.display = 'block';
    resumeBotBtn.style.display = 'none';
  } else if (state.status.includes('Pausado')) {
    statusBadge.classList.add('paused');
    pauseBotBtn.style.display = 'none';
    resumeBotBtn.style.display = 'block';
  } else if (state.status.includes('QR')) {
    statusBadge.classList.add('connecting');
  } else if (state.status.includes('Error') || state.status.includes('fatal')) {
    statusBadge.classList.add('error');
  } else {
    statusBadge.classList.add('connecting');
  }

  if (state.qr) {
    qrContainer.innerHTML = `<img src="${state.qr}" alt="QR WhatsApp" style="display:block; max-width:100%; border-radius: 8px;" />`;
  } else if (state.status === 'Conectado' || state.status.includes('Pausado')) {
    qrContainer.innerHTML = `<div style="text-align:center;padding:20px;color:var(--jade-light);font-size:48px;">✅</div>`;
  } else {
    qrContainer.innerHTML = `<p style="color:#888;font-size:13px;text-align:center;padding:20px;">Esperando conexión...</p>`;
  }
});

// ── Controles del Bot ───────────────────────────────────────────────────────
pauseBotBtn.addEventListener('click', () => {
  window.electronAPI.pauseBot();
});

resumeBotBtn.addEventListener('click', () => {
  window.electronAPI.resumeBot();
});

shutdownBtn.addEventListener('click', () => {
  if(confirm('¿Estás seguro que deseas apagar el bot? El navegador se cerrará de forma segura.')){
    window.electronAPI.shutdownBot();
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
  if (!deliveryList || !pickupList) return;

  const deliveries = ordersData.filter(o => o.tipo_entrega === 'domicilio');
  const pickups = ordersData.filter(o => o.tipo_entrega !== 'domicilio');

  countDelivery.textContent = deliveries.length;
  countPickup.textContent = pickups.length;

  const renderColumn = (items, container, emptyMsg) => {
    if (items.length === 0) {
      container.innerHTML = `<p class="empty-state">${emptyMsg}</p>`;
      return;
    }

    container.innerHTML = items.map(order => {
      const estadoLabel = {
        confirmado: '⏳ Confirmado',
        en_preparacion: '🍳 Preparando',
        en_camino: '🛵 En camino',
        listo_recoger: '✅ Listo (Recoger)',
        entregado: '🎉 Entregado',
        cancelado: '❌ Cancelado'
      }[order.estado] || order.estado;
      
      const estadoClase = `status-${(order.estado || '').replace('en_', '').replace('_recoger', '')}`;
      const isAttention = order.estado === 'confirmado'; // Necesita atención si acaba de llegar

      const itemsHtml = Array.isArray(order.items)
        ? order.items.map(i => `<p><b>${i.cantidad}x</b> ${i.nombre}</p>`).join('')
        : '<p>Sin detalle</p>';

      const btns = buildButtons(order);

      return `
        <div class="order-card ${isAttention ? 'needs-attention' : ''}" data-id="${order.id}">
          <div class="order-header">
            <div class="order-client">
              <strong>#${String(order.numero || '?').padStart(3, '0')} — ${order.cliente_nombre}</strong>
              <span>📱 ${(order.cliente_wa || '').replace(/@.*/, '')}</span>
            </div>
            <span class="order-status ${estadoClase}">${estadoLabel}</span>
          </div>
          <div class="order-details">
            ${order.direccion ? `<p>📍 <i>${order.direccion}</i></p>` : ''}
            ${order.notas ? `<p class="order-notes" style="color: #f1c40f; font-size: 11px; margin-top: 4px;">📝 <i>Nota: ${order.notas}</i></p>` : ''}
            <div style="margin-top: 10px;">${itemsHtml}</div>
          </div>
          <div class="order-total">
            Total: $${Number(order.total).toLocaleString('es-CO')}
          </div>
          <div class="order-actions">${btns}</div>
        </div>
      `;
    }).join('');

    // Agregar eventos
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { action, id } = btn.dataset;
        const order = ordersData.find(o => o.id === id);
        if (order) updateStatus(order, action);
      });
    });
  };

  renderColumn(deliveries, deliveryList, 'No hay domicilios recientes.');
  renderColumn(pickups, pickupList, 'No hay pedidos para recoger.');
}

function buildButtons(order) {
  const { estado, id, tipo_entrega } = order;
  const btns = [];

  if (estado === 'confirmado') {
    btns.push(`<button class="action-btn primary" data-action="en_preparacion" data-id="${id}">🍳 Preparar</button>`);
    btns.push(`<button class="action-btn" data-action="cancelado" data-id="${id}">✕ Cancelar</button>`);
  }
  if (estado === 'en_preparacion') {
    if (tipo_entrega === 'domicilio') {
      btns.push(`<button class="action-btn primary" data-action="en_camino" data-id="${id}">🛵 Enviar</button>`);
    } else {
      btns.push(`<button class="action-btn primary" data-action="listo_recoger" data-id="${id}">✅ Listo</button>`);
    }
    btns.push(`<button class="action-btn" data-action="cancelado" data-id="${id}">✕ Cancelar</button>`);
  }
  if (estado === 'en_camino' || estado === 'listo_recoger') {
    btns.push(`<button class="action-btn primary" data-action="entregado" data-id="${id}">🎉 Entregado</button>`);
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
  document.title = `🔔 ¡Nuevo pedido! — Casa LAMAD`;
  setTimeout(() => { document.title = 'Casa LAMAD — Bot Panel'; }, 5000);
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

function playAlert() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const play = (freq, t, dur) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur);
    };
    play(440, ctx.currentTime, 0.3);
    play(440, ctx.currentTime + 0.4, 0.3);
    play(660, ctx.currentTime + 0.8, 0.5);
  } catch {}
}

// ── Alerta Asesor ─────────────────────────────────────────────────────────────
window.electronAPI.onAdvisorAlert((data) => {
  document.getElementById('advisorAlertText').innerHTML = `El cliente <b>${data.waNumber}</b> necesita ayuda.<br><i>"${data.msg}"</i>`;
  document.getElementById('advisorAlertModal').style.display = 'block';
  playAlert();
});

// ── Chats Activos (Pausados por Asesor) ───────────────────────────────────────
window.electronAPI.onActiveChats((chats) => {
  const container = document.getElementById('activeChatsList');
  if (!container) return;
  
  if (chats.length === 0) {
    container.innerHTML = '<span class="empty-chats">Ninguno</span>';
    return;
  }
  
  container.innerHTML = chats.map(phone => 
    `<div class="paused-chat-tag">
       ${phone}
       <button data-resume="${phone}" class="resume-chat-btn" title="Reanudar Bot">▶</button>
     </div>`
  ).join('');

  container.querySelectorAll('.resume-chat-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const wa = e.target.dataset.resume + '@c.us';
      window.electronAPI.resumeSender(wa);
    });
  });
});

document.querySelector('.close-alert')?.addEventListener('click', () => {
  document.getElementById('advisorAlertModal').style.display = 'none';
});

document.getElementById('ackAdvisorBtn')?.addEventListener('click', () => {
  document.getElementById('advisorAlertModal').style.display = 'none';
});

// ── Archivar Historial ────────────────────────────────────────────────────────
document.getElementById('archiveBtn')?.addEventListener('click', async () => {
  if (confirm('¿Estás seguro de que deseas archivar todos los pedidos anteriores a hoy?\nEsto los guardará localmente y los eliminará de la base de datos para ahorrar espacio.')) {
    const success = await window.electronAPI.archiveHistory();
    if (success) {
      alert('✅ Historial archivado correctamente.\nLos pedidos se guardaron en la carpeta del sistema y se limpiaron de la nube.');
      loadOrders();
    } else {
      alert('❌ Hubo un error al archivar el historial. Revisa los logs.');
    }
  }
});

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
  const toggle = document.getElementById('autoLaunchToggle');
  if (toggle) toggle.checked = !!settings.autoLaunch;
});

configForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const autoLaunch = document.getElementById('autoLaunchToggle')?.checked ?? false;
  window.electronAPI.saveSettings({
    supabaseUrl: document.getElementById('supUrl').value.trim(),
    supabaseKey: document.getElementById('supKey').value.trim(),
    autoLaunch,
  });
  configModal.style.display = 'none';
  const msg = autoLaunch 
    ? '✅ Configuración guardada.\n🚀 El bot se iniciará automáticamente con Windows.' 
    : '✅ Configuración guardada.\n⏹ Auto-inicio desactivado.';
  alert(msg);
});

// ── Iniciar ───────────────────────────────────────────────────────────────────
window.electronAPI.getBotState();
loadOrders();

// Recargar pedidos cada 60 segundos
setInterval(loadOrders, 60000);

// ── Auto-Updater ──────────────────────────────────────────────────────────────
window.electronAPI.onUpdateAvailable(({ version }) => {
  // Notificación opcional de que se está descargando
  console.log('Descargando actualización:', version);
});

window.electronAPI.onUpdateDownloaded(({ version }) => {
  const div = document.createElement('div');
  div.style.position = 'fixed';
  div.style.bottom = '20px';
  div.style.right = '20px';
  div.style.background = 'var(--gold)';
  div.style.color = '#000';
  div.style.padding = '15px 20px';
  div.style.borderRadius = '8px';
  div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
  div.style.zIndex = '9999';
  div.style.fontFamily = 'Barlow, sans-serif';
  div.style.fontWeight = '600';
  
  div.innerHTML = `
    <p style="margin-bottom: 10px;">¡Nueva versión ${version} instalada en segundo plano!</p>
    <button id="restartUpdateBtn" style="background: #000; color: #fff; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; width: 100%;">Reiniciar para aplicar</button>
  `;
  document.body.appendChild(div);

  document.getElementById('restartUpdateBtn').addEventListener('click', () => {
    window.electronAPI.installUpdate();
  });
});
