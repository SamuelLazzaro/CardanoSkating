/*
 * vista-movimento.js — "Nuovo movimento" form: type, warehouse and category
 * narrow the item select; ENTRATA can add stock to an item or create a new
 * one; CONSEGNA and RESTITUZIONE need an athlete and may carry a signature.
 */
import { STATI_ARTICOLO } from './constants.js';
import { registraMovimento } from './api.js';
import { preparaFirma } from './firma.js';
import { articoloPerId, atletiAttivi, categorieAttive, g_stato } from './stato.js';
import { mostraMessaggio, riempiSelectConSegnaposto } from './ui.js';
import { etichettaArticolo, nomeConCategoria, oggiRoma, testoONull } from './utils.js';

/** @type {(id: string) => HTMLElement} */
const elemento = (id) => document.getElementById(id);

/** @type {((disciplina: string) => Promise<void>)|null} called after a successful registration */
let g_alRegistrato = null;

/** @type {import('./firma.js').PadFirma|null} */
let g_firma = null;

/**
 * @param {{alRegistrato: (disciplina: string) => Promise<void>}} opzioni
 * @returns {void}
 */
export function preparaMovimento({ alRegistrato }) {
  g_alRegistrato = alRegistrato;
  g_firma = preparaFirma(elemento('mov-firma'), elemento('mov-cancella-firma'));
  const condizione = elemento('mov-condizione');
  for (const stato of STATI_ARTICOLO) condizione.append(new Option(stato, stato));
  elemento('mov-data').value = oggiRoma();

  elemento('mov-tipo').addEventListener('change', aggiornaModalita);
  elemento('mov-disciplina').addEventListener('change', filtraArticoli);
  elemento('mov-categoria').addEventListener('change', filtraArticoli);
  for (const radio of document.querySelectorAll('input[name="modo-entrata"]')) radio.addEventListener('change', aggiornaModalita);
  elemento('form-movimento').addEventListener('submit', registra);
  aggiornaModalita();
}

/** @returns {void} refills the selects from g_stato keeping the current choices when still valid */
export function renderMovimento() {
  const categorie = categorieAttive().map((categoria) => ({ valore: categoria.nome, etichetta: categoria.nome }));
  riempiSelectConSegnaposto(elemento('mov-categoria'), '— Tutte le categorie —', categorie);
  const atleti = atletiAttivi().map((atleta) => ({ valore: String(atleta.id), etichetta: nomeConCategoria(atleta) }));
  riempiSelectConSegnaposto(elemento('mov-atleta'), '— Seleziona atleta —', atleti);
  const selettoreArticoli = elemento('mov-articolo');
  const scelta = selettoreArticoli.value;
  selettoreArticoli.replaceChildren(new Option('— Seleziona materiale —', ''));
  for (const articolo of g_stato.articoli) {
    const opzione = new Option(etichettaArticolo(articolo), String(articolo.id));
    opzione.dataset.disciplina = articolo.disciplina;
    opzione.dataset.categoria = articolo.categoria;
    selettoreArticoli.append(opzione);
  }
  selettoreArticoli.value = scelta;
  filtraArticoli();
}

/**
 * Pre-fills the form from another section: a warehouse (dashboard shortcut)
 * or a specific item (item card). Resets any previous choice of item.
 * @param {{disciplina?: string, articoloId?: number}} scelta
 * @returns {void}
 */
export function impostaMovimento({ disciplina, articoloId }) {
  mostraMessaggio(elemento('esito-movimento'), '');
  const articolo = articoloId === undefined ? undefined : articoloPerId(articoloId);
  if (articolo) {
    elemento('mov-disciplina').value = articolo.disciplina;
    elemento('mov-categoria').value = [...elemento('mov-categoria').options].some((opzione) => opzione.value === articolo.categoria) ? articolo.categoria : '';
    filtraArticoli();
    elemento('mov-articolo').value = String(articolo.id);
    return;
  }
  if (disciplina) elemento('mov-disciplina').value = disciplina;
  elemento('mov-categoria').value = '';
  filtraArticoli();
  elemento('mov-articolo').value = '';
}

/**
 * Shows only the items of the chosen warehouse and category in the select,
 * dropping a selection that is no longer visible.
 * @returns {void}
 */
function filtraArticoli() {
  const disciplina = elemento('mov-disciplina').value;
  const categoria = elemento('mov-categoria').value;
  const selettore = elemento('mov-articolo');
  let visibili = 0;
  for (const opzione of selettore.querySelectorAll('option[data-disciplina]')) {
    const mostra = opzione.dataset.disciplina === disciplina && (categoria === '' || opzione.dataset.categoria === categoria);
    opzione.hidden = !mostra;
    opzione.disabled = !mostra;
    if (mostra) visibili++;
  }
  const corrente = selettore.selectedOptions[0];
  if (corrente && corrente.value !== '' && corrente.disabled) selettore.value = '';
  elemento('mov-nessun-articolo').hidden = visibili > 0;
}

/** @returns {boolean} true when the form creates a new item (ENTRATA + "nuovo") */
function creaNuovoArticolo() {
  const modo = document.querySelector('input[name="modo-entrata"]:checked');
  return elemento('mov-tipo').value === 'ENTRATA' && modo !== null && modo.value === 'nuovo';
}

/**
 * Shows and hides the blocks that depend on the movement type: athlete and
 * signature only for consegna/restituzione, the entrata mode and the new item
 * panel only for entrata. Required flags follow the visible blocks.
 * @returns {void}
 */
function aggiornaModalita() {
  const entrata = elemento('mov-tipo').value === 'ENTRATA';
  const nuovo = creaNuovoArticolo();
  elemento('mov-blocco-entrata').hidden = !entrata;
  elemento('mov-blocco-atleta').hidden = entrata;
  elemento('mov-blocco-firma').hidden = entrata;
  elemento('mov-blocco-nuovo').hidden = !nuovo;
  elemento('mov-blocco-articolo').hidden = nuovo;
  elemento('mov-articolo').required = !nuovo;
  elemento('mov-nuovo-codice').required = nuovo;
  elemento('mov-nuovo-descrizione').required = nuovo;
  elemento('mov-categoria').required = nuovo;
  elemento('mov-atleta').required = !entrata;
}

/**
 * Builds the request body from the form.
 * @returns {object}
 */
function corpoMovimento() {
  const corpo = {};
  corpo.tipo = elemento('mov-tipo').value;
  corpo.quantita = Number(elemento('mov-quantita').value);
  corpo.data = elemento('mov-data').value;
  corpo.condizione = testoONull(elemento('mov-condizione').value);
  corpo.note = testoONull(elemento('mov-note').value);
  if (creaNuovoArticolo()) {
    corpo.nuovo_articolo = leggiNuovoArticolo();
  } else {
    corpo.articolo_id = Number(elemento('mov-articolo').value);
  }
  if (corpo.tipo !== 'ENTRATA') {
    corpo.atleta_id = Number(elemento('mov-atleta').value);
    corpo.firma = g_firma.dati();
  }
  return corpo;
}

/**
 * Reads the "Nuovo articolo" panel; warehouse and category come from the
 * selects above it.
 * @returns {object}
 */
function leggiNuovoArticolo() {
  const nuovo = {};
  nuovo.codice = elemento('mov-nuovo-codice').value.trim();
  nuovo.disciplina = elemento('mov-disciplina').value;
  nuovo.categoria = elemento('mov-categoria').value;
  nuovo.descrizione = elemento('mov-nuovo-descrizione').value.trim();
  nuovo.marca = testoONull(elemento('mov-nuovo-marca').value);
  nuovo.modello = testoONull(elemento('mov-nuovo-modello').value);
  nuovo.taglia = testoONull(elemento('mov-nuovo-taglia').value);
  nuovo.seriale = testoONull(elemento('mov-nuovo-seriale').value);
  nuovo.valore = Number(elemento('mov-nuovo-valore').value || 0);
  return nuovo;
}

/**
 * @param {SubmitEvent} evento
 * @returns {Promise<void>}
 */
async function registra(evento) {
  evento.preventDefault();
  const bottone = elemento('bottone-registra-movimento');
  const esito = elemento('esito-movimento');
  bottone.disabled = true;
  try {
    const risposta = await registraMovimento(corpoMovimento());
    azzeraForm();
    mostraMessaggio(esito, '');
    await g_alRegistrato(risposta.disciplina);
  } catch (errore) {
    mostraMessaggio(esito, errore.message, 'errore');
  } finally {
    bottone.disabled = false;
  }
}

/** @returns {void} clears the fields of the registered movement, keeping type and warehouse */
function azzeraForm() {
  elemento('mov-articolo').value = '';
  elemento('mov-atleta').value = '';
  elemento('mov-quantita').value = '1';
  elemento('mov-data').value = oggiRoma();
  elemento('mov-condizione').value = '';
  elemento('mov-note').value = '';
  for (const id of ['mov-nuovo-codice', 'mov-nuovo-descrizione', 'mov-nuovo-marca', 'mov-nuovo-modello', 'mov-nuovo-taglia', 'mov-nuovo-seriale']) elemento(id).value = '';
  elemento('mov-nuovo-valore').value = '0';
  g_firma.azzera();
}
