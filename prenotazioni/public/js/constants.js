/* constants.js — shared constants, no logic. */

/** @type {number} opening time of the sports hall, minutes from midnight (08:00) */
export const APERTURA_MIN = 8 * 60;

/** @type {number} closing time, minutes from midnight (24:00) */
export const CHIUSURA_MIN = 24 * 60;

/** @type {number} slot length in minutes */
export const PASSO_MIN = 30;

/** @type {number} max weeks spanned by a recurring request (mirrors the server cap) */
export const MAX_SETTIMANE_RICORRENZA = 4;

/**
 * @type {number} latest "fino al" as days after the first date: 4 full weeks,
 * both ends included, so every selected weekday occurs exactly 4 times
 */
export const MAX_GIORNI_FINESTRA_RICORRENZA = MAX_SETTIMANE_RICORRENZA * 7 - 1;

/** @type {string} default activity title of a booking (mirrors the server default) */
export const TITOLO_PREDEFINITO = 'Allenamento';

/** @type {number} minimum length of the admin decision motivation (mirrors the server rule) */
export const MIN_MOTIVAZIONE = 2;

/** @type {string} default società color (mirrors the server/migration default) */
export const COLORE_PREDEFINITO = '#3b82f6';

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
  annullamento: 'Annullamento', // richiesta tipo, not a stato: reuses the badge machinery
};

/* --- tap feedback (see js/tap-feedback.js and .is-tapped in css/base.css) --- */

/** @type {number} how long (ms) the tap feedback stays on screen before the action runs */
export const TAP_FEEDBACK_MS = 150;

/** @type {string} class carrying the tap feedback style */
export const TAP_FEEDBACK_CLASS = 'is-tapped';

/** @type {string} elements whose taps deserve the feedback */
export const TAP_FEEDBACK_SELECTOR = 'a[href], button, [role="button"]';
