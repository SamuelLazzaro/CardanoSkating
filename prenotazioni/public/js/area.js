/*
 * area.js — entry point of the società reserved area. Requires the session
 * cookie set by the personal link (/accesso/<token>): without it the APIs
 * answer 401 and the page falls back to an "access reserved" message.
 *
 * Every own item on the calendar (approved booking, pending request, pending
 * change request, pending series) and in the lists opens the same details
 * popup, which offers what the server allows: a pending request or series is
 * edited or withdrawn directly; an approved booking can only be changed or
 * cancelled through a request the admin approves, on the single date or on
 * "questa e le successive" of its series.
 */
import { avviaTapFeedback } from './tap-feedback.js';
import { PASSO_MIN, TITOLO_PREDEFINITO } from './constants.js';
import {
  adessoRoma,
  aggiungiGiorni,
  dataEstesa,
  elencoGiorni,
  oraTesto,
  origineSlotSocieta,
} from './utils.js';
import {
  annullaGruppo,
  annullaRicorrenza,
  annullaRichiesta,
  esciSocieta,
  inviaRichiestaPrenotazione,
  modificaRichiestaInAttesa,
  modificaRicorrenzaInAttesa,
  ottieniCalendarioSocieta,
  ottieniCalendarioSocietaMese,
  ottieniProfiloSocieta,
  ottieniRichiesteSocieta,
  richiediAnnullamento,
  richiediModifica,
} from './api.js';
import {
  creaBadge,
  mostraMessaggio,
  mostraMessaggioConElenco,
  preparaAperturaDettagli,
  preparaDialogo,
  preparaDialogoDettagli,
  preparaDrillDownGiorno,
  preparaScorciatoiaSlot,
  preparaSelectOrari,
} from './ui.js';
import { renderCalendarioMese, renderCalendarioSettimana, renderLegendaCalendario } from './render-calendario.js';
import { creaVistaCalendario } from './vista-calendario.js';
import { preparaFormRipetizione } from './form-ripetizione.js';
import { preparaNavigazione } from './navigazione.js';

// First thing on every page: its capture listener must precede all others.
avviaTapFeedback();

/** @type {(id: string) => HTMLElement} */
const elemento = (id) => document.getElementById(id);

/** @type {import('./form-ripetizione.js').FormRipetizione|null} repetition block of the request form */
let g_ripetizione = null;

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
 * Tooltip text of an own pending slot, by the kind of item it belongs to (see
 * utils.origineSlotSocieta). Approved bookings need none: on the calendar they
 * carry the società name like everybody else's.
 * @type {Record<string, string>}
 */
const DESCRIZIONE_ORIGINE = {
  in_attesa: 'la tua richiesta, in attesa di approvazione',
  modifica: 'la tua richiesta di modifica, in attesa di approvazione',
  ricorrenza: 'la tua richiesta ricorrente, in attesa di approvazione',
};

/** @type {Record<string, string>} readable name of a request type, for confirms and messages */
const NOME_TIPO = { annullamento: 'annullamento', modifica: 'modifica' };

/** @type {number|null} id of the logged-in società, from /api/societa/me */
let g_societaId = null;

/**
 * How the shared calendar renders for a società: every booking shows the name
 * and color of its società, but only the own ones open the details popup
 * (kind 'approvata', so apriDettagli looks the booking up among the cached
 * richieste); the activity titles never reach the area API.
 * @type {import('./render-calendario.js').OpzioniCalendario}
 */
const OPZIONI_CALENDARIO = {
  mostraAttivita: false,
  dettagliDi: (societaId, richiestaId) => (societaId === g_societaId ? { genere: 'approvata', id: richiestaId } : null),
  oraPredefinita: ORA_PREDEFINITA,
};

/** @type {object|null} week/month state of the calendar panel (js/vista-calendario.js) */
let g_vistaCalendario = null;

/** @type {object[]} cached richieste of the società (used to highlight slots) */
let g_richieste = [];

/** @type {object[]} cached ricorrenze of the società (used to highlight slots) */
let g_ricorrenze = [];

/** @type {number} counter to ignore stale calendar responses */
let g_versioneCalendario = 0;

/** @type {ReturnType<typeof preparaDialogoDettagli>|null} details popup of an own item */
let g_dettagli = null;

/**
 * @type {{modo: 'richiesta-attesa'|'ricorrenza-attesa'|'richiedi-modifica', richiesta?: object, ricorrenza?: object, ambito?: 'singola'|'successive'}|null}
 * what the request form is editing, null when it sends a new request
 */
let g_modifica = null;

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

  g_societaId = profilo.societa.id;
  elemento('sottotitolo-societa').textContent = profilo.societa.nome;
  elemento('campo-link-ics').value = profilo.link_ics;
  elemento('bottone-esci').hidden = false;

  preparaNavigazione(elemento('nav-sezioni'));
  preparaForm();
  await caricaRichieste();
  await caricaCalendario();

  elemento('vista-caricamento').hidden = true;
  elemento('vista-area').hidden = false;
  elemento('nav-sezioni').hidden = false;
}

/* ------------------------------------------------------------------ form */

/** @returns {void} populates the time selects, sets the date limits, wires the popups */
function preparaForm() {
  preparaSelectOrari(elemento('campo-inizio'), elemento('campo-fine'), ORA_PREDEFINITA, ORA_FINE_PREDEFINITA);

  const oggi = adessoRoma().data;
  const campoData = elemento('campo-data');
  campoData.min = oggi;
  campoData.max = aggiungiGiorni(oggi, 365);
  campoData.value = aggiungiGiorni(oggi, 1);

  g_ripetizione = preparaFormRipetizione({
    campoData,
    contenitoreGiorni: elemento('scelta-giorni'),
    casellaRipeti: elemento('campo-ripeti'),
    bloccoFinoAl: elemento('blocco-fino-al'),
    campoFinoAl: elemento('campo-fino-al'),
    anteprima: elemento('anteprima-date'),
  });

  preparaDialogo(
    elemento('dialogo-richiesta'),
    elemento('bottone-nuova-prenotazione'),
    elemento('bottone-chiudi-dialogo'),
  );
  // The panel button always opens the form for a new request, discarding any
  // leftover edit state; a stale error must not greet the reopened dialog.
  elemento('bottone-nuova-prenotazione').addEventListener('click', () => {
    impostaModalitaNuova();
    mostraMessaggio(elemento('esito-form'), '');
  });

  // Details popup of an own item, opened from the calendar (delegated
  // listener on the grid) and from the "Dettagli" buttons of the lists.
  g_dettagli = preparaDialogoDettagli({
    dialogo: elemento('dialogo-dettagli'),
    titolo: elemento('titolo-dialogo-dettagli'),
    elenco: elemento('dettagli-elenco'),
    bloccoAmbito: elemento('dettagli-ambito'),
    avviso: elemento('dettagli-avviso'),
    bottoneModifica: elemento('dettagli-modifica'),
    bottoneAnnulla: elemento('dettagli-annulla'),
    bottoneChiudi: elemento('bottone-chiudi-dettagli'),
    esito: elemento('esito-dettagli'),
  });
  preparaAperturaDettagli(elemento('cal-griglia'), apriDettagli);

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
  impostaModalitaNuova();
  elemento('campo-data').value = giorno;
  elemento('campo-inizio').value = oraTesto(minuti);
  elemento('campo-fine').value = oraTesto(minuti + PASSO_MIN);
  // The date was written programmatically, which fires no 'change' event:
  // everything tied to it (limits, locked weekday, preview) is refreshed by hand.
  g_ripetizione.aggiorna();
  // A stale error from a previous attempt must not greet the reopened dialog.
  mostraMessaggio(elemento('esito-form'), '');
  elemento('dialogo-richiesta').showModal();
}

/**
 * Fills the common fields of the request form (activity, date, time, notes).
 * @param {{titolo: string, data: string, ora_inizio: string, ora_fine: string, note: string|null}} valori
 * @returns {void}
 */
function riempiForm(valori) {
  elemento('campo-titolo').value = valori.titolo;
  elemento('campo-data').value = valori.data;
  elemento('campo-inizio').value = valori.ora_inizio;
  elemento('campo-fine').value = valori.ora_fine;
  elemento('campo-note').value = valori.note ?? '';
}

/**
 * Sets title and submit label of the request form and opens it.
 * @param {string} titolo - dialog heading
 * @param {string} testoInvio - submit button label
 * @returns {void}
 */
function apriForm(titolo, testoInvio) {
  elemento('titolo-dialogo-richiesta').textContent = titolo;
  elemento('bottone-invia').textContent = testoInvio;
  mostraMessaggio(elemento('esito-form'), '');
  g_dettagli.chiudi();
  elemento('dialogo-richiesta').showModal();
}

/**
 * Puts the request form back in "new request" mode (title, button, enabled
 * date, repetition block shown, default values). Idempotent: called before
 * every opening for a new request, so a previous edit never leaks into it.
 * @returns {void}
 */
function impostaModalitaNuova() {
  if (g_modifica === null) return;
  g_modifica = null;
  elemento('titolo-dialogo-richiesta').textContent = 'Nuova richiesta di prenotazione';
  elemento('bottone-invia').textContent = 'Invia richiesta';
  elemento('campo-data').disabled = false;
  elemento('campo-titolo').value = TITOLO_PREDEFINITO;
  elemento('campo-note').value = '';
  g_ripetizione.mostra(true);
  g_ripetizione.azzera();
}

/**
 * Edit a pending single request in place: same form, repetition hidden (a
 * single request stays single).
 * @param {object} richiesta - pending richiesta row
 * @returns {void}
 */
function apriModificaRichiestaAttesa(richiesta) {
  g_modifica = { modo: 'richiesta-attesa', richiesta };
  riempiForm(richiesta);
  elemento('campo-data').disabled = false;
  g_ripetizione.mostra(false);
  apriForm('Modifica richiesta in attesa', 'Salva modifiche');
}

/**
 * Edit a pending series in place: the whole definition (days, time, period,
 * activity, notes) is editable, so the repetition block is shown and
 * prefilled from the series.
 * @param {object} ricorrenza - pending ricorrenza row
 * @returns {void}
 */
function apriModificaRicorrenza(ricorrenza) {
  g_modifica = { modo: 'ricorrenza-attesa', ricorrenza };
  riempiForm({ ...ricorrenza, data: ricorrenza.valida_dal });
  elemento('campo-data').disabled = false;
  g_ripetizione.mostra(true);
  g_ripetizione.imposta(ricorrenza.giorni, ricorrenza.valida_al);
  apriForm('Modifica richiesta ricorrente', 'Salva modifiche');
}

/**
 * Ask the admin to change an approved booking: the form is prefilled with the
 * current values; on "questa e le successive" the date is locked, because
 * only time, activity and notes propagate to the series.
 * @param {object} richiesta - approved richiesta row
 * @param {'singola'|'successive'} ambito
 * @returns {void}
 */
function apriRichiediModifica(richiesta, ambito) {
  g_modifica = { modo: 'richiedi-modifica', richiesta, ambito };
  riempiForm(richiesta);
  elemento('campo-data').disabled = ambito === 'successive';
  g_ripetizione.mostra(false);
  apriForm(ambito === 'successive' ? 'Richiesta di modifica: questa data e le successive' : 'Richiesta di modifica', 'Invia richiesta di modifica');
}

/** @returns {{titolo: string, data: string, ora_inizio: string, ora_fine: string, note: string}} the common fields of the form */
function campiForm() {
  return {
    titolo: elemento('campo-titolo').value.trim(),
    data: elemento('campo-data').value,
    ora_inizio: elemento('campo-inizio').value,
    ora_fine: elemento('campo-fine').value,
    note: elemento('campo-note').value.trim(),
  };
}

/**
 * Sends the form in edit mode, by what it is editing, and reports the outcome
 * on the page-level status.
 * @returns {Promise<void>}
 */
async function inviaModifica() {
  const esitoPagina = elemento('esito-richiesta');
  const campi = campiForm();
  if (g_modifica.modo === 'richiesta-attesa') {
    await modificaRichiestaInAttesa(g_modifica.richiesta.id, campi);
    mostraMessaggio(esitoPagina, 'Richiesta modificata: resta in attesa di approvazione con i nuovi dati.', 'ok');
  } else if (g_modifica.modo === 'ricorrenza-attesa') {
    const erroreRipetizione = g_ripetizione.erroreCampi();
    if (erroreRipetizione !== null) throw new Error(erroreRipetizione);
    const risposta = await modificaRicorrenzaInAttesa(g_modifica.ricorrenza.id, { ...campi, ...g_ripetizione.campiRichiesta() });
    mostraMessaggio(esitoPagina, `Richiesta ricorrente modificata (${risposta.occorrenze.length} date): resta in attesa di approvazione.`, 'ok');
  } else {
    const corpo = { ...campi, ambito: g_modifica.ambito };
    // On the series the date field is locked and must not travel.
    if (g_modifica.ambito === 'successive') delete corpo.data;
    const risposta = await richiediModifica(g_modifica.richiesta.id, corpo);
    const conteggio = risposta.richieste > 1 ? `su ${risposta.richieste} date` : '';
    mostraMessaggio(esitoPagina, `Richiesta di modifica inviata ${conteggio}: la prenotazione attuale resta valida finché l'amministratore non decide.`, 'ok');
  }
}

/**
 * @param {SubmitEvent} evento - form submit event
 * @returns {Promise<void>}
 */
async function inviaForm(evento) {
  evento.preventDefault();
  const esitoForm = elemento('esito-form');
  if (!elemento('campo-data').value) {
    mostraMessaggio(esitoForm, 'Scegli una data', 'errore');
    return;
  }
  const bottone = elemento('bottone-invia');
  bottone.disabled = true;
  try {
    if (g_modifica !== null) {
      await inviaModifica();
    } else {
      await inviaNuovaRichiesta();
    }
    // Success closes the popup: the confirmation is already on the page-level
    // status next to the calendar, where it stays readable.
    elemento('dialogo-richiesta').close();
    impostaModalitaNuova();
    elemento('campo-titolo').value = TITOLO_PREDEFINITO;
    elemento('campo-note').value = '';
    g_ripetizione.azzera();
    await caricaRichieste();
    await caricaCalendario();
  } catch (errore) {
    mostraErroreInvio(esitoForm, errore);
  } finally {
    bottone.disabled = false;
  }
}

/** @returns {Promise<void>} sends a new request (single or recurring) */
async function inviaNuovaRichiesta() {
  const erroreRipetizione = g_ripetizione.erroreCampi();
  if (erroreRipetizione !== null) throw new Error(erroreRipetizione);
  const corpo = { ...campiForm(), ...g_ripetizione.campiRichiesta() };
  const esito = await inviaRichiestaPrenotazione(corpo);
  const esitoPagina = elemento('esito-richiesta');
  if (esito.tipo === 'ricorrenza') {
    const dateLeggibili = esito.occorrenze.map(dataEstesa).join(', ');
    mostraMessaggio(esitoPagina, `Richiesta ricorrente inviata (${esito.occorrenze.length} date: ${dateLeggibili}). In attesa di approvazione.`, 'ok');
  } else {
    mostraMessaggio(esitoPagina, 'Richiesta inviata: in attesa di approvazione.', 'ok');
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

/* -------------------------------------------------------------- dettagli */

/**
 * Pending change/cancel requests, by the booking they refer to: a booking
 * with one shows a notice (and a withdraw action) instead of Modifica/Annulla.
 * @returns {Map<number, object>} richiesta_riferimento_id → pending request
 */
function variazioniPendenti() {
  return new Map(
    g_richieste
      .filter((richiesta) => richiesta.tipo !== 'nuova' && richiesta.stato === 'in_attesa')
      .map((richiesta) => [richiesta.richiesta_riferimento_id, richiesta]),
  );
}

/**
 * @param {object} richiesta - richiesta row
 * @returns {boolean} true when the booking has not started yet
 */
function eFutura(richiesta) {
  const adesso = adessoRoma();
  return richiesta.data > adesso.data || (richiesta.data === adesso.data && richiesta.ora_inizio > adesso.ora);
}

/**
 * Opens the details popup of an own item, with the actions the server allows
 * for it. `genere` is the kind from utils.origineSlotSocieta: 'ricorrenza'
 * points into the series, anything else into the richieste, where the row
 * itself (type and state) decides which popup to show.
 * @param {string} genere - 'ricorrenza', or the kind of a richiesta
 * @param {number} id - richiesta id, or ricorrenza id for 'ricorrenza'
 * @returns {void}
 */
function apriDettagli(genere, id) {
  if (genere === 'ricorrenza') {
    const ricorrenza = g_ricorrenze.find((riga) => riga.id === id);
    if (ricorrenza) apriDettagliRicorrenza(ricorrenza);
    return;
  }
  const richiesta = g_richieste.find((riga) => riga.id === id);
  if (!richiesta) return;
  if (richiesta.tipo === 'nuova' && richiesta.stato === 'approvata') {
    apriDettagliPrenotazione(richiesta);
  } else if (richiesta.tipo === 'nuova') {
    apriDettagliRichiestaAttesa(richiesta);
  } else {
    apriDettagliVariazione(richiesta);
  }
}

/**
 * Approved booking: change or cancel through a request to the admin, unless
 * such a request is already pending (then it can only be withdrawn).
 * @param {object} richiesta - approved richiesta row
 * @returns {void}
 */
function apriDettagliPrenotazione(richiesta) {
  const pendente = variazioniPendenti().get(richiesta.id);
  const futura = eFutura(richiesta);
  const ricorrente = richiesta.ricorrenza_id !== null;
  const righe = [
    { etichetta: 'Attività', valore: richiesta.titolo },
    { etichetta: 'Data', valore: dataEstesa(richiesta.data) },
    { etichetta: 'Orario', valore: `${richiesta.ora_inizio}–${richiesta.ora_fine}` },
    { etichetta: 'Note', valore: richiesta.note ?? '' },
    { etichetta: 'Ricorrente', valore: ricorrente ? 'Sì, fa parte di una serie settimanale' : '' },
  ];
  if (!futura) {
    g_dettagli.apri({ titolo: 'Prenotazione approvata', righe, ricorrente: false, avviso: 'Prenotazione già iniziata o passata.' });
    return;
  }
  if (pendente) {
    g_dettagli.apri({
      titolo: 'Prenotazione approvata',
      righe,
      ricorrente: false,
      avviso: `Hai già una richiesta di ${NOME_TIPO[pendente.tipo]} in attesa su questa prenotazione${pendente.gruppo_id ? ' (insieme ad altre date della serie)' : ''}.`,
      annulla: { testo: 'Ritira la richiesta in attesa', azione: () => ritira(pendente) },
    });
    return;
  }
  g_dettagli.apri({
    titolo: 'Prenotazione approvata',
    righe,
    ricorrente,
    modifica: { testo: 'Richiedi modifica', azione: (ambito) => apriRichiediModifica(richiesta, ambito) },
    annulla: { testo: 'Richiedi annullamento', azione: (ambito) => richiediAnnullamentoPrenotazione(richiesta, ambito) },
  });
}

/**
 * Pending single request: edited or withdrawn directly.
 * @param {object} richiesta - pending richiesta row
 * @returns {void}
 */
function apriDettagliRichiestaAttesa(richiesta) {
  g_dettagli.apri({
    titolo: 'Richiesta in attesa di approvazione',
    righe: [
      { etichetta: 'Attività', valore: richiesta.titolo },
      { etichetta: 'Data', valore: dataEstesa(richiesta.data) },
      { etichetta: 'Orario', valore: `${richiesta.ora_inizio}–${richiesta.ora_fine}` },
      { etichetta: 'Note', valore: richiesta.note ?? '' },
    ],
    ricorrente: false,
    modifica: { testo: 'Modifica', azione: () => apriModificaRichiestaAttesa(richiesta) },
    annulla: { testo: 'Annulla richiesta', azione: () => annulla(richiesta) },
  });
}

/**
 * Pending change or cancel request on an approved booking: shows what was
 * asked and lets the società withdraw it (the whole group, if grouped).
 * @param {object} richiesta - pending 'modifica' or 'annullamento' row
 * @returns {void}
 */
function apriDettagliVariazione(richiesta) {
  const eModifica = richiesta.tipo === 'modifica';
  const righe = [
    { etichetta: 'Prenotazione', valore: richiesta.rif_data ? `${dataEstesa(richiesta.rif_data)} · ${richiesta.rif_ora_inizio}–${richiesta.rif_ora_fine}` : '' },
  ];
  if (eModifica) {
    righe.push(
      { etichetta: 'Richiesta', valore: `${dataEstesa(richiesta.data)} · ${richiesta.ora_inizio}–${richiesta.ora_fine}` },
      { etichetta: 'Attività', valore: richiesta.titolo },
      { etichetta: 'Note', valore: richiesta.note ?? '' },
    );
  }
  g_dettagli.apri({
    titolo: eModifica ? 'Richiesta di modifica in attesa' : 'Richiesta di annullamento in attesa',
    righe,
    ricorrente: false,
    avviso: richiesta.gruppo_id
      ? "La richiesta riguarda più date della serie: si ritira tutta insieme. La prenotazione attuale resta valida finché l'amministratore non decide."
      : "La prenotazione attuale resta valida finché l'amministratore non decide.",
    annulla: { testo: 'Ritira richiesta', azione: () => ritira(richiesta) },
  });
}

/**
 * Pending series: edited or withdrawn directly, as a whole.
 * @param {object} ricorrenza - pending ricorrenza row
 * @returns {void}
 */
function apriDettagliRicorrenza(ricorrenza) {
  g_dettagli.apri({
    titolo: 'Richiesta ricorrente in attesa di approvazione',
    righe: [
      { etichetta: 'Attività', valore: ricorrenza.titolo },
      { etichetta: 'Giorni', valore: `ogni ${elencoGiorni(ricorrenza.giorni)}` },
      { etichetta: 'Orario', valore: `${ricorrenza.ora_inizio}–${ricorrenza.ora_fine}` },
      { etichetta: 'Periodo', valore: `dal ${dataEstesa(ricorrenza.valida_dal)} al ${dataEstesa(ricorrenza.valida_al)}` },
      { etichetta: 'Note', valore: ricorrenza.note ?? '' },
    ],
    ricorrente: false,
    avviso: ricorrenza.stato === 'in_attesa' ? undefined : 'Richiesta già decisa.',
    modifica: ricorrenza.stato === 'in_attesa' ? { testo: 'Modifica', azione: () => apriModificaRicorrenza(ricorrenza) } : undefined,
    annulla: ricorrenza.stato === 'in_attesa' ? { testo: 'Annulla richiesta', azione: () => annullaSerie(ricorrenza) } : undefined,
  });
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
 * @param {string} [classi] - CSS classes
 * @returns {HTMLButtonElement}
 */
function bottoneRiga(testo, azione, classi = 'btn') {
  const bottone = document.createElement('button');
  bottone.type = 'button';
  bottone.className = classi;
  bottone.textContent = testo;
  bottone.addEventListener('click', azione);
  return bottone;
}

/**
 * "18:00–19:00 → 19:00–20:00": the current time range of a booking struck
 * through, then the one the modifica request asks for (with the dates when
 * the date changes too).
 * @param {object} richiesta - pending 'modifica' row with rif_* fields
 * @returns {HTMLSpanElement}
 */
function creaVariazione(richiesta) {
  const cambiaData = richiesta.rif_data !== richiesta.data;
  const testo = (data, inizio, fine) => `${cambiaData ? `${dataEstesa(data)} ` : ''}${inizio}–${fine}`;
  const contenitore = document.createElement('span');
  contenitore.className = 'variazione';
  const prima = document.createElement('span');
  prima.className = 'prima';
  prima.textContent = testo(richiesta.rif_data, richiesta.rif_ora_inizio, richiesta.rif_ora_fine);
  const freccia = document.createElement('span');
  freccia.textContent = '→';
  freccia.setAttribute('aria-label', 'diventa');
  const dopo = document.createElement('span');
  dopo.textContent = testo(richiesta.data, richiesta.ora_inizio, richiesta.ora_fine);
  contenitore.append(prima, freccia, dopo);
  return contenitore;
}

/**
 * Builds one row of the programma/storico lists for a single richiesta. In
 * the programma every row has a "Dettagli" button opening the popup, which
 * offers the actions allowed for that item.
 * @param {object} richiesta - richiesta row from the API
 * @param {boolean} inProgramma - whether the row is in the upcoming list (with actions)
 * @returns {HTMLLIElement}
 */
function creaRigaRichiesta(richiesta, inProgramma) {
  const riga = document.createElement('li');
  const info = document.createElement('div');
  info.className = 'riga-info';

  const dataForte = document.createElement('strong');
  dataForte.textContent = dataEstesa(richiesta.tipo === 'modifica' && richiesta.rif_data ? richiesta.rif_data : richiesta.data);
  const orario = document.createElement('span');
  if (richiesta.tipo === 'modifica' && richiesta.rif_data) {
    orario.append(creaVariazione(richiesta));
  } else {
    orario.textContent = `${richiesta.ora_inizio}–${richiesta.ora_fine}`;
  }
  info.append(dataForte, orario, creaBadge(richiesta.stato));
  if (richiesta.tipo !== 'nuova') info.append(creaBadge(richiesta.tipo));
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
    // The kind only matters to tell a series apart (see apriDettagli): for a
    // richiesta the popup is chosen from the row itself.
    riga.append(bottoneRiga('Dettagli', () => apriDettagli(richiesta.tipo === 'nuova' ? richiesta.stato : richiesta.tipo, richiesta.id)));
  }
  return riga;
}

/**
 * One row for a group of pending requests (annullamento or modifica asked on
 * "questa e le successive"): the dates, the time range (before → after for a
 * modifica) and one withdraw action for the whole group.
 * @param {object[]} membri - the group's rows, in date order
 * @returns {HTMLLIElement}
 */
function creaRigaGruppo(membri) {
  const prima = membri[0];
  const riga = document.createElement('li');
  const info = document.createElement('div');
  info.className = 'riga-info';
  const date = document.createElement('strong');
  date.textContent = `${membri.length} date, dal ${dataEstesa(membri[0].data)} al ${dataEstesa(membri[membri.length - 1].data)}`;
  const orario = document.createElement('span');
  if (prima.tipo === 'modifica' && prima.rif_ora_inizio) {
    orario.append(creaVariazione({ ...prima, rif_data: prima.data }));
  } else {
    orario.textContent = `${prima.ora_inizio}–${prima.ora_fine}`;
  }
  info.append(date, orario, creaBadge(prima.stato), creaBadge(prima.tipo));
  const serie = document.createElement('span');
  serie.className = 'testo-tenue';
  serie.textContent = 'serie';
  info.append(serie);
  riga.append(info);
  riga.append(bottoneRiga('Ritira', () => ritira(prima), 'btn btn-pericolo'));
  return riga;
}

/**
 * @param {object[]} richieste - all richieste of the società
 * @returns {void}
 */
function renderRichieste(richieste) {
  // In programma: bookings still alive (pending or approved) plus pending
  // annullamento/modifica requests; an APPROVED annullamento or modifica
  // request is a closed act and belongs to the storico.
  const eAttiva = (richiesta) =>
    eFutura(richiesta) && (
      richiesta.tipo !== 'nuova'
        ? richiesta.stato === 'in_attesa'
        : richiesta.stato === 'in_attesa' || richiesta.stato === 'approvata'
    );

  const inProgramma = richieste.filter(eAttiva)
    .sort((a, b) => (a.data + a.ora_inizio).localeCompare(b.data + b.ora_inizio));
  const storico = richieste.filter((richiesta) => !eAttiva(richiesta))
    .sort((a, b) => (b.data + b.ora_inizio).localeCompare(a.data + a.ora_inizio))
    .slice(0, 15);

  /*
   * One row per item: a single request stands alone, the members of a group
   * (a change or cancel request on "questa e le successive") are folded into
   * one row, placed where their first date falls. Two passes: first collect
   * the members of each group, then render in order.
   */
  /** @type {Map<string, object[]>} group id → members in date order */
  const membriPerGruppo = new Map();
  for (const richiesta of inProgramma) {
    if (richiesta.gruppo_id === null) continue;
    const membri = membriPerGruppo.get(richiesta.gruppo_id) ?? [];
    membri.push(richiesta);
    membriPerGruppo.set(richiesta.gruppo_id, membri);
  }
  const listaProgramma = elemento('lista-programma');
  listaProgramma.textContent = '';
  const gruppiResi = new Set();
  for (const richiesta of inProgramma) {
    if (richiesta.gruppo_id === null) {
      listaProgramma.append(creaRigaRichiesta(richiesta, true));
    } else if (!gruppiResi.has(richiesta.gruppo_id)) {
      gruppiResi.add(richiesta.gruppo_id);
      listaProgramma.append(creaRigaGruppo(membriPerGruppo.get(richiesta.gruppo_id)));
    }
  }
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
      riga.append(bottoneRiga('Dettagli', () => apriDettagliRicorrenza(ricorrenza)));
    }
    lista.append(riga);
  }
  elemento('vuoto-ricorrenze').hidden = ricorrenze.length > 0;
}

/* ---------------------------------------------------------------- azioni */

/**
 * Reports the outcome of an action started from the details popup: errors
 * stay inside the popup, successes close it and go to the page-level status.
 * @param {() => Promise<string>} azione - performs the call and returns the success message
 * @returns {Promise<void>}
 */
async function eseguiDalPopup(azione) {
  try {
    const messaggio = await azione();
    g_dettagli.chiudi();
    mostraMessaggio(elemento('esito-azioni'), messaggio, 'ok');
    mostraMessaggio(elemento('esito-richiesta'), messaggio, 'ok');
    await caricaRichieste();
    await caricaCalendario();
  } catch (errore) {
    mostraMessaggio(elemento('esito-dettagli'), errore.message, 'errore');
  }
}

/**
 * Withdraws a pending single request (booking request only: change and
 * cancel requests go through ritira()).
 * @param {object} richiesta - pending richiesta to withdraw
 * @returns {Promise<void>}
 */
async function annulla(richiesta) {
  const descrizione = `${dataEstesa(richiesta.data)} ${richiesta.ora_inizio}–${richiesta.ora_fine}`;
  if (!confirm(`Annullare la richiesta di ${descrizione}?`)) return;
  await eseguiDalPopup(async () => {
    await annullaRichiesta(richiesta.id);
    return 'Richiesta annullata.';
  });
}

/**
 * Withdraws a pending change or cancel request, alone or with its whole group.
 * @param {object} richiesta - pending 'modifica' or 'annullamento' row
 * @returns {Promise<void>}
 */
async function ritira(richiesta) {
  const nome = NOME_TIPO[richiesta.tipo] ?? 'prenotazione';
  const conferma = richiesta.gruppo_id
    ? `Ritirare la richiesta di ${nome} per tutte le date della serie? Le prenotazioni resteranno valide così come sono.`
    : `Ritirare la richiesta di ${nome}? La prenotazione resterà valida così com'è.`;
  if (!confirm(conferma)) return;
  await eseguiDalPopup(async () => {
    if (richiesta.gruppo_id) {
      const risposta = await annullaGruppo(richiesta.gruppo_id);
      return `Richiesta di ${nome} ritirata su ${risposta.richieste_ritirate} date.`;
    }
    await annullaRichiesta(richiesta.id);
    return `Richiesta di ${nome} ritirata.`;
  });
}

/**
 * Sends the annullamento request for an approved booking, or for that
 * occurrence and the following ones of its series: nothing is freed until
 * the admin approves it.
 * @param {object} richiesta - approved future richiesta to cancel
 * @param {'singola'|'successive'} ambito
 * @returns {Promise<void>}
 */
async function richiediAnnullamentoPrenotazione(richiesta, ambito) {
  const descrizione = `${dataEstesa(richiesta.data)} ${richiesta.ora_inizio}–${richiesta.ora_fine}`;
  const conferma = ambito === 'successive'
    ? `Chiedere l'annullamento della prenotazione di ${descrizione} E DI TUTTE LE SUCCESSIVE della serie?\n\nGli slot restano prenotati finché l'amministratore non approva la richiesta.`
    : `Chiedere l'annullamento della prenotazione di ${descrizione}?\n\nGli slot restano prenotati finché l'amministratore non approva la richiesta.`;
  if (!confirm(conferma)) return;
  await eseguiDalPopup(async () => {
    const risposta = await richiediAnnullamento(richiesta.id, ambito);
    const conteggio = risposta.richieste > 1 ? ` su ${risposta.richieste} date` : '';
    return `Richiesta di annullamento inviata${conteggio}: in attesa dell'amministratore.`;
  });
}

/**
 * @param {object} ricorrenza - pending ricorrenza to cancel
 * @returns {Promise<void>}
 */
async function annullaSerie(ricorrenza) {
  if (!confirm(`Annullare la richiesta ricorrente di ogni ${elencoGiorni(ricorrenza.giorni)} ${ricorrenza.ora_inizio}–${ricorrenza.ora_fine}?`)) return;
  await eseguiDalPopup(async () => {
    await annullaRicorrenza(ricorrenza.id);
    // The series no longer waits for a decision: its slots lose the pending
    // highlight in the grid too (eseguiDalPopup reloads the calendar).
    return 'Richiesta ricorrente annullata.';
  });
}

/* ------------------------------------------------------------- calendario */

/** @returns {Promise<void>} reloads the interval currently on screen */
function caricaCalendario() {
  return g_vistaCalendario.aggiorna();
}

/**
 * Loads and renders the interval the toolbar asks for, a week or a month. The
 * area API names the società of every booked slot, so the grid is the same
 * one the admin sees; what the API cannot know are the società's own requests
 * still waiting for a decision, which are recognized here from the richieste
 * and ricorrenze already in memory and drawn over the free slots. Stale
 * responses are dropped, so fast navigation always ends on the interval the
 * user last asked for.
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
      ? await ottieniCalendarioSocietaMese(intervallo.mese)
      : await ottieniCalendarioSocieta(intervallo.lunedi);
    if (versione !== g_versioneCalendario) return;
    renderLegendaCalendario(elemento('cal-legenda'), dati.prenotazioni);
    if (eMese) {
      const opzioni = { ...OPZIONI_CALENDARIO, inAttesa: slotInAttesa(dati.dal, dati.al) };
      renderCalendarioMese(elemento('cal-griglia'), intervallo.mese, dati.prenotazioni, opzioni);
    } else {
      const opzioni = { ...OPZIONI_CALENDARIO, inAttesa: slotInAttesa(intervallo.lunedi, aggiungiGiorni(intervallo.lunedi, 6)) };
      renderCalendarioSettimana(elemento('cal-griglia'), intervallo.lunedi, dati.prenotazioni, opzioni);
    }
    mostraMessaggio(statoCalendario, '');
  } catch (errore) {
    if (versione !== g_versioneCalendario) return;
    mostraMessaggio(statoCalendario, errore.message, 'errore');
  }
}

/**
 * The società's own slots still waiting for a decision inside a date interval
 * (pending request, pending change request, pending series), in the shape the
 * shared calendar draws them. Approved bookings are left out: the API already
 * returns them, with the società name, like everybody else's.
 * @param {string} dal - first date of the interval, 'YYYY-MM-DD'
 * @param {string} al - last date of the interval, 'YYYY-MM-DD'
 * @returns {Map<string, import('./render-calendario.js').VoceInAttesa>} by slot key
 */
function slotInAttesa(dal, al) {
  const inAttesa = new Map();
  for (const [chiave, origine] of origineSlotSocieta(g_richieste, g_ricorrenze, dal, al)) {
    if (origine.genere === 'approvata') continue;
    const id = origine.genere === 'ricorrenza' ? origine.ricorrenza.id : origine.richiesta.id;
    inAttesa.set(chiave, { genere: origine.genere, id, descrizione: DESCRIZIONE_ORIGINE[origine.genere] });
  }
  return inAttesa;
}

/* ------------------------------------------------------------- sessione */

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
