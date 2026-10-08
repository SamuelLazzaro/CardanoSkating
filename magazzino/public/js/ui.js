/* ui.js — DOM helpers: they receive data and manipulate the DOM, never call the API. */
import { TESTO_BREVE_TIPO } from './constants.js';

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
 * Wires a modal dialog to its close button, to Esc (native <dialog>
 * behaviour) and to a click landing on the backdrop: clicks inside the
 * content target an inner element, so a target equal to the dialog itself
 * can only come from the backdrop area.
 * @param {HTMLDialogElement} dialogo
 * @param {HTMLElement} bottoneChiudi
 * @returns {void}
 */
export function preparaDialogo(dialogo, bottoneChiudi) {
  bottoneChiudi.addEventListener('click', () => dialogo.close());
  dialogo.addEventListener('click', (evento) => {
    if (evento.target === dialogo) dialogo.close();
  });
}

/**
 * Replaces the options of a <select> with the given values.
 * @param {HTMLSelectElement} selettore
 * @param {string[]} valori - option values, used as labels too
 * @returns {void}
 */
export function riempiSelect(selettore, valori) {
  selettore.replaceChildren();
  for (const valore of valori) selettore.append(new Option(valore, valore));
}

/**
 * Replaces the options of a <select> keeping a leading placeholder.
 * @param {HTMLSelectElement} selettore
 * @param {string} segnaposto - label of the empty first option
 * @param {{valore: string, etichetta: string}[]} opzioni
 * @returns {void}
 */
export function riempiSelectConSegnaposto(selettore, segnaposto, opzioni) {
  const scelta = selettore.value;
  selettore.replaceChildren(new Option(segnaposto, ''));
  for (const opzione of opzioni) selettore.append(new Option(opzione.etichetta, opzione.valore));
  // keep the previous choice when it is still available
  if ([...selettore.options].some((opzione) => opzione.value === scelta)) selettore.value = scelta;
}

/**
 * @param {string} testo - badge label
 * @param {string} classe - modifier class, e.g. 'badge-ghiaccio'
 * @returns {HTMLSpanElement}
 */
export function creaBadge(testo, classe) {
  const badge = document.createElement('span');
  badge.className = `badge ${classe}`;
  badge.textContent = testo;
  return badge;
}

/**
 * @param {string} disciplina - 'Ghiaccio' | 'Corsa'
 * @returns {HTMLSpanElement} colored badge of the warehouse
 */
export function badgeDisciplina(disciplina) {
  return creaBadge(disciplina, `badge-${disciplina.toLowerCase()}`);
}

/**
 * @param {string} tipo - 'ENTRATA' | 'CONSEGNA' | 'RESTITUZIONE'
 * @returns {HTMLSpanElement}
 */
export function badgeTipoMovimento(tipo) {
  return creaBadge(TESTO_BREVE_TIPO[tipo] ?? tipo, `badge-${tipo.toLowerCase()}`);
}

/**
 * @param {string} stato - item condition, e.g. 'Da riparare'
 * @returns {HTMLSpanElement} badge with a class derived from the condition ('badge-stato-da-riparare')
 */
export function badgeStato(stato) {
  return creaBadge(stato, `badge-stato-${stato.toLowerCase().replace(/\s+/g, '-')}`);
}

/**
 * Text button that opens something (an item card, an athlete card).
 * @param {string} testo - label
 * @param {() => void} alClick
 * @returns {HTMLButtonElement}
 */
export function creaBottoneTesto(testo, alClick) {
  const bottone = document.createElement('button');
  bottone.type = 'button';
  bottone.className = 'btn btn-testo';
  bottone.textContent = testo;
  bottone.addEventListener('click', alClick);
  return bottone;
}

/**
 * Small outlined button for row actions.
 * @param {string} testo - label
 * @param {() => void} alClick
 * @param {string} [classeExtra] - e.g. 'btn-pericolo'
 * @returns {HTMLButtonElement}
 */
export function creaBottonePiccolo(testo, alClick, classeExtra = '') {
  const bottone = document.createElement('button');
  bottone.type = 'button';
  bottone.className = `btn btn-piccolo ${classeExtra}`.trim();
  bottone.textContent = testo;
  bottone.addEventListener('click', alClick);
  return bottone;
}

/**
 * Table row from an array of cells; strings go through textContent, nodes
 * are appended as they are, so API data can never become markup.
 * @param {(string|number|Node|null|undefined)[]} celle
 * @param {string[]} [classiCelle] - optional class per cell (same index)
 * @returns {HTMLTableRowElement}
 */
export function creaRiga(celle, classiCelle = []) {
  const riga = document.createElement('tr');
  celle.forEach((contenuto, indice) => {
    const cella = document.createElement('td');
    if (contenuto instanceof Node) {
      cella.append(contenuto);
    } else {
      cella.textContent = contenuto === null || contenuto === undefined ? '—' : String(contenuto);
    }
    if (classiCelle[indice]) cella.className = classiCelle[indice];
    riga.append(cella);
  });
  return riga;
}

/**
 * Fills a table body with rows, or shows the "empty" paragraph instead.
 * @param {HTMLTableSectionElement} corpo - <tbody>
 * @param {HTMLTableRowElement[]} righe
 * @param {HTMLElement} messaggioVuoto - the .vuoto paragraph
 * @returns {void}
 */
export function riempiTabella(corpo, righe, messaggioVuoto) {
  corpo.replaceChildren(...righe);
  messaggioVuoto.hidden = righe.length > 0;
  corpo.closest('table').hidden = righe.length === 0;
}

/**
 * <dt>/<dd> pairs of a details list; empty values show as "—".
 * @param {HTMLDListElement} elenco
 * @param {[string, string|number|Node|null|undefined][]} coppie - [label, value]
 * @returns {void}
 */
export function riempiDettagli(elenco, coppie) {
  elenco.replaceChildren();
  for (const [etichetta, valore] of coppie) {
    const termine = document.createElement('dt');
    termine.textContent = etichetta;
    const definizione = document.createElement('dd');
    if (valore instanceof Node) {
      definizione.append(valore);
    } else {
      definizione.textContent = valore === null || valore === undefined || valore === '' ? '—' : String(valore);
    }
    elenco.append(termine, definizione);
  }
}

/**
 * Segmented filter (Tutto / Ghiaccio / Corsa): keeps aria-pressed in sync and
 * reports the chosen value.
 * @param {HTMLElement} gruppo - container of the .btn-filtro buttons with data-valore
 * @param {(valore: string) => void} alCambio
 * @returns {{imposta: (valore: string) => void}} programmatic setter (fires alCambio)
 */
export function preparaFiltro(gruppo, alCambio) {
  const bottoni = [...gruppo.querySelectorAll('.btn-filtro')];
  const imposta = (valore) => {
    for (const bottone of bottoni) bottone.setAttribute('aria-pressed', String(bottone.dataset.valore === valore));
    alCambio(valore);
  };
  for (const bottone of bottoni) bottone.addEventListener('click', () => imposta(bottone.dataset.valore));
  return { imposta };
}
