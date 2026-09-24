/**
 * Utenti del gestionale: i nomi ammessi stanno nella var UTENTI del Worker
 * (elenco separato da virgola, in chiaro), la password di ciascuno in un
 * secret PASSWORD_<NOME MAIUSCOLO>. Nessuna tabella utenti: aggiungere o
 * togliere un utente è una modifica di configurazione più un deploy.
 */
import type { Bindings } from './tipi';

/** Formato ammesso per un nome utente: deve poter comporre il nome del secret. */
const NOME_UTENTE_RE = /^[A-Za-z0-9_]{1,40}$/;

/** Nomi utente configurati, nell'ordine e nella forma scritti in UTENTI. */
export function elencoUtenti(env: Bindings): string[] {
  const nomi = (env.UTENTI ?? '').split(',').map((nome) => nome.trim());
  return nomi.filter((nome) => NOME_UTENTE_RE.test(nome));
}

/**
 * Cerca l'utente indicato al login ignorando maiuscole/minuscole e ritorna il
 * nome canonico (quello scritto in UTENTI), o null se non è configurato.
 */
export function trovaUtente(env: Bindings, valore: unknown): string | null {
  if (typeof valore !== 'string') return null;
  const cercato = valore.trim().toLowerCase();
  if (cercato === '') return null;
  return elencoUtenti(env).find((nome) => nome.toLowerCase() === cercato) ?? null;
}

/** Password attesa per un utente canonico, letta dal suo secret; undefined se il secret manca. */
export function passwordDi(env: Bindings, utente: string): string | undefined {
  return env[`PASSWORD_${utente.toUpperCase()}`];
}
