/**
 * Test di integrazione sul pannello admin: login e rate limit, gestione
 * società (creazione, cascata di sospensione, rigenerazione link) e
 * prenotazioni dirette.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { aggiungiGiorni, lunediDellaSettimana, oraRoma } from '../src/slots';
import {
  cookieAdmin,
  cookieSocieta,
  creaSocieta,
  creaSocietaConToken,
  getConCookie,
  postAdmin,
  postJson,
  slotDiRichiesta,
} from './helpers';

const oggi = oraRoma(new Date()).data;
const dataFutura = aggiungiGiorni(oggi, 7);
/** Un lunedì futuro (della settimana fra due settimane), per i test sui giorni della settimana. */
const lunediFuturo = lunediDellaSettimana(aggiungiGiorni(oggi, 14));

async function tentaLogin(password: string): Promise<Response> {
  return await app.request(
    '/api/admin/login',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) },
    env,
  );
}

describe('login admin', () => {
  it('password errata: 401 senza cookie', async () => {
    const risposta = await tentaLogin('password-sbagliata');
    expect(risposta.status).toBe(401);
    expect(risposta.headers.get('set-cookie')).toBeNull();
  });

  it('dopo 10 tentativi il rate limit risponde 429 anche alla password giusta', async () => {
    for (let tentativo = 0; tentativo < 10; tentativo++) {
      await tentaLogin('password-sbagliata');
    }
    const bloccato = await tentaLogin('password-di-test');
    expect(bloccato.status).toBe(429);
  });

  it('senza sessione le API admin rispondono 401', async () => {
    const risposta = await app.request('/api/admin/richieste', {}, env);
    expect(risposta.status).toBe(401);
  });
});

describe('gestione società', () => {
  it('crea una società con tariffa oraria e il link personale restituito funziona', async () => {
    const cookieAmm = await cookieAdmin();
    const risposta = await postJson('/api/admin/societa', cookieAmm, {
      nome: 'Nuova ASD',
      referente: 'Mario Rossi',
      email: 'mario@example.com',
      telefono: '333 1234567',
      tariffa_oraria: 25.5,
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as { id: number; link_accesso: string };
    const riga = await env.DB
      .prepare('SELECT tariffa_oraria FROM societa WHERE id = ?1')
      .bind(corpo.id)
      .first<{ tariffa_oraria: number }>();
    expect(riga?.tariffa_oraria).toBe(25.5);
    const token = corpo.link_accesso.split('/accesso/')[1];
    const cookieSoc = await cookieSocieta(token);
    const profilo = await getConCookie('/api/societa/me', cookieSoc);
    expect(profilo.status).toBe(200);
  });

  it('rifiuta dati anagrafici non validi', async () => {
    const cookieAmm = await cookieAdmin();
    const risposta = await postJson('/api/admin/societa', cookieAmm, { nome: 'X', referente: 'Y', email: 'non-una-email' });
    expect(risposta.status).toBe(400);
  });

  it('rifiuta la creazione senza tariffa oraria o con tariffa non valida', async () => {
    const cookieAmm = await cookieAdmin();
    const anagrafica = { nome: 'ASD Senza Tariffa', referente: 'Referente', email: 'tariffa@example.com' };
    for (const tariffa of [undefined, -1, 10001, 'venti']) {
      const risposta = await postJson('/api/admin/societa', cookieAmm, { ...anagrafica, tariffa_oraria: tariffa });
      expect(risposta.status).toBe(400);
    }
    // Lo 0 esplicito resta un valore ammesso.
    const conZero = await postJson('/api/admin/societa', cookieAmm, { ...anagrafica, tariffa_oraria: 0 });
    expect(conZero.status).toBe(201);
  });

  it('la sospensione cancella il futuro e invalida gli accessi; la riattivazione non ripristina', async () => {
    const { id, token } = await creaSocietaConToken('Da Sospendere');
    const cookieSoc = await cookieSocieta(token);
    const cookieAmm = await cookieAdmin();

    // Setup: una richiesta futura approvata e una ricorrenza in attesa.
    const creazione = await postJson('/api/societa/richieste', cookieSoc, {
      data: dataFutura, ora_inizio: '18:00', ora_fine: '19:00',
    });
    const { id: idRichiesta } = (await creazione.json()) as { id: number };
    expect((await postAdmin(`/api/admin/richieste/${idRichiesta}/approva`, cookieAmm, { motivazione: 'Ok' })).status).toBe(200);
    expect((await slotDiRichiesta(idRichiesta)).length).toBe(2);
    await postJson('/api/societa/richieste', cookieSoc, {
      data: dataFutura, ora_inizio: '20:00', ora_fine: '21:00', ripeti_fino_al: aggiungiGiorni(dataFutura, 21),
    });

    const sospensione = await postAdmin(`/api/admin/societa/${id}/sospendi`, cookieAmm);
    expect(sospensione.status).toBe(200);

    // Cascata: slot futuri liberati, richiesta annullata con annullata_at,
    // ricorrenza in attesa annullata.
    expect(await slotDiRichiesta(idRichiesta)).toEqual([]);
    const richiesta = await env.DB
      .prepare('SELECT stato, annullata_at FROM richieste WHERE id = ?1')
      .bind(idRichiesta)
      .first<{ stato: string; annullata_at: string | null }>();
    expect(richiesta?.stato).toBe('annullata');
    expect(richiesta?.annullata_at).not.toBeNull();
    const ricorrenza = await env.DB
      .prepare('SELECT stato FROM ricorrenze WHERE societa_id = ?1')
      .bind(id)
      .first<{ stato: string }>();
    expect(ricorrenza?.stato).toBe('annullata');

    // Accessi invalidati subito: sia la sessione già emessa sia il link.
    expect((await getConCookie('/api/societa/me', cookieSoc)).status).toBe(401);
    expect((await app.request(`/accesso/${token}`, {}, env)).status).toBe(404);

    // Riattivazione: il link torna a funzionare, le prenotazioni no.
    expect((await postAdmin(`/api/admin/societa/${id}/riattiva`, cookieAmm)).status).toBe(200);
    expect((await app.request(`/accesso/${token}`, {}, env)).status).toBe(302);
    expect(await slotDiRichiesta(idRichiesta)).toEqual([]);
  });

  it('rigenerare il link invalida token e sessioni precedenti', async () => {
    const { id, token } = await creaSocietaConToken();
    const cookieSoc = await cookieSocieta(token);
    const cookieAmm = await cookieAdmin();

    const risposta = await postAdmin(`/api/admin/societa/${id}/rigenera-token`, cookieAmm);
    expect(risposta.status).toBe(200);
    const { link_accesso } = (await risposta.json()) as { link_accesso: string };

    expect((await app.request(`/accesso/${token}`, {}, env)).status).toBe(404);
    expect((await getConCookie('/api/societa/me', cookieSoc)).status).toBe(401);
    const nuovoToken = link_accesso.split('/accesso/')[1];
    expect((await app.request(`/accesso/${nuovoToken}`, {}, env)).status).toBe(302);
  });
});

describe('prenotazione diretta', () => {
  it('crea una richiesta già approvata con i suoi slot; una sovrapposizione risponde 409', async () => {
    const cookieAmm = await cookieAdmin();
    // La società 1 è Cardano Skating S.R.L. S.S.D. (seed della migrazione iniziale).
    const risposta = await postJson('/api/admin/prenotazioni', cookieAmm, {
      societa_id: 1, titolo: 'Pattinaggio libero', data: dataFutura, ora_inizio: '10:00', ora_fine: '11:30', note: 'corso interno',
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as { richiesta_id: number; slot_inseriti: number };
    expect(corpo.slot_inseriti).toBe(3);
    expect((await slotDiRichiesta(corpo.richiesta_id)).length).toBe(3);
    const richiesta = await env.DB
      .prepare('SELECT stato, titolo FROM richieste WHERE id = ?1')
      .bind(corpo.richiesta_id)
      .first<{ stato: string; titolo: string }>();
    expect(richiesta?.stato).toBe('approvata');
    expect(richiesta?.titolo).toBe('Pattinaggio libero');

    // Il calendario admin espone il titolo attività di ogni slot prenotato.
    const calendario = await getConCookie(`/api/admin/calendario?settimana=${dataFutura}`, cookieAmm);
    expect(calendario.status).toBe(200);
    const corpoCalendario = (await calendario.json()) as { prenotazioni: { titolo: string }[] };
    expect(corpoCalendario.prenotazioni.length).toBe(3);
    expect(corpoCalendario.prenotazioni.every((p) => p.titolo === 'Pattinaggio libero')).toBe(true);

    const conflitto = await postJson('/api/admin/prenotazioni', cookieAmm, {
      societa_id: 1, data: dataFutura, ora_inizio: '11:00', ora_fine: '12:00',
    });
    expect(conflitto.status).toBe(409);
    const dettaglio = (await conflitto.json()) as { conflitti: { slot_key: string }[] };
    expect(dettaglio.conflitti.map((c) => c.slot_key)).toEqual([`${dataFutura}_1100`]);
  });
});

/**
 * Prenotazione diretta RICORRENTE: stesse regole della richiesta ricorrente
 * della società (giorni, finestra di 4 settimane, tutto o niente), ma la serie
 * nasce già approvata ed è materializzata subito, in un solo batch.
 */
describe('prenotazione diretta ricorrente', () => {
  type RispostaRicorrente = { tipo: string; ricorrenza_id: number; occorrenze: string[]; slot_inseriti: number };

  it('crea la serie già approvata e ne materializza tutte le date, visibili anche alla società', async () => {
    const cookieAmm = await cookieAdmin();
    const { id: societaId, token } = await creaSocietaConToken('ASD Ricorrente');
    // Lunedì, mercoledì e venerdì 19:00-20:30 per 4 settimane piene.
    const risposta = await postJson('/api/admin/prenotazioni', cookieAmm, {
      societa_id: societaId,
      titolo: 'Corso agonisti',
      data: lunediFuturo,
      ora_inizio: '19:00',
      ora_fine: '20:30',
      giorni: [2, 4],
      ripeti_fino_al: aggiungiGiorni(lunediFuturo, 27),
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as RispostaRicorrente;
    expect(corpo.tipo).toBe('ricorrenza');
    const dateAttese = [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25].map((scarto) => aggiungiGiorni(lunediFuturo, scarto));
    expect(corpo.occorrenze).toEqual(dateAttese);
    expect(corpo.slot_inseriti).toBe(12 * 3);

    // Serie già approvata, senza motivazione (come la prenotazione diretta singola).
    const ricorrenza = await env.DB
      .prepare('SELECT stato, giorni, motivazione, titolo FROM ricorrenze WHERE id = ?1')
      .bind(corpo.ricorrenza_id)
      .first<{ stato: string; giorni: string; motivazione: string | null; titolo: string }>();
    expect(ricorrenza).toEqual({ stato: 'approvata', giorni: '0,2,4', motivazione: null, titolo: 'Corso agonisti' });

    const richieste = await env.DB
      .prepare('SELECT data, stato, titolo FROM richieste WHERE ricorrenza_id = ?1 ORDER BY data')
      .bind(corpo.ricorrenza_id)
      .all<{ data: string; stato: string; titolo: string }>();
    expect(richieste.results.map((r) => r.data)).toEqual(dateAttese);
    expect(richieste.results.every((r) => r.stato === 'approvata' && r.titolo === 'Corso agonisti')).toBe(true);
    const totale = await env.DB.prepare('SELECT COUNT(*) AS n FROM prenotazioni').first<{ n: number }>();
    expect(totale?.n).toBe(12 * 3);

    // La società la vede nella sua area come serie approvata, con le date collegate.
    const elenco = await getConCookie('/api/societa/richieste', await cookieSocieta(token));
    const dati = (await elenco.json()) as {
      ricorrenze: { id: number; stato: string; giorni: number[] }[];
      richieste: { ricorrenza_id: number | null }[];
    };
    expect(dati.ricorrenze).toEqual([expect.objectContaining({ id: corpo.ricorrenza_id, stato: 'approvata', giorni: [0, 2, 4] })]);
    expect(dati.richieste.filter((r) => r.ricorrenza_id === corpo.ricorrenza_id)).toHaveLength(12);
  });

  it('senza ripetizione settimanale copre solo gli altri giorni della stessa settimana', async () => {
    const cookieAmm = await cookieAdmin();
    const societaId = await creaSocieta('ASD Settimana');
    const risposta = await postJson('/api/admin/prenotazioni', cookieAmm, {
      societa_id: societaId, data: lunediFuturo, ora_inizio: '19:00', ora_fine: '20:00', giorni: [2, 4],
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as RispostaRicorrente;
    expect(corpo.occorrenze).toEqual([lunediFuturo, aggiungiGiorni(lunediFuturo, 2), aggiungiGiorni(lunediFuturo, 4)]);
    const ricorrenza = await env.DB
      .prepare('SELECT valida_dal, valida_al FROM ricorrenze WHERE id = ?1')
      .bind(corpo.ricorrenza_id)
      .first<{ valida_dal: string; valida_al: string }>();
    expect(ricorrenza).toEqual({ valida_dal: lunediFuturo, valida_al: aggiungiGiorni(lunediFuturo, 6) });
  });

  it('con un conflitto su una sola data non prenota nulla ed elenca chi occupa lo slot', async () => {
    const cookieAmm = await cookieAdmin();
    // Un'altra società occupa mezz'ora del mercoledì della prima settimana.
    const occupante = await creaSocieta('ASD Occupante');
    const mercoledi = aggiungiGiorni(lunediFuturo, 2);
    const occupazione = await postJson('/api/admin/prenotazioni', cookieAmm, {
      societa_id: occupante, data: mercoledi, ora_inizio: '19:30', ora_fine: '20:00',
    });
    expect(occupazione.status).toBe(201);

    const societaId = await creaSocieta('ASD Sfortunata');
    const risposta = await postJson('/api/admin/prenotazioni', cookieAmm, {
      societa_id: societaId,
      data: lunediFuturo,
      ora_inizio: '19:00',
      ora_fine: '20:30',
      giorni: [2, 4],
      ripeti_fino_al: aggiungiGiorni(lunediFuturo, 27),
    });
    expect(risposta.status).toBe(409);
    const corpo = (await risposta.json()) as { conflitti: { slot_key: string; societa: string }[] };
    expect(corpo.conflitti).toEqual([{ slot_key: `${mercoledi}_1930`, societa: 'ASD Occupante' }]);

    // Rollback completo: né serie né date per la società, solo lo slot dell'occupante.
    const serie = await env.DB.prepare('SELECT COUNT(*) AS n FROM ricorrenze WHERE societa_id = ?1').bind(societaId).first<{ n: number }>();
    expect(serie?.n).toBe(0);
    const date = await env.DB.prepare('SELECT COUNT(*) AS n FROM richieste WHERE societa_id = ?1').bind(societaId).first<{ n: number }>();
    expect(date?.n).toBe(0);
    const totale = await env.DB.prepare('SELECT COUNT(*) AS n FROM prenotazioni').first<{ n: number }>();
    expect(totale?.n).toBe(1);
  });

  it('rifiuta giorni della settimana non validi e una ripetizione oltre le 4 settimane', async () => {
    const cookieAmm = await cookieAdmin();
    const societaId = await creaSocieta('ASD Errori');
    const base = { societa_id: societaId, data: lunediFuturo, ora_inizio: '19:00', ora_fine: '20:00' };
    expect((await postJson('/api/admin/prenotazioni', cookieAmm, { ...base, giorni: [7] })).status).toBe(400);
    expect((await postJson('/api/admin/prenotazioni', cookieAmm, { ...base, giorni: 'mercoledì' })).status).toBe(400);
    expect((await postJson('/api/admin/prenotazioni', cookieAmm, { ...base, ripeti_fino_al: aggiungiGiorni(lunediFuturo, 28) })).status).toBe(400);
    const serie = await env.DB.prepare('SELECT COUNT(*) AS n FROM ricorrenze').first<{ n: number }>();
    expect(serie?.n).toBe(0);
  });
});
