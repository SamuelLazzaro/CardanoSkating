-- 0003_semplifica_articoli.sql — anagrafica dell'articolo ridotta a marca e modello.
--
-- Spariscono codice, categoria, descrizione, seriale e valore, e con loro la
-- tabella `categorie` (serviva solo agli articoli; la categoria degli atleti
-- è un'altra cosa, vedi 0002). Un articolo è identificato dal suo id e
-- mostrato come "Marca · Modello"; la marca diventa obbligatoria.
--
-- SQLite non sa togliere con ALTER TABLE colonne UNIQUE o indicizzate, quindi
-- la tabella viene ricostruita. L'ordine delle istruzioni è vincolato dalle
-- chiavi esterne: `movimenti.articolo_id` punta ad `articoli` e il DROP
-- della tabella madre conta come violazione (differita) per ogni movimento.
-- La violazione rientra solo reinserendo le righe madri in una tabella che si
-- chiama di nuovo `articoli`, perciò: copia di appoggio → DROP → CREATE con
-- lo stesso nome → INSERT dalla copia. Rinominare la tabella non andrebbe
-- bene: ALTER TABLE RENAME riscrive anche il riferimento in `movimenti`.
--
-- Dati esistenti: nessun articolo deve restare senza nome. La vecchia
-- descrizione finisce in `marca` se la marca mancava, altrimenti in
-- `modello` se il modello mancava. Codice, categoria, seriale e valore vanno
-- persi: fare un backup prima di applicare in produzione.

PRAGMA defer_foreign_keys = true;

CREATE TABLE articoli_copia AS
  SELECT id, disciplina, COALESCE(marca, descrizione) AS marca, CASE WHEN marca IS NULL THEN modello ELSE COALESCE(modello, descrizione) END AS modello, taglia, quantita, disponibili, stato, note, created_at
  FROM articoli;

DROP TABLE articoli;

CREATE TABLE articoli (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  disciplina  TEXT NOT NULL CHECK (disciplina IN ('Ghiaccio', 'Corsa')),
  marca       TEXT NOT NULL,
  modello     TEXT,
  taglia      TEXT,
  quantita    INTEGER NOT NULL DEFAULT 1 CHECK (quantita >= 0),
  disponibili INTEGER NOT NULL DEFAULT 1 CHECK (disponibili >= 0 AND disponibili <= quantita),
  stato       TEXT NOT NULL DEFAULT 'Buono'
                CHECK (stato IN ('Nuovo', 'Buono', 'Usurato', 'Da riparare', 'Fuori uso')),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO articoli (id, disciplina, marca, modello, taglia, quantita, disponibili, stato, note, created_at)
  SELECT id, disciplina, marca, modello, taglia, quantita, disponibili, stato, note, created_at FROM articoli_copia;

DROP TABLE articoli_copia;

CREATE INDEX idx_articoli_disciplina ON articoli(disciplina, marca);

DROP TABLE categorie;
