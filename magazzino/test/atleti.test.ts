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

  it('crea un atleta, lo elenca in ordine alfabetico e lo registra in audit', async () => {
    const cookie = await cookieUtente();
    await creaAtleta('Zeta Ultimo');
    const risposta = await postJson('/api/atleti', cookie, { nome: '  Anna Prima  ' });
    expect(risposta.status).toBe(201);
    expect(await risposta.json()).toMatchObject({ nome: 'Anna Prima', attivo: 1 });
    const elenco = await getConCookie('/api/atleti', cookie);
    const { atleti } = (await elenco.json()) as { atleti: { nome: string }[] };
    expect(atleti.map((a) => a.nome)).toEqual(['Anna Prima', 'Zeta Ultimo']);
    expect((await audit('atleta_creato'))[0]?.attore).toBe(UTENTE_TEST);
  });

  it('rifiuta nome vuoto o troppo lungo e i doppioni', async () => {
    const cookie = await cookieUtente();
    expect((await postJson('/api/atleti', cookie, { nome: '   ' })).status).toBe(400);
    expect((await postJson('/api/atleti', cookie, { nome: 'x'.repeat(161) })).status).toBe(400);
    expect((await postJson('/api/atleti', cookie, {})).status).toBe(400);
    await creaAtleta('Mario Rossi');
    const doppione = await postJson('/api/atleti', cookie, { nome: 'Mario Rossi' });
    expect(doppione.status).toBe(409);
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
    const scheda = (await risposta.json()) as { atleta: { nome: string }; assegnati: { codice: string; in_possesso: number }[]; storico: Record<string, unknown>[] };
    expect(scheda.atleta.nome).toBe('Giulia Verdi');
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
