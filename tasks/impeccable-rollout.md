# Mejora de interfaz por etapas

Solicitud: ejecutar las ocho etapas en orden. Base: crítica 2026-11-14, 21/40 provisional.

## Contrato de alcance

Preservar identidad PRODUCT.md / DESIGN.md, datos reales, permisos y trabajo previo del repositorio. No desplegar, migrar ni enviar comunicaciones reales para verificar. Revisar cada cambio con pruebas apropiadas. No presentar una mejora transversal como validación exhaustiva de las 176 páginas. Registrar limitaciones de navegador/autenticación.

## Secuencia

1. Implementada — Confianza y acceso: indicadores sin muestra, READONLY, operaciones, formularios y recuperación.
2. Implementada — Base compartida: tipografía, tokens, estados, shell y controles.
3. Implementada — Operación diaria: workflows, ejecutar, tareas, programaciones, operaciones, excepciones, incidentes, evidencias e IA.
4. Implementada — Inventario y abastecimiento: navegación, compras, recepción, proveedores y submódulos.
5. Implementada — Personas: Personal, empleados, equipo, desempeño y perfil.
6. Implementada — Finanzas y dirección: finanzas, ventas, presupuestos, ejecutivo, analítica, sucursales y reportes.
7. Implementada — Cumplimiento y administración: cumplimiento, protección civil, equipos, empresa, builder y notificaciones.
8. Implementada y verificada con los límites siguientes — Públicas y cierre: homepage, onboarding y enlaces públicos; comprobación transversal.

## Evidencia

Se añadirá por etapa: cambios concretos, comandos de verificación, resultados y límites. Los cambios previos de inventario/contabilidad no pertenecen a esta ejecución.

### Etapa 1

- Indicadores sin muestra usan null/Sin registros; GPS ofrece consultar configuración, sin afirmar activación no comprobada.
- Visibilidad de sidebar usa rutas estables; READONLY conserva Comando.
- Login/registro usan form, validación nativa, autocomplete y feedback persistente en español. Recuperación/reset mediante Better Auth; correo programado tras respuesta con Next after, sin enviar mensajes durante comprobación. Sesiones se revocan al cambiar contraseña. Configuración Resend ausente se explica sin prometer envío.
- Operaciones distingue error/carga/vacío, permite reintentar, cancela solicitudes obsoletas y adapta title/createdAt al contrato de la tabla.
- Pruebas: pnpm exec vitest run --configLoader bundle tests/unit/ui: 10/10. ESLint focal: sin errores (advertencias heredadas de tipos/imports). Navegador Chrome real: acceso semántico, tablet744px sin overflow, inputs16px; enlace reset sin token ofrece solicitar otro.
- TSC global agotó heap predeterminado (~2GB); reintento con4GB en curso. Validación de correos reales y módulos privados pendiente de entorno autenticado; no se enviaron correos.
- Referencia API contrastada con versión instalada y https://better-auth.com/docs/authentication/email-password.

### Etapa 2

-54 usos de text-[10px]/text-[11px] normalizados a text-xs en19 archivos; manifiesto en .tmp/impeccable-full-critique/type-changes.json.
- Cabeceras compartidas permiten envolver títulos/acciones, contenedores min-w-0 y controles sin sombras de reposo. Acceso conserva título semántico y jerarquía explícita.
- Cuatro franjas laterales se sustituyeron por borde completo/tinte, manteniendo prioridad textual. Calendario, gráficas de incidentes y matriz de menú usan tokens semánticos y fondos color-mix.
- Tooltips de horas extra ya consumen var(--token) directamente (OKLCH) y radio documentado. No se cambió paleta base ni DESIGN.md.
- ESLint focal:0 errores, advertencias previas en componentes heredados. diff --check sin errores.
- Se detuvo TSC4GB antes de terminar por presión de recursos durante edición; se verificará en cierre con salida a archivo. No se considera typecheck aprobado.

### Etapa 3

- Operaciones: pestañas en español y adaptables; placeholder de plantillas sustituido por enlace a Ejecución rápida; monitor de temperatura duplicado retirado.
- Programación y temperatura usan React Query ya instalado, con claves por usuario/sucursal/período, cancelación y error/reintento. Sin lecturas no muestra cumplimiento.
- Ejecución rápida utiliza sucursal del encabezado (se corrigió lectura de branchId en nivel erróneo de sesión), accesos en enlaces semánticos y cabecera adaptable. Mis tareas tiene filtros etiquetados y adaptables.
- Excepciones y verificaciones usan lenguaje directo/IA. Evidencias, incidentes, workflows y programaciones conservan funciones existentes; reciben mejoras compartidas de legibilidad/estados.
- ESLint focal sin errores; las advertencias previas se registran, sin suprimir reglas. Flujos operativos no ejecutados contra datos reales.

### Etapa 4

- Inventario conserva todos los destinos y usa grupos nativos details/summary para Operar, Comprar, Analizar y Configurar. Grupo de destino activo abierto; menús sin agrupación conservan comportamiento. Visibilidad/expansión ya no depende del título de sección.
- Acciones diarias permiten envolver cabecera y descripciones. Lectura en proveedores/recepción y matriz de menú ya normalizada en etapa2; no se altera cálculo ni persistencia de compras/stock.
- Prueba de agrupación escrita antes de implementación: fallo por módulo ausente confirmado; comprobación verde en suite UI de cierre.

### Etapa 5

- Personal mantiene operación diaria visible y revela control de horas/incidencias y análisis mediante details/summary. No se eliminaron acciones ni indicadores.
- Etiquetas Asistencia/Descansos/Horas extra/Retraso promedio y contexto de documentos requeridos sustituyen anglicismos; GPS no declara activación sin evidencia. Cabecera permite envolver acciones.
- Equipo traduce sucursal desconocida. Empleados, Desempeño y Perfil conservan sus flujos y reciben base tipográfica/controles compartida; no se modifican nómina, contratos ni reglas legales.

### Etapa 6

- Scorecard de sucursales usa lenguaje de índice/posición, mantiene Prime Cost con explicación, elimina franja decorativa y sombra, y utiliza semántico de éxito para legibilidad.
- Presupuestos: región de tabla desplazable por teclado y nombrada. Reportes: fechas personalizadas permiten envolver el control en tablet/móvil.
- Analítica y estados contables/flujo ya reciben normalización tipográfica. Se preservan períodos, fallos parciales de Hoy, vacíos y validaciones monetarias existentes en Finanzas/Ventas/Ejecutivo. No se modifican cálculos, conciliaciones ni reglas contables.

### Etapa 7

- Equipos: consulta cancelable por usuario/sucursal/filtros, error persistente y reintento; vacío de filtro distinguido de ausencia de equipos. Tabs/filtros adaptables y nombrados.
- Notificaciones expone errores de actualización y conserva lista previa con aviso, sin confundir fallo inicial con bandeja al día.
- Cumplimiento usa español consistente; Protección Civil no asegura ausencia de vencidos si faltan KPIs. Empresa/comunicaciones y builder reciben mejoras de tipografía y patrones de base. Servicios normativos conserva ambos puntos de entrada, sin alterar sus permisos.

### Etapa 8

- Usuario autorizó sustituir afirmaciones comerciales sin fuente por ejemplos sin cifras. Homepage elimina #1,60%,100%,30%,<2s y configuración en5 minutos, y presenta un ejemplo explícito de atención de una desviación de temperatura. No se agregan cifras ni testimonios.
- CTA usa enlaces semánticos sin botones anidados, main único, tokens neutrales y rojo reservado para acciones. Navegador real escritorio1440/móvil390: sin overflow, sin errores de consola; sin afirmaciones retiradas ni a/button anidados.
- Onboarding: tokens, título h1, formulario con errores persistentes, trim de nombres y campos protegidos durante envío. Comunicación pública sin texto degradado; tokens y acciones de enlaces privados conservados. No se usaron tokens reales de invitación/informe/comunicación/workflow para comprobarlos.
- Escaneo final: dashboard0, públicas0, componentes5. Los5 son los falsos positivos ya confirmados (4spinners y literal img en comentario);0 candidatos de diseño pendientes de las reglas escaneadas. No equivale a certificación visual o WCAG de todas las páginas.
- Suite UI unitaria: 14/14; navegador sintético: 5/5. Compilación y TypeScript completados; generación de 451/451 rutas/páginas.

## Revisión y verificación final

- Navegador sintético Playwright:5/5 casos aprobados. Se comprobó agrupación activa/teclado, reintento conservando sucursal, muestra vacía de temperatura, recuperación de notificaciones y ancho390px. Fixtures explícitas; sin acceso ni escritura a la DB operativa. Servidor efímero cerrado al finalizar.
- El harness necesitó corregir transformación de JSX virtual y agregar useSearchParams a su stub de Next; fallos de infraestructura de pruebas resueltos, no se ocultaron ni descartaron los casos.
- Suite global: 222 archivos aprobados y 1 fallido; 2,665 tests aprobados, 1 fallido, 1 omitido y 1 todo. Único fallo: tests/unit/seed-integration.test.ts excedió 120 s. Repetición aislada: 1/1 aprobado (111 s de ejecución del caso). Ningún seed de producción ejecutado. No se aumentaron timeouts ni se omitieron pruebas para pasar.
- Revisión de código encontró otro problema de confianza de Personal: documentos, descansos e incidentes ignoraban la sucursal seleccionada. Prueba SQL reprodujo la omisión; se aplicaron filtros de sucursal y documentos excluyen usuarios eliminados. Expediente sin empleados ya no aparece100%.
- Build de producción encontró bloqueo de conexión a Google Fonts (Geist/Geist Mono); reintento con red fuera del sandbox completó optimización, TypeScript, generación 451/451 y listado final de rutas. BUILD_ID: 2si6kCwK3oC0XJBAPFRxZ. Se conserva la familia, sin deshabilitar checks ni alterar configuración de compilación.
- ESLint de todos los archivos intervenidos y de los19 archivos de normalización: código de salida0, sin errores. diff --check aprobado. Revisión de código aplicada sobre corrección, claridad, permisos/alcance, cancelación y feedback.
- Reintento de build: compilación Turbopack aprobada (5.2 min), TypeScript completado, generación 451/451 y optimización final terminadas. El wrapper PowerShell reportó salida 1 al redirigir stderr (también en el test aislado aprobado); no se afirma un código nativo 0 no capturado. La evidencia del build es su salida completa, listado final y BUILD_ID actualizado. Log: .tmp/impeccable-full-critique/build-network-retry.log.
- Avisos del build: fetchConnectionCache deprecado y diagnóstico capturado de DYNAMIC_SERVER_USAGE para /dashboard/labor/documents al intentar prerenderizar headers; Next mantuvo la ruta dinámica y completó la generación. Ese archivo no se modificó.

## Límites de entrega

- La revisión fue transversal a las 29 familias funcionales, con cambios compartidos y específicos. No se reconstruyeron las 176 páginas ni se afirma validación visual exhaustiva de cada subruta.
- Se comprobaron superficies públicas en Chrome real y componentes privados con fixtures identificadas como sintéticas. La aceptación de flujos completos con sesión real, roles/datos de empresa y tokens públicos válidos sigue pendiente de un entorno autenticado.
- No se enviaron correos reales, se ejecutaron aprobaciones/pagos ni se modificó la base operativa para comprobar la interfaz. Recuperación requiere configuración válida de Resend; si falta, se comunica en la pantalla.
- Se conservaron cambios previos del worktree. No se mezclaron en commits o despliegues los trabajos de inventario/contabilidad ya en curso.
