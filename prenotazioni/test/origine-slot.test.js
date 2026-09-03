/*
 * Test di origineSlotSocieta (public/js/utils.js): da ogni slot che la
 * società possiede si risale all'elemento che lo genera — prenotazione
 * approvata, richiesta in attesa, richiesta di modifica in attesa (i suoi
 * NUOVI slot) o ricorrenza in attesa — così il click sul calendario apre il
 * popup giusto. Verifica anche che slotSocietaIntervallo, che ne deriva,
 * colori di giallo gli slot proposti da una modifica in attesa.
 */
import { describe, expect, it } from 'vitest';
import { origineSlotSocieta, slotSocietaIntervallo } from '../public/js/utils.js';

const LUNEDI = '2026-08-24';
const DOMENICA = '2026-08-30';
const MERCOLEDI = '2026-08-26';

const richiesta = (campi) => ({
  id: 1,
  tipo: 'nuova',
  stato: 'approvata',
  data: MERCOLEDI,
  ora_inizio: '18:00',
  ora_fine: '19:00',
  ...campi,
});

describe('origineSlotSocieta', () => {
  it('distingue prenotazione approvata, richiesta in attesa e ricorrenza in attesa', () => {
    const approvata = richiesta({ id: 1 });
    const inAttesa = richiesta({ id: 2, stato: 'in_attesa', ora_inizio: '19:00', ora_fine: '19:30' });
    const serie = { id: 7, stato: 'in_attesa', giorni: [4], ora_inizio: '20:00', ora_fine: '20:30', valida_dal: LUNEDI, valida_al: '2026-09-14' };

    const origini = origineSlotSocieta([approvata, inAttesa], [serie], LUNEDI, DOMENICA);
    expect(origini.get('2026-08-26_1800')).toEqual({ genere: 'approvata', richiesta: approvata });
    expect(origini.get('2026-08-26_1900')).toEqual({ genere: 'in_attesa', richiesta: inAttesa });
    expect(origini.get('2026-08-28_2000')).toEqual({ genere: 'ricorrenza', ricorrenza: serie });
    expect(origini.size).toBe(4);
  });

  it('i nuovi slot di una richiesta di modifica in attesa sono "modifica"; quella approvata non genera slot', () => {
    const prenotazione = richiesta({ id: 1 });
    const modificaPendente = richiesta({ id: 2, tipo: 'modifica', stato: 'in_attesa', ora_inizio: '20:00', ora_fine: '21:00', richiesta_riferimento_id: 1 });
    const modificaApprovata = richiesta({ id: 3, tipo: 'modifica', stato: 'approvata', ora_inizio: '21:00', ora_fine: '22:00', richiesta_riferimento_id: 1 });

    const origini = origineSlotSocieta([prenotazione, modificaPendente, modificaApprovata], [], LUNEDI, DOMENICA);
    expect(origini.get('2026-08-26_2000')).toEqual({ genere: 'modifica', richiesta: modificaPendente });
    expect(origini.has('2026-08-26_2100')).toBe(false);

    // Nel calendario i nuovi slot proposti sono gialli, quelli attuali restano approvati.
    const { approvati, inAttesa } = slotSocietaIntervallo([prenotazione, modificaPendente], [], LUNEDI, DOMENICA);
    expect([...approvati].sort()).toEqual(['2026-08-26_1800', '2026-08-26_1830']);
    expect([...inAttesa].sort()).toEqual(['2026-08-26_2000', '2026-08-26_2030']);
  });

  it('una modifica che sposta l\'orario di mezz\'ora non copre la prenotazione approvata sullo slot in comune', () => {
    const prenotazione = richiesta({ id: 1 });
    const modifica = richiesta({ id: 2, tipo: 'modifica', stato: 'in_attesa', ora_inizio: '18:30', ora_fine: '19:30', richiesta_riferimento_id: 1 });
    const origini = origineSlotSocieta([modifica, prenotazione], [], LUNEDI, DOMENICA);
    expect(origini.get('2026-08-26_1830').genere).toBe('approvata');
    expect(origini.get('2026-08-26_1900').genere).toBe('modifica');
  });

  it('ignora le richieste di annullamento e le date fuori intervallo', () => {
    const annullamento = richiesta({ id: 5, tipo: 'annullamento', stato: 'in_attesa', richiesta_riferimento_id: 1 });
    const fuori = richiesta({ id: 6, data: '2026-09-02' });
    expect(origineSlotSocieta([annullamento, fuori], [], LUNEDI, DOMENICA).size).toBe(0);
  });
});
