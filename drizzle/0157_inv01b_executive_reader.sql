-- INV-01.b4.coverage.executive: stock availability inputs for the scoped reader.
-- Company catalog RLS remains unchanged; no general SELECT or additional DML.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (min_level, active) ON public.inventory_items TO pulso_app;
  END IF;
END $$;
