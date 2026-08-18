/**
 * Courtesy rate limiting backed by D1 (fixed window).
 *
 * A single UPSERT keeps everything in one query: if the stored window is
 * older than the window length the counter restarts from 1, otherwise it is
 * incremented. In SQLite all SET expressions of an UPDATE evaluate against
 * the row's ORIGINAL values, so the two CASEs below see the same
 * finestra_inizio and stay consistent with each other.
 */
export async function tentativoConsentito(
  db: D1Database,
  chiave: string,
  maxTentativi: number,
  finestraSecondi: number,
): Promise<boolean> {
  const riga = await db
    .prepare(
      `INSERT INTO rate_limit (chiave, contatore, finestra_inizio)
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
       RETURNING contatore`,
    )
    .bind(chiave, `-${finestraSecondi} seconds`)
    .first<{ contatore: number }>();
  // In caso di risposta anomala si nega per prudenza (fail-closed).
  return (riga?.contatore ?? maxTentativi + 1) <= maxTentativi;
}
