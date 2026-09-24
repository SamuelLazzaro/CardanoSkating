/**
 * Accesso al gestionale: elenco utenti per il menu a tendina del login,
 * login/logout e profilo della sessione corrente.
 */
import { Hono } from 'hono';
import type { Bindings, VariabiliUtente } from '../tipi';
import { cancellaCookieSessione, confrontoCostante, creaSessione, DURATA_SESSIONE_S, richiedeUtente, scriviCookieSessione } from '../auth';
import { tentativoConsentito } from '../ratelimit';
import { elencoUtenti, passwordDi, trovaUtente } from '../utenti';
import { leggiJson, scriviAudit } from '../util';

const MAX_TENTATIVI_LOGIN = 10;
const FINESTRA_LOGIN_S = 15 * 60;
const MAX_LUNGHEZZA_PASSWORD = 200;

export const accesso = new Hono<{ Bindings: Bindings; Variables: VariabiliUtente }>();

// ---------------------------------------------------------------------------
// Rotte pubbliche (registrate PRIMA del guard: devono restare raggiungibili)
// ---------------------------------------------------------------------------

/** Nomi degli utenti configurati: popolano il menu a tendina del login. Non sono segreti. */
accesso.get('/utenti', (c) => c.json({ utenti: elencoUtenti(c.env) }));

accesso.post('/login', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'sconosciuto';
  if (!(await tentativoConsentito(c.env.DB, `login:${ip}`, MAX_TENTATIVI_LOGIN, FINESTRA_LOGIN_S))) {
    return c.json({ errore: 'Troppi tentativi: riprova tra qualche minuto' }, 429);
  }
  const corpo = await leggiJson(c);
  const utente = trovaUtente(c.env, corpo?.utente);
  const password = typeof corpo?.password === 'string' ? corpo.password : '';
  const passwordAttesa = utente === null ? undefined : passwordDi(c.env, utente);
  // Il confronto viene eseguito anche per un utente sconosciuto o senza secret,
  // così il tempo di risposta non rivela quale dei due dati è sbagliato.
  const passwordCoincide = await confrontoCostante(password, passwordAttesa ?? '');
  const valida = utente !== null && passwordAttesa !== undefined && password.length > 0 && password.length <= MAX_LUNGHEZZA_PASSWORD && passwordCoincide;
  if (!valida) {
    await scriviAudit(c.env.DB, 'login_fallito', `ip ${ip}, utente ${utente ?? 'sconosciuto'}`, 'sistema');
    return c.json({ errore: 'Utente o password errati' }, 401);
  }
  const cookie = await creaSessione(c.env.ADMIN_SECRET, utente, DURATA_SESSIONE_S, new Date());
  scriviCookieSessione(c, cookie, DURATA_SESSIONE_S);
  await scriviAudit(c.env.DB, 'login', `ip ${ip}`, utente);
  return c.json({ ok: true, utente });
});

accesso.post('/logout', (c) => {
  cancellaCookieSessione(c);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Rotte riservate
// ---------------------------------------------------------------------------

accesso.use('*', richiedeUtente());

/** Profilo della sessione: il frontend lo chiama all'avvio per sapere se mostrare il login. */
accesso.get('/me', (c) => c.json({ utente: c.get('utente') }));
