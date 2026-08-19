/**
 * Slot-conflict helpers.
 *
 * The anti-double-booking guarantee lives in the DB (UNIQUE on
 * prenotazioni.slot_key): inserts of occupied slots make the whole db.batch()
 * fail and roll back. These helpers only RECOGNIZE that failure and produce
 * a clear diagnostic for the admin afterwards.
 */

export function eConflittoSlot(errore: unknown): boolean {
  return (
    errore instanceof Error &&
    errore.message.includes('UNIQUE constraint failed') &&
    errore.message.includes('prenotazioni.slot_key')
  );
}

/**
 * Riconosce la violazione dell'indice UNIQUE parziale della migrazione 0005:
 * esiste già una richiesta di annullamento in attesa per la stessa
 * prenotazione. A seconda della versione di SQLite il messaggio riporta la
 * colonna oppure il nome dell'indice, quindi si accettano entrambi.
 */
export function eAnnullamentoDuplicato(errore: unknown): boolean {
  if (!(errore instanceof Error) || !errore.message.includes('UNIQUE constraint failed')) return false;
  return (
    errore.message.includes('richieste.richiesta_riferimento_id') ||
    errore.message.includes('idx_richieste_annullamento_pendente')
  );
}

export type Conflitto = { slot_key: string; societa: string };

/**
 * Trova quali tra le chiavi candidate sono già occupate, e da chi.
 *
 * Una sola query con range [min, max] delle candidate e intersezione in JS:
 * un IN (...) con tutte le chiavi potrebbe superare il limite D1 di 100
 * parametri bound per statement (una ricorrenza può candidare fino a 128
 * slot), mentre il range resta sempre a 2 parametri.
 */
export async function trovaConflitti(db: D1Database, chiaviCandidate: string[]): Promise<Conflitto[]> {
  if (chiaviCandidate.length === 0) return [];
  const ordinate = [...chiaviCandidate].sort();
  const { results } = await db
    .prepare(
      `SELECT p.slot_key, s.nome AS societa
       FROM prenotazioni p JOIN societa s ON s.id = p.societa_id
       WHERE p.slot_key >= ?1 AND p.slot_key <= ?2
       ORDER BY p.slot_key`,
    )
    .bind(ordinate[0], ordinate[ordinate.length - 1])
    .all<Conflitto>();
  const cercate = new Set(chiaviCandidate);
  return results.filter((riga) => cercate.has(riga.slot_key));
}
