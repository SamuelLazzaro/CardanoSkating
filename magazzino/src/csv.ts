/**
 * Export CSV dello storico movimenti, nel formato che Excel italiano apre
 * senza importazione guidata (stesse scelte del report di prenotazioni/):
 * BOM UTF-8, separatore ';', date DD/MM/YYYY, una riga per movimento.
 */
import type { MovimentoStoricoRow } from './query';

/** BOM UTF-8 scritto come escape: mai il carattere grezzo nel sorgente. */
const BOM = '﻿';
const SEPARATORE = ';';
const INTESTAZIONE = ['ID', 'Data', 'Tipo', 'Disciplina', 'Categoria', 'Quantità', 'Marca', 'Modello', 'Taglia', 'Atleta', 'Stato', 'Note', 'Operatore'];

/**
 * Racchiude un campo tra virgolette se contiene separatore, virgolette o a
 * capo, raddoppiando le virgolette interne (RFC 4180).
 */
export function campoCsv(valore: string | number | null): string {
  const testo = valore === null ? '' : String(valore);
  if (!/[";\n\r]/.test(testo)) return testo;
  return `"${testo.replace(/"/g, '""')}"`;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY'. */
export function dataItaliana(data: string): string {
  const [anno, mese, giorno] = data.split('-');
  return `${giorno}/${mese}/${anno}`;
}

export function generaCsvMovimenti(righe: MovimentoStoricoRow[]): string {
  const linee = [INTESTAZIONE.map(campoCsv).join(SEPARATORE)];
  for (const riga of righe) {
    const campi = [riga.id, dataItaliana(riga.data), riga.tipo, riga.disciplina, riga.categoria, riga.quantita, riga.marca, riga.modello, riga.taglia, riga.atleta, riga.condizione, riga.note, riga.operatore];
    linee.push(campi.map(campoCsv).join(SEPARATORE));
  }
  return BOM + linee.join('\r\n') + '\r\n';
}
