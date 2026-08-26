/*
 * Test di slotSocietaSettimana (public/js/utils.js): la classificazione degli
 * slot che una società possiede in una settimana, divisi tra prenotazioni
 * approvate e richieste ancora da decidere. Il secondo insieme è quello che
 * colora di giallo il calendario dell'area società, evitando che la stessa
 * fascia venga richiesta due volte.
 *
 * Il file è .js e non .ts perché il modulo sotto test è JavaScript del
 * frontend: così resta importabile senza abilitare allowJs nel tsconfig.
 */
import { describe, expect, it } from 'vitest';
import { slotSocietaSettimana } from '../public/js/utils.js';

/** Lunedì della settimana usata da tutti i test (24–30 agosto 2026). */
const LUNEDI = '2026-08-24';

/** Mercoledì della stessa settimana: giorno_settimana = 2 (0 = lunedì). */
const MERCOLEDI = '2026-08-26';

/**
 * @param {object} campi - campi da sovrascrivere
 * @returns {object} richiesta di prenotazione con i default del caso normale
 */
const richiesta = (campi) => ({
  tipo: 'nuova',
  stato: 'approvata',
  data: MERCOLEDI,
  ora_inizio: '18:00',
  ora_fine: '19:00',
  ...campi,
});

/**
 * @param {object} campi - campi da sovrascrivere
 * @returns {object} ricorrenza settimanale con i default del caso normale
 */
const ricorrenza = (campi) => ({
  stato: 'in_attesa',
  giorno_settimana: 2, // mercoledì
  ora_inizio: '20:00',
  ora_fine: '21:00',
  valida_dal: LUNEDI,
  valida_al: '2026-09-14',
  ...campi,
});

/**
 * @param {Set<string>} insieme - insieme di slot key
 * @returns {string[]} le chiavi ordinate, per asserzioni leggibili
 */
const ordinati = (insieme) => [...insieme].sort();

describe('slotSocietaSettimana — richieste su singola data', () => {
  it('mette una richiesta approvata tra gli slot approvati', () => {
    const { approvati, inAttesa } = slotSocietaSettimana([richiesta({})], [], LUNEDI);
    expect(ordinati(approvati)).toEqual(['2026-08-26_1800', '2026-08-26_1830']);
    expect(inAttesa.size).toBe(0);
  });

  it('mette una richiesta in attesa tra gli slot in attesa, non tra gli approvati', () => {
    const { approvati, inAttesa } = slotSocietaSettimana(
      [richiesta({ stato: 'in_attesa' })],
      [],
      LUNEDI,
    );
    expect(approvati.size).toBe(0);
    expect(ordinati(inAttesa)).toEqual(['2026-08-26_1800', '2026-08-26_1830']);
  });

  it('ignora le richieste rifiutate e annullate', () => {
    const { approvati, inAttesa } = slotSocietaSettimana(
      [richiesta({ stato: 'rifiutata' }), richiesta({ stato: 'annullata' })],
      [],
      LUNEDI,
    );
    expect(approvati.size).toBe(0);
    expect(inAttesa.size).toBe(0);
  });

  it('tiene le due categorie separate quando convivono nella stessa settimana', () => {
    const { approvati, inAttesa } = slotSocietaSettimana(
      [
        richiesta({ data: '2026-08-24', ora_inizio: '10:00', ora_fine: '10:30' }),
        richiesta({ stato: 'in_attesa', data: '2026-08-25', ora_inizio: '11:00', ora_fine: '11:30' }),
      ],
      [],
      LUNEDI,
    );
    expect(ordinati(approvati)).toEqual(['2026-08-24_1000']);
    expect(ordinati(inAttesa)).toEqual(['2026-08-25_1100']);
  });
});

describe('slotSocietaSettimana — richieste di annullamento', () => {
  /*
   * Una richiesta di annullamento non porta slot propri: si limita a puntare
   * a una prenotazione esistente. Finché è in attesa la prenotazione è ancora
   * valida (deve restare "approvata", non diventare "in attesa"), e una volta
   * approvata la prenotazione è già stata liberata.
   */
  it('non tocca nessuno dei due insiemi, né in attesa né approvata', () => {
    const annullamenti = [
      richiesta({ tipo: 'annullamento', stato: 'in_attesa' }),
      richiesta({ tipo: 'annullamento', stato: 'approvata' }),
    ];
    const { approvati, inAttesa } = slotSocietaSettimana(annullamenti, [], LUNEDI);
    expect(approvati.size).toBe(0);
    expect(inAttesa.size).toBe(0);
  });

  it('lascia approvata la prenotazione con un annullamento ancora in attesa', () => {
    const { approvati, inAttesa } = slotSocietaSettimana(
      [richiesta({}), richiesta({ tipo: 'annullamento', stato: 'in_attesa' })],
      [],
      LUNEDI,
    );
    expect(ordinati(approvati)).toEqual(['2026-08-26_1800', '2026-08-26_1830']);
    expect(inAttesa.size).toBe(0);
  });
});

describe('slotSocietaSettimana — confini della settimana mostrata', () => {
  it('esclude la domenica precedente e include il lunedì di apertura', () => {
    const { approvati } = slotSocietaSettimana(
      [
        richiesta({ data: '2026-08-23' }), // domenica prima
        richiesta({ data: LUNEDI }),
      ],
      [],
      LUNEDI,
    );
    expect(ordinati(approvati)).toEqual(['2026-08-24_1800', '2026-08-24_1830']);
  });

  it('include la domenica finale ed esclude il lunedì successivo', () => {
    const { approvati } = slotSocietaSettimana(
      [
        richiesta({ data: '2026-08-30' }), // domenica della settimana
        richiesta({ data: '2026-08-31' }), // lunedì dopo
      ],
      [],
      LUNEDI,
    );
    expect(ordinati(approvati)).toEqual(['2026-08-30_1800', '2026-08-30_1830']);
  });
});

describe('slotSocietaSettimana — ricorrenze in attesa', () => {
  /*
   * Una ricorrenza in attesa non ha ancora righe in richieste: se non la si
   * espandesse qui, le sue fasce sembrerebbero libere nel calendario e la
   * società potrebbe richiederle una seconda volta.
   */
  it('espande la ricorrenza in attesa sul giorno della settimana giusto', () => {
    const { approvati, inAttesa } = slotSocietaSettimana([], [ricorrenza({})], LUNEDI);
    expect(approvati.size).toBe(0);
    expect(ordinati(inAttesa)).toEqual(['2026-08-26_2000', '2026-08-26_2030']);
  });

  it('rispetta la convenzione 0 = lunedì .. 6 = domenica', () => {
    const { inAttesa } = slotSocietaSettimana(
      [],
      [ricorrenza({ giorno_settimana: 0 }), ricorrenza({ giorno_settimana: 6 })],
      LUNEDI,
    );
    expect(ordinati(inAttesa)).toEqual([
      '2026-08-24_2000', '2026-08-24_2030', // lunedì
      '2026-08-30_2000', '2026-08-30_2030', // domenica
    ]);
  });

  it('salta la settimana fuori dal periodo di validità', () => {
    const primaDellInizio = slotSocietaSettimana([], [ricorrenza({ valida_dal: '2026-08-31' })], LUNEDI);
    expect(primaDellInizio.inAttesa.size).toBe(0);

    const dopoLaFine = slotSocietaSettimana([], [ricorrenza({ valida_al: '2026-08-23' })], LUNEDI);
    expect(dopoLaFine.inAttesa.size).toBe(0);
  });

  it('include le settimane agli estremi del periodo, valida_al compreso', () => {
    const ultimaOccorrenza = slotSocietaSettimana(
      [],
      [ricorrenza({ valida_dal: '2026-08-12', valida_al: MERCOLEDI })],
      LUNEDI,
    );
    expect(ordinati(ultimaOccorrenza.inAttesa)).toEqual(['2026-08-26_2000', '2026-08-26_2030']);
  });

  it('ignora le ricorrenze già decise: i loro slot arrivano dalle richieste materializzate', () => {
    const decise = [
      ricorrenza({ stato: 'approvata' }),
      ricorrenza({ stato: 'rifiutata' }),
      ricorrenza({ stato: 'annullata' }),
    ];
    const { approvati, inAttesa } = slotSocietaSettimana([], decise, LUNEDI);
    expect(approvati.size).toBe(0);
    expect(inAttesa.size).toBe(0);
  });

  it('unisce senza duplicati le fasce che una richiesta singola e una ricorrenza condividono', () => {
    const { inAttesa } = slotSocietaSettimana(
      [richiesta({ stato: 'in_attesa', ora_inizio: '20:00', ora_fine: '20:30' })],
      [ricorrenza({})],
      LUNEDI,
    );
    expect(ordinati(inAttesa)).toEqual(['2026-08-26_2000', '2026-08-26_2030']);
  });
});
