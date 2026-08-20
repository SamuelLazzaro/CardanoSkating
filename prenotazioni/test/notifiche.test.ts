import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from 'cloudflare:test';
import app from '../src/index';
import { corpoNotifica, dataItaliana } from '../src/notifiche';
import { cookieAdmin, cookieSocieta, creaRichiesta, creaSocietaConToken } from './helpers';

/**
 * Test delle notifiche email (src/notifiche.ts): l'invio verso l'API Brevo è
 * intercettato con fetchMock, quindi nessuna richiesta esce davvero in rete
 * (disableNetConnect fa fallire qualsiasi fetch non intercettata).
 */

const CHIAVE_TEST = 'chiave-brevo-solo-per-test';
const MITTENTE_TEST = 'prenotazioni@test.invalid';
const ADMIN_TEST = 'admin@test.invalid';

let mittenteOriginale: string | undefined;
let adminOriginale: string | undefined;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  mittenteOriginale = env.EMAIL_MITTENTE;
  adminOriginale = env.EMAIL_ADMIN;
  env.BREVO_API_KEY = CHIAVE_TEST;
  env.EMAIL_MITTENTE = MITTENTE_TEST;
  env.EMAIL_ADMIN = ADMIN_TEST;
});

afterAll(() => {
  delete env.BREVO_API_KEY;
  if (mittenteOriginale !== undefined) env.EMAIL_MITTENTE = mittenteOriginale;
  if (adminOriginale !== undefined) env.EMAIL_ADMIN = adminOriginale;
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

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
 * POST con un ExecutionContext vero: waitOnExecutionContext attende le
 * promesse passate a waitUntil(), quindi anche l'invio della notifica.
 */
async function postConContesto(percorso: string, cookie: string, corpo?: unknown): Promise<Response> {
  const contesto = createExecutionContext();
  const risposta = await app.request(
    percorso,
    { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo ?? {}) },
    env,
    contesto,
  );
  await waitOnExecutionContext(contesto);
  return risposta;
}

async function conteggioNotificheFallite(): Promise<number> {
  const riga = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE azione = 'notifica_fallita'")
    .first<{ n: number }>();
  return riga?.n ?? 0;
}

describe('formattazione', () => {
  it('dataItaliana converte in GG/MM/AAAA', () => {
    expect(dataItaliana('2026-08-19')).toBe('19/08/2026');
  });

  it('corpoNotifica contiene destinatario, messaggio, dettagli e link privacy', () => {
    const corpo = corpoNotifica(
      {
        oggetto: 'Oggetto di prova',
        messaggio: 'è successo qualcosa.',
        dettagli: ['Data: 19/08/2026, dalle 18:00 alle 19:00'],
        societa: { nome: 'Polisportiva Test', email: 'test@example.com' },
      },
      'https://prenotazioni.example',
    );
    expect(corpo).toContain('Gentile Polisportiva Test,');
    expect(corpo).toContain('è successo qualcosa.');
    expect(corpo).toContain('Data: 19/08/2026, dalle 18:00 alle 19:00');
    expect(corpo).toContain('https://prenotazioni.example/privacy.html');
  });
});

describe('invio notifiche', () => {
  it("l'approvazione di una richiesta notifica la società con l'admin in copia", async () => {
    const { id: societaId, token } = await creaSocietaConToken();
    const richiestaId = await creaRichiesta(societaId, '2027-01-15', '18:00', '19:00');
    const cattura = intercettaBrevo();

    const risposta = await postConContesto(`/api/admin/richieste/${richiestaId}/approva`, await cookieAdmin(), {
      motivazione: 'Ok',
    });
    expect(risposta.status).toBe(200);

    const corpo = cattura.corpo();
    expect(corpo).not.toBeNull();
    expect(corpo!.sender.email).toBe(MITTENTE_TEST);
    expect(corpo!.to[0].email).toBe('test@example.com');
    expect(corpo!.cc[0].email).toBe(ADMIN_TEST);
    expect(corpo!.replyTo.email).toBe(ADMIN_TEST);
    expect(corpo!.subject).toContain('Prenotazione confermata');
    expect(corpo!.subject).toContain('15/01/2027');
    expect(corpo!.textContent).toContain('dalle 18:00 alle 19:00');
    expect(corpo!.textContent).toContain('Motivazione: Ok');
    // Minimizzazione: il token del link personale non deve MAI viaggiare via email.
    expect(corpo!.textContent).not.toContain(token);
  });

  it('la nuova richiesta della società notifica l\'invio in attesa di approvazione', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const cattura = intercettaBrevo();

    const risposta = await postConContesto('/api/societa/richieste', cookie, {
      data: '2027-03-10',
      ora_inizio: '10:00',
      ora_fine: '11:00',
    });
    expect(risposta.status).toBe(201);

    const corpo = cattura.corpo();
    expect(corpo).not.toBeNull();
    expect(corpo!.subject).toContain('Richiesta di prenotazione inviata');
    expect(corpo!.to[0].email).toBe('test@example.com');
    expect(corpo!.textContent).toContain('Attività: Allenamento');
  });

  it("un errore di Brevo non blocca l'operazione e lascia traccia in audit", async () => {
    const { id: societaId } = await creaSocietaConToken();
    const richiestaId = await creaRichiesta(societaId, '2027-01-16', '18:00', '19:00');
    intercettaBrevo(500);

    const risposta = await postConContesto(`/api/admin/richieste/${richiestaId}/approva`, await cookieAdmin(), {
      motivazione: 'Ok',
    });
    expect(risposta.status).toBe(200); // l'approvazione resta valida
    expect(await conteggioNotificheFallite()).toBe(1);
  });

  it('senza BREVO_API_KEY non parte nessuna chiamata di rete', async () => {
    delete env.BREVO_API_KEY;
    try {
      const { id: societaId } = await creaSocietaConToken();
      const richiestaId = await creaRichiesta(societaId, '2027-01-17', '18:00', '19:00');
      // Nessuna intercettazione registrata: una fetch qui farebbe fallire
      // l'invio (rete disabilitata) e comparirebbe una notifica_fallita.
      const risposta = await postConContesto(`/api/admin/richieste/${richiestaId}/approva`, await cookieAdmin(), {
        motivazione: 'Ok',
      });
      expect(risposta.status).toBe(200);
      expect(await conteggioNotificheFallite()).toBe(0);
    } finally {
      env.BREVO_API_KEY = CHIAVE_TEST;
    }
  });

  it("quando la destinataria è la società di casa l'admin non è duplicato in copia", async () => {
    const token = crypto.randomUUID();
    const esito = await env.DB
      .prepare("INSERT INTO societa (nome, referente, email, token_accesso) VALUES ('Casa', 'Referente', ?1, ?2)")
      .bind(ADMIN_TEST, token)
      .run();
    const richiestaId = await creaRichiesta(esito.meta.last_row_id, '2027-01-18', '18:00', '19:00');
    const cattura = intercettaBrevo();

    const risposta = await postConContesto(`/api/admin/richieste/${richiestaId}/approva`, await cookieAdmin(), {
      motivazione: 'Ok',
    });
    expect(risposta.status).toBe(200);

    const corpo = cattura.corpo();
    expect(corpo).not.toBeNull();
    expect(corpo!.to[0].email).toBe(ADMIN_TEST);
    expect(corpo!.cc).toBeUndefined();
  });
});
