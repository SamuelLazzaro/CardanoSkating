/* utils.js — pure functions: input → output, no DOM, no state, no side effects. */

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
 * @param {number} valore - number to format
 * @param {number} decimali - fixed decimal digits
 * @returns {string} Italian-style number (decimal comma), e.g. "12,50"
 */
export function numeroItaliano(valore, decimali) {
  return valore.toFixed(decimali).replace('.', ',');
}

/**
 * @param {number} valore - amount in euro
 * @returns {string} e.g. "12,50 €"
 */
export function euro(valore) {
  return `${numeroItaliano(valore, 2)} €`;
}

/**
 * Case-insensitive "contains" on several text fields, the same rule the
 * server applies to ?q= (codice, descrizione, marca, seriale).
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
    return stessoMagazzino && contieneTesto(testoCercato, [articolo.codice, articolo.descrizione, articolo.marca, articolo.seriale]);
  });
}

/**
 * Filters the movement history like the server does for ?disciplina= and ?q=.
 * @param {object[]} movimenti - rows from the API
 * @param {string} disciplina - 'Ghiaccio' | 'Corsa' | ''
 * @param {string} testoCercato - free text on codice and descrizione
 * @returns {object[]}
 */
export function filtraMovimenti(movimenti, disciplina, testoCercato) {
  return movimenti.filter((movimento) => {
    const stessoMagazzino = disciplina === '' || movimento.disciplina === disciplina;
    return stessoMagazzino && contieneTesto(testoCercato, [movimento.codice, movimento.descrizione]);
  });
}

/**
 * Label of an item in the movement form select: "Categoria · Codice ·
 * Descrizione · Taglia · disponibili N".
 * @param {object} articolo
 * @returns {string}
 */
export function etichettaArticolo(articolo) {
  const parti = [articolo.categoria, articolo.codice, articolo.descrizione];
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
