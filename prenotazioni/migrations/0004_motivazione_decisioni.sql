-- 0004: motivazione obbligatoria sulle decisioni dell'admin (approvazione e
-- rifiuto), sia per le richieste singole sia per le ricorrenze. La colonna
-- resta NULL sulle righe già decise in passato: l'obbligo vale solo per le
-- decisioni successive a questa migrazione ed è validato lato server.
-- All'approvazione di una ricorrenza la motivazione viene copiata nelle
-- richieste materializzate, come già avviene per titolo e note (vedi 0002).
ALTER TABLE richieste  ADD COLUMN motivazione TEXT;
ALTER TABLE ricorrenze ADD COLUMN motivazione TEXT;
