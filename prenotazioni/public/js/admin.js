/*
 * admin.js — entry point of the admin panel. Shows the login form until an
 * admin session cookie is present, then: pending richieste/ricorrenze with
 * approve/reject, full weekly calendar with società names and per-date
 * cancellation, direct bookings, and società management (create, edit,
 * suspend/reactivate, personal-link regeneration).
 */
import { avviaTapFeedback } from './tap-feedback.js';
import { NOMI_GIORNI, PASSO_MIN } from './constants.js';
import {
  adessoRoma,
  aggiungiGiorni,
  chiaveSlot,
  dataEstesa,
  etichettaGiorno,
  formattaSlotKey,
  giorniSettimana,
  lunediDellaSettimana,
  minutiDaOra,
  oraTesto,
  titoloSettimana,
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
  ottieniElencoSocieta,
  ottieniRichiesteAdmin,
  ottieniRicorrenzeAdmin,
  riattivaSocieta,
  rifiutaRicorrenza,
  rifiutaRichiesta,
  rigeneraTokenSocieta,
  sospendiSocieta,
} from './api.js';
import { costruisciGriglia, creaBadge, mostraMessaggio, preparaSelectOrari } from './ui.js';

// First thing on every page: its capture listener must precede all others.
avviaTapFeedback();

/** @type {(id: string) => HTMLElement} */
const elemento = (id) => document.getElementById(id);

/** @type {string} Monday of the week shown in the admin calendar */
let g_lunediAdmin = lunediDellaSettimana(adessoRoma().data);

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
  preparaSelectOrari(elemento('dir-inizio'), elemento('dir-fine'), '10:00', '11:00');
  const oggi = adessoRoma().data;
  const campoData = elemento('dir-data');
  campoData.min = oggi;
  campoData.max = aggiungiGiorni(oggi, 365);
  campoData.value = aggiungiGiorni(oggi, 1);

  elemento('form-login').addEventListener('submit', accedi);
  elemento('bottone-esci').addEventListener('click', esci);
  elemento('form-diretta').addEventListener('submit', prenotaDiretta);
  elemento('form-societa').addEventListener('submit', salvaSocieta);
  elemento('bottone-annulla-modifica').addEventListener('click', () => impostaModifica(null));
  elemento('cal-precedente').addEventListener('click', () => spostaSettimana(-7));
  elemento('cal-successiva').addEventListener('click', () => spostaSettimana(7));
  elemento('cal-oggi').addEventListener('click', () => {
    g_lunediAdmin = lunediDellaSettimana(adessoRoma().data);
    caricaCalendario();
  });
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
  await caricaCalendario();
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
    const quando = document.createElement('span');
    quando.textContent = `${dataEstesa(richiesta.data)} · ${richiesta.ora_inizio}–${richiesta.ora_fine}`;
    info.append(nome, quando);
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
 * @param {object} richiesta - pending richiesta
 * @param {boolean} approvare - true to approve, false to reject
 * @returns {Promise<void>}
 */
async function decidiRichiesta(richiesta, approvare) {
  const esito = elemento('esito-attesa');
  try {
    if (approvare) {
      const risposta = await approvaRichiesta(richiesta.id);
      mostraMessaggio(esito, `Richiesta di ${richiesta.societa} approvata (${risposta.slot_inseriti} slot).`, 'ok');
    } else {
      const motivo = prompt('Motivo del rifiuto (facoltativo):');
      if (motivo === null) return; // annullato dall'admin
      await rifiutaRichiesta(richiesta.id, motivo);
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
    const quando = document.createElement('span');
    quando.textContent = `ogni ${NOMI_GIORNI[ricorrenza.giorno_settimana]} · ${ricorrenza.ora_inizio}–${ricorrenza.ora_fine}`;
    const periodo = document.createElement('span');
    periodo.className = 'testo-tenue';
    periodo.textContent = `dal ${dataEstesa(ricorrenza.valida_dal)} al ${dataEstesa(ricorrenza.valida_al)}`;
    info.append(nome, quando, periodo);
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
  try {
    if (approvare) {
      const risposta = await approvaRicorrenza(ricorrenza.id);
      mostraMessaggio(esito, `Ricorrenza di ${ricorrenza.societa} approvata: ${risposta.occorrenze.length} date prenotate (${risposta.occorrenze.map(dataEstesa).join(', ')}).`, 'ok');
    } else {
      await rifiutaRicorrenza(ricorrenza.id);
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

/**
 * @param {number} giorni - +7 or -7
 * @returns {void}
 */
function spostaSettimana(giorni) {
  g_lunediAdmin = aggiungiGiorni(g_lunediAdmin, giorni);
  caricaCalendario();
}

/** @returns {Promise<void>} loads and renders the admin week (grid + list) */
async function caricaCalendario() {
  const versione = ++g_versioneCalendario;
  elemento('cal-titolo').textContent = titoloSettimana(g_lunediAdmin);
  elemento('cal-oggi').disabled = g_lunediAdmin === lunediDellaSettimana(adessoRoma().data);
  const statoCalendario = elemento('cal-stato');
  mostraMessaggio(statoCalendario, 'Caricamento…');
  try {
    const dati = await ottieniCalendarioAdmin(g_lunediAdmin);
    if (versione !== g_versioneCalendario) return;
    renderCalendario(dati.prenotazioni);
    renderPrenotazioniSettimana(dati.prenotazioni);
    mostraMessaggio(statoCalendario, '');
  } catch (errore) {
    if (versione !== g_versioneCalendario) return;
    mostraMessaggio(statoCalendario, errore.message, 'errore');
  }
}

/**
 * @param {{slot_key: string, societa: string, richiesta_id: number}[]} prenotazioni
 * @returns {void}
 */
function renderCalendario(prenotazioni) {
  /** @type {Map<string, {societa: string, richiesta_id: number}>} */
  const perChiave = new Map(prenotazioni.map((p) => [p.slot_key, p]));
  const adesso = adessoRoma();
  const chiaveAdesso = chiaveSlot(adesso.data, Math.floor(adesso.minuti / PASSO_MIN) * PASSO_MIN);

  costruisciGriglia(
    elemento('cal-griglia'),
    giorniSettimana(g_lunediAdmin),
    (cella, giorno, minuti) => {
      const chiave = chiaveSlot(giorno, minuti);
      const prenotazione = perChiave.get(chiave);
      const etichetta = etichettaGiorno(giorno);
      let descrizione = 'libero';
      if (prenotazione) {
        cella.classList.add('occupato');
        descrizione = prenotazione.societa;
        // The società name is written only in the first slot of each booked
        // block, so a 3-slot training shows one readable label, not three.
        const chiavePrecedente = chiaveSlot(giorno, minuti - PASSO_MIN);
        const inizioBlocco = perChiave.get(chiavePrecedente)?.richiesta_id !== prenotazione.richiesta_id;
        if (inizioBlocco) {
          const nome = document.createElement('span');
          nome.className = 'slot-nome';
          nome.textContent = prenotazione.societa;
          cella.append(nome);
        }
      }
      if (chiave < chiaveAdesso) cella.classList.add('passato');
      if (giorno === adesso.data) cella.classList.add('colonna-oggi');
      cella.title = `${etichetta.nomeGiorno} ${etichetta.dataBreve} · ${oraTesto(minuti)}–${oraTesto(minuti + PASSO_MIN)} · ${descrizione}`;
    },
    (testata, giorno) => {
      if (giorno === adesso.data) testata.classList.add('oggi');
    },
  );
}

/**
 * Groups the week's slots by richiesta (one richiesta = one date) and renders
 * the list with the per-date cancel action.
 * @param {{slot_key: string, societa: string, richiesta_id: number}[]} prenotazioni
 * @returns {void}
 */
function renderPrenotazioniSettimana(prenotazioni) {
  /** @type {Map<number, {societa: string, chiavi: string[]}>} */
  const gruppi = new Map();
  for (const prenotazione of prenotazioni) {
    const gruppo = gruppi.get(prenotazione.richiesta_id) ?? { societa: prenotazione.societa, chiavi: [] };
    gruppo.chiavi.push(prenotazione.slot_key);
    gruppi.set(prenotazione.richiesta_id, gruppo);
  }

  const oggi = adessoRoma().data;
  const lista = elemento('lista-prenotazioni');
  lista.textContent = '';
  const ordinati = [...gruppi.entries()].sort((a, b) => a[1].chiavi[0].localeCompare(b[1].chiavi[0]));
  for (const [richiestaId, gruppo] of ordinati) {
    const chiavi = gruppo.chiavi.sort();
    const [data, orarioInizio] = chiavi[0].split('_');
    const oraInizio = `${orarioInizio.slice(0, 2)}:${orarioInizio.slice(2)}`;
    const ultimoOrario = chiavi[chiavi.length - 1].split('_')[1];
    const oraFine = oraTesto(minutiDaOra(`${ultimoOrario.slice(0, 2)}:${ultimoOrario.slice(2)}`) + PASSO_MIN);

    const riga = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'riga-info';
    const nome = document.createElement('strong');
    nome.textContent = gruppo.societa;
    const quando = document.createElement('span');
    quando.textContent = `${dataEstesa(data)} · ${oraInizio}–${oraFine}`;
    info.append(nome, quando);
    riga.append(info);

    if (data >= oggi) {
      const bottone = document.createElement('button');
      bottone.type = 'button';
      bottone.className = 'btn btn-pericolo btn-piccolo';
      bottone.textContent = 'Annulla';
      bottone.addEventListener('click', () => annullaData(richiestaId, gruppo.societa, data, oraInizio, oraFine));
      riga.append(bottone);
    }
    lista.append(riga);
  }
  elemento('vuoto-prenotazioni').hidden = gruppi.size > 0;
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
 * @param {SubmitEvent} evento - direct booking form submit
 * @returns {Promise<void>}
 */
async function prenotaDiretta(evento) {
  evento.preventDefault();
  const esito = elemento('esito-diretta');
  const bottone = elemento('bottone-diretta');
  bottone.disabled = true;
  try {
    const risposta = await creaPrenotazioneDiretta({
      societa_id: Number(elemento('dir-societa').value),
      data: elemento('dir-data').value,
      ora_inizio: elemento('dir-inizio').value,
      ora_fine: elemento('dir-fine').value,
      note: elemento('dir-note').value.trim(),
    });
    mostraMessaggio(esito, `Prenotazione registrata (${risposta.slot_inseriti} slot).`, 'ok');
    elemento('dir-note').value = '';
    await caricaCalendario();
  } catch (errore) {
    mostraMessaggio(esito, messaggioConflitti(errore), 'errore');
  } finally {
    bottone.disabled = false;
  }
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
    info.append(nome, creaBadge(soc.stato));
    riga.append(info);

    const dettagli = document.createElement('p');
    dettagli.className = 'riga-nota';
    dettagli.textContent = [soc.referente, soc.email, soc.telefono].filter(Boolean).join(' · ');
    riga.append(dettagli);

    const azioni = document.createElement('div');
    azioni.className = 'riga-azioni';
    azioni.append(
      bottoneAzione('Copia link', 'btn', (bottone) => copiaLink(soc, bottone)),
      bottoneAzione('Modifica', 'btn', () => impostaModifica(soc)),
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
 * Switches the società form between create mode (null) and edit mode.
 * @param {object|null} soc - società to edit, or null to reset
 * @returns {void}
 */
function impostaModifica(soc) {
  g_societaInModifica = soc;
  elemento('titolo-form-societa').textContent = soc ? `Modifica: ${soc.nome}` : 'Nuova società';
  elemento('bottone-societa').textContent = soc ? 'Salva modifiche' : 'Crea società';
  elemento('bottone-annulla-modifica').hidden = soc === null;
  elemento('soc-nome').value = soc?.nome ?? '';
  elemento('soc-referente').value = soc?.referente ?? '';
  elemento('soc-email').value = soc?.email ?? '';
  elemento('soc-telefono').value = soc?.telefono ?? '';
  if (soc) elemento('soc-nome').focus();
}

/**
 * @param {SubmitEvent} evento - società form submit (create or edit)
 * @returns {Promise<void>}
 */
async function salvaSocieta(evento) {
  evento.preventDefault();
  const esito = elemento('esito-societa');
  const corpo = {
    nome: elemento('soc-nome').value.trim(),
    referente: elemento('soc-referente').value.trim(),
    email: elemento('soc-email').value.trim(),
    telefono: elemento('soc-telefono').value.trim(),
  };
  try {
    if (g_societaInModifica) {
      await aggiornaSocietaAdmin(g_societaInModifica.id, corpo);
      mostraMessaggio(esito, 'Società aggiornata.', 'ok');
    } else {
      const creata = await creaSocietaAdmin(corpo);
      mostraMessaggio(esito, `Società creata. Link personale da consegnare: ${creata.link_accesso}`, 'ok');
    }
    impostaModifica(null);
    await caricaSocieta();
  } catch (errore) {
    mostraMessaggio(esito, errore.message, 'errore');
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
