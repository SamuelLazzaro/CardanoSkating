/**
 * Test della vista mensile lato server: l'intervallo della griglia (le
 * settimane intere che contengono il mese) e i due endpoint di calendario, che
 * con `mese=AAAA-MM` devono restituire tutti gli slot di quella griglia —
 * giorni di riempimento delle settimane a cavallo compresi — restando anonimi
 * nel calendario pubblico ed esponendo società, colore e titolo in quello
 * admin.
 *
 * Le funzioni pure sono provate su date fisse; gli endpoint invece lavorano su
 * un mese calcolato da oggi, perché la prenotazione diretta rifiuta le date
 * passate e un mese scritto a mano scadrebbe con il tempo.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { intervalloCalendario, intervalloGrigliaMese, lunediDellaSettimana, meseSuccessivo, oraRoma } from '../src/slots';
import { cookieAdmin, getConCookie, postJson } from './helpers';

const oggi = oraRoma(new Date()).data;

/** Mese abbastanza in là da restare futuro anche a fine mese corrente. */
const MESE_FUTURO = meseSuccessivo(meseSuccessivo(oggi.slice(0, 7)));

/** Primo e ultimo giorno disegnati dalla griglia di MESE_FUTURO. */
const GRIGLIA = intervalloGrigliaMese(MESE_FUTURO);

/** Prenotazione diretta dell'admin: il modo più corto per occupare una fascia. */
async function prenota(cookie: string, societaId: number, data: string, oraInizio: string, oraFine: string): Promise<void> {
  const risposta = await postJson('/api/admin/prenotazioni', cookie, {
    societa_id: societaId,
    data,
    ora_inizio: oraInizio,
    ora_fine: oraFine,
  });
  expect(risposta.status).toBe(201);
}

/** Crea una società con colore e ritorna il suo id. */
async function creaSocietaColorata(cookie: string, nome: string, colore: string): Promise<number> {
  const risposta = await postJson('/api/admin/societa', cookie, {
    nome,
    referente: 'Referente',
    email: `${nome.replace(/\s+/g, '.').toLowerCase()}@example.com`,
    tariffa_oraria: 20,
    colore,
  });
  expect(risposta.status).toBe(201);
  const { id } = (await risposta.json()) as { id: number };
  return id;
}

describe('intervalloGrigliaMese', () => {
  it('estende il mese alle settimane intere che lo contengono', () => {
    // Settembre 2026: l'1 è un martedì (lunedì 31/08), il 30 un mercoledì
    // (domenica 04/10).
    expect(intervalloGrigliaMese('2026-09')).toEqual({ dal: '2026-08-31', al: '2026-10-04' });
  });

  it('lascia il mese intatto quando inizia di lunedì e finisce di domenica', () => {
    // Febbraio 2027: 1 febbraio lunedì, 28 febbraio domenica → 4 settimane secche.
    expect(intervalloGrigliaMese('2027-02')).toEqual({ dal: '2027-02-01', al: '2027-02-28' });
  });

  it('gestisce il cambio di anno', () => {
    // Dicembre 2026: 1 martedì (lunedì 30/11), 31 giovedì (domenica 03/01/2027).
    expect(intervalloGrigliaMese('2026-12')).toEqual({ dal: '2026-11-30', al: '2027-01-03' });
  });

  it('copre sempre da 4 a 6 settimane intere', () => {
    for (const mese of ['2026-01', '2026-02', '2026-08', '2026-09', '2027-02', '2028-02']) {
      const { dal, al } = intervalloGrigliaMese(mese);
      const giorni = (Date.parse(`${al}T00:00:00Z`) - Date.parse(`${dal}T00:00:00Z`)) / 86_400_000 + 1;
      expect(giorni % 7).toBe(0);
      expect(giorni).toBeGreaterThanOrEqual(28);
      expect(giorni).toBeLessThanOrEqual(42);
    }
  });
});

describe('intervalloCalendario', () => {
  const istante = new Date('2026-09-16T10:00:00Z'); // mercoledì

  it('senza parametri usa la settimana corrente', () => {
    expect(intervalloCalendario(undefined, undefined, istante)).toEqual({
      tipo: 'settimana',
      lunedi: '2026-09-14',
      dal: '2026-09-14',
      al: '2026-09-20',
    });
  });

  it('normalizza una data qualsiasi al lunedì della sua settimana', () => {
    expect(intervalloCalendario('2026-09-20', undefined, istante)).toMatchObject({ tipo: 'settimana', lunedi: '2026-09-14' });
  });

  it('con mese ignora settimana e restituisce la griglia mensile', () => {
    expect(intervalloCalendario('2026-09-20', '2026-09', istante)).toEqual({
      tipo: 'mese',
      mese: '2026-09',
      dal: '2026-08-31',
      al: '2026-10-04',
    });
  });

  it('rifiuta parametri malformati indicando quale', () => {
    expect(intervalloCalendario('20-09-2026', undefined, istante)).toMatchObject({ tipo: 'errore' });
    expect(intervalloCalendario(undefined, '2026-13', istante)).toMatchObject({ tipo: 'errore' });
    expect(intervalloCalendario(undefined, '2026-9', istante)).toMatchObject({ tipo: 'errore' });
  });
});

describe('endpoint di calendario con ?mese=', () => {
  it('il calendario pubblico copre tutta la griglia e resta anonimo', async () => {
    const cookieAmm = await cookieAdmin();
    const societaId = await creaSocietaColorata(cookieAmm, 'ASD Mensile', '#cc0011');
    const giornoCentrale = `${MESE_FUTURO}-15`;
    // I due estremi della griglia cadono nelle settimane a cavallo: se tornano
    // indietro, il range copre le settimane intere e non il mese secco.
    await prenota(cookieAmm, societaId, GRIGLIA.dal, '20:00', '20:30');
    await prenota(cookieAmm, societaId, giornoCentrale, '18:00', '19:00');
    await prenota(cookieAmm, societaId, GRIGLIA.al, '09:00', '09:30');

    const risposta = await app.request(`/api/calendario?mese=${MESE_FUTURO}`, {}, env);
    expect(risposta.status).toBe(200);
    const testo = await risposta.text();
    const corpo = JSON.parse(testo) as { mese: string; dal: string; al: string; slot_occupati: string[] };
    expect(corpo.mese).toBe(MESE_FUTURO);
    expect(corpo.dal).toBe(GRIGLIA.dal);
    expect(corpo.al).toBe(GRIGLIA.al);
    expect(corpo.slot_occupati).toEqual([
      `${GRIGLIA.dal}_2000`,
      `${giornoCentrale}_1800`,
      `${giornoCentrale}_1830`,
      `${GRIGLIA.al}_0900`,
    ]);
    // Anonimato: nessun dato della società nemmeno nella vista mensile.
    expect(testo).not.toContain('#cc0011');
    expect(testo).not.toContain('ASD Mensile');
    expect(Object.keys(corpo).sort()).toEqual(['al', 'dal', 'mese', 'slot_occupati']);
  });

  it('il calendario admin espone società, colore e titolo di ogni slot del mese', async () => {
    const cookieAmm = await cookieAdmin();
    const societaId = await creaSocietaColorata(cookieAmm, 'ASD Admin Mese', '#00aabb');
    const giorno = `${MESE_FUTURO}-10`;
    await prenota(cookieAmm, societaId, giorno, '18:00', '19:00');

    const risposta = await getConCookie(`/api/admin/calendario?mese=${MESE_FUTURO}`, cookieAmm);
    expect(risposta.status).toBe(200);
    const corpo = (await risposta.json()) as {
      mese: string;
      dal: string;
      al: string;
      prenotazioni: { slot_key: string; societa: string; colore: string; titolo: string }[];
    };
    expect(corpo.mese).toBe(MESE_FUTURO);
    expect(corpo.dal).toBe(GRIGLIA.dal);
    expect(corpo.al).toBe(GRIGLIA.al);
    expect(corpo.prenotazioni.map((p) => p.slot_key)).toEqual([`${giorno}_1800`, `${giorno}_1830`]);
    expect(corpo.prenotazioni.every((p) => p.societa === 'ASD Admin Mese')).toBe(true);
    expect(corpo.prenotazioni.every((p) => p.colore === '#00aabb' && p.titolo === 'Allenamento')).toBe(true);
  });

  it('risponde 400 a un mese non valido, su entrambi gli endpoint', async () => {
    const pubblico = await app.request('/api/calendario?mese=2026-13', {}, env);
    expect(pubblico.status).toBe(400);
    const amministrativo = await getConCookie('/api/admin/calendario?mese=marzo', await cookieAdmin());
    expect(amministrativo.status).toBe(400);
  });

  it('senza mese la risposta resta quella settimanale di sempre', async () => {
    const giorno = `${MESE_FUTURO}-15`;
    const pubblico = await app.request(`/api/calendario?settimana=${giorno}`, {}, env);
    const corpoPubblico = (await pubblico.json()) as Record<string, unknown>;
    expect(Object.keys(corpoPubblico).sort()).toEqual(['settimana', 'slot_occupati']);
    expect(corpoPubblico.settimana).toBe(lunediDellaSettimana(giorno));

    const amministrativo = await getConCookie(`/api/admin/calendario?settimana=${giorno}`, await cookieAdmin());
    const corpoAdmin = (await amministrativo.json()) as Record<string, unknown>;
    expect(Object.keys(corpoAdmin).sort()).toEqual(['prenotazioni', 'settimana']);
    expect(corpoAdmin.settimana).toBe(lunediDellaSettimana(giorno));
  });
});
