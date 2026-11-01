# Auditoría frontend por usuario y rol — producción

Fecha: 30 de octubre de 2026. Sitio: https://pulso-horeca.netlify.app.

## Resultado

La navegación lateral cambia por rol, pero los datos, las acciones y los accesos directos no siempre siguen esa misma política. Los ocho usuarios del seed iniciaron sesión correctamente. Se observaron exposiciones de información a empleados/READONLY y fallos de render específicos de GERENTE/SUPERVISOR. Los 403 de varias rutas sí funcionan; no basta con extender el cierre de la auditoría local anterior a todos los roles en producción.

Se registraron **82 estados de pantalla**: ocho entradas iniciales y 74 observaciones posteriores, sobre **25 URLs finales distintas** (incluye query strings y las páginas iniciales). Es una muestra por rol, no un recorrido exhaustivo de todas las rutas del producto.

## Método y evidencia

- Chrome DevTools MCP: navegación real, login mediante formulario, DOM/accesibilidad, consola, lista de peticiones y capturas visuales.
- Un contexto de navegador aislado por cuenta; no se reutilizaron sesiones entre usuarios.
- Lectura de la configuración local de rutas, el seed y algunos archivos concretos para contrastar intención y comportamiento. El SHA actualmente desplegado **no se verificó**; no se asume que sea el baseline del informe anterior.
- `status` en los JSON proviene de `PerformanceNavigationTiming.responseStatus` del documento final. Un 200 con error de render no se considera una pantalla funcional. Las peticiones de datos se comprobaron por separado cuando se indica.
- [recorrido.json](recorrido.json): 70 estados adicionales y evidencias auxiliares de consola/red/formularios. Cada observación lleva una clave como `juan-schedules` o `pedro-executive`.
- [recomprobacion.json](recomprobacion.json): cuatro recomprobaciones finales; reproduce los fallos y verifica dos vistas ejecutivas adicionales.
- `carlos-landing.json`, `maria-landing.json`, `juan-landing.json`, `ana-landing.json`, `pedro-landing.json`, `luisa-landing.json`, `roberto-landing.json`, `diana-landing.json`: DOM de la primera pantalla tras iniciar sesión.
- Las capturas visuales de Pedro en el dashboard y de Ana en el error de Inventario se inspeccionaron en la sesión; no se guardaron PNG en este directorio.

No se ejecutaron timbrados, dispersiones, resoluciones de incidentes, invitaciones, desactivaciones, cambios de perfil, simulaciones, mensajes WhatsApp ni programación de reportes. Los formularios de edición se abrieron y cerraron sin guardar. Se cambió únicamente el alcance de navegación de Carlos y Luisa para comprobar los filtros. No se copiaron cookies ni tokens a la evidencia.

## Qué ve cada usuario al entrar

Todos aterrizaron en `/dashboard`, incluidos los empleados y Diana.

| Usuario | Rol / sucursal del seed | Menú lateral inicial | Alcance y contenido observado |
|---|---|---|---|
| Carlos Méndez | SUPER_ADMIN · Condesa | Comando de Red, Flujos de Trabajo, Inventario, Equipos, Cumplimiento, Personal, Desempeño, Finanzas, Organización | Todas las sucursales; matriz de tres tiendas y actividad de los tres empleados. Puede seleccionar sucursal. |
| María García | ADMIN · Condesa | Mismas secciones principales que Carlos | Todas las sucursales; directorio completo de ocho usuarios y módulos administrativos. Billing directo devuelve 403. |
| Juan López | GERENTE · Condesa | Mismas secciones operativas, sin Organización | Encabezado fijado a Condesa; dashboard y agenda de Condesa. Algunas pantallas autorizadas fallan. Equipo directo muestra las ocho cuentas. |
| Ana Martínez | SUPERVISOR · Polanco | Mismas secciones principales que Juan | Encabezado fijado a Polanco; dashboard y agenda de Polanco. Constructor/Equipo denegados. Algunas pantallas autorizadas fallan. |
| Pedro Sánchez | EMPLEADO · Condesa | Solo Flujos de Trabajo | Encabezado «Todas»; dashboard de tres tiendas, actividad de compañeros y alerta de caja. Evidencias sí muestra sus registros. |
| Luisa Fernández | EMPLEADO · Polanco | Solo Flujos de Trabajo | La misma entrada global que Pedro. Evidencias muestra Polanco y sus registros. |
| Roberto Gutiérrez | EMPLEADO · Roma | Solo Flujos de Trabajo | La misma entrada global que Pedro. Evidencias muestra Roma y sus registros. |
| Diana Torres | READONLY · Condesa | Cumplimiento y Desempeño | Dashboard de tres tiendas; bitácora con «Solo lectura», sin «Iniciar». Cabina ejecutiva accesible por URL, pese a Finanzas/Nómina denegadas. |

## Matriz de accesos observados

**OK**: renderiza. **403**: rechazo explícito. **ERROR**: documento 200 pero pantalla «Algo salió mal». **—**: no probado para esa cuenta. Se agrupan los tres empleados solo donde se indica la cuenta concreta; un resultado no se extrapola a los otros dos.

| Vista | Carlos | María | Juan | Ana | Empleados | Diana |
|---|---|---|---|---|---|---|
| Dashboard inicial | OK · red | OK · red | OK · Condesa | OK · Polanco | OK · red, los tres | OK · red |
| Workflows | — | OK · red | OK · Condesa | OK · Polanco | OK · red, los tres | 403 |
| Ejecución rápida | — | — | — | — | Pedro: OK, catálogo con «Iniciar» | — |
| Constructor | — | — | OK | 403 | — | — |
| Schedules | OK · 19/19/0/0 en Condesa | OK · solicita sucursal | ERROR | ERROR | Pedro: 403 | — |
| Evidencias | — | — | — | — | OK, los tres; registros propios observados | 403 |
| Incidentes | — | — | — | — | Pedro: OK · tres sucursales y «Resolver» | — |
| Excepciones | — | — | — | — | Pedro: OK · tres sucursales | OK · tres sucursales |
| Cabina ejecutiva | OK · red | OK · red | — | OK · Polanco en ventas/costos | OK, los tres · ventas/costos de sucursal y caja global/preliminar | OK · red |
| Inventario | OK · Condesa | OK · red | — | ERROR | Luisa: 403 | — |
| Finanzas | OK · Condesa | — | — | OK · Polanco | Luisa: 403 | 403 |
| Nómina | OK | OK | ERROR | ERROR | Roberto: 403 | 403 |
| Directorio empleados | — | OK · ocho usuarios | ERROR | ERROR | Roberto: 403 | — |
| Equipo | — | OK · ocho usuarios | OK · ocho usuarios y edición de SUPER_ADMIN visible | 403 | Pedro: 403 | — |
| Cumplimiento | OK | OK | OK · resumen propio y comparativa global | OK · resumen propio y comparativa global | Pedro: 403 | OK |
| Analytics | — | — | — | — | — | Redirige a Liga de Sucursales y renderiza |
| Reportes | — | — | — | — | — | OK, incluye «Programar nuevo reporte» |
| Verificaciones AI | — | — | — | — | — | 403, aunque aparece en su menú |
| Organización / sucursales | OK | — | `/company`: 403 | — | — | — |

Las sondas directas `/dashboard/company` de Carlos/María y `/dashboard/billing` de Carlos devolvieron 404. No se comprobaron como destinos de enlaces visibles y **no se clasifican como enlaces rotos**: la pantalla real de sucursales `/dashboard/company/branches` sí devuelve 200.

## Hallazgos priorizados

### ROLE-01 · P1 · El empleado recibe información global en dashboard, agenda e incidentes

**Reproducido:** Pedro, Luisa y Roberto entran a `/dashboard` con «Sucursal: Todas», tres tiendas y actividad/calificaciones de otros usuarios. El dashboard muestra el faltante de caja de Condesa de **$250** y el cambio de turno con el motivo «Cita médica familiar». `/dashboard/workflows` muestra las tres sucursales y sus pendientes para los tres empleados. Pedro también ve los seis incidentes de tres sucursales y el centro de excepciones completo.

**Impacto:** el menú reducido sugiere un alcance operativo personal que el contenido no respeta. Se exponen datos de compañeros y de otras sucursales antes de llegar a las guardas de los detalles.

**Evidencia:** los tres `*-landing.json`; claves `pedro-workflows`, `luisa-workflows`, `roberto-workflows`, `pedro-incidents`, `pedro-exceptions`.

**Corrección:** definir el alcance de EMPLEADO por recurso y aplicarlo en servidor a los agregados, listas y páginas iniciales. Aterrizar en su trabajo autorizado y no ofrecer un selector global que prometa acceso a toda la cadena. Filtrar también motivos personales y alertas financieras según permiso.

### ROLE-02 · P1 · Empleados y READONLY acceden a la cabina ejecutiva

**Reproducido:** `/dashboard/executive` responde 200 para los tres empleados y Diana, sin enlace en sus menús. Pedro ve ventas de **$513.1K**, porcentaje de nómina y caja proyectada de **$648.0K**. Luisa ve **$531.4K** y Roberto **$503.7K**. Diana ve el consolidado de **$1.55M** y costos de red. La vista `?view=economics` de Pedro muestra nómina por **$12,314** y EBITDA por **$388,413**; `?view=liquidity` de Diana muestra el calendario financiero.

**Contraste:** Finanzas de Luisa/Diana y Nómina de Roberto/Diana sí devuelven 403. La cabina permite leer otra presentación de información financiera que esos cierres protegen.

**Fuente local compatible con lo observado:** falta una entrada específica para `/dashboard/executive` en `lib/rbac/permissions.ts`; la página valida sesión/empresa y calcula datos, sin una guarda explícita de acceso al módulo. No se afirma que el binario desplegado sea idéntico al workspace.

**Corrección:** acordar los roles de dirección autorizados y aplicar la misma política en ruta, servidor, fuentes de datos y UI. Probar que empleados y READONLY no reciban el contenido restringido en HTML/RSC.

### ROLE-03 · P1 · Vistas autorizadas fallan para GERENTE y SUPERVISOR

**Reproducido:** Schedules, Directorio y Nómina terminan en «Algo salió mal» para Juan y Ana. Inventario también falla para Ana. El documento responde 200; no es un rechazo RBAC ni una pantalla funcionando. Schedules de Juan e Inventario de Ana se volvieron a abrir y fallaron de nuevo.

**Consola:** error React **#185** y «Dashboard error». Carlos sí carga las 19 programaciones de Condesa con KPIs 19/19/0/0, y María sí carga el directorio; no se trata de falta general de datos del seed.

**Indicio local, pendiente de validar:** ya había un cambio ajeno sin commit en `components/nav-company.tsx` que estabiliza `displayBranches` con `React.useMemo`. Su comentario describe un ciclo render → efecto → estado en los roles fijados a sucursal. Es un candidato de corrección existente, no un arreglo realizado ni verificado durante esta auditoría.

**Corrección:** validar esa corrección en local/preview con Juan y Ana, incluyendo Schedules, Directorio, Nómina e Inventario; después comprobar el despliegue. No cerrar por un smoke HTTP 200.

### ROLE-04 · P1 · El gerente ve administración de cuentas fuera de su alcance y jerarquía

**Reproducido:** Juan, fijado a Condesa, abre `/dashboard/team` y ve las ocho cuentas, incluidas Polanco y Roma. El menú de Carlos SUPER_ADMIN ofrece «Editar Perfil y Permisos» y «Desactivar Usuario». Abrir edición muestra un formulario habilitado con «Save Changes».

**Límite esencial:** no se guardó ni desactivó nada. Está confirmada la exposición de datos y controles; **no está demostrada una escalada de privilegios ni que PATCH acepte esas acciones**.

**Evidencia:** `juan-team`, `juan-team-superadmin-menu`, `juan-team-edit-superadmin` en `recorrido.json`.

**Corrección:** definir alcance de gestión y jerarquía de roles; filtrar los usuarios y las acciones por actor/objetivo. Verificar las mutaciones mediante pruebas aisladas, sin editar cuentas de producción.

### ROLE-05 · P2 · Cumplimiento mezcla resumen de sucursal y comparativa global

**Reproducido:** Juan y Ana conservan su encabezado fijo y el resumen inicial cambia según sucursal, pero «Comparativa Inter-sucursales» y «Semáforo de Sucursales y Acciones» muestran Condesa, Polanco y Roma. Cada fila presenta 0 %, 0/0 y «Recordatorio WA», aunque el resumen tiene bitácoras completadas y cumplimiento cercano al 79 %.

**Evidencia:** `juan-compliance`, `ana-compliance`, `juan-compliance-snapshot`; red de Ana: trends consulta su `branchId`, corporate-status no lo incluye. No se enviaron recordatorios.

**Corrección:** decidir si la comparación entre sucursales está permitida para estos roles. Si lo está, identificarla como sección global y aplicar permisos a sus acciones; si no, filtrar en servidor. Mostrar ausencia de datos como tal y comprobar el contrato de las filas antes de presentar 0 %.

### ROLE-06 · P2 · Enlaces y acciones visibles no siguen la autorización efectiva

**Casos confirmados:**

- Ana ve «Constructor» dentro de Flujos de Trabajo, pero `/dashboard/builder` devuelve 403.
- Diana ve «Verificaciones AI» dentro de Cumplimiento, pero `/dashboard/ai-verifications` devuelve 403. El submenú también ofrece accesos de registros laborales que no corresponden al cierre de `/dashboard/labor`.
- El dashboard de Diana ofrece «Ir a Finanzas», «Ir a Personal» y «Ir a Operación», mientras sus rutas restringidas la rechazan.
- El dashboard de Pedro enlaza a detalles de Luisa. La página abre con 200, la petición `/api/workflows/executions/1cf33a8e-…` devuelve 403 y la UI muestra **«Failed to fetch workflow» + «Reintentar»**. Roberto encuentra el mismo estado al abrir el detalle de Pedro.
- Pedro ve «Resolver» en incidentes de otras sucursales; Diana ve «Programar nuevo reporte». Su aceptación por el servidor no se probó; quedan como controles que requieren contraste con el permiso de escritura.

**Corrección:** filtrar navegación, deep links y acciones con la misma política de servidor. Representar un 403 como falta de permiso, en español, sin sugerir que reintentar arreglará la autorización.

### ROLE-07 · P2 · El editor de equipo solo representa tres de los seis roles

**Reproducido:** al editar la cuenta SUPER_ADMIN desde Equipo, el selector de rol aparece sin valor visible y ofrece únicamente **Admin, Gerente, Empleado**. No representa SUPER_ADMIN, SUPERVISOR ni READONLY, aunque los tres existen en el seed y en el directorio. El formulario mantiene «Edit Profile», «Full Name», «Phone Number», «Assigned Branch», «Cancel» y «Save Changes» en inglés.

**Impacto:** el formulario no permite entender fielmente el estado actual; guardar campos no relacionados podría tener efectos inesperados si el contrato no preserva el rol. No se probó ese guardado.

**Corrección:** separar roles existentes de roles asignables por el actor, conservar el valor actual, restringir cambios por jerarquía y traducir el formulario. La matriz informativa también debe reflejar los seis roles reales.

### ROLE-08 · P2 · El alcance anunciado no coincide con la cabina ejecutiva

**Reproducido:** Carlos seleccionó Condesa en Schedules y cargó correctamente esa sucursal; después Ejecutivo conservó «Sucursal: Condesa» pero mostró el consolidado de **$1.55M**. Luisa seleccionó Condesa para comprobar evidencias y obtuvo cero registros; después Ejecutivo conservó Condesa en el header pero mostró **$531.4K**, el importe de Polanco. Pedro y Roberto muestran «Todas» con ventas de una sola sucursal. La leyenda de ventas dice «Corte consolidado todas las sucursales» incluso en esas sesiones.

**Corrección:** resolver y presentar un alcance efectivo por sección. Si la cabina es necesariamente global, indicarlo y no mantener un selector de sucursal que parezca aplicarle. Separar explícitamente valores globales, propios y proyecciones.

### ROLE-09 · P3 · Sucursales muestra cero empleados pese al seed asignado

**Reproducido:** Carlos ve «0 empleados» en Condesa, Polanco y Roma en Organización → Sucursales. El directorio de Equipo muestra Pedro, Luisa y Roberto asignados respectivamente a esas sucursales, además de los roles de gestión.

**Corrección:** revisar el origen/contrato del conteo y definir qué población cuenta. No sustituir un conteo ausente por cero.

### ROLE-10 · P3 · Ejecución rápida muestra unidades sin métricas

**Reproducido:** Pedro ve el catálogo de plantillas con «min», «pasos» y «ejecuciones» sin sus valores numéricos. También ve plantillas descritas para el gerente y el CTA «Iniciar». No se inició ninguna; la elegibilidad de esas ejecuciones queda pendiente de comprobar en pruebas aisladas.

**Corrección:** validar el mapeo de metadatos y ocultar métricas ausentes. Mostrar únicamente plantillas ejecutables por el actor, o explicar la condición que impide iniciarlas.

## Controles que sí funcionaron en la muestra

- Las ocho cuentas se autenticaron y conservaron identidad independiente.
- Juan/Ana no pueden cambiar la sucursal desde el selector global; dashboard y agenda muestran Condesa/Polanco respectivamente.
- Ana recibe 403 al abrir Equipo o Constructor; Juan recibe 403 en Organización.
- Empleados reciben 403 en las rutas probadas de Finanzas, Inventario, Nómina, Directorio, Equipo, Schedules y Cumplimiento (ver matriz para la cuenta exacta).
- Diana no tiene «Iniciar» ni enlace a detalles en la bitácora; Workflows, Evidencias, Finanzas, Nómina y Verificaciones AI la rechazan con 403.
- Evidencias iniciales: Pedro **973**, Luisa **303**, Roberto **24**; la página visible corresponde al empleado y a su sucursal. Luisa elige Condesa y obtiene **0**, sin ver las fotos de Pedro.
- El detalle de una ejecución ajena se rechaza en la API, aunque su resumen se haya filtrado antes en el dashboard.
- Carlos selecciona Condesa y Schedules lista **19** programaciones, KPIs **19/19/0/0**, sin el antiguo error permanente de filtros 400.
- El listado de empleados de María está en español. Los controles de timbrado se inspeccionaron sin ejecutar; esta auditoría no certifica el ciclo fiscal.

## Orden de continuación recomendado

- [ ] ROLE-02: cerrar acceso ejecutivo y fuentes financieras a los roles no autorizados.
- [ ] ROLE-01: delimitar datos/landing de EMPLEADO y sanear agregados globales.
- [ ] ROLE-03: validar el candidato local del ciclo de render y repetir vistas con Juan/Ana.
- [ ] ROLE-04: cerrar administración de usuarios por alcance y jerarquía, con pruebas de servidor aisladas.
- [ ] ROLE-05/08: unificar alcance de resúmenes, comparativas y cabina.
- [ ] ROLE-06/07: alinear menú/acciones/editor de roles y mensajes 403.
- [ ] ROLE-09/10: corregir conteos y metadatos de presentación.
- [ ] Repetir la matriz en preview y después del despliegue autorizado, incluyendo pruebas negativas de lectura y de escritura en entorno aislado.

## Límites

No se probaron escrituras de negocio ni endpoints mediante métodos mutantes; no se acredita que un botón visible permita completar la operación. No se auditó aislamiento entre empresas: las ocho cuentas pertenecen a la misma compañía demo. No se cubrieron todos los formularios, rutas secundarias, exportaciones, móviles ni accesibilidad WCAG completa. Las cifras cambian con el tiempo y el seed; sirven como evidencia del estado observado. Los accesos financieros y los errores de render descritos sí se observaron en producción con Chrome DevTools, no se dedujeron solo del código local.
