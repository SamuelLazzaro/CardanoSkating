/*
 * calendario.js — entry point of the public page. Shows occupied/free
 * 30-minute slots (no società names on purpose) with week navigation. The
 * selected week is mirrored into the ?settimana= query string so the view is
 * shareable.
 */
import { avviaTapFeedback } from './tap-feedback.js';
import { PASSO_MIN } from './constants.js';
import {
  adessoRoma,
  aggiungiGiorni,
  chiaveSlot,
  dataValida,
  etichettaGiorno,
  giorniSettimana,
  lunediDellaSettimana,
  oraTesto,
  titoloSettimana,
} from './utils.js';
import { ottieniCalendario } from './api.js';
import { costruisciGriglia, mostraMessaggio } from './ui.js';

// First thing on every page: its capture listener must precede all others.
avviaTapFeedback();

const griglia = document.getElementById('griglia');
const titolo = document.getElementById('titolo-settimana');
const stato = document.getElementById('stato');
const bottonePrecedente = document.getElementById('settimana-precedente');
const bottoneSuccessiva = document.getElementById('settimana-successiva');
const bottoneOggi = document.getElementById('vai-oggi');

/** @type {string} Monday of the week being shown */
let g_lunediCorrente = lunediIniziale();

/** @type {number} counter to ignore stale responses on fast navigation */
let g_versioneRichiesta = 0;

/**
 * @returns {string} initial Monday: from ?settimana= when valid, else today
 */
function lunediIniziale() {
  const parametro = new URLSearchParams(location.search).get('settimana');
  const base = parametro && dataValida(parametro) ? parametro : adessoRoma().data;
  return lunediDellaSettimana(base);
}

/**
 * @param {string[]} slotOccupati - occupied slot keys of the week
 * @returns {void}
 */
function renderGriglia(slotOccupati) {
  const occupati = new Set(slotOccupati);
  const adesso = adessoRoma();
  // A "past" slot is one entirely over; the slot in progress stays normal.
  const chiaveAdesso = chiaveSlot(adesso.data, Math.floor(adesso.minuti / PASSO_MIN) * PASSO_MIN);

  costruisciGriglia(
    griglia,
    giorniSettimana(g_lunediCorrente),
    (cella, giorno, minuti) => {
      const chiave = chiaveSlot(giorno, minuti);
      const occupato = occupati.has(chiave);
      if (occupato) cella.classList.add('occupato');
      if (chiave < chiaveAdesso) cella.classList.add('passato');
      if (giorno === adesso.data) cella.classList.add('colonna-oggi');
      const etichetta = etichettaGiorno(giorno);
      cella.title = `${etichetta.nomeGiorno} ${etichetta.dataBreve} · ${oraTesto(minuti)}–${oraTesto(minuti + PASSO_MIN)} · ${occupato ? 'occupato' : 'libero'}`;
    },
    (testata, giorno) => {
      if (giorno === adesso.data) testata.classList.add('oggi');
    },
  );
}

/** @returns {Promise<void>} loads and renders the selected week */
async function carica() {
  const versione = ++g_versioneRichiesta;
  titolo.textContent = titoloSettimana(g_lunediCorrente);
  bottoneOggi.disabled = g_lunediCorrente === lunediDellaSettimana(adessoRoma().data);
  history.replaceState(null, '', `?settimana=${g_lunediCorrente}`);
  mostraMessaggio(stato, 'Caricamento…');
  try {
    const dati = await ottieniCalendario(g_lunediCorrente);
    if (versione !== g_versioneRichiesta) return; // a newer request is running
    renderGriglia(dati.slot_occupati);
    mostraMessaggio(stato, '');
  } catch (errore) {
    if (versione !== g_versioneRichiesta) return;
    mostraMessaggio(stato, errore.message, 'errore');
  }
}

bottonePrecedente.addEventListener('click', () => {
  g_lunediCorrente = aggiungiGiorni(g_lunediCorrente, -7);
  carica();
});

bottoneSuccessiva.addEventListener('click', () => {
  g_lunediCorrente = aggiungiGiorni(g_lunediCorrente, 7);
  carica();
});

bottoneOggi.addEventListener('click', () => {
  g_lunediCorrente = lunediDellaSettimana(adessoRoma().data);
  carica();
});

carica();
