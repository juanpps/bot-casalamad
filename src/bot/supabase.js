const { createClient } = require('@supabase/supabase-js');
const Store = require('electron-store');
const store = new Store();

let supabase = null;

function getSupabaseClient() {
  if (supabase) return supabase;
  
  const settings = store.get('settings') || {};
  if (settings.supabaseUrl && settings.supabaseKey) {
    supabase = createClient(settings.supabaseUrl, settings.supabaseKey);
    return supabase;
  }
  
  // Mock client robusto que soporta encadenamiento de métodos para evitar caídas
  const chain = {};
  const dummyFunc = () => chain;
  chain.select = dummyFunc;
  chain.insert = dummyFunc;
  chain.update = dummyFunc;
  chain.eq = dummyFunc;
  chain.gte = dummyFunc;
  chain.order = dummyFunc;
  chain.single = async () => ({ data: null, error: 'Not configured' });
  chain.then = (resolve) => resolve({ data: [], error: 'Not configured' });

  return {
    from: () => chain
  };
}

// Reset client function when settings change
function resetSupabaseClient() {
  supabase = null;
}

module.exports = { getSupabaseClient, resetSupabaseClient };
