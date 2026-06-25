const { customAlphabet } = require('nanoid');
const { getSupabaseClient } = require('./supabase');

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

function generarTrackingToken() {
  return nanoid();
}

function generarTrackingUrl(token) {
  // Ajusta la URL si es necesario
  return `https://casalamad.vercel.app/tracking/${token}`;
}

async function crearPedidoConTracking(pedidoData) {
  const token = generarTrackingToken();
  const url = generarTrackingUrl(token);
  const supabase = getSupabaseClient();
  
  // Calcular numero secuencial basico
  const hoy = new Date().toISOString().split('T')[0];
  const { count } = await supabase
    .from('pedidos')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', hoy);
    
  const numeroPedido = (count || 0) + 1;

  const { data, error } = await supabase
    .from('pedidos')
    .insert({
      ...pedidoData,
      numero: numeroPedido,
      tracking_token: token,
      tracking_url: url,
      tracking_activo: true,
      wa_tracking_enviado: false,
      estado: 'confirmado'
    })
    .select()
    .single();
    
  return { pedido: data, trackingUrl: url, error };
}

module.exports = { crearPedidoConTracking };
