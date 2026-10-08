/**
 * Movimenti di magazzino: entrata (su articolo esistente o nuovo), consegna a
 * un atleta e restituzione; storico con filtri ed export CSV.
 *
 * Ogni registrazione è un db.batch() atomico di due istruzioni, l'INSERT del
 * movimento e la UPDATE dell'articolo, entrambe condizionate dalla STESSA
 * guardia (giacenza o possesso sufficiente). L'ordine è scelto perché la
 * seconda istruzione veda ancora lo stato letto dalla prima: nella consegna
 * prima l'INSERT (che non tocca `articoli`, su cui sta la guardia), nella
 * restituzione prima la UPDATE (che non tocca `movimenti`, da cui si calcola
 * il possesso). Se la guardia non passa nessuna delle due scrive e la route
 * risponde 409: due consegne concorrenti dell'ultimo pezzo non possono
 * riuscire entrambe. L'audit viene scritto solo dopo un esito positivo.
 */
import { Hono, type Context } from 'hono';
import type { ArticoloRow, Bindings, StatoArticolo, TipoMovimento, VariabiliUtente } from '../tipi';
import { richiedeUtente } from '../auth';
import { campiArticolo, MAX_NOTE, nomeArticolo, stmtInserisciArticolo } from '../articolo';
import { generaCsvMovimenti } from '../csv';
import { conFirmaBooleana, POSSESSO_ATLETA, SELECT_MOVIMENTI, type MovimentoStoricoRow } from '../query';
import { dataCivile, disciplina, interoPositivo, leggiJson, oggiRoma, patternRicerca, scriviAudit, statoArticolo, testoFacoltativo, tipoMovimento } from '../util';

const LIMITE_STORICO = 500;

/** Firma su touchscreen: data URL PNG prodotta da canvas.toDataURL('image/png'). */
const FIRMA_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
/** Tetto prudenziale sulla lunghezza della firma (una firma reale pesa decine di KB). */
const MAX_LUNGHEZZA_FIRMA = 300_000;

/** Storico con filtri neutralizzabili: ?1 disciplina ('' = tutte), ?2 pattern LIKE ('' = nessuna ricerca), ?3 limite. */
const SQL_STORICO = `${SELECT_MOVIMENTI}
  WHERE (?1 = '' OR a.disciplina = ?1)
    AND (?2 = '' OR a.marca LIKE ?2 ESCAPE '\\' OR a.modello LIKE ?2 ESCAPE '\\')
  ORDER BY m.data DESC, m.id DESC LIMIT ?3`;

const SQL_STORICO_COMPLETO = `${SELECT_MOVIMENTI} ORDER BY m.id`;

/**
 * Movimento di entrata legato all'articolo appena creato nello stesso batch.
 * Il batch è una transazione e gli id sono AUTOINCREMENT, quindi l'articolo
 * inserito dall'istruzione precedente è quello con l'id più alto.
 */
const SQL_ENTRATA_NUOVO_ARTICOLO = `INSERT INTO movimenti (articolo_id, atleta_id, operatore, tipo, quantita, data, condizione, note, firma)
  SELECT MAX(id), NULL, ?1, 'ENTRATA', ?2, ?3, ?4, ?5, NULL FROM articoli`;

const SQL_ENTRATA_ESISTENTE = 'UPDATE articoli SET quantita = quantita + ?2, disponibili = disponibili + ?2, stato = COALESCE(?3, stato) WHERE id = ?1';
const SQL_CONSEGNA = 'UPDATE articoli SET disponibili = disponibili - ?2 WHERE id = ?1 AND disponibili >= ?2';
const SQL_RESTITUZIONE = `UPDATE articoli SET disponibili = disponibili + ?3, stato = COALESCE(?4, stato) WHERE id = ?1 AND ${POSSESSO_ATLETA} >= ?3`;

/** Dati di un movimento validati dal corpo JSON, pronti per l'INSERT. */
type DatiMovimento = {
  tipo: TipoMovimento;
  quantita: number;
  data: string;
  condizione: StatoArticolo | null;
  note: string | null;
  firma: string | null;
  operatore: string;
};

type Contesto = Context<{ Bindings: Bindings; Variables: VariabiliUtente }>;

export const movimenti = new Hono<{ Bindings: Bindings; Variables: VariabiliUtente }>();

movimenti.use('*', richiedeUtente());

/**
 * Storico, dal più recente: filtrabile per magazzino (?disciplina=) e testo
 * libero su marca e modello dell'articolo (?q=); ?limite= riduce le righe
 * (es. le ultime 10 per il riepilogo di un magazzino).
 */
movimenti.get('/', async (c) => {
  const magazzino = disciplina(c.req.query('disciplina')) ?? '';
  const pattern = patternRicerca(c.req.query('q') ?? '') ?? '';
  const limiteRichiesto = interoPositivo(Number(c.req.query('limite') ?? LIMITE_STORICO)) ?? LIMITE_STORICO;
  const limite = Math.min(limiteRichiesto, LIMITE_STORICO);
  const { results } = await c.env.DB.prepare(SQL_STORICO).bind(magazzino, pattern, limite).all<MovimentoStoricoRow>();
  return c.json({ movimenti: conFirmaBooleana(results) });
});

/** Tutto lo storico in CSV per Excel italiano (BOM, ';', date DD/MM/YYYY). */
movimenti.get('/export.csv', async (c) => {
  const { results } = await c.env.DB.prepare(SQL_STORICO_COMPLETO).all<MovimentoStoricoRow>();
  const intestazioni = { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="movimenti_magazzino.csv"' };
  return c.body(generaCsvMovimenti(results), 200, intestazioni);
});

/**
 * Registra un movimento. Corpo:
 *   tipo: 'ENTRATA' | 'CONSEGNA' | 'RESTITUZIONE'
 *   quantita (intero ≥ 1), data ('YYYY-MM-DD', default oggi), condizione?, note?
 *   articolo_id — oppure, solo per ENTRATA, nuovo_articolo: { disciplina, categoria, marca, modello?, taglia?, note? }
 *   atleta_id — obbligatorio per CONSEGNA e RESTITUZIONE
 *   firma? — data URL PNG, solo per CONSEGNA e RESTITUZIONE
 */
movimenti.post('/', async (c) => {
  const corpo = await leggiJson(c);
  if (corpo === null) return c.json({ errore: 'Dati mancanti' }, 400);
  const validazione = datiMovimento(corpo, c.get('utente'));
  if ('errore' in validazione) return c.json({ errore: validazione.errore }, 400);
  const { dati } = validazione;

  if (dati.tipo === 'ENTRATA') {
    if (corpo.nuovo_articolo !== undefined) return await entrataNuovoArticolo(c, corpo.nuovo_articolo, dati);
    const articolo = await caricaArticolo(c.env.DB, corpo.articolo_id);
    if (articolo === null) return c.json({ errore: 'Seleziona il materiale' }, 400);
    return await entrataArticoloEsistente(c, articolo, dati);
  }

  const articolo = await caricaArticolo(c.env.DB, corpo.articolo_id);
  if (articolo === null) return c.json({ errore: 'Seleziona il materiale' }, 400);
  const atletaId = interoPositivo(corpo.atleta_id);
  if (atletaId === null) return c.json({ errore: 'Seleziona un atleta' }, 400);
  const atleta = await c.env.DB.prepare('SELECT id, attivo FROM atleti WHERE id = ?1').bind(atletaId).first<{ id: number; attivo: number }>();
  if (!atleta) return c.json({ errore: 'Atleta non trovato' }, 404);
  if (atleta.attivo !== 1) return c.json({ errore: 'Atleta disattivato: riattivalo prima di registrare il movimento' }, 400);
  if (dati.tipo === 'CONSEGNA') return await consegna(c, articolo, atletaId, dati);
  return await restituzione(c, articolo, atletaId, dati);
});

/**
 * Valida i campi comuni a tutti i tipi di movimento. La firma è ammessa solo
 * su consegne e restituzioni (un'entrata non ha nessuno che firmi).
 */
function datiMovimento(corpo: Record<string, unknown>, operatore: string): { dati: DatiMovimento } | { errore: string } {
  const tipo = tipoMovimento(corpo.tipo);
  if (tipo === null) return { errore: 'Tipo di movimento non valido' };
  const quantita = interoPositivo(corpo.quantita);
  if (quantita === null) return { errore: 'Quantità non valida' };
  const dataAssente = corpo.data === undefined || corpo.data === null || corpo.data === '';
  const data = dataAssente ? oggiRoma() : dataCivile(corpo.data);
  if (data === null) return { errore: 'Data non valida' };
  let condizione: StatoArticolo | null = null;
  if (corpo.condizione !== undefined && corpo.condizione !== null && corpo.condizione !== '') {
    condizione = statoArticolo(corpo.condizione);
    if (condizione === null) return { errore: 'Stato del materiale non valido' };
  }
  const note = testoFacoltativo(corpo.note, MAX_NOTE);
  if (!note.valido) return { errore: `Le note superano i ${MAX_NOTE} caratteri` };
  let firma: string | null = null;
  if (tipo !== 'ENTRATA' && typeof corpo.firma === 'string' && corpo.firma !== '') {
    if (corpo.firma.length > MAX_LUNGHEZZA_FIRMA || !FIRMA_RE.test(corpo.firma)) return { errore: 'Firma non valida' };
    firma = corpo.firma;
  }
  const dati: DatiMovimento = { tipo, quantita, data, condizione, note: note.testo, firma, operatore };
  return { dati };
}

async function caricaArticolo(db: D1Database, valore: unknown): Promise<ArticoloRow | null> {
  const id = interoPositivo(valore);
  if (id === null) return null;
  return await db.prepare('SELECT * FROM articoli WHERE id = ?1').bind(id).first<ArticoloRow>();
}

/**
 * INSERT del movimento condizionato da una guardia SQL sull'articolo: la riga
 * viene scritta solo se `guardia` (valutata su articoli con l'articolo in ?1 e
 * l'atleta in ?2) è vera. I dati del movimento occupano i segnaposto da ?3.
 */
function stmtInserisciMovimento(db: D1Database, articoloId: number, atletaId: number | null, dati: DatiMovimento, guardia = '1'): D1PreparedStatement {
  const sql = `INSERT INTO movimenti (articolo_id, atleta_id, operatore, tipo, quantita, data, condizione, note, firma) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 FROM articoli WHERE id = ?1 AND (${guardia})`;
  return db.prepare(sql).bind(articoloId, atletaId, dati.operatore, dati.tipo, dati.quantita, dati.data, dati.condizione, dati.note, dati.firma);
}

function rispostaMovimento(c: Contesto, movimentoId: number, articolo: { id: number; disciplina: string }) {
  return c.json({ id: movimentoId, articolo_id: articolo.id, disciplina: articolo.disciplina }, 201);
}

async function entrataNuovoArticolo(c: Contesto, nuovoArticolo: unknown, dati: DatiMovimento) {
  if (nuovoArticolo === null || typeof nuovoArticolo !== 'object' || Array.isArray(nuovoArticolo)) return c.json({ errore: 'Dati del nuovo articolo mancanti' }, 400);
  const validazione = campiArticolo(nuovoArticolo as Record<string, unknown>);
  if ('errore' in validazione) return c.json({ errore: validazione.errore }, 400);
  const { campi } = validazione;
  // La condizione indicata nel movimento è lo stato iniziale dell'articolo; senza, un articolo nuovo è 'Nuovo'.
  const statoIniziale = dati.condizione ?? campi.stato ?? 'Nuovo';
  const istruzioneArticolo = stmtInserisciArticolo(c.env.DB, campi, dati.quantita, statoIniziale);
  const istruzioneMovimento = c.env.DB.prepare(SQL_ENTRATA_NUOVO_ARTICOLO).bind(dati.operatore, dati.quantita, dati.data, dati.condizione, dati.note);
  const risultati = await c.env.DB.batch([istruzioneArticolo, istruzioneMovimento]);
  await scriviAudit(c.env.DB, 'entrata', `nuovo articolo #${risultati[0].meta.last_row_id} ${nomeArticolo(campi)} (${campi.disciplina}) × ${dati.quantita}`, dati.operatore);
  const articolo = { id: risultati[0].meta.last_row_id, disciplina: campi.disciplina };
  return rispostaMovimento(c, risultati[1].meta.last_row_id, articolo);
}

/** Entrata su un articolo esistente: aumenta totale e giacenza; la condizione indicata ne aggiorna lo stato. */
async function entrataArticoloEsistente(c: Contesto, articolo: ArticoloRow, dati: DatiMovimento) {
  const istruzioneMovimento = stmtInserisciMovimento(c.env.DB, articolo.id, null, dati);
  const istruzioneArticolo = c.env.DB.prepare(SQL_ENTRATA_ESISTENTE).bind(articolo.id, dati.quantita, dati.condizione);
  const risultati = await c.env.DB.batch([istruzioneMovimento, istruzioneArticolo]);
  await scriviAudit(c.env.DB, 'entrata', `#${articolo.id} ${nomeArticolo(articolo)} × ${dati.quantita}`, dati.operatore);
  return rispostaMovimento(c, risultati[0].meta.last_row_id, articolo);
}

/** Consegna: possibile solo se la giacenza copre la quantità (guardia `disponibili >= quantità`). */
async function consegna(c: Contesto, articolo: ArticoloRow, atletaId: number, dati: DatiMovimento) {
  const istruzioneMovimento = stmtInserisciMovimento(c.env.DB, articolo.id, atletaId, dati, 'disponibili >= ?5');
  const istruzioneArticolo = c.env.DB.prepare(SQL_CONSEGNA).bind(articolo.id, dati.quantita);
  const risultati = await c.env.DB.batch([istruzioneMovimento, istruzioneArticolo]);
  if (risultati[0].meta.changes === 0) return c.json({ errore: 'Quantità non disponibile in magazzino' }, 409);
  await scriviAudit(c.env.DB, 'consegna', `#${articolo.id} ${nomeArticolo(articolo)} × ${dati.quantita} ad atleta #${atletaId}`, dati.operatore);
  return rispostaMovimento(c, risultati[0].meta.last_row_id, articolo);
}

/**
 * Restituzione: possibile solo se l'atleta ha in mano almeno quella quantità
 * (guardia `possesso >= quantità`). La condizione dichiarata aggiorna lo stato
 * dell'articolo (torna "Usurato", "Da riparare", ...).
 */
async function restituzione(c: Contesto, articolo: ArticoloRow, atletaId: number, dati: DatiMovimento) {
  const istruzioneArticolo = c.env.DB.prepare(SQL_RESTITUZIONE).bind(articolo.id, atletaId, dati.quantita, dati.condizione);
  const istruzioneMovimento = stmtInserisciMovimento(c.env.DB, articolo.id, atletaId, dati, `${POSSESSO_ATLETA} >= ?5`);
  const risultati = await c.env.DB.batch([istruzioneArticolo, istruzioneMovimento]);
  if (risultati[1].meta.changes === 0) return c.json({ errore: 'Restituzione superiore al materiale assegnato' }, 409);
  await scriviAudit(c.env.DB, 'restituzione', `#${articolo.id} ${nomeArticolo(articolo)} × ${dati.quantita} da atleta #${atletaId}`, dati.operatore);
  return rispostaMovimento(c, risultati[1].meta.last_row_id, articolo);
}
