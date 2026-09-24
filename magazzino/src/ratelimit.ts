/**
 * Rate limit di cortesia su D1 (finestra fissa), copiato da prenotazioni/.
 *
 * Un solo UPSERT fa tutto: se la finestra salvata è più vecchia della sua
 * durata il contatore riparte da 1, altrimenti viene incrementato. In SQLite
 * tutte le espressioni SET di un UPDATE leggono i valori ORIGINALI della
 * riga, quindi i due CASE vedono la stessa finestra_inizio e restano coerenti.
 */
const SQL_TENTATIVO = `INSERT INTO rate_limit (chiave, contatore, finestra_inizio)
  VALUES (?1, 1, datetime('now'))
  ON CONFLICT(chiave) DO UPDATE SET
    contatore = CASE
      WHEN finestra_inizio <= datetime('now', ?2) THEN 1
      ELSE contatore + 1
    END,
    finestra_inizio = CASE
      WHEN finestra_inizio <= datetime('now', ?2) THEN datetime('now')
      ELSE finestra_inizio
    END
  RETURNING contatore`;

export async function tentativoConsentito(db: D1Database, chiave: string, maxTentativi: number, finestraSecondi: number): Promise<boolean> {
  const riga = await db.prepare(SQL_TENTATIVO).bind(chiave, `-${finestraSecondi} seconds`).first<{ contatore: number }>();
  // In caso di risposta anomala si nega per prudenza (fail-closed).
  return (riga?.contatore ?? maxTentativi + 1) <= maxTentativi;
}
