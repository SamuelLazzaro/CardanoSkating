/**
 * Test della parametrizzazione per struttura (palazzetto / circuito stradale):
 * lo stesso codice è pubblicato una volta per struttura con vars diverse
 * (wrangler.jsonc), e i punti che identificano la struttura — helper
 * strutturaDa, calendario ICS, nome del file ICS — devono seguirle.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { generaICS } from '../src/ics';
import { strutturaDa } from '../src/util';
import { aggiungiGiorni, oraRoma } from '../src/slots';
import { creaSocietaConToken } from './helpers';

const nomeOriginale = env.NOME_STRUTTURA;
const siglaOriginale = env.SIGLA_STRUTTURA;

afterEach(() => {
  env.NOME_STRUTTURA = nomeOriginale;
  env.SIGLA_STRUTTURA = siglaOriginale;
});

describe('strutturaDa', () => {
  it('legge nome e sigla dalle vars e deriva l\'etichetta con l\'iniziale maiuscola', () => {
    expect(strutturaDa({ NOME_STRUTTURA: 'Circuito stradale', SIGLA_STRUTTURA: 'circuito' })).toEqual({
      nome: 'Circuito stradale',
      sigla: 'circuito',
      etichetta: 'Circuito',
    });
  });

  it('senza vars ricade sul palazzetto (comportamento storico)', () => {
    expect(strutturaDa({})).toEqual({ nome: 'Palazzetto dello Sport', sigla: 'palazzetto', etichetta: 'Palazzetto' });
  });

  it('normalizza la sigla in minuscolo e scarta quelle non sicure per UID e nomi file', () => {
    expect(strutturaDa({ SIGLA_STRUTTURA: ' Circuito ' }).sigla).toBe('circuito');
    expect(strutturaDa({ SIGLA_STRUTTURA: 'pista/1' }).sigla).toBe('palazzetto');
    expect(strutturaDa({ SIGLA_STRUTTURA: '' }).sigla).toBe('palazzetto');
    expect(strutturaDa({ NOME_STRUTTURA: '   ' }).nome).toBe('Palazzetto dello Sport');
  });

  it('le vars del livello base di wrangler.jsonc, usate dai test, sono quelle del palazzetto', () => {
    expect(strutturaDa(env)).toEqual({ nome: 'Palazzetto dello Sport', sigla: 'palazzetto', etichetta: 'Palazzetto' });
  });
});

describe('GET /api/struttura', () => {
  it('risponde senza sessione con il solo nome ed etichetta della struttura', async () => {
    const risposta = await app.request('/api/struttura', {}, env);
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toEqual({ nome: 'Palazzetto dello Sport', sigla: 'palazzetto', etichetta: 'Palazzetto' });
  });

  it("segue le vars dell'istanza", async () => {
    env.NOME_STRUTTURA = 'Circuito stradale';
    env.SIGLA_STRUTTURA = 'circuito';
    const risposta = await app.request('/api/struttura', {}, env);
    expect(await risposta.json()).toEqual({ nome: 'Circuito stradale', sigla: 'circuito', etichetta: 'Circuito' });
  });
});

describe('calendario ICS per struttura', () => {
  const evento = { id: 7, data: '2027-01-15', ora_inizio: '18:00', ora_fine: '19:00', note: null };
  const adesso = new Date('2027-01-01T10:00:00Z');

  it('lo stesso id di richiesta produce UID diversi in strutture diverse', () => {
    const palazzetto = generaICS('ASD Rotelle', [evento], adesso, strutturaDa({ SIGLA_STRUTTURA: 'palazzetto' }));
    const circuito = generaICS('ASD Rotelle', [evento], adesso, strutturaDa({ SIGLA_STRUTTURA: 'circuito' }));
    expect(palazzetto).toContain('UID:richiesta-7@palazzetto.prenotazioni.cardanoskating');
    expect(circuito).toContain('UID:richiesta-7@circuito.prenotazioni.cardanoskating');
  });

  it('nome del calendario, PRODID e riepilogo evento nominano la struttura', () => {
    const ics = generaICS('ASD Rotelle', [evento], adesso, strutturaDa({ NOME_STRUTTURA: 'Circuito stradale', SIGLA_STRUTTURA: 'circuito' }));
    expect(ics).toContain('PRODID:-//Cardano Skating//Prenotazioni Circuito//IT');
    expect(ics).toContain('X-WR-CALNAME:Circuito — ASD Rotelle');
    expect(ics).toContain('SUMMARY:Allenamento circuito — ASD Rotelle');
    expect(ics).not.toContain('alazzetto');
  });

  it("l'endpoint /api/ics/:token usa la struttura dell'istanza per nome file e UID", async () => {
    env.NOME_STRUTTURA = 'Circuito stradale';
    env.SIGLA_STRUTTURA = 'circuito';
    const { id: societaId, token } = await creaSocietaConToken();
    const data = aggiungiGiorni(oraRoma(new Date()).data, 3);
    const esito = await env.DB
      .prepare("INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, stato) VALUES (?1, ?2, '18:00', '19:00', 'approvata')")
      .bind(societaId, data)
      .run();

    const risposta = await app.request(`/api/ics/${token}`, {}, env);
    expect(risposta.status).toBe(200);
    expect(risposta.headers.get('content-disposition')).toBe('inline; filename="circuito.ics"');
    const corpo = await risposta.text();
    expect(corpo).toContain(`UID:richiesta-${esito.meta.last_row_id}@circuito.prenotazioni.cardanoskating`);
  });
});
