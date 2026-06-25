# Plan de Acción: Estabilización y Mejoras del Bot Casa LAMAD

Este documento detalla las fases y tareas pendientes para llevar el bot de WhatsApp a un estado de producción óptimo, basándonos en el rediseño de UI ya completado en la **Fase 1**. Todo el trabajo actual se realiza sobre la rama `feature/estabilidad-ui`.

---

## 1. Fase 2: Lógica del Bot, Validaciones y Flujo (En proceso)

Esta fase se enfoca en la inteligencia del bot, seguridad en los pedidos y experiencia del usuario en WhatsApp.

*   [ ] **Validación Anti-Fraude (Precios):**
    *   **Problema actual:** El bot confía en el total calculado por el mensaje prellenado enviado desde el carrito.
    *   **Solución:** Modificar `whatsapp.service.js`. Cuando el bot reciba un pedido, extraerá el ID/nombre de los productos y validará sus precios directamente consultando la base de datos de Supabase. Si el total del cliente no coincide con la base de datos, el pedido será marcado como `fraude_potencial` y requerirá revisión manual.
*   [ ] **Rediseño del Mensaje de Bienvenida:**
    *   **Problema actual:** El mensaje inicial es genérico.
    *   **Solución:** Crear un saludo amigable y enfocado a la conversión. El flujo principal será incitar a **Ver Menú y Pedir**.
*   [ ] **Manejo de Asesor / Preguntas Frecuentes:**
    *   **Solución:** Incluir opciones simples (FAQ) como horarios o ubicación.
    *   Si el cliente solicita "asesor", el bot se **pausará automáticamente para ese número**.
    *   El bot emitirá un evento IPC `advisor-alert` al panel (activando la modal roja y el sonido de triple timbre que ya diseñamos).
*   [ ] **Persistencia y Estado de Sesión en UI:**
    *   **Problema actual:** Aunque Puppeteer guarda sesión, la UI no permite gestionar las conversaciones activas.
    *   **Solución:** Mostrar en la barra superior del panel administrativo las **Conversaciones Activas**. Añadir la capacidad de Pausar/Despausar el bot **manualmente** para un cliente específico directamente desde el panel.

---

## 2. Fase 3: Sistema de Tracking Integrado al Menú Digital

El seguimiento del pedido se integrará en el frontend React existente (`menu-casalmad`) en lugar de crear un proyecto web nuevo.

*   [ ] **Generación de URL de Seguimiento Correcta:**
    *   **Solución:** En el backend del bot, en lugar de generar un enlace dummy o 404, el bot construirá la URL apuntando al menú digital: `https://[URL-MENU-DIGITAL]/tracking?id=[ID_PEDIDO]`.
*   [ ] **Estados de Tracking Diferenciados:**
    *   **Solución:** Asegurar que los botones del panel envíen estados distintos según el tipo de pedido:
        *   **Domicilio:** `confirmado` ➔ `en_preparacion` ➔ `en_camino` ➔ `entregado`.
        *   **Recoger:** `confirmado` ➔ `en_preparacion` ➔ `listo_recoger` ➔ `entregado`.
*   [ ] **Desarrollo Frontend Tracking (En Proyecto React):**
    *   Crear la ruta `/tracking` en el repositorio del menú digital.
    *   Esta página leerá el ID de la URL, consultará Supabase en tiempo real (`subscribe()`) y dibujará una línea de tiempo visual con los estados descritos anteriormente.

---

## 3. Fase 4: Resiliencia, Seguridad y Control (Graceful Shutdown)

Asegurar que el bot no se quede "colgado" como procesos zombie (lo que causaba errores de Puppeteer) y sea a prueba de fallos de energía/cierres abruptos.

*   [ ] **Apagado Seguro (Graceful Shutdown):**
    *   Conectar el botón "Apagar Bot" del panel con `main.js`.
    *   Al presionarlo, Electron ordenará a `whatsapp-web.js` destruir el cliente `client.destroy()`, cerrar el navegador de Puppeteer limpiamente, y luego cerrará la app de Electron.
*   [ ] **Control de Procesos (Prevención de bloqueos):**
    *   Implementar código en `main.js` para capturar eventos de cierre de ventana (`window-all-closed`) e interrupciones del sistema operativo (`SIGINT`, `SIGTERM`) forzando la liberación del candado (lock) del perfil de Chrome antes de salir.
*   [ ] **Pausa Global:**
    *   Dar vida al botón "Pausar Bot" general del panel.
    *   Si se activa, el bot responderá a todos los mensajes nuevos con: "En este momento no estamos tomando pedidos automáticos, un asesor te atenderá en breve".

---

## Resumen del Progreso

✅ **Fase 1 (UI/UX del Panel):** COMPLETADA.
🔄 **Fase 2 (Lógica y Seguridad):** SIGUIENTE PASO.
⏳ **Fase 3 (Tracking en Menú):** PENDIENTE.
⏳ **Fase 4 (Resiliencia):** PENDIENTE.
