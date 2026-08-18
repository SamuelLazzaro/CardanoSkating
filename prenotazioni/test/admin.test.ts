/**
 * Test di integrazione sul pannello admin: login e rate limit, gestione
 * società (creazione, cascata di sospensione, rigenerazione link) e
 * prenotazioni dirette.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { aggiungiGiorni, oraRoma } from '../src/slots';
import { cookieAdmin, cookieSocieta, creaSocietaConToken, getConCookie, postAdmin, postJson, slotDiRichiesta } from './helpers';

const oggi = oraRoma(new Date()).data;
const dataFutura = aggiungiGiorni(oggi, 7);

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
  it('crea una società e il link personale restituito funziona', async () => {
    const cookieAmm = await cookieAdmin();
    const risposta = await postJson('/api/admin/societa', cookieAmm, {
      nome: 'Nuova ASD',
      referente: 'Mario Rossi',
      email: 'mario@example.com',
      telefono: '333 1234567',
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as { id: number; link_accesso: string };
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

  it('la sospensione cancella il futuro e invalida gli accessi; la riattivazione non ripristina', async () => {
    const { id, token } = await creaSocietaConToken('Da Sospendere');
    const cookieSoc = await cookieSocieta(token);
    const cookieAmm = await cookieAdmin();

    // Setup: una richiesta futura approvata e una ricorrenza in attesa.
    const creazione = await postJson('/api/societa/richieste', cookieSoc, {
      data: dataFutura, ora_inizio: '18:00', ora_fine: '19:00',
    });
    const { id: idRichiesta } = (await creazione.json()) as { id: number };
    expect((await postAdmin(`/api/admin/richieste/${idRichiesta}/approva`, cookieAmm)).status).toBe(200);
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
      societa_id: 1, data: dataFutura, ora_inizio: '10:00', ora_fine: '11:30', note: 'corso interno',
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as { richiesta_id: number; slot_inseriti: number };
    expect(corpo.slot_inseriti).toBe(3);
    expect((await slotDiRichiesta(corpo.richiesta_id)).length).toBe(3);
    const richiesta = await env.DB
      .prepare('SELECT stato FROM richieste WHERE id = ?1')
      .bind(corpo.richiesta_id)
      .first<{ stato: string }>();
    expect(richiesta?.stato).toBe('approvata');

    const conflitto = await postJson('/api/admin/prenotazioni', cookieAmm, {
      societa_id: 1, data: dataFutura, ora_inizio: '11:00', ora_fine: '12:00',
    });
    expect(conflitto.status).toBe(409);
    const dettaglio = (await conflitto.json()) as { conflitti: { slot_key: string }[] };
    expect(dettaglio.conflitti.map((c) => c.slot_key)).toEqual([`${dataFutura}_1100`]);
  });
});
