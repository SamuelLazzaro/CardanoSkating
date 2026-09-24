/**
 * Test di integrazione sull'accesso: elenco utenti, login per utente con
 * password da secret, rate limit, sessione e logout.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { COOKIE_SESSIONE, creaSessione, DURATA_SESSIONE_S } from '../src/auth';
import { elencoUtenti, trovaUtente } from '../src/utenti';
import { audit, cookieUtente, getConCookie, PASSWORD_TEST, postJson, tentaLogin, UTENTE_TEST } from './helpers';

describe('utenti configurati', () => {
  it('GET /api/utenti elenca i nomi senza autenticazione', async () => {
    const risposta = await app.request('/api/utenti', {}, env);
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toEqual({ utenti: ['Daniele', 'Davide'] });
  });

  it('elencoUtenti ignora spazi e nomi non validi', () => {
    const ambiente = { ...env, UTENTI: ' Daniele , Davide,, Mario Rossi,x-y ' };
    expect(elencoUtenti(ambiente)).toEqual(['Daniele', 'Davide']);
  });

  it('trovaUtente ignora maiuscole/minuscole e ritorna il nome canonico', () => {
    expect(trovaUtente(env, 'daniele')).toBe('Daniele');
    expect(trovaUtente(env, '  DAVIDE ')).toBe('Davide');
    expect(trovaUtente(env, 'Mario')).toBeNull();
    expect(trovaUtente(env, 42)).toBeNull();
  });
});

describe('login', () => {
  it('credenziali giuste: 200, cookie di sessione e audit con il nome utente', async () => {
    const risposta = await tentaLogin(UTENTE_TEST, PASSWORD_TEST);
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toEqual({ ok: true, utente: UTENTE_TEST });
    const setCookie = risposta.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${COOKIE_SESSIONE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    const righe = await audit('login');
    expect(righe[0]?.attore).toBe(UTENTE_TEST);
  });

  it('il nome utente non distingue maiuscole/minuscole, la password sì', async () => {
    const ok = await tentaLogin('daniele', PASSWORD_TEST);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { utente: string }).utente).toBe('Daniele');
    const ko = await tentaLogin('daniele', PASSWORD_TEST.toUpperCase());
    expect(ko.status).toBe(401);
  });

  it('ogni utente ha la propria password: quella di un altro non vale', async () => {
    const risposta = await tentaLogin('Davide', PASSWORD_TEST);
    expect(risposta.status).toBe(401);
    expect(risposta.headers.get('set-cookie')).toBeNull();
    const conLaSua = await tentaLogin('Davide', 'password-davide-test');
    expect(conLaSua.status).toBe(200);
  });

  it('utente sconosciuto e password errata danno la stessa risposta', async () => {
    const sconosciuto = await tentaLogin('Mario', PASSWORD_TEST);
    const passwordErrata = await tentaLogin(UTENTE_TEST, 'password-sbagliata');
    expect(sconosciuto.status).toBe(401);
    expect(passwordErrata.status).toBe(401);
    expect(await sconosciuto.json()).toEqual(await passwordErrata.json());
    const righe = await audit('login_fallito');
    expect(righe[0]?.dettaglio).toContain('utente Daniele');
    expect(righe[1]?.dettaglio).toContain('utente sconosciuto');
  });

  it('rifiuta password vuota e corpo non JSON', async () => {
    const vuota = await tentaLogin(UTENTE_TEST, '');
    expect(vuota.status).toBe(401);
    const nonJson = await app.request('/api/login', { method: 'POST', body: 'testo' }, env);
    expect(nonJson.status).toBe(401);
  });

  it('dopo 10 tentativi dallo stesso IP il rate limit risponde 429 anche alle credenziali giuste', async () => {
    const daIp = { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' } };
    for (let tentativo = 0; tentativo < 10; tentativo++) {
      await app.request('/api/login', { ...daIp, body: JSON.stringify({ utente: UTENTE_TEST, password: 'sbagliata' }) }, env);
    }
    const bloccato = await app.request('/api/login', { ...daIp, body: JSON.stringify({ utente: UTENTE_TEST, password: PASSWORD_TEST }) }, env);
    expect(bloccato.status).toBe(429);
  });
});

describe('sessione', () => {
  it('senza cookie le API riservate rispondono 401', async () => {
    const risposta = await app.request('/api/me', {}, env);
    expect(risposta.status).toBe(401);
  });

  it('con il cookie /api/me ritorna il nome utente', async () => {
    const cookie = await cookieUtente();
    const risposta = await getConCookie('/api/me', cookie);
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toEqual({ utente: UTENTE_TEST });
  });

  it('un cookie firmato con un altro secret non vale', async () => {
    const falso = await creaSessione('altro-secret', UTENTE_TEST, DURATA_SESSIONE_S, new Date());
    const risposta = await getConCookie('/api/me', `${COOKIE_SESSIONE}=${falso}`);
    expect(risposta.status).toBe(401);
  });

  it('una sessione scaduta non vale', async () => {
    const ieri = new Date(Date.now() - 2 * DURATA_SESSIONE_S * 1000);
    const scaduto = await creaSessione(env.ADMIN_SECRET, UTENTE_TEST, DURATA_SESSIONE_S, ieri);
    const risposta = await getConCookie('/api/me', `${COOKIE_SESSIONE}=${scaduto}`);
    expect(risposta.status).toBe(401);
  });

  it('la sessione di un utente non più configurato decade', async () => {
    const rimosso = await creaSessione(env.ADMIN_SECRET, 'Mario', DURATA_SESSIONE_S, new Date());
    const risposta = await getConCookie('/api/me', `${COOKIE_SESSIONE}=${rimosso}`);
    expect(risposta.status).toBe(401);
  });

  it('il logout cancella il cookie', async () => {
    const cookie = await cookieUtente();
    const risposta = await postJson('/api/logout', cookie);
    expect(risposta.status).toBe(200);
    expect(risposta.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
