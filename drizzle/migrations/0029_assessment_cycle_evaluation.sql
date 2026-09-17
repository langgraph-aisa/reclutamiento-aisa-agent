-- 0029_assessment_cycle_evaluation.sql
--
-- Cierre evaluado del ciclo de pruebas.
--
-- Registra que la re-evaluación automática que acompaña al cierre ya se
-- ejecutó y con qué puntaje, de modo que un cierre repetido no la vuelva a
-- lanzar. Expansiva e idempotente: agrega columnas anulables y no altera ni
-- elimina ninguna estructura existente.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'assessment_cycles'
  ) THEN
    ALTER TABLE assessment_cycles
      ADD COLUMN IF NOT EXISTS evaluated_at timestamptz,
      ADD COLUMN IF NOT EXISTS evaluation_score integer;
  END IF;
END $$;

-- Verificación autocertificada de la migración.
SELECT 1 AS orden, 'Columnas del cierre evaluado' AS bloque, '2' AS esperado,
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'assessment_cycles'
           AND column_name IN ('evaluated_at', 'evaluation_score')) AS obtenido
UNION ALL
SELECT 2, 'Estructura previa del ciclo conservada', '1',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'assessment_cycles'
           AND column_name = 'ready_at')
ORDER BY orden;
