-- 0009: richieste di MODIFICA e GRUPPI di richieste.
--
-- Una società può chiedere di modificare una prenotazione già approvata
-- (nuova data e/o orario, attività, note) con una richiesta di tipo
-- 'modifica' riferita (richiesta_riferimento_id) alla prenotazione da
-- cambiare, che l'admin approva o rifiuta con motivazione, esattamente come
-- l'annullamento (migrazione 0005). Le richieste di modifica portano i NUOVI
-- valori nelle colonne data/ora_inizio/ora_fine/titolo/note; all'approvazione
-- la prenotazione originale viene aggiornata sul posto (stesso id) e gli slot
-- vengono scambiati in un batch atomico.
--
-- `gruppo_id` lega le richieste (di modifica o di annullamento) che una
-- società invia in un colpo solo su più occorrenze di una ricorrenza ("questa
-- e le successive"): stesso identificativo su ogni riga, una sola decisione
-- dell'admin per tutto il gruppo, un solo batch, una sola email. NULL per le
-- richieste singole.
--
-- Il vincolo CHECK su `tipo` non è alterabile in SQLite: la tabella viene
-- ricostruita. L'ordine dei passi è dettato dalle foreign key, attive per
-- default su D1 (prenotazioni.richiesta_id e la stessa colonna
-- richiesta_riferimento_id puntano a `richieste`) e da come SQLite applica i
-- vincoli rinviati (PRAGMA defer_foreign_keys, indicato dalla documentazione
-- D1 per le migrazioni): un CONTATORE di violazioni, incrementato quando
-- sparisce la riga padre di una riga figlia e decrementato quando una riga
-- padre mancante viene (re)inserita; al commit deve valere zero.
--
--  1. copia temporanea dei dati (tabella senza vincoli);
--  2. DROP della tabella attuale: per ogni prenotazione il contatore sale;
--  3. CREATE della nuova tabella con lo STESSO nome `richieste`, così i
--     "REFERENCES richieste" delle altre tabelle tornano a puntarle;
--  4. reinserimento delle righe con gli stessi id: ogni riga padre reinserita
--     fa scendere il contatore per le prenotazioni che la referenziano, che al
--     commit è di nuovo zero;
--  5. eliminazione della copia temporanea e indici ricreati (quelli vecchi
--     sono caduti col DROP).
--
-- Le alternative non funzionano su D1: rinominare la tabella riscrive i
-- REFERENCES delle altre tabelle verso il nuovo nome (con foreign_keys attive
-- SQLite lo fa anche con legacy_alter_table), e PRAGMA foreign_keys = OFF è un
-- no-op dentro una transazione, mentre wrangler esegue l'intero file di
-- migrazione in una sola transazione. Verificato sul database locale popolato.
PRAGMA defer_foreign_keys = true;

CREATE TABLE richieste_copia AS SELECT * FROM richieste;

DROP TABLE richieste;

CREATE TABLE richieste (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  societa_id    INTEGER NOT NULL REFERENCES societa(id),
  data          TEXT NOT NULL,
  ora_inizio    TEXT NOT NULL,
  ora_fine      TEXT NOT NULL,
  stato         TEXT NOT NULL DEFAULT 'in_attesa'
                  CHECK (stato IN ('in_attesa','approvata','rifiutata','annullata')),
  note          TEXT,
  ricorrenza_id INTEGER REFERENCES ricorrenze(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  decisa_at     TEXT,
  annullata_at  TEXT,
  titolo        TEXT NOT NULL DEFAULT 'Allenamento',
  motivazione   TEXT,
  tipo          TEXT NOT NULL DEFAULT 'nuova'
                  CHECK (tipo IN ('nuova','annullamento','modifica')),
  richiesta_riferimento_id INTEGER REFERENCES richieste(id),
  gruppo_id     TEXT
);

INSERT INTO richieste (
  id, societa_id, data, ora_inizio, ora_fine, stato, note, ricorrenza_id,
  created_at, decisa_at, annullata_at, titolo, motivazione, tipo, richiesta_riferimento_id
)
SELECT
  id, societa_id, data, ora_inizio, ora_fine, stato, note, ricorrenza_id,
  created_at, decisa_at, annullata_at, titolo, motivazione, tipo, richiesta_riferimento_id
FROM richieste_copia
ORDER BY id;

DROP TABLE richieste_copia;

-- Indici della tabella originale (0001), ricreati sulla tabella nuova.
CREATE INDEX idx_richieste_societa ON richieste(societa_id, stato);
CREATE INDEX idx_richieste_stato   ON richieste(stato);
CREATE UNIQUE INDEX idx_richieste_ricorrenza_data
  ON richieste(ricorrenza_id, data) WHERE ricorrenza_id IS NOT NULL;

-- Sostituisce idx_richieste_annullamento_pendente (0005): al massimo UNA
-- richiesta pendente per prenotazione, che sia di annullamento o di modifica.
-- Le due si escludono a vicenda per costruzione del DB, senza controlli
-- applicativi che potrebbero perdere una corsa.
CREATE UNIQUE INDEX idx_richieste_variazione_pendente
  ON richieste(richiesta_riferimento_id)
  WHERE richiesta_riferimento_id IS NOT NULL AND stato = 'in_attesa';

-- Decisioni e ritiri operano per gruppo: WHERE gruppo_id = ?.
CREATE INDEX idx_richieste_gruppo ON richieste(gruppo_id) WHERE gruppo_id IS NOT NULL;
