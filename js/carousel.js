/*
 * carousel.js — media carousel (photos + video) built on CSS scroll-snap.
 *
 * The track is a horizontally scrollable flex row with one slide per
 * viewport width; the browser does the swiping, the snapping and the
 * momentum, so this module only has to:
 *   - move the track on arrow / dot / keyboard input
 *   - keep the dots in sync with whichever slide is in view
 *   - auto-advance every CAROUSEL_AUTOPLAY_MS, pausing while the carousel
 *     is hovered, focused, off screen or in a hidden tab (WCAG 2.2.2)
 *   - start the video slide muted when it comes into view and hold the
 *     carousel on it until the video has ended
 * Reduced motion or data-saver: no auto-advance, no video autoplay; the
 * video keeps its native controls so it can still be played by hand.
 *
 * Every .carousel element on the page is set up independently.
 */

import {
    CAROUSEL_ACTIVE_SLIDE_RATIO,
    CAROUSEL_AUTOPLAY_MS,
    CAROUSEL_VIEWPORT_RATIO
} from "./constants.js";

/** @type {boolean} true when the OS asks to minimise animations */
const g_prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** @type {boolean} true when the browser reports a data-saver connection */
const g_saveDataRequested = navigator.connection !== undefined && Boolean(navigator.connection.saveData);

/** @type {boolean} true when nothing should move on its own */
const g_autoplayAllowed = !g_prefersReducedMotion && !g_saveDataRequested;

/**
 * @typedef {Object} CarouselState
 * @property {HTMLElement} root - the .carousel element
 * @property {HTMLElement} track - the scrollable .carousel-track
 * @property {HTMLElement[]} slides - the .carousel-slide children, in order
 * @property {HTMLButtonElement[]} dots - one dot button per slide
 * @property {number} activeIndex - index of the slide currently in view
 * @property {number|null} timerId - pending auto-advance timer, if any
 * @property {boolean} isHovered - pointer resting on the carousel
 * @property {boolean} isFocused - keyboard focus inside the carousel
 * @property {boolean} isInViewport - carousel mostly visible on screen
 * @property {boolean} videoPausedByCarousel - the video was paused by
 *   this module (scrolled away / tab hidden), not by the visitor
 */

/**
 * Return the <video> of a slide, or null for a photo slide.
 * @param {HTMLElement} slide - a .carousel-slide element
 * @returns {HTMLVideoElement|null}
 */
function getSlideVideo(slide) {
    return slide.querySelector("video");
}

/**
 * Tell whether the active slide's video must hold the carousel in place.
 *
 * The carousel waits for the video only when the visitor is actually
 * engaged with it: playing, or paused midway. An untouched video (autoplay
 * blocked by the browser, or reduced motion) and an ended one must not
 * freeze the carousel on that slide forever.
 * @param {CarouselState} state
 * @returns {boolean}
 */
function activeVideoHoldsCarousel(state) {
    const video = getSlideVideo(state.slides[state.activeIndex]);
    if (video === null || video.ended) {
        return false;
    }
    const isPlaying = !video.paused;
    const isPausedMidway = video.paused && video.currentTime > 0;
    return isPlaying || isPausedMidway;
}

/**
 * Scroll the track so that slide `index` fills it (indices wrap around).
 * The active index itself is updated by the intersection observer once
 * the slide is actually in view, so every way of moving (arrows, dots,
 * swipe, keyboard focus) goes through the same path.
 * @param {CarouselState} state
 * @param {number} index - target slide index, may be out of range
 * @returns {void}
 */
function goToSlide(state, index) {
    const slideCount = state.slides.length;
    const wrappedIndex = ((index % slideCount) + slideCount) % slideCount;
    state.track.scrollTo({
        left: wrappedIndex * state.track.clientWidth,
        behavior: g_prefersReducedMotion ? "auto" : "smooth"
    });
}

/**
 * Cancel the pending auto-advance and, if the conditions allow it,
 * schedule a new one. Called after every state change so the timer
 * always reflects the current situation.
 * @param {CarouselState} state
 * @returns {void}
 */
function rescheduleAutoAdvance(state) {
    clearTimeout(state.timerId);
    state.timerId = null;

    const canAdvance = g_autoplayAllowed
        && state.isInViewport
        && !state.isHovered
        && !state.isFocused
        && !document.hidden
        && !activeVideoHoldsCarousel(state);

    if (canAdvance) {
        state.timerId = setTimeout(() => goToSlide(state, state.activeIndex + 1), CAROUSEL_AUTOPLAY_MS);
    }
}

/**
 * Start the active slide's video from the beginning, muted.
 * play() returns a promise that rejects when the browser blocks autoplay:
 * in that case the video simply stays on its poster with the controls.
 * @param {HTMLVideoElement} video
 * @returns {void}
 */
function autoplayVideo(video) {
    video.currentTime = 0;
    video.muted = true;
    video.play().catch(() => {
        // autoplay refused: leave the poster and the native controls
    });
}

/**
 * React to a new slide coming into view: sync the dots, stop the video
 * of the slide just left, start the one of the slide just entered.
 * @param {CarouselState} state
 * @param {number} newIndex - index of the slide now in view
 * @returns {void}
 */
function setActiveSlide(state, newIndex) {
    if (newIndex === state.activeIndex) {
        return;
    }

    const previousVideo = getSlideVideo(state.slides[state.activeIndex]);
    if (previousVideo !== null) {
        previousVideo.pause();
    }

    state.activeIndex = newIndex;
    state.dots.forEach((dot, dotIndex) => {
        if (dotIndex === newIndex) {
            dot.setAttribute("aria-current", "true");
        } else {
            dot.removeAttribute("aria-current");
        }
    });

    const newVideo = getSlideVideo(state.slides[newIndex]);
    if (newVideo !== null && g_autoplayAllowed && state.isInViewport) {
        autoplayVideo(newVideo);
    }

    rescheduleAutoAdvance(state);
}

/**
 * Pause the active video when the carousel is not on screen (or the tab is
 * hidden) and resume it when it comes back, but only if this module was the
 * one that paused it: a visitor's own pause is respected.
 * @param {CarouselState} state
 * @param {boolean} shouldRun - true when the carousel is visible again
 * @returns {void}
 */
function syncVideoWithVisibility(state, shouldRun) {
    const video = getSlideVideo(state.slides[state.activeIndex]);
    if (video === null) {
        return;
    }

    if (!shouldRun && !video.paused) {
        video.pause();
        state.videoPausedByCarousel = true;
    } else if (shouldRun && state.videoPausedByCarousel) {
        state.videoPausedByCarousel = false;
        video.play().catch(() => {
            // resume refused: the visitor can still press play
        });
    }
}

/**
 * Build one dot button per slide inside the dots container.
 * "Slide" reads the same in Italian and English, so the label needs no
 * translation key.
 * @param {CarouselState} state
 * @param {HTMLElement} dotsContainer - the empty .carousel-dots element
 * @returns {void}
 */
function buildDots(state, dotsContainer) {
    state.slides.forEach((slide, slideIndex) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "carousel-dot";
        dot.setAttribute("aria-label", `Slide ${slideIndex + 1}`);
        if (slideIndex === state.activeIndex) {
            dot.setAttribute("aria-current", "true");
        }
        dot.addEventListener("click", () => goToSlide(state, slideIndex));
        dotsContainer.appendChild(dot);
        state.dots.push(dot);
    });
}

/**
 * Wire the arrows, the keyboard and the video events of one carousel.
 * @param {CarouselState} state
 * @returns {void}
 */
function wireControls(state) {
    state.root.querySelector(".carousel-arrow--prev")
        .addEventListener("click", () => goToSlide(state, state.activeIndex - 1));
    state.root.querySelector(".carousel-arrow--next")
        .addEventListener("click", () => goToSlide(state, state.activeIndex + 1));

    // Left / Right arrows move the carousel, except inside the video, where
    // the native controls use them to seek. Any key pressed inside the
    // carousel also marks a keyboard user, which pauses the rotation (see
    // wirePauseConditions for the focus side of the same rule)
    state.root.addEventListener("keydown", (event) => {
        state.isFocused = true;
        rescheduleAutoAdvance(state);

        if (event.target instanceof HTMLVideoElement) {
            return;
        }
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            goToSlide(state, state.activeIndex - 1);
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            goToSlide(state, state.activeIndex + 1);
        }
    });

    state.slides.forEach((slide) => {
        const video = getSlideVideo(slide);
        if (video === null) {
            return;
        }
        // any play / pause by the visitor changes whether the carousel may
        // advance; on a natural end the carousel moves on right away
        video.addEventListener("play", () => rescheduleAutoAdvance(state));
        video.addEventListener("pause", () => rescheduleAutoAdvance(state));
        video.addEventListener("ended", () => {
            if (g_autoplayAllowed) {
                goToSlide(state, state.activeIndex + 1);
            }
        });
    });
}

/**
 * Wire the conditions that pause the auto-advance: hover, focus, the
 * carousel leaving the viewport and the tab being hidden.
 * @param {CarouselState} state
 * @returns {void}
 */
function wirePauseConditions(state) {
    state.root.addEventListener("mouseenter", () => {
        state.isHovered = true;
        rescheduleAutoAdvance(state);
    });
    state.root.addEventListener("mouseleave", () => {
        state.isHovered = false;
        rescheduleAutoAdvance(state);
    });

    // only keyboard focus pauses the rotation: a mouse click on an arrow or
    // a dot also focuses it, but that visitor is not reading the controls
    // and expects the carousel to keep going (:focus-visible tells the two
    // apart in every current engine)
    state.root.addEventListener("focusin", (event) => {
        state.isFocused = event.target.matches(":focus-visible");
        rescheduleAutoAdvance(state);
    });
    state.root.addEventListener("focusout", (event) => {
        // focus moving between two controls of the carousel is not a leave
        if (state.root.contains(event.relatedTarget)) {
            return;
        }
        state.isFocused = false;
        rescheduleAutoAdvance(state);
    });

    const viewportObserver = new IntersectionObserver((entries) => {
        state.isInViewport = entries[0].isIntersecting;
        syncVideoWithVisibility(state, state.isInViewport && !document.hidden);
        rescheduleAutoAdvance(state);
    }, { threshold: CAROUSEL_VIEWPORT_RATIO });
    viewportObserver.observe(state.root);

    document.addEventListener("visibilitychange", () => {
        syncVideoWithVisibility(state, state.isInViewport && !document.hidden);
        rescheduleAutoAdvance(state);
    });
}

/**
 * Observe the slides inside the track: the one covering most of it is
 * the active slide, whatever moved it there.
 * @param {CarouselState} state
 * @returns {void}
 */
function observeActiveSlide(state) {
    const slideObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                setActiveSlide(state, state.slides.indexOf(entry.target));
            }
        });
    }, { root: state.track, threshold: CAROUSEL_ACTIVE_SLIDE_RATIO });

    state.slides.forEach((slide) => slideObserver.observe(slide));
}

/**
 * Set up one .carousel element.
 * @param {HTMLElement} carouselRoot
 * @returns {void}
 */
function setupCarousel(carouselRoot) {
    const track = carouselRoot.querySelector(".carousel-track");

    /** @type {CarouselState} */
    const state = {
        root: carouselRoot,
        track,
        slides: Array.from(track.querySelectorAll(".carousel-slide")),
        dots: [],
        activeIndex: 0,
        timerId: null,
        isHovered: false,
        isFocused: false,
        isInViewport: false,
        videoPausedByCarousel: false
    };

    buildDots(state, carouselRoot.querySelector(".carousel-dots"));
    wireControls(state);
    wirePauseConditions(state);
    observeActiveSlide(state);

    // the first slide is active from the start, so setActiveSlide never
    // runs for it: if it happens to be the video, the viewport observer
    // decides when to start it (no-op when the first slide is a photo)
    const firstVideo = getSlideVideo(state.slides[0]);
    if (firstVideo !== null && g_autoplayAllowed) {
        const startObserver = new IntersectionObserver((entries, observer) => {
            if (entries[0].isIntersecting) {
                autoplayVideo(firstVideo);
                observer.disconnect();
            }
        }, { threshold: CAROUSEL_VIEWPORT_RATIO });
        startObserver.observe(carouselRoot);
    }
}

/**
 * Initialise every carousel on the page.
 * @returns {void}
 */
export function initCarousels() {
    document.querySelectorAll(".carousel").forEach(setupCarousel);
}
