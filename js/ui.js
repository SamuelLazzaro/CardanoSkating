/*
 * ui.js — DOM behaviours of the one-page site:
 *   - top bar: transparent over the hero, solid after scrolling
 *   - off-canvas navigation (hamburger, overlay, Esc, focus handling)
 *   - scroll-reveal with the "instant reveal on menu navigation" rule
 *   - hero video fallback (data saver / reduced motion -> poster only)
 *   - minimal gallery lightbox
 * Each feature exposes an init function, wired together by main.js.
 */

import {
    NAV_CLOSE_LABEL_KEY,
    NAV_OPEN_LABEL_KEY,
    NAV_OVERLAY_FADE_MS,
    SCROLLEND_FALLBACK_MS,
    TOPBAR_SOLID_SCROLL_Y
} from "./constants.js";
import { translate } from "./i18n.js";

/** @type {boolean} true when the OS asks to minimise animations */
const g_prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ================= top bar ================= */

/**
 * Keep the top bar transparent over the hero and solid after scrolling.
 * @returns {void}
 */
export function initTopbar() {
    const topbar = document.getElementById("topbar");

    const updateTopbar = () => {
        topbar.classList.toggle("topbar--solid", window.scrollY > TOPBAR_SOLID_SCROLL_Y);
    };

    window.addEventListener("scroll", updateTopbar, { passive: true });
    updateTopbar();
}

/* ================= page scroll lock ================= */

/*
 * Locking page scroll with overflow:hidden removes the classic
 * scrollbar, so the viewport gets wider and both the in-flow content
 * and the right-anchored fixed elements (top bar, language FAB) jump
 * sideways. CSS scrollbar-gutter cannot solve this because the gutter
 * is dropped as soon as overflow becomes hidden. So the scrollbar
 * width is measured on lock and published as the --scrollbar-comp
 * custom property, which the CSS consumes as extra right padding /
 * offset to keep every element exactly where it was.
 */

/**
 * Lock the page scroll, compensating for the vanishing scrollbar.
 * The scrollbar width is derived from the root element width measured
 * right before and after hiding the overflow: getBoundingClientRect()
 * returns fractional pixels, while innerWidth/clientWidth are rounded
 * integers that leave a sub-pixel shift on scaled (HiDPI) displays.
 * @returns {void}
 */
function lockPageScroll() {
    const widthWithScrollbar = document.documentElement.getBoundingClientRect().width;
    document.body.style.overflow = "hidden";
    const widthWithoutScrollbar = document.documentElement.getBoundingClientRect().width;
    const scrollbarWidth = widthWithoutScrollbar - widthWithScrollbar;
    document.documentElement.style.setProperty("--scrollbar-comp", `${scrollbarWidth}px`);
}

/**
 * Restore page scrolling and drop the scrollbar compensation.
 * @returns {void}
 */
function unlockPageScroll() {
    document.body.style.overflow = "";
    document.documentElement.style.removeProperty("--scrollbar-comp");
}

/* ================= off-canvas navigation ================= */

/** @type {HTMLElement|null} nav panel element, set by initNav */
let g_navPanel = null;

/** @type {HTMLElement|null} nav overlay element, set by initNav */
let g_navOverlay = null;

/** @type {HTMLButtonElement|null} hamburger button, set by initNav */
let g_hamburger = null;

/**
 * Reflect the panel state on the hamburger toggle: aria-expanded (which
 * also drives the CSS bars-to-X morph) plus a localised aria-label.
 * The data-i18n-label attribute is kept in sync so a later language
 * switch re-translates the label matching the current state.
 * @param {boolean} isOpen - true when the panel is open
 * @returns {void}
 */
function updateHamburgerState(isOpen) {
    const labelKey = isOpen ? NAV_CLOSE_LABEL_KEY : NAV_OPEN_LABEL_KEY;
    g_hamburger.setAttribute("aria-expanded", String(isOpen));
    g_hamburger.dataset.i18nLabel = labelKey;
    g_hamburger.setAttribute("aria-label", translate(labelKey));
}

/**
 * Open the off-canvas panel. The hamburger morphs into the X close
 * button and stays visible above the panel, so focus remains on it.
 * @returns {void}
 */
function openNav() {
    g_navOverlay.hidden = false;
    // wait one frame so the overlay fade-in transition can run
    requestAnimationFrame(() => g_navOverlay.classList.add("is-open"));
    g_navPanel.classList.add("is-open");
    updateHamburgerState(true);
    lockPageScroll();
    g_hamburger.focus();
}

/**
 * Close the off-canvas panel and give focus back to the hamburger.
 * @returns {void}
 */
function closeNav() {
    g_navOverlay.classList.remove("is-open");
    setTimeout(() => {
        g_navOverlay.hidden = true;
    }, NAV_OVERLAY_FADE_MS);
    g_navPanel.classList.remove("is-open");
    updateHamburgerState(false);
    unlockPageScroll();
    g_hamburger.focus();
}

/**
 * Open or close the panel depending on its current state.
 * @returns {void}
 */
function toggleNav() {
    if (g_navPanel.classList.contains("is-open")) {
        closeNav();
    } else {
        openNav();
    }
}

/**
 * Wire the hamburger menu: toggle, Esc, overlay click, focus trap.
 * @returns {void}
 */
export function initNav() {
    g_navPanel = document.getElementById("nav-panel");
    g_navOverlay = document.getElementById("nav-overlay");
    g_hamburger = document.getElementById("hamburger");

    g_hamburger.addEventListener("click", toggleNav);
    g_navOverlay.addEventListener("click", closeNav);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && g_navPanel.classList.contains("is-open")) {
            closeNav();
        }
    });

    /*
     * Basic focus trap while the panel is open. The close control is the
     * hamburger itself, which lives in the top bar (outside the panel),
     * so the listener sits on document and the Tab cycle is:
     *   hamburger -> panel links -> back to the hamburger.
     * DOM order already goes hamburger -> panel, so only the two wrap
     * jumps (past the ends of the cycle) need to be handled by hand.
     */
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Tab" || !g_navPanel.classList.contains("is-open")) {
            return;
        }
        const panelFocusables = g_navPanel.querySelectorAll("button, a[href]");
        const focusCycle = [g_hamburger, ...panelFocusables];
        const firstFocusable = focusCycle[0];
        const lastFocusable = focusCycle[focusCycle.length - 1];
        if (event.shiftKey && document.activeElement === firstFocusable) {
            event.preventDefault();
            lastFocusable.focus();
        } else if (!event.shiftKey && document.activeElement === lastFocusable) {
            event.preventDefault();
            firstFocusable.focus();
        }
    });
}

/* ================= scroll-reveal ================= */

/*
 * Every .reveal element starts hidden (CSS) and gets .is-visible when it
 * enters the viewport, producing the slide-up animation.
 *
 * Special rule — navigation via in-page links: the animation must play
 * only for MANUAL scrolling. When the user clicks a menu link the page
 * smooth-scrolls across several sections; without countermeasures the
 * observer would fire a distracting cascade of animations along the way,
 * and the target section would build up piece by piece. So:
 *   - on any in-page link click we raise `g_programmaticScroll`
 *   - the target section's elements are revealed immediately (.no-anim
 *     suppresses the transition for that change)
 *   - while the flag is up, elements crossed by the smooth scroll are
 *     also revealed without animation
 *   - the flag drops on `scrollend` (with a timeout fallback for
 *     browsers that do not support the event)
 */

/** @type {boolean} true while a smooth scroll started by a link is running */
let g_programmaticScroll = false;

/** @type {number|null} id of the scrollend fallback timer */
let g_programmaticScrollTimer = null;

/**
 * Reveal an element with no transition at all.
 * @param {Element} element - the .reveal element to show
 * @returns {void}
 */
function revealInstantly(element) {
    element.classList.add("no-anim", "is-visible");
    // drop .no-anim once the style change has been painted, so any future
    // transition on the element behaves normally again
    requestAnimationFrame(() => {
        requestAnimationFrame(() => element.classList.remove("no-anim"));
    });
}

/**
 * Mark the end of a programmatic (link-started) scroll.
 * @returns {void}
 */
function endProgrammaticScroll() {
    g_programmaticScroll = false;
    clearTimeout(g_programmaticScrollTimer);
    window.removeEventListener("scrollend", endProgrammaticScroll);
}

/**
 * Mark the start of a programmatic scroll towards a section and reveal
 * the whole destination immediately.
 * @param {Element} targetSection - the section the page is scrolling to
 * @returns {void}
 */
function startProgrammaticScroll(targetSection) {
    g_programmaticScroll = true;
    // the destination must be complete on arrival: reveal it right now
    targetSection.querySelectorAll(".reveal").forEach(revealInstantly);
    window.addEventListener("scrollend", endProgrammaticScroll);
    clearTimeout(g_programmaticScrollTimer);
    g_programmaticScrollTimer = setTimeout(endProgrammaticScroll, SCROLLEND_FALLBACK_MS);
}

/**
 * Observe every .reveal element and wire the in-page links so that menu
 * navigation shows sections instantly instead of animating them.
 * @returns {void}
 */
export function initScrollReveal() {
    const revealElements = document.querySelectorAll(".reveal");

    if (!g_prefersReducedMotion) {
        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }
                if (g_programmaticScroll) {
                    revealInstantly(entry.target);
                } else {
                    entry.target.classList.add("is-visible");
                }
                revealObserver.unobserve(entry.target);
            });
        }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });

        revealElements.forEach((element) => revealObserver.observe(element));
    }
    // with reduced motion CSS already forces .reveal visible: nothing to do

    // any link pointing to a #section participates (menu, brand, hero CTA...)
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", () => {
            const targetSection = document.querySelector(link.getAttribute("href"));
            if (!targetSection || g_prefersReducedMotion) {
                return;
            }
            startProgrammaticScroll(targetSection);
            if (g_navPanel && g_navPanel.classList.contains("is-open")) {
                closeNav();
            }
        });
    });
}

/* ================= hero video ================= */

/**
 * On data-saver connections (or reduced motion) skip the hero video
 * entirely and leave the lighter poster image in place.
 * @returns {void}
 */
export function initHeroVideo() {
    const heroVideo = document.getElementById("hero-video");
    const saveDataRequested = navigator.connection !== undefined && navigator.connection.saveData;

    if (g_prefersReducedMotion || saveDataRequested) {
        heroVideo.removeAttribute("autoplay");
        heroVideo.pause();
        heroVideo.querySelector("source").remove();
        heroVideo.load(); // shows the poster without fetching the video
    }
}

/* ================= gallery lightbox ================= */

/** @type {HTMLElement|null} gallery button to focus back on close */
let g_lightboxTrigger = null;

/**
 * Open the lightbox on the full-size image of a gallery button.
 * @param {HTMLButtonElement} galleryButton - clicked .gallery-item button
 * @returns {void}
 */
function openLightbox(galleryButton) {
    const thumbnail = galleryButton.querySelector("img");
    const lightbox = document.getElementById("lightbox");
    const lightboxImg = document.getElementById("lightbox-img");

    lightboxImg.src = galleryButton.dataset.full;
    lightboxImg.alt = thumbnail.alt;
    lightbox.hidden = false;
    lockPageScroll();
    g_lightboxTrigger = galleryButton;
    document.getElementById("lightbox-close").focus();
}

/**
 * Close the lightbox and give focus back to the gallery item.
 * @returns {void}
 */
function closeLightbox() {
    const lightbox = document.getElementById("lightbox");
    const lightboxImg = document.getElementById("lightbox-img");

    lightbox.hidden = true;
    lightboxImg.src = "";
    unlockPageScroll();
    if (g_lightboxTrigger) {
        g_lightboxTrigger.focus();
    }
}

/**
 * Wire the gallery buttons and the lightbox close interactions.
 * @returns {void}
 */
export function initLightbox() {
    const lightbox = document.getElementById("lightbox");

    document.querySelectorAll(".gallery-item").forEach((galleryButton) => {
        galleryButton.addEventListener("click", () => openLightbox(galleryButton));
    });

    document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
    lightbox.addEventListener("click", (event) => {
        if (event.target === lightbox) {
            closeLightbox();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !lightbox.hidden) {
            closeLightbox();
        }
    });
}

/* ================= footer ================= */

/**
 * Keep the copyright year up to date.
 * @returns {void}
 */
export function initFooterYear() {
    document.getElementById("footer-year").textContent = String(new Date().getFullYear());
}
