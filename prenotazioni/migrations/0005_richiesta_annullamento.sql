-- 0005: annullamento come richiesta approvabile. Le società non cancellano
-- più direttamente le prenotazioni approvate: inviano una richiesta di tipo
-- 'annullamento' riferita (richiesta_riferimento_id) alla richiesta approvata
-- da annullare; l'admin la approva (liberando gli slot in un batch atomico) o
-- la rifiuta, sempre con motivazione. Le richieste esistenti diventano tutte
-- di tipo 'nuova' grazie al DEFAULT.
ALTER TABLE richieste ADD COLUMN tipo TEXT NOT NULL DEFAULT 'nuova'
  CHECK (tipo IN ('nuova','annullamento'));
ALTER TABLE richieste ADD COLUMN richiesta_riferimento_id INTEGER REFERENCES richieste(id);

-- Al massimo UNA richiesta di annullamento pendente per prenotazione: la
-- seconda viene respinta direttamente dal DB (stessa filosofia del vincolo
-- UNIQUE su prenotazioni.slot_key).
CREATE UNIQUE INDEX idx_richieste_annullamento_pendente
  ON richieste(richiesta_riferimento_id)
  WHERE tipo = 'annullamento' AND stato = 'in_attesa';
