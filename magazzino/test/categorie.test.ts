/**
 * Test di integrazione sulle categorie: seed iniziale, inserimento senza
 * distinzione di maiuscole, attivazione/disattivazione.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { cookieUtente, getConCookie, patchJson, postJson } from './helpers';

describe('categorie', () => {
  it('senza sessione risponde 401', async () => {
    expect((await app.request('/api/categorie', {}, env)).status).toBe(401);
  });

  it('la migrazione inserisce le 9 categorie di partenza, tutte attive', async () => {
    const cookie = await cookieUtente();
    const risposta = await getConCookie('/api/categorie', cookie);
    const { categorie } = (await risposta.json()) as { categorie: { nome: string; attiva: number }[] };
    expect(categorie.map((c) => c.nome).sort()).toEqual(['Abbigliamento', 'Altro', 'Body', 'Caschi', 'Lame', 'Pattini', 'Protezioni', 'Ruote', 'Transponder']);
    expect(categorie.every((c) => c.attiva === 1)).toBe(true);
  });

  it('crea una categoria e rifiuta il doppione anche con maiuscole diverse', async () => {
    const cookie = await cookieUtente();
    const risposta = await postJson('/api/categorie', cookie, { nome: 'Guanti' });
    expect(risposta.status).toBe(201);
    expect((await postJson('/api/categorie', cookie, { nome: 'GUANTI' })).status).toBe(409);
    expect((await postJson('/api/categorie', cookie, { nome: 'pattini' })).status).toBe(409);
    expect((await postJson('/api/categorie', cookie, { nome: '' })).status).toBe(400);
  });

  it('disattiva e riattiva una categoria', async () => {
    const cookie = await cookieUtente();
    const { categorie } = (await (await getConCookie('/api/categorie', cookie)).json()) as { categorie: { id: number; nome: string }[] };
    const ruote = categorie.find((c) => c.nome === 'Ruote')!;
    expect((await patchJson(`/api/categorie/${ruote.id}`, cookie, { attiva: false })).status).toBe(200);
    const riga = await env.DB.prepare('SELECT attiva FROM categorie WHERE id = ?1').bind(ruote.id).first<{ attiva: number }>();
    expect(riga?.attiva).toBe(0);
    expect((await patchJson(`/api/categorie/${ruote.id}`, cookie, { attiva: true })).status).toBe(200);
    expect((await patchJson('/api/categorie/9999', cookie, { attiva: true })).status).toBe(404);
  });
});
