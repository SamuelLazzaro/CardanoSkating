import type { Bindings } from './tipi';
import { scriviAudit } from './util';

/**
 * Notifiche email sugli eventi del ciclo di vita delle prenotazioni,
 * inviate tramite l'API transazionale di Brevo (provider UE; riferimento:
 * https://developers.brevo.com/reference/sendtransacemail).
 *
 * Scelte di progetto (concordate col committente):
 *  - Best effort: un invio fallito non fa MAI fallire l'operazione di
 *    prenotazione. L'invio gira in executionCtx.waitUntil() (non ritarda
 *    la risposta HTTP) e un eventuale errore lascia solo una riga
 *    'notifica_fallita' nell'audit log.
 *  - Una sola chiamata API per evento: la società è il destinatario
 *    principale e l'admin è in copia (CC), così ogni evento consuma una
 *    sola email della quota gratuita giornaliera di Brevo (300/giorno).
 *  - Solo testo semplice: niente HTML, quindi i contenuti inseriti dagli
 *    utenti (titoli, note, motivazioni) non possono iniettare markup.
 *  - Minimizzazione (art. 5.1.c GDPR): nelle email non compare MAI il
 *    link personale col token di accesso — l'email non è un canale
 *    sicuro — né altri dati oltre quelli necessari a capire l'evento.
 *  - Con BREVO_API_KEY assente l'invio è disattivato: sviluppo locale e
 *    test girano così, senza toccare la rete.
 */

const URL_API_BREVO = 'https://api.brevo.com/v3/smtp/email';
const NOME_MITTENTE = 'Prenotazioni Palazzetto';
const PREFISSO_OGGETTO = '[Palazzetto]';
const TIMEOUT_INVIO_MS = 10_000;

/** Nomi dei giorni secondo la convenzione di progetto (0 = lunedì). */
const GIORNI_SETTIMANA = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];

/** Dati minimi della società destinataria di una notifica. */
export type SocietaDaNotificare = { nome: string; email: string };

/** Estremi di una richiesta su singola data (per il corpo dell'email). */
type EstremiRichiesta = { data: string; ora_inizio: string; ora_fine: string; titolo?: string };

/** Estremi di una ricorrenza settimanale (per il corpo dell'email). */
type EstremiRicorrenza = {
  giorno_settimana: number;
  ora_inizio: string;
  ora_fine: string;
  valida_dal: string;
  valida_al: string;
  titolo?: string;
};

/**
 * Sottoinsieme del Context di Hono usato dalle notifiche: tipizzarlo in modo
 * strutturale permette di accettare sia il contesto delle route admin sia
 * quello delle route società (che ha Variables aggiuntive).
 */
type ContestoNotifica = {
  env: Bindings;
  req: { url: string };
  // Solo il metodo effettivamente usato: i tipi ExecutionContext di Hono e
  // di workers-types divergono (tracing) e qui non servono entrambi interi.
  executionCtx: { waitUntil(promessa: Promise<unknown>): void };
};

export type Notifica = {
  /** Oggetto, senza il prefisso comune (aggiunto centralmente). */
  oggetto: string;
  /** Frase che descrive l'evento, riferita alla società destinataria. */
  messaggio: string;
  /** Righe di dettaglio già formattate ("Etichetta: valore"). */
  dettagli: string[];
  societa: SocietaDaNotificare;
};

/** 'YYYY-MM-DD' → 'DD/MM/YYYY', il formato data usato nelle email. */
export function dataItaliana(data: string): string {
  const [anno, mese, giorno] = data.split('-');
  return `${giorno}/${mese}/${anno}`;
}

function righeRichiesta(richiesta: EstremiRichiesta): string[] {
  const righe = [`Data: ${dataItaliana(richiesta.data)}, dalle ${richiesta.ora_inizio} alle ${richiesta.ora_fine}`];
  if (richiesta.titolo) righe.unshift(`Attività: ${richiesta.titolo}`);
  return righe;
}

function righeRicorrenza(ricorrenza: EstremiRicorrenza): string[] {
  const righe = [
    `Giorno: ogni ${GIORNI_SETTIMANA[ricorrenza.giorno_settimana]}, dalle ${ricorrenza.ora_inizio} alle ${ricorrenza.ora_fine}`,
    `Periodo: dal ${dataItaliana(ricorrenza.valida_dal)} al ${dataItaliana(ricorrenza.valida_al)}`,
  ];
  if (ricorrenza.titolo) righe.unshift(`Attività: ${ricorrenza.titolo}`);
  return righe;
}

/** Corpo in testo semplice, comune a tutte le notifiche (esportato per i test). */
export function corpoNotifica(notifica: Notifica, origine: string): string {
  return [
    `Gentile ${notifica.societa.nome},`,
    '',
    notifica.messaggio,
    '',
    ...notifica.dettagli.map((riga) => `  ${riga}`),
    '',
    '—',
    'Notifica automatica del sistema prenotazioni del Palazzetto dello Sport,',
    'Cardano Skating S.R.L. S.S.D. Per domande è possibile rispondere a questa email.',
    "Le prenotazioni si gestiscono dall'area riservata, tramite il proprio link personale.",
    `Informativa privacy: ${origine}/privacy.html`,
  ].join('\n');
}

/**
 * Avvia l'invio senza attendere l'esito: la risposta HTTP parte subito e
 * l'invio prosegue in waitUntil(). Nei test unitari senza ExecutionContext
 * (l'accesso a executionCtx solleva) l'invio prosegue comunque staccato.
 */
function inviaNotifica(c: ContestoNotifica, notifica: Notifica): void {
  const invio = eseguiInvio(c.env, new URL(c.req.url).origin, notifica);
  try {
    c.executionCtx.waitUntil(invio);
  } catch {
    // Nessun ExecutionContext disponibile: l'invio resta best effort.
  }
}

async function eseguiInvio(env: Bindings, origine: string, notifica: Notifica): Promise<void> {
  if (!env.BREVO_API_KEY) return; // invio disattivato (sviluppo locale / test)
  if (!env.EMAIL_MITTENTE || !env.EMAIL_ADMIN) {
    console.error('notifiche: EMAIL_MITTENTE o EMAIL_ADMIN non configurati, invio saltato');
    return;
  }

  const corpo: Record<string, unknown> = {
    sender: { name: NOME_MITTENTE, email: env.EMAIL_MITTENTE },
    to: [{ email: notifica.societa.email, name: notifica.societa.nome }],
    replyTo: { email: env.EMAIL_ADMIN },
    subject: `${PREFISSO_OGGETTO} ${notifica.oggetto}`,
    textContent: corpoNotifica(notifica, origine),
  };
  // L'admin è in copia su ogni notifica, salvo quando è lui stesso il
  // destinatario (società di casa): Brevo rifiuta lo stesso indirizzo
  // presente sia in "to" sia in "cc".
  if (notifica.societa.email.toLowerCase() !== env.EMAIL_ADMIN.toLowerCase()) {
    corpo.cc = [{ email: env.EMAIL_ADMIN }];
  }

  try {
    const risposta = await fetch(URL_API_BREVO, {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_INVIO_MS),
    });
    if (!risposta.ok) throw new Error(`Brevo ha risposto ${risposta.status}`);
  } catch (errore) {
    // Nell'audit niente indirizzi email (minimizzazione): bastano oggetto
    // e nome società a capire quale notifica va rispedita a mano.
    console.error('notifiche: invio fallito', errore);
    try {
      await scriviAudit(env.DB, 'notifica_fallita', `"${notifica.oggetto}" per ${notifica.societa.nome}`, 'sistema');
    } catch {
      // Anche l'audit è best effort: mai propagare errori da waitUntil.
    }
  }
}

// ---------------------------------------------------------------------------
// Eventi del ciclo di vita — tutti i testi delle email vivono qui.
// ---------------------------------------------------------------------------

/** Società: nuova richiesta singola inviata (in attesa di approvazione). */
export function notificaRichiestaInviata(c: ContestoNotifica, societa: SocietaDaNotificare, richiesta: EstremiRichiesta): void {
  inviaNotifica(c, {
    oggetto: `Richiesta di prenotazione inviata — ${dataItaliana(richiesta.data)}`,
    messaggio: "la richiesta di prenotazione è stata inviata e attende l'approvazione dell'amministratore.",
    dettagli: righeRichiesta(richiesta),
    societa,
  });
}

/** Società: nuova richiesta ricorrente inviata (in attesa di approvazione). */
export function notificaRicorrenzaInviata(c: ContestoNotifica, societa: SocietaDaNotificare, ricorrenza: EstremiRicorrenza): void {
  inviaNotifica(c, {
    oggetto: `Richiesta ricorrente inviata — dal ${dataItaliana(ricorrenza.valida_dal)}`,
    messaggio: "la richiesta di prenotazione ricorrente è stata inviata e attende l'approvazione dell'amministratore.",
    dettagli: righeRicorrenza(ricorrenza),
    societa,
  });
}

/** Società: richiesta in attesa ritirata (nuova o di annullamento). */
export function notificaRichiestaRitirata(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  richiesta: EstremiRichiesta,
  tipo: string,
): void {
  const eAnnullamento = tipo === 'annullamento';
  inviaNotifica(c, {
    oggetto: eAnnullamento
      ? `Richiesta di annullamento ritirata — ${dataItaliana(richiesta.data)}`
      : `Richiesta di prenotazione ritirata — ${dataItaliana(richiesta.data)}`,
    messaggio: eAnnullamento
      ? 'la richiesta di annullamento è stata ritirata dalla società: la prenotazione resta confermata.'
      : 'la richiesta di prenotazione è stata ritirata dalla società.',
    dettagli: righeRichiesta(richiesta),
    societa,
  });
}

/** Società: inviata la richiesta di annullamento di una prenotazione approvata. */
export function notificaAnnullamentoRichiesto(c: ContestoNotifica, societa: SocietaDaNotificare, richiesta: EstremiRichiesta): void {
  inviaNotifica(c, {
    oggetto: `Richiesta di annullamento inviata — ${dataItaliana(richiesta.data)}`,
    messaggio:
      "è stata inviata la richiesta di annullamento della prenotazione. Gli slot restano prenotati finché l'amministratore non la conferma.",
    dettagli: righeRichiesta(richiesta),
    societa,
  });
}

/** Società: ricorrenza non ancora approvata ritirata. */
export function notificaRicorrenzaRitirata(c: ContestoNotifica, societa: SocietaDaNotificare, ricorrenza: EstremiRicorrenza): void {
  inviaNotifica(c, {
    oggetto: `Richiesta ricorrente ritirata — dal ${dataItaliana(ricorrenza.valida_dal)}`,
    messaggio: 'la richiesta di prenotazione ricorrente è stata ritirata dalla società.',
    dettagli: righeRicorrenza(ricorrenza),
    societa,
  });
}

/** Admin: richiesta singola approvata (slot prenotati). */
export function notificaRichiestaApprovata(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  richiesta: EstremiRichiesta,
  motivazione: string,
): void {
  inviaNotifica(c, {
    oggetto: `Prenotazione confermata — ${dataItaliana(richiesta.data)}`,
    messaggio: 'la richiesta di prenotazione è stata approvata: gli slot sono ora prenotati.',
    dettagli: [...righeRichiesta(richiesta), `Motivazione: ${motivazione}`],
    societa,
  });
}

/** Admin: richiesta rifiutata (nuova o di annullamento). */
export function notificaRichiestaRifiutata(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  richiesta: EstremiRichiesta,
  tipo: string,
  motivazione: string,
): void {
  const eAnnullamento = tipo === 'annullamento';
  inviaNotifica(c, {
    oggetto: eAnnullamento
      ? `Richiesta di annullamento rifiutata — ${dataItaliana(richiesta.data)}`
      : `Richiesta di prenotazione rifiutata — ${dataItaliana(richiesta.data)}`,
    messaggio: eAnnullamento
      ? "la richiesta di annullamento è stata rifiutata dall'amministratore: la prenotazione resta confermata."
      : "la richiesta di prenotazione è stata rifiutata dall'amministratore.",
    dettagli: [...righeRichiesta(richiesta), `Motivazione: ${motivazione}`],
    societa,
  });
}

/** Admin: richiesta di annullamento approvata (prenotazione annullata). */
export function notificaAnnullamentoApprovato(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  richiesta: EstremiRichiesta,
  motivazione: string,
): void {
  inviaNotifica(c, {
    oggetto: `Annullamento confermato — ${dataItaliana(richiesta.data)}`,
    messaggio: 'la richiesta di annullamento è stata approvata: la prenotazione è annullata e gli slot sono di nuovo liberi.',
    dettagli: [...righeRichiesta(richiesta), `Motivazione: ${motivazione}`],
    societa,
  });
}

/** Admin: richiesta o prenotazione annullata direttamente dall'amministratore. */
export function notificaAnnullataDaAdmin(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  richiesta: EstremiRichiesta,
  tipo: string,
): void {
  const eAnnullamento = tipo === 'annullamento';
  inviaNotifica(c, {
    oggetto: eAnnullamento
      ? `Richiesta di annullamento annullata — ${dataItaliana(richiesta.data)}`
      : `Prenotazione annullata — ${dataItaliana(richiesta.data)}`,
    messaggio: eAnnullamento
      ? "la richiesta di annullamento è stata annullata dall'amministratore: la prenotazione resta confermata."
      : "la prenotazione è stata annullata dall'amministratore.",
    dettagli: righeRichiesta(richiesta),
    societa,
  });
}

/** Admin: ricorrenza approvata e materializzata nelle date elencate. */
export function notificaRicorrenzaApprovata(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  ricorrenza: EstremiRicorrenza,
  date: string[],
  motivazione: string,
): void {
  inviaNotifica(c, {
    oggetto: `Prenotazione ricorrente confermata — dal ${dataItaliana(ricorrenza.valida_dal)}`,
    messaggio: 'la richiesta di prenotazione ricorrente è stata approvata: le date elencate sono ora prenotate.',
    dettagli: [
      ...righeRicorrenza(ricorrenza),
      `Date prenotate: ${date.map(dataItaliana).join(', ')}`,
      `Motivazione: ${motivazione}`,
    ],
    societa,
  });
}

/** Admin: ricorrenza rifiutata. */
export function notificaRicorrenzaRifiutata(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  ricorrenza: EstremiRicorrenza,
  motivazione: string,
): void {
  inviaNotifica(c, {
    oggetto: `Richiesta ricorrente rifiutata — dal ${dataItaliana(ricorrenza.valida_dal)}`,
    messaggio: "la richiesta di prenotazione ricorrente è stata rifiutata dall'amministratore.",
    dettagli: [...righeRicorrenza(ricorrenza), `Motivazione: ${motivazione}`],
    societa,
  });
}

/** Admin: prenotazione diretta registrata a nome della società. */
export function notificaPrenotazioneDiretta(c: ContestoNotifica, societa: SocietaDaNotificare, richiesta: EstremiRichiesta): void {
  inviaNotifica(c, {
    oggetto: `Nuova prenotazione registrata — ${dataItaliana(richiesta.data)}`,
    messaggio: "l'amministratore ha registrato una prenotazione a nome della società.",
    dettagli: righeRichiesta(richiesta),
    societa,
  });
}

/** Admin: società sospesa, con il riepilogo della cascata di annullamenti. */
export function notificaSospensione(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  riepilogo: { slotLiberati: number; richiesteAnnullate: number },
): void {
  inviaNotifica(c, {
    oggetto: 'Accesso alle prenotazioni sospeso',
    messaggio:
      "l'accesso della società al sistema di prenotazione è stato sospeso dall'amministratore: le prenotazioni e le richieste future sono state annullate. Per chiarimenti è possibile rispondere a questa email.",
    dettagli: [
      `Slot futuri liberati: ${riepilogo.slotLiberati}`,
      `Richieste annullate: ${riepilogo.richiesteAnnullate}`,
    ],
    societa,
  });
}
