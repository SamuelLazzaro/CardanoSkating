/* api.js — all HTTP calls, one function per endpoint. No other logic. */

/**
 * fetch + JSON parsing with uniform error handling.
 * @param {string} url - endpoint URL
 * @param {RequestInit} [opzioni] - fetch options
 * @returns {Promise<any>} parsed JSON body on 2xx
 * @throws {Error} with the server's message; carries a `status` property
 */
async function richiestaJson(url, opzioni = {}) {
  const impostazioni = { ...opzioni };
  if (impostazioni.body !== undefined) {
    impostazioni.headers = { 'Content-Type': 'application/json', ...(impostazioni.headers ?? {}) };
  }
  let risposta;
  try {
    risposta = await fetch(url, impostazioni);
  } catch {
    throw new Error('Impossibile contattare il server: controlla la connessione');
  }
  const dati = await risposta.json().catch(() => ({}));
  if (!risposta.ok) {
    const errore = new Error(dati.errore ?? 'Si è verificato un errore imprevisto');
    errore.status = risposta.status;
    errore.dati = dati;
    throw errore;
  }
  return dati;
}

/* ---------------------------------------------------------------- accesso */

/**
 * Names of the configured users, for the login dropdown (public, not secret).
 * @returns {Promise<{utenti: string[]}>}
 */
export function ottieniUtenti() {
  return richiestaJson('/api/utenti');
}

/**
 * @param {string} utente - user name chosen in the dropdown
 * @param {string} password - that user's password
 * @returns {Promise<{ok: boolean, utente: string}>} the canonical user name
 */
export function accedi(utente, password) {
  return richiestaJson('/api/login', { method: 'POST', body: JSON.stringify({ utente, password }) });
}

/** @returns {Promise<{ok: boolean}>} */
export function esci() {
  return richiestaJson('/api/logout', { method: 'POST' });
}

/**
 * Current session: rejects with status 401 when nobody is logged in.
 * @returns {Promise<{utente: string}>}
 */
export function ottieniProfilo() {
  return richiestaJson('/api/me');
}

/* -------------------------------------------------------------- riepilogo */

/**
 * Dashboard numbers, overall and per warehouse.
 * @returns {Promise<{totali: object, magazzini: Record<string, {articoli: number, disponibili: number, assegnati: number, da_riparare: number}>}>}
 */
export function ottieniRiepilogo() {
  return richiestaJson('/api/riepilogo');
}

/* ----------------------------------------------------------------- atleti */

/** @returns {Promise<{atleti: {id: number, nome: string, attivo: number}[]}>} */
export function ottieniAtleti() {
  return richiestaJson('/api/atleti');
}

/**
 * @param {string} nome - name and surname
 * @returns {Promise<{id: number, nome: string, attivo: number}>}
 */
export function creaAtleta(nome) {
  return richiestaJson('/api/atleti', { method: 'POST', body: JSON.stringify({ nome }) });
}

/**
 * @param {number} idAtleta
 * @param {boolean} attivo
 * @returns {Promise<{ok: boolean}>}
 */
export function impostaAtletaAttivo(idAtleta, attivo) {
  return richiestaJson(`/api/atleti/${idAtleta}`, { method: 'PATCH', body: JSON.stringify({ attivo }) });
}

/**
 * Athlete card: items currently held and personal history (no signatures).
 * @param {number} idAtleta
 * @returns {Promise<{atleta: object, assegnati: object[], storico: object[]}>}
 */
export function ottieniAtleta(idAtleta) {
  return richiestaJson(`/api/atleti/${idAtleta}`);
}

/* -------------------------------------------------------------- categorie */

/** @returns {Promise<{categorie: {id: number, nome: string, attiva: number}[]}>} */
export function ottieniCategorie() {
  return richiestaJson('/api/categorie');
}

/**
 * @param {string} nome
 * @returns {Promise<{id: number, nome: string, attiva: number}>}
 */
export function creaCategoria(nome) {
  return richiestaJson('/api/categorie', { method: 'POST', body: JSON.stringify({ nome }) });
}

/**
 * @param {number} idCategoria
 * @param {boolean} attiva
 * @returns {Promise<{ok: boolean}>}
 */
export function impostaCategoriaAttiva(idCategoria, attiva) {
  return richiestaJson(`/api/categorie/${idCategoria}`, { method: 'PATCH', body: JSON.stringify({ attiva }) });
}

/* --------------------------------------------------------------- articoli */

/** @returns {Promise<{articoli: object[]}>} every item, ordered by warehouse, category, description */
export function ottieniArticoli() {
  return richiestaJson('/api/articoli');
}

/**
 * @param {number} idArticolo
 * @returns {Promise<{articolo: object}>}
 */
export function ottieniArticolo(idArticolo) {
  return richiestaJson(`/api/articoli/${idArticolo}`);
}

/**
 * @param {{codice: string, disciplina: string, categoria: string, descrizione: string, marca?: string|null, modello?: string|null, taglia?: string|null, seriale?: string|null, quantita?: number, valore?: number, stato?: string, note?: string|null}} corpo
 * @returns {Promise<{id: number}>}
 */
export function creaArticolo(corpo) {
  return richiestaJson('/api/articoli', { method: 'POST', body: JSON.stringify(corpo) });
}

/**
 * Allowed only for an item without movements (409 otherwise).
 * @param {number} idArticolo
 * @returns {Promise<{ok: boolean}>}
 */
export function eliminaArticolo(idArticolo) {
  return richiestaJson(`/api/articoli/${idArticolo}`, { method: 'DELETE' });
}

/**
 * @param {number} idArticolo
 * @returns {string} URL of the item's QR code image (SVG, served behind the session cookie)
 */
export function urlQrArticolo(idArticolo) {
  return `/api/articoli/${idArticolo}/qr.svg`;
}

/* -------------------------------------------------------------- movimenti */

/**
 * Movement history, most recent first, without signatures (firma_presente only).
 * @param {{disciplina?: string, q?: string, limite?: number}} [filtri]
 * @returns {Promise<{movimenti: object[]}>}
 */
export function ottieniMovimenti(filtri = {}) {
  const parametri = new URLSearchParams();
  if (filtri.disciplina) parametri.set('disciplina', filtri.disciplina);
  if (filtri.q) parametri.set('q', filtri.q);
  if (filtri.limite) parametri.set('limite', String(filtri.limite));
  const coda = parametri.toString();
  return richiestaJson(coda === '' ? '/api/movimenti' : `/api/movimenti?${coda}`);
}

/**
 * Registers a movement. For ENTRATA pass either articolo_id or nuovo_articolo.
 * @param {{tipo: string, quantita: number, data?: string, articolo_id?: number, nuovo_articolo?: object, atleta_id?: number, condizione?: string|null, note?: string|null, firma?: string|null}} corpo
 * @returns {Promise<{id: number, articolo_id: number, disciplina: string}>}
 */
export function registraMovimento(corpo) {
  return richiestaJson('/api/movimenti', { method: 'POST', body: JSON.stringify(corpo) });
}

/** @type {string} download URL of the full history as CSV (Excel IT) */
export const URL_EXPORT_CSV = '/api/movimenti/export.csv';
