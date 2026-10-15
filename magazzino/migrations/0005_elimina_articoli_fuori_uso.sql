-- 0005_elimina_articoli_fuori_uso.sql — eliminazione logica degli articoli.
--
-- Un articolo con movimenti non può sparire fisicamente (la chiave esterna di
-- `movimenti.articolo_id` e lo storico lo richiedono). Per poterlo comunque
-- togliere dalla sezione Materiali, se è "Fuori uso" e tutto rientrato, viene
-- marcato con la data di eliminazione: gli elenchi e il riepilogo lo
-- ignorano, lo storico continua a mostrarne i movimenti e la lista "Materiali
-- eliminati" permette di ripristinarlo. NULL = articolo in uso.

ALTER TABLE articoli ADD COLUMN eliminato_at TEXT;
