-- 0002: le note della società accompagnano anche le richieste ricorrenti.
-- La colonna viene copiata in ogni richiesta creata dalla materializzazione,
-- così le note non si perdono tra invio della ricorrenza e approvazione.
ALTER TABLE ricorrenze ADD COLUMN note TEXT;
