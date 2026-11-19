# Selección explícita de conexión runtime para ventas

Base `bf010bb`, árbol limpio al comenzar. Nuevo hijo
`INV-01.b4.runtime.config`, I/M, V1/V2, depende de INV-01.a, b3 y b4b.
Scope de cuatro archivos de implementación/prueba: módulo
`lib/db/sales-runtime.ts`, servicio de ingestión, unitaria de selección y
suite de login independiente existente. El ajuste bulk/HTTP es un incremento
separado de tres archivos. Documentación y trazabilidad se guardan aparte.

Contrato y operación: [runbook](../../../../docs/sales-writer-runtime.md).
Sin variable conserva el camino anterior; configuración explícita inválida
nunca cambia al dueño. Guard de login independiente, atributos/membresías,
propiedad de tablas y RLS antes del callback. Pool por intento con cierre;
transacción SERIALIZABLE y reintentos existentes conservados. No se modifican
secreto de entorno, permisos persistentes, migraciones o autenticación.

RED inicial: módulo aún ausente, suite no pudo importar la frontera, exit 1.
GREEN inicial: **12/12, exit 0, 4.44 s**, selección y adaptador existente.
Se añade luego regresión del límite de tres reintentos y activación por el
servicio. Primer conjunto ampliado **59/59, exit 0, 14.81 s**.

V2 real: **11/11, exit 0, 171.97 s**, 161.32 s de casos. Incluye cuatro
casos del login independiente ahora atravesando `withSalesWriterTransaction`
y sus comprobaciones reales de rol/RLS. Se verifica dentro del callback
login y aislamiento serializable. Siete regresiones HTTP/sesión mantienen
su frontera rollback existente, sin activar la conexión nueva. Roles,
catálogos y hechos sintéticos terminan eliminados/revertidos y verificados.

Frontera bulk: nueva prueba reprodujo error runtime 503 → HTTP 500,
**6/7, exit 1, 2.73 s**. Se añade reconocimiento estructural `isApiError`
para conservar estado/mensaje de error controlado. Regresión ampliada con
trazabilidad: **71/71, exit 0, 12.86 s**. La API no presenta una importación
exitosa al fallar la activación.

Se añade HTTP manual/bulk que configura deliberadamente la URI dueña como
runtime: exige 503, error seguro, cero transacciones del writer y estado
idéntico. Resultado de esa corrida y build final pendientes al abrir esta
evidencia. Lint de los seis archivos iniciales pasó; lint del caso HTTP nuevo
en curso. Un build inicial se interrumpió deliberadamente antes de completar
al ampliar la corrección de la frontera bulk; no se cuenta como gate.

El arnés de login real no hace commits de hechos append-only; las escrituras
están en rollback sobre una conexión distinta de la dueña. No demuestra aún
guardado exitoso en Next ni despliegue con runtime. Dependencias y aceptación
integrada permanecen pendientes; no se acepta este hijo, padres o fila 11.11.

Gates finales del incremento: **8/8 HTTP, exit 0, 155.41 s** (141.43 s de
casos), incluidos manual y bulk que rechazan el runtime dueño con 503, sin
fallback, cambios de datos ni transacciones de writer. El resultado de once
integraciones anterior contiene siete de estas regresiones; no son diecinueve
casos distintos. El archivo HTTP nuevo también pasó ESLint, exit 0.

Build final **exit 0**, compilación 3.7 min, TypeScript global completo,
455/455 páginas (6.5 s) y optimización. Avisos previos de
`fetchConnectionCache` deprecado y documentos laborales dinámicos por
`headers` conservados. No se omiten gates. Trazabilidad tras abrir el hijo:
239 filas, 86 tareas base, 104 hijos, 24 aceptaciones y cero errores; once
unitarias documentales pasan por separado (solapadas con la regresión de 71).

Código runtime guardado en `68416d5`; frontera HTTP en `7ffbbce`.
El arnés de base desechable/Next se desarrolla en otro incremento; sus
resultados no se atribuyen a esta configuración hasta verificarlo.
