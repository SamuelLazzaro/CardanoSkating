-- 0012: sconto percentuale della società (intero 0-100), impostato dall'admin
-- dal suo pannello insieme alla tariffa oraria. Si applica alla tariffa nel
-- calcolo dell'importo (ore x tariffa x (1 - sconto/100)) di report mensile,
-- export CSV e report inviato via email. Come la tariffa non ha storico: vale
-- lo sconto corrente anche per i mesi passati ricalcolati. Non compare mai
-- nell'area società né nell'email, dove va solo il totale già scontato.
ALTER TABLE societa ADD COLUMN sconto INTEGER NOT NULL DEFAULT 0;
