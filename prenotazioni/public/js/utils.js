/*
 * utils.js — pure helper functions (no DOM, no state, no side effects).
 *
 * Dates are 'YYYY-MM-DD' strings and times are minutes from midnight,
 * mirroring the server-side conventions: string comparison is enough
 * everywhere and no timezone conversion ever happens client-side except in
 * adessoRoma(), which converts an instant to Italian civil time via Intl.
 */
import { NOMI_GIORNI, PASSO_MIN } from './constants.js';

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
 * @param {string} data - 'YYYY-MM-DD'
 * @returns {string} the Sunday of the week the date belongs to
 */
export function domenicaDellaSettimana(data) {
  return aggiungiGiorni(data, 6 - giornoSettimana(data));
}

/**
 * Dates covered by a recurring request (mirrors the server): every day from
 * validaDal to validaAl, both included, whose weekday is among the requested
 * ones. The window is at most 4 weeks, so the day-by-day loop stays short.
 * @param {string} validaDal - first date, 'YYYY-MM-DD'
 * @param {string} validaAl - last date, 'YYYY-MM-DD'
 * @param {number[]} giorni - weekdays, 0 = lunedì .. 6 = domenica
 * @returns {string[]} dates in chronological order
 */
export function occorrenzeRicorrenza(validaDal, validaAl, giorni) {
  const giorniRichiesti = new Set(giorni);
  const date = [];
  for (let giorno = validaDal; giorno <= validaAl; giorno = aggiungiGiorni(giorno, 1)) {
    if (giorniRichiesti.has(giornoSettimana(giorno))) date.push(giorno);
  }
  return date;
}

/**
 * @param {number[]} giorni - weekdays, 0 = lunedì .. 6 = domenica
 * @returns {string} readable list, e.g. "lunedì, mercoledì e venerdì"
 */
export function elencoGiorni(giorni) {
  const nomi = giorni.map((giorno) => NOMI_GIORNI[giorno]);
  if (nomi.length <= 1) return nomi.join('');
  return `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}`;
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
 * @param {string} orario - compact time of a slot key, 'HHMM'
 * @returns {string} 'HH:MM'
 */
function oraCompatta(orario) {
  return `${orario.slice(0, 2)}:${orario.slice(2)}`;
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
 * Compresses slot keys into the continuous time ranges they cover (same
 * algorithm as raggruppaSlotInFasce on the server): the monthly view shows one
 * entry per booking, "18:00–19:30", instead of one per half hour.
 *
 * Slot keys are fixed-width and sortable, so sorting them puts them in
 * chronological order. Scanning them in sequence, every slot either extends
 * the open range — when it starts exactly where that one ends, on the same
 * date — or opens a new one; a gap or a change of date always closes it.
 * @param {Iterable<string>} chiavi - slot keys, in any order
 * @returns {{data: string, oraInizio: string, oraFine: string}[]} ranges in chronological order
 */
export function raggruppaSlotInFasce(chiavi) {
  const fasce = [];
  for (const chiave of [...chiavi].sort()) {
    const [data, orario] = chiave.split('_');
    const oraInizio = oraCompatta(orario);
    const oraFine = oraTesto(minutiDaOra(oraInizio) + PASSO_MIN);
    const fasciaAperta = fasce[fasce.length - 1];
    const prolungaLaFascia = fasciaAperta !== undefined && fasciaAperta.data === data && fasciaAperta.oraFine === oraInizio;
    if (prolungaLaFascia) {
      fasciaAperta.oraFine = oraFine;
    } else {
      fasce.push({ data, oraInizio, oraFine });
    }
  }
  return fasce;
}

/**
 * Groups the slots of the admin calendar by booking: one richiesta is always
 * one continuous interval on a single date, so its first and last slot keys
 * describe it entirely. Both the list under the calendar and the monthly view
 * read "18:00–19:30 · Società · Attività" from here instead of walking the
 * half-hour slots the booking is made of.
 * @param {{slot_key: string, societa_id: number, societa: string, colore: string, richiesta_id: number, titolo: string}[]} prenotazioni
 * @returns {{richiestaId: number, societaId: number, societa: string, colore: string, titolo: string, data: string, oraInizio: string, oraFine: string}[]} bookings in chronological order
 */
export function raggruppaPrenotazioni(prenotazioni) {
  /** @type {Map<number, {prima: object, chiavi: string[]}>} */
  const perRichiesta = new Map();
  for (const prenotazione of prenotazioni) {
    const gruppo = perRichiesta.get(prenotazione.richiesta_id);
    if (gruppo === undefined) {
      perRichiesta.set(prenotazione.richiesta_id, { prima: prenotazione, chiavi: [prenotazione.slot_key] });
    } else {
      gruppo.chiavi.push(prenotazione.slot_key);
    }
  }

  const blocchi = [];
  for (const [richiestaId, gruppo] of perRichiesta) {
    const chiavi = gruppo.chiavi.sort();
    const [data, orarioInizio] = chiavi[0].split('_');
    const orarioUltimoSlot = chiavi[chiavi.length - 1].split('_')[1];
    blocchi.push({
      richiestaId,
      societaId: gruppo.prima.societa_id,
      societa: gruppo.prima.societa,
      colore: gruppo.prima.colore,
      titolo: gruppo.prima.titolo,
      data,
      oraInizio: oraCompatta(orarioInizio),
      // The last slot only marks its own start: the booking ends one step later.
      oraFine: oraTesto(minutiDaOra(oraCompatta(orarioUltimoSlot)) + PASSO_MIN),
    });
  }
  return blocchi.sort((a, b) => (a.data + a.oraInizio).localeCompare(b.data + b.oraInizio));
}

/*
 * Splits the slots a società owns in a date interval into two sets, so the
 * area calendar can paint confirmed bookings and undecided requests
 * differently:
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
 * @param {{stato: string, giorni: number[], ora_inizio: string, ora_fine: string, valida_dal: string, valida_al: string}[]} ricorrenze - the società's ricorrenze
 * @param {string} dal - first date of the interval, 'YYYY-MM-DD' (included)
 * @param {string} al - last date of the interval, 'YYYY-MM-DD' (included)
 * @returns {{approvati: Set<string>, inAttesa: Set<string>}} slot keys inside the interval
 */
export function slotSocietaIntervallo(richieste, ricorrenze, dal, al) {
  const approvati = new Set();
  const inAttesa = new Set();

  for (const richiesta of richieste) {
    // Only booking requests hold slots. An annullamento request is skipped
    // whatever its state: once approved its referenced booking has just been
    // freed, and while pending that booking is still fully valid, so its
    // slots must keep showing as approved rather than as undecided.
    if (richiesta.tipo !== 'nuova') continue;
    if (richiesta.stato !== 'approvata' && richiesta.stato !== 'in_attesa') continue;
    if (richiesta.data < dal || richiesta.data > al) continue;
    const destinazione = richiesta.stato === 'approvata' ? approvati : inAttesa;
    for (const chiave of espandiSlot(richiesta.data, richiesta.ora_inizio, richiesta.ora_fine)) {
      destinazione.add(chiave);
    }
  }

  for (const ricorrenza of ricorrenze) {
    if (ricorrenza.stato !== 'in_attesa') continue;
    // The series is expanded only over the part of its validity window that
    // the interval actually shows, with the same rule as the server.
    const primaData = ricorrenza.valida_dal > dal ? ricorrenza.valida_dal : dal;
    const ultimaData = ricorrenza.valida_al < al ? ricorrenza.valida_al : al;
    for (const giorno of occorrenzeRicorrenza(primaData, ultimaData, ricorrenza.giorni)) {
      for (const chiave of espandiSlot(giorno, ricorrenza.ora_inizio, ricorrenza.ora_fine)) {
        inAttesa.add(chiave);
      }
    }
  }

  return { approvati, inAttesa };
}

/**
 * The one-week case of slotSocietaIntervallo, used by the weekly grid.
 * @param {{tipo: string, stato: string, data: string, ora_inizio: string, ora_fine: string}[]} richieste - the società's richieste
 * @param {{stato: string, giorni: number[], ora_inizio: string, ora_fine: string, valida_dal: string, valida_al: string}[]} ricorrenze - the società's ricorrenze
 * @param {string} lunedi - Monday of the week to classify, 'YYYY-MM-DD'
 * @returns {{approvati: Set<string>, inAttesa: Set<string>}} slot keys of that week
 */
export function slotSocietaSettimana(richieste, ricorrenze, lunedi) {
  return slotSocietaIntervallo(richieste, ricorrenze, lunedi, aggiungiGiorni(lunedi, 6));
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
  return `${etichetta.nomeGiorno} ${etichetta.dataBreve} ${oraCompatta(orario)}`;
}

/* ------------------------------------------------------------------ mese */

/**
 * @param {string} data - 'YYYY-MM-DD'
 * @returns {string} the month the date belongs to, 'YYYY-MM'
 */
export function meseDellaData(data) {
  return data.slice(0, 7);
}

/**
 * @param {string} mese - 'YYYY-MM'
 * @param {number} passi - months to add (can be negative)
 * @returns {string} resulting 'YYYY-MM'
 */
export function spostaMese(mese, passi) {
  const [anno, numeroMese] = mese.split('-').map(Number);
  // Date.UTC normalizes an out-of-range month index on its own, so December →
  // January and the year change need no special case here.
  return new Date(Date.UTC(anno, numeroMese - 1 + passi, 1)).toISOString().slice(0, 7);
}

/**
 * @param {string} mese - 'YYYY-MM'
 * @returns {string} readable month title, e.g. "agosto 2026"
 */
export function titoloMese(mese) {
  return new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(dataUTC(`${mese}-01`));
}

/**
 * Dates drawn by the monthly grid: whole weeks, from the Monday of the week
 * holding the 1st to the Sunday of the week holding the last day. Mirrors
 * intervalloGrigliaMese() on the server, so the grid rows are always complete
 * and one API call covers every cell, spill-over days included.
 * @param {string} mese - 'YYYY-MM'
 * @returns {string[]} 28 to 42 dates in chronological order
 */
export function giorniGrigliaMese(mese) {
  const primoGiornoDelMese = `${mese}-01`;
  const ultimoGiornoDelMese = aggiungiGiorni(`${spostaMese(mese, 1)}-01`, -1);
  const ultimaCella = domenicaDellaSettimana(ultimoGiornoDelMese);
  const giorni = [];
  for (let giorno = lunediDellaSettimana(primoGiornoDelMese); giorno <= ultimaCella; giorno = aggiungiGiorni(giorno, 1)) {
    giorni.push(giorno);
  }
  return giorni;
}
