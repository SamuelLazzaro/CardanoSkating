/**
 * Test di integrazione sul flusso dell'area società: accesso via link
 * personale, invio richieste (singole e ricorrenti) e annullamento.
 *
 * Le date sono calcolate rispetto a oggi (ora italiana) perché la creazione
 * di richieste rifiuta date passate o oltre un anno nel futuro.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { aggiungiGiorni, oraRoma } from '../src/slots';
import { cookieAdmin, cookieSocieta, creaSocietaConToken, getConCookie, postAdmin, postJson, slotDiRichiesta } from './helpers';

const oggi = oraRoma(new Date()).data;
const dataFutura = aggiungiGiorni(oggi, 7);

describe('accesso via link personale', () => {
  it('imposta il cookie di sessione e /me risponde con i dati della società', async () => {
    const { token } = await creaSocietaConToken('ASD Rotelle');
    const cookie = await cookieSocieta(token);
    const risposta = await getConCookie('/api/societa/me', cookie);
    expect(risposta.status).toBe(200);
    const corpo = (await risposta.json()) as { societa: { nome: string }; link_ics: string };
    expect(corpo.societa.nome).toBe('ASD Rotelle');
    expect(corpo.link_ics).toContain(`/api/ics/${token}`);
  });

  it('token inesistente: 404 e nessun cookie', async () => {
    const risposta = await app.request(`/accesso/${crypto.randomUUID()}`, {}, env);
    expect(risposta.status).toBe(404);
    expect(risposta.headers.get('set-cookie')).toBeNull();
  });

  it('senza sessione le API della società rispondono 401', async () => {
    const risposta = await app.request('/api/societa/richieste', {}, env);
    expect(risposta.status).toBe(401);
  });
});

describe('invio richieste dalla società', () => {
  it('crea una richiesta singola in attesa', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data: dataFutura,
      ora_inizio: '18:00',
      ora_fine: '19:30',
      note: 'allenamento di prova',
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as { tipo: string; id: number };
    expect(corpo.tipo).toBe('richiesta');
    const riga = await env.DB.prepare('SELECT stato, note FROM richieste WHERE id = ?1').bind(corpo.id).first<{ stato: string; note: string }>();
    expect(riga?.stato).toBe('in_attesa');
    expect(riga?.note).toBe('allenamento di prova');
  });

  it('rifiuta orari non a passi di 30 minuti', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data: dataFutura,
      ora_inizio: '18:15',
      ora_fine: '19:00',
    });
    expect(risposta.status).toBe(400);
  });

  it('rifiuta una ripetizione oltre le 4 settimane', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data: dataFutura,
      ora_inizio: '18:00',
      ora_fine: '19:00',
      ripeti_fino_al: aggiungiGiorni(dataFutura, 28),
    });
    expect(risposta.status).toBe(400);
  });

  it('crea una ricorrenza con le occorrenze attese', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data: dataFutura,
      ora_inizio: '18:00',
      ora_fine: '19:00',
      ripeti_fino_al: aggiungiGiorni(dataFutura, 21),
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as { tipo: string; id: number; occorrenze: string[] };
    expect(corpo.tipo).toBe('ricorrenza');
    expect(corpo.occorrenze).toEqual([
      dataFutura,
      aggiungiGiorni(dataFutura, 7),
      aggiungiGiorni(dataFutura, 14),
      aggiungiGiorni(dataFutura, 21),
    ]);
    const riga = await env.DB.prepare('SELECT stato FROM ricorrenze WHERE id = ?1').bind(corpo.id).first<{ stato: string }>();
    expect(riga?.stato).toBe('in_attesa');
  });
});

describe('annullamento dalla società', () => {
  it('annulla una richiesta approvata liberando gli slot e salvando annullata_at', async () => {
    const { token } = await creaSocietaConToken();
    const cookieSoc = await cookieSocieta(token);
    const creazione = await postJson('/api/societa/richieste', cookieSoc, {
      data: dataFutura,
      ora_inizio: '18:00',
      ora_fine: '19:00',
    });
    const { id } = (await creazione.json()) as { id: number };

    const cookieAmm = await cookieAdmin();
    expect((await postAdmin(`/api/admin/richieste/${id}/approva`, cookieAmm)).status).toBe(200);
    expect((await slotDiRichiesta(id)).length).toBe(2);

    const annullamento = await postJson(`/api/societa/richieste/${id}/annulla`, cookieSoc, {});
    expect(annullamento.status).toBe(200);
    expect(await slotDiRichiesta(id)).toEqual([]);
    const riga = await env.DB
      .prepare('SELECT stato, annullata_at FROM richieste WHERE id = ?1')
      .bind(id)
      .first<{ stato: string; annullata_at: string | null }>();
    expect(riga?.stato).toBe('annullata');
    expect(riga?.annullata_at).not.toBeNull();
  });

  it('non permette di annullare richieste di altre società', async () => {
    const prima = await creaSocietaConToken('Società A');
    const seconda = await creaSocietaConToken('Società B');
    const cookieA = await cookieSocieta(prima.token);
    const cookieB = await cookieSocieta(seconda.token);
    const creazione = await postJson('/api/societa/richieste', cookieA, {
      data: dataFutura,
      ora_inizio: '18:00',
      ora_fine: '19:00',
    });
    const { id } = (await creazione.json()) as { id: number };
    const tentativo = await postJson(`/api/societa/richieste/${id}/annulla`, cookieB, {});
    expect(tentativo.status).toBe(404);
  });
});
