/*
 * policy.js — entry point of the Privacy & Cookie Policy page.
 * The page has no interactive content of its own: it only needs the shared
 * language switching, the footer year and the consent controls (the banner
 * must work here too, since a visitor may land on this page first).
 */

import { initCookieConsent } from "./cookie.js";
import { initI18n, toggleLanguage } from "./i18n.js";
import { initFooterYear } from "./ui.js";

initI18n();
initFooterYear();
initCookieConsent();

document.getElementById("fab-lang").addEventListener("click", toggleLanguage);
