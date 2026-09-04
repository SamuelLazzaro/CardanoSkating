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

/**
 * Occupied slots of a whole monthly grid (whole weeks, spill-over days
 * included): one call per month instead of one per week.
 * @param {string} mese - requested month, 'YYYY-MM'
 * @returns {Promise<{mese: string, dal: string, al: string, slot_occupati: string[]}>}
 */
export function ottieniCalendarioMese(mese) {
  return richiestaJson(`/api/calendario?mese=${mese}`);
}

/**
 * Calendar of the area società: every booked slot with the società that booked
 * it (name and color), no activity title nor notes.
 * @param {string} lunedi - Monday of the requested week, 'YYYY-MM-DD'
 * @returns {Promise<{settimana: string, prenotazioni: {slot_key: string, societa_id: number, societa: string, colore: string, richiesta_id: number}[]}>}
 */
export function ottieniCalendarioSocieta(lunedi) {
  return richiestaJson(`/api/societa/calendario?settimana=${lunedi}`);
}

/**
 * @param {string} mese - requested month, 'YYYY-MM'
 * @returns {Promise<{mese: string, dal: string, al: string, prenotazioni: {slot_key: string, societa_id: number, societa: string, colore: string, richiesta_id: number}[]}>}
 */
export function ottieniCalendarioSocietaMese(mese) {
  return richiestaJson(`/api/societa/calendario?mese=${mese}`);
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
 * @param {{titolo?: string, data: string, ora_inizio: string, ora_fine: string, note?: string, ripeti_fino_al?: string, giorni?: number[]}} corpo - giorni: extra weekdays (0 = lunedì) sharing the same time
 * @returns {Promise<{tipo: 'richiesta'|'ricorrenza', id: number, occorrenze?: string[]}>}
 */
export function inviaRichiestaPrenotazione(corpo) {
  return richiestaJson('/api/societa/richieste', { method: 'POST', body: JSON.stringify(corpo) });
}

/**
 * Withdraws a richiesta that is still pending (no slots booked yet).
 * @param {number} idRichiesta - id of the pending richiesta to withdraw
 * @returns {Promise<{ok: boolean}>}
 */
export function annullaRichiesta(idRichiesta) {
  return richiestaJson(`/api/societa/richieste/${idRichiesta}/annulla`, { method: 'POST' });
}

/**
 * Directly edits a pending single richiesta (no slots involved): it stays
 * pending with the new data.
 * @param {number} idRichiesta - id of the pending richiesta
 * @param {{titolo?: string, data: string, ora_inizio: string, ora_fine: string, note?: string}} corpo
 * @returns {Promise<{ok: boolean}>}
 */
export function modificaRichiestaInAttesa(idRichiesta, corpo) {
  return richiestaJson(`/api/societa/richieste/${idRichiesta}`, { method: 'PATCH', body: JSON.stringify(corpo) });
}

/**
 * Directly edits a pending ricorrenza (not materialized yet): the whole
 * series definition changes, same fields as a new recurring request.
 * @param {number} idRicorrenza - id of the pending ricorrenza
 * @param {{titolo?: string, data: string, ora_inizio: string, ora_fine: string, note?: string, ripeti_fino_al?: string, giorni?: number[]}} corpo
 * @returns {Promise<{ok: boolean, occorrenze: string[]}>}
 */
export function modificaRicorrenzaInAttesa(idRicorrenza, corpo) {
  return richiestaJson(`/api/societa/ricorrenze/${idRicorrenza}`, { method: 'PATCH', body: JSON.stringify(corpo) });
}

/**
 * Asks the admin to cancel an approved future booking: slots stay occupied
 * until the admin approves the annullamento request. With ambito
 * 'successive' on a recurring booking, one request per following occurrence
 * is created, all in one group.
 * @param {number} idRichiesta - id of the approved richiesta to cancel
 * @param {'singola'|'successive'} [ambito]
 * @returns {Promise<{tipo: 'annullamento', id: number, gruppo_id: string|null, richieste: number}>}
 */
export function richiediAnnullamento(idRichiesta, ambito = 'singola') {
  return richiestaJson(`/api/societa/richieste/${idRichiesta}/richiedi-annullamento`, { method: 'POST', body: JSON.stringify({ ambito }) });
}

/**
 * Asks the admin to change an approved future booking (date, time, activity,
 * notes): nothing changes until the admin approves. With ambito 'successive'
 * the new time/activity/notes apply to the following occurrences too (dates
 * cannot change then).
 * @param {number} idRichiesta - id of the approved richiesta to change
 * @param {{data?: string, ora_inizio: string, ora_fine: string, titolo?: string, note?: string, ambito: 'singola'|'successive'}} corpo
 * @returns {Promise<{tipo: 'modifica', id: number, gruppo_id: string|null, richieste: number}>}
 */
export function richiediModifica(idRichiesta, corpo) {
  return richiestaJson(`/api/societa/richieste/${idRichiesta}/richiedi-modifica`, { method: 'POST', body: JSON.stringify(corpo) });
}

/**
 * Withdraws a whole pending group of requests (annullamento or modifica on
 * several occurrences).
 * @param {string} gruppoId
 * @returns {Promise<{ok: boolean, richieste_ritirate: number}>}
 */
export function annullaGruppo(gruppoId) {
  return richiestaJson(`/api/societa/gruppi/${gruppoId}/annulla`, { method: 'POST' });
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
 * Approves a richiesta: books the slots for tipo 'nuova' (slot_inseriti),
 * frees the referenced booking for tipo 'annullamento' (slot_liberati).
 * @param {number} idRichiesta
 * @param {string} motivazione - mandatory decision motivation
 * @returns {Promise<{ok: boolean, slot_inseriti?: number, slot_liberati?: number}>}
 */
export function approvaRichiesta(idRichiesta, motivazione) {
  return richiestaJson(`/api/admin/richieste/${idRichiesta}/approva`, { method: 'POST', body: JSON.stringify({ motivazione }) });
}

/**
 * @param {number} idRichiesta
 * @param {string} motivazione - mandatory decision motivation (min 3 chars)
 * @returns {Promise<{ok: boolean}>}
 */
export function rifiutaRichiesta(idRichiesta, motivazione) {
  return richiestaJson(`/api/admin/richieste/${idRichiesta}/rifiuta`, { method: 'POST', body: JSON.stringify({ motivazione }) });
}

/**
 * Cancels a richiesta right away. With ambito 'successive' on an approved
 * recurring booking, that occurrence and all the following ones are cancelled.
 * @param {number} idRichiesta
 * @param {'singola'|'successive'} [ambito]
 * @returns {Promise<{ok: boolean, richieste_annullate: number, slot_liberati: number}>}
 */
export function annullaRichiestaAdmin(idRichiesta, ambito = 'singola') {
  return richiestaJson(`/api/admin/richieste/${idRichiesta}/annulla`, { method: 'POST', body: JSON.stringify({ ambito }) });
}

/**
 * Directly changes an approved booking (date, time, activity, notes), right
 * away and without motivation. With ambito 'successive' the new time,
 * activity and notes apply to the following occurrences too (no date change).
 * @param {number} idRichiesta
 * @param {{data?: string, ora_inizio: string, ora_fine: string, titolo?: string, note?: string, ambito: 'singola'|'successive'}} corpo
 * @returns {Promise<{ok: boolean, richieste_modificate: number, slot_inseriti: number, date: string[]}>}
 */
export function modificaPrenotazioneAdmin(idRichiesta, corpo) {
  return richiestaJson(`/api/admin/richieste/${idRichiesta}`, { method: 'PATCH', body: JSON.stringify(corpo) });
}

/**
 * Approves a whole group of requests (annullamento or modifica on several
 * occurrences) with one decision.
 * @param {string} gruppoId
 * @param {string} motivazione - mandatory decision motivation
 * @returns {Promise<{ok: boolean, richieste_approvate: number, slot_liberati: number, slot_inseriti?: number}>}
 */
export function approvaGruppo(gruppoId, motivazione) {
  return richiestaJson(`/api/admin/gruppi/${gruppoId}/approva`, { method: 'POST', body: JSON.stringify({ motivazione }) });
}

/**
 * @param {string} gruppoId
 * @param {string} motivazione - mandatory decision motivation
 * @returns {Promise<{ok: boolean, richieste_rifiutate: number}>}
 */
export function rifiutaGruppo(gruppoId, motivazione) {
  return richiestaJson(`/api/admin/gruppi/${gruppoId}/rifiuta`, { method: 'POST', body: JSON.stringify({ motivazione }) });
}

/**
 * @param {number} idRicorrenza
 * @param {string} motivazione - mandatory decision motivation (min 3 chars)
 * @returns {Promise<{ok: boolean, occorrenze: string[], slot_inseriti: number}>}
 */
export function approvaRicorrenza(idRicorrenza, motivazione) {
  return richiestaJson(`/api/admin/ricorrenze/${idRicorrenza}/approva`, { method: 'POST', body: JSON.stringify({ motivazione }) });
}

/**
 * @param {number} idRicorrenza
 * @param {string} motivazione - mandatory decision motivation (min 3 chars)
 * @returns {Promise<{ok: boolean}>}
 */
export function rifiutaRicorrenza(idRicorrenza, motivazione) {
  return richiestaJson(`/api/admin/ricorrenze/${idRicorrenza}/rifiuta`, { method: 'POST', body: JSON.stringify({ motivazione }) });
}

/** @returns {Promise<{societa: object[]}>} */
export function ottieniElencoSocieta() {
  return richiestaJson('/api/admin/societa');
}

/**
 * @param {{nome: string, referente: string, email: string, tariffa_oraria: number, telefono?: string, colore?: string}} corpo
 * @returns {Promise<{id: number, nome: string, link_accesso: string}>}
 */
export function creaSocietaAdmin(corpo) {
  return richiestaJson('/api/admin/societa', { method: 'POST', body: JSON.stringify(corpo) });
}

/**
 * @param {number} idSocieta
 * @param {{nome?: string, referente?: string, email?: string, telefono?: string, colore?: string, tariffa_oraria?: number}} corpo
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
 * @returns {Promise<{settimana: string, prenotazioni: {slot_key: string, societa_id: number, societa: string, colore: string, richiesta_id: number, titolo: string, note: string|null, ricorrenza_id: number|null}[]}>}
 */
export function ottieniCalendarioAdmin(lunedi) {
  return richiestaJson(`/api/admin/calendario?settimana=${lunedi}`);
}

/**
 * @param {string} mese - requested month, 'YYYY-MM'
 * @returns {Promise<{mese: string, dal: string, al: string, prenotazioni: {slot_key: string, societa_id: number, societa: string, colore: string, richiesta_id: number, titolo: string}[]}>}
 */
export function ottieniCalendarioAdminMese(mese) {
  return richiestaJson(`/api/admin/calendario?mese=${mese}`);
}

/**
 * Direct booking, immediately approved. With `giorni` (extra weekdays, 0 =
 * lunedì) and/or `ripeti_fino_al` it becomes a recurring booking: the answer
 * then carries the series id and the booked dates instead of richiesta_id.
 * @param {{societa_id: number, titolo?: string, data: string, ora_inizio: string, ora_fine: string, note?: string, ripeti_fino_al?: string, giorni?: number[]}} corpo
 * @returns {Promise<{ok: boolean, tipo: 'richiesta'|'ricorrenza', richiesta_id?: number, ricorrenza_id?: number, occorrenze?: string[], slot_inseriti: number}>}
 */
export function creaPrenotazioneDiretta(corpo) {
  return richiestaJson('/api/admin/prenotazioni', { method: 'POST', body: JSON.stringify(corpo) });
}

/**
 * Monthly report: booked hours, tariffa and importo per società.
 * @param {string} mese - 'YYYY-MM'
 * @returns {Promise<{mese: string, righe: {societa_id: number, societa: string, tariffa_oraria: number, ore: number, importo: number}[], totale: {ore: number, importo: number}}>}
 */
export function ottieniReport(mese) {
  return richiestaJson(`/api/admin/report?mese=${mese}`);
}
