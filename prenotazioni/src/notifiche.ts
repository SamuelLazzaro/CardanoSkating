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
 *  - Testi (e oggetti, dove la prospettiva cambia) distinti per società e
 *    admin: per gli eventi avviati dalle società partono due email — una
 *    alla società ("Gentile <nome>, ...", Reply-To verso l'admin) e una
 *    all'admin ("La società <nome> ha ...", Reply-To verso la società,
 *    così rispondere = scrivere alla società).
 *    Per le azioni dell'admin parte solo l'email alla società: l'admin non
 *    viene notificato delle proprie azioni. Se la società ha la stessa
 *    email dell'admin (società "di casa") non parte alcuna email: è la
 *    stessa persona a fare tutto.
 *  - Solo testo semplice: niente HTML, quindi i contenuti inseriti dagli
 *    utenti (titoli, note, motivazioni) non possono iniettare markup. Il
 *    testo semplice però ha una struttura propria (righe indentate = un
 *    dettaglio a testa): i contenuti multilinea vanno resi come blocco
 *    citato, altrimenti restano falsificabili come righe di sistema —
 *    vedi righeNote.
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

/**
 * Estremi di una richiesta su singola data (per il corpo dell'email).
 * `note` compare solo nelle notifiche di creazione (vedi righeNote).
 */
type EstremiRichiesta = { data: string; ora_inizio: string; ora_fine: string; titolo?: string; note?: string | null };

/**
 * Estremi di una ricorrenza (per il corpo dell'email): i giorni della
 * settimana richiesti (0 = lunedì), l'orario e il periodo.
 * `note` compare solo nelle notifiche di creazione (vedi righeNote).
 */
type EstremiRicorrenza = {
  giorni: number[];
  ora_inizio: string;
  ora_fine: string;
  valida_dal: string;
  valida_al: string;
  titolo?: string;
  note?: string | null;
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
  /**
   * Frase per l'email all'admin ("La società <nome> ha ..."): presente solo
   * per gli eventi avviati dalle società, che sono gli unici a generare
   * anche l'email all'admin.
   */
  messaggioAdmin?: string;
  /**
   * Oggetto dell'email all'admin, quando la prospettiva cambia rispetto a
   * quella della società (es. richiesta "inviata" per chi la manda,
   * "ricevuta" per chi la riceve). Se assente si riusa `oggetto`.
   */
  oggettoAdmin?: string;
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

/**
 * Righe di dettaglio per una o più occorrenze con lo stesso orario (una
 * richiesta di annullamento o modifica su "questa e le successive"): con una
 * sola occorrenza è la riga classica, altrimenti l'elenco delle date e
 * l'orario comune, così l'email di un gruppo di 12 date resta leggibile.
 */
function righeOccorrenze(richieste: EstremiRichiesta[]): string[] {
  if (richieste.length === 1) return righeRichiesta(richieste[0]);
  const prima = richieste[0];
  const righe = [
    `Date (${richieste.length}): ${richieste.map((richiesta) => dataItaliana(richiesta.data)).join(', ')}`,
    `Orario: dalle ${prima.ora_inizio} alle ${prima.ora_fine}`,
  ];
  if (prima.titolo) righe.unshift(`Attività: ${prima.titolo}`);
  return righe;
}

/**
 * Righe "prima → dopo" di una modifica. `prima` e `dopo` sono allineati per
 * indice (stessa occorrenza). Su una singola occorrenza si mostrano i due
 * estremi completi; su più occorrenze le date non cambiano (una modifica di
 * serie non le tocca), quindi si elencano una volta sola con i due orari.
 * L'attività compare solo se cambia, così da non ripetere l'ovvio.
 */
function righeVariazione(prima: EstremiRichiesta[], dopo: EstremiRichiesta[]): string[] {
  const righe: string[] = [];
  if (prima.length === 1) {
    righe.push(
      `Prima: ${dataItaliana(prima[0].data)}, dalle ${prima[0].ora_inizio} alle ${prima[0].ora_fine}`,
      `Dopo: ${dataItaliana(dopo[0].data)}, dalle ${dopo[0].ora_inizio} alle ${dopo[0].ora_fine}`,
    );
  } else {
    righe.push(
      `Date (${dopo.length}): ${dopo.map((richiesta) => dataItaliana(richiesta.data)).join(', ')}`,
      `Orario prima: dalle ${prima[0].ora_inizio} alle ${prima[0].ora_fine}`,
      `Orario dopo: dalle ${dopo[0].ora_inizio} alle ${dopo[0].ora_fine}`,
    );
  }
  if (dopo[0].titolo && dopo[0].titolo !== prima[0].titolo) {
    righe.unshift(`Attività: ${dopo[0].titolo} (prima: ${prima[0].titolo ?? '—'})`);
  } else if (dopo[0].titolo) {
    righe.unshift(`Attività: ${dopo[0].titolo}`);
  }
  return righe;
}

/** Etichetta dell'evento a partire dal tipo di richiesta (nome al femminile). */
function nomeTipo(tipo: string): string {
  if (tipo === 'annullamento') return 'di annullamento';
  if (tipo === 'modifica') return 'di modifica';
  return 'di prenotazione';
}

/** Data nell'oggetto: la sola data, oppure la prima con il conteggio. */
function dateOggetto(richieste: EstremiRichiesta[]): string {
  if (richieste.length === 1) return dataItaliana(richieste[0].data);
  return `${richieste.length} date dal ${dataItaliana(richieste[0].data)}`;
}

/**
 * Righe di dettaglio per le note libere della società. Usate SOLO negli
 * eventi di creazione ("richiesta inviata/ricevuta"), dove la società le ha
 * appena scritte e servono all'admin per decidere; gli altri eventi non le
 * ripetono, anche se la riga DB che ricevono contiene il campo note.
 * Note vuote o assenti → nessuna riga.
 *
 * Le note sono testo libero scritto dagli utenti e possono essere
 * multilinea, quindi vanno rese come blocco citato: intestazione esplicita
 * e prefisso '> ' su OGNI riga. Senza il prefisso, le righe successive alla
 * prima verrebbero indentate esattamente come i dettagli generati dal
 * sistema ("Data: ...", "Motivazione: ..."), permettendo a una società di
 * forgiare righe apparentemente autorevoli nell'email dell'amministratore,
 * che è proprio chi deve decidere sulla richiesta.
 */
function righeNote(note: string | null | undefined): string[] {
  if (!note) return [];
  // Fine riga normalizzati: dal browser arrivano '\n', ma una chiamata API
  // diretta può usare '\r\n' o '\r', che spezzerebbero il blocco citato.
  const righeNota = note.replace(/\r\n?/g, '\n').split('\n');
  return ['Note (scritte dalla società):', ...righeNota.map((riga) => `> ${riga}`)];
}

/** Nomi dei giorni in elenco leggibile: [0, 2, 4] → 'lunedì, mercoledì e venerdì'. */
export function elencoGiorni(giorni: number[]): string {
  const nomi = giorni.map((giorno) => GIORNI_SETTIMANA[giorno]);
  if (nomi.length <= 1) return nomi.join('');
  return `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}`;
}

function righeRicorrenza(ricorrenza: EstremiRicorrenza): string[] {
  const etichettaGiorni = ricorrenza.giorni.length === 1 ? 'Giorno' : 'Giorni';
  const righe = [
    `${etichettaGiorni}: ogni ${elencoGiorni(ricorrenza.giorni)}, dalle ${ricorrenza.ora_inizio} alle ${ricorrenza.ora_fine}`,
    `Periodo: dal ${dataItaliana(ricorrenza.valida_dal)} al ${dataItaliana(ricorrenza.valida_al)}`,
  ];
  if (ricorrenza.titolo) righe.unshift(`Attività: ${ricorrenza.titolo}`);
  return righe;
}

/** Corpo in testo semplice dell'email alla società (esportato per i test). */
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

/** Corpo in testo semplice dell'email all'admin (esportato per i test). */
export function corpoNotificaAdmin(notifica: Notifica, origine: string): string {
  return [
    notifica.messaggioAdmin ?? '',
    '',
    ...notifica.dettagli.map((riga) => `  ${riga}`),
    '',
    '—',
    'Notifica automatica del sistema prenotazioni del Palazzetto dello Sport,',
    'Cardano Skating S.R.L. S.S.D. Rispondendo a questa email si scrive direttamente alla società.',
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
  // Società "di casa": stessa email dell'admin, quindi è la stessa persona
  // che gestisce sia la società sia le prenotazioni — nessuna email.
  if (notifica.societa.email.toLowerCase() === env.EMAIL_ADMIN.toLowerCase()) return;

  await inviaEmailBrevo(
    env,
    {
      sender: { name: NOME_MITTENTE, email: env.EMAIL_MITTENTE },
      to: [{ email: notifica.societa.email, name: notifica.societa.nome }],
      replyTo: { email: env.EMAIL_ADMIN },
      subject: `${PREFISSO_OGGETTO} ${notifica.oggetto}`,
      textContent: corpoNotifica(notifica, origine),
    },
    `"${notifica.oggetto}" per ${notifica.societa.nome}`,
  );

  // Solo eventi avviati dalle società: email all'admin con testo dedicato.
  if (notifica.messaggioAdmin) {
    const oggettoAdmin = notifica.oggettoAdmin ?? notifica.oggetto;
    await inviaEmailBrevo(
      env,
      {
        sender: { name: NOME_MITTENTE, email: env.EMAIL_MITTENTE },
        to: [{ email: env.EMAIL_ADMIN }],
        // Rispondendo alla notifica l'admin scrive direttamente alla società.
        replyTo: { email: notifica.societa.email, name: notifica.societa.nome },
        subject: `${PREFISSO_OGGETTO} ${oggettoAdmin}`,
        textContent: corpoNotificaAdmin(notifica, origine),
      },
      `"${oggettoAdmin}" per l'amministratore (società ${notifica.societa.nome})`,
    );
  }
}

/**
 * Singola chiamata all'API Brevo, con gestione errori autonoma: il fallimento
 * di un invio non deve impedire quello successivo né propagarsi a waitUntil.
 */
async function inviaEmailBrevo(env: Bindings, corpo: Record<string, unknown>, descrizioneAudit: string): Promise<void> {
  try {
    const risposta = await fetch(URL_API_BREVO, {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_INVIO_MS),
    });
    if (!risposta.ok) throw new Error(`Brevo ha risposto ${risposta.status}`);
  } catch (errore) {
    // Nell'audit niente indirizzi email (minimizzazione): bastano oggetto
    // e nome società a capire quale notifica va rispedita a mano.
    console.error('notifiche: invio fallito', errore);
    try {
      await scriviAudit(env.DB, 'notifica_fallita', descrizioneAudit, 'sistema');
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
    oggettoAdmin: `Richiesta di prenotazione ricevuta — ${dataItaliana(richiesta.data)}`,
    messaggio: "la richiesta di prenotazione è stata inviata e attende l'approvazione dell'amministratore.",
    messaggioAdmin: `La società ${societa.nome} ha inviato una richiesta di prenotazione, in attesa di approvazione.`,
    dettagli: [...righeRichiesta(richiesta), ...righeNote(richiesta.note)],
    societa,
  });
}

/** Società: nuova richiesta ricorrente inviata (in attesa di approvazione). */
export function notificaRicorrenzaInviata(c: ContestoNotifica, societa: SocietaDaNotificare, ricorrenza: EstremiRicorrenza): void {
  inviaNotifica(c, {
    oggetto: `Richiesta ricorrente inviata — dal ${dataItaliana(ricorrenza.valida_dal)}`,
    oggettoAdmin: `Richiesta ricorrente ricevuta — dal ${dataItaliana(ricorrenza.valida_dal)}`,
    messaggio: "la richiesta di prenotazione ricorrente è stata inviata e attende l'approvazione dell'amministratore.",
    messaggioAdmin: `La società ${societa.nome} ha inviato una richiesta di prenotazione ricorrente, in attesa di approvazione.`,
    dettagli: [...righeRicorrenza(ricorrenza), ...righeNote(ricorrenza.note)],
    societa,
  });
}

/**
 * Società: richiesta in attesa ritirata (di prenotazione, di annullamento o
 * di modifica; più occorrenze se era un gruppo).
 */
export function notificaRichiestaRitirata(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  richieste: EstremiRichiesta[],
  tipo: string,
): void {
  const restaConfermata = tipo === 'annullamento' || tipo === 'modifica';
  const plurale = richieste.length > 1;
  inviaNotifica(c, {
    oggetto: `Richiesta ${nomeTipo(tipo)} ritirata — ${dateOggetto(richieste)}`,
    messaggio: restaConfermata
      ? `la richiesta ${nomeTipo(tipo)} è stata ritirata dalla società: ${plurale ? 'le prenotazioni restano confermate' : 'la prenotazione resta confermata'} così ${plurale ? 'come erano' : "com'era"}.`
      : 'la richiesta di prenotazione è stata ritirata dalla società.',
    messaggioAdmin: restaConfermata
      ? `La società ${societa.nome} ha ritirato la richiesta ${nomeTipo(tipo)}: ${plurale ? 'le prenotazioni restano confermate' : 'la prenotazione resta confermata'}.`
      : `La società ${societa.nome} ha ritirato la richiesta di prenotazione.`,
    dettagli: righeOccorrenze(richieste),
    societa,
  });
}

/** Società: inviata la richiesta di annullamento di una o più prenotazioni approvate. */
export function notificaAnnullamentoRichiesto(c: ContestoNotifica, societa: SocietaDaNotificare, richieste: EstremiRichiesta[]): void {
  const plurale = richieste.length > 1;
  inviaNotifica(c, {
    oggetto: `Richiesta di annullamento inviata — ${dateOggetto(richieste)}`,
    oggettoAdmin: `Richiesta di annullamento ricevuta — ${dateOggetto(richieste)}`,
    messaggio: `è stata inviata la richiesta di annullamento ${plurale ? 'delle prenotazioni elencate' : 'della prenotazione'}. Gli slot restano prenotati finché l'amministratore non la conferma.`,
    messaggioAdmin: `La società ${societa.nome} ha richiesto l'annullamento di ${plurale ? `${richieste.length} prenotazioni approvate` : 'una prenotazione approvata'}. Gli slot restano prenotati finché la richiesta non viene decisa.`,
    dettagli: righeOccorrenze(richieste),
    societa,
  });
}

/** Società: inviata la richiesta di modifica di una o più prenotazioni approvate. */
export function notificaModificaRichiesta(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  prima: EstremiRichiesta[],
  dopo: EstremiRichiesta[],
): void {
  const plurale = prima.length > 1;
  inviaNotifica(c, {
    oggetto: `Richiesta di modifica inviata — ${dateOggetto(prima)}`,
    oggettoAdmin: `Richiesta di modifica ricevuta — ${dateOggetto(prima)}`,
    messaggio: `è stata inviata la richiesta di modifica ${plurale ? 'delle prenotazioni elencate' : 'della prenotazione'}. Fino alla decisione dell'amministratore ${plurale ? 'restano valide le prenotazioni attuali' : 'resta valida la prenotazione attuale'}.`,
    messaggioAdmin: `La società ${societa.nome} ha richiesto la modifica di ${plurale ? `${prima.length} prenotazioni approvate` : 'una prenotazione approvata'}. Fino alla decisione restano validi gli estremi attuali.`,
    dettagli: righeVariazione(prima, dopo),
    societa,
  });
}

/** Società: richiesta singola ancora in attesa modificata direttamente. */
export function notificaRichiestaModificata(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  prima: EstremiRichiesta,
  dopo: EstremiRichiesta,
): void {
  inviaNotifica(c, {
    oggetto: `Richiesta di prenotazione modificata — ${dataItaliana(dopo.data)}`,
    messaggio: "la richiesta di prenotazione in attesa è stata modificata; attende l'approvazione dell'amministratore con i nuovi estremi.",
    messaggioAdmin: `La società ${societa.nome} ha modificato una richiesta di prenotazione ancora in attesa di approvazione.`,
    dettagli: [...righeVariazione([prima], [dopo]), ...righeNote(dopo.note)],
    societa,
  });
}

/** Società: richiesta ricorrente ancora in attesa modificata direttamente. */
export function notificaRicorrenzaModificata(c: ContestoNotifica, societa: SocietaDaNotificare, ricorrenza: EstremiRicorrenza): void {
  inviaNotifica(c, {
    oggetto: `Richiesta ricorrente modificata — dal ${dataItaliana(ricorrenza.valida_dal)}`,
    messaggio: "la richiesta di prenotazione ricorrente in attesa è stata modificata; attende l'approvazione dell'amministratore con i nuovi estremi.",
    messaggioAdmin: `La società ${societa.nome} ha modificato una richiesta di prenotazione ricorrente ancora in attesa di approvazione.`,
    dettagli: [...righeRicorrenza(ricorrenza), ...righeNote(ricorrenza.note)],
    societa,
  });
}

/** Società: ricorrenza non ancora approvata ritirata. */
export function notificaRicorrenzaRitirata(c: ContestoNotifica, societa: SocietaDaNotificare, ricorrenza: EstremiRicorrenza): void {
  inviaNotifica(c, {
    oggetto: `Richiesta ricorrente ritirata — dal ${dataItaliana(ricorrenza.valida_dal)}`,
    messaggio: 'la richiesta di prenotazione ricorrente è stata ritirata dalla società.',
    messaggioAdmin: `La società ${societa.nome} ha ritirato la richiesta di prenotazione ricorrente.`,
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

/**
 * Admin: richiesta rifiutata (di prenotazione, di annullamento o di modifica;
 * più occorrenze se era un gruppo).
 */
export function notificaRichiestaRifiutata(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  richieste: EstremiRichiesta[],
  tipo: string,
  motivazione: string,
): void {
  const restaConfermata = tipo === 'annullamento' || tipo === 'modifica';
  const plurale = richieste.length > 1;
  inviaNotifica(c, {
    oggetto: `Richiesta ${nomeTipo(tipo)} rifiutata — ${dateOggetto(richieste)}`,
    messaggio: restaConfermata
      ? `la richiesta ${nomeTipo(tipo)} è stata rifiutata dall'amministratore: ${plurale ? 'le prenotazioni restano confermate' : 'la prenotazione resta confermata'} così ${plurale ? 'come erano' : "com'era"}.`
      : "la richiesta di prenotazione è stata rifiutata dall'amministratore.",
    dettagli: [...righeOccorrenze(richieste), `Motivazione: ${motivazione}`],
    societa,
  });
}

/** Admin: richiesta di annullamento approvata (prenotazioni annullate). */
export function notificaAnnullamentoApprovato(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  richieste: EstremiRichiesta[],
  motivazione: string,
): void {
  const plurale = richieste.length > 1;
  inviaNotifica(c, {
    oggetto: `Annullamento confermato — ${dateOggetto(richieste)}`,
    messaggio: `la richiesta di annullamento è stata approvata: ${plurale ? 'le prenotazioni elencate sono annullate' : 'la prenotazione è annullata'} e gli slot sono di nuovo liberi.`,
    dettagli: [...righeOccorrenze(richieste), `Motivazione: ${motivazione}`],
    societa,
  });
}

/** Admin: richiesta di modifica approvata (prenotazioni aggiornate ai nuovi estremi). */
export function notificaModificaApprovata(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  prima: EstremiRichiesta[],
  dopo: EstremiRichiesta[],
  motivazione: string,
): void {
  const plurale = prima.length > 1;
  inviaNotifica(c, {
    oggetto: `Modifica confermata — ${dateOggetto(dopo)}`,
    messaggio: `la richiesta di modifica è stata approvata: ${plurale ? 'le prenotazioni elencate sono aggiornate' : 'la prenotazione è aggiornata'} ai nuovi estremi.`,
    dettagli: [...righeVariazione(prima, dopo), `Motivazione: ${motivazione}`],
    societa,
  });
}

/**
 * Admin: richiesta o prenotazione annullata direttamente dall'amministratore
 * (più occorrenze quando annulla "questa e le successive").
 */
export function notificaAnnullataDaAdmin(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  richieste: EstremiRichiesta[],
  tipo: string,
): void {
  const restaConfermata = tipo === 'annullamento' || tipo === 'modifica';
  const plurale = richieste.length > 1;
  inviaNotifica(c, {
    oggetto: restaConfermata
      ? `Richiesta ${nomeTipo(tipo)} annullata — ${dateOggetto(richieste)}`
      : `${plurale ? 'Prenotazioni annullate' : 'Prenotazione annullata'} — ${dateOggetto(richieste)}`,
    messaggio: restaConfermata
      ? `la richiesta ${nomeTipo(tipo)} è stata annullata dall'amministratore: la prenotazione resta confermata così com'era.`
      : `${plurale ? 'le prenotazioni elencate sono state annullate' : 'la prenotazione è stata annullata'} dall'amministratore.`,
    dettagli: righeOccorrenze(richieste),
    societa,
  });
}

/** Admin: prenotazioni approvate modificate direttamente dall'amministratore. */
export function notificaModificataDaAdmin(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  prima: EstremiRichiesta[],
  dopo: EstremiRichiesta[],
): void {
  const plurale = prima.length > 1;
  inviaNotifica(c, {
    oggetto: `${plurale ? 'Prenotazioni modificate' : 'Prenotazione modificata'} — ${dateOggetto(dopo)}`,
    messaggio: `${plurale ? 'le prenotazioni elencate sono state modificate' : 'la prenotazione è stata modificata'} dall'amministratore: valgono i nuovi estremi riportati sotto. Eventuali richieste di modifica o annullamento in attesa su queste date sono decadute.`,
    dettagli: righeVariazione(prima, dopo),
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

/** Admin: prenotazione diretta ricorrente registrata e già materializzata nelle date elencate. */
export function notificaPrenotazioneDirettaRicorrente(
  c: ContestoNotifica,
  societa: SocietaDaNotificare,
  ricorrenza: EstremiRicorrenza,
  date: string[],
): void {
  inviaNotifica(c, {
    oggetto: `Nuova prenotazione ricorrente registrata — dal ${dataItaliana(ricorrenza.valida_dal)}`,
    messaggio: "l'amministratore ha registrato una prenotazione ricorrente a nome della società: le date elencate sono ora prenotate.",
    dettagli: [...righeRicorrenza(ricorrenza), `Date prenotate: ${date.map(dataItaliana).join(', ')}`],
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
