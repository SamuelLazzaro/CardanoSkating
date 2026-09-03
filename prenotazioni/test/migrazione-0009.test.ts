/**
 * Test della migrazione 0009 (ricostruzione della tabella richieste): il
 * nuovo tipo 'modifica' e la colonna gruppo_id esistono, i vincoli della
 * tabella originale sono sopravvissuti alla ricostruzione (CHECK, foreign key,
 * indici UNIQUE, AUTOINCREMENT) e l'indice sulle richieste pendenti riferite
 * a una prenotazione esclude a vicenda annullamento e modifica.
 */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { creaSocieta } from './helpers';

/** Inserisce una richiesta con i campi dati e ritorna il suo id. */
async function inserisciRichiesta(campi: Record<string, string | number | null>): Promise<number> {
  const colonne = Object.keys(campi);
  const segnaposto = colonne.map((_, indice) => `?${indice + 1}`).join(', ');
  const esito = await env.DB
    .prepare(`INSERT INTO richieste (${colonne.join(', ')}) VALUES (${segnaposto})`)
    .bind(...Object.values(campi))
    .run();
  return esito.meta.last_row_id;
}

describe('migrazione 0009 — tabella richieste ricostruita', () => {
  it("accetta il tipo 'modifica' e la colonna gruppo_id, rifiuta tipi sconosciuti", async () => {
    const societaId = await creaSocieta();
    const originale = await inserisciRichiesta({ societa_id: societaId, data: '2030-01-07', ora_inizio: '18:00', ora_fine: '19:00' });
    const modifica = await inserisciRichiesta({
      societa_id: societaId, data: '2030-01-07', ora_inizio: '19:00', ora_fine: '20:00',
      tipo: 'modifica', richiesta_riferimento_id: originale, gruppo_id: 'gruppo-di-prova',
    });
    const riga = await env.DB
      .prepare('SELECT tipo, gruppo_id FROM richieste WHERE id = ?1')
      .bind(modifica)
      .first<{ tipo: string; gruppo_id: string }>();
    expect(riga).toEqual({ tipo: 'modifica', gruppo_id: 'gruppo-di-prova' });

    await expect(
      inserisciRichiesta({ societa_id: societaId, data: '2030-01-07', ora_inizio: '18:00', ora_fine: '19:00', tipo: 'altro' }),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('una sola richiesta pendente per prenotazione, che sia di annullamento o di modifica', async () => {
    const societaId = await creaSocieta();
    const originale = await inserisciRichiesta({
      societa_id: societaId, data: '2030-01-07', ora_inizio: '18:00', ora_fine: '19:00', stato: 'approvata',
    });
    await inserisciRichiesta({
      societa_id: societaId, data: '2030-01-07', ora_inizio: '18:00', ora_fine: '19:00',
      tipo: 'annullamento', richiesta_riferimento_id: originale,
    });
    // Seconda pendente sulla stessa prenotazione, di tipo diverso: respinta dal DB.
    await expect(
      inserisciRichiesta({
        societa_id: societaId, data: '2030-01-08', ora_inizio: '18:00', ora_fine: '19:00',
        tipo: 'modifica', richiesta_riferimento_id: originale,
      }),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    // Una richiesta già decisa non conta: l'indice è parziale sullo stato.
    await inserisciRichiesta({
      societa_id: societaId, data: '2030-01-08', ora_inizio: '18:00', ora_fine: '19:00',
      tipo: 'modifica', richiesta_riferimento_id: originale, stato: 'rifiutata',
    });
  });

  it('le foreign key e l\'indice (ricorrenza, data) sono ancora attivi dopo la ricostruzione', async () => {
    const societaId = await creaSocieta();
    await expect(
      env.DB.prepare("INSERT INTO prenotazioni (slot_key, societa_id, richiesta_id) VALUES ('2030-01-07_1800', ?1, 999999)")
        .bind(societaId)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    await expect(
      inserisciRichiesta({ societa_id: 999999, data: '2030-01-07', ora_inizio: '18:00', ora_fine: '19:00' }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);

    const ricorrenza = await env.DB
      .prepare(
        `INSERT INTO ricorrenze (societa_id, giorni, ora_inizio, ora_fine, valida_dal, valida_al)
         VALUES (?1, '0', '18:00', '19:00', '2030-01-07', '2030-01-28')`,
      )
      .bind(societaId)
      .run();
    const ricorrenzaId = ricorrenza.meta.last_row_id;
    await inserisciRichiesta({ societa_id: societaId, data: '2030-01-07', ora_inizio: '18:00', ora_fine: '19:00', ricorrenza_id: ricorrenzaId });
    await expect(
      inserisciRichiesta({ societa_id: societaId, data: '2030-01-07', ora_inizio: '18:00', ora_fine: '19:00', ricorrenza_id: ricorrenzaId }),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('gli id continuano a crescere (AUTOINCREMENT conservato dalla rinomina)', async () => {
    const societaId = await creaSocieta();
    const primo = await inserisciRichiesta({ societa_id: societaId, data: '2030-01-07', ora_inizio: '18:00', ora_fine: '19:00' });
    await env.DB.prepare('DELETE FROM richieste WHERE id = ?1').bind(primo).run();
    const secondo = await inserisciRichiesta({ societa_id: societaId, data: '2030-01-07', ora_inizio: '18:00', ora_fine: '19:00' });
    // Con AUTOINCREMENT un id cancellato non viene mai riassegnato.
    expect(secondo).toBeGreaterThan(primo);
    const sequenza = await env.DB
      .prepare("SELECT name FROM sqlite_sequence WHERE name = 'richieste'")
      .first<{ name: string }>();
    expect(sequenza?.name).toBe('richieste');
  });
});
