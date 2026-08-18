/*
 * area.js — entry point of the società reserved area. Requires the session
 * cookie set by the personal link (/accesso/<token>): without it the APIs
 * answer 401 and the page falls back to an "access reserved" message.
 */
import { avviaTapFeedback } from './tap-feedback.js';
import {
  APERTURA_MIN,
  CHIUSURA_MIN,
  MAX_SETTIMANE_RICORRENZA,
  NOMI_GIORNI,
  PASSO_MIN,
} from './constants.js';
import {
  adessoRoma,
  aggiungiGiorni,
  chiaveSlot,
  dataEstesa,
  espandiSlot,
  etichettaGiorno,
  giorniSettimana,
  lunediDellaSettimana,
  oraTesto,
  titoloSettimana,
} from './utils.js';
import {
  annullaRicorrenza,
  annullaRichiesta,
  esciSocieta,
  inviaRichiestaPrenotazione,
  ottieniCalendario,
  ottieniProfiloSocieta,
  ottieniRichiesteSocieta,
} from './api.js';
import { costruisciGriglia, creaBadge, mostraMessaggio } from './ui.js';

// First thing on every page: its capture listener must precede all others.
avviaTapFeedback();

/** @type {(id: string) => HTMLElement} */
const elemento = (id) => document.getElementById(id);

/** @type {string} Monday of the week shown in the calendar panel */
let g_lunediArea = lunediDellaSettimana(adessoRoma().data);

/** @type {object[]} cached richieste of the società (used to highlight slots) */
let g_richieste = [];

/** @type {number} counter to ignore stale calendar responses */
let g_versioneCalendario = 0;

/* ------------------------------------------------------------------ init */

/** @returns {Promise<void>} */
async function avvia() {
  let profilo;
  try {
    profilo = await ottieniProfiloSocieta();
  } catch (errore) {
    elemento('vista-caricamento').hidden = true;
    if (errore.status === 401) {
      elemento('vista-negato').hidden = false;
    } else {
      mostraMessaggio(elemento('vista-caricamento'), errore.message, 'errore');
      elemento('vista-caricamento').hidden = false;
    }
    return;
  }

  elemento('sottotitolo-societa').textContent = profilo.societa.nome;
  elemento('campo-link-ics').value = profilo.link_ics;
  elemento('bottone-esci').hidden = false;

  preparaForm();
  await caricaRichieste();
  await caricaCalendario();

  elemento('vista-caricamento').hidden = true;
  elemento('vista-area').hidden = false;
}

/* ------------------------------------------------------------------ form */

/** @returns {void} populates the time selects and sets the date limits */
function preparaForm() {
  const selettoreInizio = elemento('campo-inizio');
  const selettoreFine = elemento('campo-fine');
  for (let minuti = APERTURA_MIN; minuti < CHIUSURA_MIN; minuti += PASSO_MIN) {
    selettoreInizio.append(new Option(oraTesto(minuti), oraTesto(minuti)));
    selettoreFine.append(new Option(oraTesto(minuti + PASSO_MIN), oraTesto(minuti + PASSO_MIN)));
  }
  selettoreInizio.value = '18:00';
  selettoreFine.value = '19:00';

  // Keep the interval consistent: the end must always follow the start.
  selettoreInizio.addEventListener('change', () => {
    if (selettoreFine.value <= selettoreInizio.value) {
      const [ore, minuti] = selettoreInizio.value.split(':').map(Number);
      selettoreFine.value = oraTesto(ore * 60 + minuti + PASSO_MIN);
    }
  });

  const oggi = adessoRoma().data;
  const campoData = elemento('campo-data');
  campoData.min = oggi;
  campoData.max = aggiungiGiorni(oggi, 365);
  campoData.value = aggiungiGiorni(oggi, 1);
  campoData.addEventListener('change', aggiornaLimitiRipetizione);

  const casellaRipeti = elemento('campo-ripeti');
  casellaRipeti.addEventListener('change', () => {
    elemento('blocco-fino-al').hidden = !casellaRipeti.checked;
    elemento('campo-fino-al').required = casellaRipeti.checked;
    aggiornaLimitiRipetizione();
  });

  elemento('form-richiesta').addEventListener('submit', inviaForm);
  elemento('bottone-esci').addEventListener('click', esci);
  elemento('bottone-copia').addEventListener('click', copiaLinkIcs);
  elemento('cal-precedente').addEventListener('click', () => spostaSettimana(-7));
  elemento('cal-successiva').addEventListener('click', () => spostaSettimana(7));
  elemento('cal-oggi').addEventListener('click', () => {
    g_lunediArea = lunediDellaSettimana(adessoRoma().data);
    caricaCalendario();
  });
}

/** @returns {void} keeps the "fino al" limits tied to the chosen date */
function aggiornaLimitiRipetizione() {
  const dataScelta = elemento('campo-data').value;
  const campoFinoAl = elemento('campo-fino-al');
  if (!dataScelta) return;
  campoFinoAl.min = aggiungiGiorni(dataScelta, 7);
  campoFinoAl.max = aggiungiGiorni(dataScelta, (MAX_SETTIMANE_RICORRENZA - 1) * 7);
  if (campoFinoAl.value && (campoFinoAl.value < campoFinoAl.min || campoFinoAl.value > campoFinoAl.max)) {
    campoFinoAl.value = campoFinoAl.max;
  }
}

/**
 * @param {SubmitEvent} evento - form submit event
 * @returns {Promise<void>}
 */
async function inviaForm(evento) {
  evento.preventDefault();
  const esitoForm = elemento('esito-form');
  const corpo = {
    data: elemento('campo-data').value,
    ora_inizio: elemento('campo-inizio').value,
    ora_fine: elemento('campo-fine').value,
    note: elemento('campo-note').value.trim(),
  };
  if (!corpo.data) {
    mostraMessaggio(esitoForm, 'Scegli una data', 'errore');
    return;
  }
  if (elemento('campo-ripeti').checked) {
    const finoAl = elemento('campo-fino-al').value;
    if (!finoAl) {
      mostraMessaggio(esitoForm, 'Scegli fino a quando ripetere la richiesta', 'errore');
      return;
    }
    corpo.ripeti_fino_al = finoAl;
  }

  const bottone = elemento('bottone-invia');
  bottone.disabled = true;
  try {
    const esito = await inviaRichiestaPrenotazione(corpo);
    if (esito.tipo === 'ricorrenza') {
      const dateLeggibili = esito.occorrenze.map(dataEstesa).join(', ');
      mostraMessaggio(esitoForm, `Richiesta ricorrente inviata (${esito.occorrenze.length} date: ${dateLeggibili}). In attesa di approvazione.`, 'ok');
    } else {
      mostraMessaggio(esitoForm, 'Richiesta inviata: in attesa di approvazione.', 'ok');
    }
    elemento('campo-note').value = '';
    elemento('campo-ripeti').checked = false;
    elemento('blocco-fino-al').hidden = true;
    elemento('campo-fino-al').required = false;
    await caricaRichieste();
    await caricaCalendario();
  } catch (errore) {
    mostraMessaggio(esitoForm, errore.message, 'errore');
  } finally {
    bottone.disabled = false;
  }
}

/* ----------------------------------------------------------------- liste */

/** @returns {Promise<void>} reloads richieste + ricorrenze and renders the lists */
async function caricaRichieste() {
  const dati = await ottieniRichiesteSocieta();
  g_richieste = dati.richieste;
  renderRichieste(dati.richieste);
  renderRicorrenze(dati.ricorrenze);
}

/**
 * @param {object} richiesta - richiesta row from the API
 * @param {boolean} conAnnulla - whether to show the cancel button
 * @returns {HTMLLIElement}
 */
function creaRigaRichiesta(richiesta, conAnnulla) {
  const riga = document.createElement('li');
  const info = document.createElement('div');
  info.className = 'riga-info';

  const dataForte = document.createElement('strong');
  dataForte.textContent = dataEstesa(richiesta.data);
  const orario = document.createElement('span');
  orario.textContent = `${richiesta.ora_inizio}–${richiesta.ora_fine}`;
  info.append(dataForte, orario, creaBadge(richiesta.stato));

  if (richiesta.ricorrenza_id !== null) {
    const settimanale = document.createElement('span');
    settimanale.className = 'testo-tenue';
    settimanale.textContent = 'ricorrente';
    info.append(settimanale);
  }
  riga.append(info);

  if (richiesta.note) {
    const nota = document.createElement('p');
    nota.className = 'riga-nota';
    nota.textContent = richiesta.note;
    riga.append(nota);
  }

  if (conAnnulla) {
    const bottone = document.createElement('button');
    bottone.type = 'button';
    bottone.className = 'btn btn-pericolo';
    bottone.textContent = 'Annulla';
    bottone.addEventListener('click', () => annulla(richiesta));
    riga.append(bottone);
  }
  return riga;
}

/**
 * @param {object[]} richieste - all richieste of the società
 * @returns {void}
 */
function renderRichieste(richieste) {
  const adesso = adessoRoma();
  const eFutura = (richiesta) =>
    richiesta.data > adesso.data || (richiesta.data === adesso.data && richiesta.ora_inizio > adesso.ora);
  const eAttiva = (richiesta) =>
    (richiesta.stato === 'in_attesa' || richiesta.stato === 'approvata') && eFutura(richiesta);

  const inProgramma = richieste.filter(eAttiva)
    .sort((a, b) => (a.data + a.ora_inizio).localeCompare(b.data + b.ora_inizio));
  const storico = richieste.filter((richiesta) => !eAttiva(richiesta))
    .sort((a, b) => (b.data + b.ora_inizio).localeCompare(a.data + a.ora_inizio))
    .slice(0, 15);

  const listaProgramma = elemento('lista-programma');
  listaProgramma.textContent = '';
  for (const richiesta of inProgramma) listaProgramma.append(creaRigaRichiesta(richiesta, true));
  elemento('vuoto-programma').hidden = inProgramma.length > 0;

  const listaStorico = elemento('lista-storico');
  listaStorico.textContent = '';
  for (const richiesta of storico) listaStorico.append(creaRigaRichiesta(richiesta, false));
  elemento('vuoto-storico').hidden = storico.length > 0;
}

/**
 * @param {object[]} ricorrenze - ricorrenze of the società
 * @returns {void}
 */
function renderRicorrenze(ricorrenze) {
  const lista = elemento('lista-ricorrenze');
  lista.textContent = '';
  for (const ricorrenza of ricorrenze) {
    const riga = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'riga-info';

    const giornoForte = document.createElement('strong');
    giornoForte.textContent = `Ogni ${NOMI_GIORNI[ricorrenza.giorno_settimana]}`;
    const orario = document.createElement('span');
    orario.textContent = `${ricorrenza.ora_inizio}–${ricorrenza.ora_fine}`;
    const periodo = document.createElement('span');
    periodo.className = 'testo-tenue';
    periodo.textContent = `dal ${dataEstesa(ricorrenza.valida_dal)} al ${dataEstesa(ricorrenza.valida_al)}`;
    info.append(giornoForte, orario, periodo, creaBadge(ricorrenza.stato));
    riga.append(info);

    if (ricorrenza.note) {
      const nota = document.createElement('p');
      nota.className = 'riga-nota';
      nota.textContent = ricorrenza.note;
      riga.append(nota);
    }

    if (ricorrenza.stato === 'in_attesa') {
      const bottone = document.createElement('button');
      bottone.type = 'button';
      bottone.className = 'btn btn-pericolo';
      bottone.textContent = 'Annulla';
      bottone.addEventListener('click', () => annullaSerie(ricorrenza));
      riga.append(bottone);
    }
    lista.append(riga);
  }
  elemento('vuoto-ricorrenze').hidden = ricorrenze.length > 0;
}

/**
 * @param {object} richiesta - richiesta to cancel
 * @returns {Promise<void>}
 */
async function annulla(richiesta) {
  const conferma = confirm(`Annullare la richiesta di ${dataEstesa(richiesta.data)} ${richiesta.ora_inizio}–${richiesta.ora_fine}?`);
  if (!conferma) return;
  try {
    await annullaRichiesta(richiesta.id);
    mostraMessaggio(elemento('esito-azioni'), 'Richiesta annullata.', 'ok');
    await caricaRichieste();
    await caricaCalendario();
  } catch (errore) {
    mostraMessaggio(elemento('esito-azioni'), errore.message, 'errore');
  }
}

/**
 * @param {object} ricorrenza - pending ricorrenza to cancel
 * @returns {Promise<void>}
 */
async function annullaSerie(ricorrenza) {
  const conferma = confirm(`Annullare la richiesta ricorrente di ogni ${NOMI_GIORNI[ricorrenza.giorno_settimana]} ${ricorrenza.ora_inizio}–${ricorrenza.ora_fine}?`);
  if (!conferma) return;
  try {
    await annullaRicorrenza(ricorrenza.id);
    mostraMessaggio(elemento('esito-azioni'), 'Richiesta ricorrente annullata.', 'ok');
    await caricaRichieste();
  } catch (errore) {
    mostraMessaggio(elemento('esito-azioni'), errore.message, 'errore');
  }
}

/* ------------------------------------------------------------- calendario */

/**
 * @param {number} giorni - +7 or -7
 * @returns {void}
 */
function spostaSettimana(giorni) {
  g_lunediArea = aggiungiGiorni(g_lunediArea, giorni);
  caricaCalendario();
}

/** @returns {Set<string>} slot keys of the società's approved richieste in the shown week */
function mieiSlotSettimana() {
  const fineSettimana = aggiungiGiorni(g_lunediArea, 7);
  const chiavi = new Set();
  for (const richiesta of g_richieste) {
    if (richiesta.stato !== 'approvata') continue;
    if (richiesta.data < g_lunediArea || richiesta.data >= fineSettimana) continue;
    for (const chiave of espandiSlot(richiesta.data, richiesta.ora_inizio, richiesta.ora_fine)) {
      chiavi.add(chiave);
    }
  }
  return chiavi;
}

/** @returns {Promise<void>} loads and renders the calendar week */
async function caricaCalendario() {
  const versione = ++g_versioneCalendario;
  elemento('cal-titolo').textContent = titoloSettimana(g_lunediArea);
  elemento('cal-oggi').disabled = g_lunediArea === lunediDellaSettimana(adessoRoma().data);
  const statoCalendario = elemento('cal-stato');
  mostraMessaggio(statoCalendario, 'Caricamento…');
  try {
    const dati = await ottieniCalendario(g_lunediArea);
    if (versione !== g_versioneCalendario) return;
    renderCalendario(new Set(dati.slot_occupati), mieiSlotSettimana());
    mostraMessaggio(statoCalendario, '');
  } catch (errore) {
    if (versione !== g_versioneCalendario) return;
    mostraMessaggio(statoCalendario, errore.message, 'errore');
  }
}

/**
 * @param {Set<string>} occupati - all occupied slot keys of the week
 * @param {Set<string>} miei - slot keys belonging to this società
 * @returns {void}
 */
function renderCalendario(occupati, miei) {
  const adesso = adessoRoma();
  const chiaveAdesso = chiaveSlot(adesso.data, Math.floor(adesso.minuti / PASSO_MIN) * PASSO_MIN);

  costruisciGriglia(
    elemento('cal-griglia'),
    giorniSettimana(g_lunediArea),
    (cella, giorno, minuti) => {
      const chiave = chiaveSlot(giorno, minuti);
      const mio = miei.has(chiave);
      const occupato = occupati.has(chiave);
      let descrizione = 'libero';
      if (mio) {
        cella.classList.add('mio');
        descrizione = 'la tua prenotazione';
      } else if (occupato) {
        cella.classList.add('occupato');
        descrizione = 'occupato';
      }
      if (chiave < chiaveAdesso) cella.classList.add('passato');
      if (giorno === adesso.data) cella.classList.add('colonna-oggi');
      const etichetta = etichettaGiorno(giorno);
      cella.title = `${etichetta.nomeGiorno} ${etichetta.dataBreve} · ${oraTesto(minuti)}–${oraTesto(minuti + PASSO_MIN)} · ${descrizione}`;
    },
    (testata, giorno) => {
      if (giorno === adesso.data) testata.classList.add('oggi');
    },
  );
}

/* ---------------------------------------------------------------- azioni */

/** @returns {Promise<void>} */
async function esci() {
  try {
    await esciSocieta();
  } finally {
    location.href = '/';
  }
}

/** @returns {Promise<void>} copies the ICS link, with a select() fallback */
async function copiaLinkIcs() {
  const campo = elemento('campo-link-ics');
  const bottone = elemento('bottone-copia');
  try {
    await navigator.clipboard.writeText(campo.value);
    bottone.textContent = 'Copiato';
    setTimeout(() => { bottone.textContent = 'Copia'; }, 2000);
  } catch {
    campo.select(); // clipboard not available: leave the text selected
  }
}

avvia();
