/**
 * Session and authentication helpers.
 *
 * Sessions are stateless signed cookies: "<payload>.<signature>" where the
 * payload is dot-separated ("societa.<id>.<tokenHash>.<exp>" or
 * "admin.<exp>") and the signature is HMAC-SHA256 (base64url) computed with
 * the ADMIN_SECRET env secret. WebCrypto HMAC costs microseconds of CPU, well
 * within the 10ms free-plan budget.
 *
 * The società payload embeds a short hash of the CURRENT token_accesso: when
 * the admin regenerates a società's link, every previously issued session
 * stops matching and is therefore invalidated without any server-side state.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Bindings, SocietaRow, VariabiliSocieta } from './tipi';

export const COOKIE_SOCIETA = 'sess_societa';
export const COOKIE_ADMIN = 'sess_admin';
export const DURATA_SOCIETA_S = 60 * 60 * 24 * 30; // 30 giorni
export const DURATA_ADMIN_S = 60 * 60 * 8; // 8 ore

const encoder = new TextEncoder();

function base64url(buffer: ArrayBuffer): string {
  let binario = '';
  for (const byte of new Uint8Array(buffer)) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function firma(secret: string, payload: string): Promise<string> {
  const chiave = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
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

/** Hash breve (8 byte esadecimali) del token, incluso nel payload di sessione. */
export async function hashToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Crea il valore firmato del cookie: parti = ['societa', id, tokenHash] o ['admin']. */
export async function creaSessione(secret: string, parti: string[], durataSecondi: number, adesso: Date): Promise<string> {
  const scadenza = Math.floor(adesso.getTime() / 1000) + durataSecondi;
  const payload = [...parti, String(scadenza)].join('.');
  return `${payload}.${await firma(secret, payload)}`;
}

/**
 * Verifica firma, tipo e scadenza di un cookie di sessione.
 * Ritorna le parti centrali del payload (senza tipo né scadenza), o null.
 */
export async function verificaSessione(
  secret: string,
  valore: string | undefined,
  tipoAtteso: 'societa' | 'admin',
  adesso: Date,
): Promise<string[] | null> {
  if (!valore) return null;
  const separatore = valore.lastIndexOf('.');
  if (separatore <= 0) return null;
  const payload = valore.slice(0, separatore);
  const firmaRicevuta = valore.slice(separatore + 1);
  if (!(await confrontoCostante(firmaRicevuta, await firma(secret, payload)))) return null;
  const parti = payload.split('.');
  if (parti[0] !== tipoAtteso) return null;
  const scadenza = Number(parti[parti.length - 1]);
  if (!Number.isFinite(scadenza) || scadenza * 1000 < adesso.getTime()) return null;
  return parti.slice(1, -1);
}

export function scriviCookieSessione(c: Context, nome: string, valore: string, durataSecondi: number): void {
  setCookie(c, nome, valore, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: durataSecondi,
  });
}

export function cancellaCookieSessione(c: Context, nome: string): void {
  deleteCookie(c, nome, { path: '/' });
}

/**
 * Middleware area società: verifica il cookie firmato e ricarica la società
 * dal DB a ogni richiesta, così sospensione o rigenerazione del link hanno
 * effetto immediato su tutte le sessioni già emesse.
 */
export function richiedeSocieta(): MiddlewareHandler<{ Bindings: Bindings; Variables: VariabiliSocieta }> {
  return async (c, next) => {
    const parti = await verificaSessione(c.env.ADMIN_SECRET, getCookie(c, COOKIE_SOCIETA), 'societa', new Date());
    if (!parti || parti.length !== 2) return c.json({ errore: 'Sessione non valida o scaduta' }, 401);
    const [idTesto, tokenHashSessione] = parti;
    const societa = await c.env.DB
      .prepare('SELECT id, nome, referente, email, telefono, stato, colore, token_accesso, created_at FROM societa WHERE id = ?1')
      .bind(Number(idTesto))
      .first<SocietaRow>();
    if (!societa || societa.stato !== 'attiva') return c.json({ errore: 'Accesso non più valido' }, 401);
    if ((await hashToken(societa.token_accesso)) !== tokenHashSessione) {
      // Il link personale è stato rigenerato: le vecchie sessioni decadono.
      return c.json({ errore: 'Accesso non più valido' }, 401);
    }
    c.set('societa', societa);
    await next();
  };
}

/** Middleware pannello admin. */
export function richiedeAdmin(): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c, next) => {
    const parti = await verificaSessione(c.env.ADMIN_SECRET, getCookie(c, COOKIE_ADMIN), 'admin', new Date());
    if (!parti) return c.json({ errore: 'Accesso riservato' }, 401);
    await next();
  };
}
