const { getSupabaseClient } = require('./supabase');

function parseOrderMessage(text) {
  // Este parser asume el formato generado por el menú digital de Casa Lamad
  if (!text.includes('Pedido — Casa Lamad')) return null;

  try {
    const lines = text.split('\n');
    let nombre = 'Cliente';
    let telefono = '';
    let tipo_entrega = 'recogida';
    let direccion = '';
    let total = 0;
    const items = [];
    
    let inDetalle = false;

    for (let line of lines) {
      if (line.includes('*Nombre:*')) nombre = line.split('*Nombre:*')[1].trim();
      if (line.includes('*Teléfono:*')) telefono = line.split('*Teléfono:*')[1].trim();
      if (line.includes('*Modalidad:*')) {
        const mod = line.split('*Modalidad:*')[1].trim().toLowerCase();
        if (mod.includes('domicilio')) tipo_entrega = 'domicilio';
      }
      if (line.includes('*Dirección de entrega:*')) direccion = line.split('*Dirección de entrega:*')[1].trim();
      if (line.includes('*TOTAL:')) {
        const totalStr = line.split('*TOTAL:')[1].replace(/[^\d]/g, '');
        total = parseInt(totalStr, 10);
      }
      
      if (line.includes('*Detalle del pedido:*')) {
        inDetalle = true;
        continue;
      }
      
      if (inDetalle && line.includes('•')) {
        // Line format: "  • Arroz Wok Pollo (Personal) ×1  →  $22.000"
        const cantStr = line.match(/×(\d+)/);
        const cantidad = cantStr ? parseInt(cantStr[1], 10) : 1;
        const nombreItem = line.split('•')[1].split('×')[0].trim();
        const precioStr = line.split('→')[1]?.replace(/[^\d]/g, '');
        const subtotal = precioStr ? parseInt(precioStr, 10) : 0;
        
        items.push({
          nombre: nombreItem,
          cantidad,
          precio_unitario: subtotal / cantidad,
          subtotal
        });
      }
    }

    return {
      cliente_nombre: nombre,
      cliente_wa: '', // Lo rellenaremos fuera
      tipo_entrega,
      direccion,
      items,
      subtotal: total,
      total
    };
  } catch (error) {
    return null; // Falló el parseo
  }
}

module.exports = { parseOrderMessage };
