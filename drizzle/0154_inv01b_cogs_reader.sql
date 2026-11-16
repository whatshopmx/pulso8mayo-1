-- INV-01.b4.coverage.cogs: current ingredient costs for the scoped COGS reader.
-- Existing catalog RLS still applies. No general SELECT or write privileges.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (average_cost, last_cost, standard_cost)
      ON public.inventory_items TO pulso_app;
  END IF;
END $$;
