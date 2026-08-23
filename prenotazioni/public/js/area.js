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
  TITOLO_PREDEFINITO,
} from './constants.js';
import {
  adessoRoma,
  aggiungiGiorni,
  chiaveSlot,
  dataEstesa,
  eColoreEsadecimale,
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
  richiediAnnullamento,
} from './api.js';
import {
  aggiungiBottoneSlot,
  costruisciGriglia,
  creaBadge,
  mostraMessaggio,
  mostraMessaggioConElenco,
  preparaDialogo,
  preparaScorciatoiaSlot,
} from './ui.js';

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

  // Società color on the whole area view: the .con-colore rules recolor the
  // own slots in the grid AND the matching legend square (defence in depth:
  // the value is re-validated before touching the inline style).
  if (eColoreEsadecimale(profilo.societa.colore)) {
    const vistaArea = elemento('vista-area');
    vistaArea.classList.add('con-colore');
    vistaArea.style.setProperty('--colore-societa', profilo.societa.colore);
  }

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

  preparaDialogo(
    elemento('dialogo-richiesta'),
    elemento('bottone-nuova-prenotazione'),
    elemento('bottone-chiudi-dialogo'),
  );
  // A stale error from a previous attempt must not greet the reopened dialog.
  elemento('bottone-nuova-prenotazione').addEventListener('click', () => mostraMessaggio(elemento('esito-form'), ''));

  // "+" shortcut on the free slots of the calendar: one delegated listener,
  // registered before the first render because the container already exists.
  preparaScorciatoiaSlot(elemento('cal-griglia'), apriRichiestaPerSlot);

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
  // the repetition limits have to be refreshed by hand.
  aggiornaLimitiRipetizione();
  // A stale error from a previous attempt must not greet the reopened dialog.
  mostraMessaggio(elemento('esito-form'), '');
  elemento('dialogo-richiesta').showModal();
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
    giornoForte.textContent = `Ogni ${NOMI_GIORNI[ricorrenza.giorno_settimana]}`;
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

/** @returns {Set<string>} slot keys of the società's approved bookings in the shown week */
function mieiSlotSettimana() {
  const fineSettimana = aggiungiGiorni(g_lunediArea, 7);
  const chiavi = new Set();
  for (const richiesta of g_richieste) {
    // Only real bookings hold slots: an approved annullamento request is the
    // opposite (its referenced booking has just been freed).
    if (richiesta.tipo !== 'nuova' || richiesta.stato !== 'approvata') continue;
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
      const passato = chiave < chiaveAdesso;
      if (passato) cella.classList.add('passato');
      if (giorno === adesso.data) cella.classList.add('colonna-oggi');
      // Only a free future slot can be requested, so only there the "+"
      // shortcut makes sense: elsewhere the popup would be born rejected.
      if (!occupato && !mio && !passato) aggiungiBottoneSlot(cella, giorno, minuti);
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
