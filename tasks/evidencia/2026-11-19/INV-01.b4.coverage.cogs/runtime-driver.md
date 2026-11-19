# Driver Neon: contexto transaccional entre bundles Next

Bloqueo descubierto al verificar `INV-01.b4.manual.ui`, sobre base
`07055084df845584047e449f24d4bb68b42dd086` más diff local identificado.
Se corrige como incremento separado de cobertura COGS; no acepta el ticket.
Scope final del arreglo: `next.config.ts` y esta evidencia. El arnés Next
extendido se guarda con el incremento manual; la instrumentación temporal
de `lib/db/index.ts` se retira antes del commit.

La regresión con Webpack tenía un fallo real, además de dos timeouts de
navegador: COGS devolvía 500/SQLSTATE 42704 al evaluar
`current_setting('app.current_company_id')`, aunque su servicio entrega el
executor de `withCompanyContext` a todas las consultas. El caso manual
403/401 pasó. El intento completo fue exit 1 (595.77 s), con fixtures
eliminados y fallo adicional del probe de cierre TCP inmediato.

Diagnóstico acotado, sin imprimir credenciales: después de cargar distintas
rutas, `globalThis.__pulsoPool` existía pero
`cachedPool instanceof Pool` era **false**. El driver instalado
`node_modules/drizzle-orm/neon-serverless/session.js` decide reservar/release
de un cliente mediante ese mismo `instanceof Pool`. Si falla, trata el pool
como cliente y BEGIN/set_config/consultas pueden repartirse en conexiones
distintas. No se corrige el servicio ocultando el GUC ausente ni se relajan
políticas.

RED focal: `-t 'partial and empty COGS'`, **exit 1, 74.80 s**, un caso
fallido y tres fuera del filtro. 500 antes de navegar; contexto perdido,
constructor false y limpieza de fixtures comprobados.

Cambio: añadir `@neondatabase/serverless` a `serverExternalPackages`, junto
al `ws` ya externalizado. Node comparte el constructor entre bundles/recargas
de Next y el pool global conserva la identidad que reconoce Drizzle. No se
cambian `DATABASE_URL`, permisos, settings de tenant, fórmulas ni SQL/RLS.
No se añade Drizzle a la lista ni se cambia el bundler del producto.

El reintento diagnóstico muestra **cached=true/currentConstructor=true** y
COGS **200** con cobertura parcial correcta. El caso no se declara aprobado:
terminó exit 1, 210.67 s, por interacción con pestaña SSR antes de hidratar
(no hubo petición COGS desde la UI; solo quedó el efecto inicial de Uso).
Se espera ahora esa petición cliente como señal de hidratación y se exige
pestaña activa. La instrumentación temporal ya se retiró; no queda cambio
en `lib/db/index.ts`.

El checkpoint final usa Next **de producción** tras un build nuevo; el modo
`REPORT_BROWSER_DEV=1` conserva Webpack aislado para diagnóstico. El cierre
TCP exige ECONNREFUSED y permite hasta 5 s para que termine el listener tras
salir el proceso, sin ignorar timeouts ni dejar de comprobar cierre.
La prueba completa y el checkpoint final están en curso. Esto
acredita el problema de empaquetado/reutilización de pool en Next dev con
Webpack; no afirma una conexión de login `pulso_app` ni despliegue operativo.

GREEN final sin diagnóstico temporal: **4/4, exit 0, 93.11 s** con el build
de producción nuevo, Next/Better Auth/Neon/navegador reales. Incluye COGS,
ejecutivo, menú y denegaciones de captura manual; no hubo saltos de casos.
Ventas e identidades del fixture se comprueban sin cambios, y servidor,
empresas y sesiones terminan cerrados/eliminados y verificados. El intento
anterior en producción pasó tres casos y falló por 429 al reautenticar
(83.13 s); el arnés respeta ese límite con reintentos acotados, sin desactivarlo.

Versiones instaladas: Neon **1.0.2**, Drizzle **0.45.2**, Next **16.1.6**.
TypeScript/lint: exit 0. Build **exit 0**, compilación 2.7 min, TypeScript,
455/455 páginas y optimización. Avisos de base de fetchConnectionCache y
documentos laborales dinámicos conservados. Comandos finales:

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
pnpm.cmd run build
$env:RUN_COGS_NEXT_BROWSER='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/cogs-next-browser.test.ts --maxWorkers=1 --pool=threads
```

No cambia el estado de aceptación de COGS: candidata 0154, dependencias y
conexión autenticada independiente runtime siguen pendientes. Ninguna
migración, credencial ni dato operativo fue modificado; no se despliega.
