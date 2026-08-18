/* constants.js — shared constants, no logic. */

/** @type {number} opening time of the sports hall, minutes from midnight (08:00) */
export const APERTURA_MIN = 8 * 60;

/** @type {number} closing time, minutes from midnight (24:00) */
export const CHIUSURA_MIN = 24 * 60;

/** @type {number} slot length in minutes */
export const PASSO_MIN = 30;

/** @type {number} max weekly occurrences of a recurring request (mirrors the server cap) */
export const MAX_SETTIMANE_RICORRENZA = 4;

/** @type {string} default activity title of a booking (mirrors the server default) */
export const TITOLO_PREDEFINITO = 'Allenamento';

/** @type {string[]} weekday names, index 0 = lunedì (project-wide convention) */
export const NOMI_GIORNI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];

/** @type {Record<string, string>} UI labels for richiesta/ricorrenza/società states */
export const TESTO_STATO = {
  in_attesa: 'In attesa',
  approvata: 'Approvata',
  rifiutata: 'Rifiutata',
  annullata: 'Annullata',
  attiva: 'Attiva',
  sospesa: 'Sospesa',
};

/* --- tap feedback (see js/tap-feedback.js and .is-tapped in css/base.css) --- */

/** @type {number} how long (ms) the tap feedback stays on screen before the action runs */
export const TAP_FEEDBACK_MS = 150;

/** @type {string} class carrying the tap feedback style */
export const TAP_FEEDBACK_CLASS = 'is-tapped';

/** @type {string} elements whose taps deserve the feedback */
export const TAP_FEEDBACK_SELECTOR = 'a[href], button, [role="button"]';
