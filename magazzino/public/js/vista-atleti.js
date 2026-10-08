/*
 * vista-atleti.js — Atleti section: add form (name + category), multi-select
 * category filter with its reset button, sort order, list with the inline
 * category select and activate/deactivate, and the athlete card popup (items
 * currently held + personal history).
 *
 * Filter and sort live only in the DOM controls: reading them on every render
 * means no state to keep in sync, and losing them on reload is accepted.
 */
import { CATEGORIE_ATLETA } from './constants.js';
import { creaAtleta, impostaAtletaAttivo, impostaCategoriaAtleta, ottieniAtleta } from './api.js';
import { g_stato } from './stato.js';
import { badgeTipoMovimento, creaBadge, creaBottonePiccolo, creaBottoneTesto, creaRiga, mostraMessaggio, preparaDialogo, riempiTabella } from './ui.js';
import { dataItaliana, filtraEOrdinaAtleti, nomeArticolo, nomeConCategoria } from './utils.js';

/** @type {(id: string) => HTMLElement} */
const elemento = (id) => document.getElementById(id);

/** @type {(() => Promise<void>)|null} reloads the shared state and re-renders every section */
let g_alCambio = null;

/**
 * @param {{alCambio: () => Promise<void>}} opzioni
 * @returns {void}
 */
export function preparaAtleti({ alCambio }) {
  g_alCambio = alCambio;
  riempiSelectCategorie(elemento('campo-categoria-atleta'), true);
  riempiSelectCategorie(elemento('filtro-categorie-atleti'), false);
  elemento('form-atleta').addEventListener('submit', aggiungiAtleta);
  elemento('filtro-categorie-atleti').addEventListener('change', renderAtleti);
  elemento('ordine-atleti').addEventListener('change', renderAtleti);
  elemento('bottone-reset-filtro-atleti').addEventListener('click', resetFiltroCategorie);
  preparaDialogo(elemento('dialogo-atleta'), elemento('bottone-chiudi-atleta'));
}

/**
 * Fills a <select> with the eight categories, "R12 · Ragazzi 12" style.
 * @param {HTMLSelectElement} selettore
 * @param {boolean} conSegnaposto - leading empty "Categoria" option (add form)
 * @returns {void}
 */
function riempiSelectCategorie(selettore, conSegnaposto) {
  selettore.replaceChildren();
  if (conSegnaposto) selettore.append(new Option('Categoria', '', true, true));
  for (const categoria of CATEGORIE_ATLETA) selettore.append(new Option(`${categoria.sigla} · ${categoria.nome}`, categoria.sigla));
}

/** @returns {string[]} category codes selected in the filter */
function categorieFiltrate() {
  return [...elemento('filtro-categorie-atleti').selectedOptions].map((opzione) => opzione.value);
}

/** @returns {void} clears the category filter and shows everyone again */
function resetFiltroCategorie() {
  for (const opzione of elemento('filtro-categorie-atleti').options) opzione.selected = false;
  renderAtleti();
}

/** @returns {void} table of athletes from g_stato, filtered and sorted by the controls */
export function renderAtleti() {
  const categorieScelte = categorieFiltrate();
  elemento('bottone-reset-filtro-atleti').disabled = categorieScelte.length === 0;
  const visibili = filtraEOrdinaAtleti(g_stato.atleti, categorieScelte, elemento('ordine-atleti').value);
  const righe = visibili.map((atleta) => {
    const attivo = atleta.attivo === 1;
    const nome = creaBottoneTesto(atleta.nome, () => apriSchedaAtleta(atleta.id));
    const categoria = creaSelectCategoriaRiga(atleta);
    const stato = creaBadge(attivo ? 'Attivo' : 'Disattivato', attivo ? 'badge-attivo' : 'badge-disattivato');
    const azione = creaBottonePiccolo(attivo ? 'Disattiva' : 'Riattiva', () => cambiaStatoAtleta(atleta.id, !attivo), attivo ? '' : 'btn-ok');
    return creaRiga([nome, categoria, stato, azione], ['', 'cella-categoria', '', 'cella-azioni']);
  });
  riempiTabella(elemento('righe-atleti'), righe, elemento('vuoto-atleti'));
  elemento('vuoto-atleti').textContent = categorieScelte.length === 0 ? 'Nessun atleta.' : 'Nessun atleta nelle categorie selezionate.';
}

/**
 * Inline <select> of the row: shows the code ("—" when missing) and saves on change.
 * @param {{id: number, nome: string, categoria: string|null}} atleta
 * @returns {HTMLSelectElement}
 */
function creaSelectCategoriaRiga(atleta) {
  const selettore = document.createElement('select');
  selettore.className = 'select-categoria-riga';
  selettore.setAttribute('aria-label', `Categoria di ${atleta.nome}`);
  if (atleta.categoria === null) selettore.append(new Option('—', '', true, true));
  for (const categoria of CATEGORIE_ATLETA) selettore.append(new Option(categoria.sigla, categoria.sigla, false, categoria.sigla === atleta.categoria));
  selettore.addEventListener('change', () => cambiaCategoriaAtleta(atleta, selettore.value));
  return selettore;
}

/**
 * @param {SubmitEvent} evento
 * @returns {Promise<void>}
 */
async function aggiungiAtleta(evento) {
  evento.preventDefault();
  const campoNome = elemento('campo-nome-atleta');
  const campoCategoria = elemento('campo-categoria-atleta');
  const esito = elemento('esito-atleti');
  try {
    const creato = await creaAtleta(campoNome.value, campoCategoria.value);
    campoNome.value = '';
    campoCategoria.value = '';
    await g_alCambio();
    mostraMessaggio(esito, `Atleta ${nomeConCategoria(creato)} aggiunto.`, 'ok');
  } catch (errore) {
    mostraMessaggio(esito, errore.message, 'errore');
  }
}

/**
 * @param {number} idAtleta
 * @param {boolean} attivo - new state
 * @returns {Promise<void>}
 */
async function cambiaStatoAtleta(idAtleta, attivo) {
  const esito = elemento('esito-atleti');
  try {
    await impostaAtletaAttivo(idAtleta, attivo);
    await g_alCambio();
    mostraMessaggio(esito, '');
  } catch (errore) {
    mostraMessaggio(esito, errore.message, 'errore');
  }
}

/**
 * @param {{id: number, nome: string}} atleta
 * @param {string} categoria - new category code
 * @returns {Promise<void>}
 */
async function cambiaCategoriaAtleta(atleta, categoria) {
  const esito = elemento('esito-atleti');
  try {
    await impostaCategoriaAtleta(atleta.id, categoria);
    await g_alCambio();
    mostraMessaggio(esito, `Categoria di ${atleta.nome} impostata a ${categoria}.`, 'ok');
  } catch (errore) {
    // the reload inside alCambio did not run: redraw so the select shows the saved value again
    renderAtleti();
    mostraMessaggio(esito, errore.message, 'errore');
  }
}

/**
 * Opens the athlete card popup with fresh data from the server.
 * @param {number} idAtleta
 * @returns {Promise<void>}
 */
async function apriSchedaAtleta(idAtleta) {
  const esito = elemento('esito-atleti');
  try {
    const scheda = await ottieniAtleta(idAtleta);
    elemento('titolo-dialogo-atleta').textContent = nomeConCategoria(scheda.atleta);
    renderAssegnati(scheda.assegnati);
    renderStoricoAtleta(scheda.storico);
    mostraMessaggio(esito, '');
    elemento('dialogo-atleta').showModal();
  } catch (errore) {
    mostraMessaggio(esito, errore.message, 'errore');
  }
}

/**
 * @param {{categoria: string, marca: string, modello: string|null, taglia: string|null, stato: string, in_possesso: number}[]} assegnati
 * @returns {void}
 */
function renderAssegnati(assegnati) {
  const lista = elemento('lista-assegnati');
  lista.replaceChildren();
  for (const articolo of assegnati) {
    const voce = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'riga-info';
    const titolo = document.createElement('strong');
    titolo.textContent = nomeArticolo(articolo);
    const dettaglio = document.createElement('span');
    dettaglio.className = 'testo-tenue';
    dettaglio.textContent = `${articolo.categoria} · Quantità ${articolo.in_possesso} · ${articolo.taglia ?? '—'} · ${articolo.stato}`;
    info.append(titolo, dettaglio);
    voce.append(info);
    lista.append(voce);
  }
  elemento('vuoto-assegnati').hidden = assegnati.length > 0;
}

/**
 * @param {object[]} storico - movements of the athlete, most recent first
 * @returns {void}
 */
function renderStoricoAtleta(storico) {
  const righe = storico.map((movimento) => creaRiga([dataItaliana(movimento.data), badgeTipoMovimento(movimento.tipo), movimento.categoria, nomeArticolo(movimento), movimento.quantita, movimento.condizione, movimento.firma_presente ? '✓' : '—'], ['', '', '', '', 'cella-numero', '', '']));
  riempiTabella(elemento('righe-storico-atleta'), righe, elemento('vuoto-storico-atleta'));
}
