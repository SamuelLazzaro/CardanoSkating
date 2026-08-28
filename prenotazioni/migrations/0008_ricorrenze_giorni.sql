-- 0008: ricorrenze su più giorni della settimana. Una società può chiedere lo
-- stesso orario per più giorni (es. lunedì, mercoledì e venerdì) con un'unica
-- richiesta ricorrente, che l'admin approva o rifiuta in blocco (scelta del
-- committente: una riga, una decisione, una email, un batch atomico).
--
-- La colonna giorno_settimana (un solo giorno) è sostituita da `giorni`:
-- elenco dei giorni richiesti separati da virgola, ordinati e senza doppioni,
-- con la convenzione di progetto 0=lunedì .. 6=domenica (es. '0,2,4'). Il
-- formato è validato lato server (come già valida_al). Le ricorrenze
-- esistenti conservano il loro unico giorno.
ALTER TABLE ricorrenze ADD COLUMN giorni TEXT NOT NULL DEFAULT '';
UPDATE ricorrenze SET giorni = CAST(giorno_settimana AS TEXT);
ALTER TABLE ricorrenze DROP COLUMN giorno_settimana;
