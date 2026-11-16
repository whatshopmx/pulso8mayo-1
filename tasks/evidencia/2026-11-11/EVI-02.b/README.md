# Certificación de Implementación — Frente C3 (`EVI-02.b`)

**Identificador:** `EVI-02.b`  
**Nombre:** Conectar evidencia al recorrido visible de EXCEPTION  
**Fecha:** 2026-11-15T21:28:00Z  
**Responsable:** `worker_c3_1` (Teamwork Implementer & QA)  
**Entorno de Verificación:** Local + Neon Postgres aislado (`.env.test`, `ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech`, rol `pulso_app` con `NOBYPASSRLS`)

---

## 1. Resumen Ejecutivo

El frente C3 (`EVI-02.b`) conecta de punta a punta la gestión de evidencias auditables al recorrido visible de **Excepciones Operativas (`EXCEPTION`)** en el Centro de Excepciones & Riesgos QSR. Esto desbloquea el Caso transversal 05.C1 (discrepancias en arqueo de caja con sobrante/faltante), el Módulo 05 (`VAL-01.M01-M17.M05`), y la trazabilidad de inocuidad en cumplimiento NOM-251 (`CMP-01`).

Se implementó el ciclo completo:
1. **Ruta API Dedicada (`app/api/exceptions/[id]/evidence/route.ts`)**:
   - `GET`: Consulta de evidencias activas de la excepción con generación de URLs prefirmadas y cabecera HTTP `Cache-Control: private, no-store`.
   - `POST`: Carga de evidencia vía `multipart/form-data` o `application/json` con validación estricta de tamaño (<= 10MB) y tipos MIME permitidos.
   - `DELETE`: Retiro por borrado lógico (`deleted_at = NOW()`), garantizando inmutabilidad histórica.
2. **Componente Visual Modal (`components/exceptions/exception-evidence-dialog.tsx`)**:
   - Galería de evidencias activas con iconos por tipo de documento/imagen, fecha relativa, enlace de visualización/descarga y botón de retiro.
   - Zona de arrastrar y soltar (drag & drop) o selector de archivos con validación en cliente (tamaño <= 10MB y MIME permitido).
   - Indicadores visuales de estado y feedback interactivo mediante toasts.
3. **Conexión al Ciclo de Vida Visible (`components/exceptions/exception-lifecycle-actions.tsx`)**:
   - Botón visible "Evidencias" (variante outline/ghost con icono `Paperclip`) integrado en la barra de acciones de la excepción.
   - Montaje del modal `ExceptionEvidenceDialog`, preservando íntegramente las transiciones legales existentes (`allowedEvents`).
4. **Batería de Pruebas de Integración (`tests/integration/evidence-exception-route-db.test.ts`)**:
   - 9 pruebas de integración ejecutadas contra Neon Postgres real bajo rol `pulso_app` sin bypass de RLS (100% exitosas).

---

## 2. Asignación Disjunta Estricta de Archivos (5 Archivos)

| Archivo | Estado | Responsabilidad |
|---|---|---|
| `app/api/exceptions/[id]/evidence/route.ts` | **NUEVO** | Handler REST App Router (GET, POST, DELETE) con autenticación multi-tenant y acotamiento de sucursal. |
| `components/exceptions/exception-evidence-dialog.tsx` | **NUEVO** | Modal interactivo "use client" para visualizar, subir y retirar evidencias. |
| `components/exceptions/exception-lifecycle-actions.tsx` | **MODIFICADO** | Integración del disparador visible "Evidencias" en la barra de ciclo de vida. |
| `tests/integration/evidence-exception-route-db.test.ts` | **NUEVO** | Suite de pruebas de integración V2 (DB directa) y V3 (Ruta HTTP) en Neon Postgres aislado. |
| `tasks/evidencia/2026-11-11/EVI-02.b/README.md` | **NUEVO** | Certificación técnica, especificación y reporte de aceptación. |

*Restricciones respetadas:* Cero archivos tocados fuera de los 5 asignados. Cero migraciones abiertas. Cero cambios en esquemas Drizzle o journals.

---

## 3. Especificación Técnica de la API

### Endpoint: `/api/exceptions/[id]/evidence`

#### `GET` — Consultar evidencias
- **Autenticación:** Obligatoria (`requireTenantAuth`).
- **Permisos:** Requiere permiso `exceptions: read` o `manage`.
- **Comportamiento:**
  - Invoca `EvidenceSubjectService.getEvidenceForSubject`.
  - Enriquece cada elemento con su URL prefirmada si R2 está configurado o su URL canónica/local.
  - Añade cabecera HTTP `Cache-Control: private, no-store`.
- **Respuesta 200 OK:**
  ```json
  {
    "success": true,
    "items": [
      {
        "id": "uuid",
        "entityType": "EXCEPTION",
        "entityId": "uuid-excepcion",
        "mimeType": "image/png",
        "resolvedUrl": "https://...",
        "createdAt": "2026-11-15T21:00:00.000Z"
      }
    ],
    "total": 1
  }
  ```

#### `POST` — Adjuntar evidencia
- **Autenticación:** Obligatoria (`requireTenantAuth`).
- **Permisos:** Requiere permiso `exceptions: update` o `manage`. Roles como `EMPLEADO` reciben `403 Forbidden`.
- **Formatos:** `multipart/form-data` y `application/json`.
- **Validaciones:**
  - Tamaño máximo: 10MB (10,485,760 bytes). Solicitudes mayores devuelven `413 Payload Too Large`.
  - Tipos MIME permitidos: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `application/pdf`, `text/plain`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
  - Extensiones peligrosas (`.exe`, `.bat`, `.sh`, `.js`, etc.) rechazadas con `400 Bad Request`.
- **Almacenamiento:**
  - Si R2 está configurado (`isR2Configured()`), sube el buffer a R2 bajo la clave canónica:
    `companies/${companyId}/branches/${branchId}/exception/${entityId}/${evidenceId}`
  - Si R2 no está configurado (modo dev/test), registra la clave canónica y URL `local://exceptions/${id}/${fileName}` sin invocar el cliente de red.
- **Respuesta 201 Created:**
  ```json
  {
    "success": true,
    "evidence": {
      "id": "uuid-evidencia",
      "entityType": "EXCEPTION",
      "entityId": "uuid-excepcion",
      "mimeType": "image/png",
      "url": "..."
    }
  }
  ```

#### `DELETE` — Retiro de evidencia (Soft-delete)
- **Autenticación:** Obligatoria (`requireTenantAuth`).
- **Permisos:** Requiere permiso `exceptions: update` o `manage`. `EMPLEADO` recibe `403 Forbidden`.
- **Parámetros:** `evidenceId` vía searchParam (`?evidenceId=...`) o cuerpo JSON.
- **Comportamiento:** Marca la fila con `deleted_at = NOW()` mediante `EvidenceSubjectService.removeEvidence`.
- **Respuesta 200 OK:**
  ```json
  {
    "success": true,
    "removedId": "uuid-evidencia"
  }
  ```

---

## 4. Arquitectura de Aislamiento y Seguridad

1. **Aislamiento Multi-Tenant:**
   - La pertenencia a la empresa se extrae de la sesión autenticada (`user.companyId`), jamás de parámetros de entrada.
   - Peticiones de un usuario de una empresa contra una excepción de otra empresa devuelven estrictamente `404 Not Found` (fail-closed, previniendo fuga de existencia).
2. **Acotamiento de Sucursal (Branch Scoping):**
   - Un `GERENTE` acotado a la sucursal A1 no puede consultar, adjuntar ni retirar evidencias de excepciones pertenecientes a la sucursal A2 (`404 Not Found`).
   - Un `ADMIN` corporativo tiene alcance global sobre todas las sucursales de su empresa.
3. **Seguridad en Almacenamiento:**
   - Las claves de objeto en R2 validan contra anti-traversal (`..`) y validan el prefijo canónico inmutable.
   - Las URLs de visualización son prefirmadas temporales con expiración (`EVIDENCE_URL_TTL_SECONDS = 900s`).
4. **Auditoría Inmutable:**
   - Todo borrado es lógico (`deleted_at IS NOT NULL`). Las evidencias históricas se conservan en la base de datos para requerimientos fiscales o auditorías de inocuidad.

---

## 5. Resultados de Verificación

### 1. Pruebas de Integración en Base de Datos Real (`vitest.integration.config.ts`)
Comando ejecutado:
```powershell
pnpm vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/evidence-exception-route-db.test.ts
```
Resultado: **9 de 9 pruebas pasadas exitosamente (100%)**
- `✓ V2 DB: Persistencia directa y soft-delete con EvidenceSubjectService en excepción real`
- `✓ V3 Route POST: Subida de archivo multipart a excepción retorna 201 y persiste en DB`
- `✓ V3 Route GET: Listado de evidencias retorna 200, Cache-Control privado y URLs resueltas`
- `✓ V3 Route DELETE: Retiro de evidencia retorna 200, soft-delete en DB y ya no la lista`
- `✓ Aislamiento Cross-Tenant: Usuario de Company B recibe 404 en GET, POST y DELETE contra excepción de Company A`
- `✓ Aislamiento Cross-Branch: Gerente de Branch A1 recibe 404 en GET, POST y DELETE contra excepción de Branch A2`
- `✓ Control de Roles: Empleado recibe 403 Forbidden en POST y DELETE pero 200 en GET`
- `✓ Validación de tamaño: archivo que excede 10MB retorna 413 Payload Too Large`
- `✓ Validación de tipo: ejecutables y scripts son rechazados con 400 Bad Request`

### 2. Pruebas Unitarias de Acceso a Evidencias
Comando ejecutado:
```powershell
pnpm vitest run --configLoader bundle tests/unit/evidence/evidence-subject-access.test.ts
```
Resultado: **18 de 18 pruebas pasadas exitosamente (100%)**

### 3. Validación de Calidad y Estilo (ESLint)
Comando ejecutado:
```powershell
pnpm exec eslint app/api/exceptions/[id]/evidence/route.ts components/exceptions/exception-evidence-dialog.tsx components/exceptions/exception-lifecycle-actions.tsx
```
Resultado: **0 errores, 0 advertencias**.

---

## 6. Lista de Verificación de Aceptación

- [x] Endpoint `POST /api/exceptions/[id]/evidence` funcional para multipart/form-data y JSON.
- [x] Endpoint `GET /api/exceptions/[id]/evidence` funcional con cabecera `Cache-Control: private, no-store`.
- [x] Endpoint `DELETE /api/exceptions/[id]/evidence` funcional con borrado lógico (`deleted_at`).
- [x] Aislamiento Cross-Tenant verificado (404 fail-closed).
- [x] Aislamiento Cross-Branch verificado (404 fail-closed para gerentes de otra sucursal).
- [x] Control de roles verificado (403 Forbidden para rol `EMPLEADO` en POST y DELETE).
- [x] Validación de tamaño verificado (413 Payload Too Large para archivos > 10MB).
- [x] Validación de tipos ejecutables y scripts verificada (400 Bad Request).
- [x] Componente modal `ExceptionEvidenceDialog` implementado con subida, galería, visualización y retiro.
- [x] Botón "Evidencias" integrado en `ExceptionLifecycleActions` en el recorrido visible del feed de excepciones.
- [x] Suite de pruebas `tests/integration/evidence-exception-route-db.test.ts` pasando 9/9 en Neon Postgres aislado.
- [x] Exactamente 5 archivos asignados tocados (cero colisiones con otros frentes).
