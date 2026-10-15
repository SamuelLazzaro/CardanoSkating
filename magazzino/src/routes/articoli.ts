/**
 * Articoli (materiale): elenco con filtri, inserimento, scheda, eliminazione
 * (fisica o logica) con ripristino e QR code della scheda.
 */
import { Hono } from 'hono';
import qrcode from 'qrcode-generator';
import type { ArticoloRow, Bindings, VariabiliUtente } from '../tipi';
import { richiedeUtente } from '../auth';
import { campiArticolo, nomeArticolo, stmtInserisciArticolo } from '../articolo';
import { disciplina, intero, interoPositivo, leggiJson, patternRicerca, scriviAudit } from '../util';

/** Giacenza iniziale quando il corpo non indica la quantità (come nel gestionale originale). */
const QUANTITA_PREDEFINITA = 1;

/** Elenco con filtri neutralizzabili: ?1 disciplina ('' = tutte), ?2 pattern LIKE ('' = nessuna ricerca). Esclude gli articoli eliminati. */
const SQL_ELENCO_ARTICOLI = `SELECT * FROM articoli
  WHERE eliminato_at IS NULL
    AND (?1 = '' OR disciplina = ?1)
    AND (?2 = '' OR marca LIKE ?2 ESCAPE '\\' OR modello LIKE ?2 ESCAPE '\\')
  ORDER BY disciplina, categoria, marca, modello, id LIMIT 1000`;

/** Articoli eliminati logicamente, dal più recente. */
const SQL_ELENCO_ELIMINATI = 'SELECT * FROM articoli WHERE eliminato_at IS NOT NULL ORDER BY eliminato_at DESC, id DESC LIMIT 1000';

/** Eliminazione fisica condizionata: la riga sparisce solo se non ha movimenti. */
const SQL_ELIMINA_SENZA_STORICO = 'DELETE FROM articoli WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM movimenti WHERE articolo_id = ?1)';

/**
 * Eliminazione logica: la stessa guardia già verificata in JS è ripetuta in
 * SQL, così una consegna concorrente non può lasciare eliminato un articolo
 * ancora in mano a un atleta.
 */
const SQL_ELIMINA_FUORI_USO = `UPDATE articoli SET eliminato_at = datetime('now') WHERE id = ?1 AND eliminato_at IS NULL AND stato = 'Fuori uso' AND disponibili = quantita`;

const SQL_RIPRISTINA = 'UPDATE articoli SET eliminato_at = NULL WHERE id = ?1 AND eliminato_at IS NOT NULL';

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

/** Lista "Materiali eliminati" (eliminazione logica), da cui si può ripristinare. Prima di /:id perché 'eliminati' non è un id. */
articoli.get('/eliminati', async (c) => {
  const { results } = await c.env.DB.prepare(SQL_ELENCO_ELIMINATI).all<ArticoloRow>();
  return c.json({ articoli: results });
});

/** Scheda: risponde anche per un articolo eliminato (link dal QR o dallo storico), con `eliminato_at` valorizzato. */
articoli.get('/:id', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Materiale non trovato' }, 404);
  const articolo = await c.env.DB.prepare('SELECT * FROM articoli WHERE id = ?1').bind(id).first<ArticoloRow>();
  if (!articolo) return c.json({ errore: 'Materiale non trovato' }, 404);
  return c.json({ articolo });
});

/**
 * Eliminazione di un articolo, in due forme:
 *  - senza movimenti: cancellazione fisica (come nel gestionale originale);
 *  - con storico: ammessa solo se l'articolo è "Fuori uso" e nessun pezzo è
 *    ancora in mano a un atleta (disponibili = quantita); è un'eliminazione
 *    logica (eliminato_at), così lo storico non perde mai la tracciabilità
 *    di chi ha avuto cosa e l'articolo resta ripristinabile.
 * Negli altri casi 409 con il motivo.
 */
articoli.delete('/:id', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Materiale non trovato' }, 404);
  const articolo = await c.env.DB.prepare('SELECT marca, modello, stato, quantita, disponibili, eliminato_at FROM articoli WHERE id = ?1').bind(id).first<Pick<ArticoloRow, 'marca' | 'modello' | 'stato' | 'quantita' | 'disponibili' | 'eliminato_at'>>();
  if (!articolo) return c.json({ errore: 'Materiale non trovato' }, 404);
  if (articolo.eliminato_at !== null) return c.json({ errore: 'Materiale già eliminato' }, 409);
  const esitoFisico = await c.env.DB.prepare(SQL_ELIMINA_SENZA_STORICO).bind(id).run();
  if (esitoFisico.meta.changes > 0) {
    await scriviAudit(c.env.DB, 'articolo_eliminato', `#${id} ${nomeArticolo(articolo)}`, c.get('utente'));
    return c.json({ ok: true });
  }
  if (articolo.stato !== 'Fuori uso') return c.json({ errore: 'Materiale con storico: impostalo come Fuori uso prima di eliminarlo' }, 409);
  if (articolo.disponibili < articolo.quantita) return c.json({ errore: 'Materiale ancora consegnato a un atleta: registra la restituzione prima di eliminarlo' }, 409);
  const esitoLogico = await c.env.DB.prepare(SQL_ELIMINA_FUORI_USO).bind(id).run();
  if (esitoLogico.meta.changes === 0) return c.json({ errore: 'Materiale modificato nel frattempo: ricarica e riprova' }, 409);
  await scriviAudit(c.env.DB, 'articolo_eliminato', `#${id} ${nomeArticolo(articolo)} (con storico)`, c.get('utente'));
  return c.json({ ok: true });
});

/** Ripristino di un articolo eliminato logicamente: torna negli elenchi con lo stato che aveva. */
articoli.post('/:id/ripristina', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Materiale non trovato' }, 404);
  const articolo = await c.env.DB.prepare('SELECT marca, modello, eliminato_at FROM articoli WHERE id = ?1').bind(id).first<Pick<ArticoloRow, 'marca' | 'modello' | 'eliminato_at'>>();
  if (!articolo) return c.json({ errore: 'Materiale non trovato' }, 404);
  if (articolo.eliminato_at === null) return c.json({ errore: 'Materiale non eliminato' }, 409);
  await c.env.DB.prepare(SQL_RIPRISTINA).bind(id).run();
  await scriviAudit(c.env.DB, 'articolo_ripristinato', `#${id} ${nomeArticolo(articolo)}`, c.get('utente'));
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
