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
// cover at most 4 weekly occurrences, so the materialization batch stays far
// below D1's 50-statements-per-invocation free-plan limit.
export const MAX_SETTIMANE_RICORRENZA = 4;

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

/**
 * Date delle occorrenze settimanali di una ricorrenza: la prima data con il
 * giorno della settimana richiesto a partire da validaDal, poi ogni 7 giorni
 * fino a validaAl incluso.
 */
export function occorrenzeRicorrenza(validaDal: string, validaAl: string, giorno: number): string[] {
  const scarto = (giorno - giornoSettimana(validaDal) + 7) % 7;
  const date: string[] = [];
  for (let d = aggiungiGiorni(validaDal, scarto); d <= validaAl; d = aggiungiGiorni(d, 7)) {
    date.push(d);
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
