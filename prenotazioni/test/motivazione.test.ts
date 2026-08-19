/**
 * Test sulla motivazione obbligatoria delle decisioni admin (migrazione 0004):
 * approvazione e rifiuto senza motivazione (o con motivazione troppo corta)
 * rispondono 400 senza cambiare nulla; con motivazione valida questa viene
 * salvata sulla riga decisa, copiata nelle richieste materializzate dalle
 * ricorrenze e resta visibile alla società nella sua area.
 *
 * Le date usano il 2031 per restare "future" rispetto all'orologio reale.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  cookieAdmin,
  cookieSocieta,
  creaRichiesta,
  creaRicorrenza,
  creaSocietaConToken,
  getConCookie,
  postAdmin,
  slotDiRichiesta,
  statoRichiesta,
} from './helpers';

describe('motivazione obbligatoria sulle richieste', () => {
  it('approvazione senza motivazione: 400, stato invariato e nessuno slot', async () => {
    const cookie = await cookieAdmin();
    const { id: societaId } = await creaSocietaConToken();
    const richiestaId = await creaRichiesta(societaId, '2031-01-06', '18:00', '19:00');

    // Senza corpo, con corpo vuoto e con motivazione sotto i 2 caratteri.
    expect((await postAdmin(`/api/admin/richieste/${richiestaId}/approva`, cookie)).status).toBe(400);
    expect((await postAdmin(`/api/admin/richieste/${richiestaId}/approva`, cookie, {})).status).toBe(400);
    expect((await postAdmin(`/api/admin/richieste/${richiestaId}/approva`, cookie, { motivazione: 'x' })).status).toBe(400);
    expect((await postAdmin(`/api/admin/richieste/${richiestaId}/approva`, cookie, { motivazione: '   ' })).status).toBe(400);

    expect(await statoRichiesta(richiestaId)).toBe('in_attesa');
    expect(await slotDiRichiesta(richiestaId)).toEqual([]);
  });

  it('rifiuto senza motivazione: 400 e stato invariato', async () => {
    const cookie = await cookieAdmin();
    const { id: societaId } = await creaSocietaConToken();
    const richiestaId = await creaRichiesta(societaId, '2031-01-06', '18:00', '19:00');

    expect((await postAdmin(`/api/admin/richieste/${richiestaId}/rifiuta`, cookie)).status).toBe(400);
    expect((await postAdmin(`/api/admin/richieste/${richiestaId}/rifiuta`, cookie, { motivazione: 'x' })).status).toBe(400);
    expect(await statoRichiesta(richiestaId)).toBe('in_attesa');
  });

  it('la motivazione viene salvata ed è visibile alla società nella sua area', async () => {
    const cookie = await cookieAdmin();
    const { id: societaId, token } = await creaSocietaConToken();
    const approvataId = await creaRichiesta(societaId, '2031-01-06', '18:00', '19:00');
    const rifiutataId = await creaRichiesta(societaId, '2031-01-07', '18:00', '19:00');

    expect((await postAdmin(`/api/admin/richieste/${approvataId}/approva`, cookie, { motivazione: 'ok' })).status).toBe(200);
    expect(
      (await postAdmin(`/api/admin/richieste/${rifiutataId}/rifiuta`, cookie, { motivazione: 'Palazzetto chiuso per manutenzione' })).status,
    ).toBe(200);

    const cookieSoc = await cookieSocieta(token);
    const risposta = await getConCookie('/api/societa/richieste', cookieSoc);
    expect(risposta.status).toBe(200);
    const corpo = (await risposta.json()) as { richieste: { id: number; stato: string; motivazione: string | null }[] };
    const approvata = corpo.richieste.find((r) => r.id === approvataId);
    const rifiutata = corpo.richieste.find((r) => r.id === rifiutataId);
    expect(approvata?.stato).toBe('approvata');
    expect(approvata?.motivazione).toBe('ok');
    expect(rifiutata?.stato).toBe('rifiutata');
    expect(rifiutata?.motivazione).toBe('Palazzetto chiuso per manutenzione');
  });
});

describe('motivazione obbligatoria sulle ricorrenze', () => {
  it('approvazione senza motivazione: 400 e nessuna materializzazione', async () => {
    const cookie = await cookieAdmin();
    const { id: societaId } = await creaSocietaConToken();
    const ricorrenzaId = await creaRicorrenza(societaId, 0, '18:00', '19:00', '2031-01-06', '2031-01-27');

    expect((await postAdmin(`/api/admin/ricorrenze/${ricorrenzaId}/approva`, cookie)).status).toBe(400);
    expect((await postAdmin(`/api/admin/ricorrenze/${ricorrenzaId}/rifiuta`, cookie)).status).toBe(400);

    const ricorrenza = await env.DB.prepare('SELECT stato FROM ricorrenze WHERE id = ?1').bind(ricorrenzaId).first<{ stato: string }>();
    expect(ricorrenza?.stato).toBe('in_attesa');
    const materializzate = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM richieste WHERE ricorrenza_id = ?1')
      .bind(ricorrenzaId)
      .first<{ n: number }>();
    expect(materializzate?.n).toBe(0);
  });

  it("all'approvazione la motivazione viene copiata nelle richieste materializzate", async () => {
    const cookie = await cookieAdmin();
    const { id: societaId } = await creaSocietaConToken();
    const ricorrenzaId = await creaRicorrenza(societaId, 0, '18:00', '19:00', '2031-01-06', '2031-01-27');

    const risposta = await postAdmin(`/api/admin/ricorrenze/${ricorrenzaId}/approva`, cookie, { motivazione: 'Ok per tutto gennaio' });
    expect(risposta.status).toBe(200);

    const ricorrenza = await env.DB
      .prepare('SELECT stato, motivazione FROM ricorrenze WHERE id = ?1')
      .bind(ricorrenzaId)
      .first<{ stato: string; motivazione: string | null }>();
    expect(ricorrenza?.stato).toBe('approvata');
    expect(ricorrenza?.motivazione).toBe('Ok per tutto gennaio');

    const richieste = await env.DB
      .prepare('SELECT motivazione FROM richieste WHERE ricorrenza_id = ?1')
      .bind(ricorrenzaId)
      .all<{ motivazione: string | null }>();
    expect(richieste.results.length).toBe(4);
    expect(richieste.results.every((r) => r.motivazione === 'Ok per tutto gennaio')).toBe(true);
  });
});
