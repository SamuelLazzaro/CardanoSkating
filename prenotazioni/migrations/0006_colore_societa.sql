-- 0006: colore distintivo della società (#RRGGBB, validato lato server),
-- scelto dall'admin alla creazione/modifica. Usato SOLO nelle viste
-- autenticate: calendario admin (sfondo semitrasparente + bordo pieno, con
-- legenda) e area della società per le proprie prenotazioni. Il calendario
-- pubblico resta neutro e anonimo. Il DEFAULT fa da backfill sulle società
-- esistenti.
ALTER TABLE societa ADD COLUMN colore TEXT NOT NULL DEFAULT '#3b82f6';
