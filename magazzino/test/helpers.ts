import { env } from 'cloudflare:test';
import app from '../src/index';

/** Utente e password fittizi configurati in vitest.config.ts. */
export const UTENTE_TEST = 'Daniele';
export const PASSWORD_TEST = 'password-daniele-test';

/** Tenta il login con le credenziali indicate e ritorna la risposta grezza. */
export async function tentaLogin(utente: string, password: string): Promise<Response> {
  const corpo = JSON.stringify({ utente, password });
  return await app.request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo }, env);
}

/** Effettua il login dell'utente di test e ritorna il cookie di sessione. */
export async function cookieUtente(utente = UTENTE_TEST, password = PASSWORD_TEST): Promise<string> {
  const risposta = await tentaLogin(utente, password);
  if (risposta.status !== 200) throw new Error(`login fallito nei test (status ${risposta.status})`);
  const setCookie = risposta.headers.get('set-cookie');
  if (!setCookie) throw new Error('cookie di sessione mancante nella risposta di login');
  return setCookie.split(';')[0];
}

/** GET autenticato. */
export async function getConCookie(percorso: string, cookie: string): Promise<Response> {
  return await app.request(percorso, { headers: { Cookie: cookie } }, env);
}

/** POST autenticato con corpo JSON facoltativo. */
export async function postJson(percorso: string, cookie: string, corpo?: unknown): Promise<Response> {
  if (corpo === undefined) return await app.request(percorso, { method: 'POST', headers: { Cookie: cookie } }, env);
  const intestazioni = { Cookie: cookie, 'Content-Type': 'application/json' };
  return await app.request(percorso, { method: 'POST', headers: intestazioni, body: JSON.stringify(corpo) }, env);
}

/** PATCH autenticato con corpo JSON. */
export async function patchJson(percorso: string, cookie: string, corpo: unknown): Promise<Response> {
  const intestazioni = { Cookie: cookie, 'Content-Type': 'application/json' };
  return await app.request(percorso, { method: 'PATCH', headers: intestazioni, body: JSON.stringify(corpo) }, env);
}

/** DELETE autenticato. */
export async function deleteConCookie(percorso: string, cookie: string): Promise<Response> {
  return await app.request(percorso, { method: 'DELETE', headers: { Cookie: cookie } }, env);
}

/** Crea un atleta direttamente su DB (setup di test, bypassa le API). */
export async function creaAtleta(nome = 'Atleta Test', attivo = true): Promise<number> {
  const esito = await env.DB.prepare('INSERT INTO atleti (nome, attivo) VALUES (?1, ?2)').bind(nome, attivo ? 1 : 0).run();
  return esito.meta.last_row_id;
}

/** Campi di un articolo di test; ogni proprietà è sovrascrivibile. */
export type ArticoloTest = { codice: string; disciplina: string; categoria: string; descrizione: string; quantita: number; stato: string; taglia: string | null; marca: string | null; seriale: string | null };

/** Crea un articolo direttamente su DB con giacenza piena (disponibili = quantita). */
export async function creaArticolo(campi: Partial<ArticoloTest> = {}): Promise<number> {
  const predefiniti: ArticoloTest = { codice: `ART-${crypto.randomUUID().slice(0, 8)}`, disciplina: 'Corsa', categoria: 'Pattini', descrizione: 'Pattino test', quantita: 5, stato: 'Buono', taglia: null, marca: null, seriale: null };
  const a = { ...predefiniti, ...campi };
  const sql = 'INSERT INTO articoli (codice, disciplina, categoria, descrizione, quantita, disponibili, stato, taglia, marca, seriale) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?9)';
  const esito = await env.DB.prepare(sql).bind(a.codice, a.disciplina, a.categoria, a.descrizione, a.quantita, a.stato, a.taglia, a.marca, a.seriale).run();
  return esito.meta.last_row_id;
}

/** Giacenza attuale (quantita, disponibili, stato) di un articolo. */
export async function giacenza(articoloId: number): Promise<{ quantita: number; disponibili: number; stato: string }> {
  const riga = await env.DB.prepare('SELECT quantita, disponibili, stato FROM articoli WHERE id = ?1').bind(articoloId).first<{ quantita: number; disponibili: number; stato: string }>();
  if (!riga) throw new Error(`articolo ${articoloId} non trovato`);
  return riga;
}

/** Ultime righe di audit per azione, dalla più recente. */
export async function audit(azione: string): Promise<{ dettaglio: string; attore: string }[]> {
  const { results } = await env.DB.prepare('SELECT dettaglio, attore FROM audit_log WHERE azione = ?1 ORDER BY id DESC').bind(azione).all<{ dettaglio: string; attore: string }>();
  return results;
}
