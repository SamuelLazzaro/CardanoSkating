/*
 * area.js — entry point of the società reserved area. Requires the session
 * cookie set by the personal link (/accesso/<token>): without it the APIs
 * answer 401 and the page falls back to an "access reserved" message.
 */
import { avviaTapFeedback } from './tap-feedback.js';
import {
  APERTURA_MIN,
  CHIUSURA_MIN,
  MAX_GIORNI_FINESTRA_RICORRENZA,
  PASSO_MIN,
  TITOLO_PREDEFINITO,
} from './constants.js';
import {
  adessoRoma,
  aggiungiGiorni,
  chiaveSlot,
  dataEstesa,
  domenicaDellaSettimana,
  eColoreEsadecimale,
  elencoGiorni,
  etichettaGiorno,
  giorniGrigliaMese,
  giorniSettimana,
  giornoSettimana,
  minutiDaOra,
  occorrenzeRicorrenza,
  oraTesto,
  raggruppaSlotInFasce,
  slotSocietaIntervallo,
  slotSocietaSettimana,
} from './utils.js';
import {
  annullaRicorrenza,
  annullaRichiesta,
  esciSocieta,
  inviaRichiestaPrenotazione,
  ottieniCalendario,
  ottieniCalendarioMese,
  ottieniProfiloSocieta,
  ottieniRichiesteSocieta,
  richiediAnnullamento,
} from './api.js';
import {
  aggiungiBottoneGiorno,
  aggiungiBottoneSlot,
  costruisciGriglia,
  costruisciGrigliaMese,
  creaBadge,
  creaVoceMese,
  mostraMessaggio,
  mostraMessaggioConElenco,
  preparaDialogo,
  preparaDrillDownGiorno,
  preparaScorciatoiaSlot,
} from './ui.js';
import { creaVistaCalendario } from './vista-calendario.js';
import { preparaNavigazione } from './navigazione.js';

// First thing on every page: its capture listener must precede all others.
avviaTapFeedback();

/** @type {(id: string) => HTMLElement} */
const elemento = (id) => document.getElementById(id);

/**
 * Default time of the request form. The "+" of a day cell in the monthly view
 * opens the popup on that start time, since a day — unlike a half-hour slot —
 * says nothing about the time.
 * @type {string}
 */
const ORA_PREDEFINITA = '18:00';

/** @type {string} default end time of the request form, 'HH:MM' */
const ORA_FINE_PREDEFINITA = '19:00';

/**
 * Texts of a monthly view entry, per state of its slots. They mirror the three
 * states of the weekly grid: the area calendar never names the other società,
 * so somebody else's booking stays a plain "Occupato".
 * @type {Record<string, {etichetta: string, descrizione: string}>}
 */
const VOCI_MESE = {
  mio: { etichetta: 'Tua prenotazione', descrizione: 'la tua prenotazione' },
  occupato: { etichetta: 'Occupato', descrizione: 'occupato' },
  'in-attesa': { etichetta: 'In attesa', descrizione: 'la tua richiesta, in attesa di approvazione' },
};

/** @type {object|null} week/month state of the calendar panel (js/vista-calendario.js) */
let g_vistaCalendario = null;

/** @type {object[]} cached richieste of the società (used to highlight slots) */
let g_richieste = [];

/** @type {object[]} cached ricorrenze of the società (used to highlight slots) */
let g_ricorrenze = [];

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

  // Società color on the whole area view: the .con-colore rules recolor the
  // own slots in the grid AND the matching legend square (defence in depth:
  // the value is re-validated before touching the inline style).
  if (eColoreEsadecimale(profilo.societa.colore)) {
    const vistaArea = elemento('vista-area');
    vistaArea.classList.add('con-colore');
    vistaArea.style.setProperty('--colore-societa', profilo.societa.colore);
  }

  preparaNavigazione(elemento('nav-sezioni'));
  preparaForm();
  await caricaRichieste();
  await caricaCalendario();

  elemento('vista-caricamento').hidden = true;
  elemento('vista-area').hidden = false;
  elemento('nav-sezioni').hidden = false;
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
  selettoreInizio.value = ORA_PREDEFINITA;
  selettoreFine.value = ORA_FINE_PREDEFINITA;

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
  campoData.addEventListener('change', aggiornaRipetizione);

  const casellaRipeti = elemento('campo-ripeti');
  casellaRipeti.addEventListener('change', () => {
    elemento('blocco-fino-al').hidden = !casellaRipeti.checked;
    elemento('campo-fino-al').required = casellaRipeti.checked;
    aggiornaRipetizione();
  });
  elemento('campo-fino-al').addEventListener('input', aggiornaAnteprimaDate);
  for (const casella of caselleGiorni()) casella.addEventListener('change', aggiornaAnteprimaDate);
  // The date is preset above without firing 'change': lock its weekday now.
  aggiornaRipetizione();

  preparaDialogo(
    elemento('dialogo-richiesta'),
    elemento('bottone-nuova-prenotazione'),
    elemento('bottone-chiudi-dialogo'),
  );
  // A stale error from a previous attempt must not greet the reopened dialog.
  elemento('bottone-nuova-prenotazione').addEventListener('click', () => mostraMessaggio(elemento('esito-form'), ''));

  // "+" shortcut on the free cells of the calendar and drill-down from a day
  // of the monthly grid: delegated listeners, registered before the first
  // render because the container already exists.
  preparaScorciatoiaSlot(elemento('cal-griglia'), apriRichiestaPerSlot);
  preparaDrillDownGiorno(elemento('cal-griglia'), (giorno) => g_vistaCalendario.apriSettimana(giorno));

  // Week/month switch and navigation of the calendar panel.
  g_vistaCalendario = creaVistaCalendario({
    titolo: elemento('cal-titolo'),
    precedente: elemento('cal-precedente'),
    successiva: elemento('cal-successiva'),
    oggi: elemento('cal-oggi'),
    vistaSettimana: elemento('cal-vista-settimana'),
    vistaMese: elemento('cal-vista-mese'),
  }, mostraCalendario);

  elemento('form-richiesta').addEventListener('submit', inviaForm);
  elemento('bottone-esci').addEventListener('click', esci);
  elemento('bottone-copia').addEventListener('click', copiaLinkIcs);
}

/**
 * Opens the request popup on the slot whose "+" was pressed: the date and the
 * start time come from the slot, the end is the end of that same slot (one
 * PASSO_MIN step), which the società can then widen in the form.
 * @param {string} giorno - 'YYYY-MM-DD' of the slot
 * @param {number} minuti - slot start, minutes from midnight
 * @returns {void}
 */
function apriRichiestaPerSlot(giorno, minuti) {
  elemento('campo-data').value = giorno;
  elemento('campo-inizio').value = oraTesto(minuti);
  elemento('campo-fine').value = oraTesto(minuti + PASSO_MIN);
  // The date was written programmatically, which fires no 'change' event:
  // everything tied to it (limits, locked weekday, preview) is refreshed by hand.
  aggiornaRipetizione();
  // A stale error from a previous attempt must not greet the reopened dialog.
  mostraMessaggio(elemento('esito-form'), '');
  elemento('dialogo-richiesta').showModal();
}

/** @returns {HTMLInputElement[]} the seven weekday checkboxes, in weekday order */
function caselleGiorni() {
  return [...document.querySelectorAll('#scelta-giorni input[name="giorni"]')];
}

/** @returns {number[]} weekdays currently selected (0 = lunedì), locked one included */
function giorniSelezionati() {
  return caselleGiorni()
    .filter((casella) => casella.checked)
    .map((casella) => Number(casella.value));
}

/** @returns {void} refreshes everything that depends on the chosen date */
function aggiornaRipetizione() {
  aggiornaLimitiRipetizione();
  aggiornaGiornoObbligatorio();
  aggiornaAnteprimaDate();
}

/** @returns {void} keeps the "fino al" limits tied to the chosen date */
function aggiornaLimitiRipetizione() {
  const dataScelta = elemento('campo-data').value;
  const campoFinoAl = elemento('campo-fino-al');
  if (!dataScelta) return;
  campoFinoAl.min = aggiungiGiorni(dataScelta, 7);
  campoFinoAl.max = aggiungiGiorni(dataScelta, MAX_GIORNI_FINESTRA_RICORRENZA);
  if (campoFinoAl.value && (campoFinoAl.value < campoFinoAl.min || campoFinoAl.value > campoFinoAl.max)) {
    campoFinoAl.value = campoFinoAl.max;
  }
}

/**
 * Keeps the weekday of the chosen date checked and locked: that date is the
 * first occurrence, so its weekday always belongs to the series (the server
 * adds it anyway). When the date moves to another weekday, the previously
 * locked chip is handed back to the user exactly as it was before the lock,
 * so an explicit choice is never lost by merely changing the date.
 * @returns {void}
 */
function aggiornaGiornoObbligatorio() {
  const dataScelta = elemento('campo-data').value;
  if (!dataScelta) return;
  const giornoObbligatorio = giornoSettimana(dataScelta);
  for (const casella of caselleGiorni()) {
    const eObbligatoria = Number(casella.value) === giornoObbligatorio;
    if (eObbligatoria && !casella.disabled) {
      casella.dataset.sceltaPrima = String(casella.checked);
      casella.checked = true;
      casella.disabled = true;
    } else if (!eObbligatoria && casella.disabled) {
      casella.checked = casella.dataset.sceltaPrima === 'true';
      delete casella.dataset.sceltaPrima;
      casella.disabled = false;
    }
  }
}

/**
 * Live preview of the dates the request will cover, computed with the same
 * rules as the server: it is a series only when the weekly repetition is on
 * or more than one weekday is selected; without repetition the extra days
 * stop at the Sunday of the chosen week. Otherwise the preview stays hidden.
 * @returns {void}
 */
function aggiornaAnteprimaDate() {
  const anteprima = elemento('anteprima-date');
  const dataScelta = elemento('campo-data').value;
  const giorni = giorniSelezionati();
  const ripeti = elemento('campo-ripeti').checked;
  const finoAl = elemento('campo-fino-al').value;
  const eRicorrente = ripeti || giorni.length > 1;
  if (!dataScelta || !eRicorrente || (ripeti && !finoAl)) {
    anteprima.hidden = true;
    return;
  }
  const validaAl = ripeti ? finoAl : domenicaDellaSettimana(dataScelta);
  const date = occorrenzeRicorrenza(dataScelta, validaAl, giorni);
  const elenco = date.map((data) => {
    const etichetta = etichettaGiorno(data);
    return `${etichetta.nomeGiorno} ${etichetta.dataBreve}`;
  });
  anteprima.textContent = `Date richieste (${date.length}): ${elenco.join(', ')}`;
  anteprima.hidden = false;
}

/** @returns {void} clears the extra weekdays, keeping only the locked one */
function azzeraGiorni() {
  for (const casella of caselleGiorni()) {
    if (casella.disabled) {
      casella.dataset.sceltaPrima = 'false';
    } else {
      casella.checked = false;
    }
  }
  aggiornaAnteprimaDate();
}

/**
 * @param {SubmitEvent} evento - form submit event
 * @returns {Promise<void>}
 */
async function inviaForm(evento) {
  evento.preventDefault();
  const esitoForm = elemento('esito-form');
  const corpo = {
    titolo: elemento('campo-titolo').value.trim(),
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
  // Only the extra weekdays make the request different from a plain one: the
  // weekday of the date itself is implied server-side.
  const giorni = giorniSelezionati();
  if (giorni.length > 1) corpo.giorni = giorni;

  const bottone = elemento('bottone-invia');
  bottone.disabled = true;
  try {
    const esito = await inviaRichiestaPrenotazione(corpo);
    // Success closes the popup: the confirmation goes to the page-level
    // status next to the calendar, where it stays readable.
    elemento('dialogo-richiesta').close();
    const esitoPagina = elemento('esito-richiesta');
    if (esito.tipo === 'ricorrenza') {
      const dateLeggibili = esito.occorrenze.map(dataEstesa).join(', ');
      mostraMessaggio(esitoPagina, `Richiesta ricorrente inviata (${esito.occorrenze.length} date: ${dateLeggibili}). In attesa di approvazione.`, 'ok');
    } else {
      mostraMessaggio(esitoPagina, 'Richiesta inviata: in attesa di approvazione.', 'ok');
    }
    elemento('campo-titolo').value = TITOLO_PREDEFINITO;
    elemento('campo-note').value = '';
    elemento('campo-ripeti').checked = false;
    elemento('blocco-fino-al').hidden = true;
    elemento('campo-fino-al').required = false;
    azzeraGiorni();
    await caricaRichieste();
    await caricaCalendario();
  } catch (errore) {
    mostraErroreInvio(esitoForm, errore);
  } finally {
    bottone.disabled = false;
  }
}

/**
 * Renders a submission error inside the popup. When the server rejected the
 * request because some 30-minute slots are already booked, the occupied time
 * ranges are listed one per line; every other error keeps the plain message.
 * @param {HTMLElement} esitoForm - status element inside the dialog
 * @param {Error & {dati?: {fasce_occupate?: {data: string, ora_inizio: string, ora_fine: string}[]}}} errore
 * @returns {void}
 */
function mostraErroreInvio(esitoForm, errore) {
  const fasceOccupate = errore.dati?.fasce_occupate ?? [];
  if (fasceOccupate.length === 0) {
    mostraMessaggio(esitoForm, errore.message, 'errore');
    return;
  }
  const voci = fasceOccupate.map(
    (fascia) => `${dataEstesa(fascia.data)}, dalle ${fascia.ora_inizio} alle ${fascia.ora_fine}`,
  );
  mostraMessaggioConElenco(esitoForm, errore.message, voci, 'errore');
}

/* ----------------------------------------------------------------- liste */

/** @returns {Promise<void>} reloads richieste + ricorrenze and renders the lists */
async function caricaRichieste() {
  const dati = await ottieniRichiesteSocieta();
  g_richieste = dati.richieste;
  g_ricorrenze = dati.ricorrenze;
  renderRichieste(dati.richieste);
  renderRicorrenze(dati.ricorrenze);
}

/**
 * Admin decision motivation shown next to the state badge (always via
 * textContent: it is free text typed by the admin).
 * @param {string} motivazione - decision motivation from the API
 * @returns {HTMLSpanElement}
 */
function creaTestoMotivazione(motivazione) {
  const testo = document.createElement('span');
  testo.className = 'testo-tenue';
  testo.textContent = `Motivazione: ${motivazione}`;
  return testo;
}

/**
 * @param {string} testo - button label
 * @param {() => void} azione - click handler
 * @returns {HTMLButtonElement}
 */
function bottoneRiga(testo, azione) {
  const bottone = document.createElement('button');
  bottone.type = 'button';
  bottone.className = 'btn btn-pericolo';
  bottone.textContent = testo;
  bottone.addEventListener('click', azione);
  return bottone;
}

/**
 * Builds one row of the programma/storico lists. The available action depends
 * on the richiesta: a pending one can be withdrawn directly ("Annulla", or
 * "Ritira" for a pending annullamento request); an approved booking can only
 * be cancelled by asking the admin ("Richiedi annullamento"), unless such a
 * request is already pending.
 * @param {object} richiesta - richiesta row from the API
 * @param {boolean} inProgramma - whether the row is in the upcoming list (with actions)
 * @param {Set<number>} conAnnullamentoPendente - ids of bookings with a pending annullamento request
 * @returns {HTMLLIElement}
 */
function creaRigaRichiesta(richiesta, inProgramma, conAnnullamentoPendente) {
  const riga = document.createElement('li');
  const info = document.createElement('div');
  info.className = 'riga-info';

  const dataForte = document.createElement('strong');
  dataForte.textContent = dataEstesa(richiesta.data);
  const orario = document.createElement('span');
  orario.textContent = `${richiesta.ora_inizio}–${richiesta.ora_fine}`;
  info.append(dataForte, orario, creaBadge(richiesta.stato));
  if (richiesta.tipo === 'annullamento') info.append(creaBadge('annullamento'));
  if (richiesta.motivazione) info.append(creaTestoMotivazione(richiesta.motivazione));

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

  if (inProgramma) {
    if (richiesta.stato === 'in_attesa') {
      riga.append(bottoneRiga(richiesta.tipo === 'annullamento' ? 'Ritira' : 'Annulla', () => annulla(richiesta)));
    } else if (richiesta.stato === 'approvata') {
      if (conAnnullamentoPendente.has(richiesta.id)) {
        const avviso = document.createElement('span');
        avviso.className = 'testo-tenue';
        avviso.textContent = 'Annullamento richiesto, in attesa di conferma';
        riga.append(avviso);
      } else {
        riga.append(bottoneRiga('Richiedi annullamento', () => richiediAnnullamentoPrenotazione(richiesta)));
      }
    }
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
  // In programma: bookings still alive (pending or approved) plus pending
  // annullamento requests; an APPROVED annullamento request is a closed act
  // and belongs to the storico.
  const eAttiva = (richiesta) =>
    eFutura(richiesta) && (
      richiesta.tipo === 'annullamento'
        ? richiesta.stato === 'in_attesa'
        : richiesta.stato === 'in_attesa' || richiesta.stato === 'approvata'
    );

  // Bookings that already have a pending annullamento request: their row
  // shows a notice instead of the "Richiedi annullamento" button.
  const conAnnullamentoPendente = new Set(
    richieste
      .filter((richiesta) => richiesta.tipo === 'annullamento' && richiesta.stato === 'in_attesa')
      .map((richiesta) => richiesta.richiesta_riferimento_id),
  );

  const inProgramma = richieste.filter(eAttiva)
    .sort((a, b) => (a.data + a.ora_inizio).localeCompare(b.data + b.ora_inizio));
  const storico = richieste.filter((richiesta) => !eAttiva(richiesta))
    .sort((a, b) => (b.data + b.ora_inizio).localeCompare(a.data + a.ora_inizio))
    .slice(0, 15);

  const listaProgramma = elemento('lista-programma');
  listaProgramma.textContent = '';
  for (const richiesta of inProgramma) listaProgramma.append(creaRigaRichiesta(richiesta, true, conAnnullamentoPendente));
  elemento('vuoto-programma').hidden = inProgramma.length > 0;

  const listaStorico = elemento('lista-storico');
  listaStorico.textContent = '';
  for (const richiesta of storico) listaStorico.append(creaRigaRichiesta(richiesta, false, conAnnullamentoPendente));
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
    giornoForte.textContent = `Ogni ${elencoGiorni(ricorrenza.giorni)}`;
    const orario = document.createElement('span');
    orario.textContent = `${ricorrenza.ora_inizio}–${ricorrenza.ora_fine}`;
    const periodo = document.createElement('span');
    periodo.className = 'testo-tenue';
    periodo.textContent = `dal ${dataEstesa(ricorrenza.valida_dal)} al ${dataEstesa(ricorrenza.valida_al)}`;
    info.append(giornoForte, orario, periodo, creaBadge(ricorrenza.stato));
    if (ricorrenza.motivazione) info.append(creaTestoMotivazione(ricorrenza.motivazione));
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
 * Withdraws a pending richiesta (nuova or annullamento request).
 * @param {object} richiesta - pending richiesta to withdraw
 * @returns {Promise<void>}
 */
async function annulla(richiesta) {
  const descrizione = `${dataEstesa(richiesta.data)} ${richiesta.ora_inizio}–${richiesta.ora_fine}`;
  const conferma = confirm(
    richiesta.tipo === 'annullamento'
      ? `Ritirare la richiesta di annullamento per ${descrizione}? La prenotazione resterà valida.`
      : `Annullare la richiesta di ${descrizione}?`,
  );
  if (!conferma) return;
  try {
    await annullaRichiesta(richiesta.id);
    mostraMessaggio(
      elemento('esito-azioni'),
      richiesta.tipo === 'annullamento' ? 'Richiesta di annullamento ritirata.' : 'Richiesta annullata.',
      'ok',
    );
    await caricaRichieste();
    await caricaCalendario();
  } catch (errore) {
    mostraMessaggio(elemento('esito-azioni'), errore.message, 'errore');
  }
}

/**
 * Sends the annullamento request for an approved booking: nothing is freed
 * until the admin approves it.
 * @param {object} richiesta - approved future richiesta to cancel
 * @returns {Promise<void>}
 */
async function richiediAnnullamentoPrenotazione(richiesta) {
  const conferma = confirm(
    `Chiedere l'annullamento della prenotazione di ${dataEstesa(richiesta.data)} ${richiesta.ora_inizio}–${richiesta.ora_fine}?\n\nGli slot restano prenotati finché l'amministratore non approva la richiesta.`,
  );
  if (!conferma) return;
  try {
    await richiediAnnullamento(richiesta.id);
    mostraMessaggio(elemento('esito-azioni'), "Richiesta di annullamento inviata: in attesa dell'amministratore.", 'ok');
    await caricaRichieste();
  } catch (errore) {
    mostraMessaggio(elemento('esito-azioni'), errore.message, 'errore');
  }
}

/**
 * @param {object} ricorrenza - pending ricorrenza to cancel
 * @returns {Promise<void>}
 */
async function annullaSerie(ricorrenza) {
  const conferma = confirm(`Annullare la richiesta ricorrente di ogni ${elencoGiorni(ricorrenza.giorni)} ${ricorrenza.ora_inizio}–${ricorrenza.ora_fine}?`);
  if (!conferma) return;
  try {
    await annullaRicorrenza(ricorrenza.id);
    mostraMessaggio(elemento('esito-azioni'), 'Richiesta ricorrente annullata.', 'ok');
    await caricaRichieste();
    // The series no longer waits for a decision: its slots must lose the
    // pending highlight in the grid too.
    await caricaCalendario();
  } catch (errore) {
    mostraMessaggio(elemento('esito-azioni'), errore.message, 'errore');
  }
}

/* ------------------------------------------------------------- calendario */

/** @returns {Promise<void>} reloads the interval currently on screen */
function caricaCalendario() {
  return g_vistaCalendario.aggiorna();
}

/**
 * Loads and renders the interval the toolbar asks for, a week or a month. The
 * public API answers with the occupied slots only, anonymous by design: the
 * società's own slots are recognized here, from the richieste and ricorrenze
 * already in memory. Stale responses are dropped, so fast navigation always
 * ends on the interval the user last asked for.
 * @param {{vista: 'settimana'|'mese', lunedi: string, mese: string}} intervallo
 * @returns {Promise<void>}
 */
async function mostraCalendario(intervallo) {
  const versione = ++g_versioneCalendario;
  const eMese = intervallo.vista === 'mese';
  const statoCalendario = elemento('cal-stato');
  mostraMessaggio(statoCalendario, 'Caricamento…');
  try {
    const dati = eMese
      ? await ottieniCalendarioMese(intervallo.mese)
      : await ottieniCalendario(intervallo.lunedi);
    if (versione !== g_versioneCalendario) return;
    const occupati = new Set(dati.slot_occupati);
    elemento('cal-griglia').setAttribute(
      'aria-label',
      eMese ? 'Calendario mensile con le prenotazioni di ogni giorno' : 'Calendario settimanale degli slot da 30 minuti',
    );
    if (eMese) {
      const miei = slotSocietaIntervallo(g_richieste, g_ricorrenze, dati.dal, dati.al);
      renderCalendarioMese(intervallo.mese, occupati, miei.approvati, miei.inAttesa);
    } else {
      const miei = slotSocietaSettimana(g_richieste, g_ricorrenze, intervallo.lunedi);
      renderCalendarioSettimana(intervallo.lunedi, occupati, miei.approvati, miei.inAttesa);
    }
    mostraMessaggio(statoCalendario, '');
  } catch (errore) {
    if (versione !== g_versioneCalendario) return;
    mostraMessaggio(statoCalendario, errore.message, 'errore');
  }
}

/**
 * @param {string} lunedi - Monday of the week to draw, 'YYYY-MM-DD'
 * @param {Set<string>} occupati - all occupied slot keys of the week
 * @param {Set<string>} miei - slot keys of this società's approved bookings
 * @param {Set<string>} inAttesa - slot keys of this società's pending requests
 * @returns {void}
 */
function renderCalendarioSettimana(lunedi, occupati, miei, inAttesa) {
  const adesso = adessoRoma();
  const chiaveAdesso = chiaveSlot(adesso.data, Math.floor(adesso.minuti / PASSO_MIN) * PASSO_MIN);

  costruisciGriglia(
    elemento('cal-griglia'),
    giorniSettimana(lunedi),
    (cella, giorno, minuti) => {
      const chiave = chiaveSlot(giorno, minuti);
      const mio = miei.has(chiave);
      const occupato = occupati.has(chiave);
      const richiesto = inAttesa.has(chiave);
      /*
       * One state per cell, in decreasing priority. "occupato" comes before
       * "richiesto" on purpose: when somebody else's booking was approved
       * after this società sent its request, the slot really is gone, so the
       * cell must not suggest otherwise — the tooltip mentions both.
       */
      let descrizione = 'libero';
      if (mio) {
        cella.classList.add('mio');
        descrizione = 'la tua prenotazione';
      } else if (occupato) {
        cella.classList.add('occupato');
        descrizione = richiesto ? 'occupato · hai una richiesta in attesa su questo slot' : 'occupato';
      } else if (richiesto) {
        cella.classList.add('in-attesa');
        descrizione = 'la tua richiesta, in attesa di approvazione';
      }
      const passato = chiave < chiaveAdesso;
      if (passato) cella.classList.add('passato');
      if (giorno === adesso.data) cella.classList.add('colonna-oggi');
      // Only a free future slot can be requested, so only there the "+"
      // shortcut makes sense: elsewhere the popup would be born rejected —
      // or, on a slot already requested, would duplicate a pending request.
      if (!occupato && !mio && !richiesto && !passato) aggiungiBottoneSlot(cella, giorno, minuti);
      const etichetta = etichettaGiorno(giorno);
      cella.title = `${etichetta.nomeGiorno} ${etichetta.dataBreve} · ${oraTesto(minuti)}–${oraTesto(minuti + PASSO_MIN)} · ${descrizione}`;
    },
    (testata, giorno) => {
      if (giorno === adesso.data) testata.classList.add('oggi');
    },
  );
}

/**
 * Compresses the taken slots of the shown grid into the entries of the monthly
 * view. Every slot is classified exactly as the weekly grid classifies its
 * cells — own booking first, then somebody else's, then own undecided request —
 * so it belongs to one entry only; then each group is compressed into
 * continuous time ranges, turning "18:00, 18:30, 19:00" into one "18:00–19:30".
 * @param {Set<string>} occupati - all occupied slot keys of the grid
 * @param {Set<string>} miei - slot keys of this società's approved bookings
 * @param {Set<string>} inAttesa - slot keys of this società's pending requests
 * @returns {{data: string, oraInizio: string, oraFine: string, stato: string}[]} entries in chronological order
 */
function fasceDelMese(occupati, miei, inAttesa) {
  /** @type {Record<string, string[]>} slot keys by state, same keys as VOCI_MESE */
  const perStato = { mio: [], occupato: [], 'in-attesa': [] };
  for (const chiave of new Set([...occupati, ...miei, ...inAttesa])) {
    if (miei.has(chiave)) {
      perStato.mio.push(chiave);
    } else if (occupati.has(chiave)) {
      perStato.occupato.push(chiave);
    } else {
      perStato['in-attesa'].push(chiave);
    }
  }

  const fasce = [];
  for (const [stato, chiavi] of Object.entries(perStato)) {
    for (const fascia of raggruppaSlotInFasce(chiavi)) fasce.push({ ...fascia, stato });
  }
  return fasce.sort((a, b) => (a.data + a.oraInizio).localeCompare(b.data + b.oraInizio));
}

/**
 * Renders the monthly view: one entry per booking inside the cell of its day.
 * The other società stay anonymous here, exactly as in the weekly view: their
 * bookings are plain "Occupato" entries, while the società's own ones carry its
 * color (or the yellow of an undecided request). A day with more entries than
 * its cell can show scrolls inside the cell (see .mese-voci).
 * @param {string} mese - month to draw, 'YYYY-MM'
 * @param {Set<string>} occupati - all occupied slot keys of the grid
 * @param {Set<string>} miei - slot keys of this società's approved bookings
 * @param {Set<string>} inAttesa - slot keys of this società's pending requests
 * @returns {void}
 */
function renderCalendarioMese(mese, occupati, miei, inAttesa) {
  /** @type {Map<string, object[]>} entries of the grid, by date */
  const perGiorno = new Map();
  for (const fascia of fasceDelMese(occupati, miei, inAttesa)) {
    const delGiorno = perGiorno.get(fascia.data);
    if (delGiorno === undefined) {
      perGiorno.set(fascia.data, [fascia]);
    } else {
      delGiorno.push(fascia);
    }
  }

  const oggi = adessoRoma().data;
  costruisciGrigliaMese(elemento('cal-griglia'), mese, giorniGrigliaMese(mese), (cella, voci, giorno) => {
    if (giorno < oggi) cella.classList.add('passato');
    if (giorno === oggi) cella.classList.add('oggi');
    for (const fascia of perGiorno.get(giorno) ?? []) {
      const orario = `${fascia.oraInizio}–${fascia.oraFine}`;
      const testi = VOCI_MESE[fascia.stato];
      voci.append(creaVoceMese({
        orario,
        etichetta: testi.etichetta,
        stato: fascia.stato,
        descrizione: `${dataEstesa(giorno)} · ${orario} · ${testi.descrizione}`,
      }));
    }
    // Only a day that is not over can host a new request, so only there the
    // "+" shortcut makes sense.
    if (giorno >= oggi) aggiungiBottoneGiorno(cella, giorno, minutiDaOra(ORA_PREDEFINITA));
  });
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
