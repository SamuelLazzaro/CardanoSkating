import { Hono } from 'hono';
import type { Bindings, RichiestaRow, RicorrenzaRow, VariabiliSocieta } from '../tipi';
import {
  aggiungiGiorni,
  giornoSettimana,
  MAX_SETTIMANE_RICORRENZA,
  occorrenzeRicorrenza,
  oraRoma,
  validaIntervallo,
} from '../slots';
import { cancellaCookieSessione, COOKIE_SOCIETA, richiedeSocieta } from '../auth';
import { intero, leggiJson, scriviAudit, stmtAudit, testo } from '../util';

const MAX_NOTE = 500;
const MAX_GIORNI_FUTURO = 365;

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
    societa: { id: soc.id, nome: soc.nome, referente: soc.referente, email: soc.email, telefono: soc.telefono },
    link_ics: `${origine}/api/ics/${soc.token_accesso}`,
  });
});

societa.get('/richieste', async (c) => {
  const soc = c.get('societa');
  const richieste = await c.env.DB
    .prepare(
      `SELECT id, data, ora_inizio, ora_fine, stato, note, ricorrenza_id, created_at, decisa_at, annullata_at
       FROM richieste WHERE societa_id = ?1 ORDER BY data DESC, ora_inizio DESC LIMIT 200`,
    )
    .bind(soc.id)
    .all<RichiestaRow>();
  const ricorrenze = await c.env.DB
    .prepare(
      `SELECT id, giorno_settimana, ora_inizio, ora_fine, valida_dal, valida_al, stato, note, created_at
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
    const esiti = await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO ricorrenze (societa_id, giorno_settimana, ora_inizio, ora_fine, valida_dal, valida_al, note)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(soc.id, giorno, oraInizio, oraFine, data, ripetiFinoAl, note),
      stmtAudit(c.env.DB, 'ricorrenza_creata', `${data} → ${ripetiFinoAl} ${oraInizio}-${oraFine}`, `societa:${soc.id}`),
    ]);
    return c.json(
      { tipo: 'ricorrenza', id: esiti[0].meta.last_row_id, occorrenze: occorrenzeRicorrenza(data, ripetiFinoAl, giorno) },
      201,
    );
  }

  const esiti = await c.env.DB.batch([
    c.env.DB
      .prepare('INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, note) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(soc.id, data, oraInizio, oraFine, note),
    stmtAudit(c.env.DB, 'richiesta_creata', `${data} ${oraInizio}-${oraFine}`, `societa:${soc.id}`),
  ]);
  return c.json({ tipo: 'richiesta', id: esiti[0].meta.last_row_id }, 201);
});

/**
 * Annullamento di una richiesta futura: libera gli slot e marca la richiesta
 * come annullata (con annullata_at, per poter verificare a posteriori quando
 * la società ha rinunciato allo slot). DELETE e UPDATE in un batch atomico.
 */
societa.post('/richieste/:id/annulla', async (c) => {
  const soc = c.get('societa');
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);

  const richiesta = await c.env.DB
    .prepare('SELECT id, data, ora_inizio, ora_fine, stato FROM richieste WHERE id = ?1 AND societa_id = ?2')
    .bind(id, soc.id)
    .first<RichiestaRow>();
  if (!richiesta) return c.json({ errore: 'Richiesta non trovata' }, 404);
  if (richiesta.stato !== 'in_attesa' && richiesta.stato !== 'approvata') {
    return c.json({ errore: 'La richiesta è già stata rifiutata o annullata' }, 409);
  }
  const adesso = oraRoma(new Date());
  const futura = richiesta.data > adesso.data || (richiesta.data === adesso.data && richiesta.ora_inizio > adesso.ora);
  if (!futura) return c.json({ errore: 'Si possono annullare solo richieste future' }, 409);

  const esiti = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM prenotazioni WHERE richiesta_id = ?1').bind(id),
    c.env.DB
      .prepare(
        `UPDATE richieste SET stato = 'annullata', annullata_at = datetime('now')
         WHERE id = ?1 AND stato IN ('in_attesa', 'approvata')`,
      )
      .bind(id),
  ]);
  if ((esiti[1].meta.changes ?? 0) === 0) {
    return c.json({ errore: 'La richiesta risulta già decisa o annullata' }, 409);
  }
  await scriviAudit(
    c.env.DB,
    'richiesta_annullata',
    `richiesta ${id} (${richiesta.data} ${richiesta.ora_inizio}-${richiesta.ora_fine})`,
    `societa:${soc.id}`,
  );
  return c.json({ ok: true, slot_liberati: esiti[0].meta.changes ?? 0 });
});

/** Annullamento di una ricorrenza non ancora approvata. */
societa.post('/ricorrenze/:id/annulla', async (c) => {
  const soc = c.get('societa');
  const id = intero(c.req.param('id'));
  if (id === null) return c.json({ errore: 'Identificativo non valido' }, 400);

  const esito = await c.env.DB
    .prepare("UPDATE ricorrenze SET stato = 'annullata' WHERE id = ?1 AND societa_id = ?2 AND stato = 'in_attesa'")
    .bind(id, soc.id)
    .run();
  if ((esito.meta.changes ?? 0) === 0) {
    return c.json({ errore: 'Ricorrenza non trovata o non più in attesa' }, 409);
  }
  await scriviAudit(c.env.DB, 'ricorrenza_annullata', `ricorrenza ${id}`, `societa:${soc.id}`);
  return c.json({ ok: true });
});
