# Plan de Acción: Estabilización y Mejoras del Bot Casa LAMAD

Este documento detalla las fases y tareas pendientes para llevar el bot de WhatsApp a un estado de producción óptimo, basándonos en el rediseño de UI ya completado en la **Fase 1**. Todo el trabajo actual se realiza sobre la rama `feature/estabilidad-ui`.

---

## 1. Fase 2: Flujo Conversacional 100% WhatsApp (Nuevo Enfoque)

Esta fase reemplaza el uso del menú digital web. Toda la interacción, visualización del menú y toma de pedidos se hará directamente en el chat mediante texto y opciones numeradas (ya que no se usa la API oficial para botones).

*   [ ] **Sistema de Estado por Sesión (Carrito en Memoria):**
    *   **Solución:** Implementar un gestor de estados para cada número de teléfono. El bot debe recordar en qué paso está el cliente (viendo categorías, seleccionando cantidad, ingresando dirección, etc.) y guardar los items seleccionados temporalmente.
*   [ ] **Integración del Menú con Supabase:**
    *   **Solución:** El bot consultará directamente a Supabase para obtener las categorías, productos y precios activos. Formateará esta información en mensajes de texto legibles con opciones numeradas (Ej: `1. 🍔 Hamburguesas`).
*   [ ] **Flujo de Toma de Pedidos:**
    *   **Paso 1:** Saludo y categorías.
    *   **Paso 2:** Selección de productos y cantidades.
    *   **Paso 3:** Confirmación del carrito y solicitud de datos (Dirección y Método de pago).
    *   **Paso 4:** Registro del pedido final en Supabase y notificación al panel.
*   [ ] **Manejo de Asesor / Preguntas Frecuentes:**
    *   **Solución:** Incluir opciones simples (FAQ) como horarios o ubicación.
    *   Si el cliente solicita "asesor" (o elige la opción), el bot se **pausará automáticamente para ese número**.
    *   El bot emitirá un evento IPC `advisor-alert` al panel (activando la modal roja y el sonido de triple timbre).

---

## 2. Fase 3: Notificaciones de Tracking vía WhatsApp

Dado que descartamos la página web de seguimiento, el cliente será informado del estado de su pedido mediante mensajes automáticos de WhatsApp.

*   [ ] **Notificaciones de Estado:**
    *   **Solución:** Cuando el administrador cambie el estado del pedido en el panel (Confirmado ➔ En Preparación ➔ En Camino), el bot enviará automáticamente un mensaje al cliente informando la actualización.
    *   Ejemplo: *"¡Tu pedido ya está en camino! 🛵 El repartidor llegará pronto."*

---

## 3. Fase 4: Resiliencia, Seguridad y Control (Graceful Shutdown)

Asegurar que el bot no se quede "colgado" como procesos zombie (lo que causaba errores de Puppeteer) y sea a prueba de fallos de energía/cierres abruptos.

*   [x] **Apagado Seguro (Graceful Shutdown):**
    *   Conectar el botón "Apagar Bot" del panel con `main.js`.
    *   Al presionarlo, Electron ordenará a `whatsapp-web.js` destruir el cliente `client.destroy()`, cerrar el navegador de Puppeteer limpiamente, y luego cerrará la app de Electron.
*   [x] **Control de Procesos (Prevención de bloqueos):**
    *   Implementar código en `main.js` para capturar eventos de cierre de ventana (`window-all-closed`) e interrupciones del sistema operativo (`SIGINT`, `SIGTERM`) forzando la liberación del candado (lock) del perfil de Chrome antes de salir.
*   [x] **Pausa Global:**
    *   Dar vida al botón "Pausar Bot" general del panel.
    *   Si se activa, el bot responderá a todos los mensajes nuevos con: "En este momento no estamos tomando pedidos automáticos, un asesor te atenderá en breve".

---

## Resumen del Progreso

✅ **Fase 1 (UI/UX del Panel):** COMPLETADA.
🔄 **Fase 2 (Lógica y Seguridad):** SIGUIENTE PASO.
⏳ **Fase 3 (Tracking en Menú):** PENDIENTE.
⏳ **Fase 4 (Resiliencia):** PENDIENTE.
