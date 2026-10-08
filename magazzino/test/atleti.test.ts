/**
 * Test di integrazione sugli atleti: elenco, inserimento, attivazione e scheda.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { audit, cookieUtente, creaArticolo, creaAtleta, deleteConCookie, getConCookie, patchJson, postJson, UTENTE_TEST } from './helpers';

describe('atleti', () => {
  it('senza sessione risponde 401', async () => {
    const risposta = await app.request('/api/atleti', {}, env);
    expect(risposta.status).toBe(401);
  });

  it('crea un atleta con categoria, lo elenca in ordine alfabetico e lo registra in audit', async () => {
    const cookie = await cookieUtente();
    await creaAtleta('Zeta Ultimo', true, null);
    const risposta = await postJson('/api/atleti', cookie, { nome: '  Anna Prima  ', categoria: 'R12' });
    expect(risposta.status).toBe(201);
    expect(await risposta.json()).toMatchObject({ nome: 'Anna Prima', categoria: 'R12', attivo: 1 });
    const elenco = await getConCookie('/api/atleti', cookie);
    const { atleti } = (await elenco.json()) as { atleti: { nome: string; categoria: string | null }[] };
    expect(atleti.map((a) => a.nome)).toEqual(['Anna Prima', 'Zeta Ultimo']);
    // gli atleti inseriti prima della migrazione 0002 restano senza categoria
    expect(atleti.map((a) => a.categoria)).toEqual(['R12', null]);
    expect((await audit('atleta_creato'))[0]).toMatchObject({ attore: UTENTE_TEST, dettaglio: expect.stringContaining('(R12)') });
  });

  it('rifiuta nome vuoto o troppo lungo, categoria mancante o sconosciuta e i doppioni', async () => {
    const cookie = await cookieUtente();
    expect((await postJson('/api/atleti', cookie, { nome: '   ', categoria: 'G' })).status).toBe(400);
    expect((await postJson('/api/atleti', cookie, { nome: 'x'.repeat(161), categoria: 'G' })).status).toBe(400);
    expect((await postJson('/api/atleti', cookie, {})).status).toBe(400);
    expect((await postJson('/api/atleti', cookie, { nome: 'Senza Categoria' })).status).toBe(400);
    expect((await postJson('/api/atleti', cookie, { nome: 'Categoria Errata', categoria: 'X' })).status).toBe(400);
    expect((await postJson('/api/atleti', cookie, { nome: 'Minuscola', categoria: 'r12' })).status).toBe(400);
    await creaAtleta('Mario Rossi');
    const doppione = await postJson('/api/atleti', cookie, { nome: 'Mario Rossi', categoria: 'S' });
    expect(doppione.status).toBe(409);
  });

  it('cambia la categoria di un atleta (anche a uno senza categoria) e lo registra in audit', async () => {
    const cookie = await cookieUtente();
    const id = await creaAtleta('Storico Senza', true, null);
    expect((await patchJson(`/api/atleti/${id}`, cookie, { categoria: 'J' })).status).toBe(200);
    let riga = await env.DB.prepare('SELECT categoria, attivo FROM atleti WHERE id = ?1').bind(id).first<{ categoria: string | null; attivo: number }>();
    expect(riga).toEqual({ categoria: 'J', attivo: 1 });
    expect((await audit('atleta_categoria'))[0]).toMatchObject({ attore: UTENTE_TEST, dettaglio: `#${id} → J` });
    // categoria e stato nella stessa richiesta
    expect((await patchJson(`/api/atleti/${id}`, cookie, { categoria: 'S', attivo: false })).status).toBe(200);
    riga = await env.DB.prepare('SELECT categoria, attivo FROM atleti WHERE id = ?1').bind(id).first<{ categoria: string | null; attivo: number }>();
    expect(riga).toEqual({ categoria: 'S', attivo: 0 });
    // categoria non valida: 400 e nessuna modifica
    expect((await patchJson(`/api/atleti/${id}`, cookie, { categoria: 'Z' })).status).toBe(400);
    expect((await patchJson(`/api/atleti/${id}`, cookie, { categoria: null })).status).toBe(400);
    expect((await patchJson(`/api/atleti/${id}`, cookie, {})).status).toBe(400);
    riga = await env.DB.prepare('SELECT categoria, attivo FROM atleti WHERE id = ?1').bind(id).first<{ categoria: string | null; attivo: number }>();
    expect(riga).toEqual({ categoria: 'S', attivo: 0 });
    expect((await patchJson('/api/atleti/9999', cookie, { categoria: 'G' })).status).toBe(404);
  });

  it('disattiva e riattiva un atleta; 404 su id inesistente, 400 senza flag', async () => {
    const cookie = await cookieUtente();
    const id = await creaAtleta('Luca Bianchi');
    expect((await patchJson(`/api/atleti/${id}`, cookie, { attivo: false })).status).toBe(200);
    let riga = await env.DB.prepare('SELECT attivo FROM atleti WHERE id = ?1').bind(id).first<{ attivo: number }>();
    expect(riga?.attivo).toBe(0);
    expect((await patchJson(`/api/atleti/${id}`, cookie, { attivo: true })).status).toBe(200);
    riga = await env.DB.prepare('SELECT attivo FROM atleti WHERE id = ?1').bind(id).first<{ attivo: number }>();
    expect(riga?.attivo).toBe(1);
    expect((await patchJson('/api/atleti/9999', cookie, { attivo: false })).status).toBe(404);
    expect((await patchJson(`/api/atleti/${id}`, cookie, { attivo: 'no' })).status).toBe(400);
  });

  it('la scheda mostra il materiale in possesso (consegne meno restituzioni) e lo storico senza firma', async () => {
    const cookie = await cookieUtente();
    const atletaId = await creaAtleta('Giulia Verdi');
    const pattini = await creaArticolo({ codice: 'PAT-1', descrizione: 'Pattini Edea', quantita: 3 });
    const casco = await creaArticolo({ codice: 'CAS-1', descrizione: 'Casco', quantita: 2, disciplina: 'Ghiaccio' });
    const firma = `data:image/png;base64,${btoa('png')}`;
    expect((await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: pattini, atleta_id: atletaId, quantita: 2, firma })).status).toBe(201);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: casco, atleta_id: atletaId, quantita: 1 })).status).toBe(201);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'RESTITUZIONE', articolo_id: casco, atleta_id: atletaId, quantita: 1 })).status).toBe(201);
    const risposta = await getConCookie(`/api/atleti/${atletaId}`, cookie);
    expect(risposta.status).toBe(200);
    const scheda = (await risposta.json()) as { atleta: { nome: string; categoria: string | null }; assegnati: { codice: string; in_possesso: number }[]; storico: Record<string, unknown>[] };
    expect(scheda.atleta).toMatchObject({ nome: 'Giulia Verdi', categoria: 'R' });
    expect(scheda.assegnati).toEqual([expect.objectContaining({ codice: 'PAT-1', in_possesso: 2 })]);
    expect(scheda.storico).toHaveLength(3);
    expect(scheda.storico.every((m) => !('firma' in m))).toBe(true);
    const consegnaPattini = scheda.storico.find((m) => m.codice === 'PAT-1');
    expect(consegnaPattini).toMatchObject({ tipo: 'CONSEGNA', firma_presente: true, operatore: UTENTE_TEST });
  });

  it('scheda di un atleta inesistente: 404', async () => {
    const cookie = await cookieUtente();
    expect((await getConCookie('/api/atleti/424242', cookie)).status).toBe(404);
    expect((await getConCookie('/api/atleti/abc', cookie)).status).toBe(404);
    expect((await deleteConCookie('/api/atleti/1', cookie)).status).toBe(404);
  });
});
