/**
 * Test di integrazione sugli articoli: inserimento con validazione, elenco con
 * filtri, scheda, eliminazione (fisica e logica) con ripristino e QR code.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { patternRicerca } from '../src/util';
import { audit, cookieUtente, creaArticolo, creaAtleta, deleteConCookie, getConCookie, postJson, UTENTE_TEST } from './helpers';

const NUOVO = { disciplina: 'Corsa', categoria: 'Ruote', marca: 'Matter', modello: 'Ruota 110 mm', quantita: 8 };

describe('inserimento articoli', () => {
  it('crea un articolo con giacenza piena e stato Buono di default e lo registra in audit', async () => {
    const cookie = await cookieUtente();
    const risposta = await postJson('/api/articoli', cookie, NUOVO);
    expect(risposta.status).toBe(201);
    const { id } = (await risposta.json()) as { id: number };
    const scheda = await getConCookie(`/api/articoli/${id}`, cookie);
    expect(scheda.status).toBe(200);
    const { articolo } = (await scheda.json()) as { articolo: Record<string, unknown> };
    expect(articolo).toMatchObject({ disciplina: 'Corsa', categoria: 'Ruote', marca: 'Matter', modello: 'Ruota 110 mm', taglia: null, quantita: 8, disponibili: 8, stato: 'Buono', note: null });
    for (const campoTolto of ['codice', 'descrizione', 'seriale', 'valore']) expect(articolo).not.toHaveProperty(campoTolto);
    expect((await audit('articolo_creato'))[0]).toEqual({ attore: UTENTE_TEST, dettaglio: `#${id} Matter Ruota 110 mm (Corsa)` });
  });

  it('senza quantità la giacenza è 1; stato, taglia e note indicati vengono salvati', async () => {
    const cookie = await cookieUtente();
    const risposta = await postJson('/api/articoli', cookie, { ...NUOVO, quantita: undefined, stato: 'Usurato', taglia: ' 42 ', note: 'seconda mano' });
    const { id } = (await risposta.json()) as { id: number };
    const { articolo } = (await (await getConCookie(`/api/articoli/${id}`, cookie)).json()) as { articolo: Record<string, unknown> };
    expect(articolo).toMatchObject({ quantita: 1, disponibili: 1, stato: 'Usurato', taglia: '42', note: 'seconda mano' });
  });

  it('categoria e marca sono obbligatorie, il modello no', async () => {
    const cookie = await cookieUtente();
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, categoria: '' })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, categoria: undefined })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, marca: '' })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, marca: undefined })).status).toBe(400);
    expect((await postJson('/api/articoli', cookie, { ...NUOVO, marca: 'x'.repeat(121) })).status).toBe(400);
    const soloMarca = await postJson('/api/articoli', cookie, { disciplina: 'Ghiaccio', categoria: 'Pattini', marca: 'Edea' });
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
  it('ordina per magazzino, categoria, marca e modello; filtra per magazzino e per testo libero su marca e modello', async () => {
    const cookie = await cookieUtente();
    await creaArticolo({ disciplina: 'Ghiaccio', categoria: 'Lame', marca: 'Wilson', modello: 'Gold Seal' });
    await creaArticolo({ disciplina: 'Corsa', categoria: 'Pattini', marca: 'Powerslide', modello: 'Telaio 3x110' });
    await creaArticolo({ disciplina: 'Corsa', categoria: 'Ruote', marca: 'Bont', modello: null });
    const nomi = (lista: { articoli: { marca: string }[] }) => lista.articoli.map((a) => a.marca);
    const tutti = (await (await getConCookie('/api/articoli', cookie)).json()) as { articoli: { marca: string }[] };
    // Corsa prima di Ghiaccio; dentro Corsa la categoria Pattini precede Ruote
    expect(nomi(tutti)).toEqual(['Powerslide', 'Bont', 'Wilson']);
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
  it('elimina fisicamente un articolo senza movimenti; con storico non Fuori uso risponde 409 e lo lascia', async () => {
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

  it('con storico e Fuori uso rifiuta finché un pezzo è consegnato, poi elimina logicamente', async () => {
    const cookie = await cookieUtente();
    const id = await creaArticolo({ marca: 'Rotto', quantita: 2 });
    const atleta = await creaAtleta();
    await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: id, atleta_id: atleta, quantita: 1 });
    await env.DB.prepare(`UPDATE articoli SET stato = 'Fuori uso' WHERE id = ?1`).bind(id).run();
    const inConsegna = await deleteConCookie(`/api/articoli/${id}`, cookie);
    expect(inConsegna.status).toBe(409);
    expect(((await inConsegna.json()) as { errore: string }).errore).toContain('consegnato');
    await postJson('/api/movimenti', cookie, { tipo: 'RESTITUZIONE', articolo_id: id, atleta_id: atleta, quantita: 1 });
    expect((await deleteConCookie(`/api/articoli/${id}`, cookie)).status).toBe(200);
    expect((await audit('articolo_eliminato'))[0]?.dettaglio).toBe(`#${id} Rotto (con storico)`);
    // sparisce dall'elenco e dal riepilogo, resta nella scheda, negli eliminati e nello storico
    const elenco = (await (await getConCookie('/api/articoli', cookie)).json()) as { articoli: { id: number }[] };
    expect(elenco.articoli.map((a) => a.id)).not.toContain(id);
    const riepilogo = (await (await getConCookie('/api/riepilogo', cookie)).json()) as { totali: { articoli: number } };
    expect(riepilogo.totali.articoli).toBe(0);
    const scheda = (await (await getConCookie(`/api/articoli/${id}`, cookie)).json()) as { articolo: { eliminato_at: string | null } };
    expect(scheda.articolo.eliminato_at).not.toBeNull();
    const eliminati = (await (await getConCookie('/api/articoli/eliminati', cookie)).json()) as { articoli: { id: number }[] };
    expect(eliminati.articoli.map((a) => a.id)).toEqual([id]);
    const storico = (await (await getConCookie('/api/movimenti', cookie)).json()) as { movimenti: { articolo_id: number }[] };
    expect(storico.movimenti.filter((m) => m.articolo_id === id)).toHaveLength(2);
    // niente movimenti né seconda eliminazione su un articolo eliminato
    expect((await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: id, quantita: 1 })).status).toBe(400);
    expect((await deleteConCookie(`/api/articoli/${id}`, cookie)).status).toBe(409);
  });

  it('ripristina un articolo eliminato logicamente; 409 se non è eliminato, 404 se non esiste', async () => {
    const cookie = await cookieUtente();
    const id = await creaArticolo({ marca: 'Tornato', quantita: 1, stato: 'Fuori uso' });
    await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: id, quantita: 1 });
    expect((await postJson(`/api/articoli/${id}/ripristina`, cookie)).status).toBe(409);
    expect((await deleteConCookie(`/api/articoli/${id}`, cookie)).status).toBe(200);
    expect((await postJson(`/api/articoli/${id}/ripristina`, cookie)).status).toBe(200);
    expect((await audit('articolo_ripristinato'))[0]?.dettaglio).toBe(`#${id} Tornato`);
    const elenco = (await (await getConCookie('/api/articoli', cookie)).json()) as { articoli: { id: number; eliminato_at: string | null; stato: string }[] };
    expect(elenco.articoli.find((a) => a.id === id)).toMatchObject({ eliminato_at: null, stato: 'Fuori uso' });
    const eliminati = (await (await getConCookie('/api/articoli/eliminati', cookie)).json()) as { articoli: unknown[] };
    expect(eliminati.articoli).toEqual([]);
    expect((await postJson('/api/articoli/9999/ripristina', cookie)).status).toBe(404);
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
