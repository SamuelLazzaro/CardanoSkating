-- 0007: tariffa oraria della società (€/h), impostata dall'admin dal suo
-- pannello (campo separato dalla creazione, che parte sempre da 0). Usata
-- SOLO nel report mensile admin (ore prenotate x tariffa): non compare mai
-- nell'area società né nella parte pubblica.
ALTER TABLE societa ADD COLUMN tariffa_oraria REAL NOT NULL DEFAULT 0;
