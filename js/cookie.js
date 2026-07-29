/*
 * cookie.js — GDPR / ePrivacy consent gate for third-party content.
 *
 * WHAT
 * Two independent decisions, both kept in localStorage (never in HTTP
 * cookies, so nothing is ever sent to a server):
 *   - COOKIE_CONSENT_KEY: the answer given to the banner ("accepted" or
 *     "rejected"). Any recorded answer stops the banner from reappearing;
 *     the value itself keeps an honest trace of which choice was made.
 *   - MAPS_CONSENT_KEY: Google Maps may be loaded.
 *
 * WHY
 * The Google Maps iframe is third-party content: loading it hands the
 * visitor's IP address to Google and lets Google set cookies, which needs
 * prior explicit consent (art. 6(1)(a) GDPR, art. 122 D.Lgs. 196/2003).
 * The markup therefore ships with a local placeholder only, and the iframe
 * is created here after consent. Withdrawing consent removes the iframe
 * again, so a revocation takes effect without reloading the page.
 *
 * The banner's two buttons are deliberately identical in size and weight:
 * making "reject" less prominent than "accept" is a dark pattern (EDPB
 * guidelines 03/2022).
 */

import {
    CONSENT_ACCEPTED,
    CONSENT_REJECTED,
    COOKIE_CONSENT_KEY,
    MAPS_CONSENT_KEY,
    MAPS_EMBED_SRC,
    MAPS_TITLE_KEY
} from "./constants.js";
import { translate } from "./i18n.js";

/** @type {HTMLElement|null} the cookie banner, set by initCookieConsent */
let g_cookieBanner = null;

/** @type {HTMLButtonElement|null} the "manage preferences" FAB */
let g_cookiePrefsFab = null;

/** @type {ResizeObserver|null} banner height watcher, attached only once */
let g_bannerHeightObserver = null;

/* ================= Google Maps consent gate ================= */

/**
 * @returns {boolean} true when the visitor has agreed to load Google Maps
 */
function hasMapsConsent() {
    return localStorage.getItem(MAPS_CONSENT_KEY) === CONSENT_ACCEPTED;
}

/**
 * Replace a container's placeholder with the live Google Maps iframe.
 * This is the only place in the codebase that contacts a third-party
 * domain, and it must never run before consent has been granted.
 * @param {HTMLElement} container - a .map-embed element
 * @returns {void}
 */
function showMapIframe(container) {
    if (container.querySelector("iframe")) {
        return; // already loaded
    }

    const iframe = document.createElement("iframe");
    iframe.src = MAPS_EMBED_SRC;
    iframe.className = "map-frame";
    iframe.loading = "lazy";
    iframe.allowFullscreen = true;
    // send the origin only, never the full URL, to the third party
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    // both the attribute (for later language switches) and the current value
    iframe.dataset.i18nTitle = MAPS_TITLE_KEY;
    iframe.title = translate(MAPS_TITLE_KEY);

    container.querySelector(".map-consent").hidden = true;
    container.appendChild(iframe);
}

/**
 * Drop the iframe of a container and bring its placeholder back.
 * @param {HTMLElement} container - a .map-embed element
 * @returns {void}
 */
function hideMapIframe(container) {
    const iframe = container.querySelector("iframe");
    if (iframe) {
        iframe.remove();
    }
    container.querySelector(".map-consent").hidden = false;
}

/**
 * Apply the current maps consent to every map on the page. Consent is
 * global, so accepting from the banner or from any single placeholder
 * button reveals all of them at once.
 * @returns {void}
 */
function refreshMaps() {
    const consented = hasMapsConsent();
    document.querySelectorAll(".map-embed").forEach((container) => {
        if (consented) {
            showMapIframe(container);
        } else {
            hideMapIframe(container);
        }
    });
}

/**
 * Store the maps consent and reveal the maps.
 * @returns {void}
 */
function grantMapsConsent() {
    localStorage.setItem(MAPS_CONSENT_KEY, CONSENT_ACCEPTED);
    refreshMaps();
}

/* ================= banner ================= */

/**
 * The banner is anchored to the bottom edge of the viewport, where the
 * language FAB also lives. Publishing its measured height as a CSS custom
 * property lets the FABs sit above it (see components.css) whatever the
 * banner height ends up being once the text wraps in the current language.
 * @returns {void}
 */
function trackBannerHeight() {
    const publishHeight = () => {
        document.body.style.setProperty("--cookie-banner-h", `${g_cookieBanner.offsetHeight}px`);
    };

    publishHeight();
    // the banner can be reopened many times (every consent withdrawal), so
    // the observer is attached only on the first run
    if (!g_bannerHeightObserver) {
        g_bannerHeightObserver = new ResizeObserver(publishHeight);
        g_bannerHeightObserver.observe(g_cookieBanner);
    }
}

/**
 * Show the banner and hide the preferences FAB (they would overlap, and
 * while the banner is open it already offers the same choices).
 * @returns {void}
 */
function showBanner() {
    g_cookieBanner.hidden = false;
    g_cookiePrefsFab.hidden = true;
    document.body.classList.add("cookie-banner-open");
    trackBannerHeight();
}

/**
 * Hide the banner, leaving the preferences FAB as the persistent way back
 * to these choices (a revocation route must always stay reachable).
 * @returns {void}
 */
function hideBanner() {
    g_cookieBanner.hidden = true;
    g_cookiePrefsFab.hidden = false;
    document.body.classList.remove("cookie-banner-open");
}

/**
 * Record the answer given to the banner. Any stored value stops the banner
 * from reappearing, but the real choice is kept instead of a generic flag.
 * @param {string} choice - CONSENT_ACCEPTED or CONSENT_REJECTED
 * @returns {void}
 */
function markBannerAnswered(choice) {
    localStorage.setItem(COOKIE_CONSENT_KEY, choice);
}

/**
 * Wipe every stored consent and ask again: the maps go back to their
 * placeholder immediately, so the withdrawal is effective at once.
 * @returns {void}
 */
export function showCookiePreferences() {
    localStorage.removeItem(COOKIE_CONSENT_KEY);
    localStorage.removeItem(MAPS_CONSENT_KEY);
    refreshMaps();
    showBanner();
}

/**
 * Wire the banner, the preferences controls and the map placeholders.
 * Safe on pages without a map: the queries simply match nothing.
 * @returns {void}
 */
export function initCookieConsent() {
    g_cookieBanner = document.getElementById("cookie-banner");
    g_cookiePrefsFab = document.getElementById("cookie-prefs-fab");

    document.getElementById("cookie-accept").addEventListener("click", () => {
        markBannerAnswered(CONSENT_ACCEPTED);
        grantMapsConsent();
        hideBanner();
    });

    document.getElementById("cookie-reject").addEventListener("click", () => {
        markBannerAnswered(CONSENT_REJECTED);
        hideBanner();
    });

    g_cookiePrefsFab.addEventListener("click", showCookiePreferences);
    document.getElementById("footer-cookie-prefs").addEventListener("click", showCookiePreferences);

    // per-map consent button: same effect as accepting from the banner
    document.querySelectorAll(".map-consent-btn").forEach((button) => {
        button.addEventListener("click", () => {
            markBannerAnswered(CONSENT_ACCEPTED);
            grantMapsConsent();
            hideBanner();
        });
    });

    refreshMaps();

    // any recorded answer ("accepted" or "rejected") means "already asked"
    if (localStorage.getItem(COOKIE_CONSENT_KEY) !== null) {
        hideBanner();
    } else {
        showBanner();
    }
}
