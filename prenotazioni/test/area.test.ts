/**
 * Test di integrazione sul flusso dell'area società: radice del sito, accesso
 * via link personale, invio richieste (singole e ricorrenti) e annullamento.
 *
 * Le date sono calcolate rispetto a oggi (ora italiana) perché la creazione
 * di richieste rifiuta date passate o oltre un anno nel futuro.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { aggiungiGiorni, lunediDellaSettimana, oraRoma } from '../src/slots';
import {
  cookieAdmin,
  cookieSocieta,
  creaRichiesta,
  creaSocieta,
  creaSocietaConToken,
  getConCookie,
  postAdmin,
  postJson,
  slotDiRichiesta,
} from './helpers';

const oggi = oraRoma(new Date()).data;
const dataFutura = aggiungiGiorni(oggi, 7);
/** Un lunedì futuro (della settimana fra due settimane), per i test sui giorni della settimana. */
const lunediFuturo = lunediDellaSettimana(aggiungiGiorni(oggi, 14));

describe('accesso via link personale', () => {
  it('la radice manda all\'area società, che senza sessione spiega come entrare', async () => {
    const risposta = await app.request('/', {}, env);
    expect(risposta.status).toBe(302);
    expect(risposta.headers.get('location')).toBe('/area');
  });

  it('imposta il cookie di sessione e /me risponde con i dati della società', async () => {
    const { token } = await creaSocietaConToken('ASD Rotelle');
    const cookie = await cookieSocieta(token);
    const risposta = await getConCookie('/api/societa/me', cookie);
    expect(risposta.status).toBe(200);
    const corpo = (await risposta.json()) as { societa: { nome: string }; link_ics: string };
    expect(corpo.societa.nome).toBe('ASD Rotelle');
    expect(corpo.link_ics).toContain(`/api/ics/${token}`);
  });

  it('token inesistente: 404 e nessun cookie', async () => {
    const risposta = await app.request(`/accesso/${crypto.randomUUID()}`, {}, env);
    expect(risposta.status).toBe(404);
    expect(risposta.headers.get('set-cookie')).toBeNull();
  });

  it('senza sessione le API della società rispondono 401', async () => {
    const risposta = await app.request('/api/societa/richieste', {}, env);
    expect(risposta.status).toBe(401);
  });
});

describe('invio richieste dalla società', () => {
  it('crea una richiesta singola in attesa', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data: dataFutura,
      ora_inizio: '18:00',
      ora_fine: '19:30',
      note: 'allenamento di prova',
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as { tipo: string; id: number };
    expect(corpo.tipo).toBe('richiesta');
    const riga = await env.DB
      .prepare('SELECT stato, titolo, note FROM richieste WHERE id = ?1')
      .bind(corpo.id)
      .first<{ stato: string; titolo: string; note: string }>();
    expect(riga?.stato).toBe('in_attesa');
    expect(riga?.titolo).toBe('Allenamento'); // default quando il titolo non viene inviato
    expect(riga?.note).toBe('allenamento di prova');
  });

  it('salva un titolo attività personalizzato, sia sulla richiesta sia sulla ricorrenza', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);

    const singola = await postJson('/api/societa/richieste', cookie, {
      titolo: 'Corso principianti', data: dataFutura, ora_inizio: '17:00', ora_fine: '18:00',
    });
    expect(singola.status).toBe(201);
    const { id } = (await singola.json()) as { id: number };
    const richiesta = await env.DB.prepare('SELECT titolo FROM richieste WHERE id = ?1').bind(id).first<{ titolo: string }>();
    expect(richiesta?.titolo).toBe('Corso principianti');

    const ricorrente = await postJson('/api/societa/richieste', cookie, {
      titolo: 'Gara sociale', data: dataFutura, ora_inizio: '20:00', ora_fine: '21:00',
      ripeti_fino_al: aggiungiGiorni(dataFutura, 14),
    });
    expect(ricorrente.status).toBe(201);
    const { id: idRicorrenza } = (await ricorrente.json()) as { id: number };
    const ricorrenza = await env.DB.prepare('SELECT titolo FROM ricorrenze WHERE id = ?1').bind(idRicorrenza).first<{ titolo: string }>();
    expect(ricorrenza?.titolo).toBe('Gara sociale');
  });

  it('rifiuta un titolo attività oltre i 100 caratteri', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const risposta = await postJson('/api/societa/richieste', cookie, {
      titolo: 'x'.repeat(101), data: dataFutura, ora_inizio: '18:00', ora_fine: '19:00',
    });
    expect(risposta.status).toBe(400);
  });

  it('rifiuta orari non a passi di 30 minuti', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data: dataFutura,
      ora_inizio: '18:15',
      ora_fine: '19:00',
    });
    expect(risposta.status).toBe(400);
  });

  it('rifiuta una ripetizione oltre le 4 settimane', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data: dataFutura,
      ora_inizio: '18:00',
      ora_fine: '19:00',
      ripeti_fino_al: aggiungiGiorni(dataFutura, 28),
    });
    expect(risposta.status).toBe(400);
  });

  it('crea una ricorrenza con le occorrenze attese', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data: dataFutura,
      ora_inizio: '18:00',
      ora_fine: '19:00',
      ripeti_fino_al: aggiungiGiorni(dataFutura, 21),
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as { tipo: string; id: number; occorrenze: string[] };
    expect(corpo.tipo).toBe('ricorrenza');
    expect(corpo.occorrenze).toEqual([
      dataFutura,
      aggiungiGiorni(dataFutura, 7),
      aggiungiGiorni(dataFutura, 14),
      aggiungiGiorni(dataFutura, 21),
    ]);
    const riga = await env.DB.prepare('SELECT stato FROM ricorrenze WHERE id = ?1').bind(corpo.id).first<{ stato: string }>();
    expect(riga?.stato).toBe('in_attesa');
  });

  it('accetta una ripetizione fino a 4 settimane piene (27 giorni dopo la prima data)', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data: dataFutura,
      ora_inizio: '18:00',
      ora_fine: '19:00',
      ripeti_fino_al: aggiungiGiorni(dataFutura, 27),
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as { occorrenze: string[] };
    expect(corpo.occorrenze.length).toBe(4);
  });
});

describe('ricorrenze su più giorni della settimana', () => {
  it('senza ripetizione settimanale copre gli altri giorni della stessa settimana', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    // Lunedì scelto come data, più mercoledì (2) e venerdì (4).
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data: lunediFuturo,
      ora_inizio: '19:00',
      ora_fine: '20:30',
      giorni: [2, 4],
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as { tipo: string; id: number; occorrenze: string[] };
    expect(corpo.tipo).toBe('ricorrenza');
    expect(corpo.occorrenze).toEqual([lunediFuturo, aggiungiGiorni(lunediFuturo, 2), aggiungiGiorni(lunediFuturo, 4)]);

    // Il giorno della data scelta è incluso anche se non elencato; il periodo
    // si chiude alla domenica della stessa settimana.
    const riga = await env.DB
      .prepare('SELECT giorni, valida_dal, valida_al FROM ricorrenze WHERE id = ?1')
      .bind(corpo.id)
      .first<{ giorni: string; valida_dal: string; valida_al: string }>();
    expect(riga?.giorni).toBe('0,2,4');
    expect(riga?.valida_dal).toBe(lunediFuturo);
    expect(riga?.valida_al).toBe(aggiungiGiorni(lunediFuturo, 6));
  });

  it('con ripetizione settimanale ripete ogni giorno scelto per tutte le settimane', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    // Lunedì e giovedì (3) per 4 settimane piene.
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data: lunediFuturo,
      ora_inizio: '19:00',
      ora_fine: '20:30',
      giorni: [3],
      ripeti_fino_al: aggiungiGiorni(lunediFuturo, 27),
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as { occorrenze: string[] };
    expect(corpo.occorrenze).toEqual([0, 3, 7, 10, 14, 17, 21, 24].map((scarto) => aggiungiGiorni(lunediFuturo, scarto)));
  });

  it('i giorni sono esposti come array di numeri nelle liste della società', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const creazione = await postJson('/api/societa/richieste', cookie, {
      data: lunediFuturo,
      ora_inizio: '19:00',
      ora_fine: '20:30',
      giorni: [4, 2],
    });
    expect(creazione.status).toBe(201);

    const elenco = await getConCookie('/api/societa/richieste', cookie);
    const corpo = (await elenco.json()) as { ricorrenze: { giorni: number[] }[] };
    expect(corpo.ricorrenze).toHaveLength(1);
    expect(corpo.ricorrenze[0].giorni).toEqual([0, 2, 4]);
  });

  it('rifiuta giorni della settimana non validi', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const base = { data: lunediFuturo, ora_inizio: '19:00', ora_fine: '20:30' };

    expect((await postJson('/api/societa/richieste', cookie, { ...base, giorni: [7] })).status).toBe(400);
    expect((await postJson('/api/societa/richieste', cookie, { ...base, giorni: [-1] })).status).toBe(400);
    expect((await postJson('/api/societa/richieste', cookie, { ...base, giorni: ['2'] })).status).toBe(400);
    expect((await postJson('/api/societa/richieste', cookie, { ...base, giorni: 'mercoledì' })).status).toBe(400);

    const create = await env.DB.prepare('SELECT COUNT(*) AS n FROM ricorrenze').first<{ n: number }>();
    expect(create?.n).toBe(0);
  });

  it('un solo giorno coincidente con la data e nessuna ripetizione resta una richiesta singola', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data: lunediFuturo,
      ora_inizio: '19:00',
      ora_fine: '20:30',
      giorni: [0],
    });
    expect(risposta.status).toBe(201);
    const corpo = (await risposta.json()) as { tipo: string };
    expect(corpo.tipo).toBe('richiesta');
  });
});

/**
 * Controllo di disponibilità all'invio: la richiesta viene respinta se anche
 * un solo slot da 30 minuti è già prenotato da qualcuno. Sono occupati solo
 * gli slot delle prenotazioni APPROVATE: due società possono ancora avere
 * richieste in attesa sulla stessa fascia, e decide l'amministratore.
 */
describe('disponibilità degli slot al momento dell\'invio', () => {
  /** Occupa una fascia facendo approvare all'admin la richiesta di un'altra società. */
  async function occupaFascia(data: string, oraInizio: string, oraFine: string): Promise<void> {
    const societaId = await creaSocieta('ASD Occupante');
    const richiestaId = await creaRichiesta(societaId, data, oraInizio, oraFine);
    const risposta = await postAdmin(`/api/admin/richieste/${richiestaId}/approva`, await cookieAdmin(), { motivazione: 'Ok' });
    expect(risposta.status).toBe(200);
  }

  it('respinge la richiesta singola che si sovrappone anche solo in parte', async () => {
    const data = aggiungiGiorni(oggi, 30);
    await occupaFascia(data, '18:30', '19:00');
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);

    // 18:00-19:30 tocca lo slot 18:30 già prenotato: niente va creato.
    const risposta = await postJson('/api/societa/richieste', cookie, {
      data,
      ora_inizio: '18:00',
      ora_fine: '19:30',
    });
    expect(risposta.status).toBe(409);
    const corpo = (await risposta.json()) as { errore: string; fasce_occupate: unknown[] };
    expect(corpo.fasce_occupate).toEqual([{ data, ora_inizio: '18:30', ora_fine: '19:00' }]);
    // Nessuna identità rivelata: la diagnostica dei conflitti dà solo le fasce.
    expect(JSON.stringify(corpo)).not.toContain('Occupante');

    const rimaste = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM richieste WHERE data = ?1 AND stato = 'in_attesa'")
      .bind(data)
      .first<{ n: number }>();
    expect(rimaste?.n).toBe(0);
  });

  it('accetta una fascia adiacente a una già prenotata', async () => {
    const data = aggiungiGiorni(oggi, 31);
    await occupaFascia(data, '17:00', '18:00');
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);

    // Lo slot 17:30 finisce quando inizia la richiesta: non è un conflitto.
    const risposta = await postJson('/api/societa/richieste', cookie, { data, ora_inizio: '18:00', ora_fine: '19:00' });
    expect(risposta.status).toBe(201);
  });

  it('respinge tutta la ricorrenza se una sola occorrenza è occupata', async () => {
    const data = aggiungiGiorni(oggi, 32);
    const secondaOccorrenza = aggiungiGiorni(data, 7);
    await occupaFascia(secondaOccorrenza, '18:00', '18:30');
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);

    const risposta = await postJson('/api/societa/richieste', cookie, {
      data,
      ora_inizio: '18:00',
      ora_fine: '19:00',
      ripeti_fino_al: aggiungiGiorni(data, 14),
    });
    expect(risposta.status).toBe(409);
    const corpo = (await risposta.json()) as { errore: string; fasce_occupate: unknown[] };
    // Solo la fascia realmente occupata, non l'intera occorrenza richiesta.
    expect(corpo.fasce_occupate).toEqual([{ data: secondaOccorrenza, ora_inizio: '18:00', ora_fine: '18:30' }]);

    const ricorrenze = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM ricorrenze WHERE valida_dal = ?1')
      .bind(data)
      .first<{ n: number }>();
    expect(ricorrenze?.n).toBe(0);
  });
});

describe('annullamento dalla società', () => {
  it('ritira una richiesta ancora in attesa salvando annullata_at', async () => {
    const { token } = await creaSocietaConToken();
    const cookieSoc = await cookieSocieta(token);
    const creazione = await postJson('/api/societa/richieste', cookieSoc, {
      data: dataFutura,
      ora_inizio: '18:00',
      ora_fine: '19:00',
    });
    const { id } = (await creazione.json()) as { id: number };

    const annullamento = await postJson(`/api/societa/richieste/${id}/annulla`, cookieSoc, {});
    expect(annullamento.status).toBe(200);
    const riga = await env.DB
      .prepare('SELECT stato, annullata_at FROM richieste WHERE id = ?1')
      .bind(id)
      .first<{ stato: string; annullata_at: string | null }>();
    expect(riga?.stato).toBe('annullata');
    expect(riga?.annullata_at).not.toBeNull();
  });

  it('una prenotazione approvata non si annulla direttamente: 409 e slot intatti', async () => {
    const { token } = await creaSocietaConToken();
    const cookieSoc = await cookieSocieta(token);
    const creazione = await postJson('/api/societa/richieste', cookieSoc, {
      data: dataFutura,
      ora_inizio: '18:00',
      ora_fine: '19:00',
    });
    const { id } = (await creazione.json()) as { id: number };
    const cookieAmm = await cookieAdmin();
    expect((await postAdmin(`/api/admin/richieste/${id}/approva`, cookieAmm, { motivazione: 'Ok' })).status).toBe(200);

    const tentativo = await postJson(`/api/societa/richieste/${id}/annulla`, cookieSoc, {});
    expect(tentativo.status).toBe(409);
    expect((await slotDiRichiesta(id)).length).toBe(2);
    const riga = await env.DB.prepare('SELECT stato FROM richieste WHERE id = ?1').bind(id).first<{ stato: string }>();
    expect(riga?.stato).toBe('approvata');
  });

  it('non permette di annullare richieste di altre società', async () => {
    const prima = await creaSocietaConToken('Società A');
    const seconda = await creaSocietaConToken('Società B');
    const cookieA = await cookieSocieta(prima.token);
    const cookieB = await cookieSocieta(seconda.token);
    const creazione = await postJson('/api/societa/richieste', cookieA, {
      data: dataFutura,
      ora_inizio: '18:00',
      ora_fine: '19:00',
    });
    const { id } = (await creazione.json()) as { id: number };
    const tentativo = await postJson(`/api/societa/richieste/${id}/annulla`, cookieB, {});
    expect(tentativo.status).toBe(404);
  });
});
