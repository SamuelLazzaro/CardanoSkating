/*
 * Test degli helper di public/js/utils.js usati dal form della richiesta
 * ricorrente: l'anteprima delle date (occorrenzeRicorrenza) deve produrre le
 * stesse date che poi calcola il server, e le etichette delle liste
 * (elencoGiorni) devono leggersi bene con uno o più giorni.
 *
 * Il file è .js perché il modulo sotto test è JavaScript del frontend (vedi
 * slot-societa.test.js).
 */
import { describe, expect, it } from 'vitest';
import { domenicaDellaSettimana, elencoGiorni, occorrenzeRicorrenza } from '../public/js/utils.js';

describe('domenicaDellaSettimana', () => {
  it('normalizza qualsiasi giorno alla domenica della sua settimana', () => {
    expect(domenicaDellaSettimana('2026-08-24')).toBe('2026-08-30'); // lunedì
    expect(domenicaDellaSettimana('2026-08-27')).toBe('2026-08-30'); // giovedì
    expect(domenicaDellaSettimana('2026-08-30')).toBe('2026-08-30'); // domenica
  });
});

describe('occorrenzeRicorrenza', () => {
  // 2026-08-24 è un lunedì.
  it('con un solo giorno ripete ogni 7 giorni, estremi inclusi', () => {
    expect(occorrenzeRicorrenza('2026-08-24', '2026-09-14', [0])).toEqual([
      '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14',
    ]);
  });

  it('con più giorni produce tutte le date richieste in ordine cronologico', () => {
    expect(occorrenzeRicorrenza('2026-08-24', '2026-09-06', [0, 2, 4])).toEqual([
      '2026-08-24', '2026-08-26', '2026-08-28',
      '2026-08-31', '2026-09-02', '2026-09-04',
    ]);
  });

  it('senza ripetizione settimanale si ferma alla domenica della settimana della data', () => {
    const data = '2026-08-26'; // mercoledì
    const date = occorrenzeRicorrenza(data, domenicaDellaSettimana(data), [0, 2, 4]);
    // Il lunedì precede la data scelta: non è un'occorrenza.
    expect(date).toEqual(['2026-08-26', '2026-08-28']);
  });
});

describe('elencoGiorni', () => {
  it('unisce i nomi con virgole e una "e" finale', () => {
    expect(elencoGiorni([0])).toBe('lunedì');
    expect(elencoGiorni([0, 2])).toBe('lunedì e mercoledì');
    expect(elencoGiorni([0, 2, 4])).toBe('lunedì, mercoledì e venerdì');
  });
});
