# Guía de Administración (Roles: ADMIN, GERENTE)

Esta guía te ayudará como encargado de **Pulso HORECA** a gestionar los parámetros de tu empresa, los KPIs analíticos de sucursales y la reportablidad ante agencias regulatorias.

## 1. Panel de Organización

En el Sidebar accede a **Organización**.
Desde aquí puedes dar de alta Sucursales (branches) nuevas, y revisar el listado completo del **Personal**.
- **Alta de Empleados:** Asigna el rol (EMPLEADO, GERENTE, SUPERVISOR), la posición táctica (Ej. COCINERO, MESERO) y la sucursal base a la que están fijos. Las reglas del Dashboard y permisos de lectura reaccionarán dependiendo del Rol adjudicado.
- **Configuración de WhatsApp Bot:** Aquí puedes ligar y visualizar qué comandos están respondiendo en tus integraciones para dar de alta canales.

## 2. Cumplimiento Legal y Reportes NOM

Es crítico mantener a la sucursal al margen con la ley laboral y las autoridades sanitarias (COFEPRIS). 
Ve a **Cumplimiento > Reportes**.
1. En esta pantalla podrás detonar un reporte NOM-251 o NOM-035.
2. Escoge el marco de tiempo y la sucursal deseada.
3. Al darle ejecutar, Pulso agregará firmas digitales y reunirá todos los workflows resueltos en esa franja de tiempo calculando el porcentaje de adherencia legal. Resultará en un PDF descargable.

## 3. Constructor de Horarios (Asignaciones Masivas)

Para los turnos de la próxima semana, ve a **Personal > Constructor de Horarios**.
Podrás arrastrar y crear configuraciones rápidas de tiempo (Ej. Lunes a Viernes de 09:00 a 17:00).
Da clic a "Crear Semana Completa" para el rol de MESERO y el sistema asincrónicamente escribirá los turnos publicándolos y mandándole advertencias vía SMS/WhastApp a tus empleados.

## 4. Analítica Corporativa y Constructor de KPIs

Como Gerente, medir el negocio es lo esencial. Dirígete a **Tablero > Analítica**.
Si aún no mides una métrica particular que se te exige (Ej. Productividad de Meseros, Costo de Mermas Semanal):
1. Ve a **Constructor KPIs** bajo la misma rama.
2. Inyecta formulas matemáticas y declara variables de umbrales.
3. Podrás configurar Alarmas Activas (Email/SMS) siempre que un Target rompa su Mínimo (Por ejemplo, desperdicio de insumos).

## 5. Nómina: Aguinaldo por año fiscal (CFDI 002)

El aguinaldo se calcula, previsualiza y timbra desde **Personal → Payroll → bloque "Aguinaldo {año}"**.

### Qué incluye el cálculo (Art. 87 LFT, vigente)
- **15 días de salario por cada año**, prorrateados por el tiempo trabajado en el año: `15/365 × días × salario diario`.
- **Días a considerar**: el "días calendario" propuesto por el sistema cuenta del 1-ene (o de tu fecha de antigüedad si deséaste en el año) al 31-dic. Si el empleado tuvo faltas sin goce de sueldo, la columna "días a considerar" es **editable** — vacaciones, festivos, riesgo de trabajo, maternidad y paternidad SÍ cuentan (criterio PROFEDET); faltas injustificadas y permisos sin sueldo NO.
- **Exención de ISR**: el equivalente a 30 UMA diarias vigentes al pago (~$3,394.20 en 2026 con UMA $113.14) va **exento** y cae saldo **gravado**. La exención no se prorratea.
- **Solo salario ordinario del contrato**: las propinas (pago a cuenta, CFDI 038) NO generan aguinaldo; las comisiones deben estar en el salario del contrato.

### Cómo se dispersa
1. Abre el bloque **Aguinaldo {año}**, revisa la columna editable "días a considerar" y la línea de cada empleado (bruto / exento / gravado).
2. Presiona **"Ejecutar Dispersión"**: se timbra un **CFDI 002 de nómina extraordinaria (tipo "E")** por empleado, con periodo 1-ene a 31-dic del año — separado de la nómina quincenal ordinaria.
3. El sistema bloquea repetir la dispersión del mismo año (idempotencia). Re-intentar con empleados que fallaron requiere soporte.

### Límites y reglas del sistema
- **Vigencia legal**: 15 días es la única cifra vigente. La iniciativa de "30 días por antigüedad" **no es ley**; los cálculos a 15 días son deterministas (la UI muestra un badge de estatus legal).
- **Ventana**: se puede timbrar fuera de diciembre (máx. legal 19-dic; multa Art. 1002 de 50–5,000 UMA), con aviso en la respuesta. Un recordatorio automático se manda a los admins entre el 1 y el 19 de diciembre si el año todavía no está disperso.
- **ISR del gravado**: la retención se lmana como "decisión futura" (tarifa anual Art. 174 RLISR); el CFDI por ahora declara la parte gravada sin retención en el complemento.
- **Provisión informativa**: en **Finanzas → Costo Laboral** ve la línea "+ prov. agui. ~" que estima la porción del aguinaldo período a período (fórmula procesal del Art. 87, marcada DERIVED). Es informativa —NO es un asiento contable ni un pasivo formal—, y se puede ocultar por inquilino en la configuración operativa (`show_aguinaldo_provision`).
