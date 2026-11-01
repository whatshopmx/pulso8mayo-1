# Implementation Plan: Operación IMSS — configuración, responsable y registro externo

**Fuente (diagnóstico):** lectura de `app/dashboard/compliance/imss/`, `components/compliance/imss-*`, `app/api/imss/`, `lib/services/compliance/imss-*`, `app/dashboard/company/branches/`, `lib/rbac/permissions.ts` y `lib/db/schema.ts`.
**Precede a este plan:** `tasks/plan-imss.md` (circuito archivo → acuse, cerrado 2026-10-25).
**Pregunta que resuelve:** *"¿dónde capturo el registro patronal IMSS?"* y *"¿qué pasa si el IMSS lo lleva el contador, un responsable interno o un despacho externo, y la empresa ni siquiera tiene IDSE?"*

---

## Contexto: qué hace hoy el módulo (para no re-diagnosticar)

El módulo **no se conecta a IDSE ni a SUA**. No hay credenciales, API ni scraping. El circuito real es:

```
perfil (NSS/CURP/RFC) + contrato (salario base) + sucursal (registro patronal)
        ↓
Pulso arma un .txt de trabajo  ──→  alguien lo sube al portal
        ↓                                   ↓
imss_files (sha256, R2 12 meses)      regresa un folio
        ↓                                   ↓
imss_movements = EN_ARCHIVO  ──→  humano registra acuse  ──→  CONFIRMADO
```

Regla vigente (`tasks/plan-imss.md:35`): **generar ≠ registrar**. Nada pasa a `CONFIRMADO` sin acuse humano.

Lo que el módulo **sí** asume hoy, y es el objeto de este plan:

1. La empresa tiene registro patronal capturado por sucursal.
2. Alguien con rol `ADMIN`/`SUPER_ADMIN` de Pulso sube el archivo y registra el folio.
3. La plantilla histórica se incorpora una sola vez con `adoptAsRegistered` (folio `MIGRACION`).
4. Toda empresa activa tiene obligación IMSS y ve deuda por cada empleado sin alta confirmada.

Los cuatro son falsos en una parte del mercado HORECA (contador externo, despacho, empresa en inicio de operaciones, sucursal en trámite).

---

## Diagnóstico

### Dónde se captura hoy el registro patronal

**Sidebar → Organización → Sucursales → clic en sucursal → pestaña "Información General" → tarjeta "Información Básica" → campo "Registro patronal IMSS".**

`app/dashboard/company/branches/[id]/page.tsx:377-390`.

Ahí está y ahí termina. Nada más en el producto lo menciona.

### Hallazgos

| # | Hallazgo | Ubicación |
|---|---|---|
| H1 | El campo de registro patronal **solo existe en la edición** de sucursal. No está en "Nueva Sucursal" ni en el listado. | `app/dashboard/company/branches/new/page.tsx:99-154`, `app/dashboard/company/branches/page.tsx:129-162` |
| H2 | El módulo IMSS muestra el bloqueo como **texto plano sin acción**: "Sucursal sin registro patronal IMSS", sin link ni botón a donde se corrige. | `components/compliance/imss-movements-page.tsx:57`, `imss-rules.ts:217` |
| H3 | `/dashboard/company` es solo `SUPER_ADMIN`/`ADMIN`; `GERENTE`/`SUPERVISOR` **sí** ven el módulo IMSS (`imssAccess`) pero reciben 403 en la pantalla donde se captura el dato. | `lib/rbac/permissions.ts:27-31` vs `lib/services/compliance/imss-http.ts:18-25` |
| H4 | `PATCH /api/branches/[id]` y `POST /api/branches` **no tienen guard de rol**: solo `requireTenant()` + verificación de pertenencia. Cualquier sesión de la empresa puede escribir la sucursal. | `app/api/branches/[id]/route.ts:25-46` |
| H5 | La API de creación **acepta** `imssRegistroPatronal`, pero el formulario nunca lo envía: las sucursales nacen sin registro. | `lib/validations/branch.ts:102` vs `branches/new/page.tsx:99-154` |
| H6 | No existe el estado "sin obligación IMSS" / "sin IDSE". `getDashboardSummary` cuenta **todo** empleado activo como movimiento requerido: una empresa sin IMSS ve 100% de deuda. | `lib/services/compliance/imss-movement-service.ts:111-131` |
| H7 | Confirmar acuse exige `SUPER_ADMIN`/`ADMIN`. `GERENTE`/`SUPERVISOR` pueden generar el archivo pero **no** confirmarlo, y un despacho no tiene forma de registrar el folio sin un `ADMIN` en Pulso. | `imss-http.ts:19`, `app/api/imss/files/[id]/route.ts:11` |
| H8 | No queda registro de **a quién** se envió el archivo ni **cuándo**. `imss_files` no tiene `sent_at`/`sent_to`/`operator_id`. | `lib/db/schema.ts:4148-4175` |
| H9 | La única vía para "ya estaba registrado" es `adoptAsRegistered` con folio `MIGRACION`: semánticamente es **carga histórica**, exige `branchId` + nota, solo cubre `ALTA` y no es recurrente. | `imss-movement-service.ts:360-405` |
| H10 | No hay evidencia adjunta: solo un `acuseFolio` string. Un rechazo no se puede diagnosticar con la constancia. | `lib/db/schema.ts:4160-4162` |
| H11 | `ensurePendingMovements` **no lo llama ninguna ruta** (solo tests). El ledger únicamente tiene filas de archivos que sí se generaron; no hay registro de movimientos hechos fuera. | `imss-movement-service.ts:277` (0 callers en `app/`) |
| H12 | El dispatcher de `lib/notifications/` es un **placeholder** que hace `console.log`; `lib/whatsapp/notification-dispatcher.ts` está deprecado y delega. El real es `lib/services/notification-dispatcher.ts`, pero exige `userId` y carga preferencias: **no puede notificar a un contacto externo sin cuenta**. Los envíos directos están en `lib/services/email-service.ts` (`sendEmail`, soporta adjuntos) y `lib/whatsapp/client-factory.ts` (`whatsappClient.sendMessage`). | `lib/notifications/notification-dispatcher.ts:25-30`, `lib/services/notification-dispatcher.ts:16-35,563`, `lib/services/email-service.ts:47-81` |
| H13 | No existe página de configuración de empresa (`app/dashboard/company/page.tsx` no existe) donde colgar el "modo de operación"; el grupo del sidebar apunta a una ruta sin página. | `components/app-sidebar.tsx:443-447` |

### Verificación rápida del diagnóstico (5 minutos, sin escribir nada)

1. `pnpm run dev` → entrar como `ADMIN`.
2. `/dashboard/compliance/imss` → confirmar que los KPIs muestran deuda aunque nadie haya configurado nada.
3. `/dashboard/compliance/imss/altas` → confirmar el bloqueo "Sucursal sin registro patronal IMSS" sin acción.
4. Buscar en toda la UI "registro patronal" → solo aparece dentro de una sucursal.
5. Entrar como `GERENTE` → `/dashboard/compliance/imss` abre; `/dashboard/company/branches/<id>` da 403.

---

## Decisiones de arquitectura

1. **El modo de operación es de la empresa, el registro patronal de la sucursal.**
   La obligación IMSS es del patrón (empresa); el registro se asigna por centro de trabajo (ya modelado en `branches.imssRegistroPatronal`). `companies.imssOperationMode` no sustituye al registro: lo contextualiza.

2. **Nunca inferir la obligación IMSS. Default = `POR_CONFIGURAR`.**
   Una empresa nueva no "debe" altas hasta que alguien declare su situación. Igual que la decisión 3 de `plan-imss` ("solo se confirma con evidencia"), aquí **solo se exige con declaración**.

3. **El responsable IMSS es una entidad propia, no un usuario de Pulso.**
   Darle `ADMIN` a un despacho es un problema de seguridad (acceso a toda la empresa) y acopla la operación a una persona. `imss_operators` (nombre, tipo interno/externo, contacto) permite cambiar de despacho sin tocar usuarios ni roles.

4. **Confirmar tiene tres vías explícitas y el ledger las distingue.**
   `ACUSE_ARCHIVO` (archivo generado en Pulso), `REGISTRO_EXTERNO` (el movimiento ya ocurrió fuera; recurrente) y `MIGRACION` (carga inicial). Hoy las tres colapsan en "CONFIRMADO" sin origen, así que no se puede auditar quién hizo qué.

5. **El envío es un hecho auditable, no un efecto secundario.**
   `imss_file_deliveries` registra cada entrega (canal, destinatario, quién, cuándo). Permite reenvíos y responde "yo nunca recibí ese archivo".

6. **La evidencia se guarda en R2 privado, no en `employee_documents`.**
   `employee_documents` es el expediente del empleado (`documentUrl` + `fileKey`), no está ligado a un movimiento de IMSS y no declara bucket privado ni retención. Un acuse rechazado exige los bytes exactos: bucket privado, hash y retención 12 meses, coherente con la decisión D2 de `plan-imss`.

7. **El link externo con token es preferible a un rol nuevo.**
   `plan-imss` D1 ya advirtió que agregar un `UserRole` reabre `hasAccess`, `getDefaultDashboard` y 30+ rutas. Un token de un solo archivo, con expiración, cubre al despacho sin abrir la puerta.

8. **Sin RLS en esta migración** (se sostiene la decisión 9/D5 de `plan-imss`): aislamiento por `companyId` en cada `WHERE` y en cada firma de servicio.

9. **Lo que este plan NO promete:** importabilidad del layout, cálculo de cuotas obrero-patronales, ni conexión con IDSE. El módulo sigue siendo capa de control y archivo de trabajo.

---

## Modelo de datos (migraciones `0124` y `0125`)

Dos migraciones para que cada fase cierre sola: `0124_imss_operacion.sql` (Phase 1–2) y `0125_imss_confirmacion.sql` (Phase 3). Última en `drizzle/`: `0123_rls_nomina.sql` (verificar el journal antes de generar). Sin `DROP`, sin `NOT NULL` sobre datos existentes, sin RLS.

### `0124_imss_operacion.sql`

```sql
-- 1. Modo de operación (empresa)
CREATE TYPE imss_operation_mode AS ENUM
  ('POR_CONFIGURAR', 'INTERNO', 'DESPACHO_EXTERNO', 'SIN_OBLIGACION');

ALTER TABLE companies
  ADD COLUMN imss_operation_mode imss_operation_mode NOT NULL DEFAULT 'POR_CONFIGURAR';

-- 2. Responsable IMSS (interno o despacho). NO es un usuario de Pulso.
CREATE TABLE imss_operators (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  nombre      text NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('INTERNO','EXTERNO')),
  email       text,
  whatsapp    text,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, nombre)
);
CREATE INDEX imss_operators_company_idx ON imss_operators (company_id, activo);

-- 3. Entrega del archivo al responsable
CREATE TABLE imss_file_deliveries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  file_id     uuid NOT NULL REFERENCES imss_files(id),
  operator_id uuid REFERENCES imss_operators(id),
  channel     text NOT NULL CHECK (channel IN ('DESCARGA_MANUAL','EMAIL','WHATSAPP','LINK')),
  sent_at     timestamptz NOT NULL DEFAULT now(),
  sent_by     text NOT NULL,
  note        text
);
CREATE INDEX imss_file_deliveries_file_idx ON imss_file_deliveries (company_id, file_id);
```

### `0125_imss_confirmacion.sql`

```sql
-- 4. Origen de la confirmación
CREATE TYPE imss_confirmation_source AS ENUM
  ('ACUSE_ARCHIVO', 'REGISTRO_EXTERNO', 'MIGRACION');

ALTER TABLE imss_movements ADD COLUMN confirmation_source      imss_confirmation_source;
ALTER TABLE imss_movements ADD COLUMN confirmation_ref         text;   -- folio IDSE o referencia libre
ALTER TABLE imss_movements ADD COLUMN confirmed_by_operator_id uuid REFERENCES imss_operators(id);
ALTER TABLE imss_movements ADD COLUMN registered_outside_at    timestamptz;

-- 5. Evidencia (constancia / acuse en PDF o imagen)
CREATE TABLE imss_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  file_id       uuid REFERENCES imss_files(id),
  movement_id   uuid REFERENCES imss_movements(id),
  storage_key   text NOT NULL,
  file_name     text NOT NULL,
  mime_type     text NOT NULL,
  content_sha256 text NOT NULL,
  size_bytes    integer,
  -- Puede subirla un usuario de Pulso o el externo por link con token.
  uploaded_by   text,
  operator_id   uuid REFERENCES imss_operators(id),
  uploaded_via  text NOT NULL CHECK (uploaded_via IN ('USUARIO','LINK_EXTERNO')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (file_id IS NOT NULL OR movement_id IS NOT NULL),
  CHECK ((uploaded_via = 'USUARIO' AND uploaded_by IS NOT NULL)
      OR (uploaded_via = 'LINK_EXTERNO' AND uploaded_by IS NULL))
);
CREATE INDEX imss_evidence_company_movement_idx ON imss_evidence (company_id, movement_id);
```

Backfill (no destructivo, dentro de `0125_imss_confirmacion.sql`):

```sql
UPDATE imss_movements
   SET confirmation_source = 'MIGRACION'
 WHERE status = 'CONFIRMADO' AND file_id IS NULL;

UPDATE imss_movements
   SET confirmation_source = 'ACUSE_ARCHIVO'
 WHERE status = 'CONFIRMADO' AND file_id IS NOT NULL;
```

Empresas existentes: quedan en `POR_CONFIGURAR` (no se infiere). El onboarding se las pide en el primer acceso.

---

## Task List

### Phase 0 — Configuración visible (resuelve "no sé dónde ponerlo")

Sin migración. Solo usa columnas existentes. **Se puede desplegar solo.**

> Antes de T2 se ejecuta **T21** (guard de `/api/branches`). Está listada en Phase 4 por tema, no por orden.

- [ ] **Task 1 (S).** `GET /api/imss/config`: devuelve `{ mode: 'POR_CONFIGURAR', primaRiesgoTrabajo, branches: [{ id, name, imssRegistroPatronal, active, employees }], canConfigure }`, con `companyId` del tenant y alcance de sucursal (`imssBranchScope`). `mode` va hardcodeado hasta T8 (la columna no existe antes de `0124`).
  **Aceptación:** el conteo de empleados por sucursal excluye `TERMINATED`/`RESIGNED`; no filtra sucursales de otra empresa.
  **Verificación:** integración con dos empresas; la segunda ve solo las suyas.
  **Dependencias:** ninguna. **Archivos:** `app/api/imss/config/route.ts` (nuevo).

- [ ] **Task 2 (S).** `PATCH /api/imss/config`: acepta `{ imssRegistroPatronal?, branchUpdates?: [{ branchId, imssRegistroPatronal }] }` con `requireRoleApi(['SUPER_ADMIN','ADMIN'])`, valida con la misma regla de `imssRegistroPatronalSchema` (`lib/validations/branch.ts:4-6`, hoy local: exportarla o reusar `isRegistroPatronal`), escribe auditoría por sucursal. No reusar `updateBranchSchema` completo: arrastra `superRefine` de franquicia.
  **Alcance (Q2):** en Phase 0 solo `SUPER_ADMIN`/`ADMIN`, y `ADMIN` escribe cualquier sucursal de la empresa. T20 agrega `compliance.imss.configure` para que un `GERENTE` capture **solo la suya** (`imssBranchScope`). La restricción se aplica en el servidor, no en la UI.
  **Aceptación:** valor inválido → 400; rol sin permiso → 403; `""` limpia a `NULL`; cada cambio queda en `AuditService`.
  **Verificación:** integración de los tres casos + revisión de la fila de auditoría.
  **Dependencias:** T1. **Archivos:** `app/api/imss/config/route.ts`, `lib/services/compliance/imss-config-service.ts` (nuevo).

- [ ] **Task 3 (M).** Pestaña **"Configuración"** en el submódulo IMSS (`/dashboard/compliance/imss/configuracion`) con lista de sucursales, edición inline del registro patronal, contador "2 de 4 configuradas", badge "Sin registro" y `aria-live` al guardar. Se agrega a `IMSS_SECTIONS`.
  **Aceptación:** se puede capturar el registro sin salir del módulo; el guardado refresca los KPIs sin recargar; navegable con teclado; `READONLY` puede ver la pantalla pero no editar (lo decide `canConfigure`, no el rol del sidebar).
  **Verificación:** prueba en navegador con 2 sucursales, una configurada y una no, y con un usuario `READONLY`.
  **Dependencias:** T1, T2. **Archivos:** `app/dashboard/compliance/imss/configuracion/page.tsx`, `components/compliance/imss-config-page.tsx` (nuevo), `components/compliance/imss-sub-nav.tsx`.

- [ ] **Task 4 (S).** Campo "Registro patronal IMSS" en **Nueva Sucursal** (opcional) y badge "Sin registro patronal" en la tarjeta del listado de sucursales.
  **Aceptación:** una sucursal creada con el dato lo persiste; sin el dato se crea igual y muestra el badge.
  **Verificación:** crear sucursal con y sin el campo; `GET /api/branches`.
  **Dependencias:** ninguna (paralelizable). **Archivos:** `app/dashboard/company/branches/new/page.tsx` (agregar el campo a `formData`), `app/dashboard/company/branches/page.tsx` (badge). La API ya lo acepta.

- [ ] **Task 5 (S).** El motivo de bloqueo `SIN_REGISTRO_PATRONAL` se vuelve **acción**: enlace a Configuración si `canConfigure`, texto explicativo con nombre de sucursal si no. Aplica a Altas y Bajas.
  **Aceptación:** un `GERENTE` no ve un link muerto: ve "Pide a un administrador que capture el registro de la sucursal X".
  **Verificación:** manual con `ADMIN` y `GERENTE`.
  **Dependencias:** T3. **Archivos:** `components/compliance/imss-movements-page.tsx`, `components/compliance/imss-client.ts` (`imssReason` con contexto).

- [ ] **Task 6 (S).** Estado de configuración previo a la tabla: si ninguna sucursal tiene registro, Resumen y Altas muestran un banner de arranque ("Configura tu registro patronal para empezar") con CTA, en vez de N filas bloqueadas.
  **Aceptación:** con 0 configuradas no se listan empleados bloqueados; con ≥1 se comporta como hoy.
  **Verificación:** manual en los dos estados.
  **Dependencias:** T3. **Archivos:** `components/compliance/imss-status.tsx`, `app/dashboard/compliance/imss/page.tsx`.

> **Checkpoint Phase 0:** el registro patronal se captura desde el módulo IMSS; el bloqueo tiene salida; `pnpm run build` y `pnpm test:unit` verdes. **Sin migración: deployable.**

### Phase 1 — Modo de operación y estados honestos

- [ ] **Task 7 (S).** Migración `0124_imss_operacion.sql`: `imss_operation_mode` + `companies.imss_operation_mode` + tabla `imss_operators` (en `lib/db/schema/core.ts`, junto a `companies`) y tabla `imss_file_deliveries` (en `lib/db/schema.ts`, junto a `imssFiles`, que es donde vive el resto del módulo).
  **Aceptación:** `pnpm db:generate` no propone `DROP`; aplica idempotente en base de prueba; `tsc --noEmit` limpio.
  **Verificación:** revisión manual del `.sql` + `pnpm test:integration` (setup).
  **Dependencias:** Checkpoint 0. **Archivos:** `drizzle/0124_imss_operacion.sql`, `lib/db/schema/core.ts`, `lib/db/schema.ts`.

- [ ] **Task 8 (S).** `getDashboardSummary` y `/api/imss/summary` devuelven `enabled` y `mode`. `SIN_OBLIGACION` → `enabled:false`, contadores en `—` (no `0`), sin tabla de movimientos.
  **Aceptación:** una empresa en `SIN_OBLIGACION` no ve "altas pendientes: 80"; ve el estado declarado y cómo cambiarlo.
  **Verificación:** unitaria del servicio + manual en la pantalla.
  **Dependencias:** T7. **Archivos:** `lib/services/compliance/imss-movement-service.ts`, `app/api/imss/summary/route.ts`, `components/compliance/imss-status.tsx`.

- [ ] **Task 9 (M).** Selector de modo en Configuración: tarjetas de radio con la **consecuencia escrita** de cada uno. Cambiar a `SIN_OBLIGACION` exige confirmación explícita (diálogo con texto) y deja fila de auditoría con actor y motivo.
  **Aceptación:** no se puede activar `SIN_OBLIGACION` con un clic; el cambio queda auditado; se puede revertir.
  **Verificación:** manual de ida y vuelta + revisión de auditoría.
  **Dependencias:** T7, T8. **Archivos:** `components/compliance/imss-config-page.tsx`, `app/api/imss/config/route.ts`.

- [ ] **Task 10 (S).** Onboarding de 3 pasos cuando `mode === 'POR_CONFIGURAR'`: (1) situación IMSS, (2) registro patronal por sucursal, (3) responsable. Bloquea las tablas de movimientos hasta completarlo, con opción "lo hago después".
  **Aceptación:** una empresa nueva no ve una tabla de deuda antes de declarar su situación.
  **Verificación:** manual con una empresa recién creada.
  **Dependencias:** T9. **Archivos:** `app/dashboard/compliance/imss/page.tsx`, `components/compliance/imss-onboarding.tsx` (nuevo).

> **Checkpoint Phase 1:** el módulo distingue "no tengo IMSS", "no lo he configurado" y "tengo deuda real". Migración `0124` aplicada con GO explícito.

### Phase 2 — Responsable y entrega del archivo

- [ ] **Task 11 (S).** CRUD de responsables: `GET/POST/PATCH /api/imss/operators` (rol `ADMIN`), validación de email/WhatsApp, borrado lógico (`activo=false`), auditoría.
  **Aceptación:** no se puede borrar un responsable con entregas (se desactiva); aislamiento por `companyId`.
  **Verificación:** integración de alta, edición, desactivación y aislamiento.
  **Dependencias:** T7. **Archivos:** `app/api/imss/operators/route.ts`, `lib/services/compliance/imss-operator-service.ts`.

- [ ] **Task 12 (M).** `POST /api/imss/files/[id]/deliver`: registra la entrega y, si hay canal, envía. Para el externo usar **envío directo**, no el dispatcher: `sendEmail({ to, subject, html, attachments })` de `lib/services/email-service.ts` y `whatsappClient.sendMessage(...)` de `lib/whatsapp/client-factory.ts` con la sesión del tenant. Adjunta el `.txt` si `downloadAvailable`; si no, manda el aviso sin archivo y lo declara.
  **Aceptación:** la entrega queda en `imss_file_deliveries` aun si el envío falla; un fallo de proveedor no rompe la transacción del archivo; `READONLY` → 403.
  **Verificación:** integración con `sendEmail`/`whatsappClient` mockeados + revisión de la fila con canal y resultado.
  **Dependencias:** T11.
  **Nota:** `NotificationDispatcher.sendNotification` (`lib/services/notification-dispatcher.ts:563`) resuelve destinatario, preferencias y plantilla por `userId`; un despacho sin cuenta no encaja. No forzarlo con un usuario falso.
  **Archivos:** `app/api/imss/files/[id]/deliver/route.ts`, `lib/services/compliance/imss-delivery-service.ts`.

- [ ] **Task 13 (S).** UI en Reportes: columna "Última entrega" (destinatario + fecha) y acción "Enviar a…" con selector de responsable y canal.
  **Aceptación:** se ve a quién se mandó y cuándo; reenviar agrega una fila, no sobrescribe.
  **Verificación:** manual con dos envíos.
  **Dependencias:** T12. **Archivos:** `components/compliance/imss-reports-page.tsx`.

- [ ] **Task 14 (M).** Link de acuse para externos: token firmado, un archivo, expiración 15 días, formulario mínimo (aceptado/rechazado, folio, motivo, evidencia). Reutiliza el patrón de `signAdoptionPreview`/`verifyAdoptionPreview`.
  **Aceptación:** el token solo permite operar sobre ese `fileId` y esa empresa; expirado → 410; no expone otros archivos.
  **Verificación:** integración: token válido, token de otro archivo, token expirado, token manipulado.
  **Dependencias:** T12.
  **Nota de implementación:** `proxy.ts:210-212` solo intercepta `/dashboard`, `/api` y `/onboarding`; una página en `/acuse-imss/[token]` queda pública sin tocar el matcher. Las rutas `/api/*` sin sesión **no se rechazan** (solo se rate-limitean, `proxy.ts:89-132`), así que el endpoint del token debe validar el token por sí mismo y limitar intentos.
  **Archivos:** `lib/services/compliance/imss-acuse-token.ts` (nuevo), `app/api/imss/acuse/[token]/route.ts`, `app/acuse-imss/[token]/page.tsx`.

> **Checkpoint Phase 2:** el archivo se entrega con registro y el despacho puede devolver el acuse sin usuario `ADMIN`.

### Phase 3 — Registro externo recurrente y evidencia

- [ ] **Task 15 (S).** Migración `0125_imss_confirmacion.sql`: `confirmation_source`, `confirmation_ref`, `confirmed_by_operator_id`, `registered_outside_at`, tabla `imss_evidence` + backfill.
  **Aceptación:** ningún movimiento `CONFIRMADO` queda sin `confirmation_source`; el backfill no toca `EN_ARCHIVO`/`PENDIENTE`.
  **Verificación:** conteo antes/después en base de prueba.
  **Dependencias:** T7. **Archivos:** `drizzle/0125_imss_confirmacion.sql`, `lib/db/schema.ts`.

- [ ] **Task 16 (M).** `ImssMovementService.registerExternal(companyId, input, actorId)`: marca `CONFIRMADO` con `confirmation_source='REGISTRO_EXTERNO'`, `fileId=NULL`, `confirmation_ref` y operador. Idempotente por la llave existente; rechaza sobrescribir un `ACUSE_ARCHIVO`.
  **Aceptación:** no crea `imss_files`; no pisa un acuse real; dos llamadas idénticas no duplican.
  **Verificación:** integración: alta externa, reintento, intento sobre movimiento confirmado por archivo.
  **Dependencias:** T15. **Archivos:** `lib/services/compliance/imss-movement-service.ts`.

- [ ] **Task 17 (S).** Acción **"Ya se registró fuera de Pulso"** en Altas y Bajas: selección, fecha real, operador, referencia, nota y evidencia obligatoria. Copy explícito de que **no** es la incorporación histórica.
  **Aceptación:** no se puede confirmar sin evidencia; el flujo de `MIGRACION` sigue visible y separado.
  **Verificación:** manual + integración de la ruta.
  **Dependencias:** T16. **Archivos:** `components/compliance/imss-external-registration-dialog.tsx` (nuevo), `components/compliance/imss-movements-page.tsx`.

- [ ] **Task 18 (S).** `POST /api/imss/evidence` + `GET /api/imss/evidence/[id]`: subida a R2 privado con sha256 y retención 12 meses; descarga por rol; rechazo de MIME no permitido (PDF/JPG/PNG) y tamaño máximo.
  **Aceptación:** el hash guardado coincide con el archivo; sin R2 configurado se responde 503, no se finge un guardado.
  **Verificación:** integración con R2 mockeado + prueba de MIME inválido.
  **Dependencias:** T15. **Archivos:** `app/api/imss/evidence/route.ts`, `lib/storage/r2-client.ts` (reutilizado).

- [ ] **Task 19 (S).** `confirmFile` estampa `ACUSE_ARCHIVO`; `adoptAsRegistered` estampa `MIGRACION`. Sin cambios de contrato para los consumidores.
  **Aceptación:** los tres orígenes son distinguibles en la base; los tests existentes siguen verdes.
  **Verificación:** `pnpm test:unit -- imss` + integración del flujo.
  **Dependencias:** T15, T16. **Archivos:** `imss-movement-service.ts`.

> **Checkpoint Phase 3:** los movimientos hechos fuera de Pulso dejan de aparecer como deuda eterna, con evidencia y responsable.

### Phase 4 — RBAC, honestidad y cierre

- [ ] **Task 20 (S).** Permisos puntuales `compliance.imss.configure` y `compliance.imss.acknowledge`, verificados en el handler, **sin** agregar valores a `UserRole` (D1 de `plan-imss`). `canConfigure`/`canAcknowledge` salen del mismo helper que ya usa `imssAccess`.
  **Aceptación:** un `GERENTE` con el permiso captura el registro de su sucursal; sin el permiso, 403.
  **Verificación:** unitaria del helper + integración de las dos rutas.
  **Dependencias:** T2, T14. **Archivos:** `lib/services/compliance/imss-http.ts`, `lib/rbac/permissions.ts`.

- [ ] **Task 21 (S).** Cerrar H4: `POST /api/branches` y `PATCH /api/branches/[id]` con guard de rol. No se puede desplegar T2 sin esto (sería una escalada de privilegios nueva).
  **Aceptación:** `EMPLEADO`/`READONLY` → 403; `ADMIN` → 200; no rompe la edición actual de sucursal.
  **Verificación:** integración de los tres roles.
  **Dependencias:** ninguna. **Archivos:** `app/api/branches/route.ts`, `app/api/branches/[id]/route.ts`.

- [ ] **Task 22 (S).** Copy y docs honestos: "Pulso no envía nada al IDSE; registra lo que tú o tu despacho hicieron"; actualizar `docs/business-invariants.md:3.9`, `PROJECT_CONTEXT.md` y una nota de continuidad en `tasks/plan-imss.md`.
  **Aceptación:** ninguna pantalla promete conexión con IDSE, importabilidad ni acuses automáticos.
  **Verificación:** lectura de docs + grep de "IDSE" en las pantallas.
  **Dependencias:** T13, T17. **Archivos:** docs + 4 pantallas.

- [ ] **Task 23 (S).** Integración end-to-end nueva: `SIN_OBLIGACION` no genera deuda → configurar → entrega → acuse por link → `REGISTRO_EXTERNO` en paralelo → aislamiento entre dos empresas.
  **Aceptación:** el test falla si se rompe cualquiera de T8–T19.
  **Verificación:** `pnpm test:integration`.
  **Dependencias:** todas. **Archivos:** `tests/integration/imss-operation.test.ts` (nuevo).

- [ ] **Task 24 (XS).** Añadir el campo faltante `companies.imssPrimaRiesgoTrabajo` a la pantalla de Configuración y aceptarlo en el `PATCH` de T2 (columna ya existe, no se usa en cálculo).
  **Aceptación:** se guarda y se muestra; la UI aclara que no alimenta cuotas.
  **Verificación:** manual.
  **Dependencias:** T3. **Archivos:** `components/compliance/imss-config-page.tsx`, `app/api/imss/config/route.ts`.

> **Checkpoint final:** una empresa sin IMSS no ve deuda falsa; una con despacho puede entregar, delegar el acuse y registrar movimientos externos con evidencia; el origen de cada confirmación es auditable.

---

## Riesgos y mitigación

| Riesgo | Impacto | Mitigación |
|---|---|---|
| `SIN_OBLIGACION` se usa para "apagar" el módulo y ocultar incumplimiento real | Alto | Confirmación explícita, auditoría con actor y motivo, y el estado sigue visible en el Resumen (no se borra) |
| El link de acuse externo se filtra | Alto | Token de un solo archivo, expiración 15 días, revocable, sin listar otros archivos, `no-store` |
| `PATCH /api/branches` sin guard (H4) se explota antes de T21 | Alto | T21 se ejecuta **antes** de T2 y se despliega solo; no esperar a la migración |
| Duplicar evidencia en `employee_documents` y en R2 privado | Medio | `imss_evidence` es la única fuente; no se toca `employee_documents` |
| Backfill marca mal un `CONFIRMADO` histórico | Medio | Solo `file_id IS NULL` → `MIGRACION`, `file_id NOT NULL` → `ACUSE_ARCHIVO`; verificación por conteo |
| El envío por WhatsApp/email falla y se pierde el registro | Medio | La entrega se registra antes del intento; el fallo se reporta, no revierte |
| `0124`/`0125` en producción con 173+ tablas | Medio | Sin `DROP`, columnas nullable o con default, backfill acotado, revisión manual de cada `.sql` |
| Se usa el `NotificationDispatcher` placeholder (H12) | Bajo | T12 lo prohíbe explícitamente; el envío va por `whatsappClient` (`client-factory`) y `email-service` |

---

## Decisiones resueltas (2026-10-30)

Las seis quedaron cerradas con la recomendación del plan. No hay bloqueos de producto pendientes; solo queda el **GO explícito** antes de aplicar cada migración.

### Q1 — El modo de operación es por empresa

La obligación IMSS es del patrón, no del centro de trabajo. El registro patronal ya vive por sucursal (`branches.imssRegistroPatronal`) y sigue siendo el dato que determina a qué registro se envía cada archivo. Un modo por sucursal obligaría a declarar "esta sucursal no tiene IMSS" cuando el problema real es de la empresa completa, y multiplicaría la configuración sin aportar precisión.

**Implementación:** `companies.imssOperationMode` (`0124`, T7). Los flags por sucursal no se agregan.

**Salida si un cliente lo exige:** una columna `branches.imssOperationOverride` nullable que solo puedan escribir `SUPER_ADMIN`, con el modo de empresa como default. No se implementa ahora.

### Q2 — Captura el registro patronal: `ADMIN` por default, `GERENTE` con permiso puntual

`ADMIN`/`SUPER_ADMIN` pueden siempre. `GERENTE` puede **solo si** tiene `compliance.imss.configure`, y **solo sobre su sucursal** (el `imssBranchScope` ya existe y no se relaja). `SUPERVISOR` y `READONLY` no capturan.

El motivo: hoy `GERENTE` ve el bloqueo y no puede resolverlo, pero abrir `/dashboard/company` a `GERENTE` le daría acceso a plan, facturación y configuración de toda la empresa. El permiso puntual da la capacidad sin mover el rol.

**Implementación:** T20 (helper en `imss-http.ts`) + T2 (`PATCH /api/imss/config`). Sin valores nuevos en `UserRole`.

### Q3 — El despacho entra por link con token, no por usuario `EXTERNO`

Un rol nuevo reabre `hasAccess`, `getDefaultDashboard` y las 30+ rutas que enumeran roles (ya advertido en `plan-imss` D1). Además, un usuario `EXTERNO` tendría que pertenecer a una empresa y convivir con el modelo multi-tenant para hacer una sola cosa.

**Implementación:** T14. Token firmado, un archivo, 15 días, revocable, con `no-store`. El endpoint valida el token por sí mismo porque `proxy.ts` no rechaza `/api/*` sin sesión.

**Límite explícito:** el token no da acceso al dashboard ni a otros archivos. Si el cliente necesita que el despacho vea el historial completo, eso es un portal de externos, un módulo aparte.

### Q4 — La evidencia es obligatoria en `REGISTRO_EXTERNO`

Sin evidencia es una declaración sin prueba, que es exactamente lo que el módulo vino a eliminar. La constancia o acuse del IDSE es lo único que distingue "el contador lo hizo" de "alguien marcó la casilla".

**Implementación:** T17 (bloquea el guardado sin al menos una evidencia) + T18 (subida a R2 privado con hash). Se aceptan PDF/JPG/PNG con tamaño máximo.

**Salida si el cliente no tiene la constancia a mano:** permitir guardar el movimiento como `EN_ARCHIVO` sin folio y con nota, pero **no** como `CONFIRMADO`. La deuda no se cierra sin prueba.

### Q5 — `SIN_OBLIGACION` se permite con empleados activos, con confirmación explícita

Bloquearlo empuja a borrar o desactivar empleados para "limpiar" la pantalla, que es peor: destruye el dato de plantilla para esconder un estado declarativo. El estado se declara, se audita y se puede revertir; el Resumen lo sigue mostrando.

**Implementación:** T9 (diálogo con texto de confirmación + auditoría con actor y motivo) + T8 (KPIs en `—`, no en `0`).

**Condición:** el banner del módulo dice explícitamente que la empresa declaró no tener obligación IMSS, y la fecha/actor de esa declaración quedan visibles. No es un interruptor silencioso.

### Q6 — `MIGRACION` se queda, renombrada en la UI

Son dos hechos distintos y deben seguir siendo dos orígenes distintos en la base:

- `MIGRACION` = carga inicial de una plantilla que ya estaba registrada antes de Pulso. Una vez, con `branchId` y nota obligatoria.
- `REGISTRO_EXTERNO` = el despacho o el responsable hizo el movimiento esta semana. Recurrente, con evidencia y operador.

**Implementación:** T19 (cada flujo estampa su origen) + T17/T22 (copy: "Carga inicial de plantilla" vs "Ya se registró fuera de Pulso"). No se fusionan y no se renombra el valor en la base.

---

## Gates: Phase 0 sin migración, fases 1–3 con migración

Phase 0 **no** toca la base y resuelve la pregunta original ("¿dónde se captura?"). Se puede cerrar y desplegar sin GO de migración.

Antes de aplicar `0124` o `0125` se exige:

| Verificación | Criterio |
|---|---|
| `npx tsc --noEmit` | limpio |
| `pnpm test:unit` | verde |
| `pnpm run build` | OK |
| `pnpm test:integration` | verde, incluido `imss-operation.test.ts` |
| Revisión de `0124_imss_operacion.sql` y `0125_imss_confirmacion.sql` | sin `DROP`, sin `NOT NULL` sin default, backfill verificado por conteo |
| GO explícito del humano | obligatorio antes de aplicar cada migración, una por fase |

---

## Orden de ejecución sugerido

1. **T21** (cerrar H4) — seguridad primero, deployable solo.
2. **Phase 0 completa** (T1–T6) — resuelve el problema reportado, sin migración.
3. **Phase 1** (T7–T10) — migración `0124` con GO.
4. **Phase 2** (T11–T14) — entrega y acuse externo.
5. **Phase 3** (T15–T19) — migración `0125` con GO; registro externo y evidencia.
6. **Phase 4** (T20, T22–T24) — RBAC, docs y cierre.

Las decisiones Q1–Q6 están cerradas (sección anterior); no hay paso de definición pendiente.

Cada fase termina con `pnpm run build` verde y evidencia en `tasks/evidencia/imss-operacion-<fecha>/README.md`, como en las fases anteriores.
