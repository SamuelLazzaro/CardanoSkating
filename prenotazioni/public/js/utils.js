/*
 * utils.js — pure helper functions (no DOM, no state, no side effects).
 *
 * Dates are 'YYYY-MM-DD' strings and times are minutes from midnight,
 * mirroring the server-side conventions: string comparison is enough
 * everywhere and no timezone conversion ever happens client-side except in
 * adessoRoma(), which converts an instant to Italian civil time via Intl.
 */
import { PASSO_MIN } from './constants.js';

/**
 * @param {string} valore - candidate 'YYYY-MM-DD' string
 * @returns {boolean} true when the string is a real calendar date
 */
export function dataValida(valore) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valore)) return false;
  const [anno, mese, giorno] = valore.split('-').map(Number);
  const dataProva = new Date(Date.UTC(anno, mese - 1, giorno));
  return dataProva.getUTCFullYear() === anno && dataProva.getUTCMonth() === mese - 1 && dataProva.getUTCDate() === giorno;
}

/**
 * Civil-date arithmetic via Date.UTC: immune to the browser timezone.
 * @param {string} data - 'YYYY-MM-DD'
 * @param {number} giorni - days to add (can be negative)
 * @returns {string} resulting 'YYYY-MM-DD'
 */
export function aggiungiGiorni(data, giorni) {
  const [anno, mese, giorno] = data.split('-').map(Number);
  return new Date(Date.UTC(anno, mese - 1, giorno + giorni)).toISOString().slice(0, 10);
}

/**
 * @param {string} data - 'YYYY-MM-DD'
 * @returns {number} weekday, 0 = lunedì .. 6 = domenica (project convention)
 */
export function giornoSettimana(data) {
  const [anno, mese, giorno] = data.split('-').map(Number);
  return (new Date(Date.UTC(anno, mese - 1, giorno)).getUTCDay() + 6) % 7;
}

/**
 * @param {string} data - 'YYYY-MM-DD'
 * @returns {string} the Monday of the week the date belongs to
 */
export function lunediDellaSettimana(data) {
  return aggiungiGiorni(data, -giornoSettimana(data));
}

/**
 * Current date and time in Italian civil time (the only timezone-aware spot).
 * @param {Date} [istante] - instant to convert, defaults to now
 * @returns {{data: string, ora: string, minuti: number}}
 */
export function adessoRoma(istante = new Date()) {
  const parti = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(istante);
  const valore = (tipo) => parti.find((parte) => parte.type === tipo)?.value ?? '';
  return {
    data: `${valore('year')}-${valore('month')}-${valore('day')}`,
    ora: `${valore('hour')}:${valore('minute')}`,
    minuti: Number(valore('hour')) * 60 + Number(valore('minute')),
  };
}

/**
 * @param {number} minuti - minutes from midnight
 * @returns {string} 'HH:MM' (1440 → '24:00')
 */
export function oraTesto(minuti) {
  return `${String(Math.floor(minuti / 60)).padStart(2, '0')}:${String(minuti % 60).padStart(2, '0')}`;
}

/**
 * @param {string} ora - 'HH:MM'
 * @returns {number} minutes from midnight
 */
export function minutiDaOra(ora) {
  const [ore, minuti] = ora.split(':').map(Number);
  return ore * 60 + minuti;
}

/**
 * @param {string} data - 'YYYY-MM-DD'
 * @param {number} minuti - slot start, minutes from midnight
 * @returns {string} slot key 'YYYY-MM-DD_HHMM' (same format as the server)
 */
export function chiaveSlot(data, minuti) {
  return `${data}_${oraTesto(minuti).replace(':', '')}`;
}

/**
 * Expands a time range into the slot keys it occupies (mirrors the server).
 * @param {string} data - 'YYYY-MM-DD'
 * @param {string} oraInizio - 'HH:MM'
 * @param {string} oraFine - 'HH:MM'
 * @returns {string[]} slot keys, in order
 */
export function espandiSlot(data, oraInizio, oraFine) {
  const chiavi = [];
  for (let minuti = minutiDaOra(oraInizio); minuti < minutiDaOra(oraFine); minuti += PASSO_MIN) {
    chiavi.push(chiaveSlot(data, minuti));
  }
  return chiavi;
}

/*
 * Splits the slots a società owns in one week into two sets, so the area
 * calendar can paint confirmed bookings and undecided requests differently:
 *
 *  - approvati: the admin said yes, the slot is booked;
 *  - inAttesa:  the request exists but nobody decided yet. Painting these
 *               is what stops the società from asking for the very same slot
 *               again, since the server-side conflict check only knows about
 *               APPROVED bookings and would accept the duplicate.
 *
 * Two sources feed inAttesa, because a pending request can live in either
 * table: a single richiesta with stato 'in_attesa', and a pending ricorrenza,
 * which holds no richieste rows at all until it is approved and therefore has
 * to be expanded here from the series definition.
 */

/**
 * @param {{tipo: string, stato: string, data: string, ora_inizio: string, ora_fine: string}[]} richieste - the società's richieste
 * @param {{stato: string, giorno_settimana: number, ora_inizio: string, ora_fine: string, valida_dal: string, valida_al: string}[]} ricorrenze - the società's ricorrenze
 * @param {string} lunedi - Monday of the week to classify, 'YYYY-MM-DD'
 * @returns {{approvati: Set<string>, inAttesa: Set<string>}} slot keys of that week
 */
export function slotSocietaSettimana(richieste, ricorrenze, lunedi) {
  const fineSettimana = aggiungiGiorni(lunedi, 7);
  const approvati = new Set();
  const inAttesa = new Set();

  for (const richiesta of richieste) {
    // Only booking requests hold slots. An annullamento request is skipped
    // whatever its state: once approved its referenced booking has just been
    // freed, and while pending that booking is still fully valid, so its
    // slots must keep showing as approved rather than as undecided.
    if (richiesta.tipo !== 'nuova') continue;
    if (richiesta.stato !== 'approvata' && richiesta.stato !== 'in_attesa') continue;
    if (richiesta.data < lunedi || richiesta.data >= fineSettimana) continue;
    const destinazione = richiesta.stato === 'approvata' ? approvati : inAttesa;
    for (const chiave of espandiSlot(richiesta.data, richiesta.ora_inizio, richiesta.ora_fine)) {
      destinazione.add(chiave);
    }
  }

  for (const ricorrenza of ricorrenze) {
    if (ricorrenza.stato !== 'in_attesa') continue;
    // 0 = lunedì in the project convention and lunedi is a Monday, so the
    // occurrence falling in this week is exactly that many days later.
    const giorno = aggiungiGiorni(lunedi, ricorrenza.giorno_settimana);
    if (giorno < ricorrenza.valida_dal || giorno > ricorrenza.valida_al) continue;
    for (const chiave of espandiSlot(giorno, ricorrenza.ora_inizio, ricorrenza.ora_fine)) {
      inAttesa.add(chiave);
    }
  }

  return { approvati, inAttesa };
}

/**
 * @param {number} valore - number to format
 * @param {number} decimali - fixed decimal digits
 * @returns {string} Italian-style number (decimal comma), e.g. "12,50"
 */
export function numeroItaliano(valore, decimali) {
  return valore.toFixed(decimali).replace('.', ',');
}

/**
 * Defence in depth: the server already validates società colors, but values
 * coming from the API are re-checked before being injected into inline
 * styles, so a corrupted value can never reach the DOM.
 * @param {unknown} valore - candidate '#RRGGBB' color
 * @returns {boolean} true when the value is a well-formed hex color
 */
export function eColoreEsadecimale(valore) {
  return typeof valore === 'string' && /^#[0-9a-fA-F]{6}$/.test(valore);
}

/**
 * @param {string} data - 'YYYY-MM-DD'
 * @returns {Date} the civil date as a UTC Date (for Intl formatting only)
 */
function dataUTC(data) {
  const [anno, mese, giorno] = data.split('-').map(Number);
  return new Date(Date.UTC(anno, mese - 1, giorno));
}

/**
 * @param {string} data - 'YYYY-MM-DD'
 * @returns {string} readable date, e.g. "mar 18/08/2026"
 */
export function dataEstesa(data) {
  const nomeGiorno = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' }).format(dataUTC(data));
  const [anno, mese, giorno] = data.split('-');
  return `${nomeGiorno} ${giorno}/${mese}/${anno}`;
}

/**
 * @param {string} data - 'YYYY-MM-DD'
 * @returns {{nomeGiorno: string, dataBreve: string}} e.g. { 'mar', '18/08' }
 */
export function etichettaGiorno(data) {
  const nomeGiorno = new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' }).format(dataUTC(data));
  const [, mese, giorno] = data.split('-');
  return { nomeGiorno, dataBreve: `${giorno}/${mese}` };
}

/**
 * @param {string} lunedi - Monday of the week, 'YYYY-MM-DD'
 * @returns {string} readable week title, e.g. "17 – 23 agosto 2026"
 */
export function titoloSettimana(lunedi) {
  const domenica = aggiungiGiorni(lunedi, 6);
  const [anno1, mese1, giorno1] = lunedi.split('-').map(Number);
  const [anno2, mese2, giorno2] = domenica.split('-').map(Number);
  const nomeMese = (data) => new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'UTC' }).format(dataUTC(data));
  if (mese1 === mese2) return `${giorno1} – ${giorno2} ${nomeMese(lunedi)} ${anno1}`;
  if (anno1 === anno2) return `${giorno1} ${nomeMese(lunedi)} – ${giorno2} ${nomeMese(domenica)} ${anno1}`;
  return `${giorno1} ${nomeMese(lunedi)} ${anno1} – ${giorno2} ${nomeMese(domenica)} ${anno2}`;
}

/**
 * @param {string} lunedi - Monday of the week, 'YYYY-MM-DD'
 * @returns {string[]} the 7 dates of that week
 */
export function giorniSettimana(lunedi) {
  return Array.from({ length: 7 }, (_, indice) => aggiungiGiorni(lunedi, indice));
}

/**
 * @param {string} chiave - slot key 'YYYY-MM-DD_HHMM'
 * @returns {string} readable form, e.g. "mar 18/08 18:30"
 */
export function formattaSlotKey(chiave) {
  const [data, orario] = chiave.split('_');
  const etichetta = etichettaGiorno(data);
  return `${etichetta.nomeGiorno} ${etichetta.dataBreve} ${orario.slice(0, 2)}:${orario.slice(2)}`;
}
