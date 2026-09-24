/**
 * Numeri della dashboard: totali complessivi e per magazzino, in tre query
 * aggregate eseguite in un solo batch.
 */
import { Hono } from 'hono';
import type { Bindings, Disciplina, VariabiliUtente } from '../tipi';
import { richiedeUtente } from '../auth';
import { DISCIPLINE, STATI_DA_RIPARARE } from '../util';

type RigaDisciplina = { disciplina: Disciplina; articoli: number; disponibili: number; da_riparare: number };

/** Numeri di un magazzino (o di tutti): pezzi totali, in giacenza, consegnati e articoli da riparare. */
type Numeri = { articoli: number; disponibili: number; assegnati: number; da_riparare: number };

export const riepilogo = new Hono<{ Bindings: Bindings; Variables: VariabiliUtente }>();

riepilogo.use('*', richiedeUtente());

/** Elenco SQL degli stati "da riparare", derivato dalla costante condivisa (valori fissi, non input utente). */
const ELENCO_STATI_DA_RIPARARE = STATI_DA_RIPARARE.map((stato) => `'${stato}'`).join(', ');

const SQL_PER_DISCIPLINA = `SELECT disciplina, COALESCE(SUM(quantita), 0) AS articoli, COALESCE(SUM(disponibili), 0) AS disponibili,
         SUM(CASE WHEN stato IN (${ELENCO_STATI_DA_RIPARARE}) THEN 1 ELSE 0 END) AS da_riparare
  FROM articoli GROUP BY disciplina`;

riepilogo.get('/', async (c) => {
  const istruzionePerDisciplina = c.env.DB.prepare(SQL_PER_DISCIPLINA);
  const istruzioneAtleti = c.env.DB.prepare('SELECT COUNT(*) AS n FROM atleti WHERE attivo = 1');
  const istruzioneMovimenti = c.env.DB.prepare('SELECT COUNT(*) AS n FROM movimenti');
  const [perDisciplina, atleti, movimenti] = await c.env.DB.batch([istruzionePerDisciplina, istruzioneAtleti, istruzioneMovimenti]);
  const vuoto = (): Numeri => ({ articoli: 0, disponibili: 0, assegnati: 0, da_riparare: 0 });
  const magazzini: Record<Disciplina, Numeri> = { Ghiaccio: vuoto(), Corsa: vuoto() };
  const totali = vuoto();
  for (const riga of perDisciplina.results as RigaDisciplina[]) {
    if (!DISCIPLINE.includes(riga.disciplina)) continue;
    const numeri: Numeri = { articoli: riga.articoli, disponibili: riga.disponibili, assegnati: riga.articoli - riga.disponibili, da_riparare: riga.da_riparare };
    magazzini[riga.disciplina] = numeri;
    totali.articoli += numeri.articoli;
    totali.disponibili += numeri.disponibili;
    totali.assegnati += numeri.assegnati;
    totali.da_riparare += numeri.da_riparare;
  }
  const atletiAttivi = (atleti.results[0] as { n: number }).n;
  const numeroMovimenti = (movimenti.results[0] as { n: number }).n;
  return c.json({ totali: { ...totali, atleti_attivi: atletiAttivi, movimenti: numeroMovimenti }, magazzini });
});
