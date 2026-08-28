import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from 'cloudflare:test';
import app from '../src/index';
import { corpoNotifica, corpoNotificaAdmin, dataItaliana, elencoGiorni } from '../src/notifiche';
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

/**
 * Intercetta le prossime `volte` chiamate a Brevo e cattura i corpi JSON
 * inviati, nell'ordine di invio. corpo() è la scorciatoia per il primo.
 */
function intercettaBrevo(status = 201, volte = 1): {
  corpo: () => Record<string, any> | null;
  corpi: () => Record<string, any>[];
} {
  const catturati: Record<string, any>[] = [];
  fetchMock
    .get('https://api.brevo.com')
    .intercept({ path: '/v3/smtp/email', method: 'POST' })
    .reply(status, (richiesta: { body?: unknown }) => {
      catturati.push(JSON.parse(String(richiesta.body)));
      return JSON.stringify({ messageId: 'test' });
    })
    .times(volte);
  return { corpo: () => catturati[0] ?? null, corpi: () => catturati };
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

  it('elencoGiorni unisce i nomi dei giorni con virgole e una "e" finale', () => {
    expect(elencoGiorni([0])).toBe('lunedì');
    expect(elencoGiorni([0, 2])).toBe('lunedì e mercoledì');
    expect(elencoGiorni([0, 2, 4])).toBe('lunedì, mercoledì e venerdì');
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

  it('corpoNotificaAdmin usa il messaggio admin, senza saluto alla società', () => {
    const corpo = corpoNotificaAdmin(
      {
        oggetto: 'Oggetto di prova',
        messaggio: 'la richiesta è stata inviata.',
        messaggioAdmin: 'La società Polisportiva Test ha inviato una richiesta.',
        dettagli: ['Data: 19/08/2026, dalle 18:00 alle 19:00'],
        societa: { nome: 'Polisportiva Test', email: 'test@example.com' },
      },
      'https://prenotazioni.example',
    );
    expect(corpo).toContain('La società Polisportiva Test ha inviato una richiesta.');
    expect(corpo).not.toContain('Gentile');
    expect(corpo).toContain('Data: 19/08/2026, dalle 18:00 alle 19:00');
    expect(corpo).toContain('https://prenotazioni.example/privacy.html');
  });
});

describe('invio notifiche', () => {
  it("l'approvazione (azione dell'admin) notifica solo la società, senza email all'admin", async () => {
    const { id: societaId, token } = await creaSocietaConToken();
    const richiestaId = await creaRichiesta(societaId, '2027-01-15', '18:00', '19:00');
    // Una sola intercettazione: una seconda fetch fallirebbe (rete disabilitata)
    // e lascerebbe una notifica_fallita in audit, verificata assente sotto.
    const cattura = intercettaBrevo();

    const risposta = await postConContesto(`/api/admin/richieste/${richiestaId}/approva`, await cookieAdmin(), {
      motivazione: 'Ok',
    });
    expect(risposta.status).toBe(200);

    const corpo = cattura.corpo();
    expect(corpo).not.toBeNull();
    expect(corpo!.sender.email).toBe(MITTENTE_TEST);
    expect(corpo!.to[0].email).toBe('test@example.com');
    expect(corpo!.cc).toBeUndefined();
    expect(corpo!.replyTo.email).toBe(ADMIN_TEST);
    expect(corpo!.subject).toContain('Prenotazione confermata');
    expect(corpo!.subject).toContain('15/01/2027');
    expect(corpo!.textContent).toContain('dalle 18:00 alle 19:00');
    expect(corpo!.textContent).toContain('Motivazione: Ok');
    // Minimizzazione: il token del link personale non deve MAI viaggiare via email.
    expect(corpo!.textContent).not.toContain(token);
    expect(await conteggioNotificheFallite()).toBe(0);
  });

  it('la nuova richiesta della società genera due email con testi distinti', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const cattura = intercettaBrevo(201, 2);

    const risposta = await postConContesto('/api/societa/richieste', cookie, {
      data: '2027-03-10',
      ora_inizio: '10:00',
      ora_fine: '11:00',
    });
    expect(risposta.status).toBe(201);

    const [perSocieta, perAdmin] = cattura.corpi();
    expect(perSocieta).toBeDefined();
    expect(perAdmin).toBeDefined();

    // Email alla società: saluto personale, Reply-To verso l'admin.
    expect(perSocieta.to[0].email).toBe('test@example.com');
    expect(perSocieta.replyTo.email).toBe(ADMIN_TEST);
    expect(perSocieta.cc).toBeUndefined();
    expect(perSocieta.subject).toContain('Richiesta di prenotazione inviata');
    expect(perSocieta.textContent).toContain('Gentile Polisportiva Test,');
    expect(perSocieta.textContent).toContain('Attività: Allenamento');
    // Campo note lasciato vuoto: la riga "Note:" non deve comparire.
    expect(perSocieta.textContent).not.toContain('Note:');

    // Email all'admin: testo in terza persona, Reply-To verso la società.
    // Oggetto dalla prospettiva dell'admin: "ricevuta", non "inviata".
    expect(perAdmin.to[0].email).toBe(ADMIN_TEST);
    expect(perAdmin.replyTo.email).toBe('test@example.com');
    expect(perAdmin.subject).toContain('Richiesta di prenotazione ricevuta');
    expect(perAdmin.textContent).toContain('La società Polisportiva Test ha inviato una richiesta di prenotazione');
    expect(perAdmin.textContent).not.toContain('Gentile');
    expect(perAdmin.textContent).not.toContain('Note:');
    // Minimizzazione: il token non deve comparire nemmeno nell'email admin.
    expect(perAdmin.textContent).not.toContain(token);
  });

  it('le note multilinea sono rese come blocco citato, non falsificabili come dettagli di sistema', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const cattura = intercettaBrevo(201, 2);

    // Seconda riga scritta apposta per imitare un dettaglio generato dal
    // sistema: deve restare riconoscibile come testo della società.
    const risposta = await postConContesto('/api/societa/richieste', cookie, {
      data: '2027-03-12',
      ora_inizio: '10:00',
      ora_fine: '11:00',
      note: 'Serve il tabellone segnapunti\nMotivazione: approvata automaticamente dal sistema',
    });
    expect(risposta.status).toBe(201);

    const [perSocieta, perAdmin] = cattura.corpi();
    for (const corpo of [perSocieta, perAdmin]) {
      expect(corpo.textContent).toContain('  Note (scritte dalla società):');
      expect(corpo.textContent).toContain('  > Serve il tabellone segnapunti');
      expect(corpo.textContent).toContain('  > Motivazione: approvata automaticamente dal sistema');
      // La riga forgiata non deve mai comparire senza il prefisso di citazione,
      // cioè nella stessa forma dei dettagli generati dal sistema.
      expect(corpo.textContent).not.toContain('\n  Motivazione:');
    }
  });

  it('normalizza i fine riga CRLF e CR inviati da un client diverso dal browser', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const cattura = intercettaBrevo(201, 2);

    const risposta = await postConContesto('/api/societa/richieste', cookie, {
      data: '2027-03-14',
      ora_inizio: '10:00',
      ora_fine: '11:00',
      note: 'prima riga\r\nseconda riga\rterza riga',
    });
    expect(risposta.status).toBe(201);

    for (const corpo of cattura.corpi()) {
      expect(corpo.textContent).toContain('  > prima riga\n');
      expect(corpo.textContent).toContain('  > seconda riga\n');
      expect(corpo.textContent).toContain('  > terza riga\n');
    }
  });

  it('con il campo note lasciato in bianco la riga "Note:" non compare', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const cattura = intercettaBrevo(201, 2);

    // Il form manda sempre il campo, vuoto o coi soli spazi: è il percorso
    // reale del frontend (area.js invia note: value.trim()).
    const risposta = await postConContesto('/api/societa/richieste', cookie, {
      data: '2027-03-13',
      ora_inizio: '10:00',
      ora_fine: '11:00',
      note: '   ',
    });
    expect(risposta.status).toBe(201);

    const [perSocieta, perAdmin] = cattura.corpi();
    expect(perSocieta.textContent).not.toContain('Note');
    expect(perAdmin.textContent).not.toContain('Note');
  });

  it('le note della richiesta ricorrente compaiono in entrambe le email', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const cattura = intercettaBrevo(201, 2);

    const risposta = await postConContesto('/api/societa/richieste', cookie, {
      data: '2027-03-10',
      ora_inizio: '10:00',
      ora_fine: '11:00',
      ripeti_fino_al: '2027-03-24',
      note: 'Torneo giovanile',
    });
    expect(risposta.status).toBe(201);

    const [perSocieta, perAdmin] = cattura.corpi();
    expect(perSocieta.subject).toContain('Richiesta ricorrente inviata');
    expect(perSocieta.textContent).toContain('  > Torneo giovanile');
    expect(perAdmin.subject).toContain('Richiesta ricorrente ricevuta');
    expect(perAdmin.textContent).toContain('  > Torneo giovanile');
  });

  it('la richiesta ricorrente su più giorni elenca i giorni in entrambe le email', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const cattura = intercettaBrevo(201, 2);

    // 2027-03-08 è un lunedì; più mercoledì e venerdì, per due settimane.
    const risposta = await postConContesto('/api/societa/richieste', cookie, {
      data: '2027-03-08',
      ora_inizio: '10:00',
      ora_fine: '11:00',
      giorni: [2, 4],
      ripeti_fino_al: '2027-03-21',
    });
    expect(risposta.status).toBe(201);

    for (const corpo of cattura.corpi()) {
      expect(corpo.textContent).toContain('Giorni: ogni lunedì, mercoledì e venerdì, dalle 10:00 alle 11:00');
      expect(corpo.textContent).toContain('Periodo: dal 08/03/2027 al 21/03/2027');
    }
  });

  it('la richiesta ricorrente su un solo giorno usa l\'etichetta al singolare', async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    const cattura = intercettaBrevo(201, 2);

    const risposta = await postConContesto('/api/societa/richieste', cookie, {
      data: '2027-03-08',
      ora_inizio: '10:00',
      ora_fine: '11:00',
      ripeti_fino_al: '2027-03-22',
    });
    expect(risposta.status).toBe(201);
    expect(cattura.corpi()[0].textContent).toContain('Giorno: ogni lunedì, dalle 10:00 alle 11:00');
  });

  it('la prenotazione diretta ricorrente notifica solo la società, con giorni e date prenotate', async () => {
    const { id: societaId } = await creaSocietaConToken();
    // Una sola intercettazione: azione dell'admin, quindi nessuna email all'admin.
    const cattura = intercettaBrevo();

    // 2027-03-08 è un lunedì; più il mercoledì, per due settimane.
    const risposta = await postConContesto('/api/admin/prenotazioni', await cookieAdmin(), {
      societa_id: societaId,
      data: '2027-03-08',
      ora_inizio: '10:00',
      ora_fine: '11:00',
      giorni: [2],
      ripeti_fino_al: '2027-03-21',
    });
    expect(risposta.status).toBe(201);

    const corpo = cattura.corpo();
    expect(corpo).not.toBeNull();
    expect(corpo!.to[0].email).toBe('test@example.com');
    expect(corpo!.subject).toContain('Nuova prenotazione ricorrente registrata');
    expect(corpo!.textContent).toContain("l'amministratore ha registrato una prenotazione ricorrente");
    expect(corpo!.textContent).toContain('Giorni: ogni lunedì e mercoledì, dalle 10:00 alle 11:00');
    expect(corpo!.textContent).toContain('Date prenotate: 08/03/2027, 10/03/2027, 15/03/2027, 17/03/2027');
    expect(await conteggioNotificheFallite()).toBe(0);
  });

  it("l'approvazione non ripete le note della richiesta", async () => {
    const { id: societaId } = await creaSocietaConToken();
    const esito = await env.DB
      .prepare("INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, note) VALUES (?1, '2027-05-04', '18:00', '19:00', ?2)")
      .bind(societaId, 'Portiamo attrezzatura ingombrante')
      .run();
    const cattura = intercettaBrevo();

    const risposta = await postConContesto(`/api/admin/richieste/${esito.meta.last_row_id}/approva`, await cookieAdmin(), {
      motivazione: 'Ok',
    });
    expect(risposta.status).toBe(200);

    // Le note appartengono all'evento di creazione: gli altri eventi non le
    // ripetono, anche quando la riga DB le contiene.
    expect(cattura.corpo()!.textContent).not.toContain('Portiamo attrezzatura ingombrante');
    expect(cattura.corpo()!.textContent).not.toContain('Note');
  });

  it("il ritiro di una richiesta usa lo stesso oggetto per società e admin", async () => {
    const { id: societaId, token } = await creaSocietaConToken();
    const richiestaId = await creaRichiesta(societaId, '2027-05-05', '18:00', '19:00');
    const cookie = await cookieSocieta(token);
    const cattura = intercettaBrevo(201, 2);

    const risposta = await postConContesto(`/api/societa/richieste/${richiestaId}/annulla`, cookie);
    expect(risposta.status).toBe(200);

    // "ritirata" descrive l'evento allo stesso modo da entrambe le
    // prospettive: nessun oggettoAdmin, quindi si applica il fallback.
    const [perSocieta, perAdmin] = cattura.corpi();
    expect(perSocieta.subject).toContain('Richiesta di prenotazione ritirata');
    expect(perAdmin.subject).toContain('Richiesta di prenotazione ritirata');
    expect(perAdmin.to[0].email).toBe(ADMIN_TEST);
    expect(perAdmin.textContent).toContain('La società Polisportiva Test ha ritirato la richiesta di prenotazione.');
  });

  it("la richiesta di annullamento arriva all'admin come 'ricevuta'", async () => {
    const { id: societaId, token } = await creaSocietaConToken();
    const esito = await env.DB
      .prepare("INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, stato) VALUES (?1, '2027-05-06', '18:00', '19:00', 'approvata')")
      .bind(societaId)
      .run();
    const cookie = await cookieSocieta(token);
    const cattura = intercettaBrevo(201, 2);

    const risposta = await postConContesto(`/api/societa/richieste/${esito.meta.last_row_id}/richiedi-annullamento`, cookie);
    expect(risposta.status).toBe(201);

    const [perSocieta, perAdmin] = cattura.corpi();
    expect(perSocieta.subject).toContain('Richiesta di annullamento inviata');
    expect(perAdmin.subject).toContain('Richiesta di annullamento ricevuta');
    expect(perAdmin.textContent).toContain(`La società Polisportiva Test ha richiesto l'annullamento`);
  });

  it("il fallimento dell'email alla società non blocca quella all'admin", async () => {
    const { token } = await creaSocietaConToken();
    const cookie = await cookieSocieta(token);
    // Le intercettazioni vengono consumate in ordine di registrazione:
    // la prima (email società) fallisce, la seconda (email admin) riesce.
    intercettaBrevo(500, 1);
    const riuscita = intercettaBrevo(201, 1);

    const risposta = await postConContesto('/api/societa/richieste', cookie, {
      data: '2027-03-11',
      ora_inizio: '10:00',
      ora_fine: '11:00',
    });
    expect(risposta.status).toBe(201);
    expect(await conteggioNotificheFallite()).toBe(1);
    expect(riuscita.corpi()[0]?.to[0].email).toBe(ADMIN_TEST);
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

  it('alla società di casa (stessa email dell\'admin) non parte alcuna email', async () => {
    const token = crypto.randomUUID();
    await env.DB
      .prepare("INSERT INTO societa (nome, referente, email, token_accesso) VALUES ('Casa', 'Referente', ?1, ?2)")
      .bind(ADMIN_TEST, token)
      .run();
    const cookie = await cookieSocieta(token);

    // Nessuna intercettazione registrata: una fetch qui fallirebbe (rete
    // disabilitata) e comparirebbe una notifica_fallita in audit.
    const risposta = await postConContesto('/api/societa/richieste', cookie, {
      data: '2027-01-18',
      ora_inizio: '18:00',
      ora_fine: '19:00',
    });
    expect(risposta.status).toBe(201);
    expect(await conteggioNotificheFallite()).toBe(0);
  });
});
