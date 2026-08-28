/**
 * Pure date/slot logic for the booking system.
 *
 * All domain dates and times are Italian civil time (Europe/Rome), encoded as
 * sortable strings: 'YYYY-MM-DD' for dates, 'HH:MM' for times and
 * 'YYYY-MM-DD_HHMM' for 30-minute slot keys. Working on civil strings keeps
 * every comparison a plain lexicographic one and avoids timezone math
 * entirely; the only place where the real clock enters is oraRoma(), which
 * converts an absolute instant to Italian civil time via Intl.
 *
 * Everything in this module is a pure function (no DB, no I/O) so it can be
 * unit-tested in isolation.
 */

export const ORA_APERTURA_MIN = 8 * 60; // il palazzetto apre alle 08:00
export const ORA_CHIUSURA_MIN = 24 * 60; // e chiude alle 24:00

// Project decision (confirmed by the owner): a single recurring request may
// span at most 4 weeks. The window is 4 full weeks (28 days, both ends
// included) so every requested weekday occurs exactly 4 times; with all 7
// weekdays selected that is 7 × 4 = 28 occurrences. The materialization
// batch (2 statements + one per occurrence, see routes/admin.ts) thus stays
// below D1's 50-queries-per-invocation free-plan limit.
export const MAX_SETTIMANE_RICORRENZA = 4;
/** Distanza massima di valida_al da valida_dal, in giorni (estremi inclusi). */
export const MAX_GIORNI_FINESTRA_RICORRENZA = MAX_SETTIMANE_RICORRENZA * 7 - 1;
/** Occorrenze massime di una ricorrenza: tutti i giorni per tutte le settimane. */
export const MAX_OCCORRENZE_RICORRENZA = MAX_SETTIMANE_RICORRENZA * 7;

/** Weekday convention used across the whole project: 0=lunedì .. 6=domenica. */
export function giornoSettimana(data: string): number {
  // Parse as UTC: a civil date's weekday is timezone-independent, so this is
  // safe and avoids any influence from the host timezone.
  const [anno, mese, giorno] = data.split('-').map(Number);
  const utc = new Date(Date.UTC(anno, mese - 1, giorno));
  // getUTCDay(): 0=domenica..6=sabato → converted to 0=lunedì..6=domenica.
  return (utc.getUTCDay() + 6) % 7;
}

export function isDataValida(valore: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valore)) return false;
  // Round-trip through Date.UTC to reject impossible dates like 2026-02-30,
  // which Date would otherwise silently roll over into the next month.
  const [anno, mese, giorno] = valore.split('-').map(Number);
  const d = new Date(Date.UTC(anno, mese - 1, giorno));
  return d.getUTCFullYear() === anno && d.getUTCMonth() === mese - 1 && d.getUTCDate() === giorno;
}

export function minutiDaMezzanotte(ora: string): number {
  const [ore, minuti] = ora.split(':').map(Number);
  return ore * 60 + minuti;
}

/** 'HH:MM' a passi di 30 minuti, tra 00:00 e 24:00 inclusi. */
export function isOrarioValido(valore: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(valore)) return false;
  const minuti = minutiDaMezzanotte(valore);
  return minuti % 30 === 0 && minuti >= 0 && minuti <= ORA_CHIUSURA_MIN;
}

/**
 * Valida un intervallo (data + ora inizio/fine) per una prenotazione.
 * Ritorna null se valido, altrimenti un messaggio d'errore per l'utente.
 */
export function validaIntervallo(data: string, oraInizio: string, oraFine: string): string | null {
  if (!isDataValida(data)) return 'Data non valida (formato atteso AAAA-MM-GG)';
  if (!isOrarioValido(oraInizio) || !isOrarioValido(oraFine)) {
    return 'Orario non valido: usare orari a passi di 30 minuti (es. 18:00, 18:30)';
  }
  const inizio = minutiDaMezzanotte(oraInizio);
  const fine = minutiDaMezzanotte(oraFine);
  if (inizio >= fine) return "L'ora di inizio deve precedere l'ora di fine";
  if (inizio < ORA_APERTURA_MIN) return 'Il palazzetto apre alle 08:00';
  if (fine > ORA_CHIUSURA_MIN) return 'Il palazzetto chiude alle 24:00';
  return null;
}

/**
 * Espande un intervallo nella lista di slot_key da 30 minuti che occupa.
 * Lo slot è identificato dal suo orario di INIZIO: l'intervallo 18:30-20:00
 * produce _1830, _1900, _1930 (l'ultimo slot copre 19:30-20:00).
 */
export function slotKeys(data: string, oraInizio: string, oraFine: string): string[] {
  const chiavi: string[] = [];
  for (let minuti = minutiDaMezzanotte(oraInizio); minuti < minutiDaMezzanotte(oraFine); minuti += 30) {
    const hh = String(Math.floor(minuti / 60)).padStart(2, '0');
    const mm = String(minuti % 60).padStart(2, '0');
    chiavi.push(`${data}_${hh}${mm}`);
  }
  return chiavi;
}

/** Minuti da mezzanotte → 'HH:MM' (1440 → '24:00', l'ora di chiusura). */
export function oraDaMinuti(minuti: number): string {
  return `${String(Math.floor(minuti / 60)).padStart(2, '0')}:${String(minuti % 60).padStart(2, '0')}`;
}

/** Intervallo continuo su una singola data, come viene mostrato agli utenti. */
export type FasciaOraria = { data: string; ora_inizio: string; ora_fine: string };

/**
 * Comprime una lista di slot_key nelle fasce continue che ricoprono.
 *
 * Serve a dire a chi prenota "12/03/2027 dalle 18:00 alle 19:00" invece di
 * elencare ogni mezz'ora: una richiesta ricorrente può toccare fino a 128
 * slot, illeggibili uno per uno.
 *
 * Algoritmo: le slot_key hanno formato ordinabile a larghezza fissa, quindi
 * ordinarle lessicograficamente le mette in ordine cronologico. Scorrendole
 * in sequenza, ogni slot o prolunga la fascia aperta — se inizia esattamente
 * quando quella finisce, nella stessa data — oppure ne apre una nuova. Un
 * buco temporale o un cambio di data chiudono sempre la fascia in corso.
 */
export function raggruppaSlotInFasce(chiavi: string[]): FasciaOraria[] {
  const fasce: FasciaOraria[] = [];
  for (const chiave of [...chiavi].sort()) {
    const [data, orario] = chiave.split('_');
    const minutiInizio = Number(orario.slice(0, 2)) * 60 + Number(orario.slice(2));
    const oraInizio = oraDaMinuti(minutiInizio);
    const oraFine = oraDaMinuti(minutiInizio + 30);

    const fasciaAperta = fasce[fasce.length - 1];
    const prolungaLaFascia = fasciaAperta !== undefined && fasciaAperta.data === data && fasciaAperta.ora_fine === oraInizio;
    if (prolungaLaFascia) {
      fasciaAperta.ora_fine = oraFine;
    } else {
      fasce.push({ data, ora_inizio: oraInizio, ora_fine: oraFine });
    }
  }
  return fasce;
}

/** Aritmetica su date civili (via Date.UTC, quindi senza effetti di fuso). */
export function aggiungiGiorni(data: string, giorni: number): string {
  const [anno, mese, giorno] = data.split('-').map(Number);
  const utc = new Date(Date.UTC(anno, mese - 1, giorno + giorni));
  return utc.toISOString().slice(0, 10);
}

/** Lunedì della settimana a cui appartiene la data. */
export function lunediDellaSettimana(data: string): string {
  return aggiungiGiorni(data, -giornoSettimana(data));
}

/** Domenica della settimana a cui appartiene la data. */
export function domenicaDellaSettimana(data: string): string {
  return aggiungiGiorni(data, 6 - giornoSettimana(data));
}

/**
 * Giorni della settimana di una ricorrenza, dal formato salvato in DB
 * ('0,2,4', vedi migrazione 0008) all'array di numeri [0, 2, 4].
 */
export function giorniDaTesto(testo: string): number[] {
  return testo
    .split(',')
    .filter((parte) => parte !== '')
    .map(Number);
}

/** Inverso di giorniDaTesto: ordina, elimina i doppioni e serializza ('0,2,4'). */
export function giorniInTesto(giorni: number[]): string {
  return [...new Set(giorni)].sort((a, b) => a - b).join(',');
}

/**
 * Riga di ricorrenza pronta per la risposta JSON: la colonna testuale `giorni`
 * diventa l'array di numeri usato da frontend e notifiche.
 */
export function ricorrenzaConGiorni<T extends { giorni: string }>(riga: T): Omit<T, 'giorni'> & { giorni: number[] } {
  return { ...riga, giorni: giorniDaTesto(riga.giorni) };
}

/**
 * Fine del periodo di una ricorrenza, dai campi del form (condivisa dalle
 * route società e admin): la data di "ripeti fino al" — che deve essere una
 * data valida, successiva alla prima e dentro la finestra di
 * MAX_SETTIMANE_RICORRENZA settimane piene — oppure, senza ripetizione
 * settimanale, la domenica della settimana della prima data (gli altri giorni
 * richiesti valgono solo per quella settimana). In caso di errore ritorna il
 * messaggio da mostrare all'utente.
 */
export function fineRicorrenza(data: string, ripetiFinoAl: string): { validaAl: string } | { errore: string } {
  if (ripetiFinoAl === '') return { validaAl: domenicaDellaSettimana(data) };
  if (!isDataValida(ripetiFinoAl) || ripetiFinoAl <= data) {
    return { errore: 'La data di fine ripetizione deve essere una data successiva alla prima' };
  }
  const massimo = aggiungiGiorni(data, MAX_GIORNI_FINESTRA_RICORRENZA);
  if (ripetiFinoAl > massimo) {
    return { errore: `La ripetizione settimanale può coprire al massimo ${MAX_SETTIMANE_RICORRENZA} settimane (fino al ${massimo})` };
  }
  return { validaAl: ripetiFinoAl };
}

/**
 * Date delle occorrenze di una ricorrenza: tutti i giorni tra validaDal e
 * validaAl (inclusi) il cui giorno della settimana è tra quelli richiesti,
 * in ordine cronologico. Con un solo giorno richiesto equivale a "ogni 7
 * giorni a partire dalla prima data utile". La finestra è al massimo di
 * MAX_GIORNI_FINESTRA_RICORRENZA giorni, quindi il ciclo resta corto.
 */
export function occorrenzeRicorrenza(validaDal: string, validaAl: string, giorni: number[]): string[] {
  const giorniRichiesti = new Set(giorni);
  const date: string[] = [];
  for (let d = validaDal; d <= validaAl; d = aggiungiGiorni(d, 1)) {
    if (giorniRichiesti.has(giornoSettimana(d))) date.push(d);
  }
  return date;
}

/** 'YYYY-MM' con mese 01-12 (parametro del report mensile). */
export function isMeseValido(valore: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(valore);
}

/** Mese successivo: '2026-12' → '2027-01' (per i range lessicografici sul mese). */
export function meseSuccessivo(mese: string): string {
  const [anno, numeroMese] = mese.split('-').map(Number);
  if (numeroMese === 12) return `${anno + 1}-01`;
  return `${anno}-${String(numeroMese + 1).padStart(2, '0')}`;
}

/**
 * Primo e ultimo giorno della griglia mensile del calendario: non il mese
 * secco, ma le settimane intere che lo contengono (dal lunedì della settimana
 * del giorno 1 alla domenica della settimana dell'ultimo giorno). Sono le
 * stesse celle che il frontend disegna, quindi una sola query copre anche i
 * giorni di riempimento delle settimane a cavallo. Copre da 4 a 6 settimane.
 */
export function intervalloGrigliaMese(mese: string): { dal: string; al: string } {
  const primoGiorno = `${mese}-01`;
  const ultimoGiorno = aggiungiGiorni(`${meseSuccessivo(mese)}-01`, -1);
  return { dal: lunediDellaSettimana(primoGiorno), al: domenicaDellaSettimana(ultimoGiorno) };
}

/**
 * Intervallo di date mostrato da un calendario, risolto dai parametri della
 * query string: `mese=AAAA-MM` per la vista mensile, `settimana=AAAA-MM-GG`
 * (una data qualsiasi della settimana) per quella settimanale, nessuno dei due
 * per la settimana corrente. In entrambi i casi `dal`/`al` sono gli estremi
 * inclusi, così il chiamante costruisce il range di slot_key allo stesso modo.
 */
export type IntervalloCalendario =
  | { tipo: 'settimana'; lunedi: string; dal: string; al: string }
  | { tipo: 'mese'; mese: string; dal: string; al: string }
  | { tipo: 'errore'; messaggio: string };

/**
 * Risolve i parametri di un endpoint di calendario nell'intervallo da leggere.
 * `mese` ha la precedenza su `settimana`: il frontend ne invia sempre uno solo.
 */
export function intervalloCalendario(
  settimana: string | undefined,
  mese: string | undefined,
  istante: Date,
): IntervalloCalendario {
  if (mese !== undefined && mese !== '') {
    if (!isMeseValido(mese)) return { tipo: 'errore', messaggio: 'Parametro mese non valido (formato atteso AAAA-MM)' };
    const { dal, al } = intervalloGrigliaMese(mese);
    return { tipo: 'mese', mese, dal, al };
  }

  let riferimento: string;
  if (settimana === undefined || settimana === '') {
    riferimento = oraRoma(istante).data;
  } else if (isDataValida(settimana)) {
    riferimento = settimana;
  } else {
    return { tipo: 'errore', messaggio: 'Parametro settimana non valido (formato atteso AAAA-MM-GG)' };
  }
  const lunedi = lunediDellaSettimana(riferimento);
  return { tipo: 'settimana', lunedi, dal: lunedi, al: aggiungiGiorni(lunedi, 6) };
}

/** Converte un istante assoluto in data e ora civili italiane. */
export function oraRoma(istante: Date): { data: string; ora: string } {
  const parti = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(istante);
  const valore = (tipo: string): string => parti.find((p) => p.type === tipo)?.value ?? '';
  return {
    data: `${valore('year')}-${valore('month')}-${valore('day')}`,
    ora: `${valore('hour')}:${valore('minute')}`,
  };
}

/** slot_key dello slot in corso adesso (ora italiana arrotondata ai 30'). */
export function slotKeyCorrente(istante: Date): string {
  const { data, ora } = oraRoma(istante);
  const [ore, minuti] = ora.split(':').map(Number);
  return `${data}_${String(ore).padStart(2, '0')}${minuti < 30 ? '00' : '30'}`;
}
