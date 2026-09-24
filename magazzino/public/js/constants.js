/* constants.js — shared constants, no logic. */

/** @type {string[]} the two warehouses (mirrors the CHECK constraint of articoli.disciplina) */
export const DISCIPLINE = ['Ghiaccio', 'Corsa'];

/** @type {Record<string, string>} UI labels of the two warehouses */
export const TESTO_DISCIPLINA = { Ghiaccio: 'Pattinaggio ghiaccio', Corsa: 'Pattinaggio corsa' };

/** @type {string[]} item conditions, in order from best to worst (mirrors articoli.stato) */
export const STATI_ARTICOLO = ['Nuovo', 'Buono', 'Usurato', 'Da riparare', 'Fuori uso'];

/** @type {string[]} movement types (mirrors movimenti.tipo) */
export const TIPI_MOVIMENTO = ['CONSEGNA', 'RESTITUZIONE', 'ENTRATA'];

/** @type {Record<string, string>} UI labels of the movement types */
export const TESTO_TIPO_MOVIMENTO = { ENTRATA: 'Entrata in magazzino', CONSEGNA: "Consegna all'atleta", RESTITUZIONE: 'Restituzione' };

/** @type {Record<string, string>} short labels of the movement types, for tables and badges */
export const TESTO_BREVE_TIPO = { ENTRATA: 'Entrata', CONSEGNA: 'Consegna', RESTITUZIONE: 'Restituzione' };

/** @type {number} rows of the "ultime movimentazioni" table of a warehouse dashboard */
export const ULTIMI_MOVIMENTI = 10;

/** @type {number} height (CSS px) of the signature pad */
export const ALTEZZA_FIRMA = 180;

/** @type {string} URL query parameter that opens an item's card on load (encoded in the QR codes) */
export const PARAMETRO_ARTICOLO = 'articolo';

/* --- tap feedback (see js/tap-feedback.js and .is-tapped in css/base.css) --- */

/** @type {number} how long (ms) the tap feedback stays on screen before the action runs */
export const TAP_FEEDBACK_MS = 150;

/** @type {string} class carrying the tap feedback style */
export const TAP_FEEDBACK_CLASS = 'is-tapped';

/** @type {string} elements whose taps deserve the feedback */
export const TAP_FEEDBACK_SELECTOR = 'a[href], button, [role="button"]';
