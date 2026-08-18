import { Hono } from 'hono';
import type { Bindings, RichiestaRow, RicorrenzaRow, StatoRichiesta } from '../tipi';
import {
  aggiungiGiorni,
  isDataValida,
  lunediDellaSettimana,
  MAX_SETTIMANE_RICORRENZA,
  occorrenzeRicorrenza,
  oraRoma,
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
import { emailValida, intero, leggiJson, scriviAudit, testo } from '../util';

const STATI_RICHIESTA: StatoRichiesta[] = ['in_attesa', 'approvata', 'rifiutata', 'annullata'];
const MAX_TENTATIVI_LOGIN = 10;
const FINESTRA_LOGIN_S = 15 * 60;

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
  const { results } = await c.env.DB
    .prepare(
      `SELECT r.id, r.societa_id, s.nome AS societa, r.data, r.ora_inizio, r.ora_fine, r.stato, r.note,
              r.ricorrenza_id, r.created_at, r.decisa_at, r.annullata_at
       FROM richieste r JOIN societa s ON s.id = r.societa_id
       WHERE r.stato = ?1 ORDER BY r.data, r.ora_inizio LIMIT 300`,
    )
    .bind(stato)
    .all();
  return c.json({ richieste: results });
});

/**
 * Approvazione di una richiesta singola, in un solo db.batch() atomico:
 *   1. la richiesta passa ad 'approvata' (con guardia su stato='in_attesa',
 *      per non approvare due volte in caso di richieste concorrenti);
 *   2. le prenotazioni vengono inserite con INSERT..SELECT che produce righe
 *      SOLO se il passo 1 è andato a segno (guardia stato='approvata').
 * Se anche un solo slot è già occupato, il vincolo UNIQUE su slot_key fa
 * fallire l'intero batch (rollback implicito): a quel punto una singola query
 * diagnostica dice all'admin esattamente quali slot confliggono e con chi.
 */
admin.post('/richieste/:id/approva', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);

  const richiesta = await c.env.DB
    .prepare(
      `SELECT r.id, r.societa_id, r.data, r.ora_inizio, r.ora_fine, r.stato, s.stato AS societa_stato
       FROM richieste r JOIN societa s ON s.id = r.societa_id WHERE r.id = ?1`,
    )
    .bind(id)
    .first<RichiestaRow & { societa_stato: string }>();
  if (!richiesta) return c.json({ errore: 'Richiesta non trovata' }, 404);
  if (richiesta.stato !== 'in_attesa') {
    return c.json({ errore: `La richiesta non è in attesa (stato attuale: ${richiesta.stato})` }, 409);
  }
  if (richiesta.societa_stato !== 'attiva') return c.json({ errore: 'La società è sospesa' }, 409);
  if (richiesta.data < oraRoma(new Date()).data) return c.json({ errore: 'La data della richiesta è già passata' }, 409);

  const chiavi = slotKeys(richiesta.data, richiesta.ora_inizio, richiesta.ora_fine);
  const segnaposto = chiavi.map(() => '(?)').join(', ');
  let esiti: D1Result[];
  try {
    esiti = await c.env.DB.batch([
      c.env.DB
        .prepare("UPDATE richieste SET stato = 'approvata', decisa_at = datetime('now') WHERE id = ?1 AND stato = 'in_attesa'")
        .bind(id),
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

  await scriviAudit(c.env.DB, 'richiesta_approvata', `richiesta ${id} (${richiesta.data} ${richiesta.ora_inizio}-${richiesta.ora_fine})`, 'admin');
  return c.json({ ok: true, slot_inseriti: chiavi.length });
});

admin.post('/richieste/:id/rifiuta', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const corpo = await leggiJson(c);
  const motivo = typeof corpo?.motivo === 'string' ? (testo(corpo.motivo, 300) ?? '') : '';

  const esito = await c.env.DB
    .prepare("UPDATE richieste SET stato = 'rifiutata', decisa_at = datetime('now') WHERE id = ?1 AND stato = 'in_attesa'")
    .bind(id)
    .run();
  if ((esito.meta.changes ?? 0) === 0) return c.json({ errore: 'Richiesta non trovata o non più in attesa' }, 409);
  await scriviAudit(c.env.DB, 'richiesta_rifiutata', `richiesta ${id}${motivo ? ` — motivo: ${motivo}` : ''}`, 'admin');
  return c.json({ ok: true });
});

/**
 * Cancellazione di una singola data da parte dell'admin. Le occorrenze di una
 * ricorrenza materializzata sono richieste indipendenti, quindi questa
 * operazione non rompe mai il resto della serie.
 */
admin.post('/richieste/:id/annulla', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);

  const richiesta = await c.env.DB
    .prepare('SELECT id, data, ora_inizio, ora_fine, stato, societa_id FROM richieste WHERE id = ?1')
    .bind(id)
    .first<RichiestaRow>();
  if (!richiesta) return c.json({ errore: 'Richiesta non trovata' }, 404);
  if (richiesta.stato !== 'in_attesa' && richiesta.stato !== 'approvata') {
    return c.json({ errore: 'La richiesta è già stata rifiutata o annullata' }, 409);
  }
  if (richiesta.data < oraRoma(new Date()).data) {
    return c.json({ errore: 'Non si possono annullare date già passate' }, 409);
  }

  const esiti = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM prenotazioni WHERE richiesta_id = ?1').bind(id),
    c.env.DB
      .prepare(
        `UPDATE richieste SET stato = 'annullata', annullata_at = datetime('now')
         WHERE id = ?1 AND stato IN ('in_attesa', 'approvata')`,
      )
      .bind(id),
  ]);
  if ((esiti[1].meta.changes ?? 0) === 0) return c.json({ errore: 'La richiesta risulta già decisa o annullata' }, 409);
  await scriviAudit(c.env.DB, 'richiesta_annullata', `richiesta ${id} (${richiesta.data} ${richiesta.ora_inizio}-${richiesta.ora_fine})`, 'admin');
  return c.json({ ok: true, slot_liberati: esiti[0].meta.changes ?? 0 });
});

// ---------------------------------------------------------------------------
// Ricorrenze
// ---------------------------------------------------------------------------

admin.get('/ricorrenze', async (c) => {
  const stato = (c.req.query('stato') ?? 'in_attesa') as StatoRichiesta;
  if (!STATI_RICHIESTA.includes(stato)) return c.json({ errore: 'Stato non valido' }, 400);
  const { results } = await c.env.DB
    .prepare(
      `SELECT r.id, r.societa_id, s.nome AS societa, r.giorno_settimana, r.ora_inizio, r.ora_fine,
              r.valida_dal, r.valida_al, r.stato, r.note, r.created_at
       FROM ricorrenze r JOIN societa s ON s.id = r.societa_id
       WHERE r.stato = ?1 ORDER BY r.valida_dal LIMIT 100`,
    )
    .bind(stato)
    .all();
  return c.json({ ricorrenze: results });
});

/**
 * Approvazione di una ricorrenza = MATERIALIZZAZIONE: ogni occorrenza
 * settimanale diventa una richiesta approvata indipendente più le relative
 * prenotazioni, così una singola data si può poi annullare senza toccare la
 * serie. Tutto avviene in UN solo db.batch() atomico:
 *
 *   1. la ricorrenza passa ad 'approvata' (guardia su 'in_attesa');
 *   2. un INSERT..SELECT multi-riga crea le richieste, prendendo orari e note
 *      dalla ricorrenza stessa; produce zero righe se il passo 1 non è
 *      passato (doppia approvazione concorrente);
 *   3. per ogni occorrenza, un INSERT..SELECT crea le prenotazioni risalendo
 *      alla richiesta appena creata tramite (ricorrenza_id, data), coppia
 *      resa univoca dall'indice idx_richieste_ricorrenza_data.
 *
 * Dimensioni: con il cap a 4 settimane il batch è di al massimo 6 statement
 * e ogni statement resta sotto i 100 parametri bound (limite D1), quindi ben
 * dentro il limite free di 50 query per invocazione. Un conflitto su un
 * QUALSIASI slot fa fallire e annullare l'intero batch.
 */
admin.post('/ricorrenze/:id/approva', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);

  const ricorrenza = await c.env.DB
    .prepare(
      `SELECT r.id, r.societa_id, r.giorno_settimana, r.ora_inizio, r.ora_fine, r.valida_dal, r.valida_al,
              r.stato, r.note, s.stato AS societa_stato
       FROM ricorrenze r JOIN societa s ON s.id = r.societa_id WHERE r.id = ?1`,
    )
    .bind(id)
    .first<RicorrenzaRow & { societa_stato: string }>();
  if (!ricorrenza) return c.json({ errore: 'Ricorrenza non trovata' }, 404);
  if (ricorrenza.stato !== 'in_attesa') {
    return c.json({ errore: `La ricorrenza non è in attesa (stato attuale: ${ricorrenza.stato})` }, 409);
  }
  if (ricorrenza.societa_stato !== 'attiva') return c.json({ errore: 'La società è sospesa' }, 409);

  const oggi = oraRoma(new Date()).data;
  const tutte = occorrenzeRicorrenza(ricorrenza.valida_dal, ricorrenza.valida_al, ricorrenza.giorno_settimana);
  const date = tutte.filter((d) => d >= oggi); // le occorrenze già passate vengono saltate
  if (date.length === 0) return c.json({ errore: 'Tutte le occorrenze della ricorrenza sono già passate' }, 409);
  if (date.length > MAX_SETTIMANE_RICORRENZA) return c.json({ errore: 'Ricorrenza troppo lunga' }, 400);

  const segnapostoGiorni = date.map(() => '(?)').join(', ');
  const istruzioni = [
    c.env.DB.prepare("UPDATE ricorrenze SET stato = 'approvata' WHERE id = ?1 AND stato = 'in_attesa'").bind(id),
    c.env.DB
      .prepare(
        `WITH giorno(data) AS (VALUES ${segnapostoGiorni})
         INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, stato, note, ricorrenza_id, decisa_at)
         SELECT ric.societa_id, giorno.data, ric.ora_inizio, ric.ora_fine, 'approvata', ric.note, ric.id, datetime('now')
         FROM giorno, ricorrenze ric WHERE ric.id = ? AND ric.stato = 'approvata'`,
      )
      .bind(...date, id),
  ];
  for (const dataOccorrenza of date) {
    const chiaviGiorno = slotKeys(dataOccorrenza, ricorrenza.ora_inizio, ricorrenza.ora_fine);
    const segnapostoSlot = chiaviGiorno.map(() => '(?)').join(', ');
    istruzioni.push(
      c.env.DB
        .prepare(
          `WITH slot(chiave) AS (VALUES ${segnapostoSlot})
           INSERT INTO prenotazioni (slot_key, societa_id, richiesta_id)
           SELECT slot.chiave, ri.societa_id, ri.id
           FROM slot, richieste ri WHERE ri.ricorrenza_id = ? AND ri.data = ?`,
        )
        .bind(...chiaviGiorno, id, dataOccorrenza),
    );
  }

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

  await scriviAudit(c.env.DB, 'ricorrenza_approvata', `ricorrenza ${id}: materializzate ${date.length} date (${date.join(', ')})`, 'admin');
  return c.json({ ok: true, occorrenze: date, slot_inseriti: chiaviTotali.length });
});

admin.post('/ricorrenze/:id/rifiuta', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const esito = await c.env.DB
    .prepare("UPDATE ricorrenze SET stato = 'rifiutata' WHERE id = ?1 AND stato = 'in_attesa'")
    .bind(id)
    .run();
  if ((esito.meta.changes ?? 0) === 0) return c.json({ errore: 'Ricorrenza non trovata o non più in attesa' }, 409);
  await scriviAudit(c.env.DB, 'ricorrenza_rifiutata', `ricorrenza ${id}`, 'admin');
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Società
// ---------------------------------------------------------------------------

admin.get('/societa', async (c) => {
  const origine = new URL(c.req.url).origin;
  const { results } = await c.env.DB
    .prepare('SELECT id, nome, referente, email, telefono, stato, token_accesso, created_at FROM societa ORDER BY nome')
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

  const token = crypto.randomUUID();
  const esito = await c.env.DB
    .prepare('INSERT INTO societa (nome, referente, email, telefono, token_accesso) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(nome, referente, email, telefono, token)
    .run();
  await scriviAudit(c.env.DB, 'societa_creata', `società ${esito.meta.last_row_id} (${nome})`, 'admin');
  const origine = new URL(c.req.url).origin;
  return c.json({ id: esito.meta.last_row_id, nome, link_accesso: `${origine}/accesso/${token}` }, 201);
});

/** Aggiornamento anagrafica (nome, referente, email, telefono). */
admin.patch('/societa/:id', async (c) => {
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);
  const corpo = await leggiJson(c);
  if (!corpo) return c.json({ errore: 'Corpo della richiesta non valido' }, 400);

  const assegnazioni: string[] = [];
  const parametri: (string | null)[] = [];
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
  const soc = await c.env.DB.prepare('SELECT id, nome, stato FROM societa WHERE id = ?1').bind(id).first<{ nome: string; stato: string }>();
  if (!soc) return c.json({ errore: 'Società non trovata' }, 404);
  if (soc.stato === 'sospesa') return c.json({ errore: 'La società è già sospesa' }, 409);

  const adesso = oraRoma(new Date());
  const esiti = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE societa SET stato = 'sospesa' WHERE id = ?1 AND stato = 'attiva'").bind(id),
    // Slot strettamente futuri: quello eventualmente in corso resta a storico.
    c.env.DB.prepare('DELETE FROM prenotazioni WHERE societa_id = ?1 AND slot_key > ?2').bind(id, slotKeyCorrente(new Date())),
    // Richieste con almeno una parte ancora da svolgersi (incluse quelle in
    // corso in questo momento: i loro slot residui sono stati liberati sopra).
    c.env.DB
      .prepare(
        `UPDATE richieste SET stato = 'annullata', annullata_at = datetime('now')
         WHERE societa_id = ?1 AND stato IN ('in_attesa', 'approvata')
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

admin.get('/calendario', async (c) => {
  const parametro = c.req.query('settimana');
  let riferimento: string;
  if (parametro === undefined || parametro === '') {
    riferimento = oraRoma(new Date()).data;
  } else if (isDataValida(parametro)) {
    riferimento = parametro;
  } else {
    return c.json({ errore: 'Parametro settimana non valido (formato atteso AAAA-MM-GG)' }, 400);
  }
  const lunedi = lunediDellaSettimana(riferimento);
  const lunediSuccessivo = aggiungiGiorni(lunedi, 7);
  const { results } = await c.env.DB
    .prepare(
      `SELECT p.slot_key, p.societa_id, s.nome AS societa, p.richiesta_id
       FROM prenotazioni p JOIN societa s ON s.id = p.societa_id
       WHERE p.slot_key >= ?1 AND p.slot_key < ?2 ORDER BY p.slot_key`,
    )
    .bind(`${lunedi}_0000`, `${lunediSuccessivo}_0000`)
    .all();
  return c.json({ settimana: lunedi, prenotazioni: results });
});

/**
 * Prenotazione diretta (tipicamente per la società di casa): crea in un solo
 * batch atomico una richiesta già approvata più le sue prenotazioni. Il
 * collegamento avviene con un sub-select su (societa_id, data, ora_inizio)
 * ordinato per id discendente: dentro la stessa transazione la riga più
 * recente con quella terna è per costruzione quella appena inserita.
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
  let note: string | null = null;
  if (typeof corpo.note === 'string' && corpo.note.trim() !== '') {
    note = testo(corpo.note, 500);
    if (note === null) return c.json({ errore: 'Note troppo lunghe (max 500 caratteri)' }, 400);
  }

  const soc = await c.env.DB.prepare('SELECT id, nome, stato FROM societa WHERE id = ?1').bind(societaId).first<{ nome: string; stato: string }>();
  if (!soc) return c.json({ errore: 'Società non trovata' }, 404);
  if (soc.stato !== 'attiva') return c.json({ errore: 'La società è sospesa' }, 409);

  const chiavi = slotKeys(data, oraInizio, oraFine);
  const segnaposto = chiavi.map(() => '(?)').join(', ');
  let esiti: D1Result[];
  try {
    esiti = await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, stato, note, decisa_at)
           VALUES (?1, ?2, ?3, ?4, 'approvata', ?5, datetime('now'))`,
        )
        .bind(societaId, data, oraInizio, oraFine, note),
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
  return c.json({ ok: true, richiesta_id: richiestaId, slot_inseriti: chiavi.length }, 201);
});
