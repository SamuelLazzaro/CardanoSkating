export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_SECRET: string;
  ADMIN_PASSWORD: string;
  /** Chiave API Brevo per le notifiche email (secret): assente = invio disattivato. */
  BREVO_API_KEY?: string;
  /** Mittente delle notifiche (indirizzo su dominio autenticato in Brevo). */
  EMAIL_MITTENTE?: string;
  /** Indirizzo dell'amministratore: in copia su ogni notifica e Reply-To. */
  EMAIL_ADMIN?: string;
};

export type StatoSocieta = 'attiva' | 'sospesa';
export type StatoRichiesta = 'in_attesa' | 'approvata' | 'rifiutata' | 'annullata';
export type TipoRichiesta = 'nuova' | 'annullamento';

export type SocietaRow = {
  id: number;
  nome: string;
  referente: string;
  email: string;
  telefono: string | null;
  stato: StatoSocieta;
  colore: string;
  tariffa_oraria: number;
  token_accesso: string;
  created_at: string;
};

export type RichiestaRow = {
  id: number;
  societa_id: number;
  data: string;
  ora_inizio: string;
  ora_fine: string;
  stato: StatoRichiesta;
  tipo: TipoRichiesta;
  richiesta_riferimento_id: number | null;
  titolo: string;
  note: string | null;
  motivazione: string | null;
  ricorrenza_id: number | null;
  created_at: string;
  decisa_at: string | null;
  annullata_at: string | null;
};

export type RicorrenzaRow = {
  id: number;
  societa_id: number;
  giorno_settimana: number;
  ora_inizio: string;
  ora_fine: string;
  valida_dal: string;
  valida_al: string;
  stato: StatoRichiesta;
  titolo: string;
  note: string | null;
  motivazione: string | null;
  created_at: string;
};

/** Variabili di contesto Hono impostate dal middleware di autenticazione società. */
export type VariabiliSocieta = { societa: SocietaRow };
