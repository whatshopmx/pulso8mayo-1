-- PROD-01.b: permitir al rol scoped pulso_app leer origin y parent_batch_ids
-- de inventory_batches para consumir únicamente lotes terminados de producción
-- con genealogía verificable en modo FINISHED_PRODUCT_ON_SALE.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (origin, parent_batch_ids) ON public.inventory_batches TO pulso_app;
  END IF;
END $$;
