/**
 * Validazione dei dati anagrafici di un articolo, condivisa dalla creazione
 * diretta (POST /api/articoli) e dall'entrata in magazzino con nuovo articolo
 * (POST /api/movimenti con `nuovo_articolo`).
 */
import type { Disciplina, StatoArticolo } from './tipi';
import { disciplina, statoArticolo, testo, testoFacoltativo } from './util';

export const MAX_CATEGORIA = 80;
export const MAX_CAMPO_BREVE = 120;
export const MAX_NOTE = 1000;

export type CampiArticolo = {
  disciplina: Disciplina;
  categoria: string;
  marca: string;
  modello: string | null;
  taglia: string | null;
  stato: StatoArticolo | null;
  note: string | null;
};

/**
 * Valida i campi anagrafici dal corpo JSON. Ritorna i campi ripuliti oppure
 * il messaggio di errore da restituire con 400. `stato` resta null se non
 * indicato: il chiamante decide il default ('Buono' per un articolo creato a
 * mano, la condizione del movimento per un'entrata).
 */
export function campiArticolo(corpo: Record<string, unknown>): { campi: CampiArticolo } | { errore: string } {
  const magazzino = disciplina(corpo.disciplina);
  if (magazzino === null) return { errore: 'Seleziona il magazzino Ghiaccio o Corsa' };
  const categoria = testo(corpo.categoria, MAX_CATEGORIA);
  if (categoria === null) return { errore: `La categoria è obbligatoria (massimo ${MAX_CATEGORIA} caratteri)` };
  const marca = testo(corpo.marca, MAX_CAMPO_BREVE);
  if (marca === null) return { errore: `La marca è obbligatoria (massimo ${MAX_CAMPO_BREVE} caratteri)` };
  const modello = testoFacoltativo(corpo.modello, MAX_CAMPO_BREVE);
  const taglia = testoFacoltativo(corpo.taglia, MAX_CAMPO_BREVE);
  const note = testoFacoltativo(corpo.note, MAX_NOTE);
  if (!modello.valido || !taglia.valido || !note.valido) return { errore: 'Modello, taglia e note devono essere testi brevi' };
  let stato: StatoArticolo | null = null;
  if (corpo.stato !== undefined && corpo.stato !== null && corpo.stato !== '') {
    stato = statoArticolo(corpo.stato);
    if (stato === null) return { errore: 'Stato del materiale non valido' };
  }
  const campi: CampiArticolo = { disciplina: magazzino, categoria, marca, modello: modello.testo, taglia: taglia.testo, stato, note: note.testo };
  return { campi };
}

/** Nome con cui l'articolo compare nell'audit: "Marca Modello" (solo la marca se il modello manca). */
export function nomeArticolo(articolo: { marca: string; modello: string | null }): string {
  return articolo.modello === null ? articolo.marca : `${articolo.marca} ${articolo.modello}`;
}

/** Inserimento di un articolo: la giacenza iniziale (?6) è sia quantita sia disponibili. */
const SQL_INSERISCI_ARTICOLO = `INSERT INTO articoli (disciplina, categoria, marca, modello, taglia, quantita, disponibili, stato, note)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8)`;

/** Statement di inserimento di un articolo con la giacenza iniziale indicata. */
export function stmtInserisciArticolo(db: D1Database, campi: CampiArticolo, quantita: number, statoIniziale: StatoArticolo): D1PreparedStatement {
  return db.prepare(SQL_INSERISCI_ARTICOLO).bind(campi.disciplina, campi.categoria, campi.marca, campi.modello, campi.taglia, quantita, statoIniziale, campi.note);
}
