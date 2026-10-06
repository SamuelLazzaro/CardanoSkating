-- 0011: storico dei report mensili inviati via email alle società.
--
-- Dal pannello l'admin può inviare a una società il totale da pagare di un
-- mese passato (pulsante "Invia report"). Ogni invio riuscito lascia qui una
-- riga, così il popup mostra "già inviato il ..." e chiede conferma prima di
-- rimandarlo. Si conservano TUTTI gli invii (non solo l'ultimo): il reinvio è
-- ammesso e la storia serve a ricostruire cosa è stato comunicato.
--
-- `ore` e `importo` sono una fotografia di quanto scritto nell'email: il
-- report ricalcolato in seguito può differire (la tariffa è quella corrente
-- della società, non c'è storico tariffe), e qui resta ciò che la società ha
-- davvero ricevuto. `con_ore` ricorda se l'email conteneva anche le ore.
-- `inviato_at` è UTC da datetime('now'), come gli altri *_at.
CREATE TABLE report_inviati (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  societa_id INTEGER NOT NULL REFERENCES societa(id),
  mese TEXT NOT NULL,
  ore REAL NOT NULL,
  importo REAL NOT NULL,
  con_ore INTEGER NOT NULL DEFAULT 0,
  inviato_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_report_inviati_societa_mese ON report_inviati(societa_id, mese);
