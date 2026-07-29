/*
 * i18n.js — Italian / English switching.
 *
 * The page ships in Italian. Every translatable element carries a data
 * attribute pointing to a key of the TRANSLATIONS dictionary (see
 * constants.js for the attribute -> target mapping). Switching language
 * re-renders those elements in place; the choice is persisted in
 * localStorage and re-applied on the next visit.
 */

import { DEFAULT_LANG, LANG_STORAGE_KEY, TRANSLATIONS } from "./constants.js";

/** @type {string} currently applied language ("it" | "en") */
let g_currentLang = DEFAULT_LANG;

/**
 * Read the persisted language, falling back to the default one.
 * @returns {string} "it" or "en"
 */
function getSavedLanguage() {
    const savedLang = localStorage.getItem(LANG_STORAGE_KEY);
    return savedLang === "en" || savedLang === "it" ? savedLang : DEFAULT_LANG;
}

/**
 * Re-render every translatable element and document metadata in `lang`.
 * @param {string} lang - target language ("it" | "en")
 * @returns {void}
 */
function applyLanguage(lang) {
    const dictionary = TRANSLATIONS[lang];

    document.querySelectorAll("[data-i18n]").forEach((element) => {
        const text = dictionary[element.dataset.i18n];
        if (text !== undefined) {
            element.textContent = text;
        }
    });
    document.querySelectorAll("[data-i18n-label]").forEach((element) => {
        const label = dictionary[element.dataset.i18nLabel];
        if (label !== undefined) {
            element.setAttribute("aria-label", label);
        }
    });
    document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
        const altText = dictionary[element.dataset.i18nAlt];
        if (altText !== undefined) {
            element.setAttribute("alt", altText);
        }
    });
    document.querySelectorAll("[data-i18n-content]").forEach((element) => {
        const content = dictionary[element.dataset.i18nContent];
        if (content !== undefined) {
            element.setAttribute("content", content);
        }
    });
    document.querySelectorAll("[data-i18n-title]").forEach((element) => {
        const title = dictionary[element.dataset.i18nTitle];
        if (title !== undefined) {
            element.setAttribute("title", title);
        }
    });

    document.documentElement.lang = lang;
    // secondary pages declare their own title key on <html data-i18n-doc-title>
    const titleKey = document.documentElement.dataset.i18nDocTitle || "meta.title";
    document.title = dictionary[titleKey] ?? dictionary["meta.title"];

    // the FAB always shows the language you would switch TO
    const fabButton = document.getElementById("fab-lang");
    fabButton.textContent = lang === "it" ? "EN" : "IT";
    fabButton.setAttribute("aria-label", dictionary["a11y.switchLang"]);

    g_currentLang = lang;
}

/**
 * Look up a single string in the language currently applied.
 * Needed by code that builds DOM nodes at runtime (see cookie.js), which
 * cannot rely on the data-i18n attributes being scanned at load time.
 * @param {string} key - flat "section.key" translation key
 * @returns {string} the translated string, or the key itself if unknown
 */
export function translate(key) {
    return TRANSLATIONS[g_currentLang][key] ?? key;
}

/**
 * Switch to the other language and persist the choice.
 * @returns {void}
 */
export function toggleLanguage() {
    const nextLang = g_currentLang === "it" ? "en" : "it";
    localStorage.setItem(LANG_STORAGE_KEY, nextLang);
    applyLanguage(nextLang);
}

/**
 * Apply the persisted language on page load.
 * The HTML source is already in the default language, so a re-render is
 * needed only when the saved choice differs.
 * @returns {void}
 */
export function initI18n() {
    const savedLang = getSavedLanguage();
    if (savedLang !== DEFAULT_LANG) {
        applyLanguage(savedLang);
    }
}
