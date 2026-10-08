/*
 * vista-home.js — Home section: the two warehouse cards with their numbers
 * and, once a warehouse is entered, its dashboard (stat tiles, shortcuts to
 * the other sections already filtered, last movements).
 */
import { TESTO_DISCIPLINA, ULTIMI_MOVIMENTI } from './constants.js';
import { g_stato } from './stato.js';
import { badgeTipoMovimento, creaRiga, mostraMessaggio, riempiTabella } from './ui.js';
import { dataItaliana, nomeArticolo } from './utils.js';

/** @type {(id: string) => HTMLElement} */
const elemento = (id) => document.getElementById(id);

/** @type {string|null} warehouse shown in the dashboard view, null = cards view */
let g_magazzinoAperto = null;

/**
 * @type {{alMateriali: (disciplina: string) => void, alMovimento: (disciplina: string) => void, alStorico: (disciplina: string) => void, agliAtleti: () => void}|null}
 * cross-section shortcuts of the warehouse dashboard, provided by app.js
 */
let g_azioni = null;

/**
 * @param {{alMateriali: (disciplina: string) => void, alMovimento: (disciplina: string) => void, alStorico: (disciplina: string) => void, agliAtleti: () => void}} azioni
 * @returns {void}
 */
export function preparaHome(azioni) {
  g_azioni = azioni;
  for (const bottone of document.querySelectorAll('.btn-magazzino')) {
    bottone.addEventListener('click', () => apriMagazzino(bottone.dataset.disciplina));
  }
  elemento('bottone-cambia-magazzino').addEventListener('click', chiudiMagazzino);
  elemento('mag-azione-materiali').addEventListener('click', () => g_azioni.alMateriali(g_magazzinoAperto));
  elemento('mag-azione-movimento').addEventListener('click', () => g_azioni.alMovimento(g_magazzinoAperto));
  elemento('mag-azione-storico').addEventListener('click', () => g_azioni.alStorico(g_magazzinoAperto));
  elemento('mag-azione-atleti').addEventListener('click', () => g_azioni.agliAtleti());
}

/** @returns {void} re-renders cards and, if open, the warehouse dashboard from g_stato */
export function renderHome() {
  const magazzini = g_stato.riepilogo?.magazzini ?? {};
  for (const disciplina of ['Ghiaccio', 'Corsa']) {
    const numeri = magazzini[disciplina] ?? { articoli: 0, disponibili: 0, assegnati: 0 };
    const prefisso = disciplina.toLowerCase();
    elemento(`${prefisso}-articoli`).textContent = String(numeri.articoli);
    elemento(`${prefisso}-disponibili`).textContent = String(numeri.disponibili);
    elemento(`${prefisso}-assegnati`).textContent = String(numeri.assegnati);
  }
  if (g_magazzinoAperto !== null) renderMagazzino();
}

/**
 * Shows the dashboard of a warehouse in place of the cards.
 * @param {string} disciplina - 'Ghiaccio' | 'Corsa'
 * @param {string} [messaggio] - optional confirmation to show on top (e.g. after a movement)
 * @returns {void}
 */
export function apriMagazzino(disciplina, messaggio = '') {
  g_magazzinoAperto = disciplina;
  const testata = elemento('testata-magazzino');
  testata.classList.toggle('ghiaccio', disciplina === 'Ghiaccio');
  testata.classList.toggle('corsa', disciplina === 'Corsa');
  elemento('titolo-magazzino').textContent = TESTO_DISCIPLINA[disciplina];
  elemento('titolo-ultimi-movimenti').textContent = `Ultime movimentazioni · ${disciplina}`;
  mostraMessaggio(elemento('esito-magazzino'), messaggio, messaggio ? 'ok' : '');
  renderMagazzino();
  elemento('vista-magazzini').hidden = true;
  elemento('vista-magazzino').hidden = false;
}

/** @returns {void} back to the two cards */
function chiudiMagazzino() {
  g_magazzinoAperto = null;
  elemento('vista-magazzino').hidden = true;
  elemento('vista-magazzini').hidden = false;
}

/** @returns {void} stat tiles and last movements of the open warehouse */
function renderMagazzino() {
  const numeri = g_stato.riepilogo?.magazzini?.[g_magazzinoAperto] ?? { articoli: 0, disponibili: 0, assegnati: 0, da_riparare: 0 };
  elemento('mag-articoli').textContent = String(numeri.articoli);
  elemento('mag-disponibili').textContent = String(numeri.disponibili);
  elemento('mag-assegnati').textContent = String(numeri.assegnati);
  elemento('mag-da-riparare').textContent = String(numeri.da_riparare);

  const recenti = g_stato.movimenti.filter((movimento) => movimento.disciplina === g_magazzinoAperto).slice(0, ULTIMI_MOVIMENTI);
  const righe = recenti.map((movimento) => creaRiga([dataItaliana(movimento.data), badgeTipoMovimento(movimento.tipo), movimento.categoria, nomeArticolo(movimento), movimento.atleta, movimento.quantita], ['', '', '', '', '', 'cella-numero']));
  riempiTabella(elemento('righe-ultimi-movimenti'), righe, elemento('vuoto-ultimi-movimenti'));
}
