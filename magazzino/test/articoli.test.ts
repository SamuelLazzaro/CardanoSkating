/**
 * Test di integrazione sugli articoli: inserimento con validazione, elenco con
 * filtri, scheda, eliminazione e QR code.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { patternRicerca } from '../src/util';
import { audit, cookieUtente, creaArticolo, creaAtleta, deleteConCookie, getConCookie, postJson, UTENTE_TEST } from './helpers';

const NUOVO = { disciplina: 'Corsa', marca: 'Matter', modello: 'Ruota 110 mm', quantita: 8 };

describe('inserimento articoli', () => {
  it('crea un articolo con giacenza piena e stato Buono di default e lo registra in audit', async () => {
    const cookie = await cookieUtente();
    const risposta = await postJson('/api/articoli', cookie, NUOVO);
    expect(risposta.status).toBe(201);
    const { id } = (await risposta.json()) as { id: number };
    const scheda = await getConCookie(`/api/articoli/${id}`, cookie);
    expect(scheda.status).toBe(200);
    const { articolo } = (await scheda.json()) as { articolo: Record<string, unknown> };
    expect(articolo).toMatchObject({ disciplina: 'Corsa', marca: 'Matter', modello: 'Ruota 110 mm', taglia: null, quantita: 8, disponibili: 8, stato: 'Buono', note: null });
    for (const campoTolto of ['codice', 'categoria', 'descrizione', 'seriale', 'valore']) expect(articolo).not.toHaveProperty(campoTolto);
    expect((await audit('articolo_creato'))[0]).toEqual({ attore: UTENTE_TEST, dettaglio: `#${id} Matter Ruota 110 mm (Corsa)` });
  });

  it('senza quantità la giacenza è 1; stato, taglia e note indicati vengono salvati', async () => {
    const cookie = await cookieUtente();
    const risposta = await postJson('/api/articoli', cookie, { ...NUOVO, quantita: undefined, stato: 'Usurato', taglia: ' 42 ', note: 'seconda mano' });
    const { id } = (await risposta.json()) as { id: number };
    const { articolo } = (await (await getConCookie(`/api/articoli/${id}`, cookie)).json()) as { articolo: Record<string, unknown> };
    expect(articolo).toMatchObject({ quantita: 1, disponibili: 1, stato: 'Usurato', taglia: '42', note: 'seconda mano' });
  });

  it('la marca è obbligatoria, il modello no', async () => {
    const cookie = await cookieUtente();
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, marca: '' })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, marca: undefined })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, marca: 'x'.repeat(121) })).status).toBe(400);
    const soloMarca = await postJson('/api/articoli', cookie, { disciplina: 'Ghiaccio', marca: 'Edea' });
    expect(soloMarca.status).toBe(201);
    const { id } = (await soloMarca.json()) as { id: number };
    const { articolo } = (await (await getConCookie(`/api/articoli/${id}`, cookie)).json()) as { articolo: Record<string, unknown> };
    expect(articolo).toMatchObject({ marca: 'Edea', modello: null });
  });

  it('rifiuta dati non validi (400)', async () => {
    const cookie = await cookieUtente();
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, disciplina: 'Nuoto' })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, quantita: 0 })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, quantita: 2.5 })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, stato: 'Rotto' })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, modello: 42 })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, note: 'x'.repeat(1001) })).status).toBe(400);
    expect((await app.request('/api/articoli', { method: 'POST', headers: { Cookie: cookie }, body: 'x' }, env)).status).toBe(400);
  });
});

describe('elenco e ricerca', () => {
  it('ordina per magazzino, marca e modello; filtra per magazzino e per testo libero su marca e modello', async () => {
    const cookie = await cookieUtente();
    await creaArticolo({ disciplina: 'Ghiaccio', marca: 'Wilson', modello: 'Gold Seal' });
    await creaArticolo({ disciplina: 'Corsa', marca: 'Powerslide', modello: 'Telaio 3x110' });
    await creaArticolo({ disciplina: 'Corsa', marca: 'Bont', modello: null });
    const nomi = (lista: { articoli: { marca: string }[] }) => lista.articoli.map((a) => a.marca);
    const tutti = (await (await getConCookie('/api/articoli', cookie)).json()) as { articoli: { marca: string }[] };
    expect(nomi(tutti)).toEqual(['Bont', 'Powerslide', 'Wilson']);
    const ghiaccio = (await (await getConCookie('/api/articoli?disciplina=Ghiaccio', cookie)).json()) as { articoli: { marca: string }[] };
    expect(nomi(ghiaccio)).toEqual(['Wilson']);
    const perMarca = (await (await getConCookie('/api/articoli?q=wilson', cookie)).json()) as { articoli: { marca: string }[] };
    expect(nomi(perMarca)).toEqual(['Wilson']);
    const perModello = (await (await getConCookie('/api/articoli?q=3x110', cookie)).json()) as { articoli: { marca: string }[] };
    expect(nomi(perModello)).toEqual(['Powerslide']);
    const combinato = (await (await getConCookie('/api/articoli?disciplina=Corsa&q=bont', cookie)).json()) as { articoli: { marca: string }[] };
    expect(nomi(combinato)).toEqual(['Bont']);
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
    const libero = await creaArticolo({ marca: 'Libero' });
    expect((await deleteConCookie(`/api/articoli/${libero}`, cookie)).status).toBe(200);
    expect((await getConCookie(`/api/articoli/${libero}`, cookie)).status).toBe(404);
    expect((await audit('articolo_eliminato'))[0]?.dettaglio).toBe(`#${libero} Libero`);
    const usato = await creaArticolo({ marca: 'Usato' });
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
    const id = await creaArticolo();
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

describe('categorie materiale', () => {
  it('le API delle categorie non esistono più', async () => {
    const cookie = await cookieUtente();
    expect((await getConCookie('/api/categorie', cookie)).status).toBe(404);
    const tabella = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'categorie'").first();
    expect(tabella).toBeNull();
  });
});
