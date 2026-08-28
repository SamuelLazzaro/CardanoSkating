/*
 * admin.js — entry point of the admin panel. Shows the login form until an
 * admin session cookie is present, then three sections behind the nav
 * (js/navigazione.js): Home with the full weekly calendar (società names,
 * per-date cancellation, direct bookings) and the monthly report; Notifiche
 * with the pending richieste/ricorrenze to approve/reject, counted by the
 * bell badge; Società with the società management (create, edit,
 * suspend/reactivate, personal-link regeneration).
 */
import { avviaTapFeedback } from './tap-feedback.js';
import { COLORE_PREDEFINITO, MIN_MOTIVAZIONE, PASSO_MIN, TITOLO_PREDEFINITO } from './constants.js';
import {
  adessoRoma,
  aggiungiGiorni,
  chiaveSlot,
  dataEstesa,
  eColoreEsadecimale,
  elencoGiorni,
  etichettaGiorno,
  formattaSlotKey,
  giorniGrigliaMese,
  giorniSettimana,
  minutiDaOra,
  numeroItaliano,
  oraTesto,
  raggruppaPrenotazioni,
} from './utils.js';
import {
  accediAdmin,
  aggiornaSocietaAdmin,
  annullaRichiestaAdmin,
  approvaRicorrenza,
  approvaRichiesta,
  creaPrenotazioneDiretta,
  creaSocietaAdmin,
  esciAdmin,
  ottieniCalendarioAdmin,
  ottieniCalendarioAdminMese,
  ottieniElencoSocieta,
  ottieniReport,
  ottieniRichiesteAdmin,
  ottieniRicorrenzeAdmin,
  riattivaSocieta,
  rifiutaRicorrenza,
  rifiutaRichiesta,
  rigeneraTokenSocieta,
  sospendiSocieta,
} from './api.js';
import {
  aggiungiBottoneGiorno,
  aggiungiBottoneSlot,
  costruisciGriglia,
  costruisciGrigliaMese,
  creaBadge,
  creaVoceMese,
  mostraMessaggio,
  preparaDialogo,
  preparaDrillDownGiorno,
  preparaScorciatoiaSlot,
  preparaSelectOrari,
} from './ui.js';
import { creaVistaCalendario } from './vista-calendario.js';
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

/** @type {object|null} week/month state of the calendar panel (js/vista-calendario.js) */
let g_vistaCalendario = null;

/** @type {number} counter to ignore stale calendar responses */
let g_versioneCalendario = 0;

/** @type {object|null} società being edited in the form, null = create mode */
let g_societaInModifica = null;

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

  preparaDialogo(
    elemento('dialogo-diretta'),
    elemento('bottone-nuova-prenotazione'),
    elemento('bottone-chiudi-dialogo'),
  );
  // A stale error from a previous attempt must not greet the reopened dialog.
  elemento('bottone-nuova-prenotazione').addEventListener('click', () => mostraMessaggio(elemento('esito-form'), ''));

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
  renderRichiesteAttesa(richieste.richieste);
  renderRicorrenzeAttesa(ricorrenze.ricorrenze);
  // The bell badge mirrors this section: anything still waiting for a
  // decision. Every caller of caricaInAttesa (login, approve/reject,
  // suspension cascade) therefore keeps the counter up to date for free.
  aggiornaBadgeNotifiche(
    elemento('badge-notifiche'),
    richieste.richieste.length + ricorrenze.ricorrenze.length,
  );
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
 * @param {object[]} richieste - pending richieste with società name
 * @returns {void}
 */
function renderRichiesteAttesa(richieste) {
  const lista = elemento('lista-richieste-attesa');
  lista.textContent = '';
  for (const richiesta of richieste) {
    const riga = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'riga-info';
    const nome = document.createElement('strong');
    nome.textContent = richiesta.societa;
    const attivita = document.createElement('span');
    attivita.className = 'testo-tenue';
    attivita.textContent = richiesta.titolo;
    const quando = document.createElement('span');
    quando.textContent = `${dataEstesa(richiesta.data)} · ${richiesta.ora_inizio}–${richiesta.ora_fine}`;
    info.append(nome, attivita, quando);
    // Annullamento requests share the pending list but must stand out:
    // approving one FREES the referenced booking instead of adding slots.
    if (richiesta.tipo === 'annullamento') info.append(creaBadge('annullamento'));
    riga.append(info);
    if (richiesta.note) {
      const nota = document.createElement('p');
      nota.className = 'riga-nota';
      nota.textContent = richiesta.note;
      riga.append(nota);
    }
    riga.append(azioniDecisione(
      () => decidiRichiesta(richiesta, true),
      () => decidiRichiesta(richiesta, false),
    ));
    lista.append(riga);
  }
  elemento('vuoto-richieste-attesa').hidden = richieste.length > 0;
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
 * @param {object} richiesta - pending richiesta
 * @param {boolean} approvare - true to approve, false to reject
 * @returns {Promise<void>}
 */
async function decidiRichiesta(richiesta, approvare) {
  const esito = elemento('esito-attesa');
  const motivazione = chiediMotivazione(approvare, esito);
  if (motivazione === null) return;
  try {
    if (approvare) {
      const risposta = await approvaRichiesta(richiesta.id, motivazione);
      const dettaglio = richiesta.tipo === 'annullamento'
        ? `annullamento approvato (${risposta.slot_liberati} slot liberati)`
        : `richiesta approvata (${risposta.slot_inseriti} slot)`;
      mostraMessaggio(esito, `${richiesta.societa}: ${dettaglio}.`, 'ok');
    } else {
      await rifiutaRichiesta(richiesta.id, motivazione);
      mostraMessaggio(esito, `Richiesta di ${richiesta.societa} rifiutata.`, 'ok');
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
    elemento('cal-griglia').setAttribute(
      'aria-label',
      `Calendario ${eMese ? 'mensile' : 'settimanale'} con i nomi delle società`,
    );
    renderLegendaCalendario(dati.prenotazioni);
    if (eMese) {
      renderCalendarioMese(intervallo.mese, dati.prenotazioni);
    } else {
      renderCalendarioSettimana(intervallo.lunedi, dati.prenotazioni);
    }
    renderElencoPrenotazioni(dati.prenotazioni, eMese);
    mostraMessaggio(statoCalendario, '');
  } catch (errore) {
    if (versione !== g_versioneCalendario) return;
    mostraMessaggio(statoCalendario, errore.message, 'errore');
  }
}

/**
 * Small colored square used in the legend and in the società list. The color
 * is re-validated before touching the inline style (defence in depth: it is
 * data coming from the DB).
 * @param {string} colore - '#RRGGBB' società color from the API
 * @returns {HTMLSpanElement}
 */
function creaQuadrettoColore(colore) {
  const quadretto = document.createElement('span');
  quadretto.className = 'quadretto';
  if (eColoreEsadecimale(colore)) {
    quadretto.style.background = colore;
    quadretto.style.borderColor = colore;
  }
  return quadretto;
}

/**
 * Renders the società↔color legend of the shown week (one chip per società
 * with at least one booking).
 * @param {{societa_id: number, societa: string, colore: string}[]} prenotazioni
 * @returns {void}
 */
function renderLegendaCalendario(prenotazioni) {
  /** @type {Map<number, {societa: string, colore: string}>} */
  const perSocieta = new Map(prenotazioni.map((p) => [p.societa_id, p]));
  const legenda = elemento('cal-legenda');
  legenda.textContent = '';
  const ordinate = [...perSocieta.values()].sort((a, b) => a.societa.localeCompare(b.societa));
  for (const voce of ordinate) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const nome = document.createElement('span');
    nome.textContent = voce.societa;
    chip.append(creaQuadrettoColore(voce.colore), nome);
    legenda.append(chip);
  }
  legenda.hidden = ordinate.length === 0;
}

/**
 * @param {string} lunedi - Monday of the week to draw, 'YYYY-MM-DD'
 * @param {{slot_key: string, societa: string, colore: string, richiesta_id: number, titolo: string}[]} prenotazioni
 * @returns {void}
 */
function renderCalendarioSettimana(lunedi, prenotazioni) {
  /** @type {Map<string, {societa: string, colore: string, richiesta_id: number, titolo: string}>} */
  const perChiave = new Map(prenotazioni.map((p) => [p.slot_key, p]));
  const adesso = adessoRoma();
  const chiaveAdesso = chiaveSlot(adesso.data, Math.floor(adesso.minuti / PASSO_MIN) * PASSO_MIN);

  costruisciGriglia(
    elemento('cal-griglia'),
    giorniSettimana(lunedi),
    (cella, giorno, minuti) => {
      const chiave = chiaveSlot(giorno, minuti);
      const prenotazione = perChiave.get(chiave);
      const etichetta = etichettaGiorno(giorno);
      let descrizione = 'libero';
      if (prenotazione) {
        cella.classList.add('occupato');
        if (eColoreEsadecimale(prenotazione.colore)) {
          cella.classList.add('colorato');
          cella.style.setProperty('--colore-societa', prenotazione.colore);
        }
        descrizione = `${prenotazione.societa} · ${prenotazione.titolo}`;
        /*
         * Block label: società name plus activity title, written only in the
         * first slot of each booked block. To keep every grid row at its
         * fixed height, the label is an absolutely positioned overlay sized
         * on the number of consecutive slots of the same richiesta (CSS var
         * --slot-del-blocco, see .blocco-etichetta): the slot height fits
         * both text lines, the overlay height only clips overflowing text at
         * the block boundary so it never covers a different booking.
         */
        const chiavePrecedente = chiaveSlot(giorno, minuti - PASSO_MIN);
        const inizioBlocco = perChiave.get(chiavePrecedente)?.richiesta_id !== prenotazione.richiesta_id;
        if (inizioBlocco) {
          let slotDelBlocco = 1;
          while (perChiave.get(chiaveSlot(giorno, minuti + slotDelBlocco * PASSO_MIN))?.richiesta_id === prenotazione.richiesta_id) {
            slotDelBlocco += 1;
          }
          const etichettaBlocco = document.createElement('span');
          etichettaBlocco.className = 'blocco-etichetta';
          etichettaBlocco.style.setProperty('--slot-del-blocco', String(slotDelBlocco));
          const nome = document.createElement('span');
          nome.className = 'slot-nome';
          nome.textContent = prenotazione.societa;
          const attivita = document.createElement('span');
          attivita.className = 'slot-attivita';
          attivita.textContent = prenotazione.titolo;
          etichettaBlocco.append(nome, attivita);
          cella.classList.add('con-etichetta');
          cella.append(etichettaBlocco);
        }
      }
      const passato = chiave < chiaveAdesso;
      if (passato) cella.classList.add('passato');
      if (giorno === adesso.data) cella.classList.add('colonna-oggi');
      // Only a free future slot can be booked, so only there the "+"
      // shortcut makes sense: elsewhere the popup would be born rejected.
      if (!prenotazione && !passato) aggiungiBottoneSlot(cella, giorno, minuti);
      cella.title = `${etichetta.nomeGiorno} ${etichetta.dataBreve} · ${oraTesto(minuti)}–${oraTesto(minuti + PASSO_MIN)} · ${descrizione}`;
    },
    (testata, giorno) => {
      if (giorno === adesso.data) testata.classList.add('oggi');
    },
  );
}

/**
 * Renders the monthly view: one entry per booking inside the cell of its day,
 * painted with the color of the società that booked it. A day with more
 * bookings than its cell can show scrolls inside the cell (see .mese-voci).
 * @param {string} mese - month to draw, 'YYYY-MM'
 * @param {{slot_key: string, societa_id: number, societa: string, colore: string, richiesta_id: number, titolo: string}[]} prenotazioni
 * @returns {void}
 */
function renderCalendarioMese(mese, prenotazioni) {
  /** @type {Map<string, object[]>} bookings of the grid, by date */
  const perGiorno = new Map();
  // Chronological order in, chronological order out: every cell lists its
  // bookings from the earliest to the latest.
  for (const blocco of raggruppaPrenotazioni(prenotazioni)) {
    const delGiorno = perGiorno.get(blocco.data);
    if (delGiorno === undefined) {
      perGiorno.set(blocco.data, [blocco]);
    } else {
      delGiorno.push(blocco);
    }
  }

  const oggi = adessoRoma().data;
  costruisciGrigliaMese(elemento('cal-griglia'), mese, giorniGrigliaMese(mese), (cella, voci, giorno) => {
    if (giorno < oggi) cella.classList.add('passato');
    if (giorno === oggi) cella.classList.add('oggi');
    for (const blocco of perGiorno.get(giorno) ?? []) {
      const orario = `${blocco.oraInizio}–${blocco.oraFine}`;
      voci.append(creaVoceMese({
        orario,
        etichetta: blocco.societa,
        stato: 'occupato',
        colore: blocco.colore,
        descrizione: `${dataEstesa(giorno)} · ${orario} · ${blocco.societa} · ${blocco.titolo}`,
      }));
    }
    // Only a day that is not over can host a new booking, so only there the
    // "+" shortcut makes sense: elsewhere the popup would be born rejected.
    if (giorno >= oggi) aggiungiBottoneGiorno(cella, giorno, minutiDaOra(ORA_PREDEFINITA));
  });
}

/**
 * Renders the list of the bookings of the shown interval, with the per-date
 * cancel action. Title and empty message follow the view, because the list
 * always mirrors what the calendar above it is showing.
 * @param {{slot_key: string, societa: string, richiesta_id: number, titolo: string}[]} prenotazioni
 * @param {boolean} eMese - true when the monthly view is on screen
 * @returns {void}
 */
function renderElencoPrenotazioni(prenotazioni, eMese) {
  elemento('cal-titolo-lista').textContent = eMese ? 'Prenotazioni del mese' : 'Prenotazioni della settimana';
  elemento('vuoto-prenotazioni').textContent = eMese
    ? 'Nessuna prenotazione in questo mese.'
    : 'Nessuna prenotazione in questa settimana.';

  const oggi = adessoRoma().data;
  const lista = elemento('lista-prenotazioni');
  lista.textContent = '';
  const blocchi = raggruppaPrenotazioni(prenotazioni);
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
      const bottone = document.createElement('button');
      bottone.type = 'button';
      bottone.className = 'btn btn-pericolo btn-piccolo';
      bottone.textContent = 'Annulla';
      bottone.addEventListener('click', () => annullaData(blocco.richiestaId, blocco.societa, blocco.data, blocco.oraInizio, blocco.oraFine));
      riga.append(bottone);
    }
    lista.append(riga);
  }
  elemento('vuoto-prenotazioni').hidden = blocchi.length > 0;
}

/**
 * Cancels a single date (its richiesta) after confirmation.
 * @param {number} richiestaId
 * @param {string} societa - società name, for the confirm message
 * @param {string} data - 'YYYY-MM-DD'
 * @param {string} oraInizio - 'HH:MM'
 * @param {string} oraFine - 'HH:MM'
 * @returns {Promise<void>}
 */
async function annullaData(richiestaId, societa, data, oraInizio, oraFine) {
  const conferma = confirm(`Annullare la prenotazione di ${societa} del ${dataEstesa(data)} ${oraInizio}–${oraFine}?`);
  if (!conferma) return;
  try {
    await annullaRichiestaAdmin(richiestaId);
    mostraMessaggio(elemento('esito-cal'), 'Prenotazione annullata.', 'ok');
    await caricaCalendario();
  } catch (errore) {
    mostraMessaggio(elemento('esito-cal'), errore.message, 'errore');
  }
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
  elemento('dir-data').value = giorno;
  elemento('dir-inizio').value = oraTesto(minuti);
  elemento('dir-fine').value = oraTesto(minuti + PASSO_MIN);
  // A stale error from a previous attempt must not greet the reopened dialog.
  mostraMessaggio(elemento('esito-form'), '');
  elemento('dialogo-diretta').showModal();
}

/**
 * @param {SubmitEvent} evento - direct booking form submit
 * @returns {Promise<void>}
 */
async function prenotaDiretta(evento) {
  evento.preventDefault();
  const bottone = elemento('bottone-diretta');
  bottone.disabled = true;
  try {
    const risposta = await creaPrenotazioneDiretta({
      societa_id: Number(elemento('dir-societa').value),
      titolo: elemento('dir-titolo').value.trim(),
      data: elemento('dir-data').value,
      ora_inizio: elemento('dir-inizio').value,
      ora_fine: elemento('dir-fine').value,
      note: elemento('dir-note').value.trim(),
    });
    // Success closes the popup: the confirmation goes to the page-level
    // status next to the calendar, where it stays readable.
    elemento('dialogo-diretta').close();
    mostraMessaggio(elemento('esito-diretta'), `Prenotazione registrata (${risposta.slot_inseriti} slot).`, 'ok');
    elemento('dir-titolo').value = TITOLO_PREDEFINITO;
    elemento('dir-note').value = '';
    await caricaCalendario();
  } catch (errore) {
    // Errors (e.g. slot conflicts) stay inside the popup, so the admin can
    // adjust date or time without reopening it.
    mostraMessaggio(elemento('esito-form'), messaggioConflitti(errore), 'errore');
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
