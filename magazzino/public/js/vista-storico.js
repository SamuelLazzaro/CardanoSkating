/*
 * vista-storico.js — Storico section: the movement history (latest 500 rows
 * from the server) filtered on the client by warehouse and free text, with
 * the CSV export link.
 */
import { g_stato } from './stato.js';
import { badgeDisciplina, badgeTipoMovimento, creaBottoneTesto, creaRiga, preparaFiltro, riempiTabella } from './ui.js';
import { dataItaliana, filtraMovimenti, nomeArticolo } from './utils.js';

/** @type {(id: string) => HTMLElement} */
const elemento = (id) => document.getElementById(id);

/** @type {string} warehouse filter: 'Ghiaccio' | 'Corsa' | '' (all) */
let g_filtroDisciplina = '';

/** @type {string} free text filter on marca and modello */
let g_testoRicerca = '';

/** @type {{imposta: (valore: string) => void}|null} segmented filter control */
let g_filtro = null;

/** @type {((idArticolo: number) => void)|null} opens the item card popup */
let g_allaScheda = null;

/**
 * @param {{allaScheda: (idArticolo: number) => void}} opzioni
 * @returns {void}
 */
export function preparaStorico({ allaScheda }) {
  g_allaScheda = allaScheda;
  g_filtro = preparaFiltro(elemento('filtro-storico'), (valore) => {
    g_filtroDisciplina = valore;
    renderStorico();
  });
  elemento('ricerca-storico').addEventListener('input', (evento) => {
    g_testoRicerca = evento.target.value;
    renderStorico();
  });
}

/**
 * Sets the warehouse filter from outside (warehouse dashboard shortcut).
 * @param {string} disciplina - 'Ghiaccio' | 'Corsa' | ''
 * @returns {void}
 */
export function impostaFiltroStorico(disciplina) {
  g_filtro.imposta(disciplina);
}

/** @returns {void} table of movements from g_stato */
export function renderStorico() {
  const visibili = filtraMovimenti(g_stato.movimenti, g_filtroDisciplina, g_testoRicerca);
  const righe = visibili.map((movimento) => {
    const materiale = creaBottoneTesto(nomeArticolo(movimento), () => g_allaScheda(movimento.articolo_id));
    return creaRiga([dataItaliana(movimento.data), badgeDisciplina(movimento.disciplina), badgeTipoMovimento(movimento.tipo), movimento.categoria, materiale, movimento.atleta, movimento.quantita, movimento.operatore], ['', '', '', '', '', '', 'cella-numero', '']);
  });
  riempiTabella(elemento('righe-storico'), righe, elemento('vuoto-storico'));
}
