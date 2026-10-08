/**
 * Categorie del materiale: elenco, inserimento e attivazione/disattivazione.
 * Il nome è unico senza distinguere maiuscole/minuscole (COLLATE NOCASE).
 */
import { Hono } from 'hono';
import type { Bindings, CategoriaRow, VariabiliUtente } from '../tipi';
import { richiedeUtente } from '../auth';
import { booleano, intero, leggiJson, scriviAudit, testo } from '../util';

const MAX_NOME = 80;

export const categorie = new Hono<{ Bindings: Bindings; Variables: VariabiliUtente }>();

categorie.use('*', richiedeUtente());

categorie.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, nome, attiva, created_at FROM categorie ORDER BY nome').all<CategoriaRow>();
  return c.json({ categorie: results });
});

categorie.post('/', async (c) => {
  const corpo = await leggiJson(c);
  const nome = testo(corpo?.nome, MAX_NOME);
  if (nome === null) return c.json({ errore: `Inserisci il nome della categoria (massimo ${MAX_NOME} caratteri)` }, 400);
  // La colonna è COLLATE NOCASE: il confronto ignora maiuscole/minuscole.
  const esistente = await c.env.DB.prepare('SELECT id FROM categorie WHERE nome = ?1').bind(nome).first();
  if (esistente) return c.json({ errore: 'Categoria già presente' }, 409);
  const esito = await c.env.DB.prepare('INSERT INTO categorie (nome) VALUES (?1)').bind(nome).run();
  await scriviAudit(c.env.DB, 'categoria_creata', `#${esito.meta.last_row_id} ${nome}`, c.get('utente'));
  return c.json({ id: esito.meta.last_row_id, nome, attiva: 1 }, 201);
});

categorie.patch('/:id', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Categoria non trovata' }, 404);
  const corpo = await leggiJson(c);
  const attiva = booleano(corpo?.attiva);
  if (attiva === null) return c.json({ errore: 'Indicare se la categoria è attiva' }, 400);
  const esito = await c.env.DB.prepare('UPDATE categorie SET attiva = ?2 WHERE id = ?1').bind(id, attiva ? 1 : 0).run();
  if (esito.meta.changes === 0) return c.json({ errore: 'Categoria non trovata' }, 404);
  await scriviAudit(c.env.DB, attiva ? 'categoria_attivata' : 'categoria_disattivata', `#${id}`, c.get('utente'));
  return c.json({ ok: true });
});
