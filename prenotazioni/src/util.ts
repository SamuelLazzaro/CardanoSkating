import type { Context } from 'hono';

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
