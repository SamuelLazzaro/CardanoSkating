-- 0004_ripristina_categorie.sql — torna la categoria del materiale.
--
-- La 0003 aveva tolto la categoria insieme agli altri campi; serviva invece
-- ancora (pannello "Categorie materiale" con aggiungi/disattiva e campo nei
-- form). Stessa tabella di prima; le righe di partenza sono quelle presenti in
-- produzione al momento della 0003 (nove della 0001 più tre aggiunte a mano),
-- con gli stessi stati.
--
-- Gli articoli già presenti ricevono 'Altro' come categoria: non si può
-- ricostruire quella originale, va sistemata a mano (vedi COMANDI.md).

CREATE TABLE categorie (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  attiva     INTEGER NOT NULL DEFAULT 1 CHECK (attiva IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO categorie (nome, attiva) VALUES
  ('Pattini', 1), ('Ruote', 1), ('Lame', 1), ('Body', 1), ('Caschi', 1),
  ('Transponder', 1), ('Protezioni', 1), ('Abbigliamento', 0), ('Altro', 0),
  ('Kit anti taglio', 1), ('Body gara', 1), ('Pattino a noleggio', 1);

ALTER TABLE articoli ADD COLUMN categoria TEXT NOT NULL DEFAULT 'Altro';

DROP INDEX idx_articoli_disciplina;
CREATE INDEX idx_articoli_disciplina ON articoli(disciplina, categoria);
