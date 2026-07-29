/*
 * tap-feedback.js — visual feedback for taps on touch devices.
 *
 * Touch screens have no :hover and base.css switches the native highlight
 * off (-webkit-tap-highlight-color: transparent), so a tap gives no
 * confirmation that the intended element was hit: the action just happens,
 * or on a slow navigation seems not to happen at all. This module inserts
 * a short feedback window in front of every touch activation:
 *
 *   1. a capture-phase click listener on document intercepts the event
 *      before anything else sees it and cancels it: preventDefault() holds
 *      back the default action (following a link, submitting a form) and
 *      stopImmediatePropagation() holds back the site's own handlers, which
 *      are all registered on the elements themselves
 *   2. TAP_FEEDBACK_CLASS is added to the tapped element, which the CSS
 *      styles like the desktop :hover state of that component
 *   3. after TAP_FEEDBACK_MS the class is removed and the click is replayed
 *      with element.click(), which performs the default action and runs
 *      every handler exactly as if step 1 had never happened
 *
 * Only real finger taps take this path: mouse and keyboard activations keep
 * their native, immediate timing. The decision is made per event rather
 * than once per device, so a hybrid laptop (touchscreen plus mouse) behaves
 * correctly with either input.
 */

import { TAP_FEEDBACK_CLASS, TAP_FEEDBACK_MS, TAP_FEEDBACK_SELECTOR } from "./constants.js";

/** @type {boolean} true when the last pointer pressed down was a finger */
let g_lastPointerWasTouch = false;

/**
 * Tell whether a click event was produced by a finger on a touch screen.
 *
 * The click event's own `pointerType` is deliberately not the signal used
 * here: click belongs to the legacy mouse-compatibility sequence, and some
 * engines still label it "mouse" even when a tap started it. The
 * pointerdown (or touchstart) that opened this very click is reliable
 * everywhere, so its pointer type is recorded and read back here.
 *
 * Keyboard activations (Enter or Space on a link or button) synthesise a
 * click with no pointer behind it and must not be delayed: they are spotted
 * by `detail === 0`, since a pointer-driven click always carries a click
 * count of at least 1.
 * @param {MouseEvent} clickEvent - the intercepted click event
 * @returns {boolean} true when the click comes from a tap
 */
function isTapClick(clickEvent) {
    const isKeyboardActivation = clickEvent.detail === 0;
    return g_lastPointerWasTouch && !isKeyboardActivation;
}

/**
 * Show the feedback on the tapped element, then let its action run.
 * @param {Element} tappedElement - element the tap landed on
 * @returns {void}
 */
function showFeedbackThenReplayClick(tappedElement) {
    tappedElement.classList.add(TAP_FEEDBACK_CLASS);

    setTimeout(() => {
        tappedElement.classList.remove(TAP_FEEDBACK_CLASS);
        /*
         * The replayed click is synthetic, hence isTrusted === false: that
         * is also what stops onClickCapture from intercepting it again and
         * looping forever.
         */
        tappedElement.click();
    }, TAP_FEEDBACK_MS);
}

/**
 * Capture-phase click handler: hold a touch activation back for the length
 * of the feedback, and leave every other kind of click untouched.
 * @param {MouseEvent} clickEvent - click event captured on document
 * @returns {void}
 */
function onClickCapture(clickEvent) {
    if (!clickEvent.isTrusted || !isTapClick(clickEvent)) {
        return; // replayed click, mouse or keyboard: nothing to delay
    }

    const tappedElement = clickEvent.target.closest(TAP_FEEDBACK_SELECTOR);
    if (tappedElement === null) {
        return; // tap on plain content, or on an overlay backdrop
    }

    clickEvent.preventDefault();
    clickEvent.stopImmediatePropagation();

    // a second tap arriving while the feedback is still on screen would
    // queue a second replay of the same action: swallow it
    if (!tappedElement.classList.contains(TAP_FEEDBACK_CLASS)) {
        showFeedbackThenReplayClick(tappedElement);
    }
}

/**
 * Start giving taps a visual feedback before their action runs.
 * Must be initialised before any other click handler, so that its
 * capture-phase listener is the first one document sees.
 * @returns {void}
 */
export function initTapFeedback() {
    document.addEventListener("pointerdown", (pointerEvent) => {
        g_lastPointerWasTouch = pointerEvent.pointerType === "touch";
    }, { capture: true, passive: true });

    // engines without PointerEvent support only fire the touch events
    document.addEventListener("touchstart", () => {
        g_lastPointerWasTouch = true;
    }, { capture: true, passive: true });

    document.addEventListener("click", onClickCapture, true);
}
