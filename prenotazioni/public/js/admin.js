/*
 * admin.js — entry point of the admin panel. Shows the login form until an
 * admin session cookie is present, then three sections behind the nav
 * (js/navigazione.js): Home with the full calendar (società names, direct
 * bookings, and a details popup on every booking with Modifica/Annulla, on
 * the single date or on "questa e le successive" of a series) and the monthly
 * report; Notifiche with the pending richieste/ricorrenze to approve/reject
 * (grouped requests decided together), counted by the bell badge; Società
 * with the società management (create, edit, suspend/reactivate,
 * personal-link regeneration).
 */
import { avviaTapFeedback } from './tap-feedback.js';
import { COLORE_PREDEFINITO, MIN_MOTIVAZIONE, PASSO_MIN, TITOLO_PREDEFINITO } from './constants.js';
import {
  adessoRoma,
  aggiungiGiorni,
  dataEstesa,
  eColoreEsadecimale,
  elencoGiorni,
  formattaSlotKey,
  numeroItaliano,
  oraTesto,
  raggruppaPrenotazioni,
} from './utils.js';
import {
  accediAdmin,
  aggiornaSocietaAdmin,
  annullaRichiestaAdmin,
  approvaGruppo,
  approvaRicorrenza,
  approvaRichiesta,
  creaPrenotazioneDiretta,
  creaSocietaAdmin,
  esciAdmin,
  modificaPrenotazioneAdmin,
  ottieniCalendarioAdmin,
  ottieniCalendarioAdminMese,
  ottieniElencoSocieta,
  ottieniReport,
  ottieniRichiesteAdmin,
  ottieniRicorrenzeAdmin,
  riattivaSocieta,
  rifiutaGruppo,
  rifiutaRicorrenza,
  rifiutaRichiesta,
  rigeneraTokenSocieta,
  sospendiSocieta,
} from './api.js';
import {
  creaBadge,
  creaQuadrettoColore,
  mostraMessaggio,
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
import { aggiornaBadgeNotifiche, preparaNavigazione } from './navigazione.js';

// First thing on every page: its capture listener must precede all others.
avviaTapFeedback();

/** @type {(id: string) => HTMLElement} */
const elemento = (id) => document.getElementById(id);

/**
 * Default time of the direct booking form. The "+" of a day cell in the
 * monthly view opens the popup on that start time, since a day — unlike a
 * half-hour slot — says nothing about the time.
 * @type {string}
 */
const ORA_PREDEFINITA = '10:00';

/** @type {string} default end time of the direct booking form, 'HH:MM' */
const ORA_FINE_PREDEFINITA = '11:00';

/**
 * How the shared calendar renders for the admin: activity titles under the
 * società names and a details popup on every booking (the admin grid only
 * holds bookings, so the kind is always 'prenotazione').
 * @type {import('./render-calendario.js').OpzioniCalendario}
 */
const OPZIONI_CALENDARIO = {
  mostraAttivita: true,
  dettagliDi: (_societaId, richiestaId) => ({ genere: 'prenotazione', id: richiestaId }),
  oraPredefinita: ORA_PREDEFINITA,
};

/** @type {object|null} week/month state of the calendar panel (js/vista-calendario.js) */
let g_vistaCalendario = null;

/** @type {number} counter to ignore stale calendar responses */
let g_versioneCalendario = 0;

/** @type {object|null} società being edited in the form, null = create mode */
let g_societaInModifica = null;

/** @type {import('./form-ripetizione.js').FormRipetizione|null} repetition block of the direct booking form */
let g_ripetizione = null;

/** @type {ReturnType<typeof preparaDialogoDettagli>|null} details popup of a booking */
let g_dettagli = null;

/**
 * @type {Map<number, object>} bookings of the interval on screen, by richiesta
 * id (blocks from utils.raggruppaPrenotazioni): what the details popup shows
 * when a cell or an entry is clicked
 */
let g_blocchi = new Map();

/**
 * @type {{blocco: object, ambito: 'singola'|'successive'}|null} booking being
 * edited in the booking form, null when the form creates a new booking
 */
let g_modifica = null;

/* ------------------------------------------------------------------ init */

/** @returns {Promise<void>} */
async function avvia() {
  preparaEventi();
  try {
    await caricaPannello();
  } catch (errore) {
    elemento('vista-caricamento').hidden = true;
    if (errore.status === 401) {
      elemento('vista-login').hidden = false;
      elemento('campo-password').focus();
    } else {
      mostraMessaggio(elemento('vista-caricamento'), errore.message, 'errore');
      elemento('vista-caricamento').hidden = false;
    }
  }
}

/** @returns {void} registers all static event listeners once */
function preparaEventi() {
  preparaNavigazione(elemento('nav-sezioni'));
  preparaSelectOrari(elemento('dir-inizio'), elemento('dir-fine'), ORA_PREDEFINITA, ORA_FINE_PREDEFINITA);
  const oggi = adessoRoma().data;
  const campoData = elemento('dir-data');
  campoData.min = oggi;
  campoData.max = aggiungiGiorni(oggi, 365);
  campoData.value = aggiungiGiorni(oggi, 1);

  // Same repetition block as the società request form: weekday chips, weekly
  // repetition and live preview of the dates that will be booked.
  g_ripetizione = preparaFormRipetizione({
    campoData,
    contenitoreGiorni: elemento('dir-scelta-giorni'),
    casellaRipeti: elemento('dir-ripeti'),
    bloccoFinoAl: elemento('dir-blocco-fino-al'),
    campoFinoAl: elemento('dir-fino-al'),
    anteprima: elemento('dir-anteprima-date'),
  });

  preparaDialogo(
    elemento('dialogo-diretta'),
    elemento('bottone-nuova-prenotazione'),
    elemento('bottone-chiudi-dialogo'),
  );
  // The panel button always opens the form in create mode, discarding any
  // leftover edit state; a stale error must not greet the reopened dialog.
  elemento('bottone-nuova-prenotazione').addEventListener('click', () => {
    impostaModalitaNuova();
    mostraMessaggio(elemento('esito-form'), '');
  });

  // Details popup of a booking, opened from the calendar cells and entries
  // (delegated listener on the grid) and from the list under the calendar.
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
  // The admin grid only holds bookings: the kind is always 'prenotazione'.
  preparaAperturaDettagli(elemento('cal-griglia'), (_genere, id) => apriDettagliPrenotazione(id));

  preparaDialogo(
    elemento('dialogo-societa'),
    elemento('bottone-nuova-societa'),
    elemento('bottone-chiudi-societa'),
  );
  // The "Nuova società" button always reopens the dialog in create mode,
  // discarding any leftover edit state from a previous opening.
  elemento('bottone-nuova-societa').addEventListener('click', () => impostaFormSocieta(null));

  // "+" shortcut on the free cells of the calendar and drill-down from a day
  // of the monthly grid: delegated listeners, registered before the first
  // render because the container already exists.
  preparaScorciatoiaSlot(elemento('cal-griglia'), apriDirettaPerSlot);
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

  elemento('form-login').addEventListener('submit', accedi);
  elemento('bottone-esci').addEventListener('click', esci);
  elemento('form-diretta').addEventListener('submit', prenotaDiretta);
  elemento('form-societa').addEventListener('submit', salvaSocieta);

  elemento('report-mese').value = oggi.slice(0, 7);
  elemento('report-mese').addEventListener('change', caricaReport);
}

/**
 * @param {SubmitEvent} evento - login form submit
 * @returns {Promise<void>}
 */
async function accedi(evento) {
  evento.preventDefault();
  const bottone = elemento('bottone-entra');
  bottone.disabled = true;
  try {
    await accediAdmin(elemento('campo-password').value);
    elemento('campo-password').value = '';
    mostraMessaggio(elemento('esito-login'), '');
    elemento('vista-login').hidden = true;
    await caricaPannello();
  } catch (errore) {
    mostraMessaggio(elemento('esito-login'), errore.message, 'errore');
  } finally {
    bottone.disabled = false;
  }
}

/** @returns {Promise<void>} loads every panel section (throws on 401) */
async function caricaPannello() {
  const [societa] = await Promise.all([caricaSocieta(), caricaInAttesa()]);
  aggiornaSelectDiretta(societa);
  elemento('vista-caricamento').hidden = true;
  elemento('bottone-esci').hidden = false;
  elemento('vista-admin').hidden = false;
  elemento('nav-sezioni').hidden = false;
  await caricaCalendario();
  await caricaReport();
}

/** @returns {Promise<void>} */
async function esci() {
  try {
    await esciAdmin();
  } finally {
    location.reload();
  }
}

/* ------------------------------------------------------ richieste attesa */

/** @returns {Promise<void>} reloads and renders the pending lists */
async function caricaInAttesa() {
  const [richieste, ricorrenze] = await Promise.all([ottieniRichiesteAdmin(), ottieniRicorrenzeAdmin()]);
  const voci = raggruppaPerGruppo(richieste.richieste);
  renderRichiesteAttesa(voci);
  renderRicorrenzeAttesa(ricorrenze.ricorrenze);
  // The bell badge mirrors this section: anything still waiting for a
  // decision (a group of requests is one decision). Every caller of
  // caricaInAttesa (login, approve/reject, suspension cascade) therefore
  // keeps the counter up to date for free.
  aggiornaBadgeNotifiche(
    elemento('badge-notifiche'),
    voci.length + ricorrenze.ricorrenze.length,
  );
}

/**
 * @typedef {object} VoceAttesa
 * @property {string|null} gruppoId - null for a single request
 * @property {object[]} richieste - the request, or the members of the group in date order
 */

/**
 * The pending list shows one entry per decision: a single request stands
 * alone, the members of a group (annullamento or modifica asked on "questa e
 * le successive") are folded into one entry, decided together.
 * @param {object[]} richieste - pending richieste from the API, in date order
 * @returns {VoceAttesa[]} entries in the order of their first request
 */
function raggruppaPerGruppo(richieste) {
  /** @type {VoceAttesa[]} */
  const voci = [];
  /** @type {Map<string, VoceAttesa>} */
  const perGruppo = new Map();
  for (const richiesta of richieste) {
    if (richiesta.gruppo_id === null) {
      voci.push({ gruppoId: null, richieste: [richiesta] });
      continue;
    }
    const voce = perGruppo.get(richiesta.gruppo_id);
    if (voce === undefined) {
      const nuova = { gruppoId: richiesta.gruppo_id, richieste: [richiesta] };
      perGruppo.set(richiesta.gruppo_id, nuova);
      voci.push(nuova);
    } else {
      voce.richieste.push(richiesta);
    }
  }
  return voci;
}

/**
 * "18:00–19:00 → 19:00–20:00": the current time range of a booking struck
 * through, then the one a modifica request asks for. When the date changes
 * too, both sides carry it.
 * @param {{data: string, ora_inizio: string, ora_fine: string}} prima - current booking
 * @param {{data: string, ora_inizio: string, ora_fine: string}} dopo - requested values
 * @returns {HTMLSpanElement}
 */
function creaVariazione(prima, dopo) {
  const cambiaData = prima.data !== dopo.data;
  const testo = (estremi) => `${cambiaData ? `${dataEstesa(estremi.data)} ` : ''}${estremi.ora_inizio}–${estremi.ora_fine}`;
  const contenitore = document.createElement('span');
  contenitore.className = 'variazione';
  const vecchio = document.createElement('span');
  vecchio.className = 'prima';
  vecchio.textContent = testo(prima);
  const freccia = document.createElement('span');
  freccia.textContent = '→';
  freccia.setAttribute('aria-label', 'diventa');
  const nuovo = document.createElement('span');
  nuovo.textContent = testo(dopo);
  contenitore.append(vecchio, freccia, nuovo);
  return contenitore;
}

/**
 * Turns a 409-with-conflicts error into a readable message for the admin.
 * @param {Error & {dati?: {conflitti?: {slot_key: string, societa: string}[]}}} errore
 * @returns {string}
 */
function messaggioConflitti(errore) {
  const conflitti = errore.dati?.conflitti;
  if (!conflitti || conflitti.length === 0) return errore.message;
  const dettaglio = conflitti.map((c) => `${formattaSlotKey(c.slot_key)} (${c.societa})`).join(', ');
  return `${errore.message} — ${dettaglio}`;
}

/**
 * Renders the pending requests, one row per decision. A booking request shows
 * its date and time; an annullamento request the booking it frees; a modifica
 * request the current time range struck through and the requested one. A
 * group shows its dates and the common time range, and is decided as a whole.
 * @param {VoceAttesa[]} voci - pending entries (see raggruppaPerGruppo)
 * @returns {void}
 */
function renderRichiesteAttesa(voci) {
  const lista = elemento('lista-richieste-attesa');
  lista.textContent = '';
  for (const voce of voci) {
    const prima = voce.richieste[0];
    const riga = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'riga-info';
    const nome = document.createElement('strong');
    nome.textContent = prima.societa;
    const attivita = document.createElement('span');
    attivita.className = 'testo-tenue';
    attivita.textContent = prima.titolo;
    info.append(nome, attivita);

    if (voce.gruppoId === null) {
      const quando = document.createElement('span');
      quando.textContent = `${dataEstesa(prima.data)} · ${prima.ora_inizio}–${prima.ora_fine}`;
      if (prima.tipo === 'modifica' && prima.rif_data) {
        // Current values come from the referenced booking (rif_*), the
        // requested ones from the request itself.
        quando.textContent = `${dataEstesa(prima.rif_data)} · `;
        quando.append(creaVariazione(
          { data: prima.rif_data, ora_inizio: prima.rif_ora_inizio, ora_fine: prima.rif_ora_fine },
          prima,
        ));
      }
      info.append(quando);
    } else {
      const date = voce.richieste.map((richiesta) => richiesta.data);
      const quando = document.createElement('span');
      quando.textContent = `${date.length} date, dal ${dataEstesa(date[0])} al ${dataEstesa(date[date.length - 1])} · `;
      if (prima.tipo === 'modifica' && prima.rif_ora_inizio) {
        quando.append(creaVariazione(
          { data: prima.data, ora_inizio: prima.rif_ora_inizio, ora_fine: prima.rif_ora_fine },
          prima,
        ));
      } else {
        quando.append(`${prima.ora_inizio}–${prima.ora_fine}`);
      }
      info.append(quando);
    }
    // Annullamento and modifica requests share the pending list but must
    // stand out: approving one FREES or MOVES the referenced booking instead
    // of adding slots.
    if (prima.tipo !== 'nuova') info.append(creaBadge(prima.tipo));
    riga.append(info);
    if (prima.note) {
      const nota = document.createElement('p');
      nota.className = 'riga-nota';
      nota.textContent = prima.note;
      riga.append(nota);
    }
    riga.append(azioniDecisione(
      () => decidiVoce(voce, true),
      () => decidiVoce(voce, false),
    ));
    lista.append(riga);
  }
  elemento('vuoto-richieste-attesa').hidden = voci.length > 0;
}

/**
 * @param {() => void} suApprova
 * @param {() => void} suRifiuta
 * @returns {HTMLDivElement} the approve/reject button pair
 */
function azioniDecisione(suApprova, suRifiuta) {
  const azioni = document.createElement('div');
  azioni.className = 'riga-azioni';
  const approva = document.createElement('button');
  approva.type = 'button';
  approva.className = 'btn btn-primario btn-piccolo';
  approva.textContent = 'Approva';
  approva.addEventListener('click', suApprova);
  const rifiuta = document.createElement('button');
  rifiuta.type = 'button';
  rifiuta.className = 'btn btn-pericolo btn-piccolo';
  rifiuta.textContent = 'Rifiuta';
  rifiuta.addEventListener('click', suRifiuta);
  azioni.append(approva, rifiuta);
  return azioni;
}

/**
 * Asks the admin for the mandatory decision motivation via prompt().
 * @param {boolean} approvare - true for approval (prefilled "Ok"), false for rejection
 * @param {HTMLElement} esito - where to show the too-short error message
 * @returns {string|null} trimmed motivation, or null if cancelled or too short
 */
function chiediMotivazione(approvare, esito) {
  const messaggio = approvare
    ? "Motivazione dell'approvazione (obbligatoria):"
    : 'Motivazione del rifiuto (obbligatoria):';
  const inserito = prompt(messaggio, approvare ? 'Ok' : '');
  if (inserito === null) return null; // cancelled by the admin
  const motivazione = inserito.trim();
  if (motivazione.length < MIN_MOTIVAZIONE) {
    mostraMessaggio(esito, `La motivazione è obbligatoria (minimo ${MIN_MOTIVAZIONE} caratteri).`, 'errore');
    return null;
  }
  return motivazione;
}

/**
 * Readable outcome of an approval, by request type.
 * @param {string} tipo - request type
 * @param {{slot_inseriti?: number, slot_liberati?: number, richieste_approvate?: number}} risposta
 * @returns {string}
 */
function dettaglioApprovazione(tipo, risposta) {
  if (tipo === 'annullamento') return `annullamento approvato (${risposta.slot_liberati} slot liberati)`;
  if (tipo === 'modifica') return `modifica approvata (${risposta.slot_liberati} slot liberati, ${risposta.slot_inseriti} prenotati)`;
  return `richiesta approvata (${risposta.slot_inseriti} slot)`;
}

/**
 * Approves or rejects a pending entry: a single request through its own
 * endpoint, a group through the group endpoints (one decision for all).
 * @param {VoceAttesa} voce - pending entry
 * @param {boolean} approvare - true to approve, false to reject
 * @returns {Promise<void>}
 */
async function decidiVoce(voce, approvare) {
  const esito = elemento('esito-attesa');
  const motivazione = chiediMotivazione(approvare, esito);
  if (motivazione === null) return;
  const prima = voce.richieste[0];
  try {
    if (approvare) {
      const risposta = voce.gruppoId === null
        ? await approvaRichiesta(prima.id, motivazione)
        : await approvaGruppo(voce.gruppoId, motivazione);
      const gruppo = voce.gruppoId === null ? '' : ` su ${voce.richieste.length} date`;
      mostraMessaggio(esito, `${prima.societa}: ${dettaglioApprovazione(prima.tipo, risposta)}${gruppo}.`, 'ok');
    } else {
      if (voce.gruppoId === null) {
        await rifiutaRichiesta(prima.id, motivazione);
      } else {
        await rifiutaGruppo(voce.gruppoId, motivazione);
      }
      mostraMessaggio(esito, `Richiesta di ${prima.societa} rifiutata.`, 'ok');
    }
    await caricaInAttesa();
    await caricaCalendario();
  } catch (errore) {
    mostraMessaggio(esito, messaggioConflitti(errore), 'errore');
    await caricaInAttesa();
  }
}

/**
 * @param {object[]} ricorrenze - pending ricorrenze with società name
 * @returns {void}
 */
function renderRicorrenzeAttesa(ricorrenze) {
  const lista = elemento('lista-ricorrenze-attesa');
  lista.textContent = '';
  for (const ricorrenza of ricorrenze) {
    const riga = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'riga-info';
    const nome = document.createElement('strong');
    nome.textContent = ricorrenza.societa;
    const attivita = document.createElement('span');
    attivita.className = 'testo-tenue';
    attivita.textContent = ricorrenza.titolo;
    const quando = document.createElement('span');
    quando.textContent = `ogni ${elencoGiorni(ricorrenza.giorni)} · ${ricorrenza.ora_inizio}–${ricorrenza.ora_fine}`;
    const periodo = document.createElement('span');
    periodo.className = 'testo-tenue';
    periodo.textContent = `dal ${dataEstesa(ricorrenza.valida_dal)} al ${dataEstesa(ricorrenza.valida_al)}`;
    info.append(nome, attivita, quando, periodo);
    riga.append(info);
    if (ricorrenza.note) {
      const nota = document.createElement('p');
      nota.className = 'riga-nota';
      nota.textContent = ricorrenza.note;
      riga.append(nota);
    }
    riga.append(azioniDecisione(
      () => decidiRicorrenza(ricorrenza, true),
      () => decidiRicorrenza(ricorrenza, false),
    ));
    lista.append(riga);
  }
  elemento('vuoto-ricorrenze-attesa').hidden = ricorrenze.length > 0;
}

/**
 * @param {object} ricorrenza - pending ricorrenza
 * @param {boolean} approvare - true to approve (materialize), false to reject
 * @returns {Promise<void>}
 */
async function decidiRicorrenza(ricorrenza, approvare) {
  const esito = elemento('esito-attesa');
  const motivazione = chiediMotivazione(approvare, esito);
  if (motivazione === null) return;
  try {
    if (approvare) {
      const risposta = await approvaRicorrenza(ricorrenza.id, motivazione);
      mostraMessaggio(esito, `Ricorrenza di ${ricorrenza.societa} approvata: ${risposta.occorrenze.length} date prenotate (${risposta.occorrenze.map(dataEstesa).join(', ')}).`, 'ok');
    } else {
      await rifiutaRicorrenza(ricorrenza.id, motivazione);
      mostraMessaggio(esito, `Ricorrenza di ${ricorrenza.societa} rifiutata.`, 'ok');
    }
    await caricaInAttesa();
    await caricaCalendario();
  } catch (errore) {
    mostraMessaggio(esito, messaggioConflitti(errore), 'errore');
    await caricaInAttesa();
  }
}

/* -------------------------------------------------------------- calendario */

/** @returns {Promise<void>} reloads the interval currently on screen */
function caricaCalendario() {
  return g_vistaCalendario.aggiorna();
}

/**
 * Loads and renders the interval the toolbar asks for — a week or a month —
 * plus the list of its bookings. Stale responses are dropped, so fast
 * navigation always ends on the interval the user last asked for.
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
      ? await ottieniCalendarioAdminMese(intervallo.mese)
      : await ottieniCalendarioAdmin(intervallo.lunedi);
    if (versione !== g_versioneCalendario) return;
    renderLegendaCalendario(elemento('cal-legenda'), dati.prenotazioni);
    // One block per booking: the source of the details popup and of the list
    // under the calendar.
    const blocchi = raggruppaPrenotazioni(dati.prenotazioni);
    g_blocchi = new Map(blocchi.map((blocco) => [blocco.richiestaId, blocco]));
    if (eMese) {
      renderCalendarioMese(elemento('cal-griglia'), intervallo.mese, dati.prenotazioni, OPZIONI_CALENDARIO);
    } else {
      renderCalendarioSettimana(elemento('cal-griglia'), intervallo.lunedi, dati.prenotazioni, OPZIONI_CALENDARIO);
    }
    renderElencoPrenotazioni(blocchi, eMese);
    mostraMessaggio(statoCalendario, '');
  } catch (errore) {
    if (versione !== g_versioneCalendario) return;
    mostraMessaggio(statoCalendario, errore.message, 'errore');
  }
}

/**
 * Renders the list of the bookings of the shown interval; a future booking
 * has a "Dettagli" button opening the same popup as the calendar cells (with
 * Modifica and Annulla). Title and empty message follow the view, because the
 * list always mirrors what the calendar above it is showing.
 * @param {object[]} blocchi - bookings of the interval (utils.raggruppaPrenotazioni)
 * @param {boolean} eMese - true when the monthly view is on screen
 * @returns {void}
 */
function renderElencoPrenotazioni(blocchi, eMese) {
  elemento('cal-titolo-lista').textContent = eMese ? 'Prenotazioni del mese' : 'Prenotazioni della settimana';
  elemento('vuoto-prenotazioni').textContent = eMese
    ? 'Nessuna prenotazione in questo mese.'
    : 'Nessuna prenotazione in questa settimana.';

  const oggi = adessoRoma().data;
  const lista = elemento('lista-prenotazioni');
  lista.textContent = '';
  for (const blocco of blocchi) {
    const riga = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'riga-info';
    const nome = document.createElement('strong');
    nome.textContent = blocco.societa;
    const attivita = document.createElement('span');
    attivita.className = 'testo-tenue';
    attivita.textContent = blocco.titolo;
    const quando = document.createElement('span');
    quando.textContent = `${dataEstesa(blocco.data)} · ${blocco.oraInizio}–${blocco.oraFine}`;
    info.append(nome, attivita, quando);
    riga.append(info);

    if (blocco.data >= oggi) {
      riga.append(bottoneAzione('Dettagli', 'btn', () => apriDettagliPrenotazione(blocco.richiestaId)));
    }
    lista.append(riga);
  }
  elemento('vuoto-prenotazioni').hidden = blocchi.length > 0;
}

/* ------------------------------------------------- dettagli prenotazione */

/**
 * Opens the details popup of a booking of the interval on screen: what it is
 * (società, activity, date, time, notes, whether it belongs to a series) and
 * the two actions, Modifica and Annulla, each taking the ambito chosen in the
 * popup when the booking is recurring. Past bookings are read-only.
 * @param {number} richiestaId
 * @returns {void}
 */
function apriDettagliPrenotazione(richiestaId) {
  const blocco = g_blocchi.get(richiestaId);
  if (blocco === undefined) return;
  const adesso = adessoRoma();
  const futura = blocco.data > adesso.data || (blocco.data === adesso.data && blocco.oraInizio > adesso.ora);
  const ricorrente = blocco.ricorrenzaId !== null;
  g_dettagli.apri({
    titolo: 'Prenotazione',
    righe: [
      { etichetta: 'Società', valore: blocco.societa },
      { etichetta: 'Attività', valore: blocco.titolo },
      { etichetta: 'Data', valore: dataEstesa(blocco.data) },
      { etichetta: 'Orario', valore: `${blocco.oraInizio}–${blocco.oraFine}` },
      { etichetta: 'Note', valore: blocco.note ?? '' },
      { etichetta: 'Ricorrente', valore: ricorrente ? 'Sì, fa parte di una serie settimanale' : '' },
    ],
    ricorrente: ricorrente && futura,
    avviso: futura ? undefined : 'Prenotazione già iniziata o passata: non si può più modificare né annullare.',
    modifica: futura ? { testo: 'Modifica', azione: (ambito) => apriModificaPrenotazione(blocco, ambito) } : undefined,
    annulla: futura ? { testo: 'Annulla prenotazione', azione: (ambito) => annullaPrenotazione(blocco, ambito) } : undefined,
  });
}

/**
 * Cancels a booking (or that occurrence and the following ones of its series)
 * after confirmation, right away.
 * @param {object} blocco - booking from g_blocchi
 * @param {'singola'|'successive'} ambito
 * @returns {Promise<void>}
 */
async function annullaPrenotazione(blocco, ambito) {
  const descrizione = `${blocco.societa} del ${dataEstesa(blocco.data)} ${blocco.oraInizio}–${blocco.oraFine}`;
  const conferma = confirm(
    ambito === 'successive'
      ? `Annullare la prenotazione di ${descrizione} E TUTTE LE SUCCESSIVE della stessa serie?`
      : `Annullare la prenotazione di ${descrizione}?`,
  );
  if (!conferma) return;
  try {
    const risposta = await annullaRichiestaAdmin(blocco.richiestaId, ambito);
    g_dettagli.chiudi();
    const conteggio = risposta.richieste_annullate > 1 ? `${risposta.richieste_annullate} prenotazioni annullate` : 'Prenotazione annullata';
    mostraMessaggio(elemento('esito-cal'), `${conteggio} (${risposta.slot_liberati} slot liberati).`, 'ok');
    await caricaCalendario();
  } catch (errore) {
    mostraMessaggio(elemento('esito-dettagli'), errore.message, 'errore');
  }
}

/**
 * Opens the booking form in edit mode, prefilled with the booking. The
 * società cannot change (a booking belongs to who made it) and the repetition
 * block is hidden: a series is edited through the ambito, not by redefining
 * it. On "questa e le successive" the date is locked too, because only time,
 * activity and notes propagate to the series.
 * @param {object} blocco - booking from g_blocchi
 * @param {'singola'|'successive'} ambito
 * @returns {void}
 */
function apriModificaPrenotazione(blocco, ambito) {
  g_modifica = { blocco, ambito };
  g_dettagli.chiudi();
  const successive = ambito === 'successive';
  elemento('titolo-dialogo-diretta').textContent = successive ? 'Modifica prenotazione e successive' : 'Modifica prenotazione';
  elemento('bottone-diretta').textContent = 'Salva modifiche';
  const selettoreSocieta = elemento('dir-societa');
  selettoreSocieta.value = String(blocco.societaId);
  selettoreSocieta.disabled = true;
  elemento('dir-titolo').value = blocco.titolo;
  elemento('dir-data').value = blocco.data;
  elemento('dir-data').disabled = successive;
  elemento('dir-inizio').value = blocco.oraInizio;
  elemento('dir-fine').value = blocco.oraFine;
  elemento('dir-note').value = blocco.note ?? '';
  g_ripetizione.mostra(false);
  mostraMessaggio(elemento('esito-form'), '');
  elemento('dialogo-diretta').showModal();
}

/**
 * Puts the booking form back in create mode (title, button, enabled fields,
 * repetition block shown). Idempotent: called before every opening for a new
 * booking, so a previous edit never leaks into it.
 * @returns {void}
 */
function impostaModalitaNuova() {
  if (g_modifica === null) return;
  g_modifica = null;
  elemento('titolo-dialogo-diretta').textContent = 'Nuova prenotazione diretta';
  elemento('bottone-diretta').textContent = 'Prenota';
  elemento('dir-societa').disabled = false;
  elemento('dir-data').disabled = false;
  elemento('dir-titolo').value = TITOLO_PREDEFINITO;
  elemento('dir-note').value = '';
  g_ripetizione.mostra(true);
}

/* --------------------------------------------------- prenotazione diretta */

/**
 * Opens the direct booking popup on the slot whose "+" was pressed: the date
 * and the start time come from the slot, the end is the end of that same slot
 * (one PASSO_MIN step), which the admin can then widen in the form. The
 * società select keeps its current selection: the slot says nothing about it.
 * @param {string} giorno - 'YYYY-MM-DD' of the slot
 * @param {number} minuti - slot start, minutes from midnight
 * @returns {void}
 */
function apriDirettaPerSlot(giorno, minuti) {
  impostaModalitaNuova();
  elemento('dir-data').value = giorno;
  elemento('dir-inizio').value = oraTesto(minuti);
  elemento('dir-fine').value = oraTesto(minuti + PASSO_MIN);
  // The date was written programmatically, which fires no 'change' event:
  // everything tied to it (limits, locked weekday, preview) is refreshed by hand.
  g_ripetizione.aggiorna();
  // A stale error from a previous attempt must not greet the reopened dialog.
  mostraMessaggio(elemento('esito-form'), '');
  elemento('dialogo-diretta').showModal();
}

/**
 * Saves the booking form in edit mode: the new time, activity and notes (and
 * the new date, on a single occurrence) go straight to the booking, or to
 * that occurrence and the following ones of its series.
 * @param {HTMLElement} esitoForm - status element inside the popup
 * @returns {Promise<void>}
 */
async function salvaModifica(esitoForm) {
  const { blocco, ambito } = g_modifica;
  const corpo = {
    titolo: elemento('dir-titolo').value.trim(),
    ora_inizio: elemento('dir-inizio').value,
    ora_fine: elemento('dir-fine').value,
    note: elemento('dir-note').value.trim(),
    ambito,
  };
  if (ambito === 'singola') corpo.data = elemento('dir-data').value;
  const risposta = await modificaPrenotazioneAdmin(blocco.richiestaId, corpo);
  elemento('dialogo-diretta').close();
  const conteggio = risposta.richieste_modificate > 1 ? `${risposta.richieste_modificate} prenotazioni modificate` : 'Prenotazione modificata';
  mostraMessaggio(elemento('esito-cal'), `${conteggio} (${risposta.slot_inseriti} slot).`, 'ok');
  impostaModalitaNuova();
  mostraMessaggio(esitoForm, '');
  await caricaCalendario();
}

/**
 * @param {SubmitEvent} evento - booking form submit (new booking or edit)
 * @returns {Promise<void>}
 */
async function prenotaDiretta(evento) {
  evento.preventDefault();
  const esitoForm = elemento('esito-form');
  const bottoneInvio = elemento('bottone-diretta');
  if (g_modifica !== null) {
    bottoneInvio.disabled = true;
    try {
      await salvaModifica(esitoForm);
    } catch (errore) {
      // Errors (e.g. slot conflicts) stay inside the popup, so the admin can
      // adjust date or time without reopening it.
      mostraMessaggio(esitoForm, messaggioConflitti(errore), 'errore');
    } finally {
      bottoneInvio.disabled = false;
    }
    return;
  }
  const erroreRipetizione = g_ripetizione.erroreCampi();
  if (erroreRipetizione !== null) {
    mostraMessaggio(esitoForm, erroreRipetizione, 'errore');
    return;
  }
  const corpo = {
    societa_id: Number(elemento('dir-societa').value),
    titolo: elemento('dir-titolo').value.trim(),
    data: elemento('dir-data').value,
    ora_inizio: elemento('dir-inizio').value,
    ora_fine: elemento('dir-fine').value,
    note: elemento('dir-note').value.trim(),
    ...g_ripetizione.campiRichiesta(),
  };

  const bottone = elemento('bottone-diretta');
  bottone.disabled = true;
  try {
    const risposta = await creaPrenotazioneDiretta(corpo);
    // Success closes the popup: the confirmation goes to the page-level
    // status next to the calendar, where it stays readable.
    elemento('dialogo-diretta').close();
    if (risposta.tipo === 'ricorrenza') {
      const dateLeggibili = risposta.occorrenze.map(dataEstesa).join(', ');
      mostraMessaggio(
        elemento('esito-diretta'),
        `Prenotazione ricorrente registrata: ${risposta.occorrenze.length} date (${dateLeggibili}), ${risposta.slot_inseriti} slot.`,
        'ok',
      );
    } else {
      mostraMessaggio(elemento('esito-diretta'), `Prenotazione registrata (${risposta.slot_inseriti} slot).`, 'ok');
    }
    elemento('dir-titolo').value = TITOLO_PREDEFINITO;
    elemento('dir-note').value = '';
    g_ripetizione.azzera();
    await caricaCalendario();
  } catch (errore) {
    // Errors (e.g. slot conflicts) stay inside the popup, so the admin can
    // adjust date or time without reopening it.
    mostraMessaggio(esitoForm, messaggioConflitti(errore), 'errore');
  } finally {
    bottone.disabled = false;
  }
}

/* ------------------------------------------------------------------ report */

/**
 * @param {string} tag - 'td' or 'th'
 * @param {string} testo - cell text
 * @param {boolean} [numerica] - right-aligned numeric cell
 * @returns {HTMLTableCellElement}
 */
function cellaReport(tag, testo, numerica = false) {
  const cella = document.createElement(tag);
  if (numerica) cella.className = 'cella-numero';
  cella.textContent = testo;
  return cella;
}

/** @returns {Promise<void>} loads and renders the monthly report */
async function caricaReport() {
  const mese = elemento('report-mese').value;
  if (!mese) return;
  const esito = elemento('esito-report');
  try {
    const dati = await ottieniReport(mese);
    renderReport(dati);
    mostraMessaggio(esito, '');
  } catch (errore) {
    mostraMessaggio(esito, errore.message, 'errore');
  }
}

/**
 * @param {{mese: string, righe: {societa: string, tariffa_oraria: number, ore: number, importo: number}[], totale: {ore: number, importo: number}}} dati
 * @returns {void}
 */
function renderReport(dati) {
  const corpoTabella = elemento('report-righe');
  corpoTabella.textContent = '';
  for (const riga of dati.righe) {
    const tr = document.createElement('tr');
    tr.append(
      cellaReport('td', riga.societa),
      cellaReport('td', numeroItaliano(riga.ore, 1), true),
      cellaReport('td', numeroItaliano(riga.tariffa_oraria, 2), true),
      cellaReport('td', numeroItaliano(riga.importo, 2), true),
    );
    corpoTabella.append(tr);
  }

  const rigaTotale = elemento('report-totale');
  rigaTotale.textContent = '';
  rigaTotale.append(
    cellaReport('th', 'Totale'),
    cellaReport('th', numeroItaliano(dati.totale.ore, 1), true),
    cellaReport('th', ''),
    cellaReport('th', numeroItaliano(dati.totale.importo, 2), true),
  );

  const conDati = dati.righe.length > 0;
  elemento('tabella-report').hidden = !conDati;
  elemento('vuoto-report').hidden = conDati;
  const linkCsv = elemento('report-csv');
  linkCsv.href = `/api/admin/report.csv?mese=${dati.mese}`;
  linkCsv.hidden = !conDati;
}

/* ----------------------------------------------------------------- società */

/**
 * @returns {Promise<object[]>} reloads and renders the società list
 */
async function caricaSocieta() {
  const dati = await ottieniElencoSocieta();
  renderSocieta(dati.societa);
  aggiornaSelectDiretta(dati.societa);
  return dati.societa;
}

/**
 * @param {object[]} societa - full società list
 * @returns {void} fills the direct-booking select with the active ones
 */
function aggiornaSelectDiretta(societa) {
  if (!societa) return;
  const selettore = elemento('dir-societa');
  const valorePrecedente = selettore.value;
  selettore.textContent = '';
  for (const soc of societa.filter((s) => s.stato === 'attiva')) {
    selettore.append(new Option(soc.nome, String(soc.id)));
  }
  if (valorePrecedente) selettore.value = valorePrecedente;
  if (!selettore.value && selettore.options.length > 0) selettore.selectedIndex = 0;
}

/**
 * @param {object[]} societa - full società list
 * @returns {void}
 */
function renderSocieta(societa) {
  const lista = elemento('lista-societa');
  lista.textContent = '';
  for (const soc of societa) {
    const riga = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'riga-info';
    const nome = document.createElement('strong');
    nome.textContent = soc.nome;
    info.append(creaQuadrettoColore(soc.colore), nome, creaBadge(soc.stato));
    riga.append(info);

    const dettagli = document.createElement('p');
    dettagli.className = 'riga-nota';
    dettagli.textContent = [
      soc.referente,
      soc.email,
      soc.telefono,
      `tariffa ${numeroItaliano(soc.tariffa_oraria, 2)} €/h`,
    ].filter(Boolean).join(' · ');
    riga.append(dettagli);

    const azioni = document.createElement('div');
    azioni.className = 'riga-azioni';
    azioni.append(
      bottoneAzione('Copia link', 'btn', (bottone) => copiaLink(soc, bottone)),
      bottoneAzione('Modifica', 'btn', () => apriModificaSocieta(soc)),
      bottoneAzione('Rigenera link', 'btn', () => rigenera(soc)),
      soc.stato === 'attiva'
        ? bottoneAzione('Sospendi', 'btn btn-pericolo', () => sospendi(soc))
        : bottoneAzione('Riattiva', 'btn', () => riattiva(soc)),
    );
    riga.append(azioni);
    lista.append(riga);
  }
  elemento('vuoto-societa').hidden = societa.length > 0;
}

/**
 * @param {string} testo - button label
 * @param {string} classi - CSS classes (btn-piccolo is added)
 * @param {(bottone: HTMLButtonElement) => void} azione - click handler
 * @returns {HTMLButtonElement}
 */
function bottoneAzione(testo, classi, azione) {
  const bottone = document.createElement('button');
  bottone.type = 'button';
  bottone.className = `${classi} btn-piccolo`;
  bottone.textContent = testo;
  bottone.addEventListener('click', () => azione(bottone));
  return bottone;
}

/**
 * @param {object} soc - società row (carries link_accesso)
 * @param {HTMLButtonElement} bottone - button to give feedback on
 * @returns {Promise<void>}
 */
async function copiaLink(soc, bottone) {
  try {
    await navigator.clipboard.writeText(soc.link_accesso);
    const testoOriginale = bottone.textContent;
    bottone.textContent = 'Copiato';
    setTimeout(() => { bottone.textContent = testoOriginale; }, 2000);
  } catch {
    mostraMessaggio(elemento('esito-societa'), `Link di ${soc.nome}: ${soc.link_accesso}`, 'ok');
  }
}

/**
 * Fills the società dialog form for create mode (null) or edit mode.
 * Does not open the dialog: the caller decides (the "Nuova società" button
 * is already wired to showModal() by preparaDialogo).
 * @param {object|null} soc - società to edit, or null for a blank form
 * @returns {void}
 */
function impostaFormSocieta(soc) {
  g_societaInModifica = soc;
  elemento('titolo-dialogo-societa').textContent = soc ? `Modifica: ${soc.nome}` : 'Nuova società';
  elemento('bottone-societa').textContent = soc ? 'Salva modifiche' : 'Crea società';
  elemento('soc-nome').value = soc?.nome ?? '';
  elemento('soc-referente').value = soc?.referente ?? '';
  elemento('soc-email').value = soc?.email ?? '';
  elemento('soc-telefono').value = soc?.telefono ?? '';
  elemento('soc-tariffa').value = soc ? String(soc.tariffa_oraria) : '';
  elemento('soc-colore').value = eColoreEsadecimale(soc?.colore) ? soc.colore : COLORE_PREDEFINITO;
  // A stale error from a previous attempt must not greet the reopened dialog.
  mostraMessaggio(elemento('esito-form-societa'), '');
}

/**
 * Opens the società dialog prefilled with the data of an existing società.
 * @param {object} soc - società to edit
 * @returns {void}
 */
function apriModificaSocieta(soc) {
  impostaFormSocieta(soc);
  elemento('dialogo-societa').showModal();
}

/**
 * @param {SubmitEvent} evento - società form submit (create or edit)
 * @returns {Promise<void>}
 */
async function salvaSocieta(evento) {
  evento.preventDefault();
  const corpo = {
    nome: elemento('soc-nome').value.trim(),
    referente: elemento('soc-referente').value.trim(),
    email: elemento('soc-email').value.trim(),
    telefono: elemento('soc-telefono').value.trim(),
    colore: elemento('soc-colore').value,
    tariffa_oraria: Number(elemento('soc-tariffa').value),
  };
  try {
    // Success closes the popup: the confirmation goes to the page-level
    // status next to the società list, where it stays readable.
    if (g_societaInModifica) {
      await aggiornaSocietaAdmin(g_societaInModifica.id, corpo);
      mostraMessaggio(elemento('esito-societa'), 'Società aggiornata.', 'ok');
    } else {
      const creata = await creaSocietaAdmin(corpo);
      mostraMessaggio(elemento('esito-societa'), `Società creata. Link personale da consegnare: ${creata.link_accesso}`, 'ok');
    }
    elemento('dialogo-societa').close();
    await caricaSocieta();
    await caricaReport(); // the report importi depend on the tariffa
  } catch (errore) {
    // Errors stay inside the popup, so the admin can fix the fields
    // without reopening it.
    mostraMessaggio(elemento('esito-form-societa'), errore.message, 'errore');
  }
}

/**
 * @param {object} soc - società to suspend
 * @returns {Promise<void>}
 */
async function sospendi(soc) {
  const conferma = confirm(
    `Sospendere ${soc.nome}?\n\nATTENZIONE: tutte le sue prenotazioni future verranno cancellate, le richieste in attesa annullate e il link di accesso smetterà di funzionare.`,
  );
  if (!conferma) return;
  try {
    const risposta = await sospendiSocieta(soc.id);
    mostraMessaggio(
      elemento('esito-societa'),
      `${soc.nome} sospesa: liberati ${risposta.slot_liberati} slot, annullate ${risposta.richieste_annullate} richieste.`,
      'ok',
    );
    await caricaSocieta();
    await caricaInAttesa();
    await caricaCalendario();
  } catch (errore) {
    mostraMessaggio(elemento('esito-societa'), errore.message, 'errore');
  }
}

/**
 * @param {object} soc - società to reactivate
 * @returns {Promise<void>}
 */
async function riattiva(soc) {
  try {
    await riattivaSocieta(soc.id);
    mostraMessaggio(elemento('esito-societa'), `${soc.nome} riattivata (le prenotazioni annullate NON vengono ripristinate).`, 'ok');
    await caricaSocieta();
  } catch (errore) {
    mostraMessaggio(elemento('esito-societa'), errore.message, 'errore');
  }
}

/**
 * @param {object} soc - società whose personal link is regenerated
 * @returns {Promise<void>}
 */
async function rigenera(soc) {
  const conferma = confirm(`Rigenerare il link di ${soc.nome}?\n\nIl vecchio link smetterà subito di funzionare.`);
  if (!conferma) return;
  try {
    const risposta = await rigeneraTokenSocieta(soc.id);
    mostraMessaggio(elemento('esito-societa'), `Nuovo link per ${soc.nome}: ${risposta.link_accesso}`, 'ok');
    await caricaSocieta();
  } catch (errore) {
    mostraMessaggio(elemento('esito-societa'), errore.message, 'errore');
  }
}

avvia();
