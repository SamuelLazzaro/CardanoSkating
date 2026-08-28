/* ui.js — DOM manipulation helpers shared by the pages. No API calls here. */
import { APERTURA_MIN, CHIUSURA_MIN, PASSO_MIN, TESTO_STATO } from './constants.js';
import { eUltimoInputTouch } from './tap-feedback.js';
import { eColoreEsadecimale, etichettaGiorno, meseDellaData, oraTesto } from './utils.js';

/** @type {string} class of the "+" shortcut button placed on free slots */
const CLASSE_BOTTONE_SLOT = 'btn-aggiungi-slot';

/** @type {string} class marking the slot whose "+" a tap has revealed */
const CLASSE_SLOT_RIVELATO = 'mostra-aggiungi';

/**
 * @type {string} cells that can own a "+" shortcut: a half-hour slot of the
 * weekly grid or a whole day of the monthly one. Only one of the two views is
 * rendered at a time, so a single delegated listener serves both.
 */
const SELETTORE_CELLA = '.slot, .mese-giorno';

/** @type {string} SVG namespace, required by createElementNS */
const NS_SVG = 'http://www.w3.org/2000/svg';

/**
 * Builds the weekly grid (hour column + 7 day columns, one row per half
 * hour). The look of each cell is delegated to decoraCella; decoraGiorno is
 * optional and decorates the day headers (e.g. to highlight today).
 *
 * Every half-hour row starts with its own time label (class .cal-ora, e.g.
 * 8:00, 8:30, ...), so CSS grid auto-placement fills columns 2-8 with the 7
 * day cells of that row.
 * @param {HTMLElement} contenitore - grid container (emptied first)
 * @param {string[]} giorni - the 7 dates of the week
 * @param {(cella: HTMLElement, giorno: string, minuti: number) => void} decoraCella
 * @param {(testata: HTMLElement, giorno: string) => void} [decoraGiorno]
 * @returns {void}
 */
export function costruisciGriglia(contenitore, giorni, decoraCella, decoraGiorno) {
  contenitore.className = 'calendario';
  contenitore.textContent = '';
  const frammento = document.createDocumentFragment();

  const angolo = document.createElement('div');
  angolo.className = 'cal-angolo';
  frammento.appendChild(angolo);

  for (const giorno of giorni) {
    const testata = document.createElement('div');
    testata.className = 'cal-giorno';
    const etichetta = etichettaGiorno(giorno);
    const nome = document.createElement('span');
    nome.textContent = etichetta.nomeGiorno;
    const numero = document.createElement('span');
    numero.className = 'cal-giorno-data';
    numero.textContent = etichetta.dataBreve;
    testata.append(nome, numero);
    if (decoraGiorno) decoraGiorno(testata, giorno);
    frammento.appendChild(testata);
  }

  for (let minuti = APERTURA_MIN; minuti < CHIUSURA_MIN; minuti += PASSO_MIN) {
    // .inizio-ora marks full-hour rows: label and slots share a solid top
    // border there, a dotted one on half-hour rows.
    const inizioOra = minuti % 60 === 0;
    const etichettaOra = document.createElement('div');
    etichettaOra.className = inizioOra ? 'cal-ora inizio-ora' : 'cal-ora';
    etichettaOra.textContent = oraTesto(minuti);
    frammento.appendChild(etichettaOra);
    for (const giorno of giorni) {
      const cella = document.createElement('div');
      cella.className = inizioOra ? 'slot inizio-ora' : 'slot';
      decoraCella(cella, giorno, minuti);
      frammento.appendChild(cella);
    }
  }

  contenitore.appendChild(frammento);
}

/**
 * Builds the monthly grid: a header row of weekday names plus one cell per day
 * of the shown weeks. The weeks are always whole, so the spill-over days of the
 * neighbouring months are drawn too (dimmed, class .fuori-mese).
 *
 * Every cell holds the day number — a button, so a click can jump to the
 * weekly view of that day (see preparaDrillDownGiorno) — and the list of that
 * day's bookings, which decoraCella fills with creaVoceMese entries. That list
 * has a fixed height in CSS and scrolls on its own, so a very busy day never
 * stretches the row: the entries that do not fit stay reachable by scrolling
 * inside the cell.
 * @param {HTMLElement} contenitore - grid container (emptied first)
 * @param {string} mese - shown month, 'YYYY-MM' (tells the spill-over days apart)
 * @param {string[]} giorni - dates of the grid, from utils.giorniGrigliaMese()
 * @param {(cella: HTMLElement, voci: HTMLElement, giorno: string, nelMese: boolean) => void} decoraCella
 * @returns {void}
 */
export function costruisciGrigliaMese(contenitore, mese, giorni, decoraCella) {
  contenitore.className = 'calendario-mese';
  contenitore.textContent = '';
  const frammento = document.createDocumentFragment();

  // The weekday names are read from the first row, which always starts on a
  // Monday: no separate list of names to keep in sync with the grid.
  for (const giorno of giorni.slice(0, 7)) {
    const nome = document.createElement('div');
    nome.className = 'cal-giorno-nome';
    nome.textContent = etichettaGiorno(giorno).nomeGiorno;
    frammento.appendChild(nome);
  }

  for (const giorno of giorni) {
    const nelMese = meseDellaData(giorno) === mese;
    const cella = document.createElement('div');
    cella.className = nelMese ? 'mese-giorno' : 'mese-giorno fuori-mese';

    const etichetta = etichettaGiorno(giorno);
    const numero = document.createElement('button');
    numero.type = 'button';
    numero.className = 'mese-numero';
    numero.dataset.giorno = giorno;
    numero.textContent = String(Number(giorno.slice(8, 10)));
    numero.setAttribute('aria-label', `Vai alla settimana di ${etichetta.nomeGiorno} ${etichetta.dataBreve}`);

    const voci = document.createElement('div');
    voci.className = 'mese-voci';

    cella.append(numero, voci);
    decoraCella(cella, voci, giorno, nelMese);
    frammento.appendChild(cella);
  }

  contenitore.appendChild(frammento);
}

/**
 * One booking entry of a day cell in the monthly view: the time range on the
 * first line and a label on the second — the società name in the admin view,
 * the activity (or nothing, for somebody else's anonymous booking) in the area
 * società one. The state class carries the color exactly like the weekly grid
 * cells, so the two views cannot drift apart.
 * @param {{orario: string, etichetta?: string, stato: string, descrizione: string, colore?: string}} dati
 *   stato: 'occupato' | 'mio' | 'in-attesa'; descrizione: full text for the tooltip;
 *   colore: '#RRGGBB' of the società, when the view is allowed to show it
 * @returns {HTMLElement}
 */
export function creaVoceMese(dati) {
  const voce = document.createElement('div');
  voce.className = `mese-voce ${dati.stato}`;
  // Defence in depth: the color comes from the DB through the API, so it is
  // re-validated here before it can reach an inline style.
  if (eColoreEsadecimale(dati.colore)) {
    voce.classList.add('colorato');
    voce.style.setProperty('--colore-societa', dati.colore);
  }
  voce.title = dati.descrizione;

  const orario = document.createElement('span');
  orario.className = 'mese-voce-orario';
  orario.textContent = dati.orario;
  voce.append(orario);

  if (dati.etichetta) {
    const etichetta = document.createElement('span');
    etichetta.className = 'mese-voce-nome';
    etichetta.textContent = dati.etichetta;
    voce.append(etichetta);
  }
  return voce;
}

/**
 * Wires the day numbers of a monthly grid to one delegated listener on the
 * container, which survives every re-render (the builder empties the container
 * but the container itself stays in place).
 * @param {HTMLElement} contenitore - the grid container (#cal-griglia)
 * @param {(giorno: string) => void} alGiorno - called with the 'YYYY-MM-DD' of the clicked day
 * @returns {void}
 */
export function preparaDrillDownGiorno(contenitore, alGiorno) {
  contenitore.addEventListener('click', (evento) => {
    const bersaglio = evento.target instanceof Element ? evento.target : null;
    const numero = bersaglio?.closest('.mese-numero') ?? null;
    if (numero !== null && contenitore.contains(numero)) alGiorno(numero.dataset.giorno);
  });
}

/**
 * Builds the stroked "+" icon of the slot shortcut: same shape as the icon
 * inside the "Nuova prenotazione" buttons of the pages.
 * @returns {SVGSVGElement}
 */
function creaIconaPiu() {
  const icona = document.createElementNS(NS_SVG, 'svg');
  icona.setAttribute('viewBox', '0 0 24 24');
  icona.setAttribute('fill', 'none');
  icona.setAttribute('stroke', 'currentColor');
  icona.setAttribute('stroke-width', '3');
  icona.setAttribute('stroke-linecap', 'round');
  icona.setAttribute('aria-hidden', 'true');
  const linee = [[12, 5, 12, 19], [5, 12, 19, 12]]; // vertical, then horizontal stroke
  for (const [x1, y1, x2, y2] of linee) {
    const linea = document.createElementNS(NS_SVG, 'line');
    linea.setAttribute('x1', String(x1));
    linea.setAttribute('y1', String(y1));
    linea.setAttribute('x2', String(x2));
    linea.setAttribute('y2', String(y2));
    icona.append(linea);
  }
  return icona;
}

/**
 * Round "+" button of a cell shortcut. Only the markup is created here: the
 * click is served by the single delegated listener of preparaScorciatoiaSlot,
 * so a whole week of slots costs one listener instead of ~200. Date and start
 * minute travel in the button's data attributes.
 * @param {string} giorno - 'YYYY-MM-DD' the popup will open on
 * @param {number} minuti - start time to prefill, minutes from midnight
 * @param {string} etichetta - accessible name of the button
 * @returns {HTMLButtonElement}
 */
function creaBottoneAggiungi(giorno, minuti, etichetta) {
  const bottone = document.createElement('button');
  bottone.type = 'button';
  bottone.className = CLASSE_BOTTONE_SLOT;
  bottone.dataset.giorno = giorno;
  bottone.dataset.minuti = String(minuti);
  bottone.setAttribute('aria-label', etichetta);
  bottone.append(creaIconaPiu());
  return bottone;
}

/**
 * Adds the "+" shortcut to a free slot of the weekly grid: a small round
 * button in the top-right corner of the cell, which opens the booking popup
 * already filled with that date and time. Callers decide which slots deserve
 * it (free and not past).
 * @param {HTMLElement} cella - the .slot cell the button belongs to
 * @param {string} giorno - 'YYYY-MM-DD' of the slot
 * @param {number} minuti - slot start, minutes from midnight
 * @returns {void}
 */
export function aggiungiBottoneSlot(cella, giorno, minuti) {
  const etichetta = etichettaGiorno(giorno);
  const nome = `Nuova prenotazione ${etichetta.nomeGiorno} ${etichetta.dataBreve} alle ${oraTesto(minuti)}`;
  cella.classList.add('con-aggiungi');
  cella.append(creaBottoneAggiungi(giorno, minuti, nome));
}

/**
 * The same shortcut on a day cell of the monthly grid, where a cell is a whole
 * day and not a single slot: the popup opens on that date with the default
 * time of the page's form, which the user then adjusts.
 * @param {HTMLElement} cella - the .mese-giorno cell the button belongs to
 * @param {string} giorno - 'YYYY-MM-DD' of the day
 * @param {number} minuti - start time to prefill, minutes from midnight
 * @returns {void}
 */
export function aggiungiBottoneGiorno(cella, giorno, minuti) {
  const etichetta = etichettaGiorno(giorno);
  cella.append(creaBottoneAggiungi(giorno, minuti, `Nuova prenotazione ${etichetta.nomeGiorno} ${etichetta.dataBreve}`));
}

/**
 * Wires the "+" shortcut of a calendar grid with one delegated listener, which
 * survives every re-render (the builders empty the container but the container
 * itself stays in place) and serves both views: a cell is a half-hour slot in
 * the weekly grid, a whole day in the monthly one.
 *
 * Mouse and stylus reveal the "+" on :hover, in pure CSS. Touch screens have
 * no hover, so there the reveal takes two taps and every click is classified:
 *   - tap on a "+": open the popup on its cell (the only case that acts)
 *   - tap on a cell that owns a hidden "+": reveal it, so the next tap can
 *     hit it; a second tap on the same cell hides it again
 *   - anything else, anywhere on the page: just hide the revealed "+"
 * At most one "+" is revealed at a time, so the grid never fills with them.
 * A tap on a day number is left out: that one navigates (drill-down) and must
 * not turn into a reveal.
 * @param {HTMLElement} contenitore - the grid container (#cal-griglia)
 * @param {(giorno: string, minuti: number) => void} alSelezione - opens the popup on a cell
 * @returns {void}
 */
export function preparaScorciatoiaSlot(contenitore, alSelezione) {
  document.addEventListener('click', (evento) => {
    const bersaglio = evento.target instanceof Element ? evento.target : null;
    const bottone = bersaglio?.closest(`.${CLASSE_BOTTONE_SLOT}`) ?? null;
    // A click on a day number navigates to its week: it counts as a click
    // outside any cell, so it can only hide an already revealed "+".
    const numeroDelGiorno = bersaglio?.closest('.mese-numero') ?? null;
    const cellaCliccata = numeroDelGiorno === null ? bersaglio?.closest(SELETTORE_CELLA) ?? null : null;
    // Only this grid reacts: the page may host more than one.
    const cellaNostra = cellaCliccata !== null && contenitore.contains(cellaCliccata);
    const eraRivelata = cellaNostra && cellaCliccata.classList.contains(CLASSE_SLOT_RIVELATO);

    const rivelata = contenitore.querySelector(`.${CLASSE_SLOT_RIVELATO}`);
    if (rivelata !== null) rivelata.classList.remove(CLASSE_SLOT_RIVELATO);

    if (bottone !== null && contenitore.contains(bottone)) {
      alSelezione(bottone.dataset.giorno, Number(bottone.dataset.minuti));
      return;
    }

    const daRivelare = cellaNostra
      && !eraRivelata
      && eUltimoInputTouch()
      && cellaCliccata.querySelector(`.${CLASSE_BOTTONE_SLOT}`) !== null;
    if (daRivelare) cellaCliccata.classList.add(CLASSE_SLOT_RIVELATO);
  });
}

/**
 * Shows (or hides, with empty text) a status message element.
 * @param {HTMLElement} elemento - element with the .stato class
 * @param {string} testo - message; empty string hides the element
 * @param {'ok'|'errore'|''} [tipo] - visual variant
 * @returns {void}
 */
export function mostraMessaggio(elemento, testo, tipo = '') {
  elemento.textContent = testo;
  elemento.className = tipo ? `stato ${tipo}` : 'stato';
  elemento.hidden = testo === '';
}

/**
 * Status message followed by a bullet list (e.g. the time ranges that are no
 * longer available). Both the message and every item go through textContent,
 * so server-provided data can never become markup.
 * @param {HTMLElement} elemento - element with the .stato class
 * @param {string} testo - message shown above the list
 * @param {string[]} voci - list items, already formatted for reading
 * @param {'ok'|'errore'|''} [tipo] - visual variant
 * @returns {void}
 */
export function mostraMessaggioConElenco(elemento, testo, voci, tipo = '') {
  mostraMessaggio(elemento, testo, tipo);
  if (voci.length === 0) return;
  const elenco = document.createElement('ul');
  elenco.className = 'elenco-stato';
  for (const voce of voci) {
    const riga = document.createElement('li');
    riga.textContent = voce;
    elenco.appendChild(riga);
  }
  elemento.appendChild(elenco);
}

/**
 * Wires a modal dialog to its open/close buttons. The dialog also closes on
 * Esc (native <dialog> behaviour) and on a click landing on the backdrop:
 * clicks inside the content target an inner element, so a target equal to
 * the dialog itself can only come from the backdrop area.
 * @param {HTMLDialogElement} dialogo
 * @param {HTMLElement} bottoneApri
 * @param {HTMLElement} bottoneChiudi
 * @returns {void}
 */
export function preparaDialogo(dialogo, bottoneApri, bottoneChiudi) {
  bottoneApri.addEventListener('click', () => dialogo.showModal());
  bottoneChiudi.addEventListener('click', () => dialogo.close());
  dialogo.addEventListener('click', (evento) => {
    if (evento.target === dialogo) dialogo.close();
  });
}

/**
 * @param {string} stato - richiesta/ricorrenza state
 * @returns {HTMLSpanElement} a .badge element with the state label
 */
export function creaBadge(stato) {
  const badge = document.createElement('span');
  badge.className = `badge badge-${stato}`;
  badge.textContent = TESTO_STATO[stato] ?? stato;
  return badge;
}

/**
 * Populates the start/end time selects with 30-minute steps and keeps the
 * interval consistent (the end always follows the start).
 * @param {HTMLSelectElement} selettoreInizio
 * @param {HTMLSelectElement} selettoreFine
 * @param {string} [inizioPredefinito] - default start time
 * @param {string} [finePredefinita] - default end time
 * @returns {void}
 */
export function preparaSelectOrari(selettoreInizio, selettoreFine, inizioPredefinito = '18:00', finePredefinita = '19:00') {
  for (let minuti = APERTURA_MIN; minuti < CHIUSURA_MIN; minuti += PASSO_MIN) {
    selettoreInizio.append(new Option(oraTesto(minuti), oraTesto(minuti)));
    selettoreFine.append(new Option(oraTesto(minuti + PASSO_MIN), oraTesto(minuti + PASSO_MIN)));
  }
  selettoreInizio.value = inizioPredefinito;
  selettoreFine.value = finePredefinita;
  selettoreInizio.addEventListener('change', () => {
    if (selettoreFine.value <= selettoreInizio.value) {
      const [ore, minuti] = selettoreInizio.value.split(':').map(Number);
      selettoreFine.value = oraTesto(ore * 60 + minuti + PASSO_MIN);
    }
  });
}
