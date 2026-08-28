import type { Context } from 'hono';
import { giornoSettimana } from './slots';

/**
 * Legge il corpo JSON della richiesta. Ritorna null (→ 400 nel chiamante)
 * se il corpo manca, non è JSON valido o non è un oggetto.
 */
export async function leggiJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const valore = await c.req.json();
    if (valore === null || typeof valore !== 'object' || Array.isArray(valore)) return null;
    return valore as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Valida una stringa obbligatoria: ritorna il valore ripulito (trim) se è una
 * stringa non vuota entro la lunghezza massima, altrimenti null.
 */
export function testo(valore: unknown, maxLunghezza: number): string | null {
  if (typeof valore !== 'string') return null;
  const ripulito = valore.trim();
  if (ripulito.length === 0 || ripulito.length > maxLunghezza) return null;
  return ripulito;
}

/** Titolo attività usato quando chi prenota non ne indica uno (o lo svuota). */
export const TITOLO_PREDEFINITO = 'Allenamento';

/** Lunghezza massima del titolo attività (condivisa da società e admin). */
export const MAX_TITOLO = 100;

/**
 * Valida il titolo attività dal corpo della richiesta: assente o vuoto →
 * TITOLO_PREDEFINITO; oltre la lunghezza massima → null (→ 400 nel chiamante).
 */
export function titoloAttivita(valore: unknown): string | null {
  if (typeof valore !== 'string' || valore.trim() === '') return TITOLO_PREDEFINITO;
  return testo(valore, MAX_TITOLO);
}

/**
 * Valida l'elenco dei giorni della settimana di una richiesta ricorrente:
 * array JSON di interi da 0 (lunedì) a 6 (domenica). Ritorna i giorni ordinati
 * e senza doppioni, o null (→ 400 nel chiamante) se il formato non è quello
 * atteso. L'array vuoto è valido: "nessun giorno oltre a quello della data".
 */
function giorniSettimana(valore: unknown): number[] | null {
  if (!Array.isArray(valore) || valore.length > 7) return null;
  const giorni = new Set<number>();
  for (const giorno of valore) {
    if (typeof giorno !== 'number' || !Number.isInteger(giorno) || giorno < 0 || giorno > 6) return null;
    giorni.add(giorno);
  }
  return [...giorni].sort((a, b) => a - b);
}

/**
 * Giorni della settimana di una ricorrenza dal corpo della richiesta (campo
 * facoltativo `giorni`) più, sempre, il giorno della prima data: quella data
 * è la prima occorrenza. Condivisa dalle route società e admin. Ritorna null
 * (→ 400 nel chiamante) se il campo è presente ma malformato.
 */
export function giorniRicorrenza(valore: unknown, data: string): number[] | null {
  const giorniAggiuntivi = valore === undefined ? [] : giorniSettimana(valore);
  if (giorniAggiuntivi === null) return null;
  return [...new Set([...giorniAggiuntivi, giornoSettimana(data)])].sort((a, b) => a - b);
}

/** Limiti di lunghezza della motivazione di una decisione admin: il minimo
 *  a 2 caratteri ammette un "ok" sulle approvazioni (scelta del committente). */
export const MIN_MOTIVAZIONE = 2;
export const MAX_MOTIVAZIONE = 300;

/**
 * Valida la motivazione obbligatoria di una decisione admin (approvazione o
 * rifiuto): trim, da MIN_MOTIVAZIONE a MAX_MOTIVAZIONE caratteri. Ritorna la
 * motivazione ripulita, o null (→ 400 nel chiamante) se assente o fuori misura.
 */
export function motivazioneDecisione(valore: unknown): string | null {
  const ripulita = testo(valore, MAX_MOTIVAZIONE);
  if (ripulita === null || ripulita.length < MIN_MOTIVAZIONE) return null;
  return ripulita;
}

/** Colore distintivo assegnato alle società quando l'admin non ne sceglie uno
 *  (stesso valore del DEFAULT della migrazione 0006). */
export const COLORE_PREDEFINITO = '#3b82f6';

/**
 * Valida un colore '#RRGGBB' e lo normalizza in minuscolo.
 * Ritorna null (→ 400 nel chiamante) se il formato non è quello atteso.
 */
export function coloreEsadecimale(valore: unknown): string | null {
  if (typeof valore !== 'string') return null;
  const ripulito = valore.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(ripulito)) return null;
  return ripulito.toLowerCase();
}

/**
 * Valida la tariffa oraria (€/h): numero finito tra 0 e 10000, arrotondato
 * ai centesimi. Ritorna null (→ 400 nel chiamante) se non valida.
 */
export function tariffaOraria(valore: unknown): number | null {
  if (typeof valore !== 'number' || !Number.isFinite(valore) || valore < 0 || valore > 10000) return null;
  return Math.round(valore * 100) / 100;
}

export function emailValida(valore: string): boolean {
  return valore.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valore);
}

/** Converte un parametro di percorso in intero positivo, o null se non valido. */
export function intero(valore: string | undefined): number | null {
  if (valore === undefined || !/^\d{1,10}$/.test(valore)) return null;
  return Number(valore);
}

/** Statement di audit da includere in un db.batch(). */
export function stmtAudit(db: D1Database, azione: string, dettaglio: string, attore: string): D1PreparedStatement {
  return db.prepare('INSERT INTO audit_log (azione, dettaglio, attore) VALUES (?1, ?2, ?3)').bind(azione, dettaglio, attore);
}

/** Scrittura di audit immediata (fuori da un batch). */
export async function scriviAudit(db: D1Database, azione: string, dettaglio: string, attore: string): Promise<void> {
  await stmtAudit(db, azione, dettaglio, attore).run();
}
