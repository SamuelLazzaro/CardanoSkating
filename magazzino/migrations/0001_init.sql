-- 0001_init.sql — schema iniziale del gestionale magazzino.
--
-- Convenzioni (le stesse di prenotazioni/):
--  * La data di un movimento è ORA CIVILE Europe/Rome nel formato 'YYYY-MM-DD';
--    i timestamp *_at sono UTC (datetime('now') di SQLite).
--  * Due magazzini fissi, distinti dalla colonna `disciplina`: 'Ghiaccio' e 'Corsa'.
--  * La categoria di un articolo è testo libero che riprende il nome di una
--    riga di `categorie` (replica del gestionale originale: il vincolo di
--    chiave esterna è tra le migliorie rinviate).
--  * `disponibili` è la giacenza in magazzino; quantita - disponibili sono i
--    pezzi attualmente consegnati agli atleti.
--  * L'operatore di un movimento è il nome utente della sessione: gli utenti
--    sono configurati nel Worker (UTENTI + secret), non in una tabella.

CREATE TABLE atleti (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL UNIQUE,
  attivo     INTEGER NOT NULL DEFAULT 1 CHECK (attivo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categorie (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  attiva     INTEGER NOT NULL DEFAULT 1 CHECK (attiva IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE articoli (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  codice      TEXT NOT NULL UNIQUE,
  disciplina  TEXT NOT NULL CHECK (disciplina IN ('Ghiaccio', 'Corsa')),
  categoria   TEXT NOT NULL,
  descrizione TEXT NOT NULL,
  marca       TEXT,
  modello     TEXT,
  taglia      TEXT,
  seriale     TEXT,
  quantita    INTEGER NOT NULL DEFAULT 1 CHECK (quantita >= 0),
  disponibili INTEGER NOT NULL DEFAULT 1 CHECK (disponibili >= 0 AND disponibili <= quantita),
  stato       TEXT NOT NULL DEFAULT 'Buono'
                CHECK (stato IN ('Nuovo', 'Buono', 'Usurato', 'Da riparare', 'Fuori uso')),
  valore      REAL NOT NULL DEFAULT 0 CHECK (valore >= 0),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE movimenti (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  articolo_id INTEGER NOT NULL REFERENCES articoli(id),
  atleta_id   INTEGER REFERENCES atleti(id),          -- NULL per le entrate in magazzino
  operatore   TEXT NOT NULL,                          -- nome utente della sessione
  tipo        TEXT NOT NULL CHECK (tipo IN ('ENTRATA', 'CONSEGNA', 'RESTITUZIONE')),
  quantita    INTEGER NOT NULL CHECK (quantita > 0),
  data        TEXT NOT NULL,
  condizione  TEXT CHECK (condizione IS NULL OR condizione IN ('Nuovo', 'Buono', 'Usurato', 'Da riparare', 'Fuori uso')),
  note        TEXT,
  firma       TEXT,  -- firma su touchscreen come data URL PNG; letta solo nel dettaglio, mai nelle liste
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  azione     TEXT NOT NULL,
  dettaglio  TEXT,
  attore     TEXT NOT NULL,  -- nome utente | 'sistema'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rate_limit (
  chiave          TEXT PRIMARY KEY,  -- es. 'login:<ip>'
  contatore       INTEGER NOT NULL,
  finestra_inizio TEXT NOT NULL
);

CREATE INDEX idx_articoli_disciplina ON articoli(disciplina, categoria);
CREATE INDEX idx_articoli_seriale    ON articoli(seriale);
CREATE INDEX idx_movimenti_articolo  ON movimenti(articolo_id);
CREATE INDEX idx_movimenti_atleta    ON movimenti(atleta_id);
CREATE INDEX idx_movimenti_data      ON movimenti(data, id);

-- Categorie di partenza (le stesse del gestionale originale).
INSERT INTO categorie (nome) VALUES
  ('Pattini'), ('Ruote'), ('Lame'), ('Body'), ('Caschi'),
  ('Transponder'), ('Protezioni'), ('Abbigliamento'), ('Altro');
