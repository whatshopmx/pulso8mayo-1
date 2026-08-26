# SISTEMA DE PRODUCCIÓN DIARIA, CONTROL FEFO Y RECETARIO
## Manual Operativo Unificado para Grupos QSR (3–15 Sucursales)
### Plataforma Multitenant · Versión 1.0

---

## 0. CONTEXTO Y ALCANCE

Este documento define el módulo operativo diario de una plataforma **multitenant** diseñada para grupos restauranteros de **Quick Service Restaurant (QSR)** con entre **3 y 15 sucursales**. Conecta el inventario físico con la producción real y el costeo de recetas, controlando merma, caducidad y rendimiento real vs. teórico.

El sistema aplica tanto para modelos de **producción local** (cada sucursal prepara todo) como de **cocina central** (commissary con ensamble en sucursal), y es escalable conforme el grupo crece.

---

## 1. ARQUITECTURA GENERAL DEL SISTEMA

```
                    ┌──────────────────────────┐
                    │   VENTAS PROYECTADAS      │
                    │  (Histórico + tendencia)  │
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │  PLAN DE PRODUCCIÓN DIARIO│
                    └────────────┬─────────────┘
                                 ▼
        ┌────────────────────────┴────────────────────────┐
        ▼                                                   ▼
┌───────────────┐                                  ┌───────────────┐
│  RECETARIO/BOM │◄─────────────────────────────────│  INVENTARIO    │
│ (Explosión de  │                                  │  POR LOTES     │
│  ingredientes) │                                  │  (FEFO)        │
└───────┬────────┘                                  └───────┬────────┘
        │                                                    │
        ▼                                                    ▼
┌───────────────┐                                  ┌───────────────┐
│ PRODUCCIÓN     │─────────────────────────────────►│ CONSUMO REAL   │
│ REAL DEL DÍA   │                                  │ (Descuento de  │
└───────┬────────┘                                  │  inventario)   │
        │                                                    │
        ▼                                                    ▼
┌──────────────────────────────────────────────────────────────┐
│      COMPARATIVO: TEÓRICO vs REAL (Variance Report)           │
│           → Alimenta Food Cost % y Merma %                    │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│  POS vende → EXPLOSIÓN DE RECETA → consumo TEÓRICO            │
│  CONSUMO REAL ← INVENTARIO por lote (FEFO)                    │
│  VARIANZA = Teórico - Real - Merma registrada                 │
│  POSICIÓN DE INVENTARIO → par levels → ORDEN DE COMPRA        │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. LOS 4 PILARES Y LAS 8 REGLAS DEL SISTEMA

### Los 4 pilares operativos
1. **Recetario estandarizado** → Todos preparan igual, en las 15 sucursales.
2. **FEFO estricto** → Se usa primero lo que caduca primero; reduce merma.
3. **Plan de producción basado en datos** → No se produce "al ojo", sino según proyección real.
4. **Variance report constante** → Detecta problemas antes de que se conviertan en pérdidas grandes.

### Las 8 reglas inquebrantables
1. **Sin ficha técnica no hay venta controlada:** cada pieza vendida consume insumos calculados.
2. **El lote nace en recepción** con fecha de caducidad y temperatura verificada.
3. **FEFO en todo:** lo que vence primero se usa primero — piso, cámara, línea.
4. **Todo lo abierto o preparado se re-etiqueta** con fecha de prep y caducidad.
5. **Se cocina contra forecast y pars por franja**, no contra el antojo del cocinero.
6. **Lo que se tira se registra con causa** — la merma invisible no se puede corregir.
7. **Conteo ciego diario** de lo caro; inventario mensual total; auditoría sorpresa trimestral.
8. **Toda mercancía que se mueve viaja con documento y lote** — entre central, sucursales y proveedores.

---

## 3. EL RECETARIO / BOM (Bill of Materials)

### 3.1 Ficha técnica estándar
Debe existir para **cada producto del menú**, idéntica en las 15 sucursales.

**Ejemplo: Hamburguesa Clásica (HAM-001)**

| Campo | Detalle |
|---|---|
| Código de producto | HAM-001 |
| Nombre | Hamburguesa Clásica |
| Categoría | Platillo principal |
| Foto estándar | Sí (montaje exacto) |
| Rendimiento | 1 porción |
| Tiempo de preparación | 3 min |
| Tiempo de retención en línea | Máx. 10 min armada |
| Costo teórico | $28.50 |
| Precio de venta | $89.00 |
| Food Cost % teórico | 32% |

**Explosión de ingredientes:**

| SKU | Descripción | Unidad | Cantidad | Costo unit. | Costo total |
|---|---|---|---|---|---|
| INS-045 | Carne de res 100 g | pza | 1 | $12.00 | $12.00 |
| INS-012 | Pan hamburguesa | pza | 1 | $3.50 | $3.50 |
| INS-089 | Queso amarillo | pza | 1 | $2.00 | $2.00 |
| INS-023 | Lechuga | g | 15 | $0.30 | $4.50 |
| INS-034 | Tomate | g | 20 | $0.25 | $5.00 |
| SUB-015 | Salsa especial | g | 25 | $0.60 | $1.50 |
| **TOTAL** | | | | | **$28.50** |

### 3.2 Sub-recetas (recetas madre)
En QSR hay preparaciones intermedias (salsas, marinados, pre-cocidos) que necesitan ficha propia:

```
RECETA MADRE (Sub-receta)          RECETA DE VENTA (Producto final)
─────────────────────────           ──────────────────────────────
Salsa especial (rinde 5 L)    →     Se usa 25 g en cada hamburguesa
Pollo marinado (rinde 10 kg)  →     Se usa 150 g en cada orden
Masa de pizza (rinde 20 pzas) →     Se usa 1 pza por pizza
```

El sistema **explota en cascada**: la salsa tiene su propia ficha con sus insumos.

### 3.3 Reglas del recetario
- **Todo pasa por ficha técnica:** hasta el hielo y la servilleta. Lo que no está en ficha no existe.
- **Cantidades en bruto (crudo):** las fichas especifican materia prima cruda con su **factor de rendimiento** (ej. carne cruda 130 g → cocida 113 g = 87%).
- **Versionado:** cada cambio de ficha tiene fecha y autorización. Sin esto, el costo teórico deja de coincidir con la realidad.
- **Familias de productos:** pocos SKUs base + salsas/acompañamientos = menos merma, compras consolidadas.

### 3.4 Explosión automática
Si el POS reporta 350 hamburguesas clásicas, el sistema calcula:
- 350 panes (del lote X)
- 45.5 kg de carne cruda
- 8.75 kg de salsa especial (que a su vez explota en sus insumos)
- 350 empaques

Ese es el **consumo teórico del día**. Se compara contra inventario físico y merma registrada.

---

## 4. CATÁLOGO MAESTRO DE INSUMOS

| Campo | Regla / Ejemplo |
|---|---|
| SKU | Código único para TODAS las sucursales (mismo código, misma unidad) |
| Unidad de compra vs. uso | Compras caja de 24, usas piezas → el sistema convierte |
| Tipo de almacenamiento | Congelado / refrigerado / seco / ambiente |
| Vida útil | Días desde recepción (define conteos y par levels) |
| Proveedor principal y alterno | Si el principal falla, el alterno ya está aprobado |
| **Clasificación ABC** | **A:** proteínas, lácteos (80% valor, conteo diario); **B:** abarrotes (semanal); **C:** consumibles (mensual) |
| Par mínimo / máximo | Se calcula, no se intuye |

**Fórmula de par level:**
```
Par level = uso diario promedio × días de cobertura + stock de seguridad
```

| Tipo de insumo | Cobertura recomendada |
|---|---|
| Perecederos (vida 3–7 días) | 2–4 días |
| Refrigerados (7–21 días) | 5–7 días |
| Congelados y secos | 7–15 días |

---

## 5. SISTEMA DE LOTES CON FEFO

### 5.1 ¿Por qué FEFO y no FIFO?
- **FIFO** rota por fecha de **recepción**.
- **FEFO** rota por fecha de **caducidad**.

En QSR es crítico: dos lotes del mismo queso pueden llegar con fechas distintas — el de ayer vence en 20 días, el de hoy vence en 12. Con FIFO usarías primero el de 20 días y el otro se vencería. **En QSR se controla por caducidad, no por llegada.**

### 5.2 Recepción: donde nace el lote
```
Llega el camión →
  1. Cotejar contra OC (cantidad, precio, producto)
  2. Verificar TEMPERATURA
     → Congelado ≤ -18°C | Refrigerado 0-4°C
     → Fuera de rango = SE RECHAZA (no se "acepta con nota")
  3. Registrar en el sistema:
     ✔ SKU + cantidad + proveedor
     ✔ NÚMERO DE LOTE del proveedor
     ✔ FECHA DE CADUCIDAD
  4. Etiquetar en bodega/cámara: lo nuevo va ATRÁS
  5. Nota de recepción firmada → habilita el pago (conciliación triple)
```

**Estructura del registro de lote:**

| Campo | Ejemplo |
|---|---|
| Número de lote | LOT-2025-0847 |
| SKU insumo | INS-045 (Carne de res) |
| Fecha de recepción | 15/03/2025 |
| Fecha de caducidad | 20/03/2025 |
| Temperatura al recibir | 2°C |
| Cantidad recibida | 50 kg |
| Proveedor | Distribuidora XYZ |
| Sucursal | Suc. 05 |
| Ubicación física | Refrigerador 2, Rack B |
| Estatus | Disponible / En uso / Agotado / Merma |

### 5.3 Etiquetado físico (método visual)
Todo lo que sale de su empaque original o se prepara se **re-etiqueta**:

```
┌─────────────────────────────┐
│  CARNE DE RES                │
│  Lote: 0847                  │
│  Recibido: 15/03             │
│  Caduca: 20/03               │
│  Cantidad: 50 kg             │
│  Temp. recepción: 2°C        │
└─────────────────────────────┘

┌─────────────────────────────┐
│  PRODUCTO: Salsa especial    │
│  PREPARADO: 15/ene 08:00     │
│  CADUCA:    18/ene 22:00     │
│  LOTE ORIGEN: L-0112         │
│  ELABORÓ:  J.P.              │
└─────────────────────────────┘
```

**Código de colores por día de caducidad:**
- 🟢 **Verde:** más de 3 días de vida
- 🟡 **Amarillo:** 1–2 días de vida (usar primero)
- 🔴 **Rojo:** caduca hoy (uso inmediato o desecho)

**Regla de acomodo físico:** lo viejo adelante / arriba; lo nuevo atrás / abajo.

### 5.4 Alertas automáticas del sistema

| Alerta | Acción |
|---|---|
| Lote caduca en 48 hrs | Notificación a gerente de cocina para priorizar uso |
| Lote caduca en 24 hrs | Notificación urgente + sugerencia de promoción/uso creativo |
| Lote caducado sin usar | Bloqueo automático + registro obligatorio de merma |

### 5.5 Trazabilidad (cuando la necesitas, la necesitas urgente)
Cadena completa en el sistema:
```
Proveedor → Lote L-0112 (pollo) → sub-receta (marinado L-PM45)
→ distribuido a sucursales 003, 007, 012 → vendido en productos X, Y
```
Si el proveedor reporta un retiro de producto, en **15 minutos** sabes qué sucursales, qué productos y qué lotes retirar de línea. Sin trazabilidad por lote, tiras todo el inventario del SKU en todas las sucursales.

---

## 6. PLAN DE PRODUCCIÓN DIARIO

### 6.1 Proceso de planeación (se hace la noche anterior o temprano)
```
1. FORECAST del día: ventas históricas por hora (mismo día de la semana
   de semanas anteriores) + ajustes: clima, promociones, quincena,
   eventos locales, temporada
        ↓
2. EXPLOSIÓN del forecast: forecast × fichas técnicas = necesidad
   de insumos y de preparaciones
        ↓
3. RESTAR inventario en línea (lo ya preparado con vida útil vigente)
        ↓
4. Verificar FEFO: la lista indica DE QUÉ LOTE tomar cada insumo
        ↓
5. GENERA: Hoja de Producción Diaria (Prep List) por estación
```

### 6.2 Formato: Hoja de Producción Diaria (Prep List)

**Por estación (ejemplo: cocina):**

| Preparación | Cant. a producir | Lote a usar (FEFO) | Turno | Responsable | Hora límite | Estatus |
|---|---|---|---|---|---|---|
| Carne marinada | 12 kg | L-0098 (vence 1º) | Matutino | Cocinero A | 09:30 | ✅ |
| Salsa especial | 4 kg | SUB L-0045 | Matutino | Cocinero B | 09:00 | ✅ |
| Vegetales cortados | 6 kg | Lote refrig. | Matutino | Prep station | 10:00 | Pendiente |
| Pan tostado prep | 200 pzas | L-0221 | Matutino | Cocinero A | 08:00 | Pendiente |

### 6.3 Par levels por franja horaria (batch cooking)
Cada estación tiene cuánto debe tener LISTO en cada momento. Se cocina en **tandas pequeñas** contra estos pars, no montones al inicio del día.

| Producto | 11:00 | 14:00 | 17:00 | 20:00 |
|---|---|---|---|---|
| Pollo cocido | 8 kg | 4 kg | 10 kg | 3 kg |
| Papas fritas listas | 3 canastas | 2 | 4 | 2 |
| Pan tostado | 40 pzas | 20 | 50 | 15 |
| Hamburguesas armadas | 12 pzas | 6 | 15 | 5 |

**Regla:** tanda grande = producto viejo al final = merma por tiempo de retención vencido.

### 6.4 Tiempos de retención (hold times) — el control invisible
Cada producto cocinado tiene ventana máxima en línea:

| Producto | Tiempo máximo en línea |
|---|---|
| Pollo cocido | 30 min |
| Hamburguesa armada | 10 min |
| Papas fritas | 7 min |
| Ensamble frío | 15 min |

Al vencer, se registra en el **waste log** y se tira. Es lo que da consistencia de marca y vuelve confiable el dato de merma.

---

## 7. CRONOGRAMA DEL DÍA EN SUCURSAL

| Hora | Actividad |
|---|---|
| 07:00 | Recepción de insumos: temperatura, lotes, FEFO, etiquetado |
| 07:30 | Conteo rápido ciego de perecederos A (proteínas) |
| 08:00 | Pre-preparación: marinados, salsas, cortes (tomando lotes FEFO) |
| 09:30 | Setup de líneas, validar prep list completa |
| 10:30 | Verificación de pars pre-almuerzo |
| 11:00–14:00 | Servicio almuerzo: batch cooking contra pars, waste log activo |
| 14:30 | Recuento intermedio, ajustar pars pre-cena, recibir 2º pedido si aplica |
| 17:00–20:00 | Servicio cena |
| 21:00 | Cierre: conteo final, waste log firmado, mermas de retención registradas |
| 21:30 | Sistema calcula: teórico vs real del día + sugiere pedido para mañana |
| 21:45 | Gerente valida/ajusta la OC del día siguiente (contra forecast) |

---

## 8. CONTROL DE MERMAS

### 8.1 Tipos de merma a registrar

| Tipo | Ejemplo | Responsable |
|---|---|---|
| Merma por caducidad | Insumo venció sin usarse | Encargado de almacén |
| Merma por preparación | Recorte de vegetales, grasa de carne | Cocinero (rendimiento esperado) |
| Merma por tiempo de retención | Producto cocinado venció en línea | Cocinero + supervisor |
| Merma por error de producción | Se quemó, se cayó, mal preparado | Cocinero + supervisor |
| Merma por manejo/accidente | Se rompió, se derramó | Cualquier empleado |
| Devolución del cliente | Inconsistencia | Gerente |
| Cortesía / empleado | Tiene tope y se aprueba | Gerente |

### 8.2 Registro de merma con causa obligatoria
**La merma sin causa no se acepta.** "Se tiró porque sí" no existe — sin causa no hay corrección.

| Fecha | SKU | Lote | Cantidad | Motivo | Costo | Registró | Autorizó |
|---|---|---|---|---|---|---|---|
| 15/03 | INS-045 | L-0847 | 2 kg | Caducidad | $24.00 | J.P. | M.G. |

### 8.3 Causa → Acción que dispara

| Causa | Acción |
|---|---|
| Caducidad / vencimiento | Falla de FEFO o de compra excesiva |
| Tiempo de retención vencido | Forecast mal calibrado o pars altos |
| Mala preparación / quemado | Entrenamiento |
| Devolución del cliente | Revisar consistencia |
| Cortesía / empleado | Tiene tope y se aprueba |

### 8.4 Metas de merma por categoría (benchmark QSR)

| Categoría de insumo | Merma aceptable |
|---|---|
| Proteínas | 2–4% |
| Vegetales / perecederos | 5–8% |
| Empaque / desechables | 1–2% |
| Abarrotes | 0.5–1% |

Si la merma real supera la meta → **investigación obligatoria** (¿mal manejo, mal pronóstico, robo, problema de proveedor?).

---

## 9. CICLO COMPLETO DE INVENTARIO

### 9.1 Flujo integral
```
COMPRA (OC) → Insumo entra con LOTE y fecha de caducidad
    ↓
ALMACENAMIENTO → Ordenado por FEFO (lote más próximo a vencer al frente)
    ↓
PLAN DE PRODUCCIÓN → Explota receta y determina qué preparar hoy
    ↓
PRODUCCIÓN → Consume insumo del lote correspondiente (descuento automático)
    ↓
VENTA (POS) → Descuenta automáticamente los insumos de la receta
    ↓
CONTEO FÍSICO (diario o semanal) → Verifica inventario real vs teórico
    ↓
REPORTE DE VARIANZA → Compara consumo teórico vs consumo real
    ↓
ANÁLISIS DE MERMA → Identifica pérdidas y causas
    ↓
AJUSTE DE PRONÓSTICO → Retroalimenta el siguiente Plan de Producción
```

### 9.2 Frecuencia de conteo

| Tipo de insumo | Frecuencia | Responsable | Método |
|---|---|---|---|
| Alto valor / alto riesgo (carnes, mariscos) | Diario | Encargado de turno | **Conteo ciego** |
| Perecederos generales | Cada 2–3 días | Gerente + otro | Ciego, doble verificación |
| Abarrotes / secos | Semanal | Gerente | Ciego |
| Inventario general completo | Mensual (mismo corte en todas las sucursales) | Gerente | Firma y envía a corporativo |
| Auditoría sorpresa | Trimestral | Auditor corporativo | **Es el conteo que vale** |

**Conteo ciego** = el que cuenta no ve lo que "debería haber". Si ve el número esperado, tiende a "confirmarlo".

### 9.3 Fórmula de cierre diario / mensual
```
CONSUMO REAL     = Inventario inicial + Compras/Recepciones - Inventario final
CONSUMO TEÓRICO  = Ventas × Fichas técnicas
VARIANZA         = Teórico - Real - Merma registrada (con causa)
```

| Resultado | Significado |
|---|---|
| Varianza < 1.5% del consumo | Sistema funcionando |
| 1.5% – 3% | Merma no registrada, rendimientos mal calculados |
| > 3% | Investigación: robo, fichas desactualizadas, recepciones mal contadas |

---

## 10. REPORTE CLAVE: CONSUMO TEÓRICO vs REAL

El reporte más importante para controlar 15 sucursales, porque revela robo, mal manejo o error de receta.

| Insumo | Consumo teórico (ventas × receta) | Consumo real (inventario) | Variación | % Var. | Alerta |
|---|---|---|---|---|---|
| Carne de res | 45 kg | 49 kg | +4 kg | +8.9% | 🔴 Revisar |
| Pan hamburguesa | 200 pzas | 198 pzas | -2 pzas | -1% | 🟢 Normal |
| Queso amarillo | 150 pzas | 165 pzas | +15 pzas | +10% | 🔴 Revisar |
| Lechuga | 5.25 kg | 5.40 kg | +0.15 kg | +2.9% | 🟡 Monitorear |

**Interpretación:**
- **Variación positiva alta** → posible robo, mal control de porciones, o merma no registrada.
- **Variación negativa** → posible error en receta (se usa menos de lo que dice la ficha) o venta no registrada en POS.

---

## 11. MODELO MULTI-SUCURSAL: PRODUCCIÓN LOCAL vs COCINA CENTRAL

### 11.1 Comparativo de modelos

| Aspecto | Producción local | Cocina central (commissary) |
|---|---|---|
| Operación | Cada sucursal recibe materia prima y prepara TODO | Recibe sub-recetas terminadas + hace ensamble final |
| Consistencia entre sucursales | Difícil (depende del personal) | Alta (la salsa sabe igual en las 15) |
| Compras | Cada quien contra par levels | Consolidadas por volumen (mejor precio) |
| Personal calificado | Necesario en cada sucursal | Solo en central |
| **Cuándo tiene sentido** | **3–6 sucursales, menú simple** | **8+ sucursales, menú con muchas sub-recetas** |
| Lotes | Lote del proveedor en cada tienda | Lote de producción central + lote de proveedor original |

### 11.2 Flujo con cocina central
```
1. Cada sucursal envía su forecast/necesidad de sub-recetas (día D-2)
2. Central consolida demanda de las 15 → plan de producción central
3. Central produce por LOTES DE PRODUCCIÓN propios (L-PM-45 = pollo
   marinado 15/ene) que heredan el lote del proveedor original
4. Cada lote sale con etiqueta: fecha de producción + caducidad +
   lote origen → trazabilidad no se rompe
5. Distribución por rutas (refrigerado) → recepción en sucursal
   = misma disciplina: temperatura, conteo contra orden de transferencia
6. Transfers entre sucursales: con orden de transferencia documentada,
   JAMÁS "me pasas un poco de pollo y ya" — rompe el inventario
   y esconde varianzas
```

**Regla:** toda mercancía que se mueve entre ubicaciones (central → sucursal, sucursal → sucursal) viaja con documento y lote. **Sin excepción.**

---

## 12. INDICADORES CLAVE (KPIs) DEL SISTEMA

| Indicador | Meta | Qué detecta si falla |
|---|---|---|
| Food cost real vs teórico | Brecha < 2 pts | Robo, merma oculta, fichas mal |
| Merma total % ventas | 2–4% | Caducidad, batch cooking mal |
| Merma por caducidad | < 0.5% | FEFO roto o sobrecompra |
| Días de inventario perecederos | 2–4 días | Dinero tirado en cámaras |
| Cumplimiento de etiquetado en auditoría | > 95% | Riesgo sanitario y de trazabilidad |
| Exactitud de forecast (ventas) | ±10% | Pars mal calibrados → quiebres o merma |
| % conteos ciegos completados | 100% | Se relajó el control |
| Quiebres de stock de producto clave | 0 | Ventas perdidas |
| Varianza de inventario | < 1.5% | Robo o error de receta |

---

## 13. ROLES Y RESPONSABILIDADES

| Rol | Responsabilidad |
|---|---|
| **Gerente de sucursal** | Aprueba plan de producción diario, supervisa FEFO, autoriza mermas, valida OC del día siguiente |
| **Encargado de almacén/recibo** | Registra lotes, verifica temperatura, organiza FEFO físicamente, alerta caducidades |
| **Jefe de cocina / turno** | Ejecuta producción según prep list, respeta recetas estándar, registra waste log |
| **Corporativo (Control de Costos)** | Analiza variance report de las 15 sucursales, detecta anomalías, actualiza fichas técnicas |
| **Auditor interno** | Conteos sorpresa, valida cumplimiento de FEFO físicamente, auditoría trimestral |

---

## 14. TECNOLOGÍA DE SOPORTE

| Función | Herramienta básica | Herramienta robusta (recomendada) |
|---|---|---|
| Recetario / BOM | 
| Control de lotes FEFO 
| Plan de producción |
| Variance report 
| Alertas de caducidad | Revisión manual diaria | Notificaciones automáticas push / WhatsApp |
| Trazabilidad de recalls | Manual por sucursal | Sistema centralizado con búsqueda por lote en segundos |

**Elemento ideal:** un sistema donde al vender un producto en el POS, automáticamente se descuente del inventario el insumo correspondiente según la receta — esto elimina el 90% del trabajo manual de conteo y variance.

---

## 15. TABLERO DIARIO DE OPERACIÓN POR SUCURSAL

Lo que un gerente de sucursal debe revisar **cada mañana**:

```
┌──────────────────────────────────────────────────────────────┐
│  SUCURSAL 05 - TABLERO DIARIO — 26/AGO/2026                  │
├──────────────────────────────────────────────────────────────┤
│  ✅ Plan de producción de hoy: [Ver Prep List]                │
│  ⚠️  Lotes por caducar en 24-48h: 3 insumos                  │
│  🔴 Lotes caducados sin usar (ayer): 1 (Merma: $150)         │
│  📊 Merma acumulada del mes: 3.2% (Meta: 4%) ✅              │
│  📈 Variance del día anterior: Carne +8% 🔴 (Revisar)        │
│  📦 Insumos con inventario bajo (reorden): 2 SKUs            │
│  🌡️ Temperatura de cámaras: OK                              │
│  📋 Conteos ciegos completados: 100% ✅                      │
└──────────────────────────────────────────────────────────────┘
```

A nivel **corporativo**, el tablero consolida las 15 sucursales con ranking por food cost, merma y varianza, permitiendo detectar anomalías comparativas.

---

## 16. RESUMEN EJECUTIVO

Este sistema unificado convierte la operación diaria de un grupo QSR de 3 a 15 sucursales en un ciclo cerrado y medible:

1. **El recetario es el ADN:** sin ficha técnica no hay control.
2. **FEFO protege el margen:** se usa primero lo que caduca primero.
3. **El forecast dirige la producción:** batch cooking contra pars por franja.
4. **Los lotes garantizan trazabilidad:** recalls en 15 minutos, no en días.
5. **La varianza revela la verdad:** teórico vs real es el termómetro del negocio.
6. **La merma con causa se corrige:** la merma invisible no se puede atacar.
7. **El conteo ciego audita la realidad:** sin sesgo de confirmación.
8. **Todo movimiento viaja documentado:** entre central, sucursales y proveedores.

La combinación de estos elementos permite a un grupo QSR escalar de 3 a 15 sucursales manteniendo **consistencia de marca, control de costos y trazabilidad sanitaria**, que son los tres pilares competitivos del formato.

---

**Versión del documento:** 1.0
**Fecha:** 26 de agosto de 2026
**Alcance:** Plataforma multitenant para grupos QSR de 3–15 sucursales