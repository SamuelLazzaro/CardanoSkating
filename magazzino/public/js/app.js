/*
 * app.js — entry point of the gestionale. Shows the login form (user dropdown
 * plus password) until a session cookie is present, then loads the shared
 * state (js/stato.js) and wires the five sections behind the nav
 * (js/navigazione.js): Home with the two warehouses, Atleti, Materiali,
 * Movimento and Storico. After every change one reload of the state
 * re-renders all the sections.
 */
import { avviaTapFeedback } from './tap-feedback.js';
import { PARAMETRO_ARTICOLO } from './constants.js';
import { accedi, esci, ottieniProfilo, ottieniUtenti } from './api.js';
import { mostraMessaggio, riempiSelect } from './ui.js';
import { mostraSezione, preparaNavigazione } from './navigazione.js';
import { ricaricaStato } from './stato.js';
import { apriMagazzino, preparaHome, renderHome } from './vista-home.js';
import { preparaAtleti, renderAtleti } from './vista-atleti.js';
import { apriSchedaMateriale, impostaFiltroMateriali, preparaMateriali, renderMateriali } from './vista-materiali.js';
import { impostaMovimento, preparaMovimento, renderMovimento } from './vista-movimento.js';
import { impostaFiltroStorico, preparaStorico, renderStorico } from './vista-storico.js';

// First thing on every page: its capture listener must precede all others.
avviaTapFeedback();

/** @type {(id: string) => HTMLElement} */
const elemento = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ init */

/** @returns {Promise<void>} */
async function avvia() {
  preparaEventi();
  try {
    const profilo = await ottieniProfilo();
    await mostraApp(profilo.utente);
  } catch (errore) {
    if (errore.status === 401) {
      await mostraLogin();
    } else {
      mostraMessaggio(elemento('vista-caricamento'), errore.message, 'errore');
    }
  }
}

/** @returns {void} registers all static event listeners once */
function preparaEventi() {
  elemento('form-login').addEventListener('submit', accediDaForm);
  elemento('bottone-esci').addEventListener('click', esciDalPannello);
  preparaNavigazione(elemento('nav-sezioni'));

  preparaHome({ alMateriali, alMovimento, alStorico, agliAtleti });
  preparaAtleti({ alCambio: ricaricaERender });
  preparaMateriali({ alCambio: ricaricaERender, alMovimentoPerArticolo });
  preparaMovimento({ alRegistrato });
  preparaStorico({ allaScheda: apriSchedaMateriale });
}

/* ------------------------------------------- collegamenti fra le sezioni */

/**
 * @param {string} idSezione
 * @returns {void}
 */
function vaiA(idSezione) {
  mostraSezione(elemento('nav-sezioni'), idSezione);
}

/**
 * Warehouse dashboard → materials list of that warehouse.
 * @param {string} disciplina
 * @returns {void}
 */
function alMateriali(disciplina) {
  impostaFiltroMateriali(disciplina);
  vaiA('sezione-materiali');
}

/**
 * Warehouse dashboard → movement form on that warehouse.
 * @param {string} disciplina
 * @returns {void}
 */
function alMovimento(disciplina) {
  impostaMovimento({ disciplina });
  vaiA('sezione-movimento');
}

/**
 * Warehouse dashboard → history of that warehouse.
 * @param {string} disciplina
 * @returns {void}
 */
function alStorico(disciplina) {
  impostaFiltroStorico(disciplina);
  vaiA('sezione-storico');
}

/** @returns {void} */
function agliAtleti() {
  vaiA('sezione-atleti');
}

/**
 * Item card → movement form with that item already selected.
 * @param {number} idArticolo
 * @returns {void}
 */
function alMovimentoPerArticolo(idArticolo) {
  impostaMovimento({ articoloId: idArticolo });
  vaiA('sezione-movimento');
}

/**
 * After a movement, like the original gestionale: back to the dashboard of
 * the warehouse it belongs to, with the confirmation on top.
 * @param {string} disciplina
 * @returns {Promise<void>}
 */
async function alRegistrato(disciplina) {
  await ricaricaERender();
  apriMagazzino(disciplina, 'Movimento registrato.');
  vaiA('sezione-home');
}

/* ----------------------------------------------------------------- login */

/**
 * Fills the user dropdown from the server and shows the login form.
 * @returns {Promise<void>}
 */
async function mostraLogin() {
  const { utenti } = await ottieniUtenti();
  riempiSelect(elemento('campo-utente'), utenti);
  elemento('vista-caricamento').hidden = true;
  elemento('vista-login').hidden = false;
  elemento('campo-password').focus();
}

/**
 * @param {SubmitEvent} evento - login form submit
 * @returns {Promise<void>}
 */
async function accediDaForm(evento) {
  evento.preventDefault();
  const bottone = elemento('bottone-entra');
  bottone.disabled = true;
  try {
    const esito = await accedi(elemento('campo-utente').value, elemento('campo-password').value);
    elemento('campo-password').value = '';
    mostraMessaggio(elemento('esito-login'), '');
    elemento('vista-login').hidden = true;
    elemento('vista-caricamento').hidden = false;
    await mostraApp(esito.utente);
  } catch (errore) {
    elemento('vista-caricamento').hidden = true;
    elemento('vista-login').hidden = false;
    mostraMessaggio(elemento('esito-login'), errore.message, 'errore');
  } finally {
    bottone.disabled = false;
  }
}

/** @returns {Promise<void>} */
async function esciDalPannello() {
  try {
    await esci();
  } finally {
    window.location.replace(window.location.pathname);
  }
}

/* ------------------------------------------------------------- pannello */

/**
 * Loads the shared state and reveals the authenticated view. A QR code adds
 * ?articolo=<id> to the address: that item's card opens right away.
 * @param {string} utente - canonical name of the logged-in user
 * @returns {Promise<void>}
 */
async function mostraApp(utente) {
  await ricaricaStato();
  renderTutto();
  elemento('utente-corrente').textContent = utente;
  elemento('utente-corrente').hidden = false;
  elemento('bottone-esci').hidden = false;
  elemento('vista-caricamento').hidden = true;
  elemento('vista-app').hidden = false;
  elemento('nav-sezioni').hidden = false;
  await apriSchedaDaIndirizzo();
}

/**
 * Reloads the shared state and re-renders every section; on a lost session
 * the page restarts from the login.
 * @returns {Promise<void>}
 */
async function ricaricaERender() {
  try {
    await ricaricaStato();
  } catch (errore) {
    if (errore.status === 401) window.location.reload();
    throw errore;
  }
  renderTutto();
}

/** @returns {void} */
function renderTutto() {
  renderHome();
  renderAtleti();
  renderMateriali();
  renderMovimento();
  renderStorico();
}

/** @returns {Promise<void>} opens the item card named by the QR code parameter, if any */
async function apriSchedaDaIndirizzo() {
  const parametri = new URLSearchParams(window.location.search);
  const idArticolo = Number(parametri.get(PARAMETRO_ARTICOLO));
  if (!Number.isInteger(idArticolo) || idArticolo <= 0) return;
  mostraSezione(elemento('nav-sezioni'), 'sezione-materiali');
  await apriSchedaMateriale(idArticolo);
  // the parameter has done its job: a reload must not reopen the card
  window.history.replaceState(null, '', window.location.pathname);
}

avvia();
