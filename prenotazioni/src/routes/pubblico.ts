import { Hono } from 'hono';
import type { Bindings } from '../tipi';
import { aggiungiGiorni, isDataValida, lunediDellaSettimana, oraRoma } from '../slots';
import { COOKIE_SOCIETA, creaSessione, DURATA_SOCIETA_S, hashToken, scriviCookieSessione } from '../auth';
import { generaICS, type EventoICS } from '../ics';
import { scriviAudit } from '../util';

// Formato accettato per i token nei link personali (UUID o esadecimale).
const TOKEN_RE = /^[A-Za-z0-9-]{16,64}$/;

export const pubblico = new Hono<{ Bindings: Bindings }>();

/**
 * Calendario pubblico: gli slot occupati della settimana, senza alcun dato
 * sulla società. Una sola query: le slot_key hanno formato ordinabile a
 * larghezza fissa, quindi l'intera settimana è un range lessicografico.
 */
pubblico.get('/api/calendario', async (c) => {
  const parametro = c.req.query('settimana');
  let riferimento: string;
  if (parametro === undefined || parametro === '') {
    riferimento = oraRoma(new Date()).data;
  } else if (isDataValida(parametro)) {
    riferimento = parametro;
  } else {
    return c.json({ errore: 'Parametro settimana non valido (formato atteso AAAA-MM-GG)' }, 400);
  }
  const lunedi = lunediDellaSettimana(riferimento);
  const lunediSuccessivo = aggiungiGiorni(lunedi, 7);
  const { results } = await c.env.DB
    .prepare('SELECT slot_key FROM prenotazioni WHERE slot_key >= ?1 AND slot_key < ?2 ORDER BY slot_key')
    .bind(`${lunedi}_0000`, `${lunediSuccessivo}_0000`)
    .all<{ slot_key: string }>();
  return c.json({ settimana: lunedi, slot_occupati: results.map((r) => r.slot_key) });
});

/**
 * Accesso società via link personale: se il token corrisponde a una società
 * attiva viene emesso il cookie di sessione firmato e si passa all'area
 * riservata. Token inesistente e società sospesa danno la stessa risposta,
 * per non rivelare quale dei due casi si è verificato.
 */
pubblico.get('/accesso/:token', async (c) => {
  const token = c.req.param('token');
  if (!TOKEN_RE.test(token)) return c.text('Link di accesso non valido.', 404);
  const societa = await c.env.DB
    .prepare("SELECT id, nome, token_accesso FROM societa WHERE token_accesso = ?1 AND stato = 'attiva'")
    .bind(token)
    .first<{ id: number; nome: string; token_accesso: string }>();
  if (!societa) return c.text('Link di accesso non valido.', 404);

  const parti = ['societa', String(societa.id), await hashToken(societa.token_accesso)];
  const cookie = await creaSessione(c.env.ADMIN_SECRET, parti, DURATA_SOCIETA_S, new Date());
  scriviCookieSessione(c, COOKIE_SOCIETA, cookie, DURATA_SOCIETA_S);
  await scriviAudit(c.env.DB, 'accesso_area', `accesso via link personale`, `societa:${societa.id}`);
  return c.redirect('/area', 302);
});

/**
 * Calendario iCalendar della società (per Google Calendar e simili).
 * Include le richieste approvate dagli ultimi 60 giorni in poi.
 */
pubblico.get('/api/ics/:token', async (c) => {
  const token = c.req.param('token');
  if (!TOKEN_RE.test(token)) return c.text('Non trovato', 404);
  const societa = await c.env.DB
    .prepare("SELECT id, nome FROM societa WHERE token_accesso = ?1 AND stato = 'attiva'")
    .bind(token)
    .first<{ id: number; nome: string }>();
  if (!societa) return c.text('Non trovato', 404);

  const da = aggiungiGiorni(oraRoma(new Date()).data, -60);
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, data, ora_inizio, ora_fine, note FROM richieste
       WHERE societa_id = ?1 AND stato = 'approvata' AND data >= ?2
       ORDER BY data, ora_inizio LIMIT 500`,
    )
    .bind(societa.id, da)
    .all<EventoICS>();

  return c.body(generaICS(societa.nome, results, new Date()), 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="palazzetto.ics"',
  });
});
