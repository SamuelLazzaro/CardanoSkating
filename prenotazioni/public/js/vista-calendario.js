/*
 * vista-calendario.js — week/month switch of a calendar panel, shared by the
 * admin panel and the società area.
 *
 * This module owns which interval is on screen (a week, identified by its
 * Monday, or a month) and wires the whole toolbar: the two arrows, "torna a
 * oggi" and the Settimana/Mese switch. The page only provides `mostra`, which
 * loads and draws the interval it is handed; everything else — the title, the
 * disabled state of "torna a oggi", the labels of the arrows and the pressed
 * state of the switch — is kept consistent here, so the two pages cannot drift
 * apart.
 */
import {
  adessoRoma,
  aggiungiGiorni,
  lunediDellaSettimana,
  meseDellaData,
  spostaMese,
  titoloMese,
  titoloSettimana,
} from './utils.js';

/**
 * @typedef {object} ElementiVista
 * @property {HTMLElement} titolo - heading showing the interval on screen
 * @property {HTMLButtonElement} precedente - previous week/month
 * @property {HTMLButtonElement} successiva - next week/month
 * @property {HTMLButtonElement} oggi - back to the current week/month
 * @property {HTMLButtonElement} vistaSettimana - switch to the weekly view
 * @property {HTMLButtonElement} vistaMese - switch to the monthly view
 */

/**
 * @typedef {object} Intervallo
 * @property {'settimana'|'mese'} vista - which view is on screen
 * @property {string} lunedi - Monday of the shown week, 'YYYY-MM-DD'
 * @property {string} mese - shown month, 'YYYY-MM'
 */

/**
 * @param {ElementiVista} elementi - toolbar elements of the calendar panel
 * @param {(intervallo: Intervallo) => Promise<void>} mostra - loads and renders an interval
 * @returns {{intervallo: () => Intervallo, aggiorna: () => Promise<void>, apriSettimana: (giorno: string) => Promise<void>}}
 */
export function creaVistaCalendario(elementi, mostra) {
  const oggi = adessoRoma().data;

  /** @type {'settimana'|'mese'} view on screen; the weekly one is the default */
  let vista = 'settimana';

  /** @type {string} Monday of the week the weekly view shows */
  let lunedi = lunediDellaSettimana(oggi);

  /** @type {string} month the monthly view shows, 'YYYY-MM' */
  let mese = meseDellaData(oggi);

  /** @returns {Intervallo} */
  const intervallo = () => ({ vista, lunedi, mese });

  /**
   * Refreshes the toolbar, then asks the page to redraw.
   * @returns {Promise<void>} the page's load, so callers can await it
   */
  function aggiorna() {
    // Read the clock now and not at creation time: a page left open across
    // midnight must still know which week and month are the current ones.
    const adesso = adessoRoma().data;
    const eSettimana = vista === 'settimana';
    elementi.titolo.textContent = eSettimana ? titoloSettimana(lunedi) : titoloMese(mese);
    elementi.oggi.disabled = eSettimana ? lunedi === lunediDellaSettimana(adesso) : mese === meseDellaData(adesso);
    elementi.precedente.setAttribute('aria-label', eSettimana ? 'Settimana precedente' : 'Mese precedente');
    elementi.successiva.setAttribute('aria-label', eSettimana ? 'Settimana successiva' : 'Mese successivo');
    elementi.vistaSettimana.setAttribute('aria-pressed', String(eSettimana));
    elementi.vistaMese.setAttribute('aria-pressed', String(!eSettimana));
    return mostra(intervallo());
  }

  /**
   * @param {number} passi - -1 for the previous interval, +1 for the next one
   * @returns {void}
   */
  function sposta(passi) {
    if (vista === 'settimana') {
      lunedi = aggiungiGiorni(lunedi, passi * 7);
    } else {
      mese = spostaMese(mese, passi);
    }
    aggiorna();
  }

  /**
   * Switching view keeps the user where they were: the monthly view opens on
   * the month of the week on screen, and coming back from it lands on today's
   * week when that month is the current one, on its first week otherwise.
   * @param {'settimana'|'mese'} nuovaVista
   * @returns {void}
   */
  function cambiaVista(nuovaVista) {
    if (nuovaVista === vista) return;
    if (nuovaVista === 'mese') {
      mese = meseDellaData(lunedi);
    } else {
      const adesso = adessoRoma().data;
      lunedi = lunediDellaSettimana(mese === meseDellaData(adesso) ? adesso : `${mese}-01`);
    }
    vista = nuovaVista;
    aggiorna();
  }

  /**
   * Drill-down from a day of the monthly grid: shows the week that day belongs
   * to, in the weekly view.
   * @param {string} giorno - 'YYYY-MM-DD'
   * @returns {Promise<void>}
   */
  function apriSettimana(giorno) {
    lunedi = lunediDellaSettimana(giorno);
    vista = 'settimana';
    return aggiorna();
  }

  elementi.precedente.addEventListener('click', () => sposta(-1));
  elementi.successiva.addEventListener('click', () => sposta(1));
  elementi.oggi.addEventListener('click', () => {
    const adesso = adessoRoma().data;
    lunedi = lunediDellaSettimana(adesso);
    mese = meseDellaData(adesso);
    aggiorna();
  });
  elementi.vistaSettimana.addEventListener('click', () => cambiaVista('settimana'));
  elementi.vistaMese.addEventListener('click', () => cambiaVista('mese'));

  return { intervallo, aggiorna, apriSettimana };
}
