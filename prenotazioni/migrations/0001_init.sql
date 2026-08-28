-- 0001_init.sql — schema iniziale del sistema prenotazioni palazzetto.
--
-- Convenzioni:
--  * Le date/orari di dominio (data, ora_inizio, ora_fine, slot_key,
--    valida_dal/valida_al) sono ORA CIVILE Europe/Rome, in formati testuali
--    ordinabili: 'YYYY-MM-DD', 'HH:MM', 'YYYY-MM-DD_HHMM'.
--  * I timestamp *_at (created_at, decisa_at, annullata_at) sono UTC
--    (datetime('now') di SQLite); la conversione al fuso avviene in
--    presentazione.
--  * slot_key identifica uno slot da 30 minuti (08:00-24:00, primo slot
--    '_0800', ultimo '_2330'). Il vincolo UNIQUE su prenotazioni.slot_key
--    è LA garanzia anti-doppia-prenotazione: ogni inserimento di uno slot
--    già occupato fallisce a livello DB.

CREATE TABLE societa (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL,
  referente     TEXT NOT NULL,
  email         TEXT NOT NULL,
  telefono      TEXT,
  stato         TEXT NOT NULL DEFAULT 'attiva' CHECK (stato IN ('attiva','sospesa')),
  token_accesso TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ricorrenze (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  societa_id       INTEGER NOT NULL REFERENCES societa(id),
  giorno_settimana INTEGER NOT NULL CHECK (giorno_settimana BETWEEN 0 AND 6), -- 0=lunedì .. 6=domenica
  ora_inizio       TEXT NOT NULL,
  ora_fine         TEXT NOT NULL,
  valida_dal       TEXT NOT NULL,
  valida_al        TEXT NOT NULL,  -- max 4 settimane dopo valida_dal (validato lato server)
  stato            TEXT NOT NULL DEFAULT 'in_attesa'
                     CHECK (stato IN ('in_attesa','approvata','rifiutata','annullata')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  decisa_at     TEXT,  -- quando l'admin ha approvato/rifiutato
  annullata_at  TEXT   -- quando la richiesta è stata annullata (da società o admin)
);

CREATE TABLE prenotazioni (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_key     TEXT NOT NULL UNIQUE,
  societa_id   INTEGER NOT NULL REFERENCES societa(id),
  richiesta_id INTEGER NOT NULL REFERENCES richieste(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  azione     TEXT NOT NULL,
  dettaglio  TEXT,
  attore     TEXT NOT NULL,  -- 'admin' | 'societa:<id>' | 'sistema'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rate_limit (
  chiave          TEXT PRIMARY KEY,  -- es. 'login:<ip>'
  contatore       INTEGER NOT NULL,
  finestra_inizio TEXT NOT NULL
);

CREATE INDEX idx_prenotazioni_societa   ON prenotazioni(societa_id);
CREATE INDEX idx_prenotazioni_richiesta ON prenotazioni(richiesta_id);
CREATE INDEX idx_richieste_societa      ON richieste(societa_id, stato);
CREATE INDEX idx_richieste_stato        ON richieste(stato);

-- Una sola richiesta materializzata per (ricorrenza, data): rende deterministico
-- il sub-select usato dalla materializzazione per collegare le prenotazioni
-- alla richiesta, e impedisce doppie materializzazioni della stessa occorrenza.
CREATE UNIQUE INDEX idx_richieste_ricorrenza_data
  ON richieste(ricorrenza_id, data) WHERE ricorrenza_id IS NOT NULL;

-- Società di casa, usata dall'admin per le prenotazioni dirette.
INSERT INTO societa (nome, referente, email, token_accesso)
VALUES ('Cardano Skating S.R.L. S.S.D.', 'Admin', 'prenotazioni@cardanoskating.it', lower(hex(randomblob(16))));
