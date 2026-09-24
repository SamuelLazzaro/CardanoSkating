/**
 * Atleti: elenco, inserimento, attivazione/disattivazione e scheda con il
 * materiale in possesso e lo storico dei movimenti.
 */
import { Hono } from 'hono';
import type { AtletaRow, Bindings, VariabiliUtente } from '../tipi';
import { richiedeUtente } from '../auth';
import { conFirmaBooleana, SELECT_MOVIMENTI, type MovimentoStoricoRow } from '../query';
import { booleano, intero, leggiJson, scriviAudit, testo } from '../util';

const MAX_NOME = 160;

/** Articoli in mano a un atleta (?1): consegne meno restituzioni, solo se > 0. */
const SQL_ASSEGNATI = `SELECT a.id, a.codice, a.descrizione, a.disciplina, a.taglia, a.stato,
         SUM(CASE m.tipo WHEN 'CONSEGNA' THEN m.quantita WHEN 'RESTITUZIONE' THEN -m.quantita ELSE 0 END) AS in_possesso
  FROM movimenti m JOIN articoli a ON a.id = m.articolo_id
  WHERE m.atleta_id = ?1
  GROUP BY a.id HAVING in_possesso > 0
  ORDER BY a.disciplina, a.descrizione`;

const SQL_STORICO_ATLETA = `${SELECT_MOVIMENTI} WHERE m.atleta_id = ?1 ORDER BY m.data DESC, m.id DESC LIMIT 500`;

export const atleti = new Hono<{ Bindings: Bindings; Variables: VariabiliUtente }>();

atleti.use('*', richiedeUtente());

atleti.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, nome, attivo, created_at FROM atleti ORDER BY nome').all<AtletaRow>();
  return c.json({ atleti: results });
});

atleti.post('/', async (c) => {
  const corpo = await leggiJson(c);
  const nome = testo(corpo?.nome, MAX_NOME);
  if (nome === null) return c.json({ errore: `Inserisci nome e cognome (massimo ${MAX_NOME} caratteri)` }, 400);
  const esistente = await c.env.DB.prepare('SELECT id FROM atleti WHERE nome = ?1').bind(nome).first();
  if (esistente) return c.json({ errore: 'Nome già presente' }, 409);
  const esito = await c.env.DB.prepare('INSERT INTO atleti (nome) VALUES (?1)').bind(nome).run();
  await scriviAudit(c.env.DB, 'atleta_creato', `#${esito.meta.last_row_id} ${nome}`, c.get('utente'));
  return c.json({ id: esito.meta.last_row_id, nome, attivo: 1 }, 201);
});

atleti.patch('/:id', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Atleta non trovato' }, 404);
  const corpo = await leggiJson(c);
  const attivo = booleano(corpo?.attivo);
  if (attivo === null) return c.json({ errore: 'Indicare se l\'atleta è attivo' }, 400);
  const esito = await c.env.DB.prepare('UPDATE atleti SET attivo = ?2 WHERE id = ?1').bind(id, attivo ? 1 : 0).run();
  if (esito.meta.changes === 0) return c.json({ errore: 'Atleta non trovato' }, 404);
  await scriviAudit(c.env.DB, attivo ? 'atleta_attivato' : 'atleta_disattivato', `#${id}`, c.get('utente'));
  return c.json({ ok: true });
});

/**
 * Scheda atleta: anagrafica, articoli attualmente in possesso (consegne meno
 * restituzioni, solo se > 0) e storico completo dei suoi movimenti.
 */
atleti.get('/:id', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Atleta non trovato' }, 404);
  const atleta = await c.env.DB.prepare('SELECT id, nome, attivo, created_at FROM atleti WHERE id = ?1').bind(id).first<AtletaRow>();
  if (!atleta) return c.json({ errore: 'Atleta non trovato' }, 404);
  const istruzioneAssegnati = c.env.DB.prepare(SQL_ASSEGNATI).bind(id);
  const istruzioneStorico = c.env.DB.prepare(SQL_STORICO_ATLETA).bind(id);
  const [assegnati, storico] = await c.env.DB.batch([istruzioneAssegnati, istruzioneStorico]);
  return c.json({ atleta, assegnati: assegnati.results, storico: conFirmaBooleana(storico.results as MovimentoStoricoRow[]) });
});
