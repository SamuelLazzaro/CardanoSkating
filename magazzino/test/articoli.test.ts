/**
 * Test di integrazione sugli articoli: inserimento con validazione, elenco con
 * filtri, scheda, eliminazione e QR code.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { patternRicerca } from '../src/util';
import { cookieUtente, creaArticolo, creaAtleta, deleteConCookie, getConCookie, postJson } from './helpers';

const NUOVO = { codice: 'RUO-110', disciplina: 'Corsa', categoria: 'Ruote', descrizione: 'Ruota Matter 110 mm', marca: 'Matter', quantita: 8, valore: 12.5 };

describe('inserimento articoli', () => {
  it('crea un articolo con giacenza piena e stato Buono di default', async () => {
    const cookie = await cookieUtente();
    const risposta = await postJson('/api/articoli', cookie, NUOVO);
    expect(risposta.status).toBe(201);
    const { id } = (await risposta.json()) as { id: number };
    const scheda = await getConCookie(`/api/articoli/${id}`, cookie);
    expect(scheda.status).toBe(200);
    const { articolo } = (await scheda.json()) as { articolo: Record<string, unknown> };
    expect(articolo).toMatchObject({ codice: 'RUO-110', disciplina: 'Corsa', quantita: 8, disponibili: 8, stato: 'Buono', valore: 12.5, marca: 'Matter', modello: null });
  });

  it('senza quantità la giacenza è 1; stato e valore indicati vengono salvati', async () => {
    const cookie = await cookieUtente();
    const risposta = await postJson('/api/articoli', cookie, { ...NUOVO, codice: 'X-1', quantita: undefined, stato: 'Usurato', valore: 3.456 });
    const { id } = (await risposta.json()) as { id: number };
    const { articolo } = (await (await getConCookie(`/api/articoli/${id}`, cookie)).json()) as { articolo: Record<string, unknown> };
    expect(articolo).toMatchObject({ quantita: 1, disponibili: 1, stato: 'Usurato', valore: 3.46 });
  });

  it('rifiuta codice duplicato (409) e dati non validi (400)', async () => {
    const cookie = await cookieUtente();
    await creaArticolo({ codice: 'DUP-1' });
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, codice: 'DUP-1' })).status).toBe(409);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, disciplina: 'Nuoto' })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, categoria: '' })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, quantita: 0 })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, quantita: 2.5 })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, valore: -1 })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, stato: 'Rotto' })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, marca: 42 })).status).toBe(400);
    expect((await app.request('/api/articoli', { method: 'POST', headers: { Cookie: cookie }, body: 'x' }, env)).status).toBe(400);
  });
});

describe('elenco e ricerca', () => {
  it('filtra per magazzino e per testo libero su codice, descrizione, marca e seriale', async () => {
    const cookie = await cookieUtente();
    await creaArticolo({ codice: 'G-1', disciplina: 'Ghiaccio', descrizione: 'Lama Wilson', marca: 'Wilson' });
    await creaArticolo({ codice: 'C-1', disciplina: 'Corsa', descrizione: 'Telaio', seriale: 'SN-777' });
    await creaArticolo({ codice: 'C-2', disciplina: 'Corsa', descrizione: 'Body gara' });
    const tutti = (await (await getConCookie('/api/articoli', cookie)).json()) as { articoli: { codice: string }[] };
    expect(tutti.articoli.map((a) => a.codice)).toEqual(['C-2', 'C-1', 'G-1']);
    const ghiaccio = (await (await getConCookie('/api/articoli?disciplina=Ghiaccio', cookie)).json()) as { articoli: { codice: string }[] };
    expect(ghiaccio.articoli.map((a) => a.codice)).toEqual(['G-1']);
    const perMarca = (await (await getConCookie('/api/articoli?q=wilson', cookie)).json()) as { articoli: { codice: string }[] };
    expect(perMarca.articoli.map((a) => a.codice)).toEqual(['G-1']);
    const perSeriale = (await (await getConCookie('/api/articoli?q=777', cookie)).json()) as { articoli: { codice: string }[] };
    expect(perSeriale.articoli.map((a) => a.codice)).toEqual(['C-1']);
    const combinato = (await (await getConCookie('/api/articoli?disciplina=Corsa&q=body', cookie)).json()) as { articoli: { codice: string }[] };
    expect(combinato.articoli.map((a) => a.codice)).toEqual(['C-2']);
    const nessuno = (await (await getConCookie('/api/articoli?q=%25', cookie)).json()) as { articoli: unknown[] };
    expect(nessuno.articoli).toEqual([]);
  });

  it('patternRicerca protegge i caratteri speciali e resta entro 50 byte', () => {
    expect(patternRicerca('  ')).toBeNull();
    expect(patternRicerca('a%b_c\\d')).toBe('%a\\%b\\_c\\\\d%');
    const lungo = patternRicerca('è'.repeat(60))!;
    expect(new TextEncoder().encode(lungo).length).toBeLessThanOrEqual(50);
    expect(lungo.startsWith('%è')).toBe(true);
  });
});

describe('eliminazione', () => {
  it('elimina un articolo senza movimenti; con storico risponde 409 e lo lascia', async () => {
    const cookie = await cookieUtente();
    const libero = await creaArticolo({ codice: 'LIB-1' });
    expect((await deleteConCookie(`/api/articoli/${libero}`, cookie)).status).toBe(200);
    expect((await getConCookie(`/api/articoli/${libero}`, cookie)).status).toBe(404);
    const usato = await creaArticolo({ codice: 'USA-1' });
    const atleta = await creaAtleta();
    await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: usato, atleta_id: atleta, quantita: 1 });
    const rifiuto = await deleteConCookie(`/api/articoli/${usato}`, cookie);
    expect(rifiuto.status).toBe(409);
    expect((await getConCookie(`/api/articoli/${usato}`, cookie)).status).toBe(200);
    expect((await deleteConCookie('/api/articoli/9999', cookie)).status).toBe(404);
  });
});

describe('QR code', () => {
  it('restituisce un SVG che codifica il link alla scheda; 404 se l\'articolo non esiste', async () => {
    const cookie = await cookieUtente();
    const id = await creaArticolo({ codice: 'QR-1' });
    const risposta = await getConCookie(`/api/articoli/${id}/qr.svg`, cookie);
    expect(risposta.status).toBe(200);
    expect(risposta.headers.get('content-type')).toContain('image/svg+xml');
    const svg = await risposta.text();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<path');
    expect((await getConCookie('/api/articoli/9999/qr.svg', cookie)).status).toBe(404);
    expect((await app.request(`/api/articoli/${id}/qr.svg`, {}, env)).status).toBe(401);
  });
});
