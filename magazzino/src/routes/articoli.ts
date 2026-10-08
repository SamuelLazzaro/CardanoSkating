/**
 * Articoli (materiale): elenco con filtri, inserimento, scheda, eliminazione
 * e QR code della scheda.
 */
import { Hono } from 'hono';
import qrcode from 'qrcode-generator';
import type { ArticoloRow, Bindings, VariabiliUtente } from '../tipi';
import { richiedeUtente } from '../auth';
import { campiArticolo, nomeArticolo, stmtInserisciArticolo } from '../articolo';
import { disciplina, intero, interoPositivo, leggiJson, patternRicerca, scriviAudit } from '../util';

/** Giacenza iniziale quando il corpo non indica la quantità (come nel gestionale originale). */
const QUANTITA_PREDEFINITA = 1;

/** Elenco con filtri neutralizzabili: ?1 disciplina ('' = tutte), ?2 pattern LIKE ('' = nessuna ricerca). */
const SQL_ELENCO_ARTICOLI = `SELECT * FROM articoli
  WHERE (?1 = '' OR disciplina = ?1)
    AND (?2 = '' OR marca LIKE ?2 ESCAPE '\\' OR modello LIKE ?2 ESCAPE '\\')
  ORDER BY disciplina, categoria, marca, modello, id LIMIT 1000`;

/** Eliminazione condizionata: la riga sparisce solo se non ha movimenti. */
const SQL_ELIMINA_SENZA_STORICO = 'DELETE FROM articoli WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM movimenti WHERE articolo_id = ?1)';

export const articoli = new Hono<{ Bindings: Bindings; Variables: VariabiliUtente }>();

articoli.use('*', richiedeUtente());

/**
 * Elenco articoli, filtrabile per magazzino (?disciplina=) e per testo libero
 * (?q= su marca e modello). Un solo statement: i filtri assenti vengono
 * neutralizzati dai confronti con la stringa vuota.
 */
articoli.get('/', async (c) => {
  const magazzino = disciplina(c.req.query('disciplina')) ?? '';
  const pattern = patternRicerca(c.req.query('q') ?? '') ?? '';
  const { results } = await c.env.DB.prepare(SQL_ELENCO_ARTICOLI).bind(magazzino, pattern).all<ArticoloRow>();
  return c.json({ articoli: results });
});

articoli.post('/', async (c) => {
  const corpo = await leggiJson(c);
  if (corpo === null) return c.json({ errore: 'Dati mancanti' }, 400);
  const validazione = campiArticolo(corpo);
  if ('errore' in validazione) return c.json({ errore: validazione.errore }, 400);
  const quantita = corpo.quantita === undefined ? QUANTITA_PREDEFINITA : interoPositivo(corpo.quantita);
  if (quantita === null) return c.json({ errore: 'Quantità non valida' }, 400);
  const { campi } = validazione;
  const esito = await stmtInserisciArticolo(c.env.DB, campi, quantita, campi.stato ?? 'Buono').run();
  await scriviAudit(c.env.DB, 'articolo_creato', `#${esito.meta.last_row_id} ${nomeArticolo(campi)} (${campi.disciplina})`, c.get('utente'));
  return c.json({ id: esito.meta.last_row_id }, 201);
});

articoli.get('/:id', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Materiale non trovato' }, 404);
  const articolo = await c.env.DB.prepare('SELECT * FROM articoli WHERE id = ?1').bind(id).first<ArticoloRow>();
  if (!articolo) return c.json({ errore: 'Materiale non trovato' }, 404);
  return c.json({ articolo });
});

/**
 * Eliminazione fisica, ammessa solo per un articolo senza movimenti: con uno
 * storico va invece segnato come "Fuori uso" (regola del gestionale originale,
 * che così non perde mai la tracciabilità di chi ha avuto cosa).
 */
articoli.delete('/:id', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Materiale non trovato' }, 404);
  const articolo = await c.env.DB.prepare('SELECT marca, modello FROM articoli WHERE id = ?1').bind(id).first<{ marca: string; modello: string | null }>();
  if (!articolo) return c.json({ errore: 'Materiale non trovato' }, 404);
  const esito = await c.env.DB.prepare(SQL_ELIMINA_SENZA_STORICO).bind(id).run();
  if (esito.meta.changes === 0) return c.json({ errore: 'Materiale con storico: impostalo come Fuori uso invece di eliminarlo' }, 409);
  await scriviAudit(c.env.DB, 'articolo_eliminato', `#${id} ${nomeArticolo(articolo)}`, c.get('utente'));
  return c.json({ ok: true });
});

/**
 * QR code (SVG) che porta alla scheda dell'articolo nel gestionale: la pagina
 * apre la scheda leggendo il parametro ?articolo= dell'indirizzo. Generato nel
 * Worker con una libreria JS pura, niente servizi esterni.
 */
articoli.get('/:id/qr.svg', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Materiale non trovato' }, 404);
  const articolo = await c.env.DB.prepare('SELECT id FROM articoli WHERE id = ?1').bind(id).first();
  if (!articolo) return c.json({ errore: 'Materiale non trovato' }, 404);
  const destinazione = `${new URL(c.req.url).origin}/?articolo=${id}`;
  // Versione 0 = dimensione automatica; 'M' = correzione errori media.
  const qr = qrcode(0, 'M');
  qr.addData(destinazione);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  return c.body(svg, 200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
});
