/**
 * Test della modifica e dell'annullamento "da calendario" (migrazione 0009):
 *  - la società modifica direttamente le proprie richieste in attesa (singole
 *    e ricorrenti) e chiede la modifica delle prenotazioni approvate con una
 *    richiesta di tipo 'modifica' che l'admin approva (scambio atomico degli
 *    slot, prenotazione aggiornata sul posto) o rifiuta;
 *  - su una serie, "questa e le successive" produce un gruppo di richieste
 *    deciso in blocco dall'admin;
 *  - l'admin modifica e annulla direttamente le prenotazioni approvate, con lo
 *    stesso ambito.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
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
const altraDataFutura = aggiungiGiorni(oggi, 9);

type Richiesta = {
  id: number;
  data: string;
  ora_inizio: string;
  ora_fine: string;
  stato: string;
  tipo: string;
  titolo: string;
  note: string | null;
  ricorrenza_id: number | null;
  richiesta_riferimento_id: number | null;
  gruppo_id: string | null;
  rif_data: string | null;
  rif_ora_inizio: string | null;
};

/** PATCH autenticato con corpo JSON. */
async function patchJson(percorso: string, cookie: string, corpo: unknown): Promise<Response> {
  return await app.request(
    percorso,
    { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) },
    env,
  );
}

async function richiesteSocieta(cookieSoc: string): Promise<Richiesta[]> {
  const risposta = await getConCookie('/api/societa/richieste', cookieSoc);
  return ((await risposta.json()) as { richieste: Richiesta[] }).richieste;
}

async function rigaRichiesta(id: number): Promise<Richiesta> {
  const riga = await env.DB.prepare('SELECT * FROM richieste WHERE id = ?1').bind(id).first<Richiesta>();
  if (!riga) throw new Error(`richiesta ${id} non trovata`);
  return riga;
}

/** Società con sessione, admin con sessione. */
async function attori(nome = 'Polisportiva Test'): Promise<{ cookieSoc: string; cookieAmm: string; societaId: number }> {
  const { token, id } = await creaSocietaConToken(nome);
  return { cookieSoc: await cookieSocieta(token), cookieAmm: await cookieAdmin(), societaId: id };
}

/** Prenotazione approvata futura della società (18:00-19:00 di dataFutura). */
async function prenotazioneApprovata(): Promise<{ cookieSoc: string; cookieAmm: string; societaId: number; id: number }> {
  const { cookieSoc, cookieAmm, societaId } = await attori();
  const creazione = await postJson('/api/societa/richieste', cookieSoc, {
    data: dataFutura, ora_inizio: '18:00', ora_fine: '19:00', titolo: 'Allenamento', note: 'under 14',
  });
  const { id } = (await creazione.json()) as { id: number };
  expect((await postAdmin(`/api/admin/richieste/${id}/approva`, cookieAmm, { motivazione: 'Ok' })).status).toBe(200);
  return { cookieSoc, cookieAmm, societaId, id };
}

/**
 * Serie approvata di 4 occorrenze settimanali (18:00-19:00 da dataFutura),
 * ritornate in ordine di data.
 */
async function serieApprovata(): Promise<{ cookieSoc: string; cookieAmm: string; societaId: number; occorrenze: Richiesta[] }> {
  const { cookieSoc, cookieAmm, societaId } = await attori();
  const creazione = await postJson('/api/societa/richieste', cookieSoc, {
    data: dataFutura, ora_inizio: '18:00', ora_fine: '19:00', ripeti_fino_al: aggiungiGiorni(dataFutura, 21),
  });
  expect(creazione.status).toBe(201);
  const { id: ricorrenzaId } = (await creazione.json()) as { id: number };
  expect((await postAdmin(`/api/admin/ricorrenze/${ricorrenzaId}/approva`, cookieAmm, { motivazione: 'Ok' })).status).toBe(200);
  const occorrenze = (await richiesteSocieta(cookieSoc))
    .filter((r) => r.ricorrenza_id === ricorrenzaId)
    .sort((a, b) => a.data.localeCompare(b.data));
  expect(occorrenze.length).toBe(4);
  return { cookieSoc, cookieAmm, societaId, occorrenze };
}

/** Prenotazione approvata di un'altra società sugli slot indicati (per creare conflitti). */
async function occupaSlot(cookieAmm: string, data: string, oraInizio: string, oraFine: string): Promise<void> {
  const altra = await creaSocietaConToken('Società Concorrente');
  const diretta = await postAdmin('/api/admin/prenotazioni', cookieAmm, {
    societa_id: altra.id, data, ora_inizio: oraInizio, ora_fine: oraFine,
  });
  expect(diretta.status).toBe(201);
}

describe('società — modifica diretta di richieste in attesa', () => {
  it('aggiorna una richiesta singola in attesa (data, orario, attività, note)', async () => {
    const { cookieSoc } = await attori();
    const creazione = await postJson('/api/societa/richieste', cookieSoc, { data: dataFutura, ora_inizio: '18:00', ora_fine: '19:00' });
    const { id } = (await creazione.json()) as { id: number };

    const modifica = await patchJson(`/api/societa/richieste/${id}`, cookieSoc, {
      data: altraDataFutura, ora_inizio: '20:00', ora_fine: '21:30', titolo: 'Gara', note: 'cambio programma',
    });
    expect(modifica.status).toBe(200);
    const riga = await rigaRichiesta(id);
    expect(riga).toMatchObject({ data: altraDataFutura, ora_inizio: '20:00', ora_fine: '21:30', titolo: 'Gara', note: 'cambio programma', stato: 'in_attesa' });
  });

  it('rifiuta la modifica diretta di una prenotazione approvata e di richieste altrui', async () => {
    const { cookieSoc, id } = await prenotazioneApprovata();
    const tentativo = await patchJson(`/api/societa/richieste/${id}`, cookieSoc, { data: dataFutura, ora_inizio: '20:00', ora_fine: '21:00' });
    expect(tentativo.status).toBe(409);

    const estranea = await creaSocietaConToken('Società Estranea');
    const cookieEstranea = await cookieSocieta(estranea.token);
    expect((await patchJson(`/api/societa/richieste/${id}`, cookieEstranea, { data: dataFutura, ora_inizio: '20:00', ora_fine: '21:00' })).status).toBe(404);
  });

  it('non sposta una richiesta in attesa su fasce occupate e non la rende ricorrente', async () => {
    const { cookieSoc, cookieAmm } = await attori();
    const creazione = await postJson('/api/societa/richieste', cookieSoc, { data: dataFutura, ora_inizio: '18:00', ora_fine: '19:00' });
    const { id } = (await creazione.json()) as { id: number };
    await occupaSlot(cookieAmm, dataFutura, '20:00', '21:00');

    const conflitto = await patchJson(`/api/societa/richieste/${id}`, cookieSoc, { data: dataFutura, ora_inizio: '20:00', ora_fine: '21:00' });
    expect(conflitto.status).toBe(409);
    expect(((await conflitto.json()) as { fasce_occupate: unknown[] }).fasce_occupate.length).toBe(1);

    const ricorrente = await patchJson(`/api/societa/richieste/${id}`, cookieSoc, {
      data: dataFutura, ora_inizio: '18:00', ora_fine: '19:00', ripeti_fino_al: aggiungiGiorni(dataFutura, 14),
    });
    expect(ricorrente.status).toBe(400);
    expect((await rigaRichiesta(id)).ora_inizio).toBe('18:00');
  });

  it('aggiorna una ricorrenza in attesa (giorni, orario, periodo) e ne ricalcola le date', async () => {
    const { cookieSoc } = await attori();
    const creazione = await postJson('/api/societa/richieste', cookieSoc, {
      data: dataFutura, ora_inizio: '18:00', ora_fine: '19:00', ripeti_fino_al: aggiungiGiorni(dataFutura, 21),
    });
    const { id } = (await creazione.json()) as { id: number };

    const modifica = await patchJson(`/api/societa/ricorrenze/${id}`, cookieSoc, {
      data: dataFutura, ora_inizio: '19:00', ora_fine: '20:00', ripeti_fino_al: aggiungiGiorni(dataFutura, 7),
      giorni: [(new Date(`${dataFutura}T00:00:00Z`).getUTCDay() + 6 + 1) % 7], // il giorno dopo quello della data
      titolo: 'Gara',
    });
    expect(modifica.status).toBe(200);
    const { occorrenze } = (await modifica.json()) as { occorrenze: string[] };
    // Finestra di 8 giorni: il giorno della data cade due volte, quello dopo una sola.
    expect(occorrenze).toEqual([dataFutura, aggiungiGiorni(dataFutura, 1), aggiungiGiorni(dataFutura, 7)]);
    const riga = await env.DB
      .prepare('SELECT ora_inizio, ora_fine, valida_al, titolo, stato FROM ricorrenze WHERE id = ?1')
      .bind(id)
      .first<{ ora_inizio: string; ora_fine: string; valida_al: string; titolo: string; stato: string }>();
    expect(riga).toEqual({ ora_inizio: '19:00', ora_fine: '20:00', valida_al: aggiungiGiorni(dataFutura, 7), titolo: 'Gara', stato: 'in_attesa' });

    // Deve restare ricorrente.
    const singola = await patchJson(`/api/societa/ricorrenze/${id}`, cookieSoc, { data: dataFutura, ora_inizio: '19:00', ora_fine: '20:00' });
    expect(singola.status).toBe(400);
  });
});

describe('società — richiesta di modifica di una prenotazione approvata', () => {
  it('crea una richiesta di modifica con i nuovi estremi senza toccare gli slot', async () => {
    const { cookieSoc, id } = await prenotazioneApprovata();
    const invio = await postJson(`/api/societa/richieste/${id}/richiedi-modifica`, cookieSoc, {
      data: altraDataFutura, ora_inizio: '20:00', ora_fine: '21:00', titolo: 'Gara', note: 'trasferta annullata',
    });
    expect(invio.status).toBe(201);
    const { tipo, id: idModifica, gruppo_id } = (await invio.json()) as { tipo: string; id: number; gruppo_id: string | null };
    expect(tipo).toBe('modifica');
    expect(gruppo_id).toBeNull();

    const pendente = (await richiesteSocieta(cookieSoc)).find((r) => r.id === idModifica);
    expect(pendente).toMatchObject({
      tipo: 'modifica', stato: 'in_attesa', data: altraDataFutura, ora_inizio: '20:00', ora_fine: '21:00',
      titolo: 'Gara', richiesta_riferimento_id: id, rif_data: dataFutura, rif_ora_inizio: '18:00',
    });
    // La prenotazione originale resta intatta finché l'admin non decide.
    expect(await slotDiRichiesta(id)).toEqual([`${dataFutura}_1800`, `${dataFutura}_1830`]);
    expect((await rigaRichiesta(id)).data).toBe(dataFutura);
  });

  it('respinge una modifica senza effetto e una seconda richiesta pendente sulla stessa prenotazione', async () => {
    const { cookieSoc, id } = await prenotazioneApprovata();
    const identica = await postJson(`/api/societa/richieste/${id}/richiedi-modifica`, cookieSoc, {
      ora_inizio: '18:00', ora_fine: '19:00', titolo: 'Allenamento', note: 'under 14',
    });
    expect(identica.status).toBe(400);

    expect((await postJson(`/api/societa/richieste/${id}/richiedi-modifica`, cookieSoc, { ora_inizio: '19:00', ora_fine: '20:00' })).status).toBe(201);
    // Un annullamento pendente sulla stessa prenotazione è escluso dall'indice UNIQUE.
    expect((await postJson(`/api/societa/richieste/${id}/richiedi-annullamento`, cookieSoc, {})).status).toBe(409);
  });

  it('ignora i propri slot nel controllo di disponibilità ma vede quelli altrui', async () => {
    const { cookieSoc, cookieAmm, id } = await prenotazioneApprovata();
    // 18:30-19:30 si sovrappone ai propri 18:30: non è un conflitto.
    const spostamento = await postJson(`/api/societa/richieste/${id}/richiedi-modifica`, cookieSoc, { ora_inizio: '18:30', ora_fine: '19:30' });
    expect(spostamento.status).toBe(201);
    const { id: idModifica } = (await spostamento.json()) as { id: number };
    expect((await postJson(`/api/societa/richieste/${idModifica}/annulla`, cookieSoc, {})).status).toBe(200);

    await occupaSlot(cookieAmm, dataFutura, '19:00', '20:00');
    const conflitto = await postJson(`/api/societa/richieste/${id}/richiedi-modifica`, cookieSoc, { ora_inizio: '18:30', ora_fine: '19:30' });
    expect(conflitto.status).toBe(409);
    const corpo = (await conflitto.json()) as { fasce_occupate: { data: string; ora_inizio: string; ora_fine: string }[] };
    expect(corpo.fasce_occupate).toEqual([{ data: dataFutura, ora_inizio: '19:00', ora_fine: '19:30' }]);
    expect(JSON.stringify(corpo)).not.toContain('Concorrente');
  });

  it("approvazione: slot scambiati, prenotazione aggiornata sul posto con lo stesso id", async () => {
    const { cookieSoc, cookieAmm, id } = await prenotazioneApprovata();
    const invio = await postJson(`/api/societa/richieste/${id}/richiedi-modifica`, cookieSoc, {
      data: altraDataFutura, ora_inizio: '20:00', ora_fine: '21:30', titolo: 'Gara',
    });
    const { id: idModifica } = (await invio.json()) as { id: number };

    const approvazione = await postAdmin(`/api/admin/richieste/${idModifica}/approva`, cookieAmm, { motivazione: 'Ok' });
    expect(approvazione.status).toBe(200);
    expect(await approvazione.json()).toMatchObject({ ok: true, slot_liberati: 2, slot_inseriti: 3 });

    expect(await slotDiRichiesta(id)).toEqual([`${altraDataFutura}_2000`, `${altraDataFutura}_2030`, `${altraDataFutura}_2100`]);
    expect(await rigaRichiesta(id)).toMatchObject({ stato: 'approvata', data: altraDataFutura, ora_inizio: '20:00', ora_fine: '21:30', titolo: 'Gara' });
    expect(await rigaRichiesta(idModifica)).toMatchObject({ stato: 'approvata', motivazione: 'Ok' });
    // La richiesta di modifica approvata non occupa slot propri.
    expect(await slotDiRichiesta(idModifica)).toEqual([]);
    // La vecchia fascia è di nuovo libera.
    await occupaSlot(cookieAmm, dataFutura, '18:00', '19:00');
  });

  it('approvazione respinta se nel frattempo i nuovi slot sono stati occupati (nulla cambia)', async () => {
    const { cookieSoc, cookieAmm, id } = await prenotazioneApprovata();
    const invio = await postJson(`/api/societa/richieste/${id}/richiedi-modifica`, cookieSoc, { ora_inizio: '20:00', ora_fine: '21:00' });
    const { id: idModifica } = (await invio.json()) as { id: number };
    await occupaSlot(cookieAmm, dataFutura, '20:30', '21:00');

    const approvazione = await postAdmin(`/api/admin/richieste/${idModifica}/approva`, cookieAmm, { motivazione: 'Ok' });
    expect(approvazione.status).toBe(409);
    expect(((await approvazione.json()) as { conflitti: unknown[] }).conflitti.length).toBe(1);
    expect(await statoRichiesta(idModifica)).toBe('in_attesa');
    expect(await slotDiRichiesta(id)).toEqual([`${dataFutura}_1800`, `${dataFutura}_1830`]);
  });

  it('rifiuto: la prenotazione resta intatta e la società può riprovare', async () => {
    const { cookieSoc, cookieAmm, id } = await prenotazioneApprovata();
    const invio = await postJson(`/api/societa/richieste/${id}/richiedi-modifica`, cookieSoc, { ora_inizio: '20:00', ora_fine: '21:00' });
    const { id: idModifica } = (await invio.json()) as { id: number };
    expect((await postAdmin(`/api/admin/richieste/${idModifica}/rifiuta`, cookieAmm, { motivazione: 'Fascia riservata' })).status).toBe(200);
    expect(await statoRichiesta(idModifica)).toBe('rifiutata');
    expect(await rigaRichiesta(id)).toMatchObject({ stato: 'approvata', ora_inizio: '18:00' });
    expect((await postJson(`/api/societa/richieste/${id}/richiedi-modifica`, cookieSoc, { ora_inizio: '21:00', ora_fine: '22:00' })).status).toBe(201);
  });

  it('il cambio di data approvato sgancia l\'occorrenza dalla sua ricorrenza', async () => {
    const { cookieSoc, cookieAmm, occorrenze } = await serieApprovata();
    const seconda = occorrenze[1];
    const invio = await postJson(`/api/societa/richieste/${seconda.id}/richiedi-modifica`, cookieSoc, {
      data: aggiungiGiorni(seconda.data, 1), ora_inizio: '18:00', ora_fine: '19:00',
    });
    expect(invio.status).toBe(201);
    const { id: idModifica } = (await invio.json()) as { id: number };
    expect((await postAdmin(`/api/admin/richieste/${idModifica}/approva`, cookieAmm, { motivazione: 'Ok' })).status).toBe(200);
    expect(await rigaRichiesta(seconda.id)).toMatchObject({ data: aggiungiGiorni(seconda.data, 1), ricorrenza_id: null });
    // Le altre occorrenze restano nella serie, immutate.
    expect((await rigaRichiesta(occorrenze[2].id)).ricorrenza_id).toBe(seconda.ricorrenza_id);
  });
});

describe('società — gruppi su "questa e le successive"', () => {
  it('la richiesta di modifica sulle successive crea un gruppo e non tocca le precedenti', async () => {
    const { cookieSoc, occorrenze } = await serieApprovata();
    const invio = await postJson(`/api/societa/richieste/${occorrenze[1].id}/richiedi-modifica`, cookieSoc, {
      ora_inizio: '19:00', ora_fine: '20:00', ambito: 'successive',
    });
    expect(invio.status).toBe(201);
    const corpo = (await invio.json()) as { gruppo_id: string; richieste: number };
    expect(corpo.richieste).toBe(3);
    expect(corpo.gruppo_id).toMatch(/^[0-9a-f-]{36}$/);

    const pendenti = (await richiesteSocieta(cookieSoc)).filter((r) => r.gruppo_id === corpo.gruppo_id);
    expect(pendenti.length).toBe(3);
    expect(pendenti.map((r) => r.richiesta_riferimento_id).sort()).toEqual(occorrenze.slice(1).map((o) => o.id).sort());
    // Ogni membro conserva la data della propria occorrenza.
    for (const pendente of pendenti) expect(pendente.data).toBe(pendente.rif_data);
  });

  it('con ambito successive la data non si può cambiare', async () => {
    const { cookieSoc, occorrenze } = await serieApprovata();
    const invio = await postJson(`/api/societa/richieste/${occorrenze[0].id}/richiedi-modifica`, cookieSoc, {
      data: aggiungiGiorni(dataFutura, 1), ora_inizio: '18:00', ora_fine: '19:00', ambito: 'successive',
    });
    expect(invio.status).toBe(400);
  });

  it('i membri di un gruppo non si decidono né si ritirano singolarmente', async () => {
    const { cookieSoc, cookieAmm, occorrenze } = await serieApprovata();
    const invio = await postJson(`/api/societa/richieste/${occorrenze[2].id}/richiedi-annullamento`, cookieSoc, { ambito: 'successive' });
    expect(invio.status).toBe(201);
    const { id: idMembro } = (await invio.json()) as { id: number };
    expect((await postAdmin(`/api/admin/richieste/${idMembro}/approva`, cookieAmm, { motivazione: 'Ok' })).status).toBe(409);
    expect((await postAdmin(`/api/admin/richieste/${idMembro}/rifiuta`, cookieAmm, { motivazione: 'No' })).status).toBe(409);
    expect((await postJson(`/api/societa/richieste/${idMembro}/annulla`, cookieSoc, {})).status).toBe(409);
    expect(await statoRichiesta(idMembro)).toBe('in_attesa');
  });

  it('approvazione di un gruppo di modifica: tutte le occorrenze aggiornate, nello stesso batch', async () => {
    const { cookieSoc, cookieAmm, occorrenze } = await serieApprovata();
    const invio = await postJson(`/api/societa/richieste/${occorrenze[1].id}/richiedi-modifica`, cookieSoc, {
      ora_inizio: '19:00', ora_fine: '20:30', titolo: 'Gara', ambito: 'successive',
    });
    const { gruppo_id } = (await invio.json()) as { gruppo_id: string };

    const approvazione = await postAdmin(`/api/admin/gruppi/${gruppo_id}/approva`, cookieAmm, { motivazione: 'Ok' });
    expect(approvazione.status).toBe(200);
    expect(await approvazione.json()).toMatchObject({ ok: true, richieste_approvate: 3, slot_liberati: 6, slot_inseriti: 9 });

    expect(await rigaRichiesta(occorrenze[0].id)).toMatchObject({ ora_inizio: '18:00', ora_fine: '19:00', titolo: 'Allenamento' });
    for (const occorrenza of occorrenze.slice(1)) {
      expect(await rigaRichiesta(occorrenza.id)).toMatchObject({
        stato: 'approvata', data: occorrenza.data, ora_inizio: '19:00', ora_fine: '20:30', titolo: 'Gara', ricorrenza_id: occorrenza.ricorrenza_id,
      });
      expect(await slotDiRichiesta(occorrenza.id)).toEqual([`${occorrenza.data}_1900`, `${occorrenza.data}_1930`, `${occorrenza.data}_2000`]);
    }
    // Il gruppo non è più approvabile una seconda volta.
    expect((await postAdmin(`/api/admin/gruppi/${gruppo_id}/approva`, cookieAmm, { motivazione: 'Ok' })).status).toBe(409);
  });

  it('un conflitto su una sola occorrenza blocca l\'intero gruppo di modifica', async () => {
    const { cookieSoc, cookieAmm, occorrenze } = await serieApprovata();
    const invio = await postJson(`/api/societa/richieste/${occorrenze[0].id}/richiedi-modifica`, cookieSoc, {
      ora_inizio: '20:00', ora_fine: '21:00', ambito: 'successive',
    });
    const { gruppo_id } = (await invio.json()) as { gruppo_id: string };
    await occupaSlot(cookieAmm, occorrenze[3].data, '20:00', '20:30');

    const approvazione = await postAdmin(`/api/admin/gruppi/${gruppo_id}/approva`, cookieAmm, { motivazione: 'Ok' });
    expect(approvazione.status).toBe(409);
    for (const occorrenza of occorrenze) {
      expect((await rigaRichiesta(occorrenza.id)).ora_inizio).toBe('18:00');
      expect((await slotDiRichiesta(occorrenza.id)).length).toBe(2);
    }
  });

  it('gruppo di annullamento: approvazione libera tutte le date, rifiuto e ritiro le lasciano intatte', async () => {
    const { cookieSoc, cookieAmm, occorrenze } = await serieApprovata();
    const primoInvio = await postJson(`/api/societa/richieste/${occorrenze[2].id}/richiedi-annullamento`, cookieSoc, { ambito: 'successive' });
    const { gruppo_id: primoGruppo } = (await primoInvio.json()) as { gruppo_id: string };

    // Rifiuto: nulla cambia, si può richiedere di nuovo.
    expect((await postAdmin(`/api/admin/gruppi/${primoGruppo}/rifiuta`, cookieAmm, { motivazione: 'Preavviso breve' })).status).toBe(200);
    expect((await slotDiRichiesta(occorrenze[3].id)).length).toBe(2);

    // Ritiro da parte della società.
    const secondoInvio = await postJson(`/api/societa/richieste/${occorrenze[2].id}/richiedi-annullamento`, cookieSoc, { ambito: 'successive' });
    const { gruppo_id: secondoGruppo } = (await secondoInvio.json()) as { gruppo_id: string };
    const ritiro = await postJson(`/api/societa/gruppi/${secondoGruppo}/annulla`, cookieSoc, {});
    expect(ritiro.status).toBe(200);
    expect(((await ritiro.json()) as { richieste_ritirate: number }).richieste_ritirate).toBe(2);

    // Approvazione.
    const terzoInvio = await postJson(`/api/societa/richieste/${occorrenze[2].id}/richiedi-annullamento`, cookieSoc, { ambito: 'successive' });
    const { gruppo_id: terzoGruppo } = (await terzoInvio.json()) as { gruppo_id: string };
    const approvazione = await postAdmin(`/api/admin/gruppi/${terzoGruppo}/approva`, cookieAmm, { motivazione: 'Ok' });
    expect(approvazione.status).toBe(200);
    expect(await approvazione.json()).toMatchObject({ richieste_approvate: 2, slot_liberati: 4 });
    expect(await statoRichiesta(occorrenze[2].id)).toBe('annullata');
    expect(await statoRichiesta(occorrenze[3].id)).toBe('annullata');
    expect(await slotDiRichiesta(occorrenze[3].id)).toEqual([]);
    expect(await statoRichiesta(occorrenze[1].id)).toBe('approvata');
  });

  it('un gruppo altrui non si ritira', async () => {
    const { cookieSoc, occorrenze } = await serieApprovata();
    const invio = await postJson(`/api/societa/richieste/${occorrenze[0].id}/richiedi-annullamento`, cookieSoc, { ambito: 'successive' });
    const { gruppo_id } = (await invio.json()) as { gruppo_id: string };
    const estranea = await creaSocietaConToken('Società Estranea');
    const cookieEstranea = await cookieSocieta(estranea.token);
    expect((await postJson(`/api/societa/gruppi/${gruppo_id}/annulla`, cookieEstranea, {})).status).toBe(409);
    expect((await postJson('/api/societa/gruppi/non-un-uuid/annulla', cookieSoc, {})).status).toBe(400);
  });
});

describe('admin — modifica e annullamento diretti dal calendario', () => {
  it('modifica una singola prenotazione (data e orario) e fa decadere le richieste pendenti su di essa', async () => {
    const { cookieSoc, cookieAmm, id } = await prenotazioneApprovata();
    const pendente = await postJson(`/api/societa/richieste/${id}/richiedi-annullamento`, cookieSoc, {});
    const { id: idPendente } = (await pendente.json()) as { id: number };

    const modifica = await patchJson(`/api/admin/richieste/${id}`, cookieAmm, {
      data: altraDataFutura, ora_inizio: '10:00', ora_fine: '11:30', titolo: 'Manutenzione', note: 'spostata',
    });
    expect(modifica.status).toBe(200);
    expect(await modifica.json()).toMatchObject({ ok: true, richieste_modificate: 1, slot_inseriti: 3, date: [altraDataFutura] });
    expect(await rigaRichiesta(id)).toMatchObject({ data: altraDataFutura, ora_inizio: '10:00', ora_fine: '11:30', titolo: 'Manutenzione', note: 'spostata' });
    expect(await slotDiRichiesta(id)).toEqual([`${altraDataFutura}_1000`, `${altraDataFutura}_1030`, `${altraDataFutura}_1100`]);
    expect(await statoRichiesta(idPendente)).toBe('annullata');
  });

  it('rifiuta modifiche senza effetto, su richieste in attesa, con date passate o con conflitti', async () => {
    const { cookieSoc, cookieAmm, id } = await prenotazioneApprovata();
    expect((await patchJson(`/api/admin/richieste/${id}`, cookieAmm, { ora_inizio: '18:00', ora_fine: '19:00', titolo: 'Allenamento', note: 'under 14' })).status).toBe(400);
    expect((await patchJson(`/api/admin/richieste/${id}`, cookieAmm, { data: aggiungiGiorni(oggi, -1), ora_inizio: '18:00', ora_fine: '19:00' })).status).toBe(400);

    await occupaSlot(cookieAmm, dataFutura, '19:00', '19:30');
    const conflitto = await patchJson(`/api/admin/richieste/${id}`, cookieAmm, { ora_inizio: '18:30', ora_fine: '19:30' });
    expect(conflitto.status).toBe(409);
    expect(((await conflitto.json()) as { conflitti: { societa: string }[] }).conflitti[0].societa).toBe('Società Concorrente');
    expect(await slotDiRichiesta(id)).toEqual([`${dataFutura}_1800`, `${dataFutura}_1830`]);

    const inAttesa = await postJson('/api/societa/richieste', cookieSoc, { data: altraDataFutura, ora_inizio: '18:00', ora_fine: '19:00' });
    const { id: idInAttesa } = (await inAttesa.json()) as { id: number };
    expect((await patchJson(`/api/admin/richieste/${idInAttesa}`, cookieAmm, { ora_inizio: '20:00', ora_fine: '21:00' })).status).toBe(409);
  });

  it('modifica "questa e le successive": orario propagato, date conservate, serie intatta', async () => {
    const { cookieAmm, occorrenze } = await serieApprovata();
    const modifica = await patchJson(`/api/admin/richieste/${occorrenze[1].id}`, cookieAmm, {
      ora_inizio: '21:00', ora_fine: '22:00', ambito: 'successive',
    });
    expect(modifica.status).toBe(200);
    expect(await modifica.json()).toMatchObject({ richieste_modificate: 3, slot_inseriti: 6 });
    expect(await rigaRichiesta(occorrenze[0].id)).toMatchObject({ ora_inizio: '18:00' });
    for (const occorrenza of occorrenze.slice(1)) {
      expect(await rigaRichiesta(occorrenza.id)).toMatchObject({ data: occorrenza.data, ora_inizio: '21:00', ora_fine: '22:00', ricorrenza_id: occorrenza.ricorrenza_id });
    }
    // La data non si propaga alla serie.
    const conData = await patchJson(`/api/admin/richieste/${occorrenze[1].id}`, cookieAmm, {
      data: aggiungiGiorni(dataFutura, 1), ora_inizio: '21:00', ora_fine: '22:00', ambito: 'successive',
    });
    expect(conData.status).toBe(400);
  });

  it('annullamento "questa e le successive" libera solo le occorrenze dalla cliccata in avanti', async () => {
    const { cookieAmm, occorrenze } = await serieApprovata();
    const annullamento = await postAdmin(`/api/admin/richieste/${occorrenze[2].id}/annulla`, cookieAmm, { ambito: 'successive' });
    expect(annullamento.status).toBe(200);
    expect(await annullamento.json()).toMatchObject({ ok: true, richieste_annullate: 2, slot_liberati: 4 });
    expect(await statoRichiesta(occorrenze[1].id)).toBe('approvata');
    expect(await statoRichiesta(occorrenze[2].id)).toBe('annullata');
    expect(await statoRichiesta(occorrenze[3].id)).toBe('annullata');
    // Senza corpo l'ambito resta la singola richiesta (comportamento di prima).
    expect((await postAdmin(`/api/admin/richieste/${occorrenze[0].id}/annulla`, cookieAmm)).status).toBe(200);
    expect(await statoRichiesta(occorrenze[1].id)).toBe('approvata');
  });

  it('il calendario admin espone la ricorrenza di ogni slot', async () => {
    const { cookieAmm, occorrenze } = await serieApprovata();
    const risposta = await getConCookie(`/api/admin/calendario?settimana=${dataFutura}`, cookieAmm);
    const { prenotazioni } = (await risposta.json()) as { prenotazioni: { richiesta_id: number; ricorrenza_id: number | null }[] };
    const slot = prenotazioni.find((p) => p.richiesta_id === occorrenze[0].id);
    expect(slot?.ricorrenza_id).toBe(occorrenze[0].ricorrenza_id);
  });
});
