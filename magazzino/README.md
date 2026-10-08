# Gestionale magazzino — Cardano Skating S.R.L. S.S.D.

Gestionale del materiale della squadra, diviso nei due magazzini **Ghiaccio**
e **Corsa**: articoli con codice, categoria, marca, taglia, seriale, giacenza e
stato; atleti; movimenti di entrata, consegna e restituzione con firma su
touchscreen; scheda articolo con QR code; storico con export CSV.

È la riscrittura, sullo stesso stack di [prenotazioni/](../prenotazioni), del
gestionale Flask realizzato da un genitore della squadra ("Cardano Skating
Manager"): stesse funzioni della prima versione, ma online, con i dati su un
database remoto e senza server da mantenere.

**Stack**: Cloudflare Workers + [Hono](https://hono.dev) (TypeScript),
database Cloudflare D1, frontend statico vanilla (HTML/CSS/JS) servito dallo
stesso Worker. Progettato per stare nei limiti del piano gratuito di Workers.

## Struttura

```
magazzino/
├── wrangler.jsonc        # configurazione Worker, asset statici, binding D1, elenco utenti
├── migrations/           # migrazioni SQL del database
├── src/
│   ├── index.ts          # entry point Hono (security header, mount rotte)
│   ├── auth.ts           # sessioni con cookie firmati HMAC-SHA256
│   ├── utenti.ts         # utenti da UTENTI + secret PASSWORD_<NOME>
│   ├── ratelimit.ts      # rate limit del login su D1
│   ├── articolo.ts       # validazione dei dati anagrafici di un articolo
│   ├── query.ts          # frammenti SQL condivisi (storico, possesso atleta)
│   ├── csv.ts            # export CSV per Excel italiano
│   └── routes/           # accesso, atleti, categorie, articoli, movimenti, riepilogo
├── public/               # frontend statico (una sola pagina)
│   ├── index.html
│   ├── css/              # base / layout / components / main (@import)
│   ├── js/               # constants / utils / api / ui / stato / firma + una vista-*.js per sezione + app.js
│   └── assets/           # font Inter self-hosted, logo e foto dei due magazzini
└── test/                 # vitest + @cloudflare/vitest-pool-workers (D1 reale)
```

## Prerequisiti

- Node.js ≥ 20 e npm
- Un account Cloudflare (per deploy e DB remoto): `npx wrangler login`

## Sviluppo locale

```bash
npm install

# secret locali: copia l'esempio e imposta i valori (il file è ignorato da git)
cp .dev.vars.example .dev.vars

# crea/aggiorna il database locale (file sqlite in .wrangler/)
npm run migrate:local

# avvia il dev server su http://localhost:8787
npm run dev
```

Al primo accesso scegli un utente dal menu a tendina e inserisci la password
che hai scritto in `.dev.vars` per quel nome.

Per ripartire da un database locale vuoto: cancella la cartella `.wrangler/`
e rilancia `npm run migrate:local`.

## Test e controlli

```bash
npm test              # suite completa (unit + integrazione su D1 reale)
npm run typecheck     # tsc --noEmit
```

I test applicano automaticamente le migrazioni a un D1 isolato: non toccano
il database di sviluppo.

## Utenti e password

Non esiste una tabella utenti né una pagina per gestirli: gli utenti sono
configurazione del Worker.

- I **nomi** stanno in chiaro in `vars.UTENTI` di [wrangler.jsonc](wrangler.jsonc),
  separati da virgola (solo lettere, cifre e `_`). Il nome scritto lì è quello
  mostrato nel menu del login e registrato come operatore di ogni movimento;
  al login maiuscole e minuscole non contano.
- La **password** di ogni utente è un secret del Worker chiamato
  `PASSWORD_<NOME IN MAIUSCOLO>` (es. `PASSWORD_DANIELE`), caricato con
  `wrangler secret put`: sta cifrato su Cloudflare, mai nel codice né in git.
- Il cookie di sessione (8 ore) è firmato con il secret `ADMIN_SECRET` e
  contiene il nome utente; se un nome viene tolto da `UTENTI` le sue sessioni
  decadono al deploy successivo.

Tutti gli utenti hanno gli stessi permessi. Per aggiungerne uno: nome in
`UTENTI`, `wrangler secret put PASSWORD_NOME`, `npm run deploy`. Per toglierlo:
`wrangler secret delete PASSWORD_NOME`, nome rimosso da `UTENTI`, deploy.

## Migrazioni

Le migrazioni vivono in `migrations/` e vengono applicate in ordine di nome.

```bash
# creare una nuova migrazione (genera migrations/000N_nome.sql da compilare)
npx wrangler d1 migrations create cardanoskating-magazzino nome_migrazione

# applicare le migrazioni
npm run migrate:local     # al database locale
npm run migrate:remote    # al database di produzione (chiede conferma)
```

## Primo deploy (una tantum)

1. **Crea il database D1** e copia l'id nel campo `database_id` di
   [wrangler.jsonc](wrangler.jsonc) al posto del segnaposto:

   ```bash
   npx wrangler d1 create cardanoskating-magazzino
   ```

2. **Crea i secret** (mai nel codice, mai in git). Se il Worker non esiste
   ancora, al primo `secret put` wrangler chiede se crearlo: rispondi sì.

   ```bash
   # chiave HMAC per la firma dei cookie: una stringa casuale lunga, es.
   #   openssl rand -hex 32
   npx wrangler secret put ADMIN_SECRET

   # una password per ogni nome elencato in UTENTI (input nascosto)
   npx wrangler secret put PASSWORD_DANIELE
   npx wrangler secret put PASSWORD_DAVIDE
   ```

3. **Applica le migrazioni al database remoto**:

   ```bash
   npm run migrate:remote
   ```

4. **Pubblica il Worker**:

   ```bash
   npm run deploy
   ```

Per i deploy successivi basta `npm run deploy` (e `npm run migrate:remote` se
ci sono nuove migrazioni: applicale **prima** del deploy).

## Backup e ripristino del database

```bash
# backup completo del DB di produzione in un file SQL
npx wrangler d1 export cardanoskating-magazzino --remote --output backup-$(date +%Y%m%d).sql

# ripristino (su un DB vuoto appena creato)
npx wrangler d1 execute cardanoskating-magazzino --remote --file backup-YYYYMMDD.sql
```

I file `backup*.sql` sono ignorati da git: contengono nomi di atleti e firme.
Consiglio: fai un backup prima di ogni `migrate:remote`.

## Come funziona (in breve)

- **Magazzini**: ogni articolo appartiene a `Ghiaccio` o `Corsa` (colonna
  `disciplina`). La Home mostra le due card con i numeri; entrando in un
  magazzino si vedono i suoi riquadri e le ultime dieci movimentazioni.
- **Articoli**: `quantita` è il totale posseduto, `disponibili` la giacenza in
  magazzino; la differenza è il materiale consegnato agli atleti. Lo stato è
  uno tra `Nuovo`, `Buono`, `Usurato`, `Da riparare`, `Fuori uso`; gli ultimi
  due contano come "da riparare" nei riquadri. La categoria è un testo che
  riprende una riga della tabella `categorie` (le categorie disattivate non
  compaiono più nei menu, gli articoli che le usano restano com'erano).
- **Atleti**: ogni atleta ha nome e cognome in un unico campo e una
  categoria agonistica tra `G` (Giovanissimi), `E` (Esordienti), `R12`
  (Ragazzi 12), `R` (Ragazzi), `A` (Allievi), `J` (Junior), `S` (Senior) e
  `M` (Master). La lista è fissa nel codice (vincolo `CHECK` in
  `migrations/0002_categoria_atleti.sql`, replicato in `src/util.ts` e
  `public/js/constants.js`): per cambiarla serve una migrazione. Gli atleti
  inseriti prima della migrazione 0002 hanno categoria `NULL` ("—" nella
  tabella) e la ricevono dalla select nella loro riga, che salva al cambio
  (`PATCH /api/atleti/:id` con `categoria`; lo stesso endpoint accetta
  `attivo`). La sezione Atleti filtra per una o più categorie (select
  multipla, pulsante rosso "Reset filtro" attivo solo con un filtro in corso)
  e ordina per nome oppure per categoria, dalla più giovane alla più anziana
  e poi per nome; filtro e ordine sono lato client e non sopravvivono al
  ricaricamento della pagina. Nel form Movimento e nel titolo della scheda il
  nome compare come "Nome Cognome (sigla)".
- **Movimenti**: `ENTRATA` aumenta totale e giacenza (su un articolo esistente
  oppure creando un nuovo articolo dallo stesso form); `CONSEGNA` scala la
  giacenza e richiede un atleta attivo; `RESTITUZIONE` la ripristina e può
  aggiornare lo stato dell'articolo con la condizione dichiarata. Ogni
  registrazione è un `db.batch()` atomico di due istruzioni con la stessa
  guardia SQL (giacenza sufficiente, oppure materiale effettivamente in mano
  all'atleta): se la guardia non passa nessuna delle due scrive e la risposta è
  409, quindi due consegne concorrenti dell'ultimo pezzo non possono riuscire
  entrambe. L'operatore registrato è il nome utente della sessione.
- **Firma**: su consegne e restituzioni si può firmare sul touchscreen; la
  firma è salvata come PNG (data URL) nella riga del movimento. Come nel
  gestionale originale non viene mostrata: le liste espongono solo il flag
  `firma_presente` (✓ nella scheda atleta) e non leggono mai la colonna.
- **Eliminazione articoli**: possibile solo senza movimenti; un articolo con
  storico va impostato `Fuori uso`, così la tracciabilità non si perde.
- **QR code**: `GET /api/articoli/:id/qr.svg` genera nel Worker (libreria JS
  pura `qrcode-generator`, nessun servizio esterno) un QR che punta a
  `/?articolo=<id>`; aperto quel link, dopo il login la pagina mostra subito la
  scheda dell'articolo.
- **Storico e CSV**: `GET /api/movimenti` restituisce gli ultimi 500 movimenti
  con filtri `?disciplina=`, `?q=`, `?limite=`; `GET /api/movimenti/export.csv`
  esporta tutto per Excel italiano (BOM UTF-8, separatore `;`, date
  `DD/MM/YYYY`, campi con `;` o `"` protetti tra virgolette).
- **Ricerca**: il filtro testuale lato server usa `LIKE` con escape dei
  caratteri speciali e resta entro i 50 byte di pattern ammessi da D1; il
  frontend filtra la stessa lista già caricata, lato client, con la stessa
  regola (codice, descrizione, marca, seriale).

## Note operative

- **Fuso orario**: la data di un movimento è ora civile `Europe/Rome`
  (`YYYY-MM-DD`, default oggi); i timestamp tecnici `*_at` sono UTC.
- **Limiti piano gratuito**: niente hashing di password (le password sono
  secret confrontati in tempo costante), niente query in loop, al più tre
  query aggregate per il riepilogo.
- **Versioni**: `wrangler` è bloccato a `~4.35.0` per compatibilità con
  `@cloudflare/vitest-pool-workers`; `compatibility_date` in `wrangler.jsonc`
  è vincolata alla versione di workerd inclusa — non alzarla senza aggiornare
  entrambi.
- **Rate limit login**: 10 tentativi per IP ogni 15 minuti (tabella
  `rate_limit` su D1).
- **Audit**: login e login falliti, creazione di atleti/categorie/articoli,
  eliminazioni e movimenti sono registrati nella tabella `audit_log` con il
  nome dell'utente.
- **Differenza dal Flask**: un'entrata su un articolo esistente con una
  condizione indicata aggiorna lo stato dell'articolo (l'originale la
  ignorava).

## Migliorie rinviate (promemoria)

La prima versione replica le funzioni del gestionale originale. Restano da
valutare, nell'ordine in cui sono emerse durante l'analisi:

1. **Modifica di un articolo** dopo la creazione (oggi solo inserimento ed
   eliminazione: un refuso nel codice o nella descrizione non si corregge).
2. **Cancellazione o anonimizzazione di un atleta** (oggi solo
   attiva/disattiva; i nomi restano per sempre nello storico).
3. **Categoria come chiave esterna** invece di testo libero, così rinominare
   una categoria aggiorna gli articoli.
4. **Informativa privacy** dedicata, come [prenotazioni/public/privacy.html](../prenotazioni/public/privacy.html):
   nomi di atleti (verosimilmente minori) e firme autografe sono dati
   personali.
5. **Firma visibile** nel dettaglio del movimento (oggi salvata ma mai mostrata).
