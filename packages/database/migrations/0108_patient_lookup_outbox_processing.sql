-- RF-PAC-001 Etapa 2: separar despachos BullMQ de ejecuciones del processor.
-- La columna permite observar y limitar reintentos sin reinterpretar attempts.
ALTER TABLE "outbox_events"
  ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL,
  ADD CONSTRAINT "outbox_events_processing_attempts_check"
    CHECK ("processing_attempts" >= 0);
