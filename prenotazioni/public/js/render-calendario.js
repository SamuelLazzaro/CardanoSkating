/*
 * render-calendario.js — rendering of the calendar that names the società:
 * weekly grid, monthly grid and società/color legend, shared by the admin
 * panel and the area società. Both pages get the same picture of the bookings
 * (name and color of the società on every booked block); what differs is
 * handed over as options: whether the activity title is written under the
 * name (the area API does not carry it), which bookings open the details
 * popup (all of them for the admin, only the own ones for a società) and the
 * own pending requests that only the area società draws over the free slots.
 *
 * The grids themselves come from js/ui.js; this module only decides what goes
 * inside every cell.
 */
import { PASSO_MIN } from './constants.js';
import {
  adessoRoma,
  chiaveSlot,
  dataEstesa,
  eColoreEsadecimale,
  etichettaGiorno,
  fasceInAttesa,
  giorniGrigliaMese,
  giorniSettimana,
  minutiDaOra,
  oraTesto,
  raggruppaPrenotazioni,
} from './utils.js';
import {
  aggiungiBottoneGiorno,
  aggiungiBottoneSlot,
  costruisciGriglia,
  costruisciGrigliaMese,
  creaQuadrettoColore,
  creaVoceMese,
  rendiCliccabile,
} from './ui.js';

/**
 * @typedef {object} Prenotazione - one booked half-hour slot, as the calendar APIs return it
 * @property {string} slot_key
 * @property {number} societa_id
 * @property {string} societa - name of the società
 * @property {string} colore - '#RRGGBB' of the società
 * @property {number} richiesta_id - the booking the slot belongs to
 * @property {string} [titolo] - activity title, admin API only
 */

/**
 * @typedef {object} VoceInAttesa - an own item still waiting for a decision, on one slot (area società)
 * @property {string} genere - kind of item, handed to the details popup
 * @property {number} id - id of the item
 * @property {string} descrizione - tooltip text, e.g. "la tua richiesta, in attesa di approvazione"
 */

/**
 * @typedef {object} OpzioniCalendario
 * @property {boolean} mostraAttivita - write the activity title under the società name (admin)
 * @property {(societaId: number, richiestaId: number) => {genere: string, id: number}|null} dettagliDi
 *   what a click on a booking opens; null leaves the booking not clickable
 * @property {Map<string, VoceInAttesa>} [inAttesa] - own pending slots, by slot key (area società)
 * @property {string} oraPredefinita - 'HH:MM' start time prefilled by the "+" of a day cell (monthly view)
 */

/** @type {string} class of the legend chips this module owns (the page may add fixed ones) */
const CLASSE_CHIP_SOCIETA = 'chip-societa';

/** @type {string} tooltip suffix of a booked slot the società has also asked for */
const NOTA_RICHIESTA_SU_OCCUPATO = ' · hai una richiesta in attesa su questo slot';

/**
 * Renders the società↔color legend of the shown interval: one chip per società
 * with at least one booking, in alphabetical order, placed before any fixed
 * chip the page keeps in the same container (e.g. "In attesa", "Libero").
 * @param {HTMLElement} legenda - the legend container
 * @param {Prenotazione[]} prenotazioni - bookings of the interval
 * @returns {void}
 */
export function renderLegendaCalendario(legenda, prenotazioni) {
  for (const vecchio of legenda.querySelectorAll(`.${CLASSE_CHIP_SOCIETA}`)) vecchio.remove();

  /** @type {Map<number, Prenotazione>} one booking per società, whichever comes first */
  const perSocieta = new Map(prenotazioni.map((prenotazione) => [prenotazione.societa_id, prenotazione]));
  const ordinate = [...perSocieta.values()].sort((a, b) => a.societa.localeCompare(b.societa));
  const chips = ordinate.map((voce) => {
    const chip = document.createElement('span');
    chip.className = `chip ${CLASSE_CHIP_SOCIETA}`;
    const nome = document.createElement('span');
    nome.textContent = voce.societa;
    chip.append(creaQuadrettoColore(voce.colore), nome);
    return chip;
  });
  legenda.prepend(...chips);
  legenda.hidden = legenda.children.length === 0;
}

/**
 * @param {Prenotazione} prenotazione
 * @param {OpzioniCalendario} opzioni
 * @returns {string} what the tooltip says of the booking: the società, plus the activity when shown
 */
function descrizionePrenotazione(prenotazione, opzioni) {
  return opzioni.mostraAttivita ? `${prenotazione.societa} · ${prenotazione.titolo}` : prenotazione.societa;
}

/**
 * Paints a booked cell of the weekly grid: the wash and bar of the società
 * color, the block label on the first slot of the booking and, when the page
 * allows it, the click that opens the details popup.
 * @param {HTMLElement} cella
 * @param {Prenotazione} prenotazione - the booking of this slot
 * @param {Map<string, Prenotazione>} perChiave - all bookings of the week, by slot key
 * @param {string} giorno - 'YYYY-MM-DD' of the slot
 * @param {number} minuti - slot start, minutes from midnight
 * @param {OpzioniCalendario} opzioni
 * @returns {void}
 */
function decoraSlotPrenotato(cella, prenotazione, perChiave, giorno, minuti, opzioni) {
  cella.classList.add('occupato');
  if (eColoreEsadecimale(prenotazione.colore)) {
    cella.classList.add('colorato');
    cella.style.setProperty('--colore-societa', prenotazione.colore);
  }

  const stessaPrenotazione = (chiave) => perChiave.get(chiave)?.richiesta_id === prenotazione.richiesta_id;
  const inizioBlocco = !stessaPrenotazione(chiaveSlot(giorno, minuti - PASSO_MIN));

  const dettagli = opzioni.dettagliDi(prenotazione.societa_id, prenotazione.richiesta_id);
  if (dettagli !== null) {
    // Every slot of a booked block opens its details popup; only the first
    // one is a tab stop, so the block counts once for the keyboard.
    const etichetta = etichettaGiorno(giorno);
    const nomeAccessibile = `Dettagli prenotazione ${prenotazione.societa} ${etichetta.nomeGiorno} ${etichetta.dataBreve} ${oraTesto(minuti)}`;
    rendiCliccabile(cella, dettagli.genere, dettagli.id, nomeAccessibile, inizioBlocco);
  }
  if (!inizioBlocco) return;

  /*
   * Block label: società name (plus activity title, when shown), written only
   * in the first slot of each booked block. To keep every grid row at its
   * fixed height, the label is an absolutely positioned overlay sized on the
   * number of consecutive slots of the same booking (CSS var
   * --slot-del-blocco, see .blocco-etichetta): the slot height fits the text
   * lines, the overlay height only clips overflowing text at the block
   * boundary so it never covers a different booking.
   */
  let slotDelBlocco = 1;
  while (stessaPrenotazione(chiaveSlot(giorno, minuti + slotDelBlocco * PASSO_MIN))) slotDelBlocco += 1;

  const etichettaBlocco = document.createElement('span');
  etichettaBlocco.className = 'blocco-etichetta';
  etichettaBlocco.style.setProperty('--slot-del-blocco', String(slotDelBlocco));
  const nome = document.createElement('span');
  nome.className = 'slot-nome';
  nome.textContent = prenotazione.societa;
  etichettaBlocco.append(nome);
  if (opzioni.mostraAttivita) {
    const attivita = document.createElement('span');
    attivita.className = 'slot-attivita';
    attivita.textContent = prenotazione.titolo;
    etichettaBlocco.append(attivita);
  }
  cella.classList.add('con-etichetta');
  cella.append(etichettaBlocco);
}

/**
 * Paints a free cell the società has already asked for: yellow "in attesa"
 * state and the click that opens the pending item. Only the first slot of an
 * item is a tab stop, so a two-hour request counts once for the keyboard.
 * @param {HTMLElement} cella
 * @param {VoceInAttesa} attesa - the pending item on this slot
 * @param {Map<string, VoceInAttesa>} inAttesa - all pending slots of the week, by slot key
 * @param {string} giorno - 'YYYY-MM-DD' of the slot
 * @param {number} minuti - slot start, minutes from midnight
 * @returns {void}
 */
function decoraSlotInAttesa(cella, attesa, inAttesa, giorno, minuti) {
  cella.classList.add('in-attesa');
  const precedente = inAttesa.get(chiaveSlot(giorno, minuti - PASSO_MIN));
  const primoSlot = precedente === undefined || precedente.genere !== attesa.genere || precedente.id !== attesa.id;
  const etichetta = etichettaGiorno(giorno);
  const nomeAccessibile = `Dettagli: ${attesa.descrizione}, ${etichetta.nomeGiorno} ${etichetta.dataBreve} ${oraTesto(minuti)}`;
  rendiCliccabile(cella, attesa.genere, attesa.id, nomeAccessibile, primoSlot);
}

/**
 * Renders the weekly grid: one cell per half hour, painted with the color of
 * the società that booked it and labelled with its name. A free slot the
 * società has asked for (opzioni.inAttesa) is painted yellow; a free future
 * slot nobody asked for gets the "+" shortcut.
 * @param {HTMLElement} contenitore - the grid container (#cal-griglia)
 * @param {string} lunedi - Monday of the week to draw, 'YYYY-MM-DD'
 * @param {Prenotazione[]} prenotazioni - booked slots of the week
 * @param {OpzioniCalendario} opzioni
 * @returns {void}
 */
export function renderCalendarioSettimana(contenitore, lunedi, prenotazioni, opzioni) {
  /** @type {Map<string, Prenotazione>} */
  const perChiave = new Map(prenotazioni.map((prenotazione) => [prenotazione.slot_key, prenotazione]));
  const inAttesa = opzioni.inAttesa ?? new Map();
  const adesso = adessoRoma();
  const chiaveAdesso = chiaveSlot(adesso.data, Math.floor(adesso.minuti / PASSO_MIN) * PASSO_MIN);

  contenitore.setAttribute('aria-label', 'Calendario settimanale con i nomi delle società');
  costruisciGriglia(
    contenitore,
    giorniSettimana(lunedi),
    (cella, giorno, minuti) => {
      const chiave = chiaveSlot(giorno, minuti);
      const prenotazione = perChiave.get(chiave);
      const attesa = inAttesa.get(chiave);
      /*
       * One state per cell, in decreasing priority: a booking always wins
       * over an own pending request on the same slot. When somebody else's
       * booking was approved after this società sent its request, the slot
       * really is gone, so the cell must not suggest otherwise — the tooltip
       * mentions both.
       */
      let descrizione = 'libero';
      if (prenotazione !== undefined) {
        decoraSlotPrenotato(cella, prenotazione, perChiave, giorno, minuti, opzioni);
        descrizione = descrizionePrenotazione(prenotazione, opzioni);
        if (attesa !== undefined) descrizione += NOTA_RICHIESTA_SU_OCCUPATO;
      } else if (attesa !== undefined) {
        decoraSlotInAttesa(cella, attesa, inAttesa, giorno, minuti);
        descrizione = attesa.descrizione;
      }

      const passato = chiave < chiaveAdesso;
      if (passato) cella.classList.add('passato');
      if (giorno === adesso.data) cella.classList.add('colonna-oggi');
      // Only a free future slot can be booked, so only there the "+"
      // shortcut makes sense: elsewhere the popup would be born rejected —
      // or, on a slot already requested, would duplicate a pending request.
      if (prenotazione === undefined && attesa === undefined && !passato) aggiungiBottoneSlot(cella, giorno, minuti);

      const etichetta = etichettaGiorno(giorno);
      cella.title = `${etichetta.nomeGiorno} ${etichetta.dataBreve} · ${oraTesto(minuti)}–${oraTesto(minuti + PASSO_MIN)} · ${descrizione}`;
    },
    (testata, giorno) => {
      if (giorno === adesso.data) testata.classList.add('oggi');
    },
  );
}

/**
 * @typedef {object} VoceMese - one entry of a day cell, before it becomes markup
 * @property {string} data - 'YYYY-MM-DD'
 * @property {string} oraInizio - 'HH:MM'
 * @property {string} oraFine - 'HH:MM'
 * @property {string} etichetta - second line of the entry (società name or "In attesa")
 * @property {'occupato'|'in-attesa'} stato - state class, carries the color
 * @property {string} [colore] - '#RRGGBB' of the società, bookings only
 * @property {string} descrizione - tooltip text after the date and time
 * @property {{genere: string, id: number}|null} dettagli - what a click opens, null for none
 */

/**
 * Turns the bookings and the own pending items of the grid into the entries
 * of the monthly view, in chronological order: one entry per booking (all its
 * slots compressed into a time range, with the società name) and one per
 * pending item and continuous range.
 * @param {Prenotazione[]} prenotazioni - booked slots of the grid
 * @param {OpzioniCalendario} opzioni
 * @returns {VoceMese[]}
 */
function vociDelMese(prenotazioni, opzioni) {
  const voci = raggruppaPrenotazioni(prenotazioni).map((blocco) => ({
    data: blocco.data,
    oraInizio: blocco.oraInizio,
    oraFine: blocco.oraFine,
    etichetta: blocco.societa,
    stato: 'occupato',
    colore: blocco.colore,
    descrizione: opzioni.mostraAttivita ? `${blocco.societa} · ${blocco.titolo}` : blocco.societa,
    dettagli: opzioni.dettagliDi(blocco.societaId, blocco.richiestaId),
  }));

  const occupati = new Set(prenotazioni.map((prenotazione) => prenotazione.slot_key));
  for (const fascia of fasceInAttesa(opzioni.inAttesa ?? new Map(), occupati)) {
    voci.push({
      data: fascia.data,
      oraInizio: fascia.oraInizio,
      oraFine: fascia.oraFine,
      etichetta: 'In attesa',
      stato: 'in-attesa',
      descrizione: fascia.voce.descrizione,
      dettagli: { genere: fascia.voce.genere, id: fascia.voce.id },
    });
  }
  return voci.sort((a, b) => (a.data + a.oraInizio).localeCompare(b.data + b.oraInizio));
}

/**
 * Renders the monthly view: one entry per booking inside the cell of its day,
 * painted with the color of the società that booked it, plus the own pending
 * items in yellow. A day with more entries than its cell can show scrolls
 * inside the cell (see .mese-voci).
 * @param {HTMLElement} contenitore - the grid container (#cal-griglia)
 * @param {string} mese - month to draw, 'YYYY-MM'
 * @param {Prenotazione[]} prenotazioni - booked slots of the grid (whole weeks)
 * @param {OpzioniCalendario} opzioni
 * @returns {void}
 */
export function renderCalendarioMese(contenitore, mese, prenotazioni, opzioni) {
  /** @type {Map<string, VoceMese[]>} entries of the grid, by date */
  const perGiorno = new Map();
  // Chronological order in, chronological order out: every cell lists its
  // entries from the earliest to the latest.
  for (const voce of vociDelMese(prenotazioni, opzioni)) {
    const delGiorno = perGiorno.get(voce.data);
    if (delGiorno === undefined) {
      perGiorno.set(voce.data, [voce]);
    } else {
      delGiorno.push(voce);
    }
  }

  const oggi = adessoRoma().data;
  contenitore.setAttribute('aria-label', 'Calendario mensile con i nomi delle società');
  costruisciGrigliaMese(contenitore, mese, giorniGrigliaMese(mese), (cella, voci, giorno) => {
    if (giorno < oggi) cella.classList.add('passato');
    if (giorno === oggi) cella.classList.add('oggi');
    for (const voce of perGiorno.get(giorno) ?? []) {
      const orario = `${voce.oraInizio}–${voce.oraFine}`;
      const elementoVoce = creaVoceMese({
        orario,
        etichetta: voce.etichetta,
        stato: voce.stato,
        colore: voce.colore,
        descrizione: `${dataEstesa(giorno)} · ${orario} · ${voce.descrizione}`,
      });
      if (voce.dettagli !== null) {
        rendiCliccabile(elementoVoce, voce.dettagli.genere, voce.dettagli.id, `Dettagli: ${voce.descrizione}, ${dataEstesa(giorno)} ${orario}`);
      }
      voci.append(elementoVoce);
    }
    // Only a day that is not over can host a new booking, so only there the
    // "+" shortcut makes sense: elsewhere the popup would be born rejected.
    if (giorno >= oggi) aggiungiBottoneGiorno(cella, giorno, minutiDaOra(opzioni.oraPredefinita));
  });
}
