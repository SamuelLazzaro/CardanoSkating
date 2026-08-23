import { Hono } from 'hono';
import type { Bindings, RichiestaRow, RicorrenzaRow, VariabiliSocieta } from '../tipi';
import {
  aggiungiGiorni,
  giornoSettimana,
  MAX_SETTIMANE_RICORRENZA,
  occorrenzeRicorrenza,
  oraRoma,
  raggruppaSlotInFasce,
  slotKeys,
  validaIntervallo,
} from '../slots';
import { cancellaCookieSessione, COOKIE_SOCIETA, richiedeSocieta } from '../auth';
import { eAnnullamentoDuplicato, slotOccupati } from '../conflitti';
import { intero, leggiJson, MAX_TITOLO, scriviAudit, stmtAudit, testo, titoloAttivita } from '../util';
import {
  notificaAnnullamentoRichiesto,
  notificaRichiestaInviata,
  notificaRichiestaRitirata,
  notificaRicorrenzaInviata,
  notificaRicorrenzaRitirata,
} from '../notifiche';

const MAX_NOTE = 500;
const MAX_GIORNI_FUTURO = 365;

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
  const richieste = await c.env.DB
    .prepare(
      `SELECT id, data, ora_inizio, ora_fine, stato, tipo, richiesta_riferimento_id, titolo, note, motivazione,
              ricorrenza_id, created_at, decisa_at, annullata_at
       FROM richieste WHERE societa_id = ?1 ORDER BY data DESC, ora_inizio DESC LIMIT 200`,
    )
    .bind(soc.id)
    .all<RichiestaRow>();
  const ricorrenze = await c.env.DB
    .prepare(
      `SELECT id, giorno_settimana, ora_inizio, ora_fine, valida_dal, valida_al, stato, titolo, note, motivazione, created_at
       FROM ricorrenze WHERE societa_id = ?1 ORDER BY created_at DESC LIMIT 50`,
    )
    .bind(soc.id)
    .all<RicorrenzaRow>();
  return c.json({ richieste: richieste.results, ricorrenze: ricorrenze.results });
});

/**
 * Nuova richiesta di prenotazione. Se è presente ripeti_fino_al viene creata
 * una RICORRENZA in attesa (materializzata in richieste+prenotazioni solo
 * all'approvazione dell'admin); altrimenti una richiesta singola in attesa.
 */
societa.post('/richieste', async (c) => {
  const soc = c.get('societa');
  const corpo = await leggiJson(c);
  if (!corpo) return c.json({ errore: 'Corpo della richiesta non valido' }, 400);

  const data = typeof corpo.data === 'string' ? corpo.data.trim() : '';
  const oraInizio = typeof corpo.ora_inizio === 'string' ? corpo.ora_inizio.trim() : '';
  const oraFine = typeof corpo.ora_fine === 'string' ? corpo.ora_fine.trim() : '';
  const erroreIntervallo = validaIntervallo(data, oraInizio, oraFine);
  if (erroreIntervallo) return c.json({ errore: erroreIntervallo }, 400);

  const titolo = titoloAttivita(corpo.titolo);
  if (titolo === null) return c.json({ errore: `Titolo attività troppo lungo (max ${MAX_TITOLO} caratteri)` }, 400);

  let note: string | null = null;
  if (typeof corpo.note === 'string' && corpo.note.trim() !== '') {
    note = testo(corpo.note, MAX_NOTE);
    if (note === null) return c.json({ errore: `Note troppo lunghe (max ${MAX_NOTE} caratteri)` }, 400);
  }

  const adesso = oraRoma(new Date());
  const nelFuturo = data > adesso.data || (data === adesso.data && oraInizio > adesso.ora);
  if (!nelFuturo) return c.json({ errore: 'La richiesta deve riguardare una data e ora future' }, 400);
  if (data > aggiungiGiorni(adesso.data, MAX_GIORNI_FUTURO)) {
    return c.json({ errore: 'Non è possibile prenotare oltre un anno in anticipo' }, 400);
  }

  const ripetiFinoAl = typeof corpo.ripeti_fino_al === 'string' ? corpo.ripeti_fino_al.trim() : '';
  if (ripetiFinoAl !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ripetiFinoAl) || ripetiFinoAl <= data) {
      return c.json({ errore: 'La data di fine ripetizione deve essere una data successiva alla prima' }, 400);
    }
    // Cap di progetto: al massimo MAX_SETTIMANE_RICORRENZA occorrenze, così
    // il batch di materializzazione resta piccolo (vedi routes/admin.ts).
    const massimo = aggiungiGiorni(data, (MAX_SETTIMANE_RICORRENZA - 1) * 7);
    if (ripetiFinoAl > massimo) {
      return c.json(
        { errore: `La ripetizione settimanale può coprire al massimo ${MAX_SETTIMANE_RICORRENZA} settimane (fino al ${massimo})` },
        400,
      );
    }
    const giorno = giornoSettimana(data);
    const occorrenze = occorrenzeRicorrenza(data, ripetiFinoAl, giorno);
    // Tutto o niente: se anche un solo slot di una sola occorrenza è già
    // prenotato, la ricorrenza non viene creata affatto.
    const occupatiRicorrenza = await slotOccupati(
      c.env.DB,
      occorrenze.flatMap((dataOccorrenza) => slotKeys(dataOccorrenza, oraInizio, oraFine)),
    );
    if (occupatiRicorrenza.length > 0) {
      return c.json(
        fasceNonDisponibili('La richiesta ricorrente non è stata creata: alcune fasce non sono disponibili', occupatiRicorrenza),
        409,
      );
    }

    const esiti = await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO ricorrenze (societa_id, giorno_settimana, ora_inizio, ora_fine, valida_dal, valida_al, titolo, note)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        )
        .bind(soc.id, giorno, oraInizio, oraFine, data, ripetiFinoAl, titolo, note),
      stmtAudit(c.env.DB, 'ricorrenza_creata', `${data} → ${ripetiFinoAl} ${oraInizio}-${oraFine}`, `societa:${soc.id}`),
    ]);
    notificaRicorrenzaInviata(c, soc, {
      giorno_settimana: giorno,
      ora_inizio: oraInizio,
      ora_fine: oraFine,
      valida_dal: data,
      valida_al: ripetiFinoAl,
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
 * Ritiro di una richiesta ANCORA IN ATTESA (nessuno slot occupato): la
 * richiesta passa ad 'annullata' con annullata_at. Vale sia per le richieste
 * nuove sia per le richieste di annullamento non ancora decise. Le
 * prenotazioni approvate NON si toccano da qui: si annullano solo con una
 * richiesta di annullamento approvata dall'admin (vedi sotto).
 */
societa.post('/richieste/:id/annulla', async (c) => {
  const soc = c.get('societa');
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);

  const richiesta = await c.env.DB
    .prepare('SELECT id, data, ora_inizio, ora_fine, stato, tipo, titolo FROM richieste WHERE id = ?1 AND societa_id = ?2')
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
  const adesso = oraRoma(new Date());
  const futura = richiesta.data > adesso.data || (richiesta.data === adesso.data && richiesta.ora_inizio > adesso.ora);
  if (!futura) return c.json({ errore: 'Si possono annullare solo richieste future' }, 409);

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
  notificaRichiestaRitirata(c, soc, richiesta, richiesta.tipo);
  return c.json({ ok: true });
});

/**
 * Richiesta di annullamento di una prenotazione approvata futura: non libera
 * nulla subito, crea una richiesta di tipo 'annullamento' (data, orari e
 * titolo copiati dalla prenotazione) che l'admin approverà o rifiuterà con
 * motivazione. Gli slot restano occupati fino all'approvazione. L'indice
 * UNIQUE parziale della migrazione 0005 respinge una seconda richiesta
 * pendente sulla stessa prenotazione.
 */
societa.post('/richieste/:id/richiedi-annullamento', async (c) => {
  const soc = c.get('societa');
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);

  // Il filtro societa_id garantisce che non si possa agire su prenotazioni
  // altrui: per le altre società la risposta è la stessa di un id inesistente.
  const prenotazione = await c.env.DB
    .prepare('SELECT id, data, ora_inizio, ora_fine, stato, tipo, titolo FROM richieste WHERE id = ?1 AND societa_id = ?2')
    .bind(id, soc.id)
    .first<RichiestaRow>();
  if (!prenotazione) return c.json({ errore: 'Prenotazione non trovata' }, 404);
  if (prenotazione.tipo !== 'nuova' || prenotazione.stato !== 'approvata') {
    return c.json({ errore: "Si può chiedere l'annullamento solo di una prenotazione approvata" }, 409);
  }
  const adesso = oraRoma(new Date());
  const futura = prenotazione.data > adesso.data || (prenotazione.data === adesso.data && prenotazione.ora_inizio > adesso.ora);
  if (!futura) return c.json({ errore: "Non si può chiedere l'annullamento di una data già passata" }, 409);

  let esiti: D1Result[];
  try {
    esiti = await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, titolo, tipo, richiesta_riferimento_id)
           VALUES (?1, ?2, ?3, ?4, ?5, 'annullamento', ?6)`,
        )
        .bind(soc.id, prenotazione.data, prenotazione.ora_inizio, prenotazione.ora_fine, prenotazione.titolo, id),
      stmtAudit(
        c.env.DB,
        'annullamento_richiesto',
        `richiesta ${id} (${prenotazione.data} ${prenotazione.ora_inizio}-${prenotazione.ora_fine})`,
        `societa:${soc.id}`,
      ),
    ]);
  } catch (errore) {
    if (!eAnnullamentoDuplicato(errore)) throw errore;
    return c.json({ errore: "C'è già una richiesta di annullamento in attesa per questa prenotazione" }, 409);
  }
  notificaAnnullamentoRichiesto(c, soc, prenotazione);
  return c.json({ tipo: 'annullamento', id: esiti[0].meta.last_row_id }, 201);
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
      `SELECT giorno_settimana, ora_inizio, ora_fine, valida_dal, valida_al, titolo
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
  if (ricorrenza) notificaRicorrenzaRitirata(c, soc, ricorrenza);
  return c.json({ ok: true });
});
