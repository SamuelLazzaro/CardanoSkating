/**
 * Sessioni e autenticazione (stesso schema di prenotazioni/src/auth.ts).
 *
 * Le sessioni sono cookie firmati senza stato lato server: "<payload>.<firma>"
 * dove il payload è "utente.<nome>.<scadenza>" e la firma è HMAC-SHA256
 * (base64url) calcolata con il secret ADMIN_SECRET. L'HMAC via WebCrypto costa
 * microsecondi di CPU, ben dentro i 10 ms del piano gratuito.
 *
 * Il middleware ricontrolla a ogni richiesta che il nome nel cookie sia ancora
 * tra gli utenti configurati: togliere un utente da UTENTI (e fare il deploy)
 * invalida subito le sue sessioni già emesse.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Bindings, VariabiliUtente } from './tipi';
import { elencoUtenti } from './utenti';

export const COOKIE_SESSIONE = 'sess_magazzino';
export const DURATA_SESSIONE_S = 60 * 60 * 8; // 8 ore

const TIPO_SESSIONE = 'utente';

const encoder = new TextEncoder();

function base64url(buffer: ArrayBuffer): string {
  let binario = '';
  for (const byte of new Uint8Array(buffer)) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function firma(secret: string, payload: string): Promise<string> {
  const chiave = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(await crypto.subtle.sign('HMAC', chiave, encoder.encode(payload)));
}

/**
 * Confronto in tempo costante tra due stringhe. Entrambe vengono prima
 * ridotte a digest SHA-256 (lunghezza fissa), poi confrontate byte a byte
 * accumulando le differenze in OR: il tempo di esecuzione non dipende né
 * dalla lunghezza né dal punto in cui i valori differiscono.
 */
export async function confrontoCostante(a: string, b: string): Promise<boolean> {
  const digestA = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(a)));
  const digestB = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(b)));
  let differenze = 0;
  for (let i = 0; i < digestA.length; i++) differenze |= digestA[i] ^ digestB[i];
  return differenze === 0;
}

/** Crea il valore firmato del cookie di sessione per l'utente indicato. */
export async function creaSessione(secret: string, utente: string, durataSecondi: number, adesso: Date): Promise<string> {
  const scadenza = Math.floor(adesso.getTime() / 1000) + durataSecondi;
  const payload = [TIPO_SESSIONE, utente, String(scadenza)].join('.');
  return `${payload}.${await firma(secret, payload)}`;
}

/**
 * Verifica firma, tipo e scadenza di un cookie di sessione.
 * Ritorna il nome utente contenuto nel payload, o null.
 */
export async function verificaSessione(secret: string, valore: string | undefined, adesso: Date): Promise<string | null> {
  if (!valore) return null;
  const separatore = valore.lastIndexOf('.');
  if (separatore <= 0) return null;
  const payload = valore.slice(0, separatore);
  const firmaRicevuta = valore.slice(separatore + 1);
  if (!(await confrontoCostante(firmaRicevuta, await firma(secret, payload)))) return null;
  const parti = payload.split('.');
  if (parti.length !== 3 || parti[0] !== TIPO_SESSIONE) return null;
  const scadenza = Number(parti[2]);
  if (!Number.isFinite(scadenza) || scadenza * 1000 < adesso.getTime()) return null;
  return parti[1];
}

export function scriviCookieSessione(c: Context, valore: string, durataSecondi: number): void {
  setCookie(c, COOKIE_SESSIONE, valore, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: durataSecondi });
}

export function cancellaCookieSessione(c: Context): void {
  deleteCookie(c, COOKIE_SESSIONE, { path: '/' });
}

/**
 * Middleware delle API riservate: verifica il cookie firmato e che l'utente sia
 * ancora configurato, poi espone il nome in c.get('utente').
 */
export function richiedeUtente(): MiddlewareHandler<{ Bindings: Bindings; Variables: VariabiliUtente }> {
  return async (c, next) => {
    const utente = await verificaSessione(c.env.ADMIN_SECRET, getCookie(c, COOKIE_SESSIONE), new Date());
    if (utente === null || !elencoUtenti(c.env).includes(utente)) return c.json({ errore: 'Sessione non valida o scaduta' }, 401);
    c.set('utente', utente);
    await next();
  };
}
