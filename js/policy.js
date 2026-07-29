/*
 * policy.js — entry point of the Privacy & Cookie Policy page.
 * The page has no interactive content of its own: it only needs the shared
 * language switching, the footer year, the tap feedback and the consent
 * controls (the banner must work here too, since a visitor may land on this
 * page first).
 */

import { initCookieConsent } from "./cookie.js";
import { initI18n, toggleLanguage } from "./i18n.js";
import { initTapFeedback } from "./tap-feedback.js";
import { initFooterYear } from "./ui.js";

// first, so its capture-phase click listener runs before every other one
initTapFeedback();

initI18n();
initFooterYear();
initCookieConsent();

document.getElementById("fab-lang").addEventListener("click", toggleLanguage);
