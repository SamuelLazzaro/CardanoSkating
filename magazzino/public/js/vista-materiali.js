/*
 * vista-materiali.js — Materiali section: filterable items table, "Nuovo
 * materiale" popup, item card popup (details, QR code, register movement,
 * delete) and the categories panel.
 */
import { STATI_ARTICOLO } from './constants.js';
import { creaArticolo, creaCategoria, eliminaArticolo, impostaCategoriaAttiva, ottieniArticolo, urlQrArticolo } from './api.js';
import { articoloPerId, categorieAttive, g_stato } from './stato.js';
import { badgeDisciplina, badgeStato, creaBadge, creaBottonePiccolo, creaBottoneTesto, creaRiga, mostraMessaggio, preparaDialogo, preparaFiltro, riempiDatalist, riempiDettagli, riempiSelect, riempiTabella } from './ui.js';
import { euro, filtraArticoli, testoONull } from './utils.js';

/** @type {(id: string) => HTMLElement} */
const elemento = (id) => document.getElementById(id);

/** @type {(() => Promise<void>)|null} reloads the shared state and re-renders every section */
let g_alCambio = null;

/** @type {((idArticolo: number) => void)|null} opens the movement form on an item */
let g_alMovimentoPerArticolo = null;

/** @type {string} warehouse filter of the table: 'Ghiaccio' | 'Corsa' | '' (all) */
let g_filtroDisciplina = '';

/** @type {string} free text filter of the table */
let g_testoRicerca = '';

/** @type {{imposta: (valore: string) => void}|null} segmented filter control */
let g_filtro = null;

/** @type {object|null} item shown in the card popup */
let g_articoloAperto = null;

/**
 * @param {{alCambio: () => Promise<void>, alMovimentoPerArticolo: (idArticolo: number) => void}} opzioni
 * @returns {void}
 */
export function preparaMateriali({ alCambio, alMovimentoPerArticolo }) {
  g_alCambio = alCambio;
  g_alMovimentoPerArticolo = alMovimentoPerArticolo;

  g_filtro = preparaFiltro(elemento('filtro-materiali'), (valore) => {
    g_filtroDisciplina = valore;
    renderTabellaMateriali();
  });
  elemento('ricerca-materiali').addEventListener('input', (evento) => {
    g_testoRicerca = evento.target.value;
    renderTabellaMateriali();
  });

  // "Nuovo materiale" popup
  const dialogoNuovo = elemento('dialogo-nuovo-materiale');
  preparaDialogo(dialogoNuovo, elemento('bottone-chiudi-nuovo-materiale'));
  elemento('bottone-nuovo-materiale').addEventListener('click', () => {
    mostraMessaggio(elemento('esito-nuovo-materiale'), '');
    dialogoNuovo.showModal();
  });
  riempiSelect(elemento('nuovo-stato'), STATI_ARTICOLO);
  elemento('nuovo-stato').value = 'Buono';
  elemento('form-nuovo-materiale').addEventListener('submit', salvaNuovoMateriale);

  // item card popup
  preparaDialogo(elemento('dialogo-materiale'), elemento('bottone-chiudi-materiale'));
  elemento('bottone-movimento-materiale').addEventListener('click', () => {
    elemento('dialogo-materiale').close();
    g_alMovimentoPerArticolo(g_articoloAperto.id);
  });
  elemento('bottone-elimina-materiale').addEventListener('click', eliminaMaterialeAperto);

  // categories panel
  elemento('form-categoria').addEventListener('submit', aggiungiCategoria);
}

/**
 * Sets the warehouse filter from outside (warehouse dashboard shortcut).
 * @param {string} disciplina - 'Ghiaccio' | 'Corsa' | ''
 * @returns {void}
 */
export function impostaFiltroMateriali(disciplina) {
  g_filtro.imposta(disciplina);
}

/** @returns {void} re-renders table, categories and the category suggestions from g_stato */
export function renderMateriali() {
  renderTabellaMateriali();
  renderCategorie();
  riempiDatalist(elemento('elenco-categorie'), categorieAttive().map((categoria) => categoria.nome));
}

/** @returns {void} */
function renderTabellaMateriali() {
  const visibili = filtraArticoli(g_stato.articoli, g_filtroDisciplina, g_testoRicerca);
  const righe = visibili.map((articolo) => {
    const codice = creaBottoneTesto(articolo.codice, () => apriSchedaMateriale(articolo.id));
    const materiale = articolo.marca ? `${articolo.descrizione} · ${articolo.marca}` : articolo.descrizione;
    return creaRiga([badgeDisciplina(articolo.disciplina), codice, materiale, articolo.taglia, articolo.quantita, articolo.disponibili, badgeStato(articolo.stato)], ['', '', '', '', 'cella-numero', 'cella-numero', '']);
  });
  riempiTabella(elemento('righe-materiali'), righe, elemento('vuoto-materiali'));
}

/**
 * @param {SubmitEvent} evento
 * @returns {Promise<void>}
 */
async function salvaNuovoMateriale(evento) {
  evento.preventDefault();
  const bottone = elemento('bottone-salva-materiale');
  const esito = elemento('esito-nuovo-materiale');
  bottone.disabled = true;
  try {
    const corpo = leggiFormNuovoMateriale();
    await creaArticolo(corpo);
    elemento('form-nuovo-materiale').reset();
    elemento('nuovo-stato').value = 'Buono';
    elemento('dialogo-nuovo-materiale').close();
    await g_alCambio();
    mostraMessaggio(elemento('esito-materiali'), `Materiale ${corpo.codice} inserito.`, 'ok');
  } catch (errore) {
    mostraMessaggio(esito, errore.message, 'errore');
  } finally {
    bottone.disabled = false;
  }
}

/**
 * Reads the "Nuovo materiale" form into the request body of POST /api/articoli.
 * @returns {object}
 */
function leggiFormNuovoMateriale() {
  const corpo = {};
  corpo.codice = elemento('nuovo-codice').value.trim();
  corpo.disciplina = elemento('nuovo-disciplina').value;
  corpo.categoria = elemento('nuovo-categoria').value.trim();
  corpo.descrizione = elemento('nuovo-descrizione').value.trim();
  corpo.marca = testoONull(elemento('nuovo-marca').value);
  corpo.modello = testoONull(elemento('nuovo-modello').value);
  corpo.taglia = testoONull(elemento('nuovo-taglia').value);
  corpo.seriale = testoONull(elemento('nuovo-seriale').value);
  corpo.quantita = Number(elemento('nuovo-quantita').value);
  corpo.valore = Number(elemento('nuovo-valore').value || 0);
  corpo.stato = elemento('nuovo-stato').value;
  corpo.note = testoONull(elemento('nuovo-note').value);
  return corpo;
}

/**
 * Opens the item card. Items not in the cache (deep link from a QR code to an
 * item created elsewhere) are fetched from the server.
 * @param {number} idArticolo
 * @returns {Promise<void>}
 */
export async function apriSchedaMateriale(idArticolo) {
  const esito = elemento('esito-materiali');
  try {
    const articolo = articoloPerId(idArticolo) ?? (await ottieniArticolo(idArticolo)).articolo;
    g_articoloAperto = articolo;
    elemento('titolo-dialogo-materiale').textContent = articolo.descrizione;
    elemento('sottotitolo-materiale').replaceChildren(badgeDisciplina(articolo.disciplina), document.createTextNode(` · ${articolo.codice} · ${articolo.categoria}`));
    const coppie = [['Marca', articolo.marca], ['Modello', articolo.modello], ['Misura', articolo.taglia], ['Seriale', articolo.seriale], ['Quantità', articolo.quantita], ['Disponibili', articolo.disponibili], ['Stato', badgeStato(articolo.stato)], ['Valore', euro(articolo.valore ?? 0)], ['Note', articolo.note]];
    riempiDettagli(elemento('dettagli-materiale'), coppie);
    elemento('qr-materiale').src = urlQrArticolo(articolo.id);
    mostraMessaggio(elemento('esito-scheda-materiale'), '');
    mostraMessaggio(esito, '');
    elemento('dialogo-materiale').showModal();
  } catch (errore) {
    mostraMessaggio(esito, errore.message, 'errore');
  }
}

/** @returns {Promise<void>} */
async function eliminaMaterialeAperto() {
  const esito = elemento('esito-scheda-materiale');
  if (!window.confirm(`Eliminare il materiale ${g_articoloAperto.codice}?`)) return;
  try {
    await eliminaArticolo(g_articoloAperto.id);
    elemento('dialogo-materiale').close();
    await g_alCambio();
    mostraMessaggio(elemento('esito-materiali'), 'Materiale eliminato.', 'ok');
  } catch (errore) {
    mostraMessaggio(esito, errore.message, 'errore');
  }
}

/* -------------------------------------------------------------- categorie */

/** @returns {void} */
function renderCategorie() {
  const righe = g_stato.categorie.map((categoria) => {
    const attiva = categoria.attiva === 1;
    const nome = document.createElement('strong');
    nome.textContent = categoria.nome;
    const stato = creaBadge(attiva ? 'Attiva' : 'Disattivata', attiva ? 'badge-attivo' : 'badge-disattivato');
    const azione = creaBottonePiccolo(attiva ? 'Disattiva' : 'Riattiva', () => cambiaStatoCategoria(categoria.id, !attiva), attiva ? 'btn-pericolo' : 'btn-ok');
    return creaRiga([nome, stato, azione], ['', '', 'cella-azioni']);
  });
  riempiTabella(elemento('righe-categorie'), righe, elemento('vuoto-categorie'));
}

/**
 * @param {SubmitEvent} evento
 * @returns {Promise<void>}
 */
async function aggiungiCategoria(evento) {
  evento.preventDefault();
  const campo = elemento('campo-nome-categoria');
  const esito = elemento('esito-categorie');
  try {
    const creata = await creaCategoria(campo.value);
    campo.value = '';
    await g_alCambio();
    mostraMessaggio(esito, `Categoria ${creata.nome} aggiunta.`, 'ok');
  } catch (errore) {
    mostraMessaggio(esito, errore.message, 'errore');
  }
}

/**
 * @param {number} idCategoria
 * @param {boolean} attiva - new state
 * @returns {Promise<void>}
 */
async function cambiaStatoCategoria(idCategoria, attiva) {
  const esito = elemento('esito-categorie');
  try {
    await impostaCategoriaAttiva(idCategoria, attiva);
    await g_alCambio();
    mostraMessaggio(esito, '');
  } catch (errore) {
    mostraMessaggio(esito, errore.message, 'errore');
  }
}
