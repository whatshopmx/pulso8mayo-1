# Pulso — Diseño Completo para Grupos Restauranteros v2

> **Cliente tipo:** Grupo restaurantero con 3 a 15 sucursales en Monterrey y zona metropolitana.
>
> **Objetivo de este documento:** Especificar el diseño completo del sistema Pulso para un grupo restaurantero multi-sucursal: qué ve cada rol, qué módulos cubre, cómo fluye la información entre sucursales y grupo, cómo se implementa fase por fase, y cómo se integra WhatsApp como canal de ejecución.
>
> **Versión 2.0 — Julio 2026.** Extiende la v1 original con 5 módulos financieros (13-17), 1 rol nuevo (Chef Corporativo), workflow de Apertura de Nueva Sucursal, empaquetamiento por tamaño de cliente (3 tiers), resiliencia técnica offline, y controles de adopción y anti-fraude.
>
> **Principio rector de esta versión:** el sistema original captura muy bien *evidencia operativa* (¿se hizo la tarea?). Esta versión conecta esa evidencia con *impacto financiero* (¿cuánto costó, cuánto se vendió, cuánto se perdió, cuánto salió realmente de la cuenta, y quién lo autorizó?). Un dueño de restaurantes no piensa en compliance score. Piensa en pesos — y en si le están robando o no.

---

## Índice

1. [Arquitectura de Niveles: Grupo vs Sucursal](#1-arquitectura-de-niveles)
2. [Modelos Operativos del Grupo](#2-modelos-operativos-del-grupo)
3. [Roles y Lo Que Cada Uno Ve](#3-roles-y-lo-que-cada-uno-ve)
4. [Módulos Completos del Sistema](#4-módulos-completos)
5. [Workflow: Apertura de Nueva Sucursal](#5-workflow-apertura-de-nueva-sucursal)
6. [El Día de Operación en Una Sucursal](#6-el-día-de-operación)
7. [El Grupo: Gobernanza Multi-Sucursal](#7-el-grupo)
8. [WhatsApp Como Capa de Ejecución](#8-whatsapp)
9. [Resiliencia Técnica](#9-resiliencia-técnica)
10. [Adopción y Comportamiento](#10-adopción-y-comportamiento)
11. [Compliance Regulatorio Integrado](#11-compliance)
12. [Inventario y Merma](#12-inventario)
13. [Gestión Laboral Multi-Sucursal](#13-gestión-laboral)
14. [Incidentes y Remediación](#14-incidentes)
15. [Reportes e Inteligencia](#15-reportes)
16. [Empaquetamiento por Tamaño de Cliente](#16-empaquetamiento-por-tamaño-de-cliente)
17. [Fases de Implementación por Cliente](#17-fases-de-implementación)
18. [Modelo de Datos Conceptual](#18-modelo-de-datos)
19. [Dashboard Ejecutivo del Grupo](#19-dashboard-ejecutivo)

---

## 1. Arquitectura de Niveles: Grupo vs Sucursal

### Dos niveles, un solo sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                    NIVEL GRUPO (Owner, Director Ops)              │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ │
│  │Gobernanza│ │Analytics │ │Compliance│ │ Inventario│ │Laboral│ │
│  │Estándares│ │Cross-Br. │ │ Corporativo│ │Cross-Br. │ │Global │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └───────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ │
│  │ Ventas   │ │ Fiscal   │ │ Pagos y  │ │Control   │ │Delivery│ │
│  │ y POS    │ │CFDI/SAT  │ │ Gastos   │ │Interno   │ │Aggreg. │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └───────┘ │
│                                                                  │
│  Define políticas, estándares, playbooks.                         │
│  Monitorea ejecución en tiempo real.                              │
│  Recibe alertas cuando algo se desvía.                            │
│  Compara desempeño entre sucursales.                              │
│  Consolida rentabilidad real por sucursal (P&L).                  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│              NIVEL SUCURSAL (Gerente, Supervisores, Empleados)    │
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐   │
│  │SUCURSAL 1│    │SUCURSAL 2│    │SUCURSAL 3│    │SUCURSAL N│   │
│  │Centro    │    │San Pedro │    │Valle     │    │Cumbres   │   │
│  │          │    │          │    │          │    │          │   │
│  │Workflows │    │Workflows │    │Workflows │    │Workflows │   │
│  │Compliance│    │Compliance│    │Compliance│    │Compliance│   │
│  │Inventario│    │Inventario│    │Inventario│    │Inventario│   │
│  │Turnos    │    │Turnos    │    │Turnos    │    │Turnos    │   │
│  │Personal  │    │Personal  │    │Personal  │    │Personal  │   │
│  │WhatsApp  │    │WhatsApp  │    │WhatsApp  │    │WhatsApp  │   │
│  │Ventas día│    │Ventas día│    │Ventas día│    │Ventas día│   │
│  │Caja chica│    │Caja chica│    │Caja chica│    │Caja chica│   │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘   │
│                                                                  │
│  Ejecutan procesos estandarizados.                                │
│  Capturan evidencia en cada tarea.                                │
│  Reportan incidentes y desviaciones.                              │
│  Reciben asignaciones y alertas.                                  │
│  Reportan ventas diarias y gastos operativos.                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

        ┌───────────────────────────────────────────────┐
        │  DATOS COMPARTIDOS (Tenant del Grupo)          │
        │  • Empleados, roles, permisos                  │
        │  • Productos, recetas, proveedores             │
        │  • Playbooks y estándares corporativos         │
        │  • Historial de compliance                     │
        │  • Benchmarks internos                         │
        │  • Plantillas de mapeo de POS                  │
        │  • Configuración fiscal (RFC, CFDI)            │
        │  • Políticas de autorización de gastos         │
        │  • Matriz de segregación de funciones          │
        └───────────────────────────────────────────────┘
```

---

## 2. Modelos Operativos del Grupo

### Cada grupo es distinto. Pulso se configura, no se reescribe.

> Antes de activar cualquier módulo, el sistema necesita entender **qué tipo de negocio es este grupo**. No es un checklist de onboarding — es una configuración estructural que determina cómo se comportan todos los módulos simultáneamente. Dos grupos de 8 sucursales cada uno pueden operar de formas radicalmente distintas, y Pulso debe adaptarse a ambas sin desarrollo por cliente.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  DIMENSIONES DE CONFIGURACIÓN DEL TENANT                         │
│  ─────────────────────────────────────                           │
│                                                                  │
│  Durante el discovery (Semana 1-2 de implementación), se         │
│  define el modelo operativo del grupo en 7 dimensiones.          │
│  Cada dimensión afecta el comportamiento de múltiples módulos.   │
│                                                                  │
│  ┌──────────────────────┬────────────────────────────────────┐  │
│  │ DIMENSIÓN            │ OPCIONES                           │  │
│  ├──────────────────────┼────────────────────────────────────┤  │
│  │ 1. ESTRUCTURA DE     │ • CENTRALIZADA: todas las compras  │  │
│  │    COMPRAS           │   las hace oficina central. Las    │  │
│  │                      │   sucursales solo reciben.         │  │
│  │  Afecta: M7, M3,     │ • POR SUCURSAL: cada gerente      │  │
│  │  M15, M16, M17       │   compra a sus proveedores.       │  │
│  │                      │ • HÍBRIDO: proteínas y secos van  │  │
│  │                      │   central; perecederos (verdura,  │  │
│  │                      │   pan) cada sucursal resuelve.    │  │
│  ├──────────────────────┼────────────────────────────────────┤  │
│  │ 2. PRODUCCIÓN DE     │ • COCINA IN-SITU: cada sucursal   │  │
│  │    ALIMENTOS         │   produce todo su menú.            │  │
│  │                      │ • COCINA CENTRAL: una cocina       │  │
│  │  Afecta: M3, M6,     │   central produce y distribuye a  │  │
│  │  M7, M1              │   sucursales (solo calentamiento/  │  │
│  │                      │   montaje en sucursal).            │  │
│  │                      │ • MIXTO: cocina central para       │  │
│  │                      │   guisos y fondos; in-situ para    │  │
│  │                      │   término y montaje.               │  │
│  ├──────────────────────┼────────────────────────────────────┤  │
│  │ 3. TESORERÍA Y       │ • CUENTA ÚNICA: todo el efectivo  │  │
│  │    FLUJO DE EFECTIVO │   y tarjeta va a una cuenta del   │  │
│  │                      │   grupo. Las sucursales no tienen  │  │
│  │  Afecta: M13, M16,   │   cuenta bancaria propia.          │  │
│  │  M17                  │ • CUENTA POR SUCURSAL: cada       │  │
│  │                      │   sucursal tiene su cuenta y el   │  │
│  │                      │   gerente la administra.           │  │
│  │                      │ • MIXTO: venta con tarjeta va a   │  │
│  │                      │   cuenta del grupo; efectivo lo    │  │
│  │                      │   maneja la sucursal para caja     │  │
│  │                      │   chica y gastos menores.          │  │
│  ├──────────────────────┼────────────────────────────────────┤  │
│  │ 4. PAGO A            │ • CENTRALIZADO: oficina central   │  │
│  │    PROVEEDORES       │   paga todas las facturas.         │  │
│  │                      │ • POR SUCURSAL: cada gerente paga │  │
│  │  Afecta: M7, M15,    │   a los proveedores que él compró. │  │
│  │  M16, M17            │ • HÍBRIDO: compras centralizadas   │  │
│  │                      │   las paga oficina; compras por    │  │
│  │                      │   sucursal las paga el gerente.    │  │
│  ├──────────────────────┼────────────────────────────────────┤  │
│  │ 5. AUTONOMÍA DEL     │ • ALTA: el gerente compra,         │  │
│  │    GERENTE           │   contrata personal eventual,      │  │
│  │                      │   autoriza gastos hasta $X sin     │  │
│  │  Afecta: M7, M16,    │   consultar.                       │  │
│  │  M17, M4             │ • MEDIA: ejecuta playbooks,        │  │
│  │                      │   autoriza gastos menores (caja    │  │
│  │                      │   chica), compras requieren visto  │  │
│  │                      │   bueno de Director Ops.           │  │
│  │                      │ • BAJA: solo ejecuta tareas        │  │
│  │                      │   operativas. Cualquier gasto o    │  │
│  │                      │   compra escala a dirección.       │  │
│  ├──────────────────────┼────────────────────────────────────┤  │
│  │ 6. NÓMINA Y          │ • CONSOLIDADA: una sola dispersión │  │
│  │    DISPERSIÓN        │   de nómina para todo el grupo     │  │
│  │                      │   desde la razón social central.   │  │
│  │  Afecta: M4, M15     │ • POR RAZÓN SOCIAL: cada sucursal  │  │
│  │                      │   (o grupo de sucursales) tiene    │  │
│  │                      │   su propia razón social y su      │  │
│  │                      │   propia dispersión de nómina.     │  │
│  │                      │ • MIXTO: nómina consolidada pero   │  │
│  │                      │   con CFDI emitido por razón       │  │
│  │                      │   social correspondiente.          │  │
│  ├──────────────────────┼────────────────────────────────────┤  │
│  │ 7. TIPO DE TENANT    │ • GRUPO PROPIO: todas las          │  │
│  │                      │   sucursales son del mismo dueño.  │  │
│  │  Afecta: M12, M10,   │ • MIXTO (PROPIO + FRANQUICIAS):   │  │
│  │  Dashboard           │   algunas sucursales son propias   │  │
│  │                      │   y otras franquiciadas. Las       │  │
│  │                      │   franquicias tienen acceso        │  │
│  │                      │   limitado a datos del grupo,      │  │
│  │                      │   reportes separados, y no         │  │
│  │                      │   comparten proveedores ni         │  │
│  │                      │   tesorería con las propias.       │  │
│  └──────────────────────┴────────────────────────────────────┘  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  EJEMPLO CONCRETO DE CÓMO LA CONFIGURACIÓN CAMBIA TODO          │
│  ────────────────────────────────────────────────────           │
│                                                                  │
│  CASO A: GRUPO DE TORTAS — 8 SUCURSALES PROPIAS                 │
│  ───────────────────────────────────────────                     │
│                                                                  │
│  Modelo: Compras centralizadas, Cocina in-situ, Cuenta única,   │
│  Pago a proveedores centralizado, Autonomía media del gerente,  │
│  Nómina consolidada, Grupo propio.                              │
│                                                                  │
│  Cómo se comporta el sistema con esta configuración:             │
│                                                                  │
│  • Módulo 7 (Compras): las OC las genera el Director de Ops     │
│    o el administrador central, no los gerentes. Los gerentes     │
│    solo ejecutan el workflow de Recepción de Mercancía.          │
│  • Módulo 13 (Ventas): el corte del POS de cada sucursal        │
│    alimenta un solo dashboard consolidado. El efectivo se       │
│    deposita en la cuenta única del grupo.                       │
│  • Módulo 16 (Pagos): el flujo de efectivo es uno solo para    │
│    todo el grupo. Caja chica por sucursal limitada a $X.         │
│    La renta de las 8 sucursales se paga desde la cuenta única.  │
│  • Módulo 15 (Fiscal): un solo RFC principal + CFDI de nómina  │
│    consolidado. Las facturas de proveedores llegan al RFC       │
│    central y se descargan masivamente desde el SAT para todas   │
│    las sucursales.                                              │
│  • Módulo 17 (Control Interno): la segregación de funciones     │
│    opera a nivel grupo — quien crea la OC (admin central) no    │
│    puede ser quien recibe (gerente de sucursal).                │
│                                                                  │
│  ────────────────────────────────────────────────────           │
│                                                                  │
│  CASO B: GRUPO DE MARISQUERÍAS — 5 SUCURSALES,                  │
│  CADA UNA COMPRA INDEPENDIENTE                                   │
│  ───────────────────────────────────────────                     │
│                                                                  │
│  Modelo: Compras por sucursal, Cocina in-situ, Cuenta por       │
│  sucursal, Pago a proveedores por sucursal, Autonomía alta      │
│  del gerente, Nómina por razón social, Grupo propio.            │
│                                                                  │
│  Cómo se comporta el sistema con esta configuración:             │
│                                                                  │
│  • Módulo 7 (Compras): cada gerente genera sus propias OC       │
│    contra sus proveedores locales (central de abastos). Las     │
│    OC no requieren aprobación central si están dentro del       │
│    presupuesto semanal de la sucursal.                          │
│  • Módulo 13 (Ventas): cada sucursal tiene su propio dashboard  │
│    de ventas. El efectivo se deposita en la cuenta de la        │
│    sucursal, no del grupo.                                      │
│  • Módulo 16 (Pagos): cada sucursal tiene su propio flujo de    │
│    efectivo independiente. Caja chica más grande porque el      │
│    gerente resuelve compras diarias en efectivo en la central.  │
│  • Módulo 15 (Fiscal): cada sucursal tiene su propio RFC. La    │
│    descarga masiva del SAT se configura por RFC, no por grupo.  │
│  • Módulo 17 (Control Interno): la segregación opera a nivel    │
│    sucursal. En grupos de 5 sucursales con autonomía alta,      │
│    se aplica doble autorización (gerente + director ops) para   │
│    compras mayores a $X, ya que no hay suficiente personal      │
│    para segregación estricta en cada sucursal.                  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  IMPACTO EN LA IMPLEMENTACIÓN                                    │
│  ────────────────────────────                                    │
│                                                                  │
│  Esta configuración NO es desarrollo por cliente. Se define      │
│  una vez durante el discovery (Semana 1-2) en el dashboard de    │
│  administración y:                                               │
│                                                                  │
│  • Ajusta automáticamente los flujos de autorización             │
│  • Configura la visibilidad de datos entre sucursales            │
│  • Determina qué reportes se consolidan y cuáles se separan      │
│  • Ajusta los umbrales de alerta y escalamiento                  │
│  • Define la estructura de cuentas y RFC en Módulo 15            │
│                                                                  │
│  Cambiar una dimensión (ej. el grupo pasa de cuenta única a     │
│  cuenta por sucursal) es un cambio de configuración, no de      │
│  código. El sistema se adapta.                                   │
│                                                                  │
│  Esto es lo que permite que el discovery sea configuración y     │
│  no consultoría — y que el modelo escale sin que cada cliente    │
│  nuevo requiera ingeniería a medida.                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Roles y Lo Que Cada Uno Ve

### Los 7 roles del ecosistema Pulso

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ROL 1: OWNER / DUEÑO                                            │
│  ───────────────────                                             │
│  Dispositivo: Desktop, Tablet                                    │
│  Interfaz: Dashboard Web                                          │
│                                                                  │
│  Lo que ve:                                                      │
│  • Dashboard ejecutivo: todas las sucursales en una pantalla     │
│  • KPIs: compliance score, merma, ventas, horas extra, rotación  │
│  • KPIs financieros: P&L por sucursal, flujo de efectivo         │
│  • Alertas críticas: incidentes graves, riesgo de auditoría      │
│  • Alertas de control interno: pagos fuera de política,          │
│    proveedores sin validar, segregación de funciones violada     │
│  • Comparativas: sucursal vs sucursal, mes vs mes                │
│  • Reportes pre-auditoría NOM                                   │
│  • No ejecuta tareas. Monitorea, decide, escala.                 │
│                                                                  │
│  Frecuencia de uso: Diaria (5-10 min revisar dashboard)          │
│                      Semanal (revisión profunda)                  │
│                      Mensual (sesión de estrategia)               │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ROL 2: DIRECTOR DE OPERACIONES                                  │
│  ─────────────────────────────                                   │
│  Dispositivo: Desktop, Tablet, Móvil                             │
│  Interfaz: Dashboard Web + Notificaciones WhatsApp               │
│                                                                  │
│  Lo que ve:                                                      │
│  • Todo lo del Owner, más:                                       │
│  • Detalle por sucursal: empleados, turnos, incidentes activos   │
│  • Workflows corporativos: crear, modificar, asignar             │
│  • Reportes detallados: inventario, laboral, compliance          │
│  • Gestión financiera: cuentas por pagar, flujo de efectivo,     │
│    autorización de gastos por nivel                               │
│  • Escalamiento de incidentes graves (el sistema le notifica)    │
│  • Gestión de playbooks y estándares                             │
│  • Playbook de apertura de nueva sucursal                        │
│                                                                  │
│  Frecuencia de uso: Diaria (gestión activa de operaciones)       │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ROL 3: GERENTE DE SUCURSAL                                      │
│  ─────────────────────────                                       │
│  Dispositivo: Móvil (principal), Tablet                          │
│  Interfaz: WhatsApp (ejecución) + Dashboard Web (gestión)        │
│                                                                  │
│  Lo que ve:                                                      │
│  • Dashboard de su sucursal: KPIs, tareas, incidentes            │
│  • Workflows asignados a su sucursal                             │
│  • Estado de cada tarea: completada, pendiente, vencida          │
│  • Alertas de su sucursal: stock bajo, documento por vencer      │
│  • Equipo: asistencia, turnos, descansos, vacaciones             │
│  • Inventario de su sucursal                                     │
│  • Ventas del día, caja chica, gastos operativos de su sucursal  │
│  • Arqueo de caja y corte de ventas diario                       │
│                                                                  │
│  Frecuencia de uso: Constante durante el turno                   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ROL 4: SUPERVISOR DE ÁREA                                       │
│  ────────────────────────                                        │
│  Dispositivo: Móvil                                              │
│  Interfaz: WhatsApp (principal) + Web (reportes)                 │
│                                                                  │
│  Lo que ve:                                                      │
│  • Tareas de su área (cocina, barra, salón, almacén)             │
│  • Checklists asignados                                          │
│  • Evidencia requerida: fotos, lecturas, firmas                  │
│  • Alertas de su área                                            │
│                                                                  │
│  Frecuencia de uso: Múltiples veces por turno                    │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ROL 5: EMPLEADO DE PISO                                         │
│  ─────────────────────                                           │
│  Dispositivo: Móvil personal                                     │
│  Interfaz: Exclusivamente WhatsApp                               │
│                                                                  │
│  Lo que ve:                                                      │
│  • Notificaciones de tareas asignadas                            │
│  • Instrucciones simples: qué hacer, cómo, evidencia requerida   │
│  • Confirmación de tarea completada                              │
│  • Recordatorios si no completa a tiempo                         │
│  • Reconocimiento por buen desempeño sostenido                   │
│  • NUNCA ve el dashboard web. No necesita cuenta.                │
│                                                                  │
│  Frecuencia de uso: Cuando recibe una tarea (push)               │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ROL 6: EXTERNOS (Contador, Proveedor, Auditor)                  │
│  ─────────────────────────────────────────                       │
│  Dispositivo: Web                                                │
│  Interfaz: Portal limitado + Reportes exportables                │
│                                                                  │
│  Lo que ve:                                                      │
│  • Reportes específicos a su función                             │
│  • Exportación de datos (CSV, PDF)                               │
│  • Acceso limitado por permiso y sucursal                        │
│  • Contador: pólizas contables generadas automáticamente,        │
│    reportes de CFDI emitidos y recibidos                         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ROL 7: CHEF CORPORATIVO / GERENTE DE CALIDAD                    │
│  ─────────────────────────────────────────────                   │
│  Dispositivo: Móvil + Tablet                                     │
│  Interfaz: Dashboard Web + Notificaciones WhatsApp               │
│                                                                  │
│  Lo que ve:                                                      │
│  • Dueño del Módulo 6 (Recetas y Costeo): aprueba cambios de    │
│    receta, estandariza porciones, actualiza costeos              │
│  • Revisa evidencia de Muestreo de Calidad (workflow existente   │
│    en Módulo 1) entre todas las sucursales                       │
│  • Aprueba nuevos platillos antes de que se activen en el menú   │
│    de todas las sucursales                                       │
│  • Recibe alertas cuando una sucursal se desvía del estándar     │
│    de preparación (fotos comparativas, scoring de calidad)       │
│  • Dashboard de calidad cross-sucursal: consistencia de          │
│    porciones, presentación, temperaturas de servicio             │
│  • Digital Twin de recetas: la sucursal #6 hereda las recetas    │
│    y estándares de la sucursal con mejor desempeño               │
│                                                                  │
│  Frecuencia de uso: Diaria (revisión de muestreo),               │
│                      Semanal (ajuste de recetas y menú)           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Módulos Completos del Sistema

### Los 17 módulos que cubren la operación completa del grupo

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  MÓDULO 1: WORKFLOW ENGINE (Núcleo del sistema)                  │
│  ─────────────────────────────────────────                       │
│                                                                  │
│  Propósito: Orquestar toda tarea operativa.                      │
│                                                                  │
│  • Workflows pre-construidos para HORECA (15+ templates)          │
│  • Asignación automática por sucursal, rol, turno                │
│  • Secuencias con dependencias (paso 2 solo si paso 1 OK)        │
│  • Evidencia requerida por paso: foto, lectura numérica, texto   │
│  • Verificación AI de evidencia (¿la foto muestra lo que debe?)  │
│  • Escalamiento automático si no se completa a tiempo            │
│  • Workflows recurrentes: diarios, semanales, mensuales          │
│  • Workflows disparados por eventos: incidente, auditoría        │
│                                                                  │
│  Templates incluidos:                                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ APERTURA DE SUCURSAL                                      │   │
│  │ • 27 pasos, 4 responsables, 35 min objetivo               │   │
│  │ • Verificación de temperaturas, encendido de equipos,     │   │
│  │   revisión de áreas, preparación de estaciones            │   │
│  │                                                           │   │
│  │ CIERRE DE SUCURSAL                                        │   │
│  │ • 34 pasos, 5 responsables, 45 min objetivo               │   │
│  │ • Arqueo de caja, limpieza profunda, apagado de equipos,  │   │
│  │   revisión de inventario faltante, cierre de bitácoras    │   │
│  │   Incluye: envío de corte de ventas (POS) vía WhatsApp    │   │
│  │   o validación automática si ya se recibió por correo     │   │
│  │                                                           │   │
│  │ LIMPIEZA NOM-251                                          │   │
│  │ • 28 pasos por área, frecuencia variable                  │   │
│  │ • Cocina: campanas, freidora, plancha, trampas de grasa   │   │
│  │ • Almacén: refrigeradores, congeladores, anaqueles        │   │
│  │ • Baños: lavabos, inodoros, pisos, dispensadores          │   │
│  │ • Salón: mesas, sillas, barras, ventanas                  │   │
│  │                                                           │   │
│  │ RECEPCIÓN DE MERCANCÍA                                    │   │
│  │ • 15 pasos, 1 responsable                                 │   │
│  │ • Verificar vs orden de compra, pesar/contar, registrar   │   │
│  │   temperaturas, fotos de producto recibido, rechazo       │   │
│  │   automático si no cumple especificaciones                │   │
│  │                                                           │   │
│  │ CONTROL DE TEMPERATURAS                                   │   │
│  │ • 3-4 veces/día, todas las áreas de frío/calor            │   │
│  │ • Lectura numérica con foto del termómetro                │   │
│  │ • Alerta automática si fuera de rango                     │   │
│  │ • Historial completo para auditoría NOM                   │   │
│  │                                                           │   │
│  │ TRAZABILIDAD DE ALIMENTOS                                 │   │
│  │ • Registro de lote, fecha de recepción, fecha de caducidad│   │
│  │ • Alerta de producto por caducar (3, 7, 14 días)          │   │
│  │ • Retiro automático de producto caducado                  │   │
│  │                                                           │   │
│  │ MANTENIMIENTO PREVENTIVO DE EQUIPO                        │   │
│  │ • Calendario por equipo: refrigeradores, freidoras, etc.  │   │
│  │ • Checklist de mantenimiento con foto                     │   │
│  │ • Alerta de servicio programado no realizado              │   │
│  │                                                           │   │
│  │ INCIDENTE / NO CONFORMIDAD                                │   │
│  │ • Disparado manual o automático                           │   │
│  │ • Documentación del incidente: qué, dónde, evidencia      │   │
│  │ • Plan de acción inmediato                                │   │
│  │ • Escalamiento por severidad                              │   │
│  │ • Seguimiento hasta cierre                               │   │
│  │                                                           │   │
│  │ CAMBIO DE TURNO                                           │   │
│  │ • Checklist de entrega/recepción entre turnos             │   │
│  │ • Novedades, pendientes, incidentes del turno saliente    │   │
│  │ • Firma de conformidad de ambos gerentes                  │   │
│  │                                                           │   │
│  │ CAPACITACIÓN DE NUEVO INGRESO                             │   │
│  │ • Onboarding estructurado por puesto                      │   │
│  │ • Videos, guías, checklists de aprendizaje                │   │
│  │ • Verificación de competencias (el empleado demuestra)    │   │
│  │ • Aprobación del gerente                                  │   │
│  │                                                           │   │
│  │ AUDITORÍA INTERNA                                         │   │
│  │ • Checklist completo NOM-251 + NOM-035                    │   │
│  │ • Scoring automático por área                             │   │
│  │ • Plan de remediación generado automáticamente            │   │
│  │ • Historial de auditorías y mejora continua               │   │
│  │                                                           │   │
│  │ MUESTREO DE CALIDAD DE ALIMENTOS                          │   │
│  │ • Toma de muestras periódicas                             │   │
│  │ • Registro de temperaturas de cocción y conservación      │   │
│  │ • Vida de anaquel por producto preparado                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 2: COMPLIANCE NORMATIVO                                  │
│  ─────────────────────────────                                   │
│                                                                  │
│  Propósito: Blindaje regulatorio. Evidencia organizada para      │
│  auditorías de COFEPRIS, IMSS, STPS.                             │
│                                                                  │
│  • NOM-251-SSA1-2009: Prácticas de higiene para alimentos        │
│  • NOM-035-STPS-2018: Factores de riesgo psicosocial             │
│  • LFT: Cumplimiento laboral (jornadas, descansos, horas extra)  │
│  • IMSS: Altas, bajas, modificaciones de salario                 │
│  • Protección Civil: Simulacros, extintores, salidas             │
│                                                                  │
│  Funcionalidades:                                                │
│  • Generación automática de bitácoras (temperaturas, limpieza)   │
│  • Reporte pre-auditoría: "si COFEPRIS llega hoy, esto es lo     │
│    que necesitas mostrar"                                        │
│  • Score de compliance por sucursal y área                       │
│  • Predicción de riesgo de auditoría                             │
│  • Plan de remediación automático cuando el score baja           │
│  • Historial probatorio: quién, qué, cuándo, evidencia           │
│  • Documentos de empleados: contratos, altas IMSS, expedientes   │
│  • Alertas de vencimiento: certificados médicos, capacitaciones  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 3: INVENTARIO Y ALMACÉN                                  │
│  ─────────────────────────────                                   │
│                                                                  │
│  Propósito: Control de merma, costo de alimentos, trazabilidad.  │
│                                                                  │
│  • Catálogo de productos con unidad de medida                    │
│  • Conteos cíclicos programados (diario, semanal, mensual)       │
│  • Conteo de inventario completo (mensual)                       │
│  • Registro de entradas: órdenes de compra → recepción           │
│  • Registro de salidas: consumo teórico vs real                  │
│  • Recetas estandarizadas con pesos y porciones                  │
│  • Costeo de platillos automático (precio de insumo → costo)     │
│  • Theoretical vs Actual: ¿cuánta merma hay y dónde?             │
│  • Alertas de stock bajo y stock crítico                         │
│  • Transferencias entre sucursales                               │
│  • Trazabilidad de lotes y caducidad                             │
│  • Merma autorizada vs no autorizada                             │
│  • Dashboard de costo de alimentos por sucursal                  │
│  • Segmentación de merma por canal de venta: salón / delivery    │
│    / eventos — no solo por sucursal, sino dónde en el flujo      │
│    de venta se origina la pérdida                                │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 4: GESTIÓN LABORAL                                       │
│  ───────────────────────                                         │
│                                                                  │
│  Propósito: Administración completa del personal multi-sucursal. │
│                                                                  │
│  • Plantilla de empleados con rol, sucursal base, costo          │
│  • Control de asistencia: entradas, salidas, retardos            │
│  • Gestión de turnos: asignación semanal, rotación               │
│  • Solicitud y aprobación de cambios de turno                    │
│  • Vacaciones, descansos, permisos, incapacidades                │
│  • Horas extra: registro, autorización, límites LFT              │
│  • Nómina: cálculo automático (sueldo base + extras - ausencias) │
│  • Propinas: distribución configurable                           │
│  • Rotación de personal por sucursal                             │
│  • Documentos de empleados: contratos, identificaciones, etc.    │
│  • Vencimientos: certificados médicos, cursos, visas             │
│  • Expediente digital completo por empleado                      │
│  • Dashboard de costo laboral por sucursal                       │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 5: EQUIPAMIENTO Y MANTENIMIENTO                          │
│  ─────────────────────────────────────                           │
│                                                                  │
│  Propósito: Inventario de equipos, mantenimiento preventivo,     │
│  bitácora de reparaciones.                                       │
│                                                                  │
│  • Catálogo de equipos por sucursal (marca, modelo, serie)       │
│  • Calendario de mantenimiento preventivo por equipo             │
│  • Registro de mantenimientos realizados (fecha, técnico, foto)  │
│  • Solicitud de reparación (gerente reporta falla)               │
│  • Cotizaciones y aprobaciones de reparación                     │
│  • Historial completo por equipo                                 │
│  • Alerta de equipo sin mantenimiento                            │
│  • Costo de mantenimiento por sucursal y por equipo              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 6: RECETAS Y COSTEO                                     │
│  ─────────────────────────                                       │
│                                                                  │
│  Propósito: Estandarización de platillos, control de porciones,  │
│  cálculo de costo real y margen.                                 │
│                                                                  │
│  • Receta maestra por platillo (ingredientes, cantidades, merma) │
│  • Sub-recetas (preparaciones base, salsas, fondos)              │
│  • Costeo automático: precio de insumo → costo por porción       │
│  • Precio de venta sugerido según margen objetivo                │
│  • Comparativa: costo teórico vs costo real por período          │
│  • Actualización masiva de costos cuando sube un insumo           │
│  • Ingeniería de menú: matriz rentabilidad vs popularidad        │
│  • Cruce automático con Módulo 13 (Ventas): costo teórico del    │
│    menú vendido esta semana vs. consumo real de inventario —     │
│    cálculo de merma real sin depender solo de conteo físico      │
│    mensual como único punto de verdad                            │
│  • Dueño del módulo: Chef Corporativo (Rol 7)                    │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 7: COMPRAS Y PROVEEDORES                                 │
│  ────────────────────────────────                                │
│                                                                  │
│  Propósito: Gestión de órdenes de compra, proveedores,           │
│  recepción y cuentas por pagar.                                  │
│                                                                  │
│  • Catálogo de proveedores por categoría                         │
│  • Órdenes de compra (manuales o sugeridas por stock bajo)       │
│  • Aprobación de órdenes (gerente → director ops → dueño)        │
│  • Recepción de mercancía con verificación (workflow conectado)  │
│  • Comparativa: ordenado vs recibido vs facturado                │
│  • Historial de precios por proveedor e insumo                   │
│  • Cuentas por pagar y vencimientos                              │
│  • Sugerencia automática de compra basada en consumo y stock     │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 8: INCIDENTES Y REMEDIACIÓN                              │
│  ─────────────────────────────────                               │
│                                                                  │
│  Propósito: Capturar, escalar, resolver y aprender de cada       │
│  incidente operativo.                                            │
│                                                                  │
│  • Tipos: calidad, seguridad, cliente, empleado, compliance,     │
│    equipo, proveedor, otro                                       │
│  • Severidad: bajo, medio, alto, crítico                         │
│  • Captura rápida (WhatsApp o web) con foto y descripción        │
│  • Escalamiento automático por tipo y severidad                  │
│  • Asignación de responsable y deadline                          │
│  • Plan de acción (acciones inmediatas + acciones correctivas)   │
│  • Seguimiento: estado, comentarios, evidencia de cierre         │
│  • Dashboard de incidentes por sucursal, tipo, período           │
│  • Patrones: ¿qué incidentes se repiten? ¿dónde?                 │
│  • Vinculado a workflows de remediación automáticos              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 9: COMUNICACIONES INTERNAS                               │
│  ────────────────────────────────                                │
│                                                                  │
│  Propósito: Canal oficial de comunicación del grupo.             │
│                                                                  │
│  • Anuncios del grupo (owner → todos los empleados)              │
│  • Comunicados por sucursal (director ops → sucursal)            │
│  • Mensajes de gerente a su equipo                               │
│  • Confirmación de lectura                                       │
│  • Adjuntos: PDFs, imágenes, videos                              │
│  • Historial y buscador                                          │
│  • Entrega multicanal: notificación push + WhatsApp + email      │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 10: REPORTES Y ANALYTICS                                 │
│  ───────────────────────────────                                 │
│                                                                  │
│  Propósito: Visibilidad total de la operación en tiempo real.    │
│                                                                  │
│  • Dashboard ejecutivo multi-sucursal (owner/director)           │
│  • Dashboard de sucursal (gerente)                               │
│  • Reportes programados automáticos (diario, semanal, mensual)   │
│  • KPIs: compliance, merma, laboral, incidentes, ejecución       │
│  • KPIs financieros: P&L por sucursal, flujo de efectivo,        │
│    costo de alimentos como % de venta                             │
│  • Tendencias y comparativas (mes vs mes, suc vs suc)            │
│  • Exportación: PDF, CSV, Excel                                  │
│  • Reportes regulatorios: bitácoras NOM, SUA IMSS, IDSE          │
│  • Predicciones: riesgo de auditoría, rotación, merma futura     │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 11: NOTIFICACIONES MULTICANAL                            │
│  ──────────────────────────────────                              │
│                                                                  │
│  Propósito: Que nada se pierda. La persona correcta recibe       │
│  la alerta correcta en el momento correcto.                      │
│                                                                  │
│  • Canales: WhatsApp, Email, In-App, Push                       │
│  • Templates pre-configurados por tipo de evento                 │
│  • Preferencias de notificación por usuario                      │
│  • Escalamiento: si no responde en X tiempo → siguiente nivel    │
│  • Quiénes reciben qué: configuración por rol y por grupo        │
│                                                                  │
│  Tipos de notificación:                                          │
│  • Tarea asignada o próxima a vencer                             │
│  • Tarea vencida (escalada)                                      │
│  • Incidente creado o escalado                                   │
│  • Stock bajo o crítico                                          │
│  • Documento por vencer                                          │
│  • Empleado ausente sin registro                                 │
│  • Anuncio del grupo                                             │
│  • Reporte semanal/mensual listo                                 │
│  • Compliance score bajó del umbral                              │
│  • Predicción de riesgo (auditoría, incidente)                   │
│  • Corte de ventas no recibido (recordatorio de cierre)          │
│  • Factura no conciliada con recepción de mercancía              │
│  • Gasto pendiente de autorización                               │
│  • Vencimiento de cuenta por pagar                               │
│  • Alerta de control interno: segregación violada,               │
│    proveedor nuevo sin validar                                   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 12: ADMINISTRACIÓN DEL SISTEMA                           │
│  ──────────────────────────────────                              │
│                                                                  │
│  Propósito: Configuración del tenant, permisos, integraciones.   │
│                                                                  │
│  • Gestión de sucursales (agregar, modificar, desactivar)        │
│  • Gestión de usuarios y roles                                   │
│  • Permisos granulares por módulo, sucursal y acción             │
│  • Integraciones: POS, nómina, contabilidad (API/export)         │
│  • Configuración de playbooks corporativos                        │
│  • Configuración de horarios, zonas horarias, festivos           │
│  • Auditoría de actividad en el sistema (quién hizo qué)         │
│  • Suscripción y facturación                                     │
│  • Configuración de plantillas de mapeo de POS por cliente       │
│  • Configuración de políticas de autorización de gastos          │
│  • Configuración de matriz de segregación de funciones           │
│  • Configuración de tiers y empaquetamiento                      │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 13: VENTAS Y POS                                         │
│  ────────────────────                                            │
│                                                                  │
│  Propósito: Sin datos de venta, todo lo demás — merma, costo     │
│  laboral, costo de alimentos — son números sueltos sin           │
│  denominador. Este módulo convierte "gastamos X" en               │
│  "gastamos X, que es Y% de la venta."                            │
│                                                                  │
│  Decisión de arquitectura: ingesta por archivo, no API.          │
│  ─────────────────────────────────────────────                   │
│  Construir integraciones directas contra cada POS es caro y      │
│  lento. En lugar de eso, Pulso se alimenta del corte de ventas   │
│  (Excel/CSV) que el POS ya genera todos los días.                │
│                                                                  │
│  Canales de ingesta:                                             │
│  • Adjunto en WhatsApp: en el mismo hilo donde el gerente hace   │
│    el cierre de sucursal — cero herramienta nueva                 │
│  • Buzón de correo con copia (CC): el cliente agrega             │
│    ventas-[sucursal]@pulso.mx en copia del correo automático     │
│    que el POS ya envía — cero fricción, cero cambio de hábito    │
│  • Upload manual en dashboard: respaldo cuando no llega por      │
│    los otros dos canales                                         │
│                                                                  │
│  Procesamiento:                                                  │
│  • Plantilla de mapeo de columnas por tipo de POS, configurada   │
│    una sola vez durante onboarding — no desarrollo por cliente   │
│  • Librería de parsers por sistema que se acumula con el tiempo  │
│  • Validación automática: totales razonables, categorías         │
│    esperadas presentes, nada en cero inesperado                  │
│                                                                  │
│  Integración al cierre de sucursal (Módulo 1):                   │
│  • Workflow de cierre → arqueo de caja → "Ventas del día         │
│    registradas" ✓ (automático si ya llegó el archivo)            │
│  • Si no se ha recibido: recordatorio en WhatsApp al gerente     │
│  • Si pasa tiempo límite: escala igual que tarea vencida         │
│                                                                  │
│  Fallback para el cliente más chico:                             │
│  • Formulario corto por WhatsApp (venta total, efectivo vs.      │
│    tarjeta, número de tickets) — suficiente para cruces básicos  │
│                                                                  │
│  Datos que alimenta:                                             │
│  • Venta por sucursal, por turno, por categoría de menú          │
│  • Ticket promedio, número de tickets                            │
│  • Cruce automático: costo de alimentos real (Módulo 3) vs.      │
│    % de venta — el KPI que el dueño realmente revisa             │
│  • Cruce automático: costo laboral (Módulo 4) vs. % de venta     │
│  • Alertas de desviación: "costo de alimentos subió a 34% de     │
│    venta esta semana (objetivo: 28-30%)"                         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 14: DELIVERY Y AGREGADORES                               │
│  ───────────────────────────────                                 │
│                                                                  │
│  Propósito: Uber Eats, Rappi y DiDi Food representan una         │
│  porción significativa de la venta. Pero en vez de integrarse    │
│  vía API a cada plataforma (costoso, frágil), el dato de venta   │
│  delivery entra por el mismo canal que todo lo demás: el POS.    │
│                                                                  │
│  Por qué sin API:                                                │
│  ────────────────                                                │
│  La práctica estándar en el sector es configurar cada agregador  │
│  como una forma de pago en el POS ("Rappi", "Uber Eats", "DiDi   │
│  Food"). Cuando llega un pedido, se ingresa al POS como una     │
│  venta normal con esa forma de pago. El corte diario del POS ya  │
│  contiene el desglose por forma de pago → el mismo archivo del   │
│  Módulo 13 ya trae la venta separada por canal de delivery, sin  │
│  una sola integración adicional.                                 │
│                                                                  │
│  Conciliación de comisiones:                                     │
│  ───────────────────────────                                     │
│  • Cada agregador envía su estado de cuenta (semanal o mensual)  │
│    con comisiones, reembolsos y depósitos                        │
│  • Ese reporte (PDF/CSV) se carga al sistema y se cruza contra   │
│    la venta registrada en el POS para ese canal                  │
│  • Resultado: rentabilidad real de delivery por plataforma       │
│    (venta bruta − comisión − impuestos agregador)                │
│                                                                  │
│  Merma específica de canal:                                      │
│  • Empaque, errores de preparación, cancelaciones — se miden     │
│    contra la venta delivery registrada en el POS                 │
│  • Segmentación automática en Módulo 3 (merma por canal)         │
│                                                                  │
│  Métricas por plataforma:                                        │
│  • Venta bruta, comisión, venta neta, % del total de ventas      │
│  • Ticket promedio delivery vs. salón                            │
│  • Cancelaciones y reembolsos por plataforma                     │
│  • Dashboard: rentabilidad real de delivery vs. salón            │
│    (después de comisión)                                         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 15: FISCAL Y FACTURACIÓN (CFDI vía FiscalAPI)            │
│  ───────────────────────────────────────────────────             │
│                                                                  │
│  Propósito: Conexión de datos operativos con la obligación       │
│  fiscal, con motor de timbrado propio vía FiscalAPI.              │
│                                                                  │
│  Por qué FiscalAPI:                                              │
│  • Multi-RFC y multi-empresa nativo — encaja con el modelo       │
│    multi-tenant de Pulso (un grupo, varias razones sociales)     │
│  • SDKs oficiales (Node.js, Python, PHP, Java, .NET)             │
│  • Soporte de complementos: nómina, pago, carta porte,           │
│    comercio exterior, impuestos locales                          │
│  • Genera PDF y envía XML/PDF por correo sin costo adicional     │
│                                                                  │
│  CFDI de nómina automatizado (conecta con Módulo 4):             │
│  • Pulso ya calcula la nómina de cada empleado                   │
│  • Emite el recibo de nómina timbrado directamente vía el        │
│    complemento de nómina de FiscalAPI                            │
│  • Sin depender de un proveedor externo de timbrado              │
│                                                                  │
│  Validación de compras (conecta con Módulo 7):                   │
│  • Consulta de estatus de CFDI ante el SAT                       │
│  • Cruce de compras registradas vs. facturas válidas recibidas   │
│  • Detección de compras sin factura                              │
│  • Detección de proveedores en listas negras del SAT             │
│                                                                  │
│  Conciliación automática de 3 vías                               │
│  (conecta Módulo 7 + workflow Recepción + Módulo 15):            │
│  • Descarga masiva de CFDI recibidos directamente del SAT        │
│  • Three-way match automático:                                   │
│    1. Orden de Compra (Módulo 7): cantidad y precio esperado     │
│    2. Recepción de Mercancía (workflow Módulo 1): lo que         │
│       físicamente llegó, con evidencia fotográfica               │
│    3. Factura recibida (vía descarga masiva SAT): se empareja    │
│       por proveedor, monto y fecha aproximada                    │
│  • Si coinciden → validado automáticamente                       │
│  • Si no coinciden → discrepancia para revisión (llegó menos     │
│    de lo facturado, precio no cuadra, o nunca llegó factura)     │
│                                                                  │
│  Cuentas por pagar como consecuencia:                            │
│  • Una vez conciliada la factura, entra al calendario de pagos   │
│    con fecha de vencimiento                                      │
│  • Alertas de vencimientos próximos                              │
│                                                                  │
│  Alcance futuro (no MVP):                                        │
│  • Emisión de facturas de venta a clientes corporativos          │
│    (eventos, catering) directamente desde Pulso                  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 16: PAGOS Y GASTOS                                       │
│  ───────────────────────                                         │
│                                                                  │
│  Propósito: Registrar todo lo que realmente sale de la cuenta.   │
│  Cubre gasto operativo que no pasa por orden de compra de        │
│  inventario: renta, luz, agua, gas, internet, mantenimiento no   │
│  catalogado, publicidad, servicios profesionales, caja chica.    │
│                                                                  │
│  Sin esto, el P&L de cada sucursal queda incompleto.             │
│                                                                  │
│  Registro y ejecución de pagos:                                  │
│  • Pago vinculado a factura conciliada (Módulo 15): al           │
│    ejecutarse, dispara automáticamente el complemento de pago    │
│    CFDI vía FiscalAPI                                            │
│  • Gasto operativo sin factura de por medio: registro directo    │
│    por categoría (renta, servicios, mantenimiento, publicidad)   │
│                                                                  │
│  Caja chica por sucursal:                                        │
│  • Fondo fijo por sucursal                                       │
│  • Registro de salidas con evidencia (foto de ticket)            │
│  • Reposición automática cuando baja del umbral                  │
│  • Reemplaza la libreta física                                   │
│                                                                  │
│  Niveles de autorización por monto:                              │
│  • Gasto menor → gerente de sucursal aprueba                     │
│  • Gasto mayor → escala a Director de Operaciones o al Owner     │
│  • Reutiliza el motor de escalamiento de Módulo 11               │
│                                                                  │
│  Flujo de efectivo:                                              │
│  • Calendario consolidado: cuentas por pagar + gastos            │
│    operativos + nómina, por sucursal y por grupo                 │
│  • Vista de "lo que sale esta semana / este mes"                 │
│  • Alertas de concentración de vencimientos                      │
│                                                                  │
│  Categorización para P&L real por sucursal:                      │
│  • Cada gasto etiquetado por categoría contable estándar         │
│  • Permite utilidad operativa estimada por sucursal              │
│    (venta − costo de alimentos − laboral − gastos operativos)    │
│                                                                  │
│  Nota: no reemplaza al contador. Es captura estructurada del     │
│  gasto real para que el dueño tenga visibilidad y el contador    │
│  reciba información ya clasificada.                              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MÓDULO 17: CONTABILIDAD Y CONTROL INTERNO                       │
│  ───────────────────────────────────────                         │
│                                                                  │
│  Propósito: Traducir eventos operativos a contabilidad formal    │
│  (pólizas) e implementar controles estructurales contra el       │
│  fraude, no solo evidencia posterior.                            │
│                                                                  │
│  Generación automática de pólizas:                               │
│  • Cada evento financiero (compra conciliada, pago ejecutado,    │
│    nómina timbrada, venta del día) genera su póliza de diario    │
│  • Exportable en formato compatible con CONTPAQi, Aspel o CSV    │
│    estructurado para el despacho contable                        │
│  • Cierra el círculo entre "lo que pasó en la sucursal" y        │
│    "lo que dice la contabilidad"                                 │
│                                                                  │
│  Segregación de funciones (control anti-fraude estructural):     │
│  • Configurable: quien crea una OC no puede ser quien recibe     │
│    la mercancía; quien aprueba un pago no puede ejecutarlo       │
│  • En grupos chicos (3-5 sucursales): doble autorización en      │
│    vez de segregación estricta                                   │
│                                                                  │
│  Bitácora de auditoría:                                          │
│  • Cada autorización, cambio de monto, aprobación queda          │
│    registrada con responsable, timestamp y motivo                │
│  • Nada se puede editar sin dejar rastro                         │
│                                                                  │
│  Reporte de excepciones:                                         │
│  • Pagos fuera de política o de monto inusual                    │
│  • Proveedores nuevos sin validación previa                      │
│  • Gastos recurrentes que suben sin explicación                  │
│  • Órdenes de compra aprobadas y recibidas por la misma persona  │
│                                                                  │
│  Nota: no sustituye una auditoría financiera formal. Da          │
│  visibilidad estructural y controles preventivos.                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Workflow: Apertura de Nueva Sucursal

### Cómo la sucursal #6 hereda la memoria de la #1

> **Principio:** la sucursal nueva no empieza de cero. Hereda playbooks, recetas, proveedores, estándares de compliance y el Digital Twin de la sucursal con mejor desempeño del grupo. Esto convierte la promesa de la tesis en un producto concreto y vendible — y cubre el momento de mayor riesgo operativo y mayor oportunidad comercial.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  PLAYBOOK DE PRE-APERTURA (~60-90 DÍAS ANTES DE ABRIR)           │
│  ───────────────────────────────────────────────────             │
│                                                                  │
│  ┌────────────────┬──────────────────────────────────────────┐  │
│  │ FASE           │ CONTENIDO                                │  │
│  ├────────────────┼──────────────────────────────────────────┤  │
│  │ Legal y        │ Checklist de licencias, permisos de uso  │  │
│  │ permisos       │ de suelo, protección civil, COFEPRIS     │  │
│  │                │ Responsable: Director Ops                │  │
│  ├────────────────┼──────────────────────────────────────────┤  │
│  │ Montaje físico │ Checklist de instalación de equipo,      │  │
│  │                │ verificación de instalaciones (gas,      │  │
│  │                │ refrigeración, extracción)               │  │
│  │                │ Responsable: Director Ops + Proveedores  │  │
│  ├────────────────┼──────────────────────────────────────────┤  │
│  │ Reclutamiento  │ Plantilla objetivo, workflow de          │  │
│  │                │ capacitación de nuevo ingreso aplicado   │  │
│  │                │ a todo el equipo inicial                 │  │
│  │                │ Responsable: Gerente entrante            │  │
│  ├────────────────┼──────────────────────────────────────────┤  │
│  │ Herencia de    │ Digital Twin de la sucursal con mejor    │  │
│  │ estándar       │ desempeño se clona como punto de partida:│  │
│  │                │ mismas recetas, mismos playbooks, mismo  │  │
│  │                │ compliance score objetivo                │  │
│  │                │ Responsable: Sistema (automático) +      │  │
│  │                │ Chef Corporativo                         │  │
│  ├────────────────┼──────────────────────────────────────────┤  │
│  │ Soft opening   │ Periodo de operación supervisada con     │  │
│  │                │ checklist reforzado y frecuencia de      │  │
│  │                │ verificación mayor a la normal           │  │
│  │                │ Responsable: Gerente + Supervisor Ops    │  │
│  ├────────────────┼──────────────────────────────────────────┤  │
│  │ Transición a   │ El sistema reduce automáticamente la     │  │
│  │ operación      │ frecuencia de verificación conforme el   │  │
│  │ normal         │ compliance score se estabiliza sobre     │  │
│  │                │ el umbral objetivo                       │  │
│  │                │ Responsable: Sistema (automático)        │  │
│  └────────────────┴──────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. El Día de Operación en Una Sucursal

### Cómo corre una sucursal con Pulso — 24 horas

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  5:45 AM — ANTES DE ABRIR                                        │
│  ─────────────────────────                                       │
│  El sistema envía el workflow "Apertura Centro" a los            │
│  responsables del turno matutino vía WhatsApp.                   │
│                                                                  │
│  • Juan (gerente) recibe: checklist de apertura, 27 pasos       │
│  • María (cocinera) recibe: verificación de refrigeradores       │
│  • Pedro (mesero) recibe: preparación de salón                   │
│                                                                  │
│  6:00 AM                                                        │
│  ───────                                                        │
│  María toma foto del termómetro del refrigerador #2: 3°C.        │
│  Pulso AI verifica: "temperatura dentro de rango. OK."           │
│                                                                  │
│  Juan revisa la trampa de grasa, toma foto, registra estado.     │
│  Pulso detecta: "La trampa muestra acumulación. Se recomienda    │
│  programar limpieza esta semana."                                │
│                                                                  │
│  6:30 AM                                                        │
│  ───────                                                        │
│  Apertura completada. 31 min (objetivo: 35). OK.                 │
│  Sistema registra: checklist 100%, 1 observación (trampa grasa). │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  9:00 AM — OPERACIÓN                                             │
│  ─────────────────                                               │
│  Recepción de mercancía. Workflow "Recepción" se dispara.        │
│                                                                  │
│  Juan verifica contra orden de compra:                           │
│  • Pollo: 45kg pedidos, 43kg recibidos → registra desviación     │
│  • Jitomate: 20kg pedidos, 20kg recibidos, calidad OK → foto    │
│  • Aguacate: 15kg pedidos, 8kg recibidos (proveedor incompleto)  │
│                                                                  │
│  Sistema actualiza inventario automáticamente.                   │
│  Registra incidencia con proveedor para seguimiento.             │
│                                                                  │
│  11:00 AM                                                        │
│  ───────                                                        │
│  Segunda ronda de temperaturas. Todo OK.                         │
│                                                                  │
│  12:00 PM                                                        │
│  ───────                                                        │
│  Inventario cíclico rápido: proteínas.                           │
│  Juan cuenta: pollo 38kg (sistema espera 42 según recetas).      │
│  Desviación: -4kg (~$480 MXN). Sistema lo marca como merma.     │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  2:00 PM — CAMBIO DE TURNO                                       │
│  ─────────────────────────                                       │
│  Workflow "Cambio de Turno Matutino → Vespertino."               │
│                                                                  │
│  Juan (saliente) reporta:                                        │
│  • Una incidencia: proveedor incompleto (aguacate)               │
│  • Un pendiente: limpieza de trampa de grasa                     │
│  • Consumo de insumos del turno                                  │
│                                                                  │
│  Carlos (entrante) recibe y firma conformidad.                   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  3:00 PM — TARDE                                                 │
│  ─────────────                                                   │
│  Carlos ejecuta workflow de limpieza programada.                  │
│  Fotos de cada área limpia. Pulso AI verifica.                   │
│                                                                  │
│  5:00 PM                                                        │
│  ───────                                                        │
│  Tercera ronda de temperaturas. Refrigerador #2: 7°C.            │
│  ⚠️ Fuera de rango (máx 5°C).                                     │
│                                                                  │
│  Pulso inmediatamente:                                           │
│  • Alerta a Carlos (WhatsApp): "⚠️ Refrigerador #2 fuera de rango."│
│  • Crea incidente automático                                     │
│  • Carlos revisa, encuentra puerta mal cerrada. Corrige.         │
│  • Nueva lectura en 30 min: 4°C. OK. Cierra incidente.          │
│                                                                  │
│  Pulso registra patrón: "Segunda vez en el mes que refrigerador  │
│  #2 sale de rango en turno vespertino."                          │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  10:00 PM — CIERRE                                              │
│  ────────────────                                                │
│  Workflow "Cierre Centro" se dispara. 34 pasos.                  │
│                                                                  │
│  • Arqueo de caja (foto de corte)                                │
│  • Adjuntar corte de ventas del POS (foto/archivo)               │
│  • Limpieza profunda de cocina                                   │
│  • Conteo de inventario final del día                            │
│  • Apagado de equipos                                            │
│  • Revisión de puertas, ventanas, alarmas                        │
│                                                                  │
│  11:00 PM                                                        │
│  ───────                                                        │
│  Cierre completado. 49 min (objetivo: 45). OK.                   │
│  Sistema genera resumen del día para el gerente y director:      │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ RESUMEN DIARIO — SUCURSAL CENTRO — 14 JULIO 2026          │   │
│  │                                                           │   │
│  │ Workflows:         4/4 completados                        │   │
│  │ Tareas:            58/61 completadas (95%)                │   │
│  │ Incidentes:        2 (proveedor incompleto, refrig.#2)    │   │
│  │ Compliance score:  92/100 ⚠️ (refrigerador fuera de rango)│   │
│  │ Merma reportada:   Pollo -4kg ($480)                      │   │
│  │ Horas extra:       0                                       │   │
│  │ Asistencia:        6/6 empleados presentes                 │   │
│  │ Venta del día:     $34,580 (corte recibido ✓)             │   │
│  │ Caja chica:        $180 gastado (2 tickets)               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. El Grupo: Gobernanza Multi-Sucursal

### Lo que el Owner y Director de Operaciones ven y hacen

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  VISIÓN CONSOLIDADA (Dashboard Ejecutivo)                        │
│  ────────────────────────────────────────                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ GRUPO "TAQUERÍA EL PARIÁN" — 5 SUCURSALES                 │   │
│  │                                                           │   │
│  │  ┌─────────┬─────────┬─────────┬─────────┬─────────┐     │   │
│  │  │ Centro  │San Pedro│  Valle  │ Cumbres │ Contry  │     │   │
│  │  │  ████░  │  █████  │  ███░░  │  ████░  │  ██░░░  │     │   │
│  │  │   92    │   97    │   78⚠️  │   91    │   65🔴  │     │   │
│  │  └─────────┴─────────┴─────────┴─────────┴─────────┘     │   │
│  │                                                           │   │
│  │  Incidentes activos:  3                                   │   │
│  │  Tareas vencidas hoy: 7 (Contry: 5, Valle: 2)             │   │
│  │  Merma promedio:      8.2% (objetivo: <7%)                │   │
│  │  Compliance general:  84.6/100                            │   │
│  │  Horas extra mes:     34 (límite LFT sin exceder)         │   │
│  │  Rotación trimestral: 22% (subió 3pp vs trimestre ant.)   │   │
│  │  Costo alimentos:     31.2% de venta (objetivo: 28-30%)   │   │
│  │  Costo laboral:       27.5% de venta                      │   │
│  │  Utilidad op. est.:   $142,300 (todas las sucursales)     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  GOBERNANZA CORPORATIVA                                          │
│  ──────────────────────                                          │
│                                                                  │
│  El grupo define una vez. Las sucursales ejecutan.               │
│                                                                  │
│  PLAYBOOKS CORPORATIVOS:                                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ El Director de Ops crea/modifica un playbook:              │   │
│  │                                                           │   │
│  │ "Apertura de Sucursal v2.3"                               │   │
│  │                                                           │   │
│  │ Se publica → automáticamente disponible en TODAS las      │   │
│  │ sucursales. Los gerentes reciben notificación de cambio.  │   │
│  │                                                           │   │
│  │ Si una sucursal necesita una variante (ej: San Pedro      │   │
│  │ tiene equipo distinto), se crea una excepción autorizada. │   │
│  │ El sistema registra la excepción y su justificación.      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ESTÁNDARES DE COMPLIANCE:                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ • Checklist NOM-251 igual para todas las sucursales       │   │
│  │ • Frecuencias de limpieza estandarizadas                  │   │
│  │ • Umbrales de alerta iguales (temperaturas, stock)        │   │
│  │ • Formato de evidencia estandarizado                      │   │
│  │                                                           │   │
│  │ El grupo define. La plataforma aplica.                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  DATOS MAESTROS COMPARTIDOS:                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ • Catálogo de productos y proveedores                     │   │
│  │ • Recetas maestras (mismos ingredientes, mismas porciones)│   │
│  │ • Plantilla de empleados (pueden rotar entre sucursales)  │   │
│  │ • Historial de compliance consolidado                     │   │
│  │ • Plantillas de mapeo de POS                              │   │
│  │ • Matriz de autorización de gastos                        │   │
│  │ • Políticas de segregación de funciones                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ALERTAS DE GRUPO (escalan al Director y/o Owner)                │
│  ─────────────────────────────────────────────                   │
│                                                                  │
│  • Compliance score de una sucursal baja de 80 → alerta          │
│  • Incidente de severidad Alta o Crítica en cualquier sucursal   │
│  • Merma supera 10% en cualquier sucursal en una semana          │
│  • 3 o más tareas vencidas en una sucursal en 24 horas           │
│  • Rotación trimestral supera 25%                                │
│  • Horas extra acumuladas cerca del límite legal                 │
│  • Documento de empleado por vencer (7, 3, 1 día)                │
│  • Proveedor con 2+ incidencias en el mes                       │
│  • Auditoría de COFEPRIS en el sector/colonia (alerta externa)   │
│  • Corte de ventas no recibido al cierre del día                │
│  • Costo de alimentos > 35% de venta en cualquier sucursal       │
│  • Factura no conciliada con recepción después de 48 hrs         │
│  • Proveedor aparece en listas negras del SAT                    │
│  • Pago fuera de política detectado (monto o aprobación)         │
│  • Segregación de funciones violada (misma persona crea y       │
│    aprueba una orden de compra)                                  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BENCHMARKING INTERNO                                            │
│  ───────────────────                                             │
│                                                                  │
│  Pulso compara automáticamente las sucursales del grupo:         │
│                                                                  │
│  "San Pedro consistentemente tiene la merma más baja (5.2%).     │
│   ¿Qué prácticas usa que podrían replicarse en Contry (12.8%)?"  │
│                                                                  │
│  "El gerente de Valle redujo rotación de 30% a 15% en 6 meses.   │
│   ¿Qué hizo diferente? El sistema identifica: implementó un      │
│   programa de reconocimiento semanal documentado en Pulso."      │
│                                                                  │
│  "San Pedro tiene costo de alimentos en 26% de venta. Contry     │
│   está en 38%. Digital Twin de San Pedro está disponible para     │
│   clonar en Contry — ¿autorizas la sincronización de recetas?"   │
│                                                                  │
│  Estas comparativas solo son posibles porque todas las           │
│  sucursales usan la misma plataforma, los mismos workflows,      │
│  las mismas métricas.                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. WhatsApp Como Capa de Ejecución

### WhatsApp no es un canal más. Es LA interfaz de campo.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ARQUITECTURA WHATSAPP                                           │
│  ────────────────────                                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    PULSO ENGINE                           │   │
│  │                                                           │   │
│  │  Workflow Engine ──► WhatsApp Provider ──► WasenderAPI    │   │
│  │                                                           │   │
│  │  ◄── Respuestas, fotos, audios, ubicaciones               │   │
│  │                                                           │   │
│  │  ◄── AI interpreta la respuesta (texto, voz, imagen)      │   │
│  │       y actualiza el workflow automáticamente              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  QUÉ PUEDE HACER UN EMPLEADO POR WHATSAPP                        │
│  ────────────────────────────────────────                        │
│                                                                  │
│  ✅ Recibir tarea: "Juan, tienes que verificar temperaturas"     │
│  ✅ Ver instrucciones: "Toma foto del termómetro del refri #2"   │
│  ✅ Enviar evidencia: foto, texto, audio, ubicación              │
│  ✅ Confirmar completado: "Hecho ✓"                              │
│  ✅ Reportar incidente: "El refri está tirando agua" + foto      │
│  ✅ Recibir recordatorios: "La tarea vencerá en 30 min"          │
│  ✅ Solicitar cambio de turno: "¿Puedo cambiar el jueves?"       │
│  ✅ Reportar ausencia: "No puedo ir hoy, estoy enfermo"          │
│  ✅ Recibir anuncios del grupo: "Junta general el viernes"       │
│  ✅ Recibir capacitación: videos, guías, quizzes                 │
│  ✅ Enviar corte de ventas: adjuntar archivo/CSV del POS         │
│  ✅ Reportar gasto de caja chica: foto de ticket + monto         │
│  ✅ Enviar nota de voz como evidencia (transcrita autom.)        │
│                                                                  │
│  ❌ NO puede: ver dashboard completo, modificar workflows,       │
│     ver datos de otras sucursales, aprobar compras grandes       │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  FLUJO TÍPICO DE WHATSAPP                                        │
│  ─────────────────────────                                       │
│                                                                  │
│  [07:00] Pulso: "Buenos días María. 🌅                                │
│           Inicia el checklist de Apertura Cocina Centro.         │
│           Paso 1/18: Verificar temperatura de refrigeradores.    │
│           Toma foto del termómetro de cada uno.                  │
│           Vence: 7:45 AM"                                        │
│                                                                  │
│  [07:12] María: [Foto del termómetro: 3°C] "Refri 1: 3 grados"  │
│                                                                  │
│  [07:12] Pulso: "✅ Refrigerador 1: 3°C. Dentro de rango.       │
│           Paso 2/18: Verifica refrigerador 2."                   │
│                                                                  │
│  [07:15] María: [Foto del termómetro: 4°C] "Refri 2: 4 grados"  │
│                                                                  │
│  [07:15] Pulso: "✅ Refrigerador 2: 4°C. Dentro de rango.       │
│           Paso 3/18: Revisa trampas de grasa..."                 │
│                                                                  │
│  ...                                                            │
│                                                                  │
│  [07:38] María: "Listo, terminé checklist"                       │
│                                                                  │
│  [07:38] Pulso: "🎉 Checklist Apertura Cocina completado.        │
│           18/18 pasos. 26 minutos. ¡Buen turno, María!"          │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MANEJO DE EXCEPCIONES POR WHATSAPP                              │
│  ──────────────────────────────────                              │
│                                                                  │
│  Empleado no completa a tiempo:                                  │
│  [07:50] Pulso: "⚠️ María, la tarea 'Apertura Cocina' venció.   │
│           Por favor complétala lo antes posible."                │
│                                                                  │
│  [08:00] Pulso (a Carlos, gerente): "⚠️ María no ha completado  │
│           Apertura Cocina en Centro. Vencida hace 15 min."       │
│                                                                  │
│  Empleado reporta incidente:                                     │
│  [10:30] María: "El refri 2 está tirando agua" [Foto]            │
│                                                                  │
│  [10:30] Pulso: "Incidente registrado: Equipo/Sucursal Centro.   │
│           Severidad media. Se notificó al gerente Carlos.        │
│           Acción sugerida: desconectar y colocar letrero.        │
│           ¿Puedes hacerlo?"                                      │
│                                                                  │
│  [10:31] María: "Sí, listo"                                      │
│                                                                  │
│  [10:31] Pulso: "✅ Acción inmediata registrada. Carlos dará     │
│           seguimiento. Gracias por reportar, María."             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Resiliencia Técnica

### El sistema funciona incluso cuando la señal no llega

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  MODO OFFLINE EN WHATSAPP BUSINESS API / CAPTURA MÓVIL           │
│  ────────────────────────────────────────────────────           │
│                                                                  │
│  • Cola local de evidencia (fotos, checklists, lecturas) que     │
│    se almacena en el dispositivo y sincroniza automáticamente    │
│    cuando vuelve la conexión                                     │
│  • Timestamp del momento real de captura, no del momento de      │
│    sincronización — crítico para validez de bitácoras NOM       │
│  • Crítico para sucursales con señal irregular o zonas sin       │
│    cobertura dentro del restaurante (cámaras frías, sótanos)    │
│                                                                  │
│  NOTAS DE VOZ COMO EVIDENCIA VÁLIDA                              │
│  ───────────────────────────────────                             │
│                                                                  │
│  • Personal de piso puede reportar hablando en vez de            │
│    escribiendo (más rápido, más natural durante operación)       │
│  • Transcripción automática con AI                               │
│  • Clasificación automática igual que un reporte de texto        │
│  • El audio original se preserva como evidencia                  │
│  • Útil para empleados con baja alfabetización digital o        │
│    con preferencia de reportar mientras trabajan                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. Adopción y Comportamiento

### Lo que falta para que el empleado de piso realmente cumpla

> El diseño original resuelve muy bien el lado de *control* (escalamiento, verificación AI de evidencia). Esta sección agrega el lado de *por qué alguien mal pagado, con alta rotación, decide hacerlo bien*.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  VERIFICACIÓN DE RECENCIA DE EVIDENCIA                           │
│  ────────────────────────────────────                            │
│                                                                  │
│  • El sistema verifica metadata de la foto (timestamp EXIF),     │
│    no solo el contenido visual                                   │
│  • Previene el clásico "reciclaje" de una foto de ayer o de      │
│    otro turno                                                    │
│  • Si la metadata no coincide con la hora esperada de la tarea,  │
│    se marca para revisión                                        │
│                                                                  │
│  RECONOCIMIENTO POSITIVO                                         │
│  ──────────────────────                                          │
│                                                                  │
│  • El sistema original solo tiene tono correctivo (alertas,      │
│    escalamientos). Se agrega reconocimiento al gerente/sucursal  │
│    con mejor cumplimiento sostenido                              │
│  • "🎉 Centro: 14 días consecutivos con compliance > 90%.        │
│    ¡Excelente trabajo, equipo!"                                  │
│  • Ranking semanal visible en dashboard (no punitivo,             │
│    motivacional)                                                 │
│  • La sucursal #1 del ranking se vuelve automáticamente el       │
│    Digital Twin de referencia para las demás                     │
│                                                                  │
│  MEDICIÓN DE FRICCIÓN                                            │
│  ──────────────────                                              │
│                                                                  │
│  • Métrica de producto: cuántos toques/mensajes le toma a un     │
│    empleado reportar una tarea                                   │
│  • Reducir activamente ese número como KPI de UX                 │
│  • Si reportar temperatura requiere 4 interacciones en vez de    │
│    1, el diseño está mal y la métrica lo expone                  │
│  • Principio: si toma más esfuerzo reportar la tarea que         │
│    hacerla, el sistema está trabajando contra el usuario         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. Compliance Regulatorio Integrado

### Blindaje completo para NOM-251, NOM-035, LFT e IMSS

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  NOM-251-SSA1-2009: PRÁCTICAS DE HIGIENE                         │
│  ─────────────────────────────────────                           │
│                                                                  │
│  La NOM-251 exige evidencia documental de prácticas de higiene   │
│  en establecimientos que procesan alimentos. Pulso lo resuelve   │
│  sin que el restaurante tenga que pensar en compliance.          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ REQUISITO NOM-251          │ CÓMO LO CUBRE PULSO           │   │
│  ├────────────────────────────┼──────────────────────────────┤   │
│  │ Control de temperaturas    │ Workflows diarios con foto    │   │
│  │ de refrigeración y cocción │ del termómetro. AI verifica   │   │
│  │                            │ que esté en rango.            │   │
│  ├────────────────────────────┼──────────────────────────────┤   │
│  │ Bitácora de limpieza       │ Workflows de limpieza por     │   │
│  │ por área y frecuencia      │ área con evidencia fotográfica│   │
│  │                            │ y verificación AI.            │   │
│  ├────────────────────────────┼──────────────────────────────┤   │
│  │ Trazabilidad de alimentos  │ Registro de lotes, fechas de  │   │
│  │ (lote, caducidad)          │ recepción y caducidad. Alertas│   │
│  │                            │ de producto por vencer.        │   │
│  ├────────────────────────────┼──────────────────────────────┤   │
│  │ Control de plagas          │ Workflow programado con foto  │   │
│  │                            │ de trampas, cebos, registros  │   │
│  ├────────────────────────────┼──────────────────────────────┤   │
│  │ Capacitación de personal   │ Workflow de onboarding con    │   │
│  │ en higiene                 │ contenido NOM-251 y verif.    │   │
│  ├────────────────────────────┼──────────────────────────────┤   │
│  │ Certificados médicos       │ Carga de documentos de        │   │
│  │ del personal               │ empleados. Alertas de         │   │
│  │                            │ vencimiento (30, 15, 7 días). │   │
│  ├────────────────────────────┼──────────────────────────────┤   │
│  │ Reporte pre-auditoría      │ "Si COFEPRIS llega hoy":      │   │
│  │                            │ reporte auto-generado con toda │   │
│  │                            │ la evidencia organizada.       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Puntaje de compliance por sucursal:                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Score = (% tareas completadas × % evidencia válida ×      │   │
│  │         % documentación al día × % capacitaciones OK)     │   │
│  │                                                           │   │
│  │ 90-100: 🟢 Verde. Listo para auditoría.                    │   │
│  │ 80-89:  🟡 Amarillo. Plan de remediación sugerido.        │   │
│  │ <80:    🔴 Rojo. Alerta a Director. Prioridad urgente.     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  NOM-035-STPS-2018: RIESGOS PSICOSOCIALES                        │
│  ────────────────────────────────────────                        │
│                                                                  │
│  • Cuestionario de evaluación aplicado automáticamente           │
│  • Resultados consolidados con scoring                           │
│  • Plan de acción sugerido según resultados                      │
│  • Seguimiento de medidas implementadas                          │
│  • Historial para demonstrar cumplimiento continuo               │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LFT: CUMPLIMIENTO LABORAL                                       │
│  ─────────────────────────                                       │
│                                                                  │
│  • Jornadas máximas: alerta si un empleado excede 48 hrs/semana  │
│  • Horas extra: límite 9 hrs/semana, registro obligatorio        │
│  • Descanso semanal: verificación automática                     │
│  • Días de descanso obligatorio: seguimiento                     │
│  • Vacaciones: cálculo automático según antigüedad               │
│  • Prima dominical: cálculo automático                           │
│  • Aguinaldo: cálculo automático                                 │
│  • Reporte de cumplimiento LFT exportable                        │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  IMSS: GESTIÓN DE SEGURIDAD SOCIAL                               │
│  ─────────────────────────────────                               │
│                                                                  │
│  • Generación de archivos SUA (Sistema Único de Autodeterminación)│
│  • Generación de archivos IDSE (IMSS Desde Su Empresa)           │
│  • Registro de altas, bajas, modificaciones de salario           │
│  • Cálculo de cuotas obrero-patronales                           │
│  • Alertas de fechas límite de presentación                      │
│  • Historial de movimientos afiliatorios                         │
│                                                                  │
│  PROTECCIÓN CIVIL                                                │
│  ────────────────                                                │
│  • Calendario de simulacros                                      │
│  • Checklist de revisión de extintores, salidas, señalización    │
│  • Evidencia de simulacros realizados                            │
│  • Bitácora de protección civil                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 12. Inventario y Merma

### Cómo se controla el costo de alimentos en las 5 sucursales

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  FLUJO DE INVENTARIO                                             │
│  ─────────────────                                               │
│                                                                  │
│  COMPRA                 RECEPCIÓN              CONSUMO           │
│  ┌──────────┐          ┌──────────┐          ┌──────────┐       │
│  │ Orden de │─────────►│ Workflow │─────────►│ Recetas  │       │
│  │ compra   │          │Recepción │          │estandar. │       │
│  │          │          │+ AI      │          │          │       │
│  │Sugerida  │          │verifica  │          │Consumo   │       │
│  │por stock │          │cantidad, │          │teórico   │       │
│  │bajo      │          │calidad,  │          │calculado │       │
│  └──────────┘          │temp.     │          │automát.  │       │
│                        └──────────┘          └──────────┘       │
│                             │                      │             │
│                             ▼                      ▼             │
│                        ┌──────────────────────────────┐         │
│                        │      INVENTARIO ACTUALIZADO   │         │
│                        │      (tiempo real)            │         │
│                        └──────────────────────────────┘         │
│                                      │                           │
│                                      ▼                           │
│                        ┌──────────────────────────────┐         │
│                        │  CONTEO CÍCLICO Y COMPLETO    │         │
│                        │  Theoretical vs Actual        │         │
│                        │  → MERMA DETECTADA            │         │
│                        └──────────────────────────────┘         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CÁLCULO DE MERMA                                                │
│  ────────────────                                                │
│                                                                  │
│  Para cada producto, en cada sucursal, cada semana:              │
│                                                                  │
│  Merma = Inventario inicial + Compras - Consumo teórico          │
│          - Inventario final                                       │
│                                                                  │
│  Consumo teórico = Σ (recetas vendidas × cantidad por receta)    │
│                                                                  │
│  Ejemplo:                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ POLLO — SUCURSAL CENTRO — SEMANA 28                       │   │
│  │                                                           │   │
│  │ Inventario inicial:             42 kg                     │   │
│  │ Compras:                       +45 kg                     │   │
│  │ Disponible:                     87 kg                     │   │
│  │ Consumo teórico (recetas):     -78 kg                     │   │
│  │ Inventario esperado:             9 kg                     │   │
│  │ Inventario real (conteo):        5 kg                     │   │
│  │                                                           │   │
│  │ MERMA:                           4 kg (4.6%) ⚠️           │   │
│  │ Costo:                           $480 MXN                  │   │
│  │                                                           │   │
│  │ Objetivo del grupo:             < 5% → OK                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  VISIÓN DEL GRUPO                                                │
│  ────────────────                                                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ MERMA SEMANAL POR SUCURSAL — SEMANA 28                     │   │
│  │                                                           │   │
│  │ Centro:     4.6% ████████░░ 🟡                             │   │
│  │ San Pedro:  2.1% ████░░░░░ 🟢 (la mejor)                  │   │
│  │ Valle:      6.8% ████████████░░ 🔴                         │   │
│  │ Cumbres:    5.2% ██████████░ 🟡                            │   │
│  │ Contry:    11.2% ██████████████████████░ 🔴🔴              │   │
│  │                                                           │   │
│  │ Promedio grupo: 6.0% (objetivo: <7%)                       │   │
│  │                                                           │   │
│  │ 🔴 Contry necesita intervención urgente.                   │   │
│  │ 🟢 San Pedro: ¿qué están haciendo bien?                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MERMA POR CANAL DE VENTA (NUEVO)                                │
│  ────────────────────────────────                                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ MERMA CENTRO — SEMANA 28 — POR CANAL                       │   │
│  │                                                           │   │
│  │ Salón:      3.2% ██████░░ 🟢                              │   │
│  │ Delivery:   6.8% █████████████░░ 🟡 (empaque + errores)   │   │
│  │ Eventos:    1.1% ██░░ ░░ 🟢                                │   │
│  │                                                           │   │
│  │ ➤ Delivery genera el doble de merma que salón.            │   │
│  │   Revisar proceso de empaque y precisión de órdenes.       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ALERTAS DE INVENTARIO                                           │
│  ───────────────────                                             │
│                                                                  │
│  • Stock bajo (< umbral definido por producto) → sugerir compra  │
│  • Stock crítico (< 20% del umbral) → alerta urgente             │
│  • Producto por caducar (7, 3, 1 días)                           │
│  • Producto ya caducado → alerta inmediata, debe retirarse       │
│  • Desviación en recepción (> 5% vs orden de compra)             │
│  • Merma semanal > 10% en una sucursal                           │
│  • Conteo cíclico no realizado en ventana de tiempo              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 13. Gestión Laboral Multi-Sucursal

### Administrar 80-150 empleados en 5 ubicaciones

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  PLANTILLA DE EMPLEADOS                                          │
│  ────────────────────                                            │
│                                                                  │
│  Cada empleado tiene:                                            │
│  • Datos personales, contacto de emergencia                      │
│  • Rol (gerente, cocinero, mesero, cajero, steward...)           │
│  • Sucursal base (puede rotar)                                  │
│  • Turno habitual (matutino/vespertino)                          │
│  • Salario base, tipo de contrato, fecha de ingreso              │
│  • Documentos: INE, CURP, NSS, contrato, certificado médico      │
│  • Historial: asistencias, retardos, incidentes, evaluaciones    │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ASISTENCIA Y TURNOS                                             │
│  ──────────────────                                              │
│                                                                  │
│  Control de entrada/salida:                                      │
│  • WhatsApp: "Llegué" con ubicación o foto en sucursal           │
│  • PIN en tableta de la sucursal                                 │
│  • Integración con reloj checador (si existe)                    │
│                                                                  │
│  El sistema registra automáticamente:                            │
│  • Hora de entrada                                               │
│  • Retardos (> 15 min tolerancia)                                │
│  • Ausencias sin aviso                                           │
│  • Salida temprano                                               │
│  • Horas extra (entrada antes o salida después del turno)        │
│                                                                  │
│  Alertas:                                                        │
│  • Empleado no registró entrada 30 min después del turno         │
│  • Horas extra acumuladas cerca del límite legal                 │
│  • Patrón de retardos (3+ en 2 semanas)                          │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  GESTIÓN DE TURNOS                                               │
│  ────────────────                                                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ SEMANA 28 — SUCURSAL CENTRO                               │   │
│  │                                                           │   │
│  │         LUN  MAR  MIÉ  JUE  VIE  SÁB  DOM                │   │
│  │  M (6am-2pm):                                            │   │
│  │  Gerente    Juan  Juan Juan Carlos C.  Carlos  C.        │   │
│  │  Cocinero   María María María Pedro Pedro María Pedro     │   │
│  │  Mesero 1   Pedro Pedro Pedro Ana   Ana   Pedro Ana      │   │
│  │  Mesero 2   Ana   Ana   Ana   Luis  Luis  Ana   Luis     │   │
│  │  Cajero     Luis  Luis  Luis  --    --    Luis  --       │   │
│  │                                                           │   │
│  │  V (2pm-11pm):                                           │   │
│  │  Gerente    Carlos C.  Carlos C.  Carlos Juan  Juan       │   │
│  │  Cocinero   José  José  José  José  José  María José     │   │
│  │  ...                                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Funcionalidades:                                                │
│  • Plantilla semanal con asignación por turno                    │
│  • Rotación automática de empleados entre sucursales             │
│  • Solicitud de cambio de turno (empleado → gerente → aprob.)   │
│  • Solicitud de vacaciones / días libres                         │
│  • Cobertura de ausencias (quién cubre a quién)                  │
│  • Límites legales automáticos (horas, descansos)                │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  VISIÓN DEL GRUPO                                                │
│  ────────────────                                                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ MÉTRICAS LABORALES — MES DE JULIO                          │   │
│  │                                                           │   │
│  │                  Centro  SP    Valle  Cumbres Contry       │   │
│  │  Asistencia       94%    97%   89%    92%    85%          │   │
│  │  Retardos/mes       4      1      7      3      11        │   │
│  │  Horas extra       12      8     18      6      24⚠️      │   │
│  │  Rotación (trim)   18%    10%    25%    15%    32%         │   │
│  │  Vacaciones pend.   3      5      2      4      8         │   │
│  │                                                           │   │
│  │  Costo laboral como % de ventas:                          │   │
│  │  Centro: 28%  SP: 31%  Valle: 26%  Cumbres: 29% Contry:35%│   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 14. Incidentes y Remediación

### Capturar, escalar, resolver, aprender

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  CICLO DE VIDA DE UN INCIDENTE                                   │
│  ─────────────────────────────                                   │
│                                                                  │
│  DETECCIÓN                                                       │
│  ─────────                                                       │
│  • Manual: empleado, gerente o supervisor reporta                │
│  • Automática: el sistema detecta desviación                     │
│                                                                  │
│  REGISTRO                                                        │
│  ────────                                                        │
│  • Tipo (seguridad, calidad, compliance, equipo, cliente, RH...) │
│  • Severidad (bajo, medio, alto, crítico)                        │
│  • Descripción, fotos, ubicación, responsable                    │
│                                                                  │
│  ESCALAMIENTO                                                    │
│  ────────────                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Bajo:      Se resuelve en sucursal. Gerente notificado.   │   │
│  │  Medio:     Director de Ops notificado. Plazo 24 hrs.     │   │
│  │  Alto:      Director de Ops + Owner notificados.           │   │
│  │             Plazo 4 hrs.                                   │   │
│  │  Crítico:   Owner + Dirección notificados inmediatamente.  │   │
│  │             Plazo 1 hr. Paro de operación si aplica.       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  PLAN DE ACCIÓN                                                  │
│  ─────────────                                                   │
│  • Acciones inmediatas (contener)                                │
│  • Acciones correctivas (causa raíz)                             │
│  • Acciones preventivas (que no vuelva a ocurrir)                │
│  • Responsable y fecha límite por cada acción                    │
│                                                                  │
│  SEGUIMIENTO                                                     │
│  ───────────                                                     │
│  • Verificación de acciones completadas (con evidencia)          │
│  • Cierre del incidente                                          │
│  • Evaluación de efectividad (¿se resolvió?)                     │
│                                                                  │
│  APRENDIZAJE                                                     │
│  ───────────                                                     │
│  • El incidente se registra en la memoria del sistema            │
│  • Patrones: ¿se repite en la misma sucursal, área, turno?       │
│  • Recomendaciones automáticas para prevenir                     │
│  • Ajuste de playbooks corporativos si es necesario              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  VISIÓN DEL GRUPO                                                │
│  ────────────────                                                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ INCIDENTES DEL MES — JULIO 2026                            │   │
│  │                                                           │   │
│  │  Total: 23 incidentes                                     │   │
│  │  Resueltos: 21 (91%)                                      │   │
│  │  Abiertos: 2                                              │   │
│  │  Tiempo promedio de resolución: 6.4 horas                 │   │
│  │                                                           │   │
│  │  Por tipo:                                                │   │
│  │  ████████ Equipo (8)                                      │   │
│  │  ██████ Proveedor (6)                                     │   │
│  │  ████ Compliance (4)                                      │   │
│  │  ███ Cliente (3)                                          │   │
│  │  ██ Personal (2)                                          │   │
│  │                                                           │   │
│  │  Por sucursal:                                            │   │
│  │  ████████ Contry (8) ← ⚠️                                  │   │
│  │  █████ Valle (5)                                          │   │
│  │  ████ Centro (4)                                          │   │
│  │  ███ Cumbres (3)                                          │   │
│  │  ███ San Pedro (3)                                        │   │
│  │                                                           │   │
│  │  Patrón detectado: "4 de 8 incidentes en Contry son       │   │
│  │  relacionados con refrigeración. Equipo #2 es recurrente." │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 15. Reportes e Inteligencia

### De datos crudos a decisiones

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  REPORTES AUTOMÁTICOS                                            │
│  ──────────────────                                              │
│                                                                  │
│  DIARIOS:                                                        │
│  ───────                                                         │
│  • Resumen de sucursal (gerente): tareas, incidentes, asistencia │
│  • Resumen consolidado (director): 3-5 KPIs todas las sucursales │
│                                                                  │
│  SEMANALES:                                                      │
│  ─────────                                                       │
│  • Merma por sucursal y por producto                             │
│  • Merma segmentada por canal de venta (salón/delivery/eventos)  │
│  • Compliance score por sucursal y área                          │
│  • Incidentes de la semana con tendencia                         │
│  • Asistencia y retardos por empleado                            │
│  • Horas extra acumuladas                                        │
│  • Costo de alimentos (food cost %) por sucursal                 │
│  • Ventas por sucursal y por canal                               │
│  • Gastos operativos por sucursal y categoría                    │
│                                                                  │
│  MENSUALES:                                                      │
│  ─────────                                                       │
│  • Reporte ejecutivo completo (owner): todas las métricas        │
│  • Costo laboral como % de ventas                                │
│  • Rotación de personal y tendencia                              │
│  • Cumplimiento de playbooks corporativos                        │
│  • Auditoría NOM-251 consolidada                                 │
│  • Reporte de nómina para contador                               │
│  • P&L estimado por sucursal (venta − alimentos − laboral −     │
│    gastos operativos)                                            │
│  • Flujo de efectivo proyectado a 30 días                        │
│  • Alertas de control interno del mes                            │
│  • Reporte de pólizas contables generadas                        │
│                                                                  │
│  TRIMESTRALES:                                                   │
│  ────────────                                                    │
│  • Reporte pre-auditoría COFEPRIS (por sucursal)                 │
│  • Evaluación NOM-035                                            │
│  • Benchmarking interno (comparativa entre sucursales)           │
│  • Tendencias y predicciones                                     │
│  • Rentabilidad real de delivery vs. salón (post-comisión)       │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PREDICCIONES E INTELIGENCIA                                     │
│  ──────────────────────────                                      │
│                                                                  │
│  Con suficientes datos, Pulso genera predicciones:               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                                                           │   │
│  │  "Sucursal Contry tiene 78% de probabilidad de bajar      │   │
│  │   de 80 en compliance NOM-251 en las próximas 2 semanas.   │   │
│  │                                                            │   │
│  │   Factores detectados:                                     │   │
│  │   • 3 días sin registro de temperaturas vespertinas        │   │
│  │   • Rotación de cocinero hace 2 semanas (nuevo ingreso)    │   │
│  │   • 2 incidentes de refrigerador en el mes                 │   │
│  │   • Trampa de grasa sin mantenimiento (14 días vencida)    │   │
│  │                                                            │   │
│  │   Acciones recomendadas:                                   │   │
│  │   1. Asignar verificación doble de temperaturas esta semana│   │
│  │   2. Re-entrenar al cocinero nuevo en protocolo NOM-251    │   │
│  │   3. Programar mantenimiento urgente de refrigerador #2    │   │
│  │   4. Agendar limpieza de trampa de grasa para mañana       │   │
│  │                                                            │   │
│  │   Cumpliendo estas 4 acciones, la probabilidad baja a 12%. │   │
│  │                                                            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 16. Empaquetamiento por Tamaño de Cliente

### No todos los grupos necesitan lo mismo

> El diseño original presenta los módulos como un bloque único. Pero un grupo de 3 sucursales y uno de 15 tienen necesidades y capacidad de adopción muy distintas. Esto también estructura el pricing por fases.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌────────────┬──────────────────┬────────────────────────────┐ │
│  │ TIER       │ PERFIL TÍPICO    │ MÓDULOS ACTIVOS             │ │
│  ├────────────┼──────────────────┼────────────────────────────┤ │
│  │ STARTER    │ 3-5 sucursales   │ • Workflow Engine           │ │
│  │            │ Dueño operador,  │ • Compliance Normativo      │ │
│  │            │ sin director de  │ • Inventario básico         │ │
│  │            │ operaciones      │ • Incidentes                │ │
│  │            │                  │ • Notificaciones            │ │
│  │            │                  │ • Reportes básicos          │ │
│  │            │                  │ • Pagos y Gastos: caja      │ │
│  │            │                  │   chica y gasto operativo   │ │
│  │            │                  │   básico                    │ │
│  │            │                  │ • Control Interno: doble    │ │
│  │            │                  │   autorización y bitácora   │ │
│  │            │                  │   de auditoría              │ │
│  ├────────────┼──────────────────┼────────────────────────────┤ │
│  │ GROWTH     │ 6-10 sucursales  │ + Gestión Laboral completa  │ │
│  │            │ Director de      │ + Fiscal: timbrado de       │ │
│  │            │ Operaciones      │   nómina (CFDI)             │ │
│  │            │ contratado       │ + Recetas y Costeo          │ │
│  │            │                  │ + Ventas y POS              │ │
│  │            │                  │ + Rol de Chef Corporativo   │ │
│  │            │                  │   activo                    │ │
│  ├────────────┼──────────────────┼────────────────────────────┤ │
│  │ SCALE      │ 11-15+           │ + Equipamiento y            │ │
│  │            │ sucursales       │   Mantenimiento             │ │
│  │            │ Estructura       │ + Compras y Proveedores     │ │
│  │            │ corporativa      │ + Fiscal: conciliación      │ │
│  │            │ formal           │   automática OC-Recepción-  │ │
│  │            │                  │   Factura (SAT)             │ │
│  │            │                  │ + Pagos y Gastos: flujo de  │ │
│  │            │                  │   efectivo consolidado +    │ │
│  │            │                  │   complemento de pago CFDI  │ │
│  │            │                  │   + P&L por sucursal        │ │
│  │            │                  │ + Control Interno:          │ │
│  │            │                  │   segregación de funciones  │ │
│  │            │                  │   formal + generación       │ │
│  │            │                  │   automática de pólizas     │ │
│  │            │                  │ + Delivery y Agregadores    │ │
│  │            │                  │ + Playbook de Apertura de   │ │
│  │            │                  │   Sucursal                  │ │
│  │            │                  │ + Benchmarking cross-       │ │
│  │            │                  │   sucursal avanzado         │ │
│  └────────────┴──────────────────┴────────────────────────────┘ │
│                                                                  │
│  NOTAS DE DISEÑO DE TIERS:                                       │
│                                                                  │
│  • Doble autorización y bitácora de auditoría van desde          │
│    Starter porque el fraude a pequeña escala ("me está robando   │
│    el gerente") es un dolor tan agudo o más en grupos chicos,    │
│    sin estructura corporativa que lo prevenga.                   │
│                                                                  │
│  • Caja chica y gasto operativo básico van desde Starter porque  │
│    hoy se llevan en libreta incluso en el grupo más chico —      │
│    es una sustitución de bajo costo de algo que ya hacen mal.    │
│                                                                  │
│  • El timbrado de nómina se ubica en Growth y no en Starter      │
│    porque, aunque es obligación legal desde el primer empleado,  │
│    requiere que la Gestión Laboral (Módulo 4) ya esté completa   │
│    y estable — vender el timbrado antes de que el cálculo de     │
│    nómina esté confiable generaría más riesgo que valor.         │
│                                                                  │
│  • La segregación de funciones estricta y las pólizas            │
│    automáticas requieren suficiente headcount y que Módulos      │
│    7/15/16 ya estén activos, por eso viven en Scale.             │
│                                                                  │
│  IMPLICACIÓN COMERCIAL:                                          │
│  ─────────────────────                                           │
│  La demo y el discurso de ventas no necesitan mostrar 17         │
│  módulos a un dueño de 3 restaurantes. Se le muestra             │
│  exactamente lo que resuelve su dolor actual, y el resto se      │
│  convierte en la narrativa de crecimiento ("esto es lo que se    │
│  activa cuando llegues a la sucursal 6").                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 17. Fases de Implementación por Cliente

### Cómo se despliega Pulso en un grupo de 5 sucursales en Monterrey

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  SEMANA 1-2: DIAGNÓSTICO Y PLANEACIÓN                             │
│  ─────────────────────────────────────                            │
│                                                                  │
│  Actividades:                                                    │
│  • Visita a las 5 sucursales (1 día por sucursal)               │
│  • Entrevista con dueño y director de operaciones                │
│  • Mapeo de procesos actuales (apertura, cierre, limpieza, etc.) │
│  • Inventario de equipos, áreas, personal                        │
│  • Identificación de fugas y riesgos                             │
│  • Identificación del POS y su formato de corte de ventas        │
│  • Plan de implementación personalizado                           │
│                                                                  │
│  Entregables:                                                    │
│  • Diagnóstico operativo del grupo                               │
│  • Plan de implementación 12 semanas                             │
│  • Configuración inicial del tenant en Pulso                     │
│  • Sucursales, áreas, roles y usuarios cargados                  │
│  • Plantilla de mapeo de POS configurada                         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SEMANA 3-4: ESTRUCTURA Y PLAYBOOKS                               │
│  ─────────────────────────────────────                            │
│                                                                  │
│  Actividades:                                                    │
│  • Definición de playbooks corporativos (apertura, cierre, etc.) │
│  • Adaptación de templates Pulso a la realidad del grupo         │
│  • Carga de catálogo de productos y proveedores                  │
│  • Carga de recetas estandarizadas                               │
│  • Configuración de áreas y equipos por sucursal                 │
│  • Configuración de roles y permisos                             │
│  • Configuración de políticas de autorización de gastos          │
│  • Configuración de matriz de segregación de funciones           │
│  • Alta en FiscalAPI y configuración de RFC por razón social     │
│                                                                  │
│  Entregables:                                                    │
│  • Playbooks operativos digitalizados                             │
│  • Workflows configurados y probados                             │
│  • Catálogos maestros completos                                  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SEMANA 5-6: CAPACITACIÓN DE LÍDERES                              │
│  ────────────────────────────────────                             │
│                                                                  │
│  Actividades:                                                    │
│  • Capacitación al Owner: dashboard ejecutivo, KPIs, reportes    │
│  • Capacitación al Director de Ops: playbooks, workflows,        │
│    incidentes, escalamiento, reportes detallados                 │
│  • Capacitación a los 5 gerentes: dashboard de sucursal,         │
│    ejecución de workflows, gestión de incidentes, inventario     │
│  • Capacitación al Chef Corporativo (si existe): recetas,        │
│    costeo, muestreo de calidad                                   │
│  • Prueba piloto: 1 sucursal opera 3 días con Pulso              │
│                                                                  │
│  Entregables:                                                    │
│  • Líderes capacitados y usando el sistema                       │
│  • Feedback de prueba piloto incorporado                         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SEMANA 7-8: CAPACITACIÓN DE EMPLEADOS                            │
│  ─────────────────────────────────────                            │
│                                                                  │
│  Actividades:                                                    │
│  • Sesiones presenciales en cada sucursal (30 min por turno)     │
│  • Demostración: "Así vas a recibir tareas por WhatsApp"         │
│  • Práctica: empleados ejecutan tareas reales con supervisión    │
│  • Aclaración de dudas                                           │
│                                                                  │
│  Entregables:                                                    │
│  • 100% de empleados de piso han ejecutado al menos 1 tarea     │
│  • Los empleados entienden que WhatsApp es su interfaz           │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SEMANA 9-10: PRIMERA SEMANA COMPLETA                             │
│  ──────────────────────────────────                               │
│                                                                  │
│  Actividades:                                                    │
│  • Las 5 sucursales operan con Pulso toda la semana              │
│  • Soporte intensivo: consultor disponible 24/7                  │
│  • Monitoreo activo de ejecución y alertas                       │
│  • Ajustes en tiempo real                                        │
│                                                                  │
│  Entregables:                                                    │
│  • Primera semana de datos completos                             │
│  • Primer reporte semanal de KPIs                                │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SEMANA 11-12: ESTABILIZACIÓN Y CIERRE                            │
│  ─────────────────────────────────────                            │
│                                                                  │
│  Actividades:                                                    │
│  • Sesión de revisión con Owner y Director de Ops                │
│  • Ajustes finales a playbooks y workflows                       │
│  • Configuración de reportes automáticos                         │
│  • Plan de acompañamiento continuo (fase recurrente)             │
│                                                                  │
│  Entregables:                                                    │
│  • Sistema operando de forma autónoma                            │
│  • Manual de operación Pulso para el grupo                       │
│  • Plan de revisión mensual                                      │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MES 3 EN ADELANTE: ACOMPAÑAMIENTO CONTINUO                       │
│  ─────────────────────────────────────────                         │
│                                                                  │
│  Cada mes:                                                       │
│  • Reporte ejecutivo de KPIs                                     │
│  • Sesión de revisión (30 min, remota)                           │
│  • Auditoría sorpresa a 1 sucursal (rotativa)                    │
│  • Ajustes a playbooks si se requieren                            │
│  • Evaluación de adopción y cumplimiento                         │
│                                                                  │
│  Cada trimestre:                                                 │
│  • Reporte pre-auditoría NOM-251 consolidado                     │
│  • Evaluación NOM-035                                            │
│  • Benchmarking interno                                          │
│  • Recomendaciones de mejora continua                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 18. Modelo de Datos Conceptual

### Relaciones fundamentales

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  TENANT (Grupo Restaurantero)                                    │
│  ────────────────────────────                                    │
│  │                                                               │
│  ├── SUCURSAL (1:N)                                              │
│  │   ├── Área (cocina, barra, salón, almacén...)                │
│  │   ├── Equipo (refrigerador, freidora, campana...)            │
│  │   └── Inventario (producto, cantidad, ubicación)             │
│  │                                                               │
│  ├── EMPLEADO (puede rotar entre sucursales)                     │
│  │   ├── Rol (owner, director, gerente, supervisor, empleado,   │
│  │   │   chef corporativo, externo)                              │
│  │   ├── Documentos (contrato, INE, certificado médico...)       │
│  │   ├── Asistencia (entrada, salida, retardo)                   │
│  │   └── Turno (asignación semanal)                              │
│  │                                                               │
│  ├── WORKFLOW / PLAYBOOK                                         │
│  │   ├── Paso (acción específica, responsable, evidencia req.)  │
│  │   ├── Asignación (workflow → sucursal → empleado → fecha)    │
│  │   └── Ejecución (estado, evidencia, timestamp, verif. AI)    │
│  │                                                               │
│  ├── INCIDENTE                                                   │
│  │   ├── Tipo, severidad, estado                                 │
│  │   ├── Acciones (inmediatas, correctivas, preventivas)        │
│  │   └── Escalamiento                                            │
│  │                                                               │
│  ├── PRODUCTO (catálogo maestro)                                 │
│  │   ├── Proveedor                                               │
│  │   ├── Orden de compra                                         │
│  │   ├── Recepción                                               │
│  │   └── Movimiento de inventario (entrada, salida, ajuste)     │
│  │                                                               │
│  ├── RECETA                                                      │
│  │   ├── Ingrediente (producto, cantidad, unidad)                │
│  │   └── Costeo                                                   │
│  │                                                               │
│  ├── COMPLIANCE                                                  │
│  │   ├── Bitácora (tipo, fecha, evidencia)                      │
│  │   ├── Score (sucursal, área, período)                        │
│  │   └── Reporte (NOM-251, NOM-035, LFT, IMSS)                  │
│  │                                                               │
│  ├── VENTA (Módulo 13)                                           │
│  │   ├── Corte diario (sucursal, turno, fecha)                   │
│  │   ├── Canal (salón, delivery, eventos)                        │
│  │   └── Detalle (categoría, total, tickets)                     │
│  │                                                               │
│  ├── FISCAL (Módulo 15)                                          │
│  │   ├── CFDI emitido (tipo, UUID, receptor, monto)              │
│  │   ├── CFDI recibido (descarga SAT)                            │
│  │   └── Conciliación (OC ↔ Recepción ↔ Factura)                │
│  │                                                               │
│  ├── PAGO / GASTO (Módulo 16)                                    │
│  │   ├── Caja chica (sucursal, fondo, salidas)                   │
│  │   ├── Gasto operativo (categoría, monto, factura)             │
│  │   └── Calendario de pagos (vencimiento, estado)               │
│  │                                                               │
│  ├── CONTROL INTERNO (Módulo 17)                                 │
│  │   ├── Póliza contable (evento → cargo/abono)                  │
│  │   ├── Autorización (quién, qué, cuándo, monto)                │
│  │   └── Excepción (tipo, responsable, estado)                   │
│  │                                                               │
│  ├── PLAYBOOK DE APERTURA (Sección 4)                            │
│  │   ├── Fase (legal, montaje, reclutamiento, soft opening...)   │
│  │   └── Digital Twin (sucursal origen → sucursal nueva)        │
│  │                                                               │
│  └── NOTIFICACIÓN                                                │
│      ├── Canal (WhatsApp, email, in-app)                         │
│      ├── Template                                                 │
│      └── Preferencia (usuario, tipo, canal)                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 19. Dashboard Ejecutivo del Grupo

### Lo que el Owner ve al abrir Pulso cada mañana

```
┌─────────────────────────────────────────────────────────────────┐
│  GRUPO TAQUERÍA EL PARIÁN                  📅 15 Julio 2026     │
│  ────────────────────────────────────────────────────────────── │
│                                                                  │
│  ┌────────────────────┬────────────────────┬──────────────────┐ │
│  │ COMPLIANCE SCORE   │ MERMA PROMEDIO     │ INCIDENTES ACT.  │ │
│  │ ────────────────   │ ────────────────   │ ──────────────── │ │
│  │                    │                    │                  │ │
│  │    84.6 / 100      │      6.0%          │        3         │ │
│  │    🟡 Amarillo     │      🟢 OK         │       🟡         │ │
│  │    ↓ 3.2 vs mes ant│      ↓ 0.8 vs ant  │      ↓ 2 vs ant  │ │
│  └────────────────────┴────────────────────┴──────────────────┘ │
│                                                                  │
│  ┌────────────────────┬────────────────────┬──────────────────┐ │
│  │ COSTO ALIMENTOS    │ COSTO LABORAL      │ UTILIDAD OP. EST.│ │
│  │ ────────────────   │ ────────────────   │ ──────────────── │ │
│  │                    │                    │                  │ │
│  │  31.2% de venta    │  27.5% de venta    │   $142,300       │ │
│  │  🟡 (obj: 28-30%)  │  🟢 (obj: <30%)    │   🟢 todas suc.  │ │
│  │  ↑ 1.5 vs mes ant  │  ↓ 0.8 vs ant      │   ↑ 12% vs ant   │ │
│  └────────────────────┴────────────────────┴──────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ SUCURSALES                                     COMPLIANCE  │ │
│  │ ──────────                                     ──────────  │ │
│  │                                                             │ │
│  │  ● San Pedro      ████████████████████░ 97 🟢  Ver detalle │ │
│  │  ● Centro         ██████████████████░░░ 92 🟢  Ver detalle │ │
│  │  ● Cumbres        ██████████████████░░░ 91 🟢  Ver detalle │ │
│  │  ● Valle          ███████████████░░░░░░ 78 🟡  Ver detalle │ │
│  │  ● Contry         █████████████░░░░░░░░ 65 🔴  Ver detalle │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ P&L POR SUCURSAL (ESTIMADO, MES EN CURSO)                   │ │
│  │ ─────────────────────────────────────────                   │ │
│  │                                                             │ │
│  │              Venta    Alim%   Labor%  Gastos   Util. Est.  │ │
│  │  San Pedro   $182K   26% 🟢  31%      $18K     $60,400    │ │
│  │  Centro      $156K   28% 🟢  28% 🟢   $16K     $52,640    │ │
│  │  Cumbres     $143K   29% 🟡  29% 🟢   $15K     $44,530    │ │
│  │  Valle       $128K   31% 🟡  26% 🟢   $14K     $40,440    │ │
│  │  Contry      $94K    38% 🔴  35% 🔴   $18K     $8,380     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────────────────┬─────────────────────────────┐ │
│  │ ALERTAS (5)                  │ PREDICCIONES                │ │
│  │ ────────────                 │ ────────────                │ │
│  │                              │                             │ │
│  │ ⚠️ Contry: 5 tareas vencidas │ 🔮 Contry: 78% prob.       │ │
│  │    hoy (Ver)                 │    bajar de 80 en NOM       │ │
│  │                              │    → 4 acciones sugeridas   │ │
│  │ ⚠️ Valle: Refrigerador #2    │                             │ │
│  │     sin registro temperatura │ 🔮 Valle: gerente con       │ │
│  │     en 3 días (Ver)          │    riesgo de rotación       │ │
│  │                              │    → Programa retención     │ │
│  │ 🟡 Cumbres: 4 certificados   │                             │ │
│  │     médicos vencen en 7 días │ 🔮 Contry: costo alimentos  │ │
│  │     (Ver)                    │    podría llegar a 42% si   │ │
│  │                              │    no se corrige merma      │ │
│  │ 🔴 Contry: Proveedor nuevo   │                             │ │
│  │     "Dist. Económica" sin    │                             │ │
│  │     validación (Ver)         │                             │ │
│  │                              │                             │ │
│  │ 💰 $12,400 en pagos vencen   │                             │ │
│  │    esta semana (Ver)         │                             │ │
│  └──────────────────────────────┴─────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ TENDENCIA SEMANAL: Compliance por sucursal                  │ │
│  │ ─────────────────────────────────────                       │ │
│  │                                                             │ │
│  │  100 ┤     ●──●──●                                        │ │
│  │   95 ┤ ●──●         ●──●──●                               │ │
│  │   90 ┤                  ●      ●──●──●                    │ │
│  │   85 ┤                                                      │ │
│  │   80 ┤ ●──●──●──●──●──●──●                                │ │
│  │   75 ┤                  ●──●                               │ │
│  │   70 ┤                                                      │ │
│  │   65 ┤ ●──●──●──●──●──●──●                                │ │
│  │   60 ┤                                                      │ │
│  │      └──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──                   │ │
│  │        S1  S2  S3  S4  S5  S6  S7  S8  S9 S10              │ │
│  │                                                             │ │
│  │      ● San Pedro  ● Centro  ● Cumbres  ● Valle  ● Contry  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ FLUJO DE EFECTIVO PROYECTADO — PRÓXIMOS 30 DÍAS            │ │
│  │ ─────────────────────────────────────────────               │ │
│  │                                                             │ │
│  │  Entradas proyectadas:     $703,000 (ventas)                │ │
│  │  Salidas proyectadas:      $582,400                         │ │
│  │    • Nómina:               $218,000 (próx. quincena: día 15)│ │
│  │    • Cuentas por pagar:     $96,200 (14 facturas)           │ │
│  │    • Gastos operativos:    $164,300                         │ │
│  │    • Renta sucursales:     $103,900                         │ │
│  │                                                             │ │
│  │  Saldo proyectado:         +$120,600 🟢                     │ │
│  │                                                             │ │
│  │  ⚠️ Día 15: 4 pagos grandes coinciden ($62K).               │ │
│  │     ¿Deseas reprogramar alguno?                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Resumen de cambios vs. el diseño original (v1)

| Elemento | Original (v1) | v2 |
|----------|---------------|-----|
| Módulos | 12 | 17 |
| Roles | 6 | 7 |
| Ventas/POS | No cubierto | Módulo 13 — ingesta por WhatsApp/correo/CSV, integrado al cierre de sucursal |
| Delivery/Agregadores | No cubierto | Módulo 14 |
| Fiscal | No cubierto | Módulo 15 — motor de timbrado propio (FiscalAPI), CFDI de nómina, conciliación 3 vías vía SAT |
| Pagos y Gastos | No cubierto | Módulo 16 — caja chica, gasto operativo, flujo de efectivo, P&L por sucursal |
| Contabilidad y Control Interno | No cubierto | Módulo 17 — pólizas automáticas, segregación de funciones, doble autorización, bitácora anti-fraude |
| Chef Corporativo | No existía | Rol 7 — dueño de recetas, calidad y estándar de producto |
| Apertura de sucursal | Implícito en la tesis | Sección 4 — playbook explícito con Digital Twin |
| Empaquetamiento por tamaño | No definido | Sección 15 — 3 tiers (Starter/Growth/Scale) |
| Resiliencia offline | No cubierto | Sección 8 — cola local, notas de voz como evidencia |
| Adopción/comportamiento | Solo tono correctivo | Sección 9 — reconocimiento positivo, verificación de recencia, medición de fricción |
| Dashboard financiero | KPIs operativos solamente | Sección 18 — P&L por sucursal, flujo de efectivo, alertas de control interno |

---

*Documento de diseño completo del sistema Pulso para grupos restauranteros multi-sucursal — Versión 2.0.*
*Complementa a `pulso-thesis.md` (tesis), `pulso-estrategia-unificada.md` (estrategia), y `consultoria-business-model.md` (borrador histórico).*
*Extiende la v1 original con 5 módulos financieros, 1 rol nuevo, workflow de apertura, empaquetamiento por tier, resiliencia técnica y controles de adopción.*
