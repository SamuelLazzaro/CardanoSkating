/**
 * Test su tariffe e report mensile (migrazione 0007): validazione della
 * tariffa, ore e importi corretti su dati noti (una query aggregata per
 * società), esclusione delle prenotazioni fuori mese, export CSV per Excel
 * italiano (BOM, ';', virgola decimale, quoting dei nomi) e riservatezza
 * (la tariffa non compare mai nell'area società).
 *
 * Il mese osservato è 2031-03 (futuro rispetto all'orologio reale: le
 * prenotazioni dirette rifiutano le date passate).
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { cookieAdmin, cookieSocieta, creaSocietaConToken, getConCookie, postJson } from './helpers';

const MESE = '2031-03';

type RigaReport = { societa_id: number; societa: string; tariffa_oraria: number; ore: number; importo: number };
type CorpoReport = { mese: string; righe: RigaReport[]; totale: { ore: number; importo: number } };

async function patchSocieta(id: number, cookie: string, corpo: unknown): Promise<Response> {
  return await app.request(
    `/api/admin/societa/${id}`,
    { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) },
    env,
  );
}

/** Società + tariffa + prenotazioni dirette note nel mese osservato (e una fuori). */
async function scenarioNoto(cookieAmm: string): Promise<{ idAlfa: number; idBeta: number }> {
  const alfa = await postJson('/api/admin/societa', cookieAmm, { nome: 'ASD Alfa', referente: 'A', email: 'alfa@example.com' });
  const { id: idAlfa } = (await alfa.json()) as { id: number };
  const beta = await postJson('/api/admin/societa', cookieAmm, { nome: 'ASD Beta', referente: 'B', email: 'beta@example.com' });
  const { id: idBeta } = (await beta.json()) as { id: number };
  expect((await patchSocieta(idAlfa, cookieAmm, { tariffa_oraria: 20 })).status).toBe(200);
  expect((await patchSocieta(idBeta, cookieAmm, { tariffa_oraria: 12.5 })).status).toBe(200);

  // Alfa: 3h + 1h30 nel mese; Beta: 1h nel mese; Alfa: 2h nel mese successivo.
  const prenotazioni = [
    { societa_id: idAlfa, data: '2031-03-10', ora_inizio: '18:00', ora_fine: '21:00' },
    { societa_id: idAlfa, data: '2031-03-17', ora_inizio: '18:00', ora_fine: '19:30' },
    { societa_id: idBeta, data: '2031-03-11', ora_inizio: '10:00', ora_fine: '11:00' },
    { societa_id: idAlfa, data: '2031-04-01', ora_inizio: '18:00', ora_fine: '20:00' },
  ];
  for (const prenotazione of prenotazioni) {
    expect((await postJson('/api/admin/prenotazioni', cookieAmm, prenotazione)).status).toBe(201);
  }
  return { idAlfa, idBeta };
}

describe('tariffa oraria', () => {
  it('rifiuta valori non validi e resta fuori dalla creazione', async () => {
    const cookieAmm = await cookieAdmin();
    for (const tariffa of [-5, Number.NaN, 20000, '20']) {
      expect((await patchSocieta(1, cookieAmm, { tariffa_oraria: tariffa })).status).toBe(400);
    }
    // La creazione non legge la tariffa: parte sempre da 0 (campo separato).
    const creazione = await postJson('/api/admin/societa', cookieAmm, {
      nome: 'ASD Nuova', referente: 'R', email: 'nuova@example.com', tariffa_oraria: 99,
    });
    expect(creazione.status).toBe(201);
    const { id } = (await creazione.json()) as { id: number };
    const riga = await env.DB.prepare('SELECT tariffa_oraria FROM societa WHERE id = ?1').bind(id).first<{ tariffa_oraria: number }>();
    expect(riga?.tariffa_oraria).toBe(0);
  });

  it('non compare mai nella risposta dell\'area società', async () => {
    const { token } = await creaSocietaConToken();
    const cookieSoc = await cookieSocieta(token);
    const profilo = await getConCookie('/api/societa/me', cookieSoc);
    expect(profilo.status).toBe(200);
    expect(await profilo.text()).not.toContain('tariffa');
  });
});

describe('report mensile', () => {
  it('valida il parametro mese', async () => {
    const cookieAmm = await cookieAdmin();
    for (const percorso of ['/api/admin/report', '/api/admin/report?mese=2031-13', '/api/admin/report?mese=03-2031', '/api/admin/report.csv?mese=2031-3']) {
      expect((await getConCookie(percorso, cookieAmm)).status).toBe(400);
    }
  });

  it('calcola ore e importi corretti su dati noti, escludendo i mesi diversi', async () => {
    const cookieAmm = await cookieAdmin();
    const { idAlfa, idBeta } = await scenarioNoto(cookieAmm);

    const risposta = await getConCookie(`/api/admin/report?mese=${MESE}`, cookieAmm);
    expect(risposta.status).toBe(200);
    const corpo = (await risposta.json()) as CorpoReport;

    const alfa = corpo.righe.find((r) => r.societa_id === idAlfa);
    const beta = corpo.righe.find((r) => r.societa_id === idBeta);
    expect(alfa).toMatchObject({ societa: 'ASD Alfa', tariffa_oraria: 20, ore: 4.5, importo: 90 });
    expect(beta).toMatchObject({ societa: 'ASD Beta', tariffa_oraria: 12.5, ore: 1, importo: 12.5 });
    // Solo le due società con prenotazioni nel mese; l'aprile di Alfa è fuori.
    expect(corpo.righe.length).toBe(2);
    expect(corpo.totale).toEqual({ ore: 5.5, importo: 102.5 });
  });

  it('esporta il CSV per Excel italiano: BOM, ";", virgola decimale e attachment', async () => {
    const cookieAmm = await cookieAdmin();
    await scenarioNoto(cookieAmm);
    // Nome con separatore e virgolette: il campo va quotato con raddoppio.
    const strana = await postJson('/api/admin/societa', cookieAmm, {
      nome: 'ASD; "Strana"', referente: 'S', email: 'strana@example.com',
    });
    const { id: idStrana } = (await strana.json()) as { id: number };
    await postJson('/api/admin/prenotazioni', cookieAmm, {
      societa_id: idStrana, data: '2031-03-20', ora_inizio: '09:00', ora_fine: '09:30',
    });

    const risposta = await getConCookie(`/api/admin/report.csv?mese=${MESE}`, cookieAmm);
    expect(risposta.status).toBe(200);
    expect(risposta.headers.get('content-type')).toContain('text/csv');
    expect(risposta.headers.get('content-disposition')).toBe(`attachment; filename="report-${MESE}.csv"`);

    const testo = await risposta.text();
    expect(testo.startsWith('\ufeff')).toBe(true);
    const righe = testo.slice(1).trimEnd().split('\r\n');
    expect(righe[0]).toBe('Data;Società;Inizio;Fine;Ore;Tariffa;Importo');
    // Una riga per prenotazione del mese (aprile escluso), in ordine di data.
    expect(righe.length).toBe(1 + 4);
    expect(righe).toContain('10/03/2031;ASD Alfa;18:00;21:00;3,0;20,00;60,00');
    expect(righe).toContain('17/03/2031;ASD Alfa;18:00;19:30;1,5;20,00;30,00');
    expect(righe).toContain('11/03/2031;ASD Beta;10:00;11:00;1,0;12,50;12,50');
    expect(righe).toContain('20/03/2031;"ASD; ""Strana""";09:00;09:30;0,5;0,00;0,00');
    expect(testo).not.toContain('01/04/2031');
  });
});
