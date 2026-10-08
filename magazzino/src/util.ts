import type { Context } from 'hono';
import type { CategoriaAtleta, Disciplina, StatoArticolo, TipoMovimento } from './tipi';

/**
 * Legge il corpo JSON della richiesta. Ritorna null (→ 400 nel chiamante)
 * se il corpo manca, non è JSON valido o non è un oggetto.
 */
export async function leggiJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const valore = await c.req.json();
    if (valore === null || typeof valore !== 'object' || Array.isArray(valore)) return null;
    return valore as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Valida una stringa obbligatoria: ritorna il valore ripulito (trim) se è una
 * stringa non vuota entro la lunghezza massima, altrimenti null.
 */
export function testo(valore: unknown, maxLunghezza: number): string | null {
  if (typeof valore !== 'string') return null;
  const ripulito = valore.trim();
  if (ripulito.length === 0 || ripulito.length > maxLunghezza) return null;
  return ripulito;
}

/**
 * Valida una stringa facoltativa: assente, null o vuota → testo null (valido);
 * stringa entro la lunghezza → testo ripulito; qualunque altro valore → non valido.
 */
export function testoFacoltativo(valore: unknown, maxLunghezza: number): { valido: boolean; testo: string | null } {
  if (valore === undefined || valore === null) return { valido: true, testo: null };
  if (typeof valore !== 'string') return { valido: false, testo: null };
  const ripulito = valore.trim();
  if (ripulito.length > maxLunghezza) return { valido: false, testo: null };
  return { valido: true, testo: ripulito === '' ? null : ripulito };
}

/** Converte un parametro di percorso in intero positivo, o null se non valido. */
export function intero(valore: string | undefined): number | null {
  if (valore === undefined || !/^\d{1,10}$/.test(valore)) return null;
  return Number(valore);
}

/** Intero da 1 a `massimo` letto dal corpo JSON (quantità), o null se non valido. */
export function interoPositivo(valore: unknown, massimo = 100000): number | null {
  if (typeof valore !== 'number' || !Number.isInteger(valore) || valore < 1 || valore > massimo) return null;
  return valore;
}

/** Valore booleano obbligatorio dal corpo JSON, o null se non è un booleano. */
export function booleano(valore: unknown): boolean | null {
  return typeof valore === 'boolean' ? valore : null;
}

export const DISCIPLINE: readonly Disciplina[] = ['Ghiaccio', 'Corsa'];
export const STATI_ARTICOLO: readonly StatoArticolo[] = ['Nuovo', 'Buono', 'Usurato', 'Da riparare', 'Fuori uso'];
export const TIPI_MOVIMENTO: readonly TipoMovimento[] = ['ENTRATA', 'CONSEGNA', 'RESTITUZIONE'];
/** Sigle delle categorie atleta, dalla più giovane alla più anziana (stesso ordine del CHECK). */
export const CATEGORIE_ATLETA: readonly CategoriaAtleta[] = ['G', 'E', 'R12', 'R', 'A', 'J', 'S', 'M'];

/** Stati che contano come "da riparare" nei riepiloghi (come nel gestionale originale). */
export const STATI_DA_RIPARARE: readonly StatoArticolo[] = ['Da riparare', 'Fuori uso'];

export function disciplina(valore: unknown): Disciplina | null {
  return DISCIPLINE.find((nome) => nome === valore) ?? null;
}

export function statoArticolo(valore: unknown): StatoArticolo | null {
  return STATI_ARTICOLO.find((nome) => nome === valore) ?? null;
}

export function tipoMovimento(valore: unknown): TipoMovimento | null {
  return TIPI_MOVIMENTO.find((nome) => nome === valore) ?? null;
}

export function categoriaAtleta(valore: unknown): CategoriaAtleta | null {
  return CATEGORIE_ATLETA.find((sigla) => sigla === valore) ?? null;
}

/**
 * Data civile 'YYYY-MM-DD' dal corpo JSON: deve avere il formato atteso ed
 * essere un giorno esistente (niente 31 febbraio). Ritorna null se non valida.
 */
export function dataCivile(valore: unknown): string | null {
  if (typeof valore !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valore)) return null;
  const [anno, mese, giorno] = valore.split('-').map(Number);
  const controllo = new Date(Date.UTC(anno, mese - 1, giorno));
  const coerente = controllo.getUTCFullYear() === anno && controllo.getUTCMonth() === mese - 1 && controllo.getUTCDate() === giorno;
  return coerente ? valore : null;
}

/** Data di oggi in ora civile italiana, 'YYYY-MM-DD' (formato en-CA = ISO). */
export function oggiRoma(istante = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(istante);
}

/** Limite D1 sui pattern LIKE: 50 byte (developers.cloudflare.com/d1/platform/limits). */
const MAX_BYTE_PATTERN_LIKE = 50;

/**
 * Costruisce il pattern '%testo%' di una ricerca libera, con i caratteri
 * speciali di LIKE (% _ \) protetti dall'escape '\'. Il testo viene accorciato
 * finché il pattern sta nei 50 byte ammessi da D1: una ricerca più lunga di
 * così è comunque già selettiva. Ritorna null se il testo è vuoto.
 */
export function patternRicerca(testoCercato: string): string | null {
  let caratteri = [...testoCercato.trim()];
  if (caratteri.length === 0) return null;
  const codificatore = new TextEncoder();
  let pattern = '';
  do {
    const protetto = caratteri.join('').replace(/[%_\\]/g, (carattere) => `\\${carattere}`);
    pattern = `%${protetto}%`;
    caratteri = caratteri.slice(0, -1);
  } while (codificatore.encode(pattern).length > MAX_BYTE_PATTERN_LIKE && caratteri.length > 0);
  return pattern;
}

/** Statement di audit da includere in un db.batch(). */
export function stmtAudit(db: D1Database, azione: string, dettaglio: string, attore: string): D1PreparedStatement {
  return db.prepare('INSERT INTO audit_log (azione, dettaglio, attore) VALUES (?1, ?2, ?3)').bind(azione, dettaglio, attore);
}

/** Scrittura di audit immediata (fuori da un batch). */
export async function scriviAudit(db: D1Database, azione: string, dettaglio: string, attore: string): Promise<void> {
  await stmtAudit(db, azione, dettaglio, attore).run();
}
