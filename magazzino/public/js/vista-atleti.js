/*
 * vista-atleti.js — Atleti section: add form, list with activate/deactivate,
 * and the athlete card popup (items currently held + personal history).
 */
import { creaAtleta, impostaAtletaAttivo, ottieniAtleta } from './api.js';
import { g_stato } from './stato.js';
import { badgeTipoMovimento, creaBadge, creaBottonePiccolo, creaBottoneTesto, creaRiga, mostraMessaggio, preparaDialogo, riempiTabella } from './ui.js';
import { dataItaliana } from './utils.js';

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
  elemento('form-atleta').addEventListener('submit', aggiungiAtleta);
  preparaDialogo(elemento('dialogo-atleta'), elemento('bottone-chiudi-atleta'));
}

/** @returns {void} table of athletes from g_stato */
export function renderAtleti() {
  const righe = g_stato.atleti.map((atleta) => {
    const attivo = atleta.attivo === 1;
    const nome = creaBottoneTesto(atleta.nome, () => apriSchedaAtleta(atleta.id));
    const stato = creaBadge(attivo ? 'Attivo' : 'Disattivato', attivo ? 'badge-attivo' : 'badge-disattivato');
    const azione = creaBottonePiccolo(attivo ? 'Disattiva' : 'Riattiva', () => cambiaStatoAtleta(atleta.id, !attivo), attivo ? '' : 'btn-ok');
    return creaRiga([nome, stato, azione], ['', '', 'cella-azioni']);
  });
  riempiTabella(elemento('righe-atleti'), righe, elemento('vuoto-atleti'));
}

/**
 * @param {SubmitEvent} evento
 * @returns {Promise<void>}
 */
async function aggiungiAtleta(evento) {
  evento.preventDefault();
  const campo = elemento('campo-nome-atleta');
  const esito = elemento('esito-atleti');
  try {
    const creato = await creaAtleta(campo.value);
    campo.value = '';
    await g_alCambio();
    mostraMessaggio(esito, `Atleta ${creato.nome} aggiunto.`, 'ok');
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
 * Opens the athlete card popup with fresh data from the server.
 * @param {number} idAtleta
 * @returns {Promise<void>}
 */
async function apriSchedaAtleta(idAtleta) {
  const esito = elemento('esito-atleti');
  try {
    const scheda = await ottieniAtleta(idAtleta);
    elemento('titolo-dialogo-atleta').textContent = scheda.atleta.nome;
    renderAssegnati(scheda.assegnati);
    renderStoricoAtleta(scheda.storico);
    mostraMessaggio(esito, '');
    elemento('dialogo-atleta').showModal();
  } catch (errore) {
    mostraMessaggio(esito, errore.message, 'errore');
  }
}

/**
 * @param {{codice: string, descrizione: string, taglia: string|null, stato: string, in_possesso: number}[]} assegnati
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
    titolo.textContent = `${articolo.codice} · ${articolo.descrizione}`;
    const dettaglio = document.createElement('span');
    dettaglio.className = 'testo-tenue';
    dettaglio.textContent = `Quantità ${articolo.in_possesso} · ${articolo.taglia ?? '—'} · ${articolo.stato}`;
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
  const righe = storico.map((movimento) => creaRiga([dataItaliana(movimento.data), badgeTipoMovimento(movimento.tipo), `${movimento.codice} · ${movimento.descrizione}`, movimento.quantita, movimento.condizione, movimento.firma_presente ? '✓' : '—'], ['', '', '', 'cella-numero', '', '']));
  riempiTabella(elemento('righe-storico-atleta'), righe, elemento('vuoto-storico-atleta'));
}
