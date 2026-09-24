/**
 * Validazione dei dati anagrafici di un articolo, condivisa dalla creazione
 * diretta (POST /api/articoli) e dall'entrata in magazzino con nuovo articolo
 * (POST /api/movimenti con `nuovo_articolo`).
 */
import type { Disciplina, StatoArticolo } from './tipi';
import { disciplina, importo, statoArticolo, testo, testoFacoltativo } from './util';

export const MAX_CODICE = 80;
export const MAX_CATEGORIA = 80;
export const MAX_DESCRIZIONE = 200;
export const MAX_CAMPO_BREVE = 120;
export const MAX_NOTE = 1000;

export type CampiArticolo = {
  codice: string;
  disciplina: Disciplina;
  categoria: string;
  descrizione: string;
  marca: string | null;
  modello: string | null;
  taglia: string | null;
  seriale: string | null;
  stato: StatoArticolo | null;
  valore: number;
  note: string | null;
};

/**
 * Valida i campi anagrafici dal corpo JSON. Ritorna i campi ripuliti oppure
 * il messaggio di errore da restituire con 400. `stato` resta null se non
 * indicato: il chiamante decide il default ('Buono' per un articolo creato a
 * mano, la condizione del movimento per un'entrata).
 */
export function campiArticolo(corpo: Record<string, unknown>): { campi: CampiArticolo } | { errore: string } {
  const codice = testo(corpo.codice, MAX_CODICE);
  if (codice === null) return { errore: `Il codice è obbligatorio (massimo ${MAX_CODICE} caratteri)` };
  const magazzino = disciplina(corpo.disciplina);
  if (magazzino === null) return { errore: 'Seleziona il magazzino Ghiaccio o Corsa' };
  const categoria = testo(corpo.categoria, MAX_CATEGORIA);
  const descrizione = testo(corpo.descrizione, MAX_DESCRIZIONE);
  if (categoria === null || descrizione === null) return { errore: 'Categoria e descrizione sono obbligatorie' };
  const marca = testoFacoltativo(corpo.marca, MAX_CAMPO_BREVE);
  const modello = testoFacoltativo(corpo.modello, MAX_CAMPO_BREVE);
  const taglia = testoFacoltativo(corpo.taglia, MAX_CAMPO_BREVE);
  const seriale = testoFacoltativo(corpo.seriale, MAX_CAMPO_BREVE);
  const note = testoFacoltativo(corpo.note, MAX_NOTE);
  if (!marca.valido || !modello.valido || !taglia.valido || !seriale.valido || !note.valido) return { errore: 'Marca, modello, taglia, seriale e note devono essere testi brevi' };
  let stato: StatoArticolo | null = null;
  if (corpo.stato !== undefined && corpo.stato !== null && corpo.stato !== '') {
    stato = statoArticolo(corpo.stato);
    if (stato === null) return { errore: 'Stato del materiale non valido' };
  }
  const valore = importo(corpo.valore);
  if (valore === null) return { errore: 'Valore non valido' };
  const campi: CampiArticolo = { codice, disciplina: magazzino, categoria, descrizione, marca: marca.testo, modello: modello.testo, taglia: taglia.testo, seriale: seriale.testo, stato, valore, note: note.testo };
  return { campi };
}

/** Inserimento di un articolo: la giacenza iniziale (?9) è sia quantita sia disponibili. */
const SQL_INSERISCI_ARTICOLO = `INSERT INTO articoli (codice, disciplina, categoria, descrizione, marca, modello, taglia, seriale, quantita, disponibili, stato, valore, note)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, ?11, ?12)`;

/** Statement di inserimento di un articolo con la giacenza iniziale indicata. */
export function stmtInserisciArticolo(db: D1Database, campi: CampiArticolo, quantita: number, statoIniziale: StatoArticolo): D1PreparedStatement {
  return db.prepare(SQL_INSERISCI_ARTICOLO).bind(campi.codice, campi.disciplina, campi.categoria, campi.descrizione, campi.marca, campi.modello, campi.taglia, campi.seriale, quantita, statoIniziale, campi.valore, campi.note);
}

/** true se esiste già un articolo con quel codice. */
export async function codiceEsistente(db: D1Database, codice: string): Promise<boolean> {
  const riga = await db.prepare('SELECT id FROM articoli WHERE codice = ?1').bind(codice).first();
  return riga !== null;
}
