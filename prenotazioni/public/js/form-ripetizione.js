/*
 * form-ripetizione.js — the "Ripetizione" block shared by the booking forms of
 * the area società and the admin panel: the weekday chips (with the weekday of
 * the chosen date locked), the weekly repetition with its date limits and the
 * live preview of the dates the request will cover. The rules mirror the
 * server ones, so the preview shows exactly what will be booked.
 *
 * Pure DOM wiring: the caller owns the form, hands over its elements once and
 * asks for the request fields at submit time.
 */
import { MAX_GIORNI_FINESTRA_RICORRENZA } from './constants.js';
import {
  aggiungiGiorni,
  domenicaDellaSettimana,
  etichettaGiorno,
  giornoSettimana,
  occorrenzeRicorrenza,
} from './utils.js';

/**
 * @typedef {object} ElementiRipetizione
 * @property {HTMLInputElement} campoData - the date input of the form (first occurrence)
 * @property {HTMLElement} contenitoreGiorni - wrapper of the seven weekday checkboxes (name="giorni")
 * @property {HTMLInputElement} casellaRipeti - "Ripeti ogni settimana" checkbox
 * @property {HTMLElement} bloccoFinoAl - wrapper of the "fino al" field, shown only when repeating
 * @property {HTMLInputElement} campoFinoAl - "fino al" date input
 * @property {HTMLElement} anteprima - element that receives the preview text
 */

/**
 * @typedef {object} FormRipetizione
 * @property {() => void} aggiorna - refreshes limits, locked weekday and preview after the date changed programmatically
 * @property {() => string|null} erroreCampi - message to show when the block is not ready to be sent, null when fine
 * @property {() => {giorni?: number[], ripeti_fino_al?: string}} campiRichiesta - request fields describing the repetition (empty object for a plain request)
 * @property {() => void} azzera - back to the plain-request state (extra weekdays off, repetition off)
 * @property {(giorni: number[], ripetiFinoAl: string) => void} imposta - fills the block from an existing series (to edit it)
 * @property {(visibile: boolean) => void} mostra - shows or hides the whole block (hidden when editing a single booking)
 */

/**
 * Wires the repetition block of a booking form.
 * @param {ElementiRipetizione} elementi
 * @returns {FormRipetizione}
 */
export function preparaFormRipetizione(elementi) {
  const { campoData, contenitoreGiorni, casellaRipeti, bloccoFinoAl, campoFinoAl, anteprima } = elementi;

  /** @returns {HTMLInputElement[]} the seven weekday checkboxes, in weekday order */
  const caselleGiorni = () => [...contenitoreGiorni.querySelectorAll('input[name="giorni"]')];

  /** @returns {number[]} weekdays currently selected (0 = lunedì), locked one included */
  const giorniSelezionati = () =>
    caselleGiorni()
      .filter((casella) => casella.checked)
      .map((casella) => Number(casella.value));

  /** @returns {void} keeps the "fino al" limits tied to the chosen date */
  function aggiornaLimiti() {
    const dataScelta = campoData.value;
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
    const dataScelta = campoData.value;
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
  function aggiornaAnteprima() {
    const dataScelta = campoData.value;
    const giorni = giorniSelezionati();
    const ripeti = casellaRipeti.checked;
    const finoAl = campoFinoAl.value;
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

  /** @returns {void} refreshes everything that depends on the chosen date */
  function aggiorna() {
    aggiornaLimiti();
    aggiornaGiornoObbligatorio();
    aggiornaAnteprima();
  }

  /** @returns {void} shows the "fino al" field only while repeating weekly */
  function aggiornaBloccoFinoAl() {
    bloccoFinoAl.hidden = !casellaRipeti.checked;
    campoFinoAl.required = casellaRipeti.checked;
  }

  campoData.addEventListener('change', aggiorna);
  casellaRipeti.addEventListener('change', () => {
    aggiornaBloccoFinoAl();
    aggiorna();
  });
  campoFinoAl.addEventListener('input', aggiornaAnteprima);
  for (const casella of caselleGiorni()) casella.addEventListener('change', aggiornaAnteprima);
  // The caller presets the date without firing 'change': lock its weekday now.
  aggiorna();

  return {
    aggiorna,

    erroreCampi() {
      if (casellaRipeti.checked && !campoFinoAl.value) return 'Scegli fino a quando ripetere la richiesta';
      return null;
    },

    campiRichiesta() {
      const campi = {};
      if (casellaRipeti.checked) campi.ripeti_fino_al = campoFinoAl.value;
      // Only the extra weekdays make the request different from a plain one:
      // the weekday of the date itself is implied server-side.
      const giorni = giorniSelezionati();
      if (giorni.length > 1) campi.giorni = giorni;
      return campi;
    },

    azzera() {
      casellaRipeti.checked = false;
      aggiornaBloccoFinoAl();
      for (const casella of caselleGiorni()) {
        if (casella.disabled) {
          casella.dataset.sceltaPrima = 'false';
        } else {
          casella.checked = false;
        }
      }
      aggiornaAnteprima();
    },

    /**
     * Fills the block from an existing series, so it can be edited: the
     * caller has already set the date field. A "fino al" equal to the Sunday
     * of the first week is how the server stores "no weekly repetition", so
     * the repetition checkbox is on only when the series goes beyond it.
     * @param {number[]} giorni - weekdays of the series (0 = lunedì)
     * @param {string} ripetiFinoAl - last date of the series, 'YYYY-MM-DD'
     */
    imposta(giorni, ripetiFinoAl) {
      const ripete = ripetiFinoAl > domenicaDellaSettimana(campoData.value);
      casellaRipeti.checked = ripete;
      campoFinoAl.value = ripete ? ripetiFinoAl : '';
      aggiornaBloccoFinoAl();
      const scelti = new Set(giorni);
      for (const casella of caselleGiorni()) {
        const scelta = scelti.has(Number(casella.value));
        if (casella.disabled) {
          casella.dataset.sceltaPrima = String(scelta);
        } else {
          casella.checked = scelta;
        }
      }
      aggiorna();
    },

    mostra(visibile) {
      // The block is a <fieldset>: hiding it also takes its controls out of
      // the form validation, so a hidden "fino al" never blocks the submit.
      const blocco = contenitoreGiorni.closest('fieldset') ?? contenitoreGiorni;
      blocco.hidden = !visibile;
      blocco.disabled = !visibile;
    },
  };
}
