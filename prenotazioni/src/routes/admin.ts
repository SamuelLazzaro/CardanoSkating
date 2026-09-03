import { Hono, type Context } from 'hono';
import type { Bindings, RichiestaRow, RicorrenzaRow, StatoRichiesta } from '../tipi';
import {
  aggiungiGiorni,
  fineRicorrenza,
  giorniDaTesto,
  giorniInTesto,
  intervalloCalendario,
  isMeseValido,
  MAX_OCCORRENZE_RICORRENZA,
  meseSuccessivo,
  occorrenzeRicorrenza,
  oraRoma,
  ricorrenzaConGiorni,
  slotKeyCorrente,
  slotKeys,
  validaIntervallo,
} from '../slots';
import {
  cancellaCookieSessione,
  confrontoCostante,
  COOKIE_ADMIN,
  creaSessione,
  DURATA_ADMIN_S,
  richiedeAdmin,
  scriviCookieSessione,
} from '../auth';
import { tentativoConsentito } from '../ratelimit';
import { eConflittoSlot, trovaConflitti } from '../conflitti';
import {
  notificaAnnullamentoApprovato,
  notificaAnnullataDaAdmin,
  notificaModificaApprovata,
  notificaModificataDaAdmin,
  notificaPrenotazioneDiretta,
  notificaPrenotazioneDirettaRicorrente,
  notificaRichiestaApprovata,
  notificaRichiestaRifiutata,
  notificaRicorrenzaApprovata,
  notificaRicorrenzaRifiutata,
  notificaSospensione,
} from '../notifiche';
import {
  ambitoVariazione,
  campiModifica,
  chiaviDopoModifica,
  dataDopoModifica,
  eFutura,
  elencoId,
  idGruppo,
  istruzioniInserimentoSlot,
  modificaSenzaEffetto,
  occorrenzeDaVariare,
  slotDopoModifica,
} from '../variazioni';
import {
  COLORE_PREDEFINITO,
  coloreEsadecimale,
  emailValida,
  giorniRicorrenza,
  intero,
  leggiJson,
  MAX_MOTIVAZIONE,
  MAX_TITOLO,
  MIN_MOTIVAZIONE,
  motivazioneDecisione,
  scriviAudit,
  tariffaOraria,
  testo,
  titoloAttivita,
} from '../util';

const STATI_RICHIESTA: StatoRichiesta[] = ['in_attesa', 'approvata', 'rifiutata', 'annullata'];
const MAX_TENTATIVI_LOGIN = 10;
const FINESTRA_LOGIN_S = 15 * 60;

const ERRORE_MOTIVAZIONE = `Serve una motivazione (da ${MIN_MOTIVAZIONE} a ${MAX_MOTIVAZIONE} caratteri)`;
const ERRORE_GRUPPO = 'La richiesta fa parte di un gruppo: va decisa insieme alle altre del gruppo';

/** Riga di richiesta con i dati della società, come letta dalle route di decisione. */
type RichiestaConSocieta = RichiestaRow & { societa_stato: string; societa_nome: string; societa_email: string };

export const admin = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------------------------
// Login / logout (registrati PRIMA del guard: devono restare raggiungibili)
// ---------------------------------------------------------------------------

admin.post('/login', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'sconosciuto';
  if (!(await tentativoConsentito(c.env.DB, `login:${ip}`, MAX_TENTATIVI_LOGIN, FINESTRA_LOGIN_S))) {
    return c.json({ errore: 'Troppi tentativi: riprova tra qualche minuto' }, 429);
  }
  const corpo = await leggiJson(c);
  const password = typeof corpo?.password === 'string' ? corpo.password : '';
  const valida =
    password.length > 0 && password.length <= 200 && (await confrontoCostante(password, c.env.ADMIN_PASSWORD));
  if (!valida) {
    await scriviAudit(c.env.DB, 'admin_login_fallito', `ip ${ip}`, 'sistema');
    return c.json({ errore: 'Password errata' }, 401);
  }
  const cookie = await creaSessione(c.env.ADMIN_SECRET, ['admin'], DURATA_ADMIN_S, new Date());
  scriviCookieSessione(c, COOKIE_ADMIN, cookie, DURATA_ADMIN_S);
  await scriviAudit(c.env.DB, 'admin_login', `ip ${ip}`, 'admin');
  return c.json({ ok: true });
});

admin.post('/logout', (c) => {
  cancellaCookieSessione(c, COOKIE_ADMIN);
  return c.json({ ok: true });
});

admin.use('*', richiedeAdmin());

// ---------------------------------------------------------------------------
// Richieste
// ---------------------------------------------------------------------------

admin.get('/richieste', async (c) => {
  const stato = (c.req.query('stato') ?? 'in_attesa') as StatoRichiesta;
  if (!STATI_RICHIESTA.includes(stato)) return c.json({ errore: 'Stato non valido' }, 400);
  // Per le richieste di annullamento e di modifica si allegano gli estremi
  // ATTUALI della prenotazione riferita (rif_*): il pannello mostra così
  // "prima → dopo" senza una seconda chiamata.
  const { results } = await c.env.DB
    .prepare(
      `SELECT r.id, r.societa_id, s.nome AS societa, r.data, r.ora_inizio, r.ora_fine, r.stato, r.tipo,
              r.richiesta_riferimento_id, r.gruppo_id, r.titolo, r.note, r.motivazione, r.ricorrenza_id,
              r.created_at, r.decisa_at, r.annullata_at,
              o.data AS rif_data, o.ora_inizio AS rif_ora_inizio, o.ora_fine AS rif_ora_fine, o.titolo AS rif_titolo
       FROM richieste r
       JOIN societa s ON s.id = r.societa_id
       LEFT JOIN richieste o ON o.id = r.richiesta_riferimento_id
       WHERE r.stato = ?1 ORDER BY r.data, r.ora_inizio LIMIT 300`,
    )
    .bind(stato)
    .all();
  return c.json({ richieste: results });
});

/**
 * Approvazione di una richiesta singola, in un solo db.batch() atomico.
 *
 * Per una richiesta di tipo 'nuova':
 *   1. la richiesta passa ad 'approvata' (con guardia su stato='in_attesa',
 *      per non approvare due volte in caso di richieste concorrenti);
 *   2. le prenotazioni vengono inserite con INSERT..SELECT che produce righe
 *      SOLO se il passo 1 è andato a segno (guardia stato='approvata').
 * Se anche un solo slot è già occupato, il vincolo UNIQUE su slot_key fa
 * fallire l'intero batch (rollback implicito): a quel punto una singola query
 * diagnostica dice all'admin esattamente quali slot confliggono e con chi.
 *
 * Per una richiesta di tipo 'annullamento':
 *   1. la richiesta di annullamento passa ad 'approvata' (stessa guardia);
 *   2. gli slot della prenotazione originaria vengono liberati (DELETE);
 *   3. la prenotazione originaria passa ad 'annullata' con annullata_at.
 * I passi 2 e 3 hanno una guardia EXISTS sull'esito del passo 1: se la
 * richiesta non era più in attesa non toccano nulla.
 *
 * Per una richiesta di tipo 'modifica' (migrazione 0009), che porta i NUOVI
 * estremi nelle proprie colonne:
 *   1. la richiesta di modifica passa ad 'approvata' (stessa guardia);
 *   2. gli slot attuali della prenotazione originaria vengono liberati;
 *   3. la prenotazione originaria viene aggiornata SUL POSTO ai nuovi estremi
 *      (stesso id: il feed ICS aggiorna l'evento invece di ricrearlo e i
 *      filtri su tipo='nuova' restano validi). Se cambia la data, l'occorrenza
 *      esce dalla sua ricorrenza (ricorrenza_id = NULL): non rispetta più lo
 *      schema settimanale della serie e l'indice (ricorrenza, data) potrebbe
 *      altrimenti confliggere con un'altra occorrenza;
 *   4. i nuovi slot vengono prenotati per la prenotazione originaria.
 * Anche qui i passi 2-4 sono condizionati (EXISTS) all'esito del passo 1. Un
 * conflitto sui nuovi slot fa fallire tutto il batch e nulla cambia.
 *
 * Le richieste che fanno parte di un gruppo si decidono solo tutte insieme
 * (POST /gruppi/:gruppo/approva): qui vengono respinte.
 */
admin.post('/richieste/:id/approva', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const corpo = await leggiJson(c);
  const motivazione = motivazioneDecisione(corpo?.motivazione);
  if (motivazione === null) return c.json({ errore: ERRORE_MOTIVAZIONE }, 400);

  const richiesta = await c.env.DB
    .prepare(
      `SELECT r.*, s.stato AS societa_stato, s.nome AS societa_nome, s.email AS societa_email
       FROM richieste r JOIN societa s ON s.id = r.societa_id WHERE r.id = ?1`,
    )
    .bind(id)
    .first<RichiestaConSocieta>();
  if (!richiesta) return c.json({ errore: 'Richiesta non trovata' }, 404);
  if (richiesta.stato !== 'in_attesa') {
    return c.json({ errore: `La richiesta non è in attesa (stato attuale: ${richiesta.stato})` }, 409);
  }
  if (richiesta.gruppo_id !== null) return c.json({ errore: ERRORE_GRUPPO }, 409);
  if (richiesta.societa_stato !== 'attiva') return c.json({ errore: 'La società è sospesa' }, 409);
  if (richiesta.data < oraRoma(new Date()).data) return c.json({ errore: 'La data della richiesta è già passata' }, 409);
  const societaDaNotificare = { nome: richiesta.societa_nome, email: richiesta.societa_email };

  if (richiesta.tipo === 'annullamento' || richiesta.tipo === 'modifica') {
    const originaria = await c.env.DB
      .prepare('SELECT * FROM richieste WHERE id = ?1')
      .bind(richiesta.richiesta_riferimento_id)
      .first<RichiestaRow>();
    if (!originaria || originaria.stato !== 'approvata' || originaria.tipo !== 'nuova') {
      return c.json({ errore: `La prenotazione da ${richiesta.tipo === 'modifica' ? 'modificare' : 'annullare'} non è più attiva` }, 409);
    }

    // Passi 1-3 comuni: approvazione, slot attuali liberati, prenotazione
    // originaria aggiornata (annullata, oppure portata ai nuovi estremi).
    const approvazione = c.env.DB
      .prepare(
        `UPDATE richieste SET stato = 'approvata', decisa_at = datetime('now'), motivazione = ?2
         WHERE id = ?1 AND stato = 'in_attesa'`,
      )
      .bind(id, motivazione);
    const liberaSlot = c.env.DB
      .prepare(
        `DELETE FROM prenotazioni WHERE richiesta_id = ?1
         AND EXISTS (SELECT 1 FROM richieste m WHERE m.id = ?2 AND m.stato = 'approvata')`,
      )
      .bind(originaria.id, id);

    if (richiesta.tipo === 'annullamento') {
      const esiti = await c.env.DB.batch([
        approvazione,
        liberaSlot,
        c.env.DB
          .prepare(
            `UPDATE richieste SET stato = 'annullata', annullata_at = datetime('now')
             WHERE id = ?1 AND stato = 'approvata'
             AND EXISTS (SELECT 1 FROM richieste m WHERE m.id = ?2 AND m.stato = 'approvata')`,
          )
          .bind(originaria.id, id),
      ]);
      if ((esiti[0].meta.changes ?? 0) === 0) return c.json({ errore: 'La richiesta non è più in attesa' }, 409);

      await scriviAudit(
        c.env.DB,
        'annullamento_approvato',
        `richiesta ${originaria.id} annullata su richiesta ${id} (${richiesta.data} ${richiesta.ora_inizio}-${richiesta.ora_fine}) — motivazione: ${motivazione}`,
        'admin',
      );
      notificaAnnullamentoApprovato(c, societaDaNotificare, [richiesta], motivazione);
      return c.json({ ok: true, slot_liberati: esiti[1].meta.changes ?? 0 });
    }

    // Modifica: i nuovi estremi sono quelli della richiesta di modifica.
    const nuoveChiavi = slotKeys(richiesta.data, richiesta.ora_inizio, richiesta.ora_fine);
    const conflittiPrevisti = await trovaConflitti(c.env.DB, nuoveChiavi, [originaria.id]);
    if (conflittiPrevisti.length > 0) {
      return c.json({ errore: 'Impossibile approvare la modifica: alcuni slot sono già occupati', conflitti: conflittiPrevisti }, 409);
    }
    const cambiaData = richiesta.data !== originaria.data;
    let esiti: D1Result[];
    try {
      esiti = await c.env.DB.batch([
        approvazione,
        liberaSlot,
        c.env.DB
          .prepare(
            `UPDATE richieste
             SET data = ?3, ora_inizio = ?4, ora_fine = ?5, titolo = ?6, note = ?7,
                 ricorrenza_id = CASE WHEN ?8 THEN NULL ELSE ricorrenza_id END
             WHERE id = ?1 AND stato = 'approvata'
             AND EXISTS (SELECT 1 FROM richieste m WHERE m.id = ?2 AND m.stato = 'approvata')`,
          )
          .bind(originaria.id, id, richiesta.data, richiesta.ora_inizio, richiesta.ora_fine, richiesta.titolo, richiesta.note, cambiaData ? 1 : 0),
        ...istruzioniInserimentoSlot(c.env.DB, nuoveChiavi.map((chiave) => ({ chiave, richiestaId: originaria.id })), { modifica: id }),
      ]);
    } catch (errore) {
      if (!eConflittoSlot(errore)) throw errore;
      const conflitti = await trovaConflitti(c.env.DB, nuoveChiavi, [originaria.id]);
      return c.json({ errore: 'Impossibile approvare la modifica: alcuni slot sono già occupati', conflitti }, 409);
    }
    if ((esiti[0].meta.changes ?? 0) === 0) return c.json({ errore: 'La richiesta non è più in attesa' }, 409);

    await scriviAudit(
      c.env.DB,
      'modifica_approvata',
      `richiesta ${originaria.id} portata a ${richiesta.data} ${richiesta.ora_inizio}-${richiesta.ora_fine} su richiesta ${id} — motivazione: ${motivazione}`,
      'admin',
    );
    notificaModificaApprovata(c, societaDaNotificare, [originaria], [richiesta], motivazione);
    return c.json({ ok: true, slot_liberati: esiti[1].meta.changes ?? 0, slot_inseriti: nuoveChiavi.length });
  }

  const chiavi = slotKeys(richiesta.data, richiesta.ora_inizio, richiesta.ora_fine);
  const segnaposto = chiavi.map(() => '(?)').join(', ');
  let esiti: D1Result[];
  try {
    esiti = await c.env.DB.batch([
      c.env.DB
        .prepare(
          `UPDATE richieste SET stato = 'approvata', decisa_at = datetime('now'), motivazione = ?2
           WHERE id = ?1 AND stato = 'in_attesa'`,
        )
        .bind(id, motivazione),
      c.env.DB
        .prepare(
          `WITH slot(chiave) AS (VALUES ${segnaposto})
           INSERT INTO prenotazioni (slot_key, societa_id, richiesta_id)
           SELECT slot.chiave, r.societa_id, r.id FROM slot, richieste r WHERE r.id = ? AND r.stato = 'approvata'`,
        )
        .bind(...chiavi, id),
    ]);
  } catch (errore) {
    if (!eConflittoSlot(errore)) throw errore;
    const conflitti = await trovaConflitti(c.env.DB, chiavi);
    return c.json({ errore: 'Impossibile approvare: alcuni slot sono già occupati', conflitti }, 409);
  }
  if ((esiti[1].meta.changes ?? 0) === 0) return c.json({ errore: 'La richiesta non è più in attesa' }, 409);

  await scriviAudit(
    c.env.DB,
    'richiesta_approvata',
    `richiesta ${id} (${richiesta.data} ${richiesta.ora_inizio}-${richiesta.ora_fine}) — motivazione: ${motivazione}`,
    'admin',
  );
  notificaRichiestaApprovata(c, societaDaNotificare, richiesta, motivazione);
  return c.json({ ok: true, slot_inseriti: chiavi.length });
});

admin.post('/richieste/:id/rifiuta', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const corpo = await leggiJson(c);
  const motivazione = motivazioneDecisione(corpo?.motivazione);
  if (motivazione === null) return c.json({ errore: ERRORE_MOTIVAZIONE }, 400);

  // La lettura serve ai dettagli della notifica email e alla guardia sul
  // gruppo: quella di stato resta nell'UPDATE, che decide da solo l'esito.
  const richiesta = await c.env.DB
    .prepare(
      `SELECT r.data, r.ora_inizio, r.ora_fine, r.tipo, r.titolo, r.gruppo_id, s.nome AS societa_nome, s.email AS societa_email
       FROM richieste r JOIN societa s ON s.id = r.societa_id WHERE r.id = ?1`,
    )
    .bind(id)
    .first<RichiestaRow & { societa_nome: string; societa_email: string }>();
  if (richiesta?.gruppo_id) return c.json({ errore: ERRORE_GRUPPO }, 409);

  const esito = await c.env.DB
    .prepare(
      `UPDATE richieste SET stato = 'rifiutata', decisa_at = datetime('now'), motivazione = ?2
       WHERE id = ?1 AND stato = 'in_attesa'`,
    )
    .bind(id, motivazione)
    .run();
  if ((esito.meta.changes ?? 0) === 0) return c.json({ errore: 'Richiesta non trovata o non più in attesa' }, 409);
  await scriviAudit(c.env.DB, 'richiesta_rifiutata', `richiesta ${id} — motivazione: ${motivazione}`, 'admin');
  if (richiesta) {
    notificaRichiestaRifiutata(c, { nome: richiesta.societa_nome, email: richiesta.societa_email }, [richiesta], richiesta.tipo, motivazione);
  }
  return c.json({ ok: true });
});

/**
 * Prenotazione approvata (tipo 'nuova', futura) su cui l'admin vuole agire dal
 * calendario, con i dati della società per la notifica. Ritorna la risposta
 * d'errore pronta se non si può procedere.
 */
async function prenotazioneDaVariare(
  c: Context<{ Bindings: Bindings }>,
  id: number,
  verbo: string,
): Promise<{ prenotazione: RichiestaConSocieta } | { risposta: Response }> {
  const prenotazione = await c.env.DB
    .prepare(
      `SELECT r.*, s.stato AS societa_stato, s.nome AS societa_nome, s.email AS societa_email
       FROM richieste r JOIN societa s ON s.id = r.societa_id WHERE r.id = ?1`,
    )
    .bind(id)
    .first<RichiestaConSocieta>();
  if (!prenotazione) return { risposta: c.json({ errore: 'Prenotazione non trovata' }, 404) };
  if (prenotazione.tipo !== 'nuova' || prenotazione.stato !== 'approvata') {
    return { risposta: c.json({ errore: `Si può ${verbo} solo una prenotazione approvata` }, 409) };
  }
  if (!eFutura(prenotazione, oraRoma(new Date()))) {
    return { risposta: c.json({ errore: `Non si può ${verbo} una prenotazione già iniziata o passata` }, 409) };
  }
  return { prenotazione };
}

/**
 * Cancellazione da parte dell'admin, immediata e senza motivazione: di una
 * singola richiesta (in attesa o approvata) oppure, con ambito 'successive' su
 * una prenotazione ricorrente approvata, di quella e di tutte le successive
 * occorrenze della stessa serie. Le occorrenze di una ricorrenza materializzata
 * sono richieste indipendenti, quindi l'ambito 'singola' non rompe mai il
 * resto della serie. Numero di statement fisso: gli id vanno in una clausola
 * IN (al più MAX_OCCORRENZE_RICORRENZA).
 */
admin.post('/richieste/:id/annulla', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  // Il corpo è facoltativo: senza, l'ambito è la singola richiesta.
  const corpo = await leggiJson(c);
  const ambito = ambitoVariazione(corpo?.ambito);
  if (ambito === null) return c.json({ errore: "Ambito non valido (atteso 'singola' o 'successive')" }, 400);

  const richiesta = await c.env.DB
    .prepare(
      `SELECT r.*, s.stato AS societa_stato, s.nome AS societa_nome, s.email AS societa_email
       FROM richieste r JOIN societa s ON s.id = r.societa_id WHERE r.id = ?1`,
    )
    .bind(id)
    .first<RichiestaConSocieta>();
  if (!richiesta) return c.json({ errore: 'Richiesta non trovata' }, 404);
  if (richiesta.stato !== 'in_attesa' && richiesta.stato !== 'approvata') {
    return c.json({ errore: 'La richiesta è già stata rifiutata o annullata' }, 409);
  }
  if (richiesta.data < oraRoma(new Date()).data) {
    return c.json({ errore: 'Non si possono annullare date già passate' }, 409);
  }
  if (ambito === 'successive' && (richiesta.tipo !== 'nuova' || richiesta.stato !== 'approvata')) {
    return c.json({ errore: "L'ambito 'successive' vale solo per una prenotazione approvata" }, 409);
  }

  const occorrenze = await occorrenzeDaVariare(c.env.DB, richiesta, ambito);
  const { segnaposto, ids } = elencoId(occorrenze);
  const esiti = await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM prenotazioni WHERE richiesta_id IN (${segnaposto})`).bind(...ids),
    c.env.DB
      .prepare(
        `UPDATE richieste SET stato = 'annullata', annullata_at = datetime('now')
         WHERE id IN (${segnaposto}) AND stato IN ('in_attesa', 'approvata')`,
      )
      .bind(...ids),
    // Le eventuali richieste di annullamento o modifica pendenti che puntavano
    // a queste prenotazioni decadono con esse (non resterebbero approvabili).
    c.env.DB
      .prepare(
        `UPDATE richieste SET stato = 'annullata', annullata_at = datetime('now')
         WHERE richiesta_riferimento_id IN (${segnaposto}) AND stato = 'in_attesa'`,
      )
      .bind(...ids),
  ]);
  const annullate = esiti[1].meta.changes ?? 0;
  if (annullate === 0) return c.json({ errore: 'La richiesta risulta già decisa o annullata' }, 409);
  await scriviAudit(
    c.env.DB,
    'richiesta_annullata',
    `richieste ${ids.join(', ')} (${occorrenze.map((o) => o.data).join(', ')} ${richiesta.ora_inizio}-${richiesta.ora_fine})`,
    'admin',
  );
  notificaAnnullataDaAdmin(c, { nome: richiesta.societa_nome, email: richiesta.societa_email }, occorrenze, richiesta.tipo);
  return c.json({ ok: true, richieste_annullate: annullate, slot_liberati: esiti[0].meta.changes ?? 0 });
});

/**
 * Modifica DIRETTA di una prenotazione approvata da parte dell'admin (data,
 * orario, attività, note), immediata e senza motivazione, con notifica alla
 * società. Con ambito 'successive' su una prenotazione ricorrente si applica a
 * quella e alle successive occorrenze della serie: orario, attività e note, mai
 * la data (vedi variazioni.campiModifica). Se cambia la data, l'occorrenza
 * esce dalla ricorrenza (ricorrenza_id = NULL).
 *
 * Un solo db.batch() atomico, con numero di statement limitato: DELETE degli
 * slot attuali e UPDATE delle occorrenze per clausola IN, decadenza delle
 * richieste pendenti riferite, poi gli INSERT dei nuovi slot a blocchi. Un
 * conflitto su un qualsiasi nuovo slot annulla tutto.
 */
admin.patch('/richieste/:id', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const corpo = await leggiJson(c);
  if (!corpo) return c.json({ errore: 'Corpo della richiesta non valido' }, 400);
  const ambito = ambitoVariazione(corpo.ambito);
  if (ambito === null) return c.json({ errore: "Ambito non valido (atteso 'singola' o 'successive')" }, 400);

  const lettura = await prenotazioneDaVariare(c, id, 'modificare');
  if ('risposta' in lettura) return lettura.risposta;
  const { prenotazione } = lettura;

  const campi = campiModifica(corpo, ambito, prenotazione.data);
  if ('errore' in campi) return c.json({ errore: campi.errore }, 400);
  if (modificaSenzaEffetto(campi, prenotazione)) return c.json({ errore: 'Nessuna modifica rispetto alla prenotazione attuale' }, 400);
  if (!eFutura({ data: campi.data ?? prenotazione.data, ora_inizio: campi.oraInizio }, oraRoma(new Date()))) {
    return c.json({ errore: 'La prenotazione modificata deve iniziare nel futuro' }, 400);
  }

  const occorrenze = await occorrenzeDaVariare(c.env.DB, prenotazione, ambito);
  const { segnaposto, ids } = elencoId(occorrenze);
  const nuoveChiavi = chiaviDopoModifica(campi, occorrenze);
  const conflittiPrevisti = await trovaConflitti(c.env.DB, nuoveChiavi, ids);
  if (conflittiPrevisti.length > 0) {
    return c.json({ errore: 'Impossibile modificare: alcuni slot sono già occupati', conflitti: conflittiPrevisti }, 409);
  }

  let esiti: D1Result[];
  try {
    esiti = await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM prenotazioni WHERE richiesta_id IN (${segnaposto})`).bind(...ids),
      // La data cambia solo con ambito 'singola' (una sola occorrenza): con
      // campi.data NULL ogni occorrenza conserva la propria e resta nella serie.
      c.env.DB
        .prepare(
          `UPDATE richieste
           SET data = COALESCE(?1, data), ora_inizio = ?2, ora_fine = ?3, titolo = ?4, note = ?5,
               ricorrenza_id = CASE WHEN ?1 IS NULL THEN ricorrenza_id ELSE NULL END
           WHERE id IN (${segnaposto}) AND stato = 'approvata'`,
        )
        .bind(campi.data, campi.oraInizio, campi.oraFine, campi.titolo, campi.note, ...ids),
      c.env.DB
        .prepare(
          `UPDATE richieste SET stato = 'annullata', annullata_at = datetime('now')
           WHERE richiesta_riferimento_id IN (${segnaposto}) AND stato = 'in_attesa'`,
        )
        .bind(...ids),
      ...istruzioniInserimentoSlot(c.env.DB, slotDopoModifica(campi, occorrenze)),
    ]);
  } catch (errore) {
    if (!eConflittoSlot(errore)) throw errore;
    const conflitti = await trovaConflitti(c.env.DB, nuoveChiavi, ids);
    return c.json({ errore: 'Impossibile modificare: alcuni slot sono già occupati', conflitti }, 409);
  }

  const modificate = esiti[1].meta.changes ?? 0;
  const dopo = occorrenze.map((occorrenza) => ({
    data: dataDopoModifica(campi, occorrenza),
    ora_inizio: campi.oraInizio,
    ora_fine: campi.oraFine,
    titolo: campi.titolo,
  }));
  await scriviAudit(
    c.env.DB,
    'prenotazione_modificata',
    `richieste ${ids.join(', ')} portate a ${dopo.map((d) => d.data).join(', ')} ${campi.oraInizio}-${campi.oraFine}`,
    'admin',
  );
  notificaModificataDaAdmin(c, { nome: prenotazione.societa_nome, email: prenotazione.societa_email }, occorrenze, dopo);
  return c.json({ ok: true, richieste_modificate: modificate, slot_inseriti: nuoveChiavi.length, date: dopo.map((d) => d.data) });
});

// ---------------------------------------------------------------------------
// Gruppi di richieste (annullamento o modifica su più occorrenze)
// ---------------------------------------------------------------------------

/** Membri in attesa di un gruppo, con la prenotazione riferita di ciascuno. */
type MembroGruppo = RichiestaRow & {
  societa_stato: string;
  societa_nome: string;
  societa_email: string;
  rif_stato: string | null;
  rif_tipo: string | null;
  rif_data: string | null;
  rif_ora_inizio: string | null;
  rif_ora_fine: string | null;
  rif_titolo: string | null;
  rif_note: string | null;
};

async function membriInAttesa(db: D1Database, gruppo: string): Promise<MembroGruppo[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, s.stato AS societa_stato, s.nome AS societa_nome, s.email AS societa_email,
              o.stato AS rif_stato, o.tipo AS rif_tipo, o.data AS rif_data, o.ora_inizio AS rif_ora_inizio,
              o.ora_fine AS rif_ora_fine, o.titolo AS rif_titolo, o.note AS rif_note
       FROM richieste r
       JOIN societa s ON s.id = r.societa_id
       LEFT JOIN richieste o ON o.id = r.richiesta_riferimento_id
       WHERE r.gruppo_id = ?1 AND r.stato = 'in_attesa'
       ORDER BY r.data, r.ora_inizio LIMIT ${MAX_OCCORRENZE_RICORRENZA}`,
    )
    .bind(gruppo)
    .all<MembroGruppo>();
  return results;
}

/** Estremi della prenotazione riferita da un membro, per le notifiche. */
function estremiRiferiti(membro: MembroGruppo): { data: string; ora_inizio: string; ora_fine: string; titolo: string } {
  return { data: membro.rif_data!, ora_inizio: membro.rif_ora_inizio!, ora_fine: membro.rif_ora_fine!, titolo: membro.rif_titolo! };
}

/**
 * Approvazione di un GRUPPO di richieste (tutte di annullamento o tutte di
 * modifica, sulla stessa serie): una decisione, una motivazione, un solo
 * db.batch() atomico, una sola email. Stessa logica dell'approvazione singola,
 * ma per insiemi: i membri passano ad 'approvata' (guardia su 'in_attesa') e
 * ogni passo successivo agisce solo sulle prenotazioni riferite da un membro
 * che risulta approvato (guardia EXISTS sul gruppo), così una decisione
 * concorrente su qualche membro non lascia mai slot orfani.
 *
 * I membri la cui data è già passata non sono più approvabili: decadono
 * ('annullata') nello stesso batch e il resto del gruppo procede.
 */
admin.post('/gruppi/:gruppo/approva', async (c) => {
  const gruppo = idGruppo(c.req.param('gruppo'));
  if (gruppo === null) return c.json({ errore: 'Identificativo di gruppo non valido' }, 400);
  const corpo = await leggiJson(c);
  const motivazione = motivazioneDecisione(corpo?.motivazione);
  if (motivazione === null) return c.json({ errore: ERRORE_MOTIVAZIONE }, 400);

  const membri = await membriInAttesa(c.env.DB, gruppo);
  if (membri.length === 0) return c.json({ errore: 'Il gruppo non ha richieste in attesa' }, 409);
  const tipo = membri[0].tipo;
  if (tipo === 'nuova' || membri.some((m) => m.tipo !== tipo || m.societa_id !== membri[0].societa_id)) {
    return c.json({ errore: 'Gruppo incoerente' }, 409);
  }
  if (membri[0].societa_stato !== 'attiva') return c.json({ errore: 'La società è sospesa' }, 409);
  if (membri.some((m) => m.rif_stato !== 'approvata' || m.rif_tipo !== 'nuova')) {
    return c.json({ errore: 'Una delle prenotazioni del gruppo non è più attiva' }, 409);
  }
  const oggi = oraRoma(new Date()).data;
  const futuri = membri.filter((m) => m.data >= oggi);
  if (futuri.length === 0) return c.json({ errore: 'Tutte le date del gruppo sono già passate' }, 409);
  const { segnaposto: segnapostoFuturi, ids: idFuturi } = elencoId(futuri);
  const societaDaNotificare = { nome: membri[0].societa_nome, email: membri[0].societa_email };

  const approvaMembri = c.env.DB
    .prepare(
      `UPDATE richieste SET stato = 'approvata', decisa_at = datetime('now'), motivazione = ?1
       WHERE gruppo_id = ?2 AND stato = 'in_attesa' AND id IN (${segnapostoFuturi})`,
    )
    .bind(motivazione, gruppo, ...idFuturi);
  // Dopo l'approvazione dei futuri restano in attesa solo i membri passati.
  const decadonoPassati = c.env.DB
    .prepare("UPDATE richieste SET stato = 'annullata', annullata_at = datetime('now') WHERE gruppo_id = ?1 AND stato = 'in_attesa'")
    .bind(gruppo);
  const riferiteApprovate = `SELECT m.richiesta_riferimento_id FROM richieste m WHERE m.gruppo_id = ?1 AND m.stato = 'approvata'`;
  const liberaSlot = c.env.DB.prepare(`DELETE FROM prenotazioni WHERE richiesta_id IN (${riferiteApprovate})`).bind(gruppo);

  if (tipo === 'annullamento') {
    const esiti = await c.env.DB.batch([
      approvaMembri,
      decadonoPassati,
      liberaSlot,
      c.env.DB
        .prepare(
          `UPDATE richieste SET stato = 'annullata', annullata_at = datetime('now')
           WHERE stato = 'approvata' AND id IN (${riferiteApprovate})`,
        )
        .bind(gruppo),
    ]);
    const approvate = esiti[0].meta.changes ?? 0;
    if (approvate === 0) return c.json({ errore: 'Il gruppo non è più in attesa' }, 409);
    await scriviAudit(
      c.env.DB,
      'annullamento_approvato',
      `gruppo ${gruppo}: annullate ${approvate} prenotazioni (${futuri.map((m) => m.data).join(', ')}) — motivazione: ${motivazione}`,
      'admin',
    );
    notificaAnnullamentoApprovato(c, societaDaNotificare, futuri.map(estremiRiferiti), motivazione);
    return c.json({ ok: true, richieste_approvate: approvate, slot_liberati: esiti[2].meta.changes ?? 0 });
  }

  // Modifica di gruppo: stessi nuovi orario/attività/note per tutte le
  // occorrenze e data invariata (così nascono, vedi routes/societa.ts).
  const nuovi = futuri[0];
  if (futuri.some((m) => m.data !== m.rif_data || m.ora_inizio !== nuovi.ora_inizio || m.ora_fine !== nuovi.ora_fine)) {
    return c.json({ errore: 'Gruppo di modifica incoerente' }, 409);
  }
  const slotNuovi = futuri.flatMap((m) =>
    slotKeys(m.data, m.ora_inizio, m.ora_fine).map((chiave) => ({ chiave, richiestaId: m.richiesta_riferimento_id! })),
  );
  const nuoveChiavi = slotNuovi.map((s) => s.chiave);
  const idRiferite = futuri.map((m) => m.richiesta_riferimento_id!);
  const conflittiPrevisti = await trovaConflitti(c.env.DB, nuoveChiavi, idRiferite);
  if (conflittiPrevisti.length > 0) {
    return c.json({ errore: 'Impossibile approvare la modifica: alcuni slot sono già occupati', conflitti: conflittiPrevisti }, 409);
  }

  let esiti: D1Result[];
  try {
    esiti = await c.env.DB.batch([
      approvaMembri,
      decadonoPassati,
      liberaSlot,
      c.env.DB
        .prepare(
          `UPDATE richieste SET ora_inizio = ?2, ora_fine = ?3, titolo = ?4, note = ?5
           WHERE stato = 'approvata' AND id IN (${riferiteApprovate})`,
        )
        .bind(gruppo, nuovi.ora_inizio, nuovi.ora_fine, nuovi.titolo, nuovi.note),
      ...istruzioniInserimentoSlot(c.env.DB, slotNuovi, { gruppo }),
    ]);
  } catch (errore) {
    if (!eConflittoSlot(errore)) throw errore;
    const conflitti = await trovaConflitti(c.env.DB, nuoveChiavi, idRiferite);
    return c.json({ errore: 'Impossibile approvare la modifica: alcuni slot sono già occupati', conflitti }, 409);
  }
  const approvate = esiti[0].meta.changes ?? 0;
  if (approvate === 0) return c.json({ errore: 'Il gruppo non è più in attesa' }, 409);
  await scriviAudit(
    c.env.DB,
    'modifica_approvata',
    `gruppo ${gruppo}: ${approvate} prenotazioni portate a ${nuovi.ora_inizio}-${nuovi.ora_fine} (${futuri.map((m) => m.data).join(', ')}) — motivazione: ${motivazione}`,
    'admin',
  );
  notificaModificaApprovata(c, societaDaNotificare, futuri.map(estremiRiferiti), futuri, motivazione);
  return c.json({ ok: true, richieste_approvate: approvate, slot_liberati: esiti[2].meta.changes ?? 0, slot_inseriti: nuoveChiavi.length });
});

/** Rifiuto di un intero gruppo, con motivazione: le prenotazioni riferite restano com'erano. */
admin.post('/gruppi/:gruppo/rifiuta', async (c) => {
  const gruppo = idGruppo(c.req.param('gruppo'));
  if (gruppo === null) return c.json({ errore: 'Identificativo di gruppo non valido' }, 400);
  const corpo = await leggiJson(c);
  const motivazione = motivazioneDecisione(corpo?.motivazione);
  if (motivazione === null) return c.json({ errore: ERRORE_MOTIVAZIONE }, 400);

  // Lettura per la notifica: la guardia di stato resta nell'UPDATE.
  const membri = await membriInAttesa(c.env.DB, gruppo);
  const esito = await c.env.DB
    .prepare(
      `UPDATE richieste SET stato = 'rifiutata', decisa_at = datetime('now'), motivazione = ?2
       WHERE gruppo_id = ?1 AND stato = 'in_attesa'`,
    )
    .bind(gruppo, motivazione)
    .run();
  const rifiutate = esito.meta.changes ?? 0;
  if (rifiutate === 0) return c.json({ errore: 'Gruppo non trovato o non più in attesa' }, 409);
  await scriviAudit(c.env.DB, 'richiesta_rifiutata', `gruppo ${gruppo}: ${rifiutate} richieste — motivazione: ${motivazione}`, 'admin');
  if (membri.length > 0) {
    notificaRichiestaRifiutata(
      c,
      { nome: membri[0].societa_nome, email: membri[0].societa_email },
      membri.map(estremiRiferiti),
      membri[0].tipo,
      motivazione,
    );
  }
  return c.json({ ok: true, richieste_rifiutate: rifiutate });
});

// ---------------------------------------------------------------------------
// Ricorrenze
// ---------------------------------------------------------------------------

admin.get('/ricorrenze', async (c) => {
  const stato = (c.req.query('stato') ?? 'in_attesa') as StatoRichiesta;
  if (!STATI_RICHIESTA.includes(stato)) return c.json({ errore: 'Stato non valido' }, 400);
  const { results } = await c.env.DB
    .prepare(
      `SELECT r.id, r.societa_id, s.nome AS societa, r.giorni, r.ora_inizio, r.ora_fine,
              r.valida_dal, r.valida_al, r.stato, r.titolo, r.note, r.motivazione, r.created_at
       FROM ricorrenze r JOIN societa s ON s.id = r.societa_id
       WHERE r.stato = ?1 ORDER BY r.valida_dal LIMIT 100`,
    )
    .bind(stato)
    .all<RicorrenzaRow & { societa: string }>();
  return c.json({ ricorrenze: results.map(ricorrenzaConGiorni) });
});

/**
 * Riferimento SQL alla riga di `ricorrenze` da materializzare: frammento da
 * incorporare nelle query (costante del codice, MAI input utente) più i suoi
 * parametri bound. Due forme: l'id già noto (approvazione di una ricorrenza
 * esistente) oppure l'ultima ricorrenza inserita per una società (prenotazione
 * diretta ricorrente: la riga nasce nel primo statement dello stesso batch e
 * il suo id non è ancora noto al codice; dentro la transazione è per
 * costruzione quella con l'id massimo, perché gli id sono AUTOINCREMENT e le
 * scritture D1 sono serializzate).
 */
type RiferimentoRicorrenza = { sql: string; parametri: (string | number)[] };

function ricorrenzaPerId(id: number): RiferimentoRicorrenza {
  return { sql: '?', parametri: [id] };
}

function ultimaRicorrenzaDellaSocieta(societaId: number): RiferimentoRicorrenza {
  return { sql: '(SELECT MAX(id) FROM ricorrenze WHERE societa_id = ?)', parametri: [societaId] };
}

/**
 * Statement di MATERIALIZZAZIONE di una ricorrenza, da eseguire nello stesso
 * db.batch() atomico che la porta in stato 'approvata': ogni occorrenza (ogni
 * data dei giorni della settimana richiesti, nel periodo) diventa una
 * richiesta approvata indipendente più le relative prenotazioni, così una
 * singola data si può poi annullare senza toccare la serie.
 *
 *   1. un INSERT..SELECT multi-riga crea le richieste, prendendo orari,
 *      titolo, note e motivazione dalla ricorrenza stessa; produce zero righe
 *      se la ricorrenza non risulta 'approvata' (es. doppia approvazione
 *      concorrente);
 *   2. per ogni occorrenza, un INSERT..SELECT crea le prenotazioni risalendo
 *      alla richiesta appena creata tramite (ricorrenza_id, data), coppia
 *      resa univoca dall'indice idx_richieste_ricorrenza_data.
 *
 * Dimensioni: con il cap a 4 settimane piene e al massimo 7 giorni la
 * ricorrenza ha al più MAX_OCCORRENZE_RICORRENZA = 28 occorrenze, quindi il
 * batch completo è di al massimo 30 statement; ogni statement resta sotto i
 * 100 parametri bound (limite D1: 29 per le richieste, al più 34 per una
 * giornata intera di slot). Contando anche le query di contorno
 * dell'invocazione si resta sotto il limite free di 50 query. Un conflitto su
 * un QUALSIASI slot (UNIQUE su prenotazioni.slot_key) fa fallire e annullare
 * l'intero batch.
 */
function istruzioniMaterializzazione(
  db: D1Database,
  ricorrenza: RiferimentoRicorrenza,
  date: string[],
  oraInizio: string,
  oraFine: string,
): D1PreparedStatement[] {
  const segnapostoGiorni = date.map(() => '(?)').join(', ');
  const istruzioni = [
    db
      .prepare(
        `WITH giorno(data) AS (VALUES ${segnapostoGiorni})
         INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, stato, titolo, note, motivazione, ricorrenza_id, decisa_at)
         SELECT ric.societa_id, giorno.data, ric.ora_inizio, ric.ora_fine, 'approvata', ric.titolo, ric.note, ric.motivazione, ric.id, datetime('now')
         FROM giorno, ricorrenze ric WHERE ric.id = ${ricorrenza.sql} AND ric.stato = 'approvata'`,
      )
      .bind(...date, ...ricorrenza.parametri),
  ];
  for (const dataOccorrenza of date) {
    const chiaviGiorno = slotKeys(dataOccorrenza, oraInizio, oraFine);
    const segnapostoSlot = chiaviGiorno.map(() => '(?)').join(', ');
    istruzioni.push(
      db
        .prepare(
          `WITH slot(chiave) AS (VALUES ${segnapostoSlot})
           INSERT INTO prenotazioni (slot_key, societa_id, richiesta_id)
           SELECT slot.chiave, ri.societa_id, ri.id
           FROM slot, richieste ri WHERE ri.ricorrenza_id = ${ricorrenza.sql} AND ri.data = ?`,
        )
        .bind(...chiaviGiorno, ...ricorrenza.parametri, dataOccorrenza),
    );
  }
  return istruzioni;
}

/**
 * Approvazione di una ricorrenza in attesa: in UN solo db.batch() atomico la
 * ricorrenza passa ad 'approvata' (guardia su 'in_attesa') e viene
 * materializzata (vedi istruzioniMaterializzazione). La motivazione appena
 * salvata viene copiata in ogni richiesta materializzata, perché il passo 1 è
 * già stato eseguito nello stesso batch quando parte l'INSERT..SELECT.
 */
admin.post('/ricorrenze/:id/approva', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const corpo = await leggiJson(c);
  const motivazione = motivazioneDecisione(corpo?.motivazione);
  if (motivazione === null) return c.json({ errore: ERRORE_MOTIVAZIONE }, 400);

  const ricorrenza = await c.env.DB
    .prepare(
      `SELECT r.id, r.societa_id, r.giorni, r.ora_inizio, r.ora_fine, r.valida_dal, r.valida_al,
              r.stato, r.note, r.titolo, s.stato AS societa_stato, s.nome AS societa_nome, s.email AS societa_email
       FROM ricorrenze r JOIN societa s ON s.id = r.societa_id WHERE r.id = ?1`,
    )
    .bind(id)
    .first<RicorrenzaRow & { societa_stato: string; societa_nome: string; societa_email: string }>();
  if (!ricorrenza) return c.json({ errore: 'Ricorrenza non trovata' }, 404);
  if (ricorrenza.stato !== 'in_attesa') {
    return c.json({ errore: `La ricorrenza non è in attesa (stato attuale: ${ricorrenza.stato})` }, 409);
  }
  if (ricorrenza.societa_stato !== 'attiva') return c.json({ errore: 'La società è sospesa' }, 409);

  const oggi = oraRoma(new Date()).data;
  const tutte = occorrenzeRicorrenza(ricorrenza.valida_dal, ricorrenza.valida_al, giorniDaTesto(ricorrenza.giorni));
  const date = tutte.filter((d) => d >= oggi); // le occorrenze già passate vengono saltate
  if (date.length === 0) return c.json({ errore: 'Tutte le occorrenze della ricorrenza sono già passate' }, 409);
  if (date.length > MAX_OCCORRENZE_RICORRENZA) return c.json({ errore: 'Ricorrenza troppo lunga' }, 400);

  const istruzioni = [
    c.env.DB
      .prepare("UPDATE ricorrenze SET stato = 'approvata', motivazione = ?2 WHERE id = ?1 AND stato = 'in_attesa'")
      .bind(id, motivazione),
    ...istruzioniMaterializzazione(c.env.DB, ricorrenzaPerId(id), date, ricorrenza.ora_inizio, ricorrenza.ora_fine),
  ];

  const chiaviTotali = date.flatMap((d) => slotKeys(d, ricorrenza.ora_inizio, ricorrenza.ora_fine));
  let esiti: D1Result[];
  try {
    esiti = await c.env.DB.batch(istruzioni);
  } catch (errore) {
    if (!eConflittoSlot(errore)) throw errore;
    const conflitti = await trovaConflitti(c.env.DB, chiaviTotali);
    return c.json(
      { errore: 'Impossibile approvare la ricorrenza: alcuni slot sono già occupati (nessuna data è stata prenotata)', conflitti },
      409,
    );
  }
  if ((esiti[1].meta.changes ?? 0) !== date.length) {
    return c.json({ errore: 'La ricorrenza non è più in attesa' }, 409);
  }

  await scriviAudit(
    c.env.DB,
    'ricorrenza_approvata',
    `ricorrenza ${id}: materializzate ${date.length} date (${date.join(', ')}) — motivazione: ${motivazione}`,
    'admin',
  );
  notificaRicorrenzaApprovata(
    c,
    { nome: ricorrenza.societa_nome, email: ricorrenza.societa_email },
    ricorrenzaConGiorni(ricorrenza),
    date,
    motivazione,
  );
  return c.json({ ok: true, occorrenze: date, slot_inseriti: chiaviTotali.length });
});

admin.post('/ricorrenze/:id/rifiuta', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const corpo = await leggiJson(c);
  const motivazione = motivazioneDecisione(corpo?.motivazione);
  if (motivazione === null) return c.json({ errore: ERRORE_MOTIVAZIONE }, 400);

  // La lettura serve solo per i dettagli della notifica email: la guardia di
  // stato resta nell'UPDATE, che decide da solo l'esito della chiamata.
  const ricorrenza = await c.env.DB
    .prepare(
      `SELECT r.giorni, r.ora_inizio, r.ora_fine, r.valida_dal, r.valida_al, r.titolo,
              s.nome AS societa_nome, s.email AS societa_email
       FROM ricorrenze r JOIN societa s ON s.id = r.societa_id WHERE r.id = ?1`,
    )
    .bind(id)
    .first<RicorrenzaRow & { societa_nome: string; societa_email: string }>();

  const esito = await c.env.DB
    .prepare("UPDATE ricorrenze SET stato = 'rifiutata', motivazione = ?2 WHERE id = ?1 AND stato = 'in_attesa'")
    .bind(id, motivazione)
    .run();
  if ((esito.meta.changes ?? 0) === 0) return c.json({ errore: 'Ricorrenza non trovata o non più in attesa' }, 409);
  await scriviAudit(c.env.DB, 'ricorrenza_rifiutata', `ricorrenza ${id} — motivazione: ${motivazione}`, 'admin');
  if (ricorrenza) {
    notificaRicorrenzaRifiutata(
      c,
      { nome: ricorrenza.societa_nome, email: ricorrenza.societa_email },
      ricorrenzaConGiorni(ricorrenza),
      motivazione,
    );
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Società
// ---------------------------------------------------------------------------

admin.get('/societa', async (c) => {
  const origine = new URL(c.req.url).origin;
  const { results } = await c.env.DB
    .prepare('SELECT id, nome, referente, email, telefono, stato, colore, tariffa_oraria, token_accesso, created_at FROM societa ORDER BY nome')
    .all<{ token_accesso: string } & Record<string, unknown>>();
  // Il token non viene esposto così com'è: si restituisce direttamente il
  // link di accesso pronto da consegnare alla società.
  const elenco = results.map(({ token_accesso, ...resto }) => ({
    ...resto,
    link_accesso: `${origine}/accesso/${token_accesso}`,
  }));
  return c.json({ societa: elenco });
});

admin.post('/societa', async (c) => {
  const corpo = await leggiJson(c);
  if (!corpo) return c.json({ errore: 'Corpo della richiesta non valido' }, 400);
  const nome = testo(corpo.nome, 100);
  const referente = testo(corpo.referente, 100);
  const email = testo(corpo.email, 200);
  if (!nome || !referente || !email || !emailValida(email)) {
    return c.json({ errore: 'Dati non validi: servono nome, referente ed email corretti' }, 400);
  }
  let telefono: string | null = null;
  if (typeof corpo.telefono === 'string' && corpo.telefono.trim() !== '') {
    telefono = testo(corpo.telefono, 30);
    if (telefono === null) return c.json({ errore: 'Telefono non valido (max 30 caratteri)' }, 400);
  }
  let colore = COLORE_PREDEFINITO;
  if (corpo.colore !== undefined) {
    const coloreValidato = coloreEsadecimale(corpo.colore);
    if (coloreValidato === null) return c.json({ errore: 'Colore non valido (formato atteso #RRGGBB)' }, 400);
    colore = coloreValidato;
  }
  // Tariffa oraria obbligatoria fin dalla creazione (scelta del committente):
  // evita società lasciate a 0 €/h per dimenticanza. Lo 0 resta ammesso, ma
  // deve essere indicato esplicitamente.
  const tariffa = tariffaOraria(corpo.tariffa_oraria);
  if (tariffa === null) return c.json({ errore: 'Tariffa oraria obbligatoria (numero tra 0 e 10000)' }, 400);

  const token = crypto.randomUUID();
  const esito = await c.env.DB
    .prepare('INSERT INTO societa (nome, referente, email, telefono, colore, tariffa_oraria, token_accesso) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(nome, referente, email, telefono, colore, tariffa, token)
    .run();
  await scriviAudit(c.env.DB, 'societa_creata', `società ${esito.meta.last_row_id} (${nome})`, 'admin');
  const origine = new URL(c.req.url).origin;
  return c.json({ id: esito.meta.last_row_id, nome, link_accesso: `${origine}/accesso/${token}` }, 201);
});

/** Aggiornamento anagrafica (nome, referente, email, telefono, colore) e
 *  tariffa oraria. */
admin.patch('/societa/:id', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const corpo = await leggiJson(c);
  if (!corpo) return c.json({ errore: 'Corpo della richiesta non valido' }, 400);

  const assegnazioni: string[] = [];
  const parametri: (string | number | null)[] = [];
  if (corpo.nome !== undefined) {
    const nome = testo(corpo.nome, 100);
    if (!nome) return c.json({ errore: 'Nome non valido' }, 400);
    assegnazioni.push('nome = ?');
    parametri.push(nome);
  }
  if (corpo.referente !== undefined) {
    const referente = testo(corpo.referente, 100);
    if (!referente) return c.json({ errore: 'Referente non valido' }, 400);
    assegnazioni.push('referente = ?');
    parametri.push(referente);
  }
  if (corpo.email !== undefined) {
    const email = testo(corpo.email, 200);
    if (!email || !emailValida(email)) return c.json({ errore: 'Email non valida' }, 400);
    assegnazioni.push('email = ?');
    parametri.push(email);
  }
  if (corpo.telefono !== undefined) {
    let telefono: string | null = null;
    if (typeof corpo.telefono === 'string' && corpo.telefono.trim() !== '') {
      telefono = testo(corpo.telefono, 30);
      if (telefono === null) return c.json({ errore: 'Telefono non valido (max 30 caratteri)' }, 400);
    }
    assegnazioni.push('telefono = ?');
    parametri.push(telefono);
  }
  if (corpo.colore !== undefined) {
    const colore = coloreEsadecimale(corpo.colore);
    if (colore === null) return c.json({ errore: 'Colore non valido (formato atteso #RRGGBB)' }, 400);
    assegnazioni.push('colore = ?');
    parametri.push(colore);
  }
  if (corpo.tariffa_oraria !== undefined) {
    const tariffa = tariffaOraria(corpo.tariffa_oraria);
    if (tariffa === null) return c.json({ errore: 'Tariffa oraria non valida (numero tra 0 e 10000)' }, 400);
    assegnazioni.push('tariffa_oraria = ?');
    parametri.push(tariffa);
  }
  if (assegnazioni.length === 0) return c.json({ errore: 'Nessun campo da aggiornare' }, 400);

  const esito = await c.env.DB
    .prepare(`UPDATE societa SET ${assegnazioni.join(', ')} WHERE id = ?`)
    .bind(...parametri, id)
    .run();
  if ((esito.meta.changes ?? 0) === 0) return c.json({ errore: 'Società non trovata' }, 404);
  await scriviAudit(c.env.DB, 'societa_aggiornata', `società ${id}`, 'admin');
  return c.json({ ok: true });
});

/**
 * Sospensione con cascata ATOMICA (scelta confermata dal committente): oltre
 * a bloccare l'accesso, vengono liberati tutti gli slot futuri della società,
 * le sue richieste future passano ad 'annullata' (con annullata_at) e le
 * ricorrenze in attesa decadono. Numero di statement fisso, nessun loop.
 */
admin.post('/societa/:id/sospendi', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const soc = await c.env.DB
    .prepare('SELECT id, nome, email, stato FROM societa WHERE id = ?1')
    .bind(id)
    .first<{ nome: string; email: string; stato: string }>();
  if (!soc) return c.json({ errore: 'Società non trovata' }, 404);
  if (soc.stato === 'sospesa') return c.json({ errore: 'La società è già sospesa' }, 409);

  const adesso = oraRoma(new Date());
  const esiti = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE societa SET stato = 'sospesa' WHERE id = ?1 AND stato = 'attiva'").bind(id),
    // Slot strettamente futuri: quello eventualmente in corso resta a storico.
    c.env.DB.prepare('DELETE FROM prenotazioni WHERE societa_id = ?1 AND slot_key > ?2').bind(id, slotKeyCorrente(new Date())),
    // Richieste con almeno una parte ancora da svolgersi (incluse quelle in
    // corso in questo momento: i loro slot residui sono stati liberati sopra).
    // Le richieste di annullamento già approvate sono atti amministrativi
    // conclusi, non prenotazioni: restano intatte (da qui il filtro su tipo).
    c.env.DB
      .prepare(
        `UPDATE richieste SET stato = 'annullata', annullata_at = datetime('now')
         WHERE societa_id = ?1 AND stato IN ('in_attesa', 'approvata')
           AND (tipo = 'nuova' OR stato = 'in_attesa')
           AND (data > ?2 OR (data = ?2 AND ora_fine > ?3))`,
      )
      .bind(id, adesso.data, adesso.ora),
    c.env.DB.prepare("UPDATE ricorrenze SET stato = 'annullata' WHERE societa_id = ?1 AND stato = 'in_attesa'").bind(id),
  ]);
  const slotLiberati = esiti[1].meta.changes ?? 0;
  const richiesteAnnullate = esiti[2].meta.changes ?? 0;
  await scriviAudit(
    c.env.DB,
    'societa_sospesa',
    `società ${id} (${soc.nome}): liberati ${slotLiberati} slot, annullate ${richiesteAnnullate} richieste`,
    'admin',
  );
  notificaSospensione(c, soc, { slotLiberati, richiesteAnnullate });
  return c.json({ ok: true, slot_liberati: slotLiberati, richieste_annullate: richiesteAnnullate });
});

/** Riattivazione: le prenotazioni annullate dalla sospensione NON vengono ripristinate. */
admin.post('/societa/:id/riattiva', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const esito = await c.env.DB
    .prepare("UPDATE societa SET stato = 'attiva' WHERE id = ?1 AND stato = 'sospesa'")
    .bind(id)
    .run();
  if ((esito.meta.changes ?? 0) === 0) return c.json({ errore: 'Società non trovata o già attiva' }, 409);
  await scriviAudit(c.env.DB, 'societa_riattivata', `società ${id}`, 'admin');
  return c.json({ ok: true });
});

/** Rigenera il link personale: il vecchio token e le sessioni emesse decadono subito. */
admin.post('/societa/:id/rigenera-token', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const token = crypto.randomUUID();
  const esito = await c.env.DB.prepare('UPDATE societa SET token_accesso = ?1 WHERE id = ?2').bind(token, id).run();
  if ((esito.meta.changes ?? 0) === 0) return c.json({ errore: 'Società non trovata' }, 404);
  await scriviAudit(c.env.DB, 'token_rigenerato', `società ${id}`, 'admin');
  const origine = new URL(c.req.url).origin;
  return c.json({ ok: true, link_accesso: `${origine}/accesso/${token}` });
});

// ---------------------------------------------------------------------------
// Calendario completo e prenotazioni dirette
// ---------------------------------------------------------------------------

/**
 * Calendario dell'admin: come quello pubblico accetta `settimana=AAAA-MM-GG`
 * oppure `mese=AAAA-MM` (griglia mensile, settimane intere), ma ogni slot porta
 * anche società, colore, titolo dell'attività, note e ricorrenza (il popup dei
 * dettagli propone l'ambito "questa e le successive" solo se c'è una serie).
 */
admin.get('/calendario', async (c) => {
  const intervallo = intervalloCalendario(c.req.query('settimana'), c.req.query('mese'), new Date());
  if (intervallo.tipo === 'errore') return c.json({ errore: intervallo.messaggio }, 400);
  const { results } = await c.env.DB
    .prepare(
      `SELECT p.slot_key, p.societa_id, s.nome AS societa, s.colore, p.richiesta_id, r.titolo, r.note, r.ricorrenza_id
       FROM prenotazioni p
       JOIN societa s ON s.id = p.societa_id
       JOIN richieste r ON r.id = p.richiesta_id
       WHERE p.slot_key >= ?1 AND p.slot_key < ?2 ORDER BY p.slot_key`,
    )
    .bind(`${intervallo.dal}_0000`, `${aggiungiGiorni(intervallo.al, 1)}_0000`)
    .all();
  if (intervallo.tipo === 'mese') {
    return c.json({ mese: intervallo.mese, dal: intervallo.dal, al: intervallo.al, prenotazioni: results });
  }
  return c.json({ settimana: intervallo.lunedi, prenotazioni: results });
});

/** Società destinataria di una prenotazione diretta (riga letta prima del batch). */
type SocietaDiretta = { id: number; nome: string; email: string; stato: string };

/** Campi, già validati, della prenotazione diretta ricorrente. */
type DatiRicorrenzaDiretta = {
  data: string;
  oraInizio: string;
  oraFine: string;
  titolo: string;
  note: string | null;
  giorni: number[];
  ripetiFinoAl: string;
};

/**
 * Prenotazione diretta RICORRENTE dell'admin: funziona come la richiesta
 * ricorrente della società (stessi giorni, stessa finestra di 4 settimane,
 * tutto o niente sui conflitti) ma senza attesa di approvazione. In UN solo
 * db.batch() atomico la ricorrenza nasce già 'approvata' e viene
 * materializzata (istruzioniMaterializzazione); poiché il suo id nasce nel
 * primo statement del batch, gli statement successivi la raggiungono come
 * "ultima ricorrenza della società". Nessuna motivazione, come la
 * prenotazione diretta singola. Le occorrenze partono dalla data indicata,
 * che il chiamante ha già verificato non essere passata.
 */
async function prenotaRicorrenzaDiretta(
  c: Context<{ Bindings: Bindings }>,
  soc: SocietaDiretta,
  dati: DatiRicorrenzaDiretta,
): Promise<Response> {
  const fine = fineRicorrenza(dati.data, dati.ripetiFinoAl);
  if ('errore' in fine) return c.json({ errore: fine.errore }, 400);
  const validaAl = fine.validaAl;
  const date = occorrenzeRicorrenza(dati.data, validaAl, dati.giorni);
  if (date.length > MAX_OCCORRENZE_RICORRENZA) return c.json({ errore: 'Ricorrenza troppo lunga' }, 400);

  const istruzioni = [
    c.env.DB
      .prepare(
        `INSERT INTO ricorrenze (societa_id, giorni, ora_inizio, ora_fine, valida_dal, valida_al, titolo, note, stato)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'approvata')`,
      )
      .bind(soc.id, giorniInTesto(dati.giorni), dati.oraInizio, dati.oraFine, dati.data, validaAl, dati.titolo, dati.note),
    ...istruzioniMaterializzazione(c.env.DB, ultimaRicorrenzaDellaSocieta(soc.id), date, dati.oraInizio, dati.oraFine),
  ];

  const chiaviTotali = date.flatMap((d) => slotKeys(d, dati.oraInizio, dati.oraFine));
  let esiti: D1Result[];
  try {
    esiti = await c.env.DB.batch(istruzioni);
  } catch (errore) {
    if (!eConflittoSlot(errore)) throw errore;
    const conflitti = await trovaConflitti(c.env.DB, chiaviTotali);
    return c.json(
      { errore: 'Impossibile prenotare la ricorrenza: alcuni slot sono già occupati (nessuna data è stata prenotata)', conflitti },
      409,
    );
  }

  const ricorrenzaId = esiti[0].meta.last_row_id;
  await scriviAudit(
    c.env.DB,
    'prenotazione_diretta_ricorrente',
    `società ${soc.id} (${soc.nome}): ricorrenza ${ricorrenzaId}, ${date.length} date (${date.join(', ')}) ${dati.oraInizio}-${dati.oraFine}`,
    'admin',
  );
  notificaPrenotazioneDirettaRicorrente(
    c,
    soc,
    { giorni: dati.giorni, ora_inizio: dati.oraInizio, ora_fine: dati.oraFine, valida_dal: dati.data, valida_al: validaAl, titolo: dati.titolo },
    date,
  );
  return c.json(
    { ok: true, tipo: 'ricorrenza', ricorrenza_id: ricorrenzaId, occorrenze: date, slot_inseriti: chiaviTotali.length },
    201,
  );
}

/**
 * Prenotazione diretta (tipicamente per la società di casa): crea in un solo
 * batch atomico una richiesta già approvata più le sue prenotazioni. Il
 * collegamento avviene con un sub-select su (societa_id, data, ora_inizio)
 * ordinato per id discendente: dentro la stessa transazione la riga più
 * recente con quella terna è per costruzione quella appena inserita.
 *
 * Con `giorni` (altri giorni della settimana) o `ripeti_fino_al` diventa una
 * prenotazione ricorrente: vedi prenotaRicorrenzaDiretta.
 */
admin.post('/prenotazioni', async (c) => {
  const corpo = await leggiJson(c);
  if (!corpo) return c.json({ errore: 'Corpo della richiesta non valido' }, 400);
  const societaId = typeof corpo.societa_id === 'number' && Number.isInteger(corpo.societa_id) ? corpo.societa_id : null;
  if (societaId === null) return c.json({ errore: 'societa_id non valido' }, 400);
  const data = typeof corpo.data === 'string' ? corpo.data.trim() : '';
  const oraInizio = typeof corpo.ora_inizio === 'string' ? corpo.ora_inizio.trim() : '';
  const oraFine = typeof corpo.ora_fine === 'string' ? corpo.ora_fine.trim() : '';
  const erroreIntervallo = validaIntervallo(data, oraInizio, oraFine);
  if (erroreIntervallo) return c.json({ errore: erroreIntervallo }, 400);
  if (data < oraRoma(new Date()).data) return c.json({ errore: 'La data è già passata' }, 400);
  const titolo = titoloAttivita(corpo.titolo);
  if (titolo === null) return c.json({ errore: `Titolo attività troppo lungo (max ${MAX_TITOLO} caratteri)` }, 400);
  let note: string | null = null;
  if (typeof corpo.note === 'string' && corpo.note.trim() !== '') {
    note = testo(corpo.note, 500);
    if (note === null) return c.json({ errore: 'Note troppo lunghe (max 500 caratteri)' }, 400);
  }
  const giorni = giorniRicorrenza(corpo.giorni, data);
  if (giorni === null) {
    return c.json({ errore: 'Giorni della settimana non validi (attesi numeri da 0 = lunedì a 6 = domenica)' }, 400);
  }
  const ripetiFinoAl = typeof corpo.ripeti_fino_al === 'string' ? corpo.ripeti_fino_al.trim() : '';

  const soc = await c.env.DB
    .prepare('SELECT id, nome, email, stato FROM societa WHERE id = ?1')
    .bind(societaId)
    .first<SocietaDiretta>();
  if (!soc) return c.json({ errore: 'Società non trovata' }, 404);
  if (soc.stato !== 'attiva') return c.json({ errore: 'La società è sospesa' }, 409);

  const eRicorrente = ripetiFinoAl !== '' || giorni.length > 1;
  if (eRicorrente) {
    return await prenotaRicorrenzaDiretta(c, soc, { data, oraInizio, oraFine, titolo, note, giorni, ripetiFinoAl });
  }

  const chiavi = slotKeys(data, oraInizio, oraFine);
  const segnaposto = chiavi.map(() => '(?)').join(', ');
  let esiti: D1Result[];
  try {
    esiti = await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, stato, titolo, note, decisa_at)
           VALUES (?1, ?2, ?3, ?4, 'approvata', ?5, ?6, datetime('now'))`,
        )
        .bind(societaId, data, oraInizio, oraFine, titolo, note),
      c.env.DB
        .prepare(
          `WITH slot(chiave) AS (VALUES ${segnaposto})
           INSERT INTO prenotazioni (slot_key, societa_id, richiesta_id)
           SELECT slot.chiave, ?, (SELECT id FROM richieste WHERE societa_id = ? AND data = ? AND ora_inizio = ? ORDER BY id DESC LIMIT 1)
           FROM slot`,
        )
        .bind(...chiavi, societaId, societaId, data, oraInizio),
    ]);
  } catch (errore) {
    if (!eConflittoSlot(errore)) throw errore;
    const conflitti = await trovaConflitti(c.env.DB, chiavi);
    return c.json({ errore: 'Impossibile prenotare: alcuni slot sono già occupati', conflitti }, 409);
  }

  const richiestaId = esiti[0].meta.last_row_id;
  await scriviAudit(c.env.DB, 'prenotazione_diretta', `società ${societaId} (${soc.nome}): ${data} ${oraInizio}-${oraFine}`, 'admin');
  notificaPrenotazioneDiretta(c, soc, { data, ora_inizio: oraInizio, ora_fine: oraFine, titolo });
  return c.json({ ok: true, tipo: 'richiesta', richiesta_id: richiestaId, slot_inseriti: chiavi.length }, 201);
});

// ---------------------------------------------------------------------------
// Report mensile (tariffe e importi: solo admin, mai esposti alle società)
// ---------------------------------------------------------------------------

/** Range lessicografico [da, a) delle slot_key di un mese 'YYYY-MM'. */
function rangeMese(mese: string): { da: string; a: string } {
  return { da: `${mese}-01_0000`, a: `${meseSuccessivo(mese)}-01_0000` };
}

/** Campo testuale CSV: quotato (con raddoppio delle virgolette) se contiene
 *  separatore, virgolette o a-capo — il nome società è input utente. */
function campoCsv(valore: string): string {
  if (/[";\n\r]/.test(valore)) return `"${valore.replace(/"/g, '""')}"`;
  return valore;
}

/** Numero con la virgola decimale, come si aspetta Excel italiano. */
function numeroCsv(valore: number, decimali: number): string {
  return valore.toFixed(decimali).replace('.', ',');
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY', il formato data di Excel italiano. */
function dataCsv(data: string): string {
  const [anno, mese, giorno] = data.split('-');
  return `${giorno}/${mese}/${anno}`;
}

/**
 * Riepilogo mensile per società: ore prenotate (slot approvati / 2, e le
 * righe di prenotazioni esistono solo per richieste approvate), tariffa e
 * importo. UNA sola query aggregata (GROUP BY società) sul range
 * lessicografico del mese; la riga totale è calcolata qui dalle righe lette.
 */
admin.get('/report', async (c) => {
  const mese = c.req.query('mese') ?? '';
  if (!isMeseValido(mese)) return c.json({ errore: 'Parametro mese non valido (formato atteso AAAA-MM)' }, 400);
  const { da, a } = rangeMese(mese);
  const { results } = await c.env.DB
    .prepare(
      `SELECT s.id AS societa_id, s.nome AS societa, s.tariffa_oraria,
              COUNT(p.id) / 2.0 AS ore,
              COUNT(p.id) / 2.0 * s.tariffa_oraria AS importo
       FROM prenotazioni p JOIN societa s ON s.id = p.societa_id
       WHERE p.slot_key >= ?1 AND p.slot_key < ?2
       GROUP BY s.id ORDER BY s.nome`,
    )
    .bind(da, a)
    .all<{ societa_id: number; societa: string; tariffa_oraria: number; ore: number; importo: number }>();
  const totale = results.reduce(
    (accumulo, riga) => ({ ore: accumulo.ore + riga.ore, importo: accumulo.importo + riga.importo }),
    { ore: 0, importo: 0 },
  );
  return c.json({ mese, righe: results, totale });
});

/**
 * Export CSV del mese: una riga per prenotazione (= richiesta approvata di
 * una singola data), aggregando gli slot con UNA query (GROUP BY richiesta).
 * Separatore ';', numeri con la virgola e BOM UTF-8 iniziale, così Excel
 * italiano apre il file correttamente con un doppio clic.
 */
admin.get('/report.csv', async (c) => {
  const mese = c.req.query('mese') ?? '';
  if (!isMeseValido(mese)) return c.json({ errore: 'Parametro mese non valido (formato atteso AAAA-MM)' }, 400);
  const { da, a } = rangeMese(mese);
  const { results } = await c.env.DB
    .prepare(
      `SELECT r.data, s.nome AS societa, r.ora_inizio, r.ora_fine,
              COUNT(p.id) / 2.0 AS ore, s.tariffa_oraria,
              COUNT(p.id) / 2.0 * s.tariffa_oraria AS importo
       FROM prenotazioni p
       JOIN richieste r ON r.id = p.richiesta_id
       JOIN societa s ON s.id = p.societa_id
       WHERE p.slot_key >= ?1 AND p.slot_key < ?2
       GROUP BY p.richiesta_id
       ORDER BY r.data, r.ora_inizio, s.nome`,
    )
    .bind(da, a)
    .all<{ data: string; societa: string; ora_inizio: string; ora_fine: string; ore: number; tariffa_oraria: number; importo: number }>();

  const righe = results.map((riga) =>
    [
      dataCsv(riga.data),
      campoCsv(riga.societa),
      riga.ora_inizio,
      riga.ora_fine,
      numeroCsv(riga.ore, 1),
      numeroCsv(riga.tariffa_oraria, 2),
      numeroCsv(riga.importo, 2),
    ].join(';'),
  );
  const intestazione = 'Data;Società;Inizio;Fine;Ore;Tariffa;Importo';
  // BOM UTF-8 iniziale: senza, Excel italiano legge male i caratteri accentati.
  const csv = `\ufeff${[intestazione, ...righe].join('\r\n')}\r\n`;
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="report-${mese}.csv"`,
  });
});
