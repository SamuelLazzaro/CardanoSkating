/**
 * Test di integrazione sui movimenti: entrate, consegne e restituzioni con le
 * loro guardie, firma, storico con filtri, export CSV e riepilogo.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { campoCsv, dataItaliana } from '../src/csv';
import { dataCivile, oggiRoma } from '../src/util';
import { audit, cookieUtente, creaArticolo, creaAtleta, getConCookie, giacenza, postJson, UTENTE_TEST } from './helpers';

const FIRMA = `data:image/png;base64,${btoa('firma di prova')}`;

describe('entrata', () => {
  it('su articolo esistente aumenta totale e giacenza e registra l\'operatore', async () => {
    const cookie = await cookieUtente();
    const id = await creaArticolo({ quantita: 2 });
    const risposta = await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: id, quantita: 3, note: 'ordine settembre' });
    expect(risposta.status).toBe(201);
    expect(await risposta.json()).toMatchObject({ articolo_id: id, disciplina: 'Corsa' });
    expect(await giacenza(id)).toEqual({ quantita: 5, disponibili: 5, stato: 'Buono' });
    const riga = await env.DB.prepare('SELECT operatore, data, atleta_id, note FROM movimenti WHERE articolo_id = ?1').bind(id).first();
    expect(riga).toEqual({ operatore: UTENTE_TEST, data: oggiRoma(), atleta_id: null, note: 'ordine settembre' });
    expect((await audit('entrata'))[0]?.attore).toBe(UTENTE_TEST);
  });

  it('con condizione aggiorna lo stato dell\'articolo', async () => {
    const cookie = await cookieUtente();
    const id = await creaArticolo({ quantita: 1, stato: 'Usurato' });
    await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: id, quantita: 1, condizione: 'Nuovo' });
    expect((await giacenza(id)).stato).toBe('Nuovo');
  });

  it('con nuovo_articolo crea l\'articolo con la quantità entrata e stato Nuovo', async () => {
    const cookie = await cookieUtente();
    const nuovoArticolo = { codice: 'NEW-1', disciplina: 'Ghiaccio', categoria: 'Lame', descrizione: 'Lama MK', valore: 99 };
    const risposta = await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', nuovo_articolo: nuovoArticolo, quantita: 4, data: '2026-09-01' });
    expect(risposta.status).toBe(201);
    const { articolo_id, disciplina } = (await risposta.json()) as { articolo_id: number; disciplina: string };
    expect(disciplina).toBe('Ghiaccio');
    expect(await giacenza(articolo_id)).toEqual({ quantita: 4, disponibili: 4, stato: 'Nuovo' });
    const movimento = await env.DB.prepare('SELECT tipo, quantita, data FROM movimenti WHERE articolo_id = ?1').bind(articolo_id).first();
    expect(movimento).toEqual({ tipo: 'ENTRATA', quantita: 4, data: '2026-09-01' });
    const doppione = await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', nuovo_articolo: nuovoArticolo, quantita: 1 });
    expect(doppione.status).toBe(409);
    const incompleto = await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', nuovo_articolo: { codice: 'NEW-2' }, quantita: 1 });
    expect(incompleto.status).toBe(400);
  });

  it('senza articolo (né esistente né nuovo) risponde 400', async () => {
    const cookie = await cookieUtente();
    expect((await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', quantita: 1 })).status).toBe(400);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: 9999, quantita: 1 })).status).toBe(400);
  });
});

describe('validazione comune', () => {
  it('rifiuta tipo, quantità, data e condizione non validi', async () => {
    const cookie = await cookieUtente();
    const id = await creaArticolo();
    expect((await postJson('/api/movimenti', cookie, { tipo: 'PRESTITO', articolo_id: id, quantita: 1 })).status).toBe(400);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: id, quantita: 0 })).status).toBe(400);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: id, quantita: '3' })).status).toBe(400);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: id, quantita: 1, data: '2026-02-31' })).status).toBe(400);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: id, quantita: 1, data: '01/09/2026' })).status).toBe(400);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: id, quantita: 1, condizione: 'Rotto' })).status).toBe(400);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: id, quantita: 1, note: 'x'.repeat(1001) })).status).toBe(400);
  });

  it('dataCivile accetta solo giorni esistenti nel formato ISO', () => {
    expect(dataCivile('2026-02-28')).toBe('2026-02-28');
    expect(dataCivile('2026-02-29')).toBeNull();
    expect(dataCivile('2028-02-29')).toBe('2028-02-29');
    expect(dataCivile('2026-13-01')).toBeNull();
    expect(dataCivile(20260901)).toBeNull();
  });
});

describe('consegna', () => {
  it('scala la giacenza, salva atleta e firma; la firma non compare nello storico', async () => {
    const cookie = await cookieUtente();
    const id = await creaArticolo({ quantita: 3 });
    const atleta = await creaAtleta('Sara Neri');
    const risposta = await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: id, atleta_id: atleta, quantita: 2, firma: FIRMA, condizione: 'Buono' });
    expect(risposta.status).toBe(201);
    expect(await giacenza(id)).toMatchObject({ quantita: 3, disponibili: 1 });
    const salvato = await env.DB.prepare('SELECT firma, atleta_id, condizione FROM movimenti WHERE articolo_id = ?1').bind(id).first();
    expect(salvato).toEqual({ firma: FIRMA, atleta_id: atleta, condizione: 'Buono' });
    const storico = (await (await getConCookie('/api/movimenti', cookie)).json()) as { movimenti: Record<string, unknown>[] };
    expect(storico.movimenti[0]).toMatchObject({ tipo: 'CONSEGNA', atleta: 'Sara Neri', firma_presente: true, quantita: 2 });
    expect('firma' in storico.movimenti[0]).toBe(false);
  });

  it('richiede un atleta esistente e attivo', async () => {
    const cookie = await cookieUtente();
    const id = await creaArticolo();
    const disattivato = await creaAtleta('Ex Atleta', false);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: id, quantita: 1 })).status).toBe(400);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: id, atleta_id: 9999, quantita: 1 })).status).toBe(404);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: id, atleta_id: disattivato, quantita: 1 })).status).toBe(400);
    expect((await giacenza(id)).disponibili).toBe(5);
  });

  it('oltre la giacenza risponde 409 senza scrivere nulla', async () => {
    const cookie = await cookieUtente();
    const id = await creaArticolo({ quantita: 2 });
    const atleta = await creaAtleta();
    const risposta = await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: id, atleta_id: atleta, quantita: 3 });
    expect(risposta.status).toBe(409);
    expect((await giacenza(id)).disponibili).toBe(2);
    const conteggio = await env.DB.prepare('SELECT COUNT(*) AS n FROM movimenti').first<{ n: number }>();
    expect(conteggio?.n).toBe(0);
    expect(await audit('consegna')).toEqual([]);
  });

  it('rifiuta una firma che non è un PNG in base64', async () => {
    const cookie = await cookieUtente();
    const id = await creaArticolo();
    const atleta = await creaAtleta();
    const risposta = await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: id, atleta_id: atleta, quantita: 1, firma: 'data:text/html;base64,PHNjcmlwdD4=' });
    expect(risposta.status).toBe(400);
  });
});

describe('restituzione', () => {
  it('ripristina la giacenza, aggiorna lo stato e non supera il materiale in possesso', async () => {
    const cookie = await cookieUtente();
    const id = await creaArticolo({ quantita: 4 });
    const atleta = await creaAtleta();
    const altro = await creaAtleta('Altro Atleta');
    await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: id, atleta_id: atleta, quantita: 3 });
    // l'altro atleta non ha nulla in mano: non può restituire
    expect((await postJson('/api/movimenti', cookie, { tipo: 'RESTITUZIONE', articolo_id: id, atleta_id: altro, quantita: 1 })).status).toBe(409);
    // più di quanto consegnato: 409
    expect((await postJson('/api/movimenti', cookie, { tipo: 'RESTITUZIONE', articolo_id: id, atleta_id: atleta, quantita: 4 })).status).toBe(409);
    expect((await giacenza(id)).disponibili).toBe(1);
    const parziale = await postJson('/api/movimenti', cookie, { tipo: 'RESTITUZIONE', articolo_id: id, atleta_id: atleta, quantita: 2, condizione: 'Da riparare', firma: FIRMA });
    expect(parziale.status).toBe(201);
    expect(await giacenza(id)).toEqual({ quantita: 4, disponibili: 3, stato: 'Da riparare' });
    // resta 1 pezzo in mano: restituirne 2 non si può, 1 sì
    expect((await postJson('/api/movimenti', cookie, { tipo: 'RESTITUZIONE', articolo_id: id, atleta_id: atleta, quantita: 2 })).status).toBe(409);
    expect((await postJson('/api/movimenti', cookie, { tipo: 'RESTITUZIONE', articolo_id: id, atleta_id: atleta, quantita: 1 })).status).toBe(201);
    expect((await giacenza(id)).disponibili).toBe(4);
    const conteggio = await env.DB.prepare('SELECT COUNT(*) AS n FROM movimenti WHERE articolo_id = ?1').bind(id).first<{ n: number }>();
    expect(conteggio?.n).toBe(3);
  });
});

describe('storico ed export', () => {
  it('lo storico è ordinato per data decrescente, filtrabile per magazzino, testo e limite', async () => {
    const cookie = await cookieUtente();
    const corsa = await creaArticolo({ codice: 'C-9', disciplina: 'Corsa', descrizione: 'Ruote 100' });
    const ghiaccio = await creaArticolo({ codice: 'G-9', disciplina: 'Ghiaccio', descrizione: 'Lame' });
    await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: corsa, quantita: 1, data: '2026-09-10' });
    await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: ghiaccio, quantita: 1, data: '2026-09-12' });
    await postJson('/api/movimenti', cookie, { tipo: 'ENTRATA', articolo_id: corsa, quantita: 2, data: '2026-09-11' });
    const tutti = (await (await getConCookie('/api/movimenti', cookie)).json()) as { movimenti: { data: string; codice: string }[] };
    expect(tutti.movimenti.map((m) => m.data)).toEqual(['2026-09-12', '2026-09-11', '2026-09-10']);
    const soloCorsa = (await (await getConCookie('/api/movimenti?disciplina=Corsa', cookie)).json()) as { movimenti: { codice: string }[] };
    expect(soloCorsa.movimenti.map((m) => m.codice)).toEqual(['C-9', 'C-9']);
    const perTesto = (await (await getConCookie('/api/movimenti?q=lame', cookie)).json()) as { movimenti: { codice: string }[] };
    expect(perTesto.movimenti.map((m) => m.codice)).toEqual(['G-9']);
    const ultimo = (await (await getConCookie('/api/movimenti?limite=1', cookie)).json()) as { movimenti: unknown[] };
    expect(ultimo.movimenti).toHaveLength(1);
  });

  it('il CSV ha BOM, separatore ";", date italiane e campi protetti', async () => {
    const cookie = await cookieUtente();
    const id = await creaArticolo({ codice: 'CSV-1', descrizione: 'Body; "gara"', taglia: 'M' });
    const atleta = await creaAtleta('Elena Rossi');
    await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: id, atleta_id: atleta, quantita: 1, data: '2026-03-05', note: 'riga uno\nriga due' });
    const risposta = await getConCookie('/api/movimenti/export.csv', cookie);
    expect(risposta.status).toBe(200);
    expect(risposta.headers.get('content-type')).toContain('text/csv');
    expect(risposta.headers.get('content-disposition')).toContain('movimenti_magazzino.csv');
    const testo = await risposta.text();
    expect(testo.charCodeAt(0)).toBe(0xfeff);
    const righe = testo.slice(1).split('\r\n').filter((r) => r !== '');
    expect(righe[0]).toBe('ID;Data;Tipo;Disciplina;Quantità;Codice;Materiale;Taglia;Atleta;Stato;Note;Operatore');
    expect(righe[1]).toBe(`1;05/03/2026;CONSEGNA;Corsa;1;CSV-1;"Body; ""gara""";M;Elena Rossi;;"riga uno\nriga due";${UTENTE_TEST}`);
  });

  it('campoCsv e dataItaliana', () => {
    expect(campoCsv(null)).toBe('');
    expect(campoCsv(12)).toBe('12');
    expect(campoCsv('semplice')).toBe('semplice');
    expect(campoCsv('con;punto e virgola')).toBe('"con;punto e virgola"');
    expect(campoCsv('con "virgolette"')).toBe('"con ""virgolette"""');
    expect(dataItaliana('2026-09-24')).toBe('24/09/2026');
  });
});

describe('riepilogo', () => {
  it('somma pezzi, giacenze, consegnati e da riparare per magazzino e in totale', async () => {
    const cookie = await cookieUtente();
    const vuoto = (await (await getConCookie('/api/riepilogo', cookie)).json()) as { totali: Record<string, number>; magazzini: Record<string, Record<string, number>> };
    expect(vuoto.totali).toEqual({ articoli: 0, disponibili: 0, assegnati: 0, da_riparare: 0, atleti_attivi: 0, movimenti: 0 });
    expect(vuoto.magazzini.Ghiaccio).toEqual({ articoli: 0, disponibili: 0, assegnati: 0, da_riparare: 0 });
    const pattini = await creaArticolo({ disciplina: 'Corsa', quantita: 6 });
    await creaArticolo({ disciplina: 'Corsa', quantita: 1, stato: 'Fuori uso' });
    await creaArticolo({ disciplina: 'Ghiaccio', quantita: 3, stato: 'Da riparare' });
    const atleta = await creaAtleta('Attivo Uno');
    await creaAtleta('Ex Due', false);
    await postJson('/api/movimenti', cookie, { tipo: 'CONSEGNA', articolo_id: pattini, atleta_id: atleta, quantita: 2 });
    const pieno = (await (await getConCookie('/api/riepilogo', cookie)).json()) as { totali: Record<string, number>; magazzini: Record<string, Record<string, number>> };
    expect(pieno.magazzini.Corsa).toEqual({ articoli: 7, disponibili: 5, assegnati: 2, da_riparare: 1 });
    expect(pieno.magazzini.Ghiaccio).toEqual({ articoli: 3, disponibili: 3, assegnati: 0, da_riparare: 1 });
    expect(pieno.totali).toEqual({ articoli: 10, disponibili: 8, assegnati: 2, da_riparare: 2, atleti_attivi: 1, movimenti: 1 });
    expect((await app.request('/api/riepilogo', {}, env)).status).toBe(401);
  });
});
