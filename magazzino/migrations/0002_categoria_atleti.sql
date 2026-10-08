-- 0002_categoria_atleti.sql — categoria agonistica dell'atleta.
--
-- Lista fissa di sigle (le categorie FISR), vincolata dal CHECK e replicata in
-- src/util.ts e public/js/constants.js:
--   G = Giovanissimi, E = Esordienti, R12 = Ragazzi 12, R = Ragazzi,
--   A = Allievi, J = Junior, S = Senior, M = Master.
-- Gli atleti già presenti restano a NULL ("—" nell'interfaccia) finché un
-- utente non assegna loro la categoria dalla tabella Atleti.

ALTER TABLE atleti ADD COLUMN categoria TEXT CHECK (categoria IS NULL OR categoria IN ('G', 'E', 'R12', 'R', 'A', 'J', 'S', 'M'));
