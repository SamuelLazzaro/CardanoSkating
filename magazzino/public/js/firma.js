/*
 * firma.js — signature pad on a <canvas>: finger, pen or mouse strokes via
 * pointer events, crisp on high-DPI screens, exported as a PNG data URL only
 * when something was actually drawn (an untouched pad yields null, so the
 * movement is saved without a signature).
 *
 * The bitmap follows the CSS width of the canvas: a ResizeObserver re-fits it
 * when the pad appears (its section was hidden at start-up, width 0) or when
 * the window is resized. Re-fitting clears the pad, so a signature must be
 * drawn after the form is on screen — which is the only realistic order.
 */
import { ALTEZZA_FIRMA } from './constants.js';

/**
 * @typedef {object} PadFirma
 * @property {() => string|null} dati - PNG data URL of the signature, null if the pad is blank
 * @property {() => void} azzera - clears the pad
 * @property {() => void} ridimensiona - re-fits the bitmap to the canvas CSS size
 */

/**
 * @param {HTMLCanvasElement} tela - the signature canvas
 * @param {HTMLElement} bottoneCancella - "Cancella firma" button
 * @returns {PadFirma}
 */
export function preparaFirma(tela, bottoneCancella) {
  const contesto = tela.getContext('2d');
  /** @type {boolean} true while a pointer is down on the pad */
  let inTratto = false;
  /** @type {boolean} true once at least one stroke was drawn since the last clear */
  let disegnata = false;
  /** @type {[number, number]|null} last point of the current stroke, CSS px */
  let ultimoPunto = null;
  /** @type {number} CSS width the bitmap was last fitted to */
  let larghezzaAdattata = 0;

  function ridimensiona() {
    const scala = window.devicePixelRatio || 1;
    larghezzaAdattata = tela.clientWidth;
    tela.width = Math.max(1, Math.round(larghezzaAdattata * scala));
    tela.height = Math.round(ALTEZZA_FIRMA * scala);
    // drawing coordinates stay in CSS px: the context scales them to the bitmap
    contesto.setTransform(scala, 0, 0, scala, 0, 0);
    contesto.lineWidth = 2;
    contesto.lineCap = 'round';
    contesto.lineJoin = 'round';
    contesto.strokeStyle = '#1c1a17';
    disegnata = false;
  }

  function azzera() {
    contesto.clearRect(0, 0, tela.clientWidth, ALTEZZA_FIRMA);
    disegnata = false;
  }

  function iniziaTratto(evento) {
    inTratto = true;
    ultimoPunto = [evento.offsetX, evento.offsetY];
    // keep receiving moves even when the finger slides outside the canvas
    tela.setPointerCapture(evento.pointerId);
  }

  function prosegueTratto(evento) {
    if (!inTratto || ultimoPunto === null) return;
    contesto.beginPath();
    contesto.moveTo(ultimoPunto[0], ultimoPunto[1]);
    contesto.lineTo(evento.offsetX, evento.offsetY);
    contesto.stroke();
    ultimoPunto = [evento.offsetX, evento.offsetY];
    disegnata = true;
  }

  function terminaTratto() {
    inTratto = false;
    ultimoPunto = null;
  }

  tela.addEventListener('pointerdown', iniziaTratto);
  tela.addEventListener('pointermove', prosegueTratto);
  for (const fine of ['pointerup', 'pointercancel', 'pointerleave']) tela.addEventListener(fine, terminaTratto);
  bottoneCancella.addEventListener('click', azzera);

  // only a real width change re-fits (and clears): showing the pad again at
  // the same width keeps whatever was drawn
  const osservatore = new ResizeObserver(() => {
    if (tela.clientWidth > 0 && tela.clientWidth !== larghezzaAdattata) ridimensiona();
  });
  osservatore.observe(tela);
  ridimensiona();

  const dati = () => (disegnata ? tela.toDataURL('image/png') : null);
  return { dati, azzera, ridimensiona };
}
