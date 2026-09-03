import type { Ambito, RichiestaRow } from './tipi';
import { MAX_OCCORRENZE_RICORRENZA, oraRoma, slotKeys, validaIntervallo } from './slots';
import { MAX_TITOLO, testo, titoloAttivita } from './util';

/**
 * Helper condivisi dalle route società e admin per le VARIAZIONI di una
 * prenotazione approvata: modifica (data/orario/attività/note) e annullamento,
 * sulla singola occorrenza oppure su "questa e le successive" occorrenze della
 * stessa ricorrenza (vedi tipi.Ambito e migrazione 0009).
 *
 * Qui vive tutto ciò che non dipende da chi agisce (società o admin): la
 * lettura dell'ambito, la selezione delle occorrenze coinvolte, la validazione
 * dei nuovi valori e la costruzione degli statement di inserimento slot a
 * blocchi. Le route restano così responsabili solo di autorizzazione, guardie
 * di stato e notifiche.
 */

export const MAX_NOTE = 500;

/** Formato dell'identificativo di gruppo generato con crypto.randomUUID(). */
const GRUPPO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Legge l'ambito dal corpo della richiesta: assente → 'singola'; altrimenti
 * deve essere uno dei due valori ammessi (null → 400 nel chiamante).
 */
export function ambitoVariazione(valore: unknown): Ambito | null {
  if (valore === undefined) return 'singola';
  if (valore === 'singola' || valore === 'successive') return valore;
  return null;
}

/** Identificativo di gruppo da parametro di percorso, o null se malformato. */
export function idGruppo(valore: string | undefined): string | null {
  if (valore === undefined || !GRUPPO_RE.test(valore)) return null;
  return valore;
}

/** Vero se la richiesta deve ancora iniziare (ora civile italiana). */
export function eFutura(richiesta: { data: string; ora_inizio: string }, adesso: { data: string; ora: string }): boolean {
  return richiesta.data > adesso.data || (richiesta.data === adesso.data && richiesta.ora_inizio > adesso.ora);
}

/**
 * Occorrenze su cui applicare una variazione, a partire dalla prenotazione
 * cliccata (già verificata dal chiamante: tipo 'nuova', stato 'approvata',
 * futura, e per la società di sua proprietà):
 *
 *  - 'singola', oppure prenotazione non ricorrente: solo quella;
 *  - 'successive': tutte le prenotazioni approvate della stessa ricorrenza con
 *    data uguale o successiva a quella cliccata, escluse quelle già iniziate.
 *    Le occorrenze precedenti alla cliccata restano intatte anche se future,
 *    perché è questo che "questa e le successive" promette all'utente.
 *
 * La cliccata è sempre la prima dell'elenco. Al più MAX_OCCORRENZE_RICORRENZA
 * righe: una ricorrenza copre 4 settimane su 7 giorni.
 */
export async function occorrenzeDaVariare(db: D1Database, cliccata: RichiestaRow, ambito: Ambito): Promise<RichiestaRow[]> {
  if (ambito === 'singola' || cliccata.ricorrenza_id === null) return [cliccata];
  const adesso = oraRoma(new Date());
  const { results } = await db
    .prepare(
      `SELECT * FROM richieste
       WHERE ricorrenza_id = ?1 AND tipo = 'nuova' AND stato = 'approvata' AND data >= ?2
       ORDER BY data, ora_inizio LIMIT ${MAX_OCCORRENZE_RICORRENZA}`,
    )
    .bind(cliccata.ricorrenza_id, cliccata.data)
    .all<RichiestaRow>();
  // La cliccata è stata letta dal chiamante e potrebbe non ricomparire (corsa
  // con un annullamento): la si mette comunque per prima, senza doppioni.
  const successive = results.filter((riga) => riga.id !== cliccata.id && eFutura(riga, adesso));
  return [cliccata, ...successive];
}

/** Nuovi valori di una modifica, già validati. `data` è null quando non cambia. */
export type CampiModifica = {
  data: string | null;
  oraInizio: string;
  oraFine: string;
  titolo: string;
  note: string | null;
};

/**
 * Valida i nuovi valori di una modifica dal corpo JSON. Orario e attività sono
 * obbligatori (il form li reinvia sempre, precompilati); la data è facoltativa
 * e, se presente, ammessa solo con ambito 'singola': applicata a più
 * occorrenze sposterebbe tutte le date della serie sullo stesso giorno, il che
 * non ha senso (decisione del committente: alla serie si propagano orario,
 * attività e note, mai la data). Le note vuote diventano NULL, come alla
 * creazione. In caso di errore ritorna il messaggio per l'utente.
 */
export function campiModifica(corpo: Record<string, unknown>, ambito: Ambito, dataAttuale: string): CampiModifica | { errore: string } {
  const oraInizio = typeof corpo.ora_inizio === 'string' ? corpo.ora_inizio.trim() : '';
  const oraFine = typeof corpo.ora_fine === 'string' ? corpo.ora_fine.trim() : '';

  let data: string | null = null;
  if (typeof corpo.data === 'string' && corpo.data.trim() !== '' && corpo.data.trim() !== dataAttuale) {
    if (ambito === 'successive') {
      return { errore: 'La data si può cambiare solo su una singola occorrenza, non su tutta la serie' };
    }
    data = corpo.data.trim();
  }

  // validaIntervallo controlla anche il formato della data: le si passa
  // quella nuova, oppure quella attuale (già valida) se non cambia.
  const erroreIntervallo = validaIntervallo(data ?? dataAttuale, oraInizio, oraFine);
  if (erroreIntervallo) return { errore: erroreIntervallo };

  const titolo = titoloAttivita(corpo.titolo);
  if (titolo === null) return { errore: `Titolo attività troppo lungo (max ${MAX_TITOLO} caratteri)` };

  let note: string | null = null;
  if (typeof corpo.note === 'string' && corpo.note.trim() !== '') {
    note = testo(corpo.note, MAX_NOTE);
    if (note === null) return { errore: `Note troppo lunghe (max ${MAX_NOTE} caratteri)` };
  }

  return { data, oraInizio, oraFine, titolo, note };
}

/** Vero se la modifica lascerebbe la prenotazione esattamente com'è. */
export function modificaSenzaEffetto(campi: CampiModifica, attuale: RichiestaRow): boolean {
  return (
    campi.data === null &&
    campi.oraInizio === attuale.ora_inizio &&
    campi.oraFine === attuale.ora_fine &&
    campi.titolo === attuale.titolo &&
    (campi.note ?? null) === (attuale.note ?? null)
  );
}

/** Data che un'occorrenza avrà dopo la modifica: la nuova, se c'è, altrimenti la sua. */
export function dataDopoModifica(campi: CampiModifica, occorrenza: RichiestaRow): string {
  return campi.data ?? occorrenza.data;
}

/** Chiavi slot che le occorrenze occuperanno dopo la modifica. */
export function chiaviDopoModifica(campi: CampiModifica, occorrenze: RichiestaRow[]): string[] {
  return occorrenze.flatMap((occorrenza) => slotKeys(dataDopoModifica(campi, occorrenza), campi.oraInizio, campi.oraFine));
}

/** Uno slot da prenotare per una richiesta già esistente (id noto). */
export type SlotDaInserire = { chiave: string; richiestaId: number };

/**
 * Coppie (slot, richiesta) per prenotare le nuove fasce delle occorrenze dopo
 * una modifica: le richieste esistono già, quindi gli id sono noti e non serve
 * risalire alla riga con sub-select come nella materializzazione.
 */
export function slotDopoModifica(campi: CampiModifica, occorrenze: RichiestaRow[]): SlotDaInserire[] {
  return occorrenze.flatMap((occorrenza) =>
    slotKeys(dataDopoModifica(campi, occorrenza), campi.oraInizio, campi.oraFine).map((chiave) => ({ chiave, richiestaId: occorrenza.id })),
  );
}

/**
 * Coppie per statement: 2 parametri bound a coppia più eventuali parametri
 * fissi della guardia, sotto il limite D1 di 100 per statement.
 */
const COPPIE_PER_STATEMENT = 45;

/**
 * Condizione aggiuntiva per l'inserimento degli slot di una modifica
 * APPROVABILE: la richiesta di modifica (per id) o il gruppo di richieste (per
 * gruppo_id) che riguarda la prenotazione deve risultare 'approvata' nello
 * stesso batch. Assente per la modifica diretta dell'admin, che non passa da
 * una richiesta.
 */
export type GuardiaApprovazione = { modifica: number } | { gruppo: string } | null;

/**
 * Statement di inserimento degli slot, a blocchi (limite D1: 100 parametri
 * bound per statement; una modifica su 28 occorrenze di una giornata intera
 * arriva a 28 × 32 = 896 slot, quindi fino a 20 statement — sotto le 50 query
 * per invocazione insieme al resto del batch).
 *
 * Ogni riga viene inserita SOLO se la sua richiesta risulta approvata e, con
 * una guardia, solo se la richiesta di modifica che la riguarda è a sua volta
 * stata portata ad 'approvata' nello stesso batch: è la stessa guardia EXISTS
 * usata dall'annullamento approvabile, che rende innocua una decisione
 * concorrente (nessuno slot viene prenotato per una prenotazione la cui
 * modifica non è passata). La società proprietaria è letta dalla richiesta,
 * non dal chiamante.
 */
export function istruzioniInserimentoSlot(db: D1Database, slot: SlotDaInserire[], guardia: GuardiaApprovazione = null): D1PreparedStatement[] {
  const istruzioni: D1PreparedStatement[] = [];
  let condizioneGuardia = '';
  let parametroGuardia: string | number | null = null;
  if (guardia !== null && 'modifica' in guardia) {
    condizioneGuardia = `AND EXISTS (SELECT 1 FROM richieste m WHERE m.id = ? AND m.stato = 'approvata' AND m.richiesta_riferimento_id = r.id)`;
    parametroGuardia = guardia.modifica;
  } else if (guardia !== null) {
    condizioneGuardia = `AND EXISTS (SELECT 1 FROM richieste m WHERE m.gruppo_id = ? AND m.stato = 'approvata' AND m.richiesta_riferimento_id = r.id)`;
    parametroGuardia = guardia.gruppo;
  }
  for (let inizio = 0; inizio < slot.length; inizio += COPPIE_PER_STATEMENT) {
    const blocco = slot.slice(inizio, inizio + COPPIE_PER_STATEMENT);
    const segnaposto = blocco.map(() => '(?, ?)').join(', ');
    const parametri: (string | number)[] = blocco.flatMap((coppia) => [coppia.chiave, coppia.richiestaId]);
    if (parametroGuardia !== null) parametri.push(parametroGuardia);
    istruzioni.push(
      db
        .prepare(
          `WITH slot(chiave, richiesta_id) AS (VALUES ${segnaposto})
           INSERT INTO prenotazioni (slot_key, societa_id, richiesta_id)
           SELECT slot.chiave, r.societa_id, r.id
           FROM slot JOIN richieste r ON r.id = slot.richiesta_id
           WHERE r.stato = 'approvata' ${condizioneGuardia}`,
        )
        .bind(...parametri),
    );
  }
  return istruzioni;
}

/** Segnaposto e parametri per una clausola IN sugli id delle occorrenze (≤ 28). */
export function elencoId(occorrenze: { id: number }[]): { segnaposto: string; ids: number[] } {
  return { segnaposto: occorrenze.map(() => '?').join(', '), ids: occorrenze.map((occorrenza) => occorrenza.id) };
}
