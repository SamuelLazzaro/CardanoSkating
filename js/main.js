/*
 * main.js — entry point: initialises every module and wires the
 * language FAB. All the behaviour lives in ui.js and i18n.js.
 */

import { initCookieConsent } from "./cookie.js";
import { initI18n, toggleLanguage } from "./i18n.js";
import {
    initFooterYear,
    initHeroVideo,
    initLightbox,
    initNav,
    initScrollReveal,
    initTopbar
} from "./ui.js";

initI18n();
initTopbar();
initNav();
initScrollReveal();
initHeroVideo();
initLightbox();
initFooterYear();
initCookieConsent();

document.getElementById("fab-lang").addEventListener("click", toggleLanguage);
