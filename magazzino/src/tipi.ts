export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Chiave HMAC per la firma dei cookie di sessione (secret). */
  ADMIN_SECRET: string;
  /** Nomi utente ammessi, separati da virgola (var in chiaro in wrangler.jsonc). */
  UTENTI: string;
  /** Password di ogni utente: un secret per nome, PASSWORD_<NOME MAIUSCOLO>. */
  [chiave: `PASSWORD_${string}`]: string | undefined;
};

export type Disciplina = 'Ghiaccio' | 'Corsa';
export type StatoArticolo = 'Nuovo' | 'Buono' | 'Usurato' | 'Da riparare' | 'Fuori uso';
export type TipoMovimento = 'ENTRATA' | 'CONSEGNA' | 'RESTITUZIONE';
/** Sigle delle categorie agonistiche (vedi migrations/0002_categoria_atleti.sql). */
export type CategoriaAtleta = 'G' | 'E' | 'R12' | 'R' | 'A' | 'J' | 'S' | 'M';

export type AtletaRow = {
  id: number;
  nome: string;
  /** NULL per gli atleti inseriti prima dell'introduzione della categoria. */
  categoria: CategoriaAtleta | null;
  attivo: number;
  created_at: string;
};

export type CategoriaRow = {
  id: number;
  nome: string;
  attiva: number;
  created_at: string;
};

export type ArticoloRow = {
  id: number;
  codice: string;
  disciplina: Disciplina;
  categoria: string;
  descrizione: string;
  marca: string | null;
  modello: string | null;
  taglia: string | null;
  seriale: string | null;
  quantita: number;
  disponibili: number;
  stato: StatoArticolo;
  valore: number;
  note: string | null;
  created_at: string;
};

export type MovimentoRow = {
  id: number;
  articolo_id: number;
  atleta_id: number | null;
  operatore: string;
  tipo: TipoMovimento;
  quantita: number;
  data: string;
  condizione: StatoArticolo | null;
  note: string | null;
  firma: string | null;
  created_at: string;
};

/** Variabili di contesto Hono impostate dal middleware di autenticazione. */
export type VariabiliUtente = { utente: string };
