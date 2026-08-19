import { env } from 'cloudflare:test';
import app from '../src/index';

/** Crea una società direttamente su DB e ritorna anche il token del link personale. */
export async function creaSocietaConToken(nome = 'Polisportiva Test'): Promise<{ id: number; token: string }> {
  const token = crypto.randomUUID();
  const esito = await env.DB
    .prepare("INSERT INTO societa (nome, referente, email, token_accesso) VALUES (?1, 'Referente Test', 'test@example.com', ?2)")
    .bind(nome, token)
    .run();
  return { id: esito.meta.last_row_id, token };
}

/** Visita il link personale e ritorna il cookie di sessione della società. */
export async function cookieSocieta(token: string): Promise<string> {
  const risposta = await app.request(`/accesso/${token}`, {}, env);
  if (risposta.status !== 302) throw new Error(`accesso società fallito nei test (status ${risposta.status})`);
  const setCookie = risposta.headers.get('set-cookie');
  if (!setCookie) throw new Error('cookie società mancante nella risposta di accesso');
  return setCookie.split(';')[0];
}

/** POST autenticato con corpo JSON. */
export async function postJson(percorso: string, cookie: string, corpo: unknown): Promise<Response> {
  return await app.request(
    percorso,
    { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) },
    env,
  );
}

/** GET autenticato. */
export async function getConCookie(percorso: string, cookie: string): Promise<Response> {
  return await app.request(percorso, { headers: { Cookie: cookie } }, env);
}

/** Crea una società direttamente su DB (setup di test, bypassa le API). */
export async function creaSocieta(nome = 'Polisportiva Test'): Promise<number> {
  const esito = await env.DB
    .prepare("INSERT INTO societa (nome, referente, email, token_accesso) VALUES (?1, 'Referente Test', 'test@example.com', ?2)")
    .bind(nome, crypto.randomUUID())
    .run();
  return esito.meta.last_row_id;
}

/** Crea una richiesta in attesa direttamente su DB. */
export async function creaRichiesta(societaId: number, data: string, oraInizio: string, oraFine: string): Promise<number> {
  const esito = await env.DB
    .prepare('INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine) VALUES (?1, ?2, ?3, ?4)')
    .bind(societaId, data, oraInizio, oraFine)
    .run();
  return esito.meta.last_row_id;
}

/** Crea una ricorrenza in attesa direttamente su DB. */
export async function creaRicorrenza(
  societaId: number,
  giornoSettimana: number,
  oraInizio: string,
  oraFine: string,
  validaDal: string,
  validaAl: string,
  titolo = 'Allenamento',
): Promise<number> {
  const esito = await env.DB
    .prepare(
      `INSERT INTO ricorrenze (societa_id, giorno_settimana, ora_inizio, ora_fine, valida_dal, valida_al, titolo)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(societaId, giornoSettimana, oraInizio, oraFine, validaDal, validaAl, titolo)
    .run();
  return esito.meta.last_row_id;
}

/** Effettua il login admin (password fittizia da vitest.config.ts) e ritorna il cookie di sessione. */
export async function cookieAdmin(): Promise<string> {
  const risposta = await app.request(
    '/api/admin/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'password-di-test' }),
    },
    env,
  );
  if (risposta.status !== 200) throw new Error(`login admin fallito nei test (status ${risposta.status})`);
  const setCookie = risposta.headers.get('set-cookie');
  if (!setCookie) throw new Error('cookie admin mancante nella risposta di login');
  return setCookie.split(';')[0];
}

/** POST admin, con corpo JSON facoltativo (es. la motivazione delle decisioni). */
export async function postAdmin(percorso: string, cookie: string, corpo?: unknown): Promise<Response> {
  if (corpo === undefined) {
    return await app.request(percorso, { method: 'POST', headers: { Cookie: cookie } }, env);
  }
  return await postJson(percorso, cookie, corpo);
}

/** slot_key prenotati per una richiesta, in ordine. */
export async function slotDiRichiesta(richiestaId: number): Promise<string[]> {
  const { results } = await env.DB
    .prepare('SELECT slot_key FROM prenotazioni WHERE richiesta_id = ?1 ORDER BY slot_key')
    .bind(richiestaId)
    .all<{ slot_key: string }>();
  return results.map((r) => r.slot_key);
}

export async function statoRichiesta(richiestaId: number): Promise<string | undefined> {
  const riga = await env.DB.prepare('SELECT stato FROM richieste WHERE id = ?1').bind(richiestaId).first<{ stato: string }>();
  return riga?.stato;
}
