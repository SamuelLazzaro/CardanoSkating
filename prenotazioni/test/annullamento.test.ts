/**
 * Test sull'annullamento come richiesta approvabile (migrazione 0005): la
 * società chiede l'annullamento di una propria prenotazione approvata futura,
 * l'admin approva (liberando gli slot) o rifiuta con motivazione. Verifiche
 * lato server: prenotazioni altrui (404), date passate (409), doppia
 * richiesta pendente (409), decadenza alla cancellazione diretta dell'admin.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { aggiungiGiorni, oraRoma } from '../src/slots';
import {
  cookieAdmin,
  cookieSocieta,
  creaSocietaConToken,
  getConCookie,
  postAdmin,
  postJson,
  slotDiRichiesta,
  statoRichiesta,
} from './helpers';

const oggi = oraRoma(new Date()).data;
const dataFutura = aggiungiGiorni(oggi, 7);

/** Crea una società con sessione e una sua prenotazione approvata futura. */
async function prenotazioneApprovata(): Promise<{ cookieSoc: string; cookieAmm: string; id: number }> {
  const { token } = await creaSocietaConToken();
  const cookieSoc = await cookieSocieta(token);
  const creazione = await postJson('/api/societa/richieste', cookieSoc, {
    data: dataFutura, ora_inizio: '18:00', ora_fine: '19:00',
  });
  const { id } = (await creazione.json()) as { id: number };
  const cookieAmm = await cookieAdmin();
  expect((await postAdmin(`/api/admin/richieste/${id}/approva`, cookieAmm, { motivazione: 'Ok' })).status).toBe(200);
  return { cookieSoc, cookieAmm, id };
}

describe('richiesta di annullamento — vincoli lato server', () => {
  it('non permette di chiedere l\'annullamento di una prenotazione altrui', async () => {
    const { id } = await prenotazioneApprovata();
    const estranea = await creaSocietaConToken('Società Estranea');
    const cookieEstranea = await cookieSocieta(estranea.token);

    const tentativo = await postJson(`/api/societa/richieste/${id}/richiedi-annullamento`, cookieEstranea, {});
    expect(tentativo.status).toBe(404);
    expect((await slotDiRichiesta(id)).length).toBe(2);
    expect(await statoRichiesta(id)).toBe('approvata');
  });

  it('non permette di chiedere l\'annullamento di una data passata', async () => {
    const { token, id: societaId } = await creaSocietaConToken();
    const cookieSoc = await cookieSocieta(token);
    // Prenotazione approvata nel passato: inserita direttamente su DB perché
    // le API rifiutano le date passate già alla creazione.
    const esito = await env.DB
      .prepare(
        `INSERT INTO richieste (societa_id, data, ora_inizio, ora_fine, stato, decisa_at)
         VALUES (?1, ?2, '18:00', '19:00', 'approvata', datetime('now'))`,
      )
      .bind(societaId, aggiungiGiorni(oggi, -7))
      .run();
    const idPassata = esito.meta.last_row_id;

    const tentativo = await postJson(`/api/societa/richieste/${idPassata}/richiedi-annullamento`, cookieSoc, {});
    expect(tentativo.status).toBe(409);
  });

  it('non permette di chiedere l\'annullamento di una richiesta non ancora approvata', async () => {
    const { token } = await creaSocietaConToken();
    const cookieSoc = await cookieSocieta(token);
    const creazione = await postJson('/api/societa/richieste', cookieSoc, {
      data: dataFutura, ora_inizio: '20:00', ora_fine: '21:00',
    });
    const { id } = (await creazione.json()) as { id: number };

    const tentativo = await postJson(`/api/societa/richieste/${id}/richiedi-annullamento`, cookieSoc, {});
    expect(tentativo.status).toBe(409);
  });

  it('respinge una seconda richiesta di annullamento pendente sulla stessa prenotazione', async () => {
    const { cookieSoc, id } = await prenotazioneApprovata();
    expect((await postJson(`/api/societa/richieste/${id}/richiedi-annullamento`, cookieSoc, {})).status).toBe(201);
    expect((await postJson(`/api/societa/richieste/${id}/richiedi-annullamento`, cookieSoc, {})).status).toBe(409);
  });
});

describe('flusso di annullamento', () => {
  it('approvazione con motivazione: slot liberati, prenotazione annullata, fascia riprenotabile', async () => {
    const { cookieSoc, cookieAmm, id } = await prenotazioneApprovata();

    const invio = await postJson(`/api/societa/richieste/${id}/richiedi-annullamento`, cookieSoc, {});
    expect(invio.status).toBe(201);
    const { id: idAnnullamento } = (await invio.json()) as { id: number };

    // La richiesta pendente ha tipo e riferimento corretti ed è visibile alla società.
    const lista = await getConCookie('/api/societa/richieste', cookieSoc);
    const corpoLista = (await lista.json()) as { richieste: { id: number; tipo: string; richiesta_riferimento_id: number | null }[] };
    const pendente = corpoLista.richieste.find((r) => r.id === idAnnullamento);
    expect(pendente?.tipo).toBe('annullamento');
    expect(pendente?.richiesta_riferimento_id).toBe(id);

    // Finché l'admin non decide, gli slot restano occupati.
    expect((await slotDiRichiesta(id)).length).toBe(2);

    // Senza motivazione l'approvazione è respinta.
    expect((await postAdmin(`/api/admin/richieste/${idAnnullamento}/approva`, cookieAmm)).status).toBe(400);

    const approvazione = await postAdmin(`/api/admin/richieste/${idAnnullamento}/approva`, cookieAmm, {
      motivazione: 'Confermo la disdetta',
    });
    expect(approvazione.status).toBe(200);
    expect(((await approvazione.json()) as { slot_liberati: number }).slot_liberati).toBe(2);

    expect(await slotDiRichiesta(id)).toEqual([]);
    const originaria = await env.DB
      .prepare('SELECT stato, annullata_at FROM richieste WHERE id = ?1')
      .bind(id)
      .first<{ stato: string; annullata_at: string | null }>();
    expect(originaria?.stato).toBe('annullata');
    expect(originaria?.annullata_at).not.toBeNull();
    const annullamento = await env.DB
      .prepare('SELECT stato, motivazione FROM richieste WHERE id = ?1')
      .bind(idAnnullamento)
      .first<{ stato: string; motivazione: string | null }>();
    expect(annullamento?.stato).toBe('approvata');
    expect(annullamento?.motivazione).toBe('Confermo la disdetta');

    // La fascia liberata è di nuovo prenotabile da un'altra società.
    const altra = await creaSocietaConToken('Società Subentrante');
    const cookieAltra = await cookieSocieta(altra.token);
    const nuova = await postJson('/api/societa/richieste', cookieAltra, {
      data: dataFutura, ora_inizio: '18:00', ora_fine: '19:00',
    });
    const { id: idNuova } = (await nuova.json()) as { id: number };
    expect((await postAdmin(`/api/admin/richieste/${idNuova}/approva`, cookieAmm, { motivazione: 'Ok' })).status).toBe(200);
  });

  it('rifiuto con motivazione: la prenotazione resta intatta e si può richiedere di nuovo', async () => {
    const { cookieSoc, cookieAmm, id } = await prenotazioneApprovata();
    const invio = await postJson(`/api/societa/richieste/${id}/richiedi-annullamento`, cookieSoc, {});
    const { id: idAnnullamento } = (await invio.json()) as { id: number };

    const rifiuto = await postAdmin(`/api/admin/richieste/${idAnnullamento}/rifiuta`, cookieAmm, {
      motivazione: 'Preavviso troppo breve',
    });
    expect(rifiuto.status).toBe(200);

    expect((await slotDiRichiesta(id)).length).toBe(2);
    expect(await statoRichiesta(id)).toBe('approvata');
    expect(await statoRichiesta(idAnnullamento)).toBe('rifiutata');

    // L'indice UNIQUE blocca solo le richieste PENDENTI: dopo il rifiuto se
    // ne può inviare un'altra.
    expect((await postJson(`/api/societa/richieste/${id}/richiedi-annullamento`, cookieSoc, {})).status).toBe(201);
  });

  it('la cancellazione diretta dell\'admin fa decadere la richiesta di annullamento pendente', async () => {
    const { cookieSoc, cookieAmm, id } = await prenotazioneApprovata();
    const invio = await postJson(`/api/societa/richieste/${id}/richiedi-annullamento`, cookieSoc, {});
    const { id: idAnnullamento } = (await invio.json()) as { id: number };

    expect((await postAdmin(`/api/admin/richieste/${id}/annulla`, cookieAmm)).status).toBe(200);
    expect(await slotDiRichiesta(id)).toEqual([]);
    expect(await statoRichiesta(id)).toBe('annullata');
    expect(await statoRichiesta(idAnnullamento)).toBe('annullata');

    // La richiesta decaduta non è più approvabile.
    const tentativo = await postAdmin(`/api/admin/richieste/${idAnnullamento}/approva`, cookieAmm, { motivazione: 'Ok' });
    expect(tentativo.status).toBe(409);
  });
});
