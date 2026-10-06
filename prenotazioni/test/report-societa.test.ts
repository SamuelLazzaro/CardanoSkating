/**
 * Test dell'invio del report mensile alla singola società (migrazione 0011):
 * validazione del mese (solo mesi conclusi), cifre corrette su dati noti,
 * rifiuti (società di casa, mese senza ore), invio sincrono via Brevo con
 * admin in copia, contenuto dell'email (totale sempre, ore solo a richiesta,
 * tariffa mai), storico degli invii e gestione del fallimento.
 *
 * Le prenotazioni dirette rifiutano le date passate, quindi lo scenario
 * inserisce richiesta e slot direttamente in DB su un mese passato.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { env, fetchMock } from 'cloudflare:test';
import app from '../src/index';
import { nomeMese, notificaReportMensile } from '../src/notifiche';
import { oraRoma } from '../src/slots';
import { strutturaDa } from '../src/util';
import { cookieAdmin, getConCookie, postJson } from './helpers';

const MESE_PASSATO = '2025-06';
const CHIAVE_TEST = 'chiave-brevo-solo-per-test';
const MITTENTE_TEST = 'prenotazioni@test.invalid';
const ADMIN_TEST = 'admin@test.invalid';

type CorpoReportSocieta = { mese: string; ore: number; importo: number; ultimo_invio: { inviato_at: string; con_ore: number } | null };

let mittenteOriginale: string | undefined;
let adminOriginale: string | undefined;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  mittenteOriginale = env.EMAIL_MITTENTE;
  adminOriginale = env.EMAIL_ADMIN;
  env.EMAIL_MITTENTE = MITTENTE_TEST;
  env.EMAIL_ADMIN = ADMIN_TEST;
});

afterAll(() => {
  if (mittenteOriginale !== undefined) env.EMAIL_MITTENTE = mittenteOriginale;
  if (adminOriginale !== undefined) env.EMAIL_ADMIN = adminOriginale;
});

afterEach(() => {
  delete env.BREVO_API_KEY;
  fetchMock.assertNoPendingInterceptors();
});

/** Intercetta la prossima chiamata a Brevo e cattura il corpo JSON inviato. */
function intercettaBrevo(status = 201): { corpo: () => Record<string, any> | null } {
  let catturato: Record<string, any> | null = null;
  fetchMock
    .get('https://api.brevo.com')
    .intercept({ path: '/v3/smtp/email', method: 'POST' })
    .reply(status, (richiesta: { body?: unknown }) => {
      catturato = JSON.parse(String(richiesta.body));
      return JSON.stringify({ messageId: 'test' });
    });
  return { corpo: () => catturato };
}

/**
 * Società con tariffa nota e 1h30 (3 slot) già svolte nel mese passato, più
 * 1h nel mese successivo che NON deve entrare nel conteggio.
 */
async function scenarioPassato(cookieAmm: string, tariffa = 20): Promise<number> {
  const creazione = await postJson('/api/admin/societa', cookieAmm, { nome: 'ASD Storica', referente: 'S', email: 'storica@example.com', tariffa_oraria: tariffa });
  expect(creazione.status).toBe(201);
  const { id } = (await creazione.json()) as { id: number };
  await inserisciPrenotazionePassata(id, '2025-06-10', ['1800', '1830', '1900']);
  await inserisciPrenotazionePassata(id, '2025-07-01', ['1800', '1830']);
  return id;
}

async function inserisciPrenotazionePassata(societaId: number, data: string, orari: string[]): Promise<void> {
  const esito = await env.DB
    .prepare("INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, stato, decisa_at) VALUES (?1, ?2, '18:00', '19:30', 'approvata', datetime('now'))")
    .bind(societaId, data)
    .run();
  const richiestaId = esito.meta.last_row_id;
  for (const orario of orari) {
    await env.DB.prepare('INSERT INTO prenotazioni (slot_key, societa_id, richiesta_id) VALUES (?1, ?2, ?3)').bind(`${data}_${orario}`, societaId, richiestaId).run();
  }
}

async function conteggioAudit(azione: string): Promise<number> {
  const riga = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE azione = ?1').bind(azione).first<{ n: number }>();
  return riga?.n ?? 0;
}

describe('testo del report', () => {
  const struttura = strutturaDa({ NOME_STRUTTURA: 'Pista di prova', SIGLA_STRUTTURA: 'pista' });
  const societa = { nome: 'ASD Prova', email: 'prova@example.com' };

  it('nomeMese scrive il mese in italiano con l\'anno', () => {
    expect(nomeMese('2025-06')).toBe('giugno 2025');
    expect(nomeMese('2026-01')).toBe('gennaio 2026');
  });

  it('contiene solo il totale; le ore solo se richieste; la tariffa mai', () => {
    const senzaOre = notificaReportMensile(societa, { mese: '2025-06', ore: 1.5, importo: 30, conOre: false }, struttura);
    expect(senzaOre.oggetto).toBe('Riepilogo prenotazioni — giugno 2025');
    expect(senzaOre.messaggio).toContain('giugno 2025 presso Pista di prova');
    expect(senzaOre.dettagli).toEqual(['Totale da pagare: 30,00 €']);

    const conOre = notificaReportMensile(societa, { mese: '2025-06', ore: 1.5, importo: 30, conOre: true }, struttura);
    expect(conOre.dettagli).toEqual(['Ore prenotate: 1,5 h', 'Totale da pagare: 30,00 €']);
    expect(JSON.stringify(conOre).toLowerCase()).not.toContain('tariffa');
  });
});

describe('anteprima del report di una società', () => {
  it('rifiuta mesi malformati, il mese corrente e quelli futuri', async () => {
    const cookieAmm = await cookieAdmin();
    const meseCorrente = oraRoma(new Date()).data.slice(0, 7);
    for (const mese of ['', '2025-13', '06-2025', meseCorrente, '2099-01']) {
      const risposta = await getConCookie(`/api/admin/societa/1/report?mese=${mese}`, cookieAmm);
      expect(risposta.status, `mese "${mese}"`).toBe(400);
      const invio = await postJson('/api/admin/societa/1/report/invia', cookieAmm, { mese, con_ore: false });
      expect(invio.status, `invio mese "${mese}"`).toBe(400);
    }
  });

  it('risponde 404 su una società inesistente', async () => {
    const cookieAmm = await cookieAdmin();
    expect((await getConCookie(`/api/admin/societa/99999/report?mese=${MESE_PASSATO}`, cookieAmm)).status).toBe(404);
    expect((await postJson('/api/admin/societa/99999/report/invia', cookieAmm, { mese: MESE_PASSATO })).status).toBe(404);
  });

  it('calcola ore e importo del solo mese richiesto, senza invii pregressi', async () => {
    const cookieAmm = await cookieAdmin();
    const id = await scenarioPassato(cookieAmm);
    const risposta = await getConCookie(`/api/admin/societa/${id}/report?mese=${MESE_PASSATO}`, cookieAmm);
    expect(risposta.status).toBe(200);
    const corpo = (await risposta.json()) as CorpoReportSocieta;
    expect(corpo).toEqual({ mese: MESE_PASSATO, ore: 1.5, importo: 30, ultimo_invio: null });
  });

  it('su un mese senza prenotazioni ritorna zeri', async () => {
    const cookieAmm = await cookieAdmin();
    const id = await scenarioPassato(cookieAmm);
    const corpo = (await (await getConCookie(`/api/admin/societa/${id}/report?mese=2025-01`, cookieAmm)).json()) as CorpoReportSocieta;
    expect(corpo.ore).toBe(0);
    expect(corpo.importo).toBe(0);
  });
});

describe('invio del report via email', () => {
  it('rifiuta la società di casa e i mesi senza ore', async () => {
    const cookieAmm = await cookieAdmin();
    env.BREVO_API_KEY = CHIAVE_TEST;
    expect((await postJson('/api/admin/societa/1/report/invia', cookieAmm, { mese: MESE_PASSATO })).status).toBe(409);
    const id = await scenarioPassato(cookieAmm);
    const vuoto = await postJson(`/api/admin/societa/${id}/report/invia`, cookieAmm, { mese: '2025-01' });
    expect(vuoto.status).toBe(409);
    expect(((await vuoto.json()) as { errore: string }).errore).toContain('Nessuna ora');
  });

  it('senza BREVO_API_KEY risponde 502 e non registra alcun invio', async () => {
    const cookieAmm = await cookieAdmin();
    const id = await scenarioPassato(cookieAmm);
    const risposta = await postJson(`/api/admin/societa/${id}/report/invia`, cookieAmm, { mese: MESE_PASSATO });
    expect(risposta.status).toBe(502);
    expect(((await risposta.json()) as { errore: string }).errore).toContain('non configurato');
    const righe = await env.DB.prepare('SELECT COUNT(*) AS n FROM report_inviati').first<{ n: number }>();
    expect(righe?.n).toBe(0);
    expect(await conteggioAudit('report_fallito')).toBe(1);
  });

  it('invia alla società con l\'admin in copia: solo il totale, niente ore né tariffa', async () => {
    const cookieAmm = await cookieAdmin();
    const id = await scenarioPassato(cookieAmm);
    env.BREVO_API_KEY = CHIAVE_TEST;
    const cattura = intercettaBrevo();

    const risposta = await postJson(`/api/admin/societa/${id}/report/invia`, cookieAmm, { mese: MESE_PASSATO, con_ore: false });
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toMatchObject({ ok: true, mese: MESE_PASSATO, ore: 1.5, importo: 30, con_ore: false });

    const corpo = cattura.corpo()!;
    expect(corpo.to).toEqual([{ email: 'storica@example.com', name: 'ASD Storica' }]);
    expect(corpo.cc).toEqual([{ email: ADMIN_TEST }]);
    expect(corpo.replyTo).toEqual({ email: ADMIN_TEST });
    expect(corpo.subject).toBe('[Palazzetto] Riepilogo prenotazioni — giugno 2025');
    expect(corpo.textContent).toContain('Gentile ASD Storica,');
    expect(corpo.textContent).toContain('Totale da pagare: 30,00 €');
    expect(corpo.textContent).not.toContain('Ore prenotate');
    expect(corpo.textContent.toLowerCase()).not.toContain('tariffa');
    expect(corpo.textContent).not.toContain('20,00');

    // Storico: una riga con la fotografia delle cifre, visibile dall'anteprima.
    const anteprima = (await (await getConCookie(`/api/admin/societa/${id}/report?mese=${MESE_PASSATO}`, cookieAmm)).json()) as CorpoReportSocieta;
    expect(anteprima.ultimo_invio).not.toBeNull();
    expect(anteprima.ultimo_invio!.con_ore).toBe(0);
    const riga = await env.DB.prepare('SELECT ore, importo, con_ore FROM report_inviati WHERE societa_id = ?1 AND mese = ?2').bind(id, MESE_PASSATO).first<{ ore: number; importo: number; con_ore: number }>();
    expect(riga).toEqual({ ore: 1.5, importo: 30, con_ore: 0 });
    expect(await conteggioAudit('report_inviato')).toBe(1);
  });

  it('con con_ore=true l\'email riporta anche le ore e il reinvio aggiunge una riga allo storico', async () => {
    const cookieAmm = await cookieAdmin();
    const id = await scenarioPassato(cookieAmm);
    env.BREVO_API_KEY = CHIAVE_TEST;

    intercettaBrevo();
    expect((await postJson(`/api/admin/societa/${id}/report/invia`, cookieAmm, { mese: MESE_PASSATO, con_ore: false })).status).toBe(200);

    const cattura = intercettaBrevo();
    expect((await postJson(`/api/admin/societa/${id}/report/invia`, cookieAmm, { mese: MESE_PASSATO, con_ore: true })).status).toBe(200);
    expect(cattura.corpo()!.textContent).toContain('Ore prenotate: 1,5 h');
    expect(cattura.corpo()!.textContent).toContain('Totale da pagare: 30,00 €');

    const righe = await env.DB.prepare('SELECT con_ore FROM report_inviati WHERE societa_id = ?1 AND mese = ?2 ORDER BY id').bind(id, MESE_PASSATO).all<{ con_ore: number }>();
    expect(righe.results.map((r) => r.con_ore)).toEqual([0, 1]);
    const anteprima = (await (await getConCookie(`/api/admin/societa/${id}/report?mese=${MESE_PASSATO}`, cookieAmm)).json()) as CorpoReportSocieta;
    expect(anteprima.ultimo_invio!.con_ore).toBe(1);
  });

  it('se Brevo fallisce risponde 502, non registra l\'invio e lascia traccia in audit', async () => {
    const cookieAmm = await cookieAdmin();
    const id = await scenarioPassato(cookieAmm);
    env.BREVO_API_KEY = CHIAVE_TEST;
    intercettaBrevo(500);

    const risposta = await postJson(`/api/admin/societa/${id}/report/invia`, cookieAmm, { mese: MESE_PASSATO });
    expect(risposta.status).toBe(502);
    const righe = await env.DB.prepare('SELECT COUNT(*) AS n FROM report_inviati').first<{ n: number }>();
    expect(righe?.n).toBe(0);
    expect(await conteggioAudit('report_fallito')).toBe(1);
    expect(await conteggioAudit('report_inviato')).toBe(0);
  });

  it('richiede la sessione admin', async () => {
    expect((await app.request(`/api/admin/societa/1/report?mese=${MESE_PASSATO}`, {}, env)).status).toBe(401);
    expect((await app.request(`/api/admin/societa/1/report/invia`, { method: 'POST' }, env)).status).toBe(401);
  });
});
