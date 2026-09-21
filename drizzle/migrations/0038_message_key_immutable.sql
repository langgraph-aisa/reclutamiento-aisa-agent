-- La clave local del asiento es inmutable.
--
-- Fundamento
-- ----------
-- La idempotencia de un envío se ancla en `message_key`: el asiento se crea con
-- `INSERT ... ON CONFLICT (message_key) DO NOTHING` y su clave local es
-- determinista —`cv_request:<postulación>` para la solicitud de CV, con marca
-- propia el saludo del ciclo—, de modo que un segundo intento encuentra el
-- asiento en lugar de crear otro.
--
-- Confirmar el envío sobrescribía esa clave con el identificador del proveedor.
-- A partir de ahí el `ON CONFLICT` no podía encontrar nada: cada intento
-- insertaba un asiento nuevo y el mensaje salía de nuevo al candidato. El efecto
-- era visible para la persona —dos mensajes idénticos, en el mismo minuto— pero
-- la causa era invisible: la protección se desactivaba en silencio. El defecto
-- vivía en los tres caminos de envío y su corrección alcanzó los tres.
--
-- Esta garantía la vuelve estructural. Una clave local **no se modifica nunca**,
-- y el motor lo impide en lugar de confiar en que ningún código futuro vuelva a
-- olvidarlo: un `UPDATE` que la cambie falla con su causa en vez de degradar la
-- idempotencia sin que nadie lo note. La referencia del proveedor tiene su
-- propia columna —`provider_message_id`—, que es donde se escribe.
--
-- Las tres políticas de conflicto vigentes usan `DO NOTHING`, de modo que el
-- disparador no intercepta ninguna escritura legítima.
--
-- Idempotente y expansiva: se puede aplicar sobre una base que ya la tenga.
CREATE OR REPLACE FUNCTION conversation_messages_message_key_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW.message_key IS DISTINCT FROM OLD.message_key THEN
    RAISE EXCEPTION
      'La clave local del asiento (%) es inmutable: identifica el envio y sostiene su idempotencia. La referencia del proveedor pertenece a provider_message_id.',
      COALESCE(OLD.message_key, 'sin clave')
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conversation_messages_message_key_immutable_trg
  ON conversation_messages;

CREATE TRIGGER conversation_messages_message_key_immutable_trg
  BEFORE UPDATE ON conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION conversation_messages_message_key_immutable();
