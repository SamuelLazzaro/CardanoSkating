/*
 * navigazione.js — section navigation shared by the admin and area pages.
 * The nav (sidebar on desktop, bottom bar on mobile — same markup, styled by
 * css/layout.css) hosts one .nav-voce button per section: clicking a button
 * shows the section named by its data-sezione and hides the others,
 * SPA-style, with no page reload. The bell button also carries the
 * pending-requests badge (admin page only).
 */

/**
 * Wires the section navigation and normalizes the initial state: the button
 * marked .attiva in the HTML (or the first one) has its section shown, every
 * other section is hidden — so markup and JS can never disagree on the
 * starting section.
 * @param {HTMLElement} nav - the .nav-sezioni container
 * @returns {void}
 */
export function preparaNavigazione(nav) {
  const voci = [...nav.querySelectorAll('.nav-voce')];
  for (const voce of voci) {
    voce.addEventListener('click', () => attivaSezione(voci, voce));
  }
  const voceIniziale = voci.find((voce) => voce.classList.contains('attiva')) ?? voci[0];
  if (voceIniziale) attivaSezione(voci, voceIniziale);
}

/**
 * Shows the section of the chosen button and hides all the others, keeping
 * the .attiva class and aria-current in sync on the buttons.
 * @param {HTMLElement[]} voci - all the .nav-voce buttons of the nav
 * @param {HTMLElement} voceScelta - the button whose section must be shown
 * @returns {void}
 */
function attivaSezione(voci, voceScelta) {
  for (const voce of voci) {
    const attiva = voce === voceScelta;
    voce.classList.toggle('attiva', attiva);
    if (attiva) {
      voce.setAttribute('aria-current', 'true');
    } else {
      voce.removeAttribute('aria-current');
    }
    document.getElementById(voce.dataset.sezione).hidden = !attiva;
  }
  // Each section reads as its own page: switching starts from the top.
  window.scrollTo({ top: 0 });
}

/**
 * Updates the pending-requests badge on the bell button: shows the count, or
 * hides the badge entirely when nothing is waiting for a decision.
 * @param {HTMLElement} badge - the .badge-notifiche element
 * @param {number} conteggio - pending richieste + pending ricorrenze
 * @returns {void}
 */
export function aggiornaBadgeNotifiche(badge, conteggio) {
  badge.textContent = String(conteggio);
  badge.hidden = conteggio === 0;
}
