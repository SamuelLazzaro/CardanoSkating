-- 0003: titolo dell'attività (es. "Allenamento") scelto da chi prenota e
-- mostrato nel calendario del pannello admin. Il DEFAULT fa anche da
-- backfill: le richieste e ricorrenze già esistenti diventano "Allenamento",
-- così il calendario resta uniforme (scelta del committente).
ALTER TABLE richieste ADD COLUMN titolo TEXT NOT NULL DEFAULT 'Allenamento';
ALTER TABLE ricorrenze ADD COLUMN titolo TEXT NOT NULL DEFAULT 'Allenamento';
