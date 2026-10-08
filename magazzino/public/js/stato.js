/*
 * stato.js — the master data every section reads (items, athletes) and the
 * history, loaded once after login and reloaded after every change.
 * Views never fetch these themselves: they read g_stato and re-render.
 */
import { ottieniArticoli, ottieniAtleti, ottieniMovimenti, ottieniRiepilogo } from './api.js';

/**
 * @type {{articoli: object[], atleti: object[], movimenti: object[], riepilogo: object|null}}
 */
export const g_stato = { articoli: [], atleti: [], movimenti: [], riepilogo: null };

/**
 * Reloads everything in parallel (four requests, well within the free plan).
 * @returns {Promise<void>}
 */
export async function ricaricaStato() {
  const [articoli, atleti, movimenti, riepilogo] = await Promise.all([ottieniArticoli(), ottieniAtleti(), ottieniMovimenti(), ottieniRiepilogo()]);
  g_stato.articoli = articoli.articoli;
  g_stato.atleti = atleti.atleti;
  g_stato.movimenti = movimenti.movimenti;
  g_stato.riepilogo = riepilogo;
}

/** @returns {object[]} active athletes, alphabetical (as served) */
export function atletiAttivi() {
  return g_stato.atleti.filter((atleta) => atleta.attivo === 1);
}

/**
 * @param {number} idArticolo
 * @returns {object|undefined}
 */
export function articoloPerId(idArticolo) {
  return g_stato.articoli.find((articolo) => articolo.id === idArticolo);
}
