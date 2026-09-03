/*
 * Test degli helper di public/js/utils.js usati dalla vista mensile: la griglia
 * di giorni disegnata dal calendario, la navigazione tra i mesi e le due
 * funzioni che comprimono gli slot da 30 minuti nelle voci leggibili delle
 * celle ("18:00–19:30" invece di tre mezz'ore separate).
 *
 * Il file è .js perché il modulo sotto test è JavaScript del frontend (vedi
 * slot-societa.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
  giorniGrigliaMese,
  meseDellaData,
  raggruppaPrenotazioni,
  raggruppaSlotInFasce,
  slotSocietaIntervallo,
  spostaMese,
  titoloMese,
} from '../public/js/utils.js';

describe('spostaMese', () => {
  it('somma e sottrae mesi attraversando l\'anno', () => {
    expect(spostaMese('2026-09', 1)).toBe('2026-10');
    expect(spostaMese('2026-12', 1)).toBe('2027-01');
    expect(spostaMese('2026-01', -1)).toBe('2025-12');
    expect(spostaMese('2026-09', 0)).toBe('2026-09');
    expect(spostaMese('2026-09', 12)).toBe('2027-09');
  });
});

describe('meseDellaData e titoloMese', () => {
  it('estrae il mese di una data e lo scrive in italiano', () => {
    expect(meseDellaData('2026-08-31')).toBe('2026-08');
    expect(titoloMese('2026-08')).toBe('agosto 2026');
    expect(titoloMese('2027-01')).toBe('gennaio 2027');
  });
});

describe('giorniGrigliaMese', () => {
  it('parte dal lunedì della settimana del giorno 1 e finisce alla domenica dell\'ultimo', () => {
    // Settembre 2026: 1 martedì, 30 mercoledì.
    const giorni = giorniGrigliaMese('2026-09');
    expect(giorni[0]).toBe('2026-08-31');
    expect(giorni[giorni.length - 1]).toBe('2026-10-04');
    expect(giorni.length).toBe(35);
  });

  it('sul mese che inizia di lunedì e finisce di domenica non aggiunge nulla', () => {
    const giorni = giorniGrigliaMese('2027-02');
    expect(giorni[0]).toBe('2027-02-01');
    expect(giorni[giorni.length - 1]).toBe('2027-02-28');
    expect(giorni.length).toBe(28);
  });

  it('produce sempre settimane intere e giorni consecutivi senza buchi', () => {
    for (const mese of ['2026-01', '2026-02', '2026-08', '2026-12', '2028-02']) {
      const giorni = giorniGrigliaMese(mese);
      expect(giorni.length % 7).toBe(0);
      // Consecutivi: ogni giorno è il successivo del precedente.
      for (let indice = 1; indice < giorni.length; indice += 1) {
        const atteso = new Date(`${giorni[indice - 1]}T00:00:00Z`);
        atteso.setUTCDate(atteso.getUTCDate() + 1);
        expect(giorni[indice]).toBe(atteso.toISOString().slice(0, 10));
      }
      // Il mese è contenuto tutto: il giorno 1 e l'ultimo ci sono.
      expect(giorni).toContain(`${mese}-01`);
    }
  });
});

describe('raggruppaSlotInFasce', () => {
  it('unisce gli slot contigui in una sola fascia', () => {
    const chiavi = ['2026-09-16_1800', '2026-09-16_1830', '2026-09-16_1900'];
    expect(raggruppaSlotInFasce(chiavi)).toEqual([{ data: '2026-09-16', oraInizio: '18:00', oraFine: '19:30' }]);
  });

  it('spezza la fascia su un buco temporale o su un cambio di giorno', () => {
    const chiavi = [
      '2026-09-16_1800',
      '2026-09-16_1900', // buco: 18:30 non è prenotato
      '2026-09-17_1800',
    ];
    expect(raggruppaSlotInFasce(chiavi)).toEqual([
      { data: '2026-09-16', oraInizio: '18:00', oraFine: '18:30' },
      { data: '2026-09-16', oraInizio: '19:00', oraFine: '19:30' },
      { data: '2026-09-17', oraInizio: '18:00', oraFine: '18:30' },
    ]);
  });

  it('accetta le chiavi in qualsiasi ordine, anche da un Set', () => {
    const chiavi = new Set(['2026-09-16_1830', '2026-09-16_1800']);
    expect(raggruppaSlotInFasce(chiavi)).toEqual([{ data: '2026-09-16', oraInizio: '18:00', oraFine: '19:00' }]);
  });

  it('gestisce la chiusura a mezzanotte', () => {
    expect(raggruppaSlotInFasce(['2026-09-16_2330'])).toEqual([
      { data: '2026-09-16', oraInizio: '23:30', oraFine: '24:00' },
    ]);
  });

  it('su nessuno slot non produce fasce', () => {
    expect(raggruppaSlotInFasce([])).toEqual([]);
  });
});

describe('raggruppaPrenotazioni', () => {
  /**
   * @param {string} chiave - slot key
   * @param {number} richiestaId - booking the slot belongs to
   * @param {string} societa - società name
   * @returns {object} one row as the admin calendar API returns it
   */
  const slot = (chiave, richiestaId, societa) => ({
    slot_key: chiave,
    societa_id: richiestaId,
    societa,
    colore: '#00aabb',
    richiesta_id: richiestaId,
    titolo: 'Allenamento',
  });

  it('riduce gli slot di una prenotazione a una sola voce con inizio e fine', () => {
    const blocchi = raggruppaPrenotazioni([
      slot('2026-09-16_1800', 7, 'ASD Uno'),
      slot('2026-09-16_1830', 7, 'ASD Uno'),
      slot('2026-09-16_1900', 7, 'ASD Uno'),
    ]);
    expect(blocchi).toEqual([
      {
        richiestaId: 7,
        societaId: 7,
        societa: 'ASD Uno',
        colore: '#00aabb',
        titolo: 'Allenamento',
        note: null,
        ricorrenzaId: null,
        data: '2026-09-16',
        oraInizio: '18:00',
        oraFine: '19:30',
      },
    ]);
  });

  it('tiene separate le prenotazioni diverse e le ordina cronologicamente', () => {
    const blocchi = raggruppaPrenotazioni([
      slot('2026-09-17_0900', 9, 'ASD Tre'),
      slot('2026-09-16_2000', 8, 'ASD Due'),
      slot('2026-09-16_1800', 7, 'ASD Uno'),
    ]);
    expect(blocchi.map((b) => `${b.data} ${b.oraInizio} ${b.societa}`)).toEqual([
      '2026-09-16 18:00 ASD Uno',
      '2026-09-16 20:00 ASD Due',
      '2026-09-17 09:00 ASD Tre',
    ]);
  });

  it('non fonde due prenotazioni adiacenti della stessa società', () => {
    // Fasce attaccate ma richieste distinte: restano due voci, come in DB.
    const blocchi = raggruppaPrenotazioni([
      slot('2026-09-16_1800', 7, 'ASD Uno'),
      slot('2026-09-16_1830', 8, 'ASD Uno'),
    ]);
    expect(blocchi.map((b) => `${b.oraInizio}-${b.oraFine}`)).toEqual(['18:00-18:30', '18:30-19:00']);
  });

  it('su nessuna prenotazione non produce voci', () => {
    expect(raggruppaPrenotazioni([])).toEqual([]);
  });
});

describe('slotSocietaIntervallo', () => {
  /** @type {object} richiesta approvata di riferimento */
  const richiestaApprovata = {
    tipo: 'nuova',
    stato: 'approvata',
    data: '2026-09-16',
    ora_inizio: '18:00',
    ora_fine: '19:00',
  };

  it('classifica le richieste dentro l\'intervallo, estremi inclusi', () => {
    const richieste = [
      { ...richiestaApprovata, data: '2026-08-31' }, // primo giorno della griglia
      { ...richiestaApprovata, data: '2026-10-04', stato: 'in_attesa' }, // ultimo giorno
      { ...richiestaApprovata, data: '2026-10-05' }, // fuori: il giorno dopo
    ];
    const { approvati, inAttesa } = slotSocietaIntervallo(richieste, [], '2026-08-31', '2026-10-04');
    expect([...approvati]).toEqual(['2026-08-31_1800', '2026-08-31_1830']);
    expect([...inAttesa]).toEqual(['2026-10-04_1800', '2026-10-04_1830']);
  });

  it('espande una ricorrenza in attesa su tutte le occorrenze dell\'intervallo', () => {
    const ricorrenza = {
      stato: 'in_attesa',
      giorni: [0, 2], // lunedì e mercoledì
      ora_inizio: '18:00',
      ora_fine: '18:30',
      valida_dal: '2026-09-07', // lunedì
      valida_al: '2026-09-16', // mercoledì della settimana dopo
    };
    const { inAttesa } = slotSocietaIntervallo([], [ricorrenza], '2026-08-31', '2026-10-04');
    expect([...inAttesa].sort()).toEqual([
      '2026-09-07_1800',
      '2026-09-09_1800',
      '2026-09-14_1800',
      '2026-09-16_1800',
    ]);
  });

  it('taglia la ricorrenza sulla parte di validità che l\'intervallo mostra', () => {
    const ricorrenza = {
      stato: 'in_attesa',
      giorni: [0], // lunedì
      ora_inizio: '18:00',
      ora_fine: '18:30',
      valida_dal: '2026-09-07',
      valida_al: '2026-09-28',
    };
    // Intervallo che contiene solo il secondo e il terzo lunedì della serie.
    const { inAttesa } = slotSocietaIntervallo([], [ricorrenza], '2026-09-14', '2026-09-21');
    expect([...inAttesa].sort()).toEqual(['2026-09-14_1800', '2026-09-21_1800']);
  });

  it('ignora le richieste di annullamento e le ricorrenze già decise', () => {
    const richieste = [{ ...richiestaApprovata, tipo: 'annullamento', stato: 'in_attesa' }];
    const ricorrenze = [{
      stato: 'approvata',
      giorni: [2],
      ora_inizio: '18:00',
      ora_fine: '18:30',
      valida_dal: '2026-09-01',
      valida_al: '2026-09-30',
    }];
    const { approvati, inAttesa } = slotSocietaIntervallo(richieste, ricorrenze, '2026-08-31', '2026-10-04');
    expect(approvati.size).toBe(0);
    expect(inAttesa.size).toBe(0);
  });
});
