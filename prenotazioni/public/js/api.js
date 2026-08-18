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

/**
 * @param {string} lunedi - Monday of the requested week, 'YYYY-MM-DD'
 * @returns {Promise<{settimana: string, slot_occupati: string[]}>}
 */
export function ottieniCalendario(lunedi) {
  return richiestaJson(`/api/calendario?settimana=${lunedi}`);
}

/** @returns {Promise<{societa: object, link_ics: string}>} */
export function ottieniProfiloSocieta() {
  return richiestaJson('/api/societa/me');
}

/** @returns {Promise<{richieste: object[], ricorrenze: object[]}>} */
export function ottieniRichiesteSocieta() {
  return richiestaJson('/api/societa/richieste');
}

/**
 * @param {{titolo?: string, data: string, ora_inizio: string, ora_fine: string, note?: string, ripeti_fino_al?: string}} corpo
 * @returns {Promise<{tipo: 'richiesta'|'ricorrenza', id: number, occorrenze?: string[]}>}
 */
export function inviaRichiestaPrenotazione(corpo) {
  return richiestaJson('/api/societa/richieste', { method: 'POST', body: JSON.stringify(corpo) });
}

/**
 * @param {number} idRichiesta - id of the richiesta to cancel
 * @returns {Promise<{ok: boolean}>}
 */
export function annullaRichiesta(idRichiesta) {
  return richiestaJson(`/api/societa/richieste/${idRichiesta}/annulla`, { method: 'POST' });
}

/**
 * @param {number} idRicorrenza - id of the pending ricorrenza to cancel
 * @returns {Promise<{ok: boolean}>}
 */
export function annullaRicorrenza(idRicorrenza) {
  return richiestaJson(`/api/societa/ricorrenze/${idRicorrenza}/annulla`, { method: 'POST' });
}

/** @returns {Promise<{ok: boolean}>} */
export function esciSocieta() {
  return richiestaJson('/api/societa/logout', { method: 'POST' });
}

/* ------------------------------------------------------------ admin API */

/**
 * @param {string} password - admin password
 * @returns {Promise<{ok: boolean}>}
 */
export function accediAdmin(password) {
  return richiestaJson('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
}

/** @returns {Promise<{ok: boolean}>} */
export function esciAdmin() {
  return richiestaJson('/api/admin/logout', { method: 'POST' });
}

/**
 * @param {string} [stato] - richiesta state filter
 * @returns {Promise<{richieste: object[]}>}
 */
export function ottieniRichiesteAdmin(stato = 'in_attesa') {
  return richiestaJson(`/api/admin/richieste?stato=${stato}`);
}

/**
 * @param {string} [stato] - ricorrenza state filter
 * @returns {Promise<{ricorrenze: object[]}>}
 */
export function ottieniRicorrenzeAdmin(stato = 'in_attesa') {
  return richiestaJson(`/api/admin/ricorrenze?stato=${stato}`);
}

/**
 * @param {number} idRichiesta
 * @returns {Promise<{ok: boolean, slot_inseriti: number}>}
 */
export function approvaRichiesta(idRichiesta) {
  return richiestaJson(`/api/admin/richieste/${idRichiesta}/approva`, { method: 'POST' });
}

/**
 * @param {number} idRichiesta
 * @param {string} [motivo] - optional rejection reason (audit only)
 * @returns {Promise<{ok: boolean}>}
 */
export function rifiutaRichiesta(idRichiesta, motivo = '') {
  return richiestaJson(`/api/admin/richieste/${idRichiesta}/rifiuta`, { method: 'POST', body: JSON.stringify({ motivo }) });
}

/**
 * @param {number} idRichiesta
 * @returns {Promise<{ok: boolean, slot_liberati: number}>}
 */
export function annullaRichiestaAdmin(idRichiesta) {
  return richiestaJson(`/api/admin/richieste/${idRichiesta}/annulla`, { method: 'POST' });
}

/**
 * @param {number} idRicorrenza
 * @returns {Promise<{ok: boolean, occorrenze: string[], slot_inseriti: number}>}
 */
export function approvaRicorrenza(idRicorrenza) {
  return richiestaJson(`/api/admin/ricorrenze/${idRicorrenza}/approva`, { method: 'POST' });
}

/**
 * @param {number} idRicorrenza
 * @returns {Promise<{ok: boolean}>}
 */
export function rifiutaRicorrenza(idRicorrenza) {
  return richiestaJson(`/api/admin/ricorrenze/${idRicorrenza}/rifiuta`, { method: 'POST' });
}

/** @returns {Promise<{societa: object[]}>} */
export function ottieniElencoSocieta() {
  return richiestaJson('/api/admin/societa');
}

/**
 * @param {{nome: string, referente: string, email: string, telefono?: string}} corpo
 * @returns {Promise<{id: number, nome: string, link_accesso: string}>}
 */
export function creaSocietaAdmin(corpo) {
  return richiestaJson('/api/admin/societa', { method: 'POST', body: JSON.stringify(corpo) });
}

/**
 * @param {number} idSocieta
 * @param {{nome?: string, referente?: string, email?: string, telefono?: string}} corpo
 * @returns {Promise<{ok: boolean}>}
 */
export function aggiornaSocietaAdmin(idSocieta, corpo) {
  return richiestaJson(`/api/admin/societa/${idSocieta}`, { method: 'PATCH', body: JSON.stringify(corpo) });
}

/**
 * @param {number} idSocieta
 * @returns {Promise<{ok: boolean, slot_liberati: number, richieste_annullate: number}>}
 */
export function sospendiSocieta(idSocieta) {
  return richiestaJson(`/api/admin/societa/${idSocieta}/sospendi`, { method: 'POST' });
}

/**
 * @param {number} idSocieta
 * @returns {Promise<{ok: boolean}>}
 */
export function riattivaSocieta(idSocieta) {
  return richiestaJson(`/api/admin/societa/${idSocieta}/riattiva`, { method: 'POST' });
}

/**
 * @param {number} idSocieta
 * @returns {Promise<{ok: boolean, link_accesso: string}>}
 */
export function rigeneraTokenSocieta(idSocieta) {
  return richiestaJson(`/api/admin/societa/${idSocieta}/rigenera-token`, { method: 'POST' });
}

/**
 * @param {string} lunedi - Monday of the requested week
 * @returns {Promise<{settimana: string, prenotazioni: {slot_key: string, societa_id: number, societa: string, richiesta_id: number, titolo: string}[]}>}
 */
export function ottieniCalendarioAdmin(lunedi) {
  return richiestaJson(`/api/admin/calendario?settimana=${lunedi}`);
}

/**
 * @param {{societa_id: number, titolo?: string, data: string, ora_inizio: string, ora_fine: string, note?: string}} corpo
 * @returns {Promise<{ok: boolean, richiesta_id: number, slot_inseriti: number}>}
 */
export function creaPrenotazioneDiretta(corpo) {
  return richiestaJson('/api/admin/prenotazioni', { method: 'POST', body: JSON.stringify(corpo) });
}
