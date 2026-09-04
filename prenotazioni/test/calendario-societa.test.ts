/**
 * Test dell'endpoint `GET /api/societa/calendario`: il calendario dell'area
 * società nomina la società di ogni slot prenotato (id, nome, colore) e l'id
 * della richiesta, come quello admin, ma NON espone titolo dell'attività né
 * note, che restano riservati alla società proprietaria e all'admin. Richiede
 * la sessione società e accetta gli stessi parametri degli altri calendari
 * (`settimana=AAAA-MM-GG` oppure `mese=AAAA-MM`).
 *
 * Le date sono calcolate rispetto a oggi, perché la prenotazione diretta
 * rifiuta le date passate.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { aggiungiGiorni, intervalloGrigliaMese, lunediDellaSettimana, meseSuccessivo, oraRoma } from '../src/slots';
import { cookieAdmin, cookieSocieta, getConCookie, postJson } from './helpers';

const oggi = oraRoma(new Date()).data;
const dataFutura = aggiungiGiorni(oggi, 7);
const lunediFuturo = lunediDellaSettimana(dataFutura);

/** Mese abbastanza in là da restare futuro anche a fine mese corrente. */
const MESE_FUTURO = meseSuccessivo(meseSuccessivo(oggi.slice(0, 7)));
const GRIGLIA = intervalloGrigliaMese(MESE_FUTURO);

const TITOLO_RISERVATO = 'Allenamento agonisti under 16';
const NOTA_RISERVATA = 'nota interna della società';

/** Campi che ogni slot del calendario società deve avere, e nient'altro. */
const CAMPI_SLOT = ['colore', 'richiesta_id', 'slot_key', 'societa', 'societa_id'];

type SlotSocieta = { slot_key: string; societa_id: number; societa: string; colore: string; richiesta_id: number };

/** Crea una società via API admin (così ha un colore) e ritorna id e token del link personale. */
async function creaSocietaColorata(cookieAmm: string, nome: string, colore: string): Promise<{ id: number; token: string }> {
  const risposta = await postJson('/api/admin/societa', cookieAmm, {
    nome,
    referente: 'Referente',
    email: `${nome.replace(/\s+/g, '.').toLowerCase()}@example.com`,
    tariffa_oraria: 20,
    colore,
  });
  expect(risposta.status).toBe(201);
  const { id, link_accesso } = (await risposta.json()) as { id: number; link_accesso: string };
  return { id, token: link_accesso.split('/accesso/')[1] };
}

/** Prenotazione diretta dell'admin, con titolo e note che non devono trapelare. */
async function prenota(cookieAmm: string, societaId: number, data: string, oraInizio: string, oraFine: string): Promise<number> {
  const risposta = await postJson('/api/admin/prenotazioni', cookieAmm, {
    societa_id: societaId,
    data,
    ora_inizio: oraInizio,
    ora_fine: oraFine,
    titolo: TITOLO_RISERVATO,
    note: NOTA_RISERVATA,
  });
  expect(risposta.status).toBe(201);
  const corpo = (await risposta.json()) as { richiesta_id: number };
  return corpo.richiesta_id;
}

describe('GET /api/societa/calendario', () => {
  it('senza sessione società risponde 401', async () => {
    const risposta = await app.request(`/api/societa/calendario?settimana=${lunediFuturo}`, {}, env);
    expect(risposta.status).toBe(401);
  });

  it('nomina la società di ogni slot, propria o altrui, senza titolo né note', async () => {
    const cookieAmm = await cookieAdmin();
    const mia = await creaSocietaColorata(cookieAmm, 'ASD Mia', '#11aa22');
    const altra = await creaSocietaColorata(cookieAmm, 'ASD Altra', '#cc0011');
    const richiestaMia = await prenota(cookieAmm, mia.id, dataFutura, '18:00', '19:00');
    const richiestaAltra = await prenota(cookieAmm, altra.id, dataFutura, '20:00', '20:30');

    const risposta = await getConCookie(`/api/societa/calendario?settimana=${dataFutura}`, await cookieSocieta(mia.token));
    expect(risposta.status).toBe(200);
    const testo = await risposta.text();
    const corpo = JSON.parse(testo) as { settimana: string; prenotazioni: SlotSocieta[] };
    expect(Object.keys(corpo).sort()).toEqual(['prenotazioni', 'settimana']);
    expect(corpo.settimana).toBe(lunediFuturo);

    expect(corpo.prenotazioni.map((p) => p.slot_key)).toEqual([
      `${dataFutura}_1800`,
      `${dataFutura}_1830`,
      `${dataFutura}_2000`,
    ]);
    for (const slot of corpo.prenotazioni) expect(Object.keys(slot).sort()).toEqual(CAMPI_SLOT);

    // Gli slot altrui portano nome, colore e id richiesta dell'altra società...
    const slotAltrui = corpo.prenotazioni[2];
    expect(slotAltrui).toEqual({
      slot_key: `${dataFutura}_2000`,
      societa_id: altra.id,
      societa: 'ASD Altra',
      colore: '#cc0011',
      richiesta_id: richiestaAltra,
    });
    // ...e i propri lo stesso, così il frontend li riconosce dall'id società.
    expect(corpo.prenotazioni[0]).toMatchObject({ societa_id: mia.id, societa: 'ASD Mia', colore: '#11aa22', richiesta_id: richiestaMia });

    // Riservatezza: né il titolo né le note escono dall'endpoint, per nessuno.
    expect(testo).not.toContain(TITOLO_RISERVATO);
    expect(testo).not.toContain(NOTA_RISERVATA);
    expect(testo).not.toContain('titolo');
    expect(testo).not.toContain('note');
  });

  it('con ?mese= copre tutta la griglia a settimane intere', async () => {
    const cookieAmm = await cookieAdmin();
    const mia = await creaSocietaColorata(cookieAmm, 'ASD Mensile Societa', '#3344ff');
    const altra = await creaSocietaColorata(cookieAmm, 'ASD Altra Mensile', '#ff4433');
    // Gli estremi della griglia cadono nelle settimane a cavallo del mese: se
    // tornano, il range copre le settimane intere e non il mese secco.
    await prenota(cookieAmm, altra.id, GRIGLIA.dal, '20:00', '20:30');
    await prenota(cookieAmm, mia.id, `${MESE_FUTURO}-15`, '18:00', '18:30');
    await prenota(cookieAmm, altra.id, GRIGLIA.al, '09:00', '09:30');

    const risposta = await getConCookie(`/api/societa/calendario?mese=${MESE_FUTURO}`, await cookieSocieta(mia.token));
    expect(risposta.status).toBe(200);
    const corpo = (await risposta.json()) as { mese: string; dal: string; al: string; prenotazioni: SlotSocieta[] };
    expect(Object.keys(corpo).sort()).toEqual(['al', 'dal', 'mese', 'prenotazioni']);
    expect(corpo.mese).toBe(MESE_FUTURO);
    expect(corpo.dal).toBe(GRIGLIA.dal);
    expect(corpo.al).toBe(GRIGLIA.al);
    expect(corpo.prenotazioni.map((p) => [p.slot_key, p.societa])).toEqual([
      [`${GRIGLIA.dal}_2000`, 'ASD Altra Mensile'],
      [`${MESE_FUTURO}-15_1800`, 'ASD Mensile Societa'],
      [`${GRIGLIA.al}_0900`, 'ASD Altra Mensile'],
    ]);
  });

  it('risponde 400 a parametri malformati', async () => {
    const cookieAmm = await cookieAdmin();
    const mia = await creaSocietaColorata(cookieAmm, 'ASD Parametri', '#123456');
    const cookieSoc = await cookieSocieta(mia.token);
    expect((await getConCookie('/api/societa/calendario?mese=2026-13', cookieSoc)).status).toBe(400);
    expect((await getConCookie('/api/societa/calendario?settimana=20-09-2026', cookieSoc)).status).toBe(400);
  });
});
