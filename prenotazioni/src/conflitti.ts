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
 * Riconosce la violazione dell'indice UNIQUE parziale sulle richieste
 * pendenti riferite a una prenotazione (idx_richieste_variazione_pendente,
 * migrazione 0009, che ha sostituito idx_richieste_annullamento_pendente
 * della 0005): esiste già una richiesta di annullamento o di modifica in
 * attesa per la stessa prenotazione. A seconda della versione di SQLite il
 * messaggio riporta la colonna oppure il nome dell'indice, quindi si accettano
 * entrambi.
 */
export function eVariazionePendenteDuplicata(errore: unknown): boolean {
  if (!(errore instanceof Error) || !errore.message.includes('UNIQUE constraint failed')) return false;
  return (
    errore.message.includes('richieste.richiesta_riferimento_id') ||
    errore.message.includes('idx_richieste_variazione_pendente')
  );
}

/**
 * Riconosce la violazione dell'indice UNIQUE (ricorrenza_id, data) della
 * migrazione 0001: si sta spostando un'occorrenza su una data in cui la stessa
 * serie ha già una richiesta. Chi modifica deve prima sganciare l'occorrenza
 * dalla serie (vedi la modifica di data in routes/*).
 */
export function eOccorrenzaDuplicata(errore: unknown): boolean {
  if (!(errore instanceof Error) || !errore.message.includes('UNIQUE constraint failed')) return false;
  return errore.message.includes('idx_richieste_ricorrenza_data') || errore.message.includes('richieste.ricorrenza_id');
}

export type Conflitto = { slot_key: string; societa: string };

/**
 * Estremi lessicografici delle chiavi candidate.
 *
 * Le ricerche di conflitto interrogano il range [min, max] e intersecano poi
 * in JS: un IN (...) con tutte le chiavi potrebbe superare il limite D1 di
 * 100 parametri bound per statement (una ricorrenza può candidare fino a 128
 * slot), mentre il range resta sempre a 2 parametri.
 */
function estremi(chiaviCandidate: string[]): { minimo: string; massimo: string } {
  const ordinate = [...chiaviCandidate].sort();
  return { minimo: ordinate[0], massimo: ordinate[ordinate.length - 1] };
}

/**
 * Slot già prenotati nel range delle chiavi candidate, con la richiesta a cui
 * appartengono. Il filtro `richiesteEscluse` serve alle MODIFICHE: chi sposta
 * la propria prenotazione dalle 18:00 alle 18:30 ritrova i propri slot tra
 * quelli occupati, ma quegli slot verranno liberati nello stesso batch che
 * prenota i nuovi, quindi non sono un conflitto. Le richieste da escludere
 * sono al più le occorrenze di una ricorrenza (MAX_OCCORRENZE_RICORRENZA):
 * insieme ai due estremi del range restano ben sotto i 100 parametri D1.
 */
async function occupatiNelRange(
  db: D1Database,
  chiaviCandidate: string[],
  richiesteEscluse: number[],
): Promise<{ slot_key: string; societa: string }[]> {
  const { minimo, massimo } = estremi(chiaviCandidate);
  const segnapostoEscluse = richiesteEscluse.map(() => '?').join(', ');
  const filtroEscluse = richiesteEscluse.length > 0 ? `AND p.richiesta_id NOT IN (${segnapostoEscluse})` : '';
  const { results } = await db
    .prepare(
      `SELECT p.slot_key, s.nome AS societa
       FROM prenotazioni p JOIN societa s ON s.id = p.societa_id
       WHERE p.slot_key >= ? AND p.slot_key <= ? ${filtroEscluse}
       ORDER BY p.slot_key`,
    )
    .bind(minimo, massimo, ...richiesteEscluse)
    .all<{ slot_key: string; societa: string }>();
  const cercate = new Set(chiaviCandidate);
  return results.filter((riga) => cercate.has(riga.slot_key));
}

/** Trova quali tra le chiavi candidate sono già occupate, e da chi (vista admin). */
export async function trovaConflitti(db: D1Database, chiaviCandidate: string[], richiesteEscluse: number[] = []): Promise<Conflitto[]> {
  if (chiaviCandidate.length === 0) return [];
  return await occupatiNelRange(db, chiaviCandidate, richiesteEscluse);
}

/**
 * Quali tra le chiavi candidate risultano già prenotate, SENZA dire da chi.
 *
 * È la variante destinata alle società: la diagnostica di un conflitto dice
 * quali fasce sono già prese, non a chi appartengono. Il tipo di ritorno è di
 * sole chiavi proprio perché l'identità di chi occupa lo slot non possa
 * sfuggire nella risposta.
 */
export async function slotOccupati(db: D1Database, chiaviCandidate: string[], richiesteEscluse: number[] = []): Promise<string[]> {
  if (chiaviCandidate.length === 0) return [];
  const occupati = await occupatiNelRange(db, chiaviCandidate, richiesteEscluse);
  return occupati.map((riga) => riga.slot_key);
}
