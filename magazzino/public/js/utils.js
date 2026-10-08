/* utils.js — pure functions: input → output, no DOM, no state, no side effects. */
import { CATEGORIE_ATLETA, ORDINE_ATLETI_CATEGORIA } from './constants.js';

/**
 * @param {string} data - 'YYYY-MM-DD'
 * @returns {string} 'DD/MM/YYYY'
 */
export function dataItaliana(data) {
  const [anno, mese, giorno] = data.split('-');
  return `${giorno}/${mese}/${anno}`;
}

/**
 * @param {Date} [istante]
 * @returns {string} today's civil date in Italy, 'YYYY-MM-DD' (en-CA formats as ISO)
 */
export function oggiRoma(istante = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(istante);
}

/**
 * Display name of an item: "Marca · Modello", or the brand alone. Works on
 * every API object carrying marca and modello (items, history rows, items
 * held by an athlete).
 * @param {{marca: string, modello: string|null}} articolo
 * @returns {string}
 */
export function nomeArticolo(articolo) {
  return articolo.modello ? `${articolo.marca} · ${articolo.modello}` : articolo.marca;
}

/**
 * Case-insensitive "contains" on several text fields, the same rule the
 * server applies to ?q= (marca, modello).
 * @param {string} testoCercato - what the user typed
 * @param {(string|null|undefined)[]} campi - values to search in
 * @returns {boolean} true when at least one field contains the text
 */
export function contieneTesto(testoCercato, campi) {
  const cercato = testoCercato.trim().toLowerCase();
  if (cercato === '') return true;
  return campi.some((campo) => typeof campo === 'string' && campo.toLowerCase().includes(cercato));
}

/**
 * Filters the items of a warehouse: by discipline ('' = all) and free text.
 * @param {object[]} articoli - items from the API
 * @param {string} disciplina - 'Ghiaccio' | 'Corsa' | ''
 * @param {string} testoCercato - free text
 * @returns {object[]} the matching items, in the original order
 */
export function filtraArticoli(articoli, disciplina, testoCercato) {
  return articoli.filter((articolo) => {
    const stessoMagazzino = disciplina === '' || articolo.disciplina === disciplina;
    return stessoMagazzino && contieneTesto(testoCercato, [articolo.marca, articolo.modello]);
  });
}

/**
 * Filters the movement history like the server does for ?disciplina= and ?q=.
 * @param {object[]} movimenti - rows from the API
 * @param {string} disciplina - 'Ghiaccio' | 'Corsa' | ''
 * @param {string} testoCercato - free text on marca and modello
 * @returns {object[]}
 */
export function filtraMovimenti(movimenti, disciplina, testoCercato) {
  return movimenti.filter((movimento) => {
    const stessoMagazzino = disciplina === '' || movimento.disciplina === disciplina;
    return stessoMagazzino && contieneTesto(testoCercato, [movimento.marca, movimento.modello]);
  });
}

/**
 * "Nome Cognome (R12)"; athletes without a category (inserted before the
 * category existed) show the bare name.
 * @param {{nome: string, categoria: string|null}} atleta
 * @returns {string}
 */
export function nomeConCategoria(atleta) {
  return atleta.categoria ? `${atleta.nome} (${atleta.categoria})` : atleta.nome;
}

/**
 * Position of a category code in CATEGORIE_ATLETA (youngest first); a
 * missing category sorts after every real one.
 * @param {string|null} categoria
 * @returns {number}
 */
function posizioneCategoria(categoria) {
  const indice = CATEGORIE_ATLETA.findIndex((voce) => voce.sigla === categoria);
  return indice === -1 ? CATEGORIE_ATLETA.length : indice;
}

/**
 * Athletes table rows: keeps only the selected categories (none selected =
 * everyone) and sorts by name, or by category (G, E, R12, ..., M, then the
 * athletes without a category) and name within the same category.
 * @param {object[]} atleti - athletes from the API (served alphabetically)
 * @param {string[]} categorieScelte - selected category codes, empty = no filter
 * @param {string} ordine - ORDINE_ATLETI_NOME | ORDINE_ATLETI_CATEGORIA
 * @returns {object[]} a new array; the input is not modified
 */
export function filtraEOrdinaAtleti(atleti, categorieScelte, ordine) {
  const filtrati = atleti.filter((atleta) => categorieScelte.length === 0 || categorieScelte.includes(atleta.categoria));
  const perNome = (a, b) => a.nome.localeCompare(b.nome, 'it');
  if (ordine !== ORDINE_ATLETI_CATEGORIA) return filtrati.sort(perNome);
  return filtrati.sort((a, b) => {
    const differenzaCategoria = posizioneCategoria(a.categoria) - posizioneCategoria(b.categoria);
    return differenzaCategoria !== 0 ? differenzaCategoria : perNome(a, b);
  });
}

/**
 * Label of an item in the movement form select: "Marca · Modello · Taglia ·
 * disponibili N".
 * @param {object} articolo
 * @returns {string}
 */
export function etichettaArticolo(articolo) {
  const parti = [nomeArticolo(articolo)];
  if (articolo.taglia) parti.push(articolo.taglia);
  parti.push(`disponibili ${articolo.disponibili}`);
  return parti.join(' · ');
}

/**
 * Turns an empty form value into null so the API receives "absent", not "".
 * @param {string} valore - input value
 * @returns {string|null}
 */
export function testoONull(valore) {
  const ripulito = valore.trim();
  return ripulito === '' ? null : ripulito;
}
