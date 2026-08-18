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
