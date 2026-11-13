-- INV-01.b4b.rls: resolución de nombre bajo el mismo contexto que el writer.
-- Conserva RLS y los privilegios de columnas existentes; sin SELECT general ni DML.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (name) ON public.recipes TO pulso_app;
  END IF;
END $$;
