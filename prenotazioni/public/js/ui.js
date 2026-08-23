/* ui.js — DOM manipulation helpers shared by the pages. No API calls here. */
import { APERTURA_MIN, CHIUSURA_MIN, PASSO_MIN, TESTO_STATO } from './constants.js';
import { etichettaGiorno, oraTesto } from './utils.js';

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
