/**
 * Minimal iCalendar (RFC 5545) generation for a società's approved bookings.
 *
 * Events are emitted with TZID=Europe/Rome plus an explicit VTIMEZONE block
 * carrying the EU daylight-saving rules, so calendar clients show the correct
 * local time on both sides of a DST change without any conversion on our side
 * (the stored times are already Italian civil time).
 */

export type EventoICS = {
  id: number;
  data: string; // 'YYYY-MM-DD'
  ora_inizio: string; // 'HH:MM'
  ora_fine: string; // 'HH:MM', può essere '24:00'
  note: string | null;
};

const VTIMEZONE_ROMA = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Rome',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** Escape del testo secondo RFC 5545 (backslash, ; , e a capo). */
function testoICS(valore: string): string {
  return valore
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Piega le righe oltre i 74 caratteri con CRLF + spazio (RFC 5545 §3.1). */
function piega(riga: string): string {
  const pezzi: string[] = [];
  let resto = riga;
  while (resto.length > 74) {
    pezzi.push(resto.slice(0, 74));
    resto = ' ' + resto.slice(74);
  }
  pezzi.push(resto);
  return pezzi.join('\r\n');
}

/** 'YYYY-MM-DD' + 'HH:MM' → 'YYYYMMDDTHHMM00' (ora civile locale). */
function dataOraICS(data: string, ora: string): string {
  return `${data.replaceAll('-', '')}T${ora.replace(':', '')}00`;
}

/** Istante UTC in formato ICS 'YYYYMMDDTHHMMSSZ' (per DTSTAMP). */
function utcICS(istante: Date): string {
  return istante.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
}

export function generaICS(nomeSocieta: string, eventi: EventoICS[], adesso: Date): string {
  const righe: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cardano Skating//Prenotazioni Palazzetto//IT',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${testoICS(`Palazzetto — ${nomeSocieta}`)}`,
    ...VTIMEZONE_ROMA,
  ];

  const marcaTemporale = utcICS(adesso);
  for (const evento of eventi) {
    // '24:00' non esiste in ICS: la fine a mezzanotte diventa le 00:00 del
    // giorno successivo (stesso istante, rappresentazione valida).
    const fineAMezzanotte = evento.ora_fine === '24:00';
    const dataFine = fineAMezzanotte ? aggiungiUnGiorno(evento.data) : evento.data;
    const oraFine = fineAMezzanotte ? '00:00' : evento.ora_fine;
    righe.push(
      'BEGIN:VEVENT',
      `UID:richiesta-${evento.id}@prenotazioni.cardanoskating`,
      `DTSTAMP:${marcaTemporale}`,
      `DTSTART;TZID=Europe/Rome:${dataOraICS(evento.data, evento.ora_inizio)}`,
      `DTEND;TZID=Europe/Rome:${dataOraICS(dataFine, oraFine)}`,
      `SUMMARY:${testoICS(`Allenamento palazzetto — ${nomeSocieta}`)}`,
    );
    if (evento.note) righe.push(`DESCRIPTION:${testoICS(evento.note)}`);
    righe.push('END:VEVENT');
  }

  righe.push('END:VCALENDAR');
  return righe.map(piega).join('\r\n') + '\r\n';
}

function aggiungiUnGiorno(data: string): string {
  const [anno, mese, giorno] = data.split('-').map(Number);
  return new Date(Date.UTC(anno, mese - 1, giorno + 1)).toISOString().slice(0, 10);
}
