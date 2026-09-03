import { Hono, type Context } from 'hono';
import type { Bindings, RichiestaRow, RicorrenzaRow, VariabiliSocieta } from '../tipi';
import {
  aggiungiGiorni,
  fineRicorrenza,
  giorniInTesto,
  occorrenzeRicorrenza,
  oraRoma,
  raggruppaSlotInFasce,
  ricorrenzaConGiorni,
  slotKeys,
  validaIntervallo,
} from '../slots';
import { cancellaCookieSessione, COOKIE_SOCIETA, richiedeSocieta } from '../auth';
import { eVariazionePendenteDuplicata, slotOccupati } from '../conflitti';
import { giorniRicorrenza, intero, leggiJson, MAX_TITOLO, scriviAudit, stmtAudit, testo, titoloAttivita } from '../util';
import {
  notificaAnnullamentoRichiesto,
  notificaModificaRichiesta,
  notificaRichiestaInviata,
  notificaRichiestaModificata,
  notificaRichiestaRitirata,
  notificaRicorrenzaInviata,
  notificaRicorrenzaModificata,
  notificaRicorrenzaRitirata,
} from '../notifiche';
import {
  ambitoVariazione,
  campiModifica,
  chiaviDopoModifica,
  dataDopoModifica,
  eFutura,
  elencoId,
  idGruppo,
  MAX_NOTE,
  modificaSenzaEffetto,
  occorrenzeDaVariare,
} from '../variazioni';

const MAX_GIORNI_FUTURO = 365;
const ERRORE_GRUPPO = 'La richiesta fa parte di un gruppo: si ritira tutto il gruppo insieme';
const ERRORE_PENDENTE = "C'è già una richiesta di annullamento o di modifica in attesa per questa prenotazione";

type ContestoSocieta = Context<{ Bindings: Bindings; Variables: VariabiliSocieta }>;

/**
 * Corpo della risposta 409 quando le fasce richieste non sono tutte libere.
 *
 * Non viene mai indicato QUALE società occupa gli slot: il calendario
 * pubblico li espone in forma anonima e la stessa riservatezza vale qui.
 * Le fasce arrivano già compattate, così il popup le elenca per esteso
 * senza dover ripetere ogni mezz'ora.
 */
function fasceNonDisponibili(messaggio: string, chiaviOccupate: string[]): Record<string, unknown> {
  return { errore: messaggio, fasce_occupate: raggruppaSlotInFasce(chiaviOccupate) };
}

/** Campi di una richiesta di prenotazione (singola o ricorrente) già validati. */
type CampiPrenotazione = {
  data: string;
  oraInizio: string;
  oraFine: string;
  titolo: string;
  note: string | null;
  giorni: number[];
  ripetiFinoAl: string;
  /** Vero se i campi descrivono una ricorrenza (ripetizione o più giorni). */
  eRicorrente: boolean;
};

/**
 * Valida i campi di una richiesta di prenotazione dal corpo JSON, condivisa da
 * creazione e modifica (di una richiesta singola o di una ricorrenza in
 * attesa): data e orario validi e futuri, entro un anno; titolo e note nei
 * limiti; giorni della settimana e fine ripetizione con le stesse regole della
 * prenotazione diretta dell'admin (util.giorniRicorrenza, slots.fineRicorrenza).
 * In caso di errore ritorna il messaggio da mostrare all'utente.
 */
function campiPrenotazione(corpo: Record<string, unknown>): CampiPrenotazione | { errore: string } {
  const data = typeof corpo.data === 'string' ? corpo.data.trim() : '';
  const oraInizio = typeof corpo.ora_inizio === 'string' ? corpo.ora_inizio.trim() : '';
  const oraFine = typeof corpo.ora_fine === 'string' ? corpo.ora_fine.trim() : '';
  const erroreIntervallo = validaIntervallo(data, oraInizio, oraFine);
  if (erroreIntervallo) return { errore: erroreIntervallo };

  const titolo = titoloAttivita(corpo.titolo);
  if (titolo === null) return { errore: `Titolo attività troppo lungo (max ${MAX_TITOLO} caratteri)` };

  let note: string | null = null;
  if (typeof corpo.note === 'string' && corpo.note.trim() !== '') {
    note = testo(corpo.note, MAX_NOTE);
    if (note === null) return { errore: `Note troppo lunghe (max ${MAX_NOTE} caratteri)` };
  }

  const adesso = oraRoma(new Date());
  if (!eFutura({ data, ora_inizio: oraInizio }, adesso)) return { errore: 'La richiesta deve riguardare una data e ora future' };
  if (data > aggiungiGiorni(adesso.data, MAX_GIORNI_FUTURO)) return { errore: 'Non è possibile prenotare oltre un anno in anticipo' };

  const giorni = giorniRicorrenza(corpo.giorni, data);
  if (giorni === null) return { errore: 'Giorni della settimana non validi (attesi numeri da 0 = lunedì a 6 = domenica)' };
  const ripetiFinoAl = typeof corpo.ripeti_fino_al === 'string' ? corpo.ripeti_fino_al.trim() : '';

  return { data, oraInizio, oraFine, titolo, note, giorni, ripetiFinoAl, eRicorrente: ripetiFinoAl !== '' || giorni.length > 1 };
}

/**
 * Fine del periodo e date di una ricorrenza dai campi validati, con il
 * controllo tutto-o-niente che nessuna occorrenza tocchi slot occupati.
 * `richiesteEscluse` serve alla modifica: nessuna, perché una ricorrenza in
 * attesa non occupa slot, ma la firma resta uniforme.
 */
async function occorrenzeLibere(
  db: D1Database,
  campi: CampiPrenotazione,
): Promise<{ validaAl: string; occorrenze: string[] } | { errore: string; status: 400 | 409; corpo?: Record<string, unknown> }> {
  const fine = fineRicorrenza(campi.data, campi.ripetiFinoAl);
  if ('errore' in fine) return { errore: fine.errore, status: 400 };
  const occorrenze = occorrenzeRicorrenza(campi.data, fine.validaAl, campi.giorni);
  const occupati = await slotOccupati(
    db,
    occorrenze.flatMap((dataOccorrenza) => slotKeys(dataOccorrenza, campi.oraInizio, campi.oraFine)),
  );
  if (occupati.length > 0) {
    return {
      errore: 'Alcune fasce non sono disponibili',
      status: 409,
      corpo: fasceNonDisponibili('La richiesta ricorrente non è stata registrata: alcune fasce non sono disponibili', occupati),
    };
  }
  return { validaAl: fine.validaAl, occorrenze };
}

export const societa = new Hono<{ Bindings: Bindings; Variables: VariabiliSocieta }>();

// Il logout non richiede una sessione valida: si limita a rimuovere il cookie.
societa.post('/logout', (c) => {
  cancellaCookieSessione(c, COOKIE_SOCIETA);
  return c.json({ ok: true });
});

societa.use('*', richiedeSocieta());

societa.get('/me', (c) => {
  const soc = c.get('societa');
  const origine = new URL(c.req.url).origin;
  return c.json({
    societa: { id: soc.id, nome: soc.nome, referente: soc.referente, email: soc.email, telefono: soc.telefono, colore: soc.colore },
    link_ics: `${origine}/api/ics/${soc.token_accesso}`,
  });
});

societa.get('/richieste', async (c) => {
  const soc = c.get('societa');
  // Per le richieste di annullamento e di modifica si allegano gli estremi
  // ATTUALI della prenotazione riferita (rif_*), così l'area mostra "prima →
  // dopo" senza una seconda chiamata.
  const richieste = await c.env.DB
    .prepare(
      `SELECT r.id, r.data, r.ora_inizio, r.ora_fine, r.stato, r.tipo, r.richiesta_riferimento_id, r.gruppo_id,
              r.titolo, r.note, r.motivazione, r.ricorrenza_id, r.created_at, r.decisa_at, r.annullata_at,
              o.data AS rif_data, o.ora_inizio AS rif_ora_inizio, o.ora_fine AS rif_ora_fine, o.titolo AS rif_titolo
       FROM richieste r LEFT JOIN richieste o ON o.id = r.richiesta_riferimento_id
       WHERE r.societa_id = ?1 ORDER BY r.data DESC, r.ora_inizio DESC LIMIT 200`,
    )
    .bind(soc.id)
    .all<RichiestaRow>();
  const ricorrenze = await c.env.DB
    .prepare(
      `SELECT id, giorni, ora_inizio, ora_fine, valida_dal, valida_al, stato, titolo, note, motivazione, created_at
       FROM ricorrenze WHERE societa_id = ?1 ORDER BY created_at DESC LIMIT 50`,
    )
    .bind(soc.id)
    .all<RicorrenzaRow>();
  return c.json({ richieste: richieste.results, ricorrenze: ricorrenze.results.map(ricorrenzaConGiorni) });
});

/**
 * Nuova richiesta di prenotazione. Diventa una RICORRENZA in attesa
 * (materializzata in richieste+prenotazioni solo all'approvazione dell'admin)
 * se la società chiede una ripetizione settimanale (ripeti_fino_al) oppure lo
 * stesso orario in altri giorni della settimana (giorni); altrimenti è una
 * richiesta singola in attesa.
 *
 * Il giorno della settimana della data scelta fa sempre parte della
 * ricorrenza: quella data è la prima occorrenza. Senza ripeti_fino_al gli
 * altri giorni valgono solo per la settimana della data (fino alla domenica).
 */
societa.post('/richieste', async (c) => {
  const soc = c.get('societa');
  const corpo = await leggiJson(c);
  if (!corpo) return c.json({ errore: 'Corpo della richiesta non valido' }, 400);
  const campi = campiPrenotazione(corpo);
  if ('errore' in campi) return c.json({ errore: campi.errore }, 400);
  const { data, oraInizio, oraFine, titolo, note, giorni } = campi;

  if (campi.eRicorrente) {
    // Tutto o niente: se anche un solo slot di una sola occorrenza è già
    // prenotato, la ricorrenza non viene creata affatto.
    const esitoOccorrenze = await occorrenzeLibere(c.env.DB, campi);
    if ('errore' in esitoOccorrenze) return c.json(esitoOccorrenze.corpo ?? { errore: esitoOccorrenze.errore }, esitoOccorrenze.status);
    const { validaAl, occorrenze } = esitoOccorrenze;

    const giorniTesto = giorniInTesto(giorni);
    const esiti = await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO ricorrenze (societa_id, giorni, ora_inizio, ora_fine, valida_dal, valida_al, titolo, note)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        )
        .bind(soc.id, giorniTesto, oraInizio, oraFine, data, validaAl, titolo, note),
      stmtAudit(
        c.env.DB,
        'ricorrenza_creata',
        `${data} → ${validaAl} ${oraInizio}-${oraFine} (giorni ${giorniTesto})`,
        `societa:${soc.id}`,
      ),
    ]);
    notificaRicorrenzaInviata(c, soc, {
      giorni,
      ora_inizio: oraInizio,
      ora_fine: oraFine,
      valida_dal: data,
      valida_al: validaAl,
      titolo,
      note,
    });
    return c.json({ tipo: 'ricorrenza', id: esiti[0].meta.last_row_id, occorrenze }, 201);
  }

  const occupati = await slotOccupati(c.env.DB, slotKeys(data, oraInizio, oraFine));
  if (occupati.length > 0) {
    return c.json(fasceNonDisponibili('La richiesta non è stata inviata: alcune fasce non sono disponibili', occupati), 409);
  }

  const esiti = await c.env.DB.batch([
    c.env.DB
      .prepare('INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, titolo, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(soc.id, data, oraInizio, oraFine, titolo, note),
    stmtAudit(c.env.DB, 'richiesta_creata', `${data} ${oraInizio}-${oraFine}`, `societa:${soc.id}`),
  ]);
  notificaRichiestaInviata(c, soc, { data, ora_inizio: oraInizio, ora_fine: oraFine, titolo, note });
  return c.json({ tipo: 'richiesta', id: esiti[0].meta.last_row_id }, 201);
});

/**
 * Modifica DIRETTA di una richiesta singola ancora in attesa (nessuno slot
 * occupato, nessuna approvazione da rifare: la richiesta resta in attesa con i
 * nuovi estremi). Le prenotazioni già approvate si modificano solo con una
 * richiesta di modifica approvata dall'admin (vedi richiedi-modifica). Il
 * campo `giorni`/`ripeti_fino_al` non è ammesso: una richiesta singola resta
 * singola (per farne una ricorrente la si annulla e se ne invia una nuova).
 */
societa.patch('/richieste/:id', async (c) => {
  const soc = c.get('societa');
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const corpo = await leggiJson(c);
  if (!corpo) return c.json({ errore: 'Corpo della richiesta non valido' }, 400);

  const richiesta = await c.env.DB
    .prepare('SELECT * FROM richieste WHERE id = ?1 AND societa_id = ?2')
    .bind(id, soc.id)
    .first<RichiestaRow>();
  if (!richiesta) return c.json({ errore: 'Richiesta non trovata' }, 404);
  if (richiesta.tipo === 'nuova' && richiesta.stato === 'approvata') {
    return c.json({ errore: "La prenotazione è già approvata: invia una richiesta di modifica e attendi la conferma dell'amministratore" }, 409);
  }
  if (richiesta.tipo !== 'nuova' || richiesta.stato !== 'in_attesa') {
    return c.json({ errore: 'Si può modificare direttamente solo una richiesta di prenotazione ancora in attesa' }, 409);
  }

  const campi = campiPrenotazione(corpo);
  if ('errore' in campi) return c.json({ errore: campi.errore }, 400);
  if (campi.eRicorrente) {
    return c.json({ errore: 'Una richiesta singola non può diventare ricorrente: annullala e invia una nuova richiesta ricorrente' }, 400);
  }

  const occupati = await slotOccupati(c.env.DB, slotKeys(campi.data, campi.oraInizio, campi.oraFine));
  if (occupati.length > 0) {
    return c.json(fasceNonDisponibili('La richiesta non è stata modificata: alcune fasce non sono disponibili', occupati), 409);
  }

  const esito = await c.env.DB
    .prepare(
      `UPDATE richieste SET data = ?3, ora_inizio = ?4, ora_fine = ?5, titolo = ?6, note = ?7
       WHERE id = ?1 AND societa_id = ?2 AND stato = 'in_attesa'`,
    )
    .bind(id, soc.id, campi.data, campi.oraInizio, campi.oraFine, campi.titolo, campi.note)
    .run();
  if ((esito.meta.changes ?? 0) === 0) return c.json({ errore: 'La richiesta risulta già decisa o annullata' }, 409);

  await scriviAudit(
    c.env.DB,
    'richiesta_modificata',
    `richiesta ${id}: ${richiesta.data} ${richiesta.ora_inizio}-${richiesta.ora_fine} → ${campi.data} ${campi.oraInizio}-${campi.oraFine}`,
    `societa:${soc.id}`,
  );
  notificaRichiestaModificata(c, soc, richiesta, {
    data: campi.data,
    ora_inizio: campi.oraInizio,
    ora_fine: campi.oraFine,
    titolo: campi.titolo,
    note: campi.note,
  });
  return c.json({ ok: true });
});

/**
 * Modifica DIRETTA di una ricorrenza ancora in attesa (non materializzata:
 * nessuna data esiste ancora, quindi si modifica la definizione dell'intera
 * serie — giorni, orario, periodo, attività, note — con le stesse regole e lo
 * stesso controllo tutto-o-niente della creazione). Deve restare una
 * ricorrenza: per una singola data si annulla e si invia una richiesta nuova.
 */
societa.patch('/ricorrenze/:id', async (c) => {
  const soc = c.get('societa');
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const corpo = await leggiJson(c);
  if (!corpo) return c.json({ errore: 'Corpo della richiesta non valido' }, 400);

  const ricorrenza = await c.env.DB
    .prepare('SELECT * FROM ricorrenze WHERE id = ?1 AND societa_id = ?2')
    .bind(id, soc.id)
    .first<RicorrenzaRow>();
  if (!ricorrenza) return c.json({ errore: 'Ricorrenza non trovata' }, 404);
  if (ricorrenza.stato !== 'in_attesa') return c.json({ errore: 'Si può modificare solo una richiesta ricorrente ancora in attesa' }, 409);

  const campi = campiPrenotazione(corpo);
  if ('errore' in campi) return c.json({ errore: campi.errore }, 400);
  if (!campi.eRicorrente) {
    return c.json({ errore: 'Una richiesta ricorrente deve restare ricorrente: per una singola data annullala e invia una nuova richiesta' }, 400);
  }
  const esitoOccorrenze = await occorrenzeLibere(c.env.DB, campi);
  if ('errore' in esitoOccorrenze) return c.json(esitoOccorrenze.corpo ?? { errore: esitoOccorrenze.errore }, esitoOccorrenze.status);
  const { validaAl, occorrenze } = esitoOccorrenze;

  const giorniTesto = giorniInTesto(campi.giorni);
  const esito = await c.env.DB
    .prepare(
      `UPDATE ricorrenze SET giorni = ?3, ora_inizio = ?4, ora_fine = ?5, valida_dal = ?6, valida_al = ?7, titolo = ?8, note = ?9
       WHERE id = ?1 AND societa_id = ?2 AND stato = 'in_attesa'`,
    )
    .bind(id, soc.id, giorniTesto, campi.oraInizio, campi.oraFine, campi.data, validaAl, campi.titolo, campi.note)
    .run();
  if ((esito.meta.changes ?? 0) === 0) return c.json({ errore: 'La ricorrenza risulta già decisa o annullata' }, 409);

  await scriviAudit(
    c.env.DB,
    'ricorrenza_modificata',
    `ricorrenza ${id}: ${campi.data} → ${validaAl} ${campi.oraInizio}-${campi.oraFine} (giorni ${giorniTesto})`,
    `societa:${soc.id}`,
  );
  notificaRicorrenzaModificata(c, soc, {
    giorni: campi.giorni,
    ora_inizio: campi.oraInizio,
    ora_fine: campi.oraFine,
    valida_dal: campi.data,
    valida_al: validaAl,
    titolo: campi.titolo,
    note: campi.note,
  });
  return c.json({ ok: true, occorrenze });
});

/**
 * Ritiro di una richiesta ANCORA IN ATTESA (nessuno slot occupato): la
 * richiesta passa ad 'annullata' con annullata_at. Vale sia per le richieste
 * nuove sia per le richieste di annullamento o di modifica non ancora decise.
 * Le prenotazioni approvate NON si toccano da qui: si annullano solo con una
 * richiesta di annullamento approvata dall'admin (vedi sotto). Le richieste di
 * un gruppo si ritirano tutte insieme (POST /gruppi/:gruppo/annulla).
 */
societa.post('/richieste/:id/annulla', async (c) => {
  const soc = c.get('societa');
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);

  const richiesta = await c.env.DB
    .prepare('SELECT * FROM richieste WHERE id = ?1 AND societa_id = ?2')
    .bind(id, soc.id)
    .first<RichiestaRow>();
  if (!richiesta) return c.json({ errore: 'Richiesta non trovata' }, 404);
  if (richiesta.stato === 'approvata') {
    return c.json(
      { errore: "La prenotazione è già approvata: invia una richiesta di annullamento e attendi la conferma dell'amministratore" },
      409,
    );
  }
  if (richiesta.stato !== 'in_attesa') {
    return c.json({ errore: 'La richiesta è già stata rifiutata o annullata' }, 409);
  }
  if (richiesta.gruppo_id !== null) return c.json({ errore: ERRORE_GRUPPO }, 409);
  if (!eFutura(richiesta, oraRoma(new Date()))) return c.json({ errore: 'Si possono annullare solo richieste future' }, 409);

  const esito = await c.env.DB
    .prepare(
      `UPDATE richieste SET stato = 'annullata', annullata_at = datetime('now')
       WHERE id = ?1 AND stato = 'in_attesa'`,
    )
    .bind(id)
    .run();
  if ((esito.meta.changes ?? 0) === 0) {
    return c.json({ errore: 'La richiesta risulta già decisa o annullata' }, 409);
  }
  await scriviAudit(
    c.env.DB,
    'richiesta_annullata',
    `richiesta ${id} (${richiesta.data} ${richiesta.ora_inizio}-${richiesta.ora_fine})`,
    `societa:${soc.id}`,
  );
  notificaRichiestaRitirata(c, soc, [richiesta], richiesta.tipo);
  return c.json({ ok: true });
});

/**
 * Prenotazione approvata futura della società su cui agire (annullamento o
 * modifica), con le occorrenze coinvolte secondo l'ambito. Il filtro
 * societa_id garantisce che non si possa agire su prenotazioni altrui: per le
 * altre società la risposta è la stessa di un id inesistente.
 */
async function prenotazioneDaVariare(
  c: ContestoSocieta,
  id: number,
  verbo: string,
): Promise<{ prenotazione: RichiestaRow } | { risposta: Response }> {
  const prenotazione = await c.env.DB
    .prepare('SELECT * FROM richieste WHERE id = ?1 AND societa_id = ?2')
    .bind(id, c.get('societa').id)
    .first<RichiestaRow>();
  if (!prenotazione) return { risposta: c.json({ errore: 'Prenotazione non trovata' }, 404) };
  if (prenotazione.tipo !== 'nuova' || prenotazione.stato !== 'approvata') {
    return { risposta: c.json({ errore: `Si può chiedere ${verbo} solo di una prenotazione approvata` }, 409) };
  }
  if (!eFutura(prenotazione, oraRoma(new Date()))) {
    return { risposta: c.json({ errore: `Non si può chiedere ${verbo} di una prenotazione già iniziata o passata` }, 409) };
  }
  return { prenotazione };
}

/**
 * Richiesta di annullamento di una prenotazione approvata futura: non libera
 * nulla subito, crea una richiesta di tipo 'annullamento' (data, orari e
 * titolo copiati dalla prenotazione) che l'admin approverà o rifiuterà con
 * motivazione. Gli slot restano occupati fino all'approvazione. Con ambito
 * 'successive' su una prenotazione ricorrente nasce una richiesta per ogni
 * occorrenza coinvolta, legate da un gruppo_id comune: l'admin le decide tutte
 * insieme. L'indice UNIQUE parziale della migrazione 0009 respinge l'intero
 * inserimento se anche una sola prenotazione ha già una richiesta pendente.
 */
societa.post('/richieste/:id/richiedi-annullamento', async (c) => {
  const soc = c.get('societa');
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  // Il corpo è facoltativo: senza, l'ambito è la singola prenotazione.
  const corpo = await leggiJson(c);
  const ambito = ambitoVariazione(corpo?.ambito);
  if (ambito === null) return c.json({ errore: "Ambito non valido (atteso 'singola' o 'successive')" }, 400);

  const lettura = await prenotazioneDaVariare(c, id, "l'annullamento");
  if ('risposta' in lettura) return lettura.risposta;
  const occorrenze = await occorrenzeDaVariare(c.env.DB, lettura.prenotazione, ambito);
  const { segnaposto, ids } = elencoId(occorrenze);
  const gruppo = occorrenze.length > 1 ? crypto.randomUUID() : null;

  let esiti: D1Result[];
  try {
    // INSERT..SELECT dalle prenotazioni riferite: un solo statement per tutto
    // il gruppo, che copia data, orari e titolo da ciascuna occorrenza.
    esiti = await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, titolo, tipo, richiesta_riferimento_id, gruppo_id)
           SELECT o.societa_id, o.data, o.ora_inizio, o.ora_fine, o.titolo, 'annullamento', o.id, ?
           FROM richieste o WHERE o.id IN (${segnaposto}) AND o.societa_id = ? AND o.stato = 'approvata'
           ORDER BY o.data`,
        )
        .bind(gruppo, ...ids, soc.id),
      stmtAudit(
        c.env.DB,
        'annullamento_richiesto',
        `richieste ${ids.join(', ')} (${occorrenze.map((o) => o.data).join(', ')} ${occorrenze[0].ora_inizio}-${occorrenze[0].ora_fine})${gruppo ? ` gruppo ${gruppo}` : ''}`,
        `societa:${soc.id}`,
      ),
    ]);
  } catch (errore) {
    if (!eVariazionePendenteDuplicata(errore)) throw errore;
    return c.json({ errore: ERRORE_PENDENTE }, 409);
  }
  notificaAnnullamentoRichiesto(c, soc, occorrenze);
  return c.json({ tipo: 'annullamento', id: esiti[0].meta.last_row_id, gruppo_id: gruppo, richieste: esiti[0].meta.changes ?? 0 }, 201);
});

/**
 * Richiesta di MODIFICA di una prenotazione approvata futura (data, orario,
 * attività, note): come l'annullamento, non cambia nulla subito. Nasce una
 * richiesta di tipo 'modifica' che porta i NUOVI estremi e punta alla
 * prenotazione da cambiare; all'approvazione l'admin scambia gli slot in un
 * batch atomico (vedi routes/admin.ts). Con ambito 'successive' i nuovi
 * orario, attività e note si applicano a ogni occorrenza coinvolta (la data
 * resta quella di ciascuna) e le richieste nascono in un gruppo.
 *
 * Il controllo di disponibilità esclude gli slot delle prenotazioni stesse,
 * che verranno liberati all'approvazione: spostare 18:00-19:00 a 18:30-19:30
 * non è un conflitto con se stessi. La risposta 409 resta anonima.
 */
societa.post('/richieste/:id/richiedi-modifica', async (c) => {
  const soc = c.get('societa');
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const corpo = await leggiJson(c);
  if (!corpo) return c.json({ errore: 'Corpo della richiesta non valido' }, 400);
  const ambito = ambitoVariazione(corpo.ambito);
  if (ambito === null) return c.json({ errore: "Ambito non valido (atteso 'singola' o 'successive')" }, 400);

  const lettura = await prenotazioneDaVariare(c, id, 'la modifica');
  if ('risposta' in lettura) return lettura.risposta;
  const { prenotazione } = lettura;

  const campi = campiModifica(corpo, ambito, prenotazione.data);
  if ('errore' in campi) return c.json({ errore: campi.errore }, 400);
  if (modificaSenzaEffetto(campi, prenotazione)) return c.json({ errore: 'Nessuna modifica rispetto alla prenotazione attuale' }, 400);
  const adesso = oraRoma(new Date());
  const nuovaData = campi.data ?? prenotazione.data;
  if (!eFutura({ data: nuovaData, ora_inizio: campi.oraInizio }, adesso)) {
    return c.json({ errore: 'La prenotazione modificata deve iniziare nel futuro' }, 400);
  }
  if (nuovaData > aggiungiGiorni(adesso.data, MAX_GIORNI_FUTURO)) {
    return c.json({ errore: 'Non è possibile prenotare oltre un anno in anticipo' }, 400);
  }

  const occorrenze = await occorrenzeDaVariare(c.env.DB, prenotazione, ambito);
  const { segnaposto, ids } = elencoId(occorrenze);
  const occupati = await slotOccupati(c.env.DB, chiaviDopoModifica(campi, occorrenze), ids);
  if (occupati.length > 0) {
    return c.json(fasceNonDisponibili('La richiesta di modifica non è stata inviata: alcune fasce non sono disponibili', occupati), 409);
  }
  const gruppo = occorrenze.length > 1 ? crypto.randomUUID() : null;

  let esiti: D1Result[];
  try {
    // La data nuova vale solo con ambito 'singola' (campi.data è NULL
    // altrimenti): ogni occorrenza del gruppo conserva la propria.
    esiti = await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, titolo, note, tipo, richiesta_riferimento_id, gruppo_id)
           SELECT o.societa_id, COALESCE(?, o.data), ?, ?, ?, ?, 'modifica', o.id, ?
           FROM richieste o WHERE o.id IN (${segnaposto}) AND o.societa_id = ? AND o.stato = 'approvata'
           ORDER BY o.data`,
        )
        .bind(campi.data, campi.oraInizio, campi.oraFine, campi.titolo, campi.note, gruppo, ...ids, soc.id),
      stmtAudit(
        c.env.DB,
        'modifica_richiesta',
        `richieste ${ids.join(', ')} → ${campi.data ?? 'stesse date'} ${campi.oraInizio}-${campi.oraFine}${gruppo ? ` gruppo ${gruppo}` : ''}`,
        `societa:${soc.id}`,
      ),
    ]);
  } catch (errore) {
    if (!eVariazionePendenteDuplicata(errore)) throw errore;
    return c.json({ errore: ERRORE_PENDENTE }, 409);
  }
  const dopo = occorrenze.map((occorrenza) => ({
    data: dataDopoModifica(campi, occorrenza),
    ora_inizio: campi.oraInizio,
    ora_fine: campi.oraFine,
    titolo: campi.titolo,
  }));
  notificaModificaRichiesta(c, soc, occorrenze, dopo);
  return c.json({ tipo: 'modifica', id: esiti[0].meta.last_row_id, gruppo_id: gruppo, richieste: esiti[0].meta.changes ?? 0 }, 201);
});

/**
 * Ritiro di un intero gruppo di richieste pendenti (annullamento o modifica
 * su più occorrenze): tutte insieme, come sono nate. Le prenotazioni riferite
 * restano com'erano.
 */
societa.post('/gruppi/:gruppo/annulla', async (c) => {
  const soc = c.get('societa');
  const gruppo = idGruppo(c.req.param('gruppo'));
  if (gruppo === null) return c.json({ errore: 'Identificativo di gruppo non valido' }, 400);

  // Lettura per la notifica: la guardia di stato resta nell'UPDATE.
  const { results: membri } = await c.env.DB
    .prepare(
      `SELECT r.tipo, o.data, o.ora_inizio, o.ora_fine, o.titolo
       FROM richieste r LEFT JOIN richieste o ON o.id = r.richiesta_riferimento_id
       WHERE r.gruppo_id = ?1 AND r.societa_id = ?2 AND r.stato = 'in_attesa' ORDER BY o.data`,
    )
    .bind(gruppo, soc.id)
    .all<{ tipo: string; data: string; ora_inizio: string; ora_fine: string; titolo: string }>();

  const esito = await c.env.DB
    .prepare(
      `UPDATE richieste SET stato = 'annullata', annullata_at = datetime('now')
       WHERE gruppo_id = ?1 AND societa_id = ?2 AND stato = 'in_attesa'`,
    )
    .bind(gruppo, soc.id)
    .run();
  const ritirate = esito.meta.changes ?? 0;
  if (ritirate === 0) return c.json({ errore: 'Gruppo non trovato o non più in attesa' }, 409);
  await scriviAudit(c.env.DB, 'richiesta_annullata', `gruppo ${gruppo}: ritirate ${ritirate} richieste`, `societa:${soc.id}`);
  if (membri.length > 0) notificaRichiestaRitirata(c, soc, membri, membri[0].tipo);
  return c.json({ ok: true, richieste_ritirate: ritirate });
});

/** Annullamento di una ricorrenza non ancora approvata. */
societa.post('/ricorrenze/:id/annulla', async (c) => {
  const soc = c.get('societa');
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);

  // La lettura serve solo per i dettagli della notifica email: la guardia di
  // stato resta nell'UPDATE, che decide da solo l'esito della chiamata.
  const ricorrenza = await c.env.DB
    .prepare(
      `SELECT giorni, ora_inizio, ora_fine, valida_dal, valida_al, titolo
       FROM ricorrenze WHERE id = ?1 AND societa_id = ?2`,
    )
    .bind(id, soc.id)
    .first<RicorrenzaRow>();

  const esito = await c.env.DB
    .prepare("UPDATE ricorrenze SET stato = 'annullata' WHERE id = ?1 AND societa_id = ?2 AND stato = 'in_attesa'")
    .bind(id, soc.id)
    .run();
  if ((esito.meta.changes ?? 0) === 0) {
    return c.json({ errore: 'Ricorrenza non trovata o non più in attesa' }, 409);
  }
  await scriviAudit(c.env.DB, 'ricorrenza_annullata', `ricorrenza ${id}`, `societa:${soc.id}`);
  if (ricorrenza) notificaRicorrenzaRitirata(c, soc, ricorrenzaConGiorni(ricorrenza));
  return c.json({ ok: true });
});
