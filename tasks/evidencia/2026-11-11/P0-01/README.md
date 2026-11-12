# P0-01 — Base de ejecución

Estado: aceptado, verificación D. Fecha: 2026-11-11.

La captura original está en [baseline.json](baseline.json): HEAD `ba88018d2cbd7d879549cfe6476d39e4addfd5d2`, rama `main`, 13 archivos modificados y 9 nuevos al iniciar. Incluye SHA-256 por archivo, resumen y huella del diff. Se conserva la corrección documentada del primer registro porcelain. No se creó commit ni se atribuyó este diff a la continuación.

Comandos: `git rev-parse HEAD`, `git status --porcelain=v1 -z --untracked-files=all`, `git diff --binary HEAD`, `git diff --stat HEAD`; exit 0. Captura local sin conexiones ni secretos. `.env.test` tenía TEST_DATABASE_URL válido y un host/base distinto del operativo. Esa comparación no probaba roles ni RLS.

Los cambios de conciliación, schema/journal y FC-12 pertenecen al frente contable previo. `sistemainvestigacion17oct.md` también era un cambio preexistente. Se preservan sin editar. Los documentos del plan/investigación/checklist ya estaban como archivos nuevos.

Después de la captura el propietario solicitó crear un proyecto nuevo de Neon porque la conexión anterior pertenece a otra cuenta. Ese cambio de entorno, sus respaldos y la inicialización se registran por separado en [NEON-NEW](../NEON-NEW/README.md); no se reescribe la base de esta captura.

Límite: evidencia de partida del workspace, no aceptación funcional ni despliegue del diff previo.
