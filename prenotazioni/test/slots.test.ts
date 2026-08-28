import { describe, expect, it } from 'vitest';
import {
  aggiungiGiorni,
  domenicaDellaSettimana,
  giorniDaTesto,
  giorniInTesto,
  giornoSettimana,
  isDataValida,
  lunediDellaSettimana,
  occorrenzeRicorrenza,
  raggruppaSlotInFasce,
  slotKeys,
  validaIntervallo,
} from '../src/slots';

describe('slotKeys', () => {
  it('espande un intervallo in uno slot_key per ogni mezz\'ora occupata', () => {
    expect(slotKeys('2026-09-15', '18:30', '20:00')).toEqual([
      '2026-09-15_1830',
      '2026-09-15_1900',
      '2026-09-15_1930',
    ]);
  });

  it("gestisce l'ultimo slot della giornata (23:30-24:00)", () => {
    expect(slotKeys('2026-09-15', '23:30', '24:00')).toEqual(['2026-09-15_2330']);
  });
});

describe('validaIntervallo', () => {
  it('accetta un intervallo valido, inclusa la giornata intera', () => {
    expect(validaIntervallo('2026-09-15', '18:00', '19:30')).toBeNull();
    expect(validaIntervallo('2026-09-15', '08:00', '24:00')).toBeNull();
  });

  it('rifiuta inizio non precedente alla fine', () => {
    expect(validaIntervallo('2026-09-15', '18:00', '18:00')).not.toBeNull();
    expect(validaIntervallo('2026-09-15', '19:00', '18:00')).not.toBeNull();
  });

  it("rifiuta orari fuori dall'apertura (08:00-24:00)", () => {
    expect(validaIntervallo('2026-09-15', '07:30', '09:00')).not.toBeNull();
    expect(validaIntervallo('2026-09-15', '23:00', '24:30')).not.toBeNull();
  });

  it('rifiuta orari non a passi di 30 minuti o malformati', () => {
    expect(validaIntervallo('2026-09-15', '18:15', '19:00')).not.toBeNull();
    expect(validaIntervallo('2026-09-15', '18', '19:00')).not.toBeNull();
  });

  it('rifiuta date malformate o inesistenti', () => {
    expect(validaIntervallo('15/09/2026', '18:00', '19:00')).not.toBeNull();
    expect(validaIntervallo('2026-02-30', '18:00', '19:00')).not.toBeNull();
  });
});

describe('date civili', () => {
  it('isDataValida rifiuta le date che non esistono nel calendario', () => {
    expect(isDataValida('2026-02-28')).toBe(true);
    expect(isDataValida('2026-02-30')).toBe(false);
    expect(isDataValida('2024-02-29')).toBe(true); // anno bisestile
    expect(isDataValida('2026-13-01')).toBe(false);
  });

  it('giornoSettimana usa la convenzione 0=lunedì .. 6=domenica', () => {
    expect(giornoSettimana('2026-08-17')).toBe(0); // lunedì
    expect(giornoSettimana('2026-08-23')).toBe(6); // domenica
  });

  it('lunediDellaSettimana normalizza qualsiasi giorno al suo lunedì', () => {
    expect(lunediDellaSettimana('2026-08-17')).toBe('2026-08-17');
    expect(lunediDellaSettimana('2026-08-18')).toBe('2026-08-17');
    expect(lunediDellaSettimana('2026-08-23')).toBe('2026-08-17');
  });

  it('domenicaDellaSettimana normalizza qualsiasi giorno alla sua domenica', () => {
    expect(domenicaDellaSettimana('2026-08-17')).toBe('2026-08-23');
    expect(domenicaDellaSettimana('2026-08-20')).toBe('2026-08-23');
    expect(domenicaDellaSettimana('2026-08-23')).toBe('2026-08-23');
  });

  it('aggiungiGiorni attraversa correttamente mesi e anni', () => {
    expect(aggiungiGiorni('2026-08-30', 3)).toBe('2026-09-02');
    expect(aggiungiGiorni('2026-12-30', 5)).toBe('2027-01-04');
    expect(aggiungiGiorni('2026-09-02', -3)).toBe('2026-08-30');
  });
});

describe('occorrenzeRicorrenza', () => {
  // 2030-01-07 è un lunedì (giorno 0 nella convenzione del progetto).
  it('genera le date settimanali nel periodo, estremi inclusi', () => {
    expect(occorrenzeRicorrenza('2030-01-07', '2030-01-28', [0])).toEqual([
      '2030-01-07',
      '2030-01-14',
      '2030-01-21',
      '2030-01-28',
    ]);
  });

  it('parte dalla prima data con il giorno della settimana richiesto', () => {
    // valida_dal cade di mercoledì: la prima occorrenza di lunedì è quella successiva
    expect(occorrenzeRicorrenza('2030-01-09', '2030-01-28', [0])).toEqual([
      '2030-01-14',
      '2030-01-21',
      '2030-01-28',
    ]);
  });

  it('con più giorni produce tutte le date richieste, in ordine cronologico', () => {
    // lunedì, mercoledì e venerdì per due settimane
    expect(occorrenzeRicorrenza('2030-01-07', '2030-01-20', [0, 2, 4])).toEqual([
      '2030-01-07',
      '2030-01-09',
      '2030-01-11',
      '2030-01-14',
      '2030-01-16',
      '2030-01-18',
    ]);
  });

  it('senza giorni richiesti non produce date', () => {
    expect(occorrenzeRicorrenza('2030-01-07', '2030-01-20', [])).toEqual([]);
  });
});

describe('giorni della ricorrenza in DB', () => {
  it('giorniDaTesto legge il formato salvato', () => {
    expect(giorniDaTesto('0,2,4')).toEqual([0, 2, 4]);
    expect(giorniDaTesto('3')).toEqual([3]);
    expect(giorniDaTesto('')).toEqual([]);
  });

  it('giorniInTesto ordina, elimina i doppioni e serializza', () => {
    expect(giorniInTesto([4, 0, 2, 0])).toBe('0,2,4');
    expect(giorniInTesto([6])).toBe('6');
  });
});

describe('raggruppaSlotInFasce', () => {
  it('unisce gli slot contigui in una sola fascia', () => {
    expect(raggruppaSlotInFasce(['2030-01-07_1800', '2030-01-07_1830', '2030-01-07_1900'])).toEqual([
      { data: '2030-01-07', ora_inizio: '18:00', ora_fine: '19:30' },
    ]);
  });

  it('spezza la fascia su un buco orario e su un cambio di data', () => {
    expect(
      raggruppaSlotInFasce([
        '2030-01-07_1800',
        '2030-01-07_1900', // 18:30 libero: la fascia precedente si chiude
        '2030-01-08_1800', // altra data: fascia a sé anche se l'orario prosegue
      ]),
    ).toEqual([
      { data: '2030-01-07', ora_inizio: '18:00', ora_fine: '18:30' },
      { data: '2030-01-07', ora_inizio: '19:00', ora_fine: '19:30' },
      { data: '2030-01-08', ora_inizio: '18:00', ora_fine: '18:30' },
    ]);
  });

  it('ordina le chiavi ricevute in disordine e chiude a 24:00 l\'ultimo slot', () => {
    expect(raggruppaSlotInFasce(['2030-01-07_2330', '2030-01-07_2300'])).toEqual([
      { data: '2030-01-07', ora_inizio: '23:00', ora_fine: '24:00' },
    ]);
  });

  it('senza slot occupati non produce fasce', () => {
    expect(raggruppaSlotInFasce([])).toEqual([]);
  });
});
