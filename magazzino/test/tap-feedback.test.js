/*
 * Test della logica di public/js/tap-feedback.js: il ritardo delle attivazioni
 * da tap, l'immediatezza di mouse e tastiera e la classe di modalità tastiera
 * su <html> che scopa gli stili di focus.
 *
 * Il modulo tocca il DOM solo tramite document (listener, documentElement) e
 * tramite l'elemento toccato (classList, closest, click): qui sotto ne basta
 * uno stub minimale, installato su globalThis prima di avviare il modulo.
 * Il file è .js perché il modulo sotto test è JavaScript del frontend.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KEYBOARD_INPUT_CLASS, TAP_FEEDBACK_CLASS, TAP_FEEDBACK_MS } from '../public/js/constants.js';
import { avviaTapFeedback, eUltimoInputTouch } from '../public/js/tap-feedback.js';

/** @type {Array<{ tipo: string, fn: Function }>} listener registrati sul document finto, in ordine */
let g_listener = [];

/**
 * Creates a minimal classList backed by a Set.
 * @returns {{ add: Function, remove: Function, contains: Function }}
 */
function creaClassList() {
  const classi = new Set();
  return {
    add: (classe) => classi.add(classe),
    remove: (classe) => classi.delete(classe),
    contains: (classe) => classi.has(classe),
  };
}

/**
 * Dispatches an event to the listeners registered on the fake document,
 * honouring stopImmediatePropagation.
 * @param {string} tipo - event type
 * @param {object} evento - event object
 * @returns {void}
 */
function inviaAlDocument(tipo, evento) {
  for (const listener of g_listener) {
    if (evento.fermato) {
      return;
    }
    if (listener.tipo === tipo) {
      listener.fn(evento);
    }
  }
}

/**
 * Creates a fake actionable element (a button) whose action is counted.
 * @returns {{ azioni: number, classList: object, closest: Function, click: Function, clickFidato: Function }}
 */
function creaBottone() {
  const bottone = {
    azioni: 0,
    classList: creaClassList(),
    closest: () => bottone,
  };

  /**
   * Runs a click through the document listeners first (capture phase), then
   * through the element's own handler unless the propagation was stopped.
   * @param {boolean} fidato - isTrusted of the event
   * @param {number} dettaglio - click count (0 for keyboard activations)
   */
  const eseguiClick = (fidato, dettaglio) => {
    const evento = { type: 'click', isTrusted: fidato, detail: dettaglio, target: bottone, fermato: false, preventDefault: () => {}, stopImmediatePropagation: () => { evento.fermato = true; } };
    inviaAlDocument('click', evento);
    if (!evento.fermato) {
      bottone.azioni += 1;
    }
  };

  // element.click(): synthetic, hence isTrusted === false
  bottone.click = () => eseguiClick(false, 1);
  // a click produced by the user (pointer or keyboard)
  bottone.clickFidato = (dettaglio = 1) => eseguiClick(true, dettaglio);
  return bottone;
}

/**
 * Simulates the press that opens a click.
 * @param {string} pointerType - "touch" or "mouse"
 */
function premi(pointerType) {
  inviaAlDocument('pointerdown', { pointerType });
}

/** @returns {Promise<void>} resolves after the feedback window has elapsed */
function attendiFeedback() {
  return new Promise((risolvi) => setTimeout(risolvi, TAP_FEEDBACK_MS + 20));
}

beforeEach(() => {
  g_listener = [];
  globalThis.document = {
    documentElement: { classList: creaClassList() },
    addEventListener: (tipo, fn) => g_listener.push({ tipo, fn }),
  };
  avviaTapFeedback();
});

afterEach(() => {
  delete globalThis.document;
});

describe('tap-feedback: tempi delle attivazioni', () => {
  it('un click del mouse esegue l\'azione subito, senza classe', () => {
    const bottone = creaBottone();
    premi('mouse');
    bottone.clickFidato();
    expect(bottone.azioni).toBe(1);
    expect(bottone.classList.contains(TAP_FEEDBACK_CLASS)).toBe(false);
    expect(eUltimoInputTouch()).toBe(false);
  });

  it('un\'attivazione da tastiera dopo un tap è immediata', () => {
    const bottone = creaBottone();
    premi('touch');
    bottone.clickFidato(0);
    expect(bottone.azioni).toBe(1);
    expect(bottone.classList.contains(TAP_FEEDBACK_CLASS)).toBe(false);
  });

  it('un tap trattiene l\'azione, mostra la classe e la esegue una volta sola', async () => {
    const bottone = creaBottone();
    premi('touch');
    bottone.clickFidato();
    expect(eUltimoInputTouch()).toBe(true);
    expect(bottone.azioni).toBe(0);
    expect(bottone.classList.contains(TAP_FEEDBACK_CLASS)).toBe(true);

    await attendiFeedback();
    expect(bottone.azioni).toBe(1);
    expect(bottone.classList.contains(TAP_FEEDBACK_CLASS)).toBe(false);
  });

  it('un secondo tap durante il feedback non accoda una seconda azione', async () => {
    const bottone = creaBottone();
    premi('touch');
    bottone.clickFidato();
    premi('touch');
    bottone.clickFidato();

    await attendiFeedback();
    expect(bottone.azioni).toBe(1);
  });

  it('dopo il feedback un nuovo tap funziona di nuovo', async () => {
    const bottone = creaBottone();
    premi('touch');
    bottone.clickFidato();
    await attendiFeedback();

    premi('touch');
    bottone.clickFidato();
    expect(bottone.classList.contains(TAP_FEEDBACK_CLASS)).toBe(true);
    await attendiFeedback();
    expect(bottone.azioni).toBe(2);
  });
});

describe('tap-feedback: modalità tastiera su <html>', () => {
  const classiHtml = () => globalThis.document.documentElement.classList;

  it('parte senza la classe', () => {
    expect(classiHtml().contains(KEYBOARD_INPUT_CLASS)).toBe(false);
  });

  it('un keydown accende la classe', () => {
    inviaAlDocument('keydown', { key: 'Tab' });
    expect(classiHtml().contains(KEYBOARD_INPUT_CLASS)).toBe(true);
  });

  it('un pointerdown spegne la classe', () => {
    inviaAlDocument('keydown', { key: 'Tab' });
    premi('mouse');
    expect(classiHtml().contains(KEYBOARD_INPUT_CLASS)).toBe(false);
  });

  it('un touchstart spegne la classe e segna l\'input come touch', () => {
    inviaAlDocument('keydown', { key: 'Tab' });
    inviaAlDocument('touchstart', {});
    expect(classiHtml().contains(KEYBOARD_INPUT_CLASS)).toBe(false);
    expect(eUltimoInputTouch()).toBe(true);
  });
});
