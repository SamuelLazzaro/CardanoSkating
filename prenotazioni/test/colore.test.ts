/**
 * Test sul colore distintivo delle società (migrazione 0006): validazione
 * #RRGGBB lato server su creazione e modifica, esposizione nelle viste
 * autenticate (elenco società, calendario admin, /me della società) e
 * anonimato del calendario pubblico, che non deve mai contenere colori né
 * nomi società.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { aggiungiGiorni, oraRoma } from '../src/slots';
import { cookieAdmin, cookieSocieta, getConCookie, postJson } from './helpers';

const oggi = oraRoma(new Date()).data;
const dataFutura = aggiungiGiorni(oggi, 7);

const ANAGRAFICA = { nome: 'ASD Colorata', referente: 'Referente', email: 'colori@example.com' };

describe('validazione del colore', () => {
  it('rifiuta formati diversi da #RRGGBB in creazione e modifica', async () => {
    const cookieAmm = await cookieAdmin();
    for (const colore of ['rosso', '#12345', '#1234567', '#12345g', '3b82f6']) {
      const creazione = await postJson('/api/admin/societa', cookieAmm, { ...ANAGRAFICA, colore });
      expect(creazione.status).toBe(400);
    }
    const modifica = await app.request(
      '/api/admin/societa/1',
      { method: 'PATCH', headers: { Cookie: cookieAmm, 'Content-Type': 'application/json' }, body: JSON.stringify({ colore: 'blu' }) },
      env,
    );
    expect(modifica.status).toBe(400);
  });

  it('salva il colore normalizzato in minuscolo, con default senza colore', async () => {
    const cookieAmm = await cookieAdmin();
    const conColore = await postJson('/api/admin/societa', cookieAmm, { ...ANAGRAFICA, colore: '#AABB01' });
    expect(conColore.status).toBe(201);
    const { id } = (await conColore.json()) as { id: number };
    const senzaColore = await postJson('/api/admin/societa', cookieAmm, { ...ANAGRAFICA, nome: 'ASD Neutra' });
    expect(senzaColore.status).toBe(201);

    const elenco = await getConCookie('/api/admin/societa', cookieAmm);
    const corpo = (await elenco.json()) as { societa: { id: number; nome: string; colore: string }[] };
    expect(corpo.societa.find((s) => s.id === id)?.colore).toBe('#aabb01');
    expect(corpo.societa.find((s) => s.nome === 'ASD Neutra')?.colore).toBe('#3b82f6');

    const aggiornamento = await app.request(
      `/api/admin/societa/${id}`,
      { method: 'PATCH', headers: { Cookie: cookieAmm, 'Content-Type': 'application/json' }, body: JSON.stringify({ colore: '#00FF00' }) },
      env,
    );
    expect(aggiornamento.status).toBe(200);
    const riga = await env.DB.prepare('SELECT colore FROM societa WHERE id = ?1').bind(id).first<{ colore: string }>();
    expect(riga?.colore).toBe('#00ff00');
  });
});

describe('esposizione del colore nelle viste autenticate', () => {
  it('calendario admin e /me della società espongono il colore; il calendario pubblico no', async () => {
    const cookieAmm = await cookieAdmin();
    const creazione = await postJson('/api/admin/societa', cookieAmm, { ...ANAGRAFICA, colore: '#cc0011' });
    const { id, link_accesso } = (await creazione.json()) as { id: number; link_accesso: string };

    const prenotazione = await postJson('/api/admin/prenotazioni', cookieAmm, {
      societa_id: id, data: dataFutura, ora_inizio: '18:00', ora_fine: '19:00',
    });
    expect(prenotazione.status).toBe(201);

    const calendario = await getConCookie(`/api/admin/calendario?settimana=${dataFutura}`, cookieAmm);
    const corpoCalendario = (await calendario.json()) as { prenotazioni: { colore: string }[] };
    expect(corpoCalendario.prenotazioni.length).toBe(2);
    expect(corpoCalendario.prenotazioni.every((p) => p.colore === '#cc0011')).toBe(true);

    const token = link_accesso.split('/accesso/')[1];
    const cookieSoc = await cookieSocieta(token);
    const profilo = await getConCookie('/api/societa/me', cookieSoc);
    const corpoProfilo = (await profilo.json()) as { societa: { colore: string } };
    expect(corpoProfilo.societa.colore).toBe('#cc0011');

    // Anonimato: la risposta pubblica contiene solo le slot_key, mai colori
    // o nomi società.
    const pubblico = await app.request(`/api/calendario?settimana=${dataFutura}`, {}, env);
    expect(pubblico.status).toBe(200);
    const testoPubblico = await pubblico.text();
    expect(testoPubblico).not.toContain('#cc0011');
    expect(testoPubblico).not.toContain('colore');
    expect(testoPubblico).not.toContain('ASD Colorata');
    const corpoPubblico = JSON.parse(testoPubblico) as Record<string, unknown>;
    expect(Object.keys(corpoPubblico).sort()).toEqual(['settimana', 'slot_occupati']);
  });
});
