/**
 * Test di integrazione sulla logica di conflitto slot, eseguiti contro un D1
 * reale (miniflare) con le migrazioni applicate e storage isolato per test.
 *
 * Le date usano il 2030 per restare "future" rispetto all'orologio reale:
 * l'approvazione rifiuta le date passate. 2030-01-07 e i lunedì successivi.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import {
  cookieAdmin,
  creaRichiesta,
  creaRicorrenza,
  creaSocieta,
  postAdmin,
  slotDiRichiesta,
  statoRichiesta,
} from './helpers';

type RispostaConflitto = { errore: string; conflitti: { slot_key: string; societa: string }[] };

describe('vincolo UNIQUE su prenotazioni.slot_key', () => {
  it('il DB rifiuta il doppio inserimento dello stesso slot', async () => {
    const societaId = await creaSocieta();
    const richiestaId = await creaRichiesta(societaId, '2030-01-07', '18:00', '18:30');
    const inserisci = () =>
      env.DB
        .prepare('INSERT INTO prenotazioni (slot_key, societa_id, richiesta_id) VALUES (?1, ?2, ?3)')
        .bind('2030-01-07_1800', societaId, richiestaId)
        .run();
    await inserisci();
    await expect(inserisci()).rejects.toThrowError(/UNIQUE/);
  });
});

describe('approvazione richiesta', () => {
  it('inserisce una prenotazione per ogni slot da 30 minuti', async () => {
    const cookie = await cookieAdmin();
    const societaId = await creaSocieta();
    const richiestaId = await creaRichiesta(societaId, '2030-01-07', '18:00', '19:30');

    const risposta = await postAdmin(`/api/admin/richieste/${richiestaId}/approva`, cookie, { motivazione: 'Ok' });
    expect(risposta.status).toBe(200);
    expect(await slotDiRichiesta(richiestaId)).toEqual(['2030-01-07_1800', '2030-01-07_1830', '2030-01-07_1900']);
    expect(await statoRichiesta(richiestaId)).toBe('approvata');
  });

  it('con slot già occupati risponde 409, elenca i conflitti e non lascia righe parziali', async () => {
    const cookie = await cookieAdmin();
    const societaA = await creaSocieta('Società A');
    const societaB = await creaSocieta('Società B');
    const prima = await creaRichiesta(societaA, '2030-01-07', '18:00', '19:30');
    const seconda = await creaRichiesta(societaB, '2030-01-07', '19:00', '20:30'); // sovrapposta su 19:00-19:30

    expect((await postAdmin(`/api/admin/richieste/${prima}/approva`, cookie, { motivazione: 'Ok' })).status).toBe(200);
    const risposta = await postAdmin(`/api/admin/richieste/${seconda}/approva`, cookie, { motivazione: 'Ok' });
    expect(risposta.status).toBe(409);

    const corpo = (await risposta.json()) as RispostaConflitto;
    expect(corpo.conflitti.map((x) => x.slot_key)).toEqual(['2030-01-07_1900']);
    expect(corpo.conflitti[0].societa).toBe('Società A');

    // Atomicità: gli slot liberi della seconda richiesta (19:30, 20:00) NON
    // devono essere stati inseriti, e la richiesta resta in attesa.
    expect(await slotDiRichiesta(seconda)).toEqual([]);
    expect(await statoRichiesta(seconda)).toBe('in_attesa');
  });
});

describe('materializzazione ricorrenza', () => {
  it('crea una richiesta approvata e le prenotazioni per ogni occorrenza settimanale', async () => {
    const cookie = await cookieAdmin();
    const societaId = await creaSocieta();
    const ricorrenzaId = await creaRicorrenza(societaId, [0], '18:00', '19:00', '2030-01-07', '2030-01-28', 'Corso avanzato');

    const risposta = await postAdmin(`/api/admin/ricorrenze/${ricorrenzaId}/approva`, cookie, { motivazione: 'Ok' });
    expect(risposta.status).toBe(200);

    const richieste = await env.DB
      .prepare('SELECT id, data, stato, titolo FROM richieste WHERE ricorrenza_id = ?1 ORDER BY data')
      .bind(ricorrenzaId)
      .all<{ id: number; data: string; stato: string; titolo: string }>();
    expect(richieste.results.map((r) => r.data)).toEqual(['2030-01-07', '2030-01-14', '2030-01-21', '2030-01-28']);
    expect(richieste.results.every((r) => r.stato === 'approvata')).toBe(true);
    // Il titolo attività della ricorrenza viene copiato in ogni richiesta materializzata.
    expect(richieste.results.every((r) => r.titolo === 'Corso avanzato')).toBe(true);

    // 4 occorrenze x 2 slot (18:00 e 18:30) = 8 prenotazioni
    const totale = await env.DB.prepare('SELECT COUNT(*) AS n FROM prenotazioni').first<{ n: number }>();
    expect(totale?.n).toBe(8);
  });

  it('con un conflitto in una sola settimana non materializza nulla (batch atomico)', async () => {
    const cookie = await cookieAdmin();

    // Un'altra società occupa 18:30-19:00 del terzo lunedì.
    const altra = await creaSocieta('Altra Società');
    const occupante = await creaRichiesta(altra, '2030-01-21', '18:30', '19:00');
    expect((await postAdmin(`/api/admin/richieste/${occupante}/approva`, cookie, { motivazione: 'Ok' })).status).toBe(200);

    const societaId = await creaSocieta();
    const ricorrenzaId = await creaRicorrenza(societaId, [0], '18:00', '19:00', '2030-01-07', '2030-01-28');
    const risposta = await postAdmin(`/api/admin/ricorrenze/${ricorrenzaId}/approva`, cookie, { motivazione: 'Ok' });
    expect(risposta.status).toBe(409);

    const corpo = (await risposta.json()) as RispostaConflitto;
    expect(corpo.conflitti.map((x) => x.slot_key)).toEqual(['2030-01-21_1830']);
    expect(corpo.conflitti[0].societa).toBe('Altra Società');

    // Rollback completo: nessuna richiesta materializzata (nemmeno per le
    // settimane senza conflitto) e ricorrenza ancora in attesa.
    const materializzate = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM richieste WHERE ricorrenza_id = ?1')
      .bind(ricorrenzaId)
      .first<{ n: number }>();
    expect(materializzate?.n).toBe(0);
    const ricorrenza = await env.DB.prepare('SELECT stato FROM ricorrenze WHERE id = ?1').bind(ricorrenzaId).first<{ stato: string }>();
    expect(ricorrenza?.stato).toBe('in_attesa');
    // In prenotazioni ci sono solo gli slot della società occupante.
    const totale = await env.DB.prepare('SELECT COUNT(*) AS n FROM prenotazioni').first<{ n: number }>();
    expect(totale?.n).toBe(1);
  });

  it('con più giorni della settimana materializza ogni data di ogni giorno richiesto', async () => {
    const cookie = await cookieAdmin();
    const societaId = await creaSocieta();
    // Lunedì, mercoledì e venerdì per 4 settimane piene: dal lunedì 7 gennaio
    // alla domenica 3 febbraio 2030 (27 giorni dopo).
    const ricorrenzaId = await creaRicorrenza(societaId, [0, 2, 4], '18:00', '19:00', '2030-01-07', '2030-02-03');

    const risposta = await postAdmin(`/api/admin/ricorrenze/${ricorrenzaId}/approva`, cookie, { motivazione: 'Ok' });
    expect(risposta.status).toBe(200);
    const corpo = (await risposta.json()) as { occorrenze: string[]; slot_inseriti: number };
    const dateAttese = [
      '2030-01-07', '2030-01-09', '2030-01-11',
      '2030-01-14', '2030-01-16', '2030-01-18',
      '2030-01-21', '2030-01-23', '2030-01-25',
      '2030-01-28', '2030-01-30', '2030-02-01',
    ];
    expect(corpo.occorrenze).toEqual(dateAttese);
    expect(corpo.slot_inseriti).toBe(24); // 12 date x 2 slot

    const richieste = await env.DB
      .prepare('SELECT data, stato FROM richieste WHERE ricorrenza_id = ?1 ORDER BY data')
      .bind(ricorrenzaId)
      .all<{ data: string; stato: string }>();
    expect(richieste.results.map((r) => r.data)).toEqual(dateAttese);
    expect(richieste.results.every((r) => r.stato === 'approvata')).toBe(true);
    const totale = await env.DB.prepare('SELECT COUNT(*) AS n FROM prenotazioni').first<{ n: number }>();
    expect(totale?.n).toBe(24);
  });

  it('caso limite: tutti i giorni per 4 settimane e giornate intere (28 occorrenze, 896 slot) in un solo batch', async () => {
    const cookie = await cookieAdmin();
    const societaId = await creaSocieta();
    const ricorrenzaId = await creaRicorrenza(societaId, [0, 1, 2, 3, 4, 5, 6], '08:00', '24:00', '2030-01-07', '2030-02-03');

    const risposta = await postAdmin(`/api/admin/ricorrenze/${ricorrenzaId}/approva`, cookie, { motivazione: 'Ok' });
    expect(risposta.status).toBe(200);
    const corpo = (await risposta.json()) as { occorrenze: string[]; slot_inseriti: number };
    expect(corpo.occorrenze.length).toBe(28);
    expect(corpo.slot_inseriti).toBe(28 * 32);

    const materializzate = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM richieste WHERE ricorrenza_id = ?1')
      .bind(ricorrenzaId)
      .first<{ n: number }>();
    expect(materializzate?.n).toBe(28);
    const totale = await env.DB.prepare('SELECT COUNT(*) AS n FROM prenotazioni').first<{ n: number }>();
    expect(totale?.n).toBe(28 * 32);
  });
});

describe('annullamento', () => {
  it('libera gli slot, salva annullata_at e consente una nuova approvazione sulla stessa fascia', async () => {
    const cookie = await cookieAdmin();
    const societaA = await creaSocieta('Società A');
    const societaB = await creaSocieta('Società B');
    const prima = await creaRichiesta(societaA, '2030-01-07', '18:00', '19:00');
    expect((await postAdmin(`/api/admin/richieste/${prima}/approva`, cookie, { motivazione: 'Ok' })).status).toBe(200);

    const annullamento = await postAdmin(`/api/admin/richieste/${prima}/annulla`, cookie);
    expect(annullamento.status).toBe(200);
    expect(await slotDiRichiesta(prima)).toEqual([]);
    const riga = await env.DB
      .prepare('SELECT stato, annullata_at FROM richieste WHERE id = ?1')
      .bind(prima)
      .first<{ stato: string; annullata_at: string | null }>();
    expect(riga?.stato).toBe('annullata');
    expect(riga?.annullata_at).not.toBeNull();

    // La stessa fascia ora è di nuovo prenotabile.
    const seconda = await creaRichiesta(societaB, '2030-01-07', '18:00', '19:00');
    expect((await postAdmin(`/api/admin/richieste/${seconda}/approva`, cookie, { motivazione: 'Ok' })).status).toBe(200);
    expect(await slotDiRichiesta(seconda)).toEqual(['2030-01-07_1800', '2030-01-07_1830']);
  });
});
