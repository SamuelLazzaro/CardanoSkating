/**
 * Frammenti SQL condivisi da più route.
 */
import type { Disciplina, StatoArticolo, TipoMovimento } from './tipi';

/**
 * Pezzi di un articolo attualmente in mano a un atleta: consegne meno
 * restituzioni. Da usare come sotto-query con l'articolo in ?1 e l'atleta in ?2
 * (stessi segnaposto in tutte le istruzioni che la includono).
 */
export const POSSESSO_ATLETA = `(SELECT COALESCE(SUM(CASE tipo WHEN 'CONSEGNA' THEN quantita WHEN 'RESTITUZIONE' THEN -quantita ELSE 0 END), 0) FROM movimenti WHERE articolo_id = ?1 AND atleta_id = ?2)`;

/**
 * Riga dello storico movimenti come esposta dalle API: dati del movimento più
 * codice/descrizione/disciplina dell'articolo e nome dell'atleta. La firma non
 * viene mai letta qui (può pesare decine di KB per riga): solo la sua presenza.
 */
export const SELECT_MOVIMENTI = `SELECT m.id, m.tipo, m.quantita, m.data, m.condizione, m.note, m.operatore, m.created_at,
         m.articolo_id, a.codice, a.descrizione, a.disciplina, a.taglia,
         m.atleta_id, at.nome AS atleta,
         (m.firma IS NOT NULL) AS firma_presente
  FROM movimenti m
  JOIN articoli a ON a.id = m.articolo_id
  LEFT JOIN atleti at ON at.id = m.atleta_id`;

/** Riga restituita dalle query basate su SELECT_MOVIMENTI. */
export type MovimentoStoricoRow = {
  id: number;
  tipo: TipoMovimento;
  quantita: number;
  data: string;
  condizione: StatoArticolo | null;
  note: string | null;
  operatore: string;
  created_at: string;
  articolo_id: number;
  codice: string;
  descrizione: string;
  disciplina: Disciplina;
  taglia: string | null;
  atleta_id: number | null;
  atleta: string | null;
  firma_presente: number;
};

/** Converte il flag SQLite 0/1 della firma in booleano per il client. */
export function conFirmaBooleana(righe: MovimentoStoricoRow[]): (Omit<MovimentoStoricoRow, 'firma_presente'> & { firma_presente: boolean })[] {
  return righe.map((riga) => ({ ...riga, firma_presente: riga.firma_presente === 1 }));
}
