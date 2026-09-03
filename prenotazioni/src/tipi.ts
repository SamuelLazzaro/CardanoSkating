export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_SECRET: string;
  ADMIN_PASSWORD: string;
  /** Chiave API Brevo per le notifiche email (secret): assente = invio disattivato. */
  BREVO_API_KEY?: string;
  /** Mittente delle notifiche (indirizzo su dominio autenticato in Brevo). */
  EMAIL_MITTENTE?: string;
  /**
   * Indirizzo dell'amministratore: riceve un'email dedicata per gli eventi
   * avviati dalle società ed è il Reply-To delle email alle società.
   */
  EMAIL_ADMIN?: string;
};

export type StatoSocieta = 'attiva' | 'sospesa';
export type StatoRichiesta = 'in_attesa' | 'approvata' | 'rifiutata' | 'annullata';
/**
 * 'nuova': richiesta di prenotazione (l'unico tipo che, approvato, occupa slot).
 * 'annullamento' / 'modifica': richieste riferite (richiesta_riferimento_id)
 * a una prenotazione approvata, che l'admin approva o rifiuta; una volta
 * decise sono atti conclusi, non prenotazioni. Vedi migrazioni 0005 e 0009.
 */
export type TipoRichiesta = 'nuova' | 'annullamento' | 'modifica';

/**
 * Ambito di una modifica o di un annullamento su una prenotazione che fa
 * parte di una ricorrenza materializzata: la sola occorrenza cliccata, oppure
 * quella e tutte le successive della stessa serie (scelta del committente,
 * stile Google Calendar). Su una prenotazione singola i due ambiti coincidono.
 */
export type Ambito = 'singola' | 'successive';

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
  /** Identificativo comune alle richieste inviate insieme su più occorrenze (0009); NULL se singola. */
  gruppo_id: string | null;
  created_at: string;
  decisa_at: string | null;
  annullata_at: string | null;
};

export type RicorrenzaRow = {
  id: number;
  societa_id: number;
  /** Giorni della settimana richiesti, come salvati in DB: '0,2,4' (0 = lunedì; vedi giorniDaTesto). */
  giorni: string;
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
