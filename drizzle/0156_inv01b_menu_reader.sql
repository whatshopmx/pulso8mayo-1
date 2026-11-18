-- INV-01.b4.coverage.menu: minimum cost column used by the scoped menu reader.
-- Existing company RLS remains in force; no general SELECT or DML.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (calculated_cost) ON public.recipes TO pulso_app;
  END IF;
END $$;
