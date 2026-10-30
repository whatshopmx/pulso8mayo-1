# Tracker: vistas, datos y acciones por rol

Plan: [plan-vistas-roles-permisos.md](plan-vistas-roles-permisos.md).
Fuente: [auditoría por roles](evidencia/frontend-roles-2026-10-30/README.md).
Estado inicial 2026-10-30: solo planificación; **ninguna tarea de implementación está cerrada**.

## Contrato de ejecución

- Adoptar la política propuesta del plan al recibir la instrucción de implementarlo; registrar cambios explícitos de producto.
- Identidad desde sesión; empresa y objetivo autorizados; OWN no equivale a sucursal; ausencia de asignación falla cerrada.
- Misma política para páginas, APIs, acciones, queries, navegación y exports; no basta ocultar UI.
- Preservar cambios ajenos y seguridad fiscal/RLS; sin escrituras productivas de prueba, resiembra ni comunicaciones.
- Trabajar por sublotes de hasta cinco archivos de implementación. Separar fuente, local, preview y producción.

## Fase A — Contrato y contención

- [x] **RP-00** Inventario de páginas/fuentes/acciones, baseline, decisiones y cambios ajenos.
- [x] **RP-01** Política ejecutable de capacidades; OWNER incluido; clasificación y fiscal preservados (suites focales/completa, typecheck, lint focal y build aprobados).
- [ ] **RP-02** Scope OWN/BRANCH/COMPANY/NONE; cookies y queries sin ampliación de privilegios.
  - [x] **RP-02a** Resolver puro de alcance por actor/recurso y tests con dos empresas y compañeros (24 pruebas focales aprobadas; adopción pendiente b/c).
  - [ ] **RP-02b** Adaptadores legacy de sucursal, ABAC y visibilidad; pruebas de paridad y denegación.
    - [ ] **RP-02b1** Semántica compartida, helper de sucursal y ABAC (máximo cinco archivos).
      - [x] **RP-02b1a** Helper + resolver puro + guarda de ejecución y tests (cinco archivos). OWN preservado; 139 tests focales aprobados; commit 088b4c0.
      - [x] **RP-02b1b** ABAC + tests: empresa obligatoria, asignación y ownership después de masking (dos archivos); commit ae5ddc4.
    - [ ] **RP-02b2** Visibilidad de sucursales y clasificación; pruebas focales.
  - [ ] **RP-02c** Contexto visual/servidor, preferencias e identidad; preservar useMemo previo y probar.
    - [ ] **RP-02c1** Preferencia pura, Provider/layout/NavCompany y pruebas (máximo cinco archivos; se preserva el useMemo ajeno).
    - [ ] **RP-02c2** Resolver server + helper legacy: validar catálogo/empresa, distinguir query explícita de cookie obsoleta y cerrar null ambiguo sin asignación; tests y fixture READONLY de inventario (cinco archivos).
- [ ] **RP-03** Rutas explícitas y adaptadores server; sin fallback amplio de `/dashboard`.
- [ ] **RP-04** Ejecutivo: página/vistas cerradas antes de cargar modelos para roles no autorizados.
- [ ] **RP-05a** Ejecutivo: fuentes de lectura protegidas.
- [ ] **RP-05b** Ejecutivo: decisiones/reason/refresh y efectos protegidos.
- [ ] **RP-05c** Ejecutivo: exports/fuentes auxiliares del inventario protegidos; justificar si no existen.
- [ ] **RP-06** Render estable de roles de sucursal; validar candidato previo sin sobrescribirlo.
- [ ] **Checkpoint A** Accesos y render correctos; suites de autorización/fiscal y build del incremento.

## Fase B — Datos y acciones

- [ ] **RP-07** Dashboard de EMPLEADO solo carga datos propios autorizados, incluido HTML/RSC.
- [ ] **RP-08a** Agenda/historial/catálogo con elegibilidad y scope OWN reales.
- [ ] **RP-08b** Inicio/reasignación/pasos de ejecución autorizados en servidor.
- [ ] **RP-09a** Incidentes/excepciones: listas, agregados y detalle con el mismo alcance.
- [ ] **RP-09b** Resoluciones/recordatorios/acciones con permiso específico y efectos denegados en tests.
- [ ] **RP-10** Equipo: lectura/DTO/opciones/counts sin exposición fuera de alcance.
- [ ] **RP-11a** Perfil/rol/sucursal: validar actor, objetivo, rol nuevo y campos.
- [ ] **RP-11b** Altas/invitaciones/activaciones: jerarquía, revocación y cuenta administrativa necesaria.
- [ ] **RP-12** Editor y matriz muestran roles reales, opciones asignables y textos en español.
- [ ] **Checkpoint B** Pruebas negativas entre usuarios/sucursales/empresas y jerarquía sin efectos externos.

## Fase C — Experiencias

- [ ] **RP-13** Destino y composición inicial por permisos, sin loops ni redirects abiertos.
- [ ] **RP-14** Vista de sucursal/turno útil para GERENTE/SUPERVISOR sin modelos prohibidos.
- [ ] **RP-15** Consulta READONLY y exports autorizados, sin programación ni escrituras de negocio.
- [ ] **RP-16** Cumplimiento: scope consistente y denominadores honestos; acciones autorizadas.
- [ ] **RP-17** Ejecutivo: alcance anunciado = alcance consultado; distinguir proyecciones/global.
- [ ] **Checkpoint C** Ocho entradas útiles, scope correcto y ausencia de datos prohibidos en payloads.

## Fase D — Navegación y presentación

- [ ] **RP-18a** Sidebar y submenús derivados de política; sin enlaces denegados ni grupos vacíos.
- [ ] **RP-18b** Actividad/notificaciones/tarjetas/filas con destinos y acciones autorizados.
- [ ] **RP-19** 401/403/404/vacío/red en español; denegación sin reintento engañoso.
- [ ] **RP-20** Conteo de empleados con población explícita y query correcta por sucursal.
- [ ] **RP-21** Metadatos de plantillas completos o ausentes honestamente; elegibilidad coherente.

## Fase E — Verificación y publicación

- [ ] **RP-22** Matriz automatizada de siete roles de dominio y ocho cuentas; contextos independientes.
- [ ] **RP-23** Preview: Chrome DevTools, ocho cuentas, rutas directas y cierre documentado de ROLE-01–10.
- [ ] **RP-24a** Preparar revisión/lote exacto, diff, preview y estrategia de reversión.
- [ ] **RP-24b** Autorización explícita de producción recibida para ese lote.
- [ ] **RP-24c** Publicación y verificación read-only posterior con versión confirmada.

## Cobertura de hallazgos

| Hallazgo | Tareas principales |
|---|---|
| ROLE-01 empleado/global | RP-02, 07, 08, 09, 13, 18 |
| ROLE-02 ejecutivo abierto | RP-01, 03, 04, 05 |
| ROLE-03 React #185 | RP-06, 14, 22, 23 |
| ROLE-04 gestión de superiores/otras sucursales | RP-10, 11, 12 |
| ROLE-05 cumplimiento global/0 % | RP-16 |
| ROLE-06 enlaces/acciones contradictorios | RP-08, 09, 15, 18, 19 |
| ROLE-07 editor incompleto de roles | RP-01, 12 |
| ROLE-08 alcance ejecutivo contradictorio | RP-02, 17 |
| ROLE-09 ceros en empleados | RP-20 |
| ROLE-10 metadatos de plantillas | RP-08, 21 |

## Registro de continuidad

Actualizar esta sección al cerrar cada sesión. No atribuir al trabajo propio el `useMemo` de `components/nav-company.tsx` que ya estaba sin commit al crear el plan.

- **Última tarea completada:** RP-01 y RP-02a/b1a/b1b; RP-02b2/c implementados con tests focales verdes, cierre global/runtime pendiente.
- **Próxima tarea:** cerrar verificación RP-02; después RP-03 y contención ejecutiva.
- **Cambios de producto respecto al plan:** ninguno registrado.
- **Checks de implementación:** RP-01 suite completa: 185 archivos, 2310 passed/1 skipped/1 todo; typecheck, lint global y build exit 0. RP-02: 139 pruebas focales; otras suites de visibilidad/preferencias/petición/inventario aprobadas (detalle en evidencia). Global RP-02: un contrato READONLY antiguo corregido y timeout de seed aislado; repetición con menos workers pendiente. TypeScript RP-02 en curso; lint global interrumpido, no aprobado. Sin cambios en límites/timeouts/exclusiones de tests.
- **Evidencia de implementación:** [RP-00/RP-01](evidencia/vistas-roles-2026-10-30/README.md), snapshot reproducible de fuentes previo a cambios.
- **Trabajo parcial / bloqueos:** Otra sesión activa trabaja IMSS (confirmado por usuario), preservar sus archivos y staged. RP-02b2/c propios aún sin commit, salvo b1a/b1b. UseMemo ajeno de NavCompany intacto y pendiente de incluir solo los hunks propios en el lote. Smoke RP-00 completado con Playwright aislado; nuevo script RP-02 preparado. Checks globales lentos por contención de recursos: ejecutarlos secuencialmente; no detener procesos ajenos. Servidor propio detenido.
- **Preview:** pendiente.
- **Producción:** sin autorización/publicación de este lote.

### Plantilla para registrar un incremento

```text
Fecha / revisión:
ID y sublote:
Comportamiento entregado:
Archivos propios / cambios previos preservados:
Comandos y resultados:
Evidencia local / preview / producción:
Decisiones o limitaciones:
Siguiente ID y trabajo parcial:
```
