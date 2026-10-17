# Tareas: cierre de cumplimiento de Pulso

Fecha: 17 de octubre de 2026. Plan: [plan.md](plan.md). Fuente: [reporte](../docs/reporte-cumplimiento-sistema-2026-10-17.md) y [matriz de 239 puntos](../docs/matriz-cumplimiento-sistema-2026-10-17.csv).

**Estado:** planificación preparada; 0/60 tareas de implementación verificadas por este trabajo. Ninguna casilla se hereda de planes anteriores. Este tracker sustituye la entrada general; el anterior queda en [respaldo](todo-archive-before-cumplimiento-2026-10-17.md).

- [ ] Revisión humana del plan antes de iniciar implementación.
- [ ] Confirmar decisiones pendientes que bloquean la primera tarea elegida.

Cada tarea tiene criterios, dependencias, archivos y verificación en plan.md. Marcarla solo con artefacto de prueba, versión/entorno y resultado. En checkpoints: pruebas focalizadas y, si hubo código, V-T/V-B/V-L secuenciales. V-U completo en gates mayores. Si una tarea requiere más de cinco archivos manuales, dividirla y actualizar este tracker antes de empezar.

## Preparación

- [ ] **T01: Fijar línea base y decisiones de ejecución.** Dependencias: ninguna. Alcance M. Evidencia: pendiente.

## Recepción

- [ ] **T02: Conservar valor al convertir unidades.** Dependencias: T01. Alcance M. Evidencia: pendiente.
- [ ] **T03: Exigir lectura de temperatura según política.** Dependencias: T01. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP01 (T01–T03):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T04: Recuperar recepción sin duplicar entradas.** Dependencias: T02, T03. Alcance M. Evidencia: pendiente.

- [ ] **G-R:** Recepción conserva valor, exige temperatura y recupera efectos.

## Control común

- [ ] **T05: Persistir EvidenceStore.** Dependencias: T01. Alcance M. Evidencia: pendiente.
- [ ] **T06: Autorizar consulta y revisión de evidencia.** Dependencias: T05. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP02 (T04–T06):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T07: Importar referencias históricas de evidencia.** Dependencias: T05, T06. Alcance M. Evidencia: pendiente.
- [ ] **T08: Unificar auditoría consultable.** Dependencias: T01. Alcance M. Evidencia: pendiente.
- [ ] **T09: Definir identidad y estados de excepción.** Dependencias: T01, T05. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP03 (T07–T09):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T10: Persistir acciones de excepción.** Dependencias: T08, T09. Alcance M. Evidencia: pendiente.
- [ ] **T11: Cerrar una factura discrepante de extremo a extremo.** Dependencias: T06, T10. Alcance M. Evidencia: pendiente.
- [ ] **T12: Proyectar temperatura, merma y equipo.** Dependencias: T10, T11. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP04 (T10–T12):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T13: Proyectar presupuesto, falta y pago sin conciliar.** Dependencias: T10, T11. Alcance M. Evidencia: pendiente.
- [ ] **T14: Ejecutar sincronización y escalamiento durables.** Dependencias: T12, T13. Alcance M. Evidencia: pendiente.
- [ ] **T15: Operar excepciones desde el feed.** Dependencias: T11, T14. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP05 (T13–T15):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T16: Vincular evidencia de documentos financieros.** Dependencias: T06, T08, T11. Alcance M. Evidencia: pendiente.

- [ ] **G-0:** Factura discrepante tiene owner/SLA, evidencia durable, verificación independiente y auditoría.

## Pagos

- [ ] **T17: Alinear políticas de aprobación.** Dependencias: T08, T10, T16. Alcance M. Evidencia: pendiente.
- [ ] **T18: Trazar solicitud pagable hasta su documento.** Dependencias: T17. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP06 (T16–T18):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T19: Evitar duplicados y cambios después de firma.** Dependencias: T17, T18. Alcance M. Evidencia: pendiente.
- [ ] **T20: Verificar liquidación documental existente.** Dependencias: T04, T18, T19. Alcance M. Evidencia: pendiente.

- [ ] **G-P:** Obligación autorizada llega a liquidación sin duplicados ni firmas inválidas.

## Nómina

- [ ] **T21: Consolidar incidencias laborales aprobadas.** Dependencias: T01, T08. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP07 (T19–T21):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T22: Calcular conceptos desde asistencia real.** Dependencias: T21. Alcance M. Evidencia: pendiente.
- [ ] **T23: Aprobar una pre-nómina congelada.** Dependencias: T17, T22. Alcance M. Evidencia: pendiente.
- [ ] **T24: Timbrar exactamente la versión aprobada.** Dependencias: T23. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP08 (T22–T24):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T25: Conciliar neto de nómina y costo laboral.** Dependencias: T20, T24. Alcance M. Evidencia: pendiente.

- [ ] **G-N:** Asistencia, snapshot aprobado, recibo, CFDI y neto a pagar coinciden.

## Producción y ventas

- [ ] **T26: Elegir modelo productivo canónico.** Dependencias: T01, T04. Alcance S. Evidencia: pendiente.
- [ ] **T27: Crear lote terminado de forma atómica.** Dependencias: T26. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP09 (T25–T27):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T28: Consultar genealogía del lote.** Dependencias: T27, T06. Alcance M. Evidencia: pendiente.
- [ ] **T29: Mapear producto de canal a receta vigente.** Dependencias: T26. Alcance M. Evidencia: pendiente.
- [ ] **T30: Recuperar consumo por ventas corregidas.** Dependencias: T27, T29. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP10 (T28–T30):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T31: Demostrar integridad de inventario.** Dependencias: T04, T28, T30. Alcance M. Evidencia: pendiente.

- [ ] **G-I:** Subreceta/lote/venta corregida y conteo conservan stock y costo.

## Banca

- [ ] **T32: Seleccionar cuenta bancaria propia verificada.** Dependencias: T17, T19. Alcance M. Evidencia: pendiente.
- [ ] **T33: Importar movimientos con identidad bancaria.** Dependencias: T32. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP11 (T31–T33):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T34: Conciliar salida bancaria con obligación.** Dependencias: T13, T20, T25, T33. Alcance M. Evidencia: pendiente.
- [ ] **T35: Resolver parciales, comisiones y reversos.** Dependencias: T34. Alcance M. Evidencia: pendiente.
- [ ] **T36: Validar layout del banco objetivo.** Dependencias: T19, T32. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP12 (T34–T36):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T37: Trazar ingresos de canal hasta depósito.** Dependencias: T29, T33, T35. Alcance M. Evidencia: pendiente.

- [ ] **G-B:** Cuenta propia, movimientos, pagos e ingresos concilian sin confundir confirmación manual.

## Operación

- [ ] **T38: Configurar recurrencia de mantenimiento.** Dependencias: T10. Alcance M. Evidencia: pendiente.
- [ ] **T39: Generar órdenes de mantenimiento durables.** Dependencias: T12, T14, T38. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP13 (T37–T39):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T40: Cerrar mantenimiento con historial medible.** Dependencias: T06, T15, T39. Alcance M. Evidencia: pendiente.
- [ ] **T41: Entregar turno con pendientes verificables.** Dependencias: T15, T31, T40. Alcance M. Evidencia: pendiente.
- [ ] **T42: Registrar disponibilidad y capacidad real de canales.** Dependencias: T01, T37, T41. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP14 (T40–T42):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T43: Verificar cadena de frío y aceite.** Dependencias: T03, T15, T28. Alcance M. Evidencia: pendiente.
- [ ] **T44: Demostrar certificaciones y expedientes laborales.** Dependencias: T15, T21. Alcance M. Evidencia: pendiente.

- [ ] **G-O:** Mantenimiento, entrega de turno, canales, inocuidad y RH tienen evidencia operativa.

## Finanzas

- [ ] **T45: Imputar egresos a centros de costo.** Dependencias: T20, T35. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP15 (T43–T45):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T46: Cerrar período con costos históricos explicables.** Dependencias: T25, T31, T37, T45. Alcance M. Evidencia: pendiente.

- [ ] **G-F:** P&L, costos, centros y caja tienen fuentes explicables y cierre histórico.

## Acceso y DB

- [ ] **T47: Definir capacidades de los ocho perfiles.** Dependencias: T01, T17. Alcance M. Evidencia: pendiente.
- [ ] **T48: Aplicar alcances operativos en UI y API.** Dependencias: T06, T15, T41, T47. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP16 (T46–T48):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T49: Separar capacidades financieras y RH.** Dependencias: T18, T24, T34, T47. Alcance M. Evidencia: pendiente.
- [ ] **T50: Preparar contexto transaccional para RLS.** Dependencias: T01, T47. Alcance M. Evidencia: pendiente.
- [ ] **T51: Aplicar RLS a CxP y tesorería en staging.** Dependencias: T20, T50. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP17 (T49–T51):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T52: Aplicar RLS a nómina y datos laborales en staging.** Dependencias: T25, T50. Alcance M. Evidencia: pendiente.
- [ ] **T53: Aplicar RLS al control común y banca en staging.** Dependencias: T07, T14, T35, T50. Alcance M. Evidencia: pendiente.

- [ ] **G-S:** Ocho perfiles y lotes RLS declarados funcionan con rol runtime y sin fuga de contexto.

## Validación integral

- [ ] **T54: Probar cobertura existente de los 17 módulos.** Dependencias: T31, T40, T42, T43, T44, T46, T48, T49. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP18 (T52–T54):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T55: Probar compra hasta conciliación bancaria.** Dependencias: T16, T20, T35, T36, T45, T51, T53. Alcance S. Evidencia: pendiente.
- [ ] **T56: Probar turno hasta pago neto.** Dependencias: T25, T35, T49, T52, T53. Alcance S. Evidencia: pendiente.
- [ ] **T57: Probar producción hasta variación de inventario.** Dependencias: T30, T31, T43, T46, T48. Alcance S. Evidencia: pendiente.

- [ ] **Checkpoint CP19 (T55–T57):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.

- [ ] **T58: Probar siete excepciones y ocho perfiles.** Dependencias: T15, T34, T40, T48, T49, T51, T52, T53, T54, T55, T56, T57. Alcance S. Evidencia: pendiente.

- [ ] **G-E:** Circuitos E2E y controles de fallo/aislamiento aprobados en staging.

- [ ] **T59: Validar piloto con responsables operativos.** Dependencias: T58. Alcance S. Evidencia: pendiente.
- [ ] **T60: Cerrar matriz con evidencia y pendientes explícitos.** Dependencias: T59. Alcance M. Evidencia: pendiente.

- [ ] **Checkpoint CP20 (T58–T60):** criterios, pruebas y revisión de integración aprobados; bloqueos registrados.


- [ ] **G-C:** Piloto aceptado y 239 requisitos trazados a evidencia o limitación explícita.

## Evidencia y cierre

- [ ] Trazabilidad 239/239: caso, resultado, tarea, entorno, versión y enlace al artefacto.
- [ ] Pruebas compra→banco, turno→neto, producción→variación, siete excepciones y ocho perfiles aprobadas.
- [ ] Tipos, build, lint y suite unitaria completa aprobados secuencialmente; E2E con DB y rol runtime reales.
- [ ] Configuración de ocho unidades y escenarios de tres a quince sucursales verificados.
- [ ] Piloto multisucursal validado por responsables; diferencias conciliadas.
- [ ] Alcance de conectores y RLS residual explícito; ningún requisito requerido pendiente se presenta como completo.
- [ ] Cierre humano registrado; despliegue diferenciado de implementación/prueba/piloto.

### Registro por tarea

Al completar una ficha, sustituir «Evidencia: pendiente» por enlace al artefacto o registrar aquí:

| Tarea | Versión / entorno | Comando o caso | Resultado / artefacto | Revisor / fecha |
|---|---|---|---|---|
| — | — | — | Pendiente | — |
