/*
 * tap-feedback.js — visual feedback for taps on touch devices.
 *
 * Touch screens have no :hover, and this site switches the native highlight
 * off (-webkit-tap-highlight-color: transparent), so a tap would give no
 * confirmation that the intended element was hit. This module inserts a
 * short feedback window in front of every touch activation:
 *
 *   1. a capture-phase click listener on document intercepts the event
 *      before anything else sees it and cancels it: preventDefault() holds
 *      back the default action (following a link, submitting a form) and
 *      stopImmediatePropagation() holds back the site's own handlers
 *   2. TAP_FEEDBACK_CLASS is added to the tapped element, which the CSS
 *      styles like the desktop :hover state of that component
 *   3. after TAP_FEEDBACK_MS the class is removed and the click is replayed
 *      with element.click(), which performs the default action and runs
 *      every handler exactly as if step 1 had never happened
 *
 * Only real finger taps take this path: mouse and keyboard activations keep
 * their native, immediate timing. The decision is made per event rather than
 * once per device, so a hybrid laptop (touchscreen plus mouse) behaves
 * correctly with either input.
 *
 * Hooking click (not touchstart) is deliberate: a touch that turns into a
 * scroll never produces a click, so scrolling fingers get no stray feedback.
 */
import { TAP_FEEDBACK_CLASS, TAP_FEEDBACK_MS, TAP_FEEDBACK_SELECTOR } from './constants.js';

/** @type {boolean} true when the last pointer pressed down was a finger */
let g_ultimoInputTouch = false;

/**
 * Tells whether a click event was produced by a finger on a touch screen.
 *
 * The click event's own pointerType is deliberately not used: click belongs
 * to the legacy mouse-compatibility sequence and some engines label it
 * "mouse" even when a tap started it. The pointerdown (or touchstart) that
 * opened this very click is reliable everywhere, so its pointer type is
 * recorded in g_ultimoInputTouch and read back here.
 *
 * Keyboard activations (Enter or Space on a link or button) synthesise a
 * click with no pointer behind it and must not be delayed: they are spotted
 * by detail === 0, since a pointer-driven click always carries a click count
 * of at least 1.
 * @param {MouseEvent} eventoClick - the intercepted click event
 * @returns {boolean} true when the click comes from a tap
 */
function eClickDaTap(eventoClick) {
  const attivazioneDaTastiera = eventoClick.detail === 0;
  return g_ultimoInputTouch && !attivazioneDaTastiera;
}

/**
 * Shows the feedback on the tapped element, then lets its action run.
 * @param {Element} elementoToccato - element the tap landed on
 * @returns {void}
 */
function mostraFeedbackPoiRiesegui(elementoToccato) {
  elementoToccato.classList.add(TAP_FEEDBACK_CLASS);

  setTimeout(() => {
    elementoToccato.classList.remove(TAP_FEEDBACK_CLASS);
    /*
     * The replayed click is synthetic, hence isTrusted === false: that is
     * also what stops intercettaClick from intercepting it again and
     * looping forever.
     */
    elementoToccato.click();
  }, TAP_FEEDBACK_MS);
}

/**
 * Capture-phase click handler: holds a touch activation back for the length
 * of the feedback and leaves every other kind of click untouched.
 * @param {MouseEvent} eventoClick - click event captured on document
 * @returns {void}
 */
function intercettaClick(eventoClick) {
  if (!eventoClick.isTrusted || !eClickDaTap(eventoClick)) {
    return; // replayed click, mouse or keyboard: nothing to delay
  }

  const elementoToccato = eventoClick.target.closest(TAP_FEEDBACK_SELECTOR);
  if (elementoToccato === null) {
    return; // tap on plain content
  }

  eventoClick.preventDefault();
  eventoClick.stopImmediatePropagation();

  // A second tap arriving while the feedback is still on screen would queue
  // a second replay of the same action: swallow it.
  if (!elementoToccato.classList.contains(TAP_FEEDBACK_CLASS)) {
    mostraFeedbackPoiRiesegui(elementoToccato);
  }
}

/**
 * Starts giving taps a visual feedback before their action runs.
 * Must be called before any other click handler is registered, so that its
 * capture-phase listener is the first one document sees.
 * @returns {void}
 */
export function avviaTapFeedback() {
  document.addEventListener('pointerdown', (eventoPuntatore) => {
    g_ultimoInputTouch = eventoPuntatore.pointerType === 'touch';
  }, { capture: true, passive: true });

  // engines without PointerEvent support only fire the touch events
  document.addEventListener('touchstart', () => {
    g_ultimoInputTouch = true;
  }, { capture: true, passive: true });

  document.addEventListener('click', intercettaClick, true);
}
