# Prenotazioni strutture sportive — Cardano Skating S.R.L. S.S.D.

Sistema di prenotazione delle fasce orarie delle strutture sportive
(palazzetto dello sport e circuito stradale) per le società sportive esterne
autorizzate. Le società richiedono slot da 30 minuti (08:00–24:00, 7 giorni su
7), l'amministratore approva o rifiuta; il vincolo `UNIQUE` sul database
garantisce che uno slot non possa mai essere prenotato due volte.

Lo stesso codice è pubblicato **una volta per struttura**, con Worker,
database, secret e hostname separati (vedi [Due istanze: palazzetto e
circuito stradale](#due-istanze-palazzetto-e-circuito-stradale)).

**Stack**: Cloudflare Workers + [Hono](https://hono.dev) (TypeScript),
database Cloudflare D1, frontend statico vanilla (HTML/CSS/JS) servito dallo
stesso Worker. Progettato per stare nei limiti del piano gratuito di Workers.

## Struttura

```
prenotazioni/
├── wrangler.jsonc        # configurazione Worker, asset statici, binding D1
├── migrations/           # migrazioni SQL del database
├── src/
│   ├── index.ts          # entry point Hono (security header, mount rotte)
│   ├── slots.ts          # logica pura date/slot (Europe/Rome)
│   ├── auth.ts           # sessioni con cookie firmati HMAC-SHA256
│   ├── ratelimit.ts      # rate limit del login su D1
│   ├── conflitti.ts      # riconoscimento e diagnostica dei conflitti slot
│   ├── variazioni.ts     # modifica/annullamento: ambito, occorrenze, slot a blocchi
│   ├── ics.ts            # generazione calendario iCalendar
│   └── routes/           # pubblico.ts, societa.ts, admin.ts
├── public/               # frontend statico
│   ├── area.html         # area riservata delle società
│   ├── admin.html        # pannello amministrazione
│   ├── css/              # base / layout / components / main (@import)
│   └── js/               # constants / utils / api / ui / vista-calendario / tap-feedback + entry per pagina
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

Pagine: `/area` area società · `/admin` pannello amministrazione (password =
`ADMIN_PASSWORD` di `.dev.vars`). Non esiste una pagina pubblica: la radice `/`
reindirizza a `/area`, che senza sessione spiega che serve il link personale.

Per provare l'area società: crea una società dal pannello admin e visita il
link personale mostrato (`/accesso/<token>`).

Per ripartire da un database locale vuoto: cancella la cartella `.wrangler/`
e rilancia `npm run migrate:local`.

## Test e controlli

```bash
npm test              # suite completa (unit + integrazione su D1 reale)
npm run typecheck     # tsc --noEmit
```

I test applicano automaticamente le migrazioni a un D1 isolato: non toccano
il database di sviluppo.

## Due istanze: palazzetto e circuito stradale

Il sistema non ha un concetto di "struttura" nel database: il vincolo
anti-doppia-prenotazione è su `slot_key` (data + ora) e vale per un intero
database. Per usare lo stesso gestionale su due strutture con calendari
indipendenti, il codice viene pubblicato due volte tramite gli *environments*
di wrangler ([wrangler.jsonc](wrangler.jsonc)):

| | Palazzetto dello Sport | Circuito stradale |
|---|---|---|
| Ambiente wrangler | livello base (nessun `--env`) | `--env circuito` |
| Worker | `cardanoskating-prenotazioni` | `cardanoskating-circuito` |
| Database D1 | `cardanoskating-prenotazioni` | `cardanoskating-circuito` |
| Secret locali | `.dev.vars` | `.dev.vars.circuito` |
| Script npm | `dev`, `deploy`, `migrate:*` | `dev:circuito`, `deploy:circuito`, `migrate:*:circuito` |

Le due istanze sono del tutto indipendenti: società (ogni società riceve un
link personale per struttura), prenotazioni, report mensile, secret e sessioni.
Devono stare su **hostname distinti**: i cookie di sessione hanno path `/` e il
frontend usa percorsi assoluti, quindi sullo stesso hostname le due istanze si
sloggerebbero a vicenda.

Ciò che cambia tra le istanze sono le `vars` `NOME_STRUTTURA` e
`SIGLA_STRUTTURA` (lette da `strutturaDa()` in `src/util.ts`): titoli e testate
delle pagine (via `GET /api/struttura`, pubblico), **tema colore** (arancione
brand per il palazzetto, verde acceso per il circuito: attributo
`data-struttura` su `<html>` e override dei token `--accento-*` in
`public/css/base.css`, così le due istanze si distinguono a colpo d'occhio;
`privacy.html` non ha JS e resta arancione), nome mittente e prefisso
dell'oggetto delle email (`Prenotazioni Palazzetto` / `[Palazzetto]`), firma in
calce, nome del calendario ICS, nome del file `.ics` e **UID degli eventi ICS**
(`richiesta-<id>@<sigla>.prenotazioni.cardanoskating`): gli id delle richieste
ripartono da 1 in ogni database, e senza la sigla una società iscritta a
entrambi i feed vedrebbe gli eventi sovrascriversi. Orari di apertura e durata
degli slot sono uguali per tutte le strutture. La casella email è la stessa.

Per aggiungere una terza struttura basta un nuovo blocco in `env` di
`wrangler.jsonc` (con il proprio database) e gli script npm corrispondenti.

## Migrazioni

Le migrazioni vivono in `migrations/` e vengono applicate in ordine di nome.
Sono le stesse per tutte le istanze: ogni migrazione va applicata a **ogni**
database.

```bash
# creare una nuova migrazione (genera migrations/000N_nome.sql da compilare)
npx wrangler d1 migrations create cardanoskating-prenotazioni nome_migrazione

# applicare le migrazioni — palazzetto
npm run migrate:local     # al database locale
npm run migrate:remote    # al database di produzione (chiede conferma)

# applicare le migrazioni — circuito stradale
npm run migrate:local:circuito
npm run migrate:remote:circuito
```

## Primo deploy (una tantum)

1. **Crea il database D1** e copia l'id nel campo `database_id` di
   [wrangler.jsonc](wrangler.jsonc):

   ```bash
   npx wrangler d1 create cardanoskating-prenotazioni
   ```

2. **Crea i secret** (mai nel codice, mai in git):

   ```bash
   # chiave HMAC per la firma dei cookie: una stringa casuale lunga, es.
   #   openssl rand -hex 32
   #   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   npx wrangler secret put ADMIN_SECRET

   # password del pannello admin (robusta: lunga e non riutilizzata)
   npx wrangler secret put ADMIN_PASSWORD
   ```

3. **Applica le migrazioni al database remoto**:

   ```bash
   npm run migrate:remote
   ```

4. **Pubblica il Worker**:

   ```bash
   npm run deploy
   ```

Dopo il primo deploy: entra in `/admin` e verifica email/referente della
società "Cardano Skating S.R.L. S.S.D." creata dal seed. L'email deve
coincidere con `EMAIL_ADMIN` di `wrangler.jsonc`: è così che il sistema la
riconosce come società "di casa" e non le invia notifiche.

Per i deploy successivi basta `npm run deploy` (e `npm run migrate:remote` se
ci sono nuove migrazioni: applicale **prima** del deploy).

### Istanza del circuito stradale

Stessi passi, con il suffisso `:circuito` negli script npm e `--env circuito`
nei comandi wrangler:

```bash
# 1. database: copia l'id in wrangler.jsonc, campo env.circuito.d1_databases[0].database_id
npx wrangler d1 create cardanoskating-circuito

# 2. secret: sono per ambiente, vanno caricati di nuovo
npx wrangler secret put ADMIN_SECRET --env circuito
npx wrangler secret put ADMIN_PASSWORD --env circuito
npx wrangler secret put BREVO_API_KEY --env circuito

# 3. schema e pubblicazione
npm run migrate:remote:circuito
npm run deploy:circuito
```

Poi, dal pannello `/admin` della nuova istanza, verifica la società di casa
come sopra e ricrea le società che prenotano il circuito: ognuna riceve via
email un link personale distinto da quello del palazzetto.

## Backup e ripristino del database

```bash
# backup completo del DB di produzione in un file SQL
npx wrangler d1 export cardanoskating-prenotazioni --remote --output backup-$(date +%Y%m%d).sql

# backup del DB locale
npx wrangler d1 export cardanoskating-prenotazioni --local --output backup-locale.sql

# ripristino (su un DB vuoto appena creato)
npx wrangler d1 execute cardanoskating-prenotazioni --remote --file backup-YYYYMMDD.sql
```

Per l'istanza del circuito: `cardanoskating-circuito` come nome database e
`--env circuito` in coda a ogni comando.

Consiglio: fai un backup prima di ogni `migrate:remote`.

## Come funziona (in breve)

- **Slot**: ogni prenotazione occupa slot da 30 minuti identificati da
  `slot_key` (`YYYY-MM-DD_HHMM`, ora civile italiana). Il vincolo `UNIQUE`
  su `prenotazioni.slot_key` è la garanzia anti-doppia-prenotazione: le
  approvazioni avvengono in un `db.batch()` atomico e, se anche un solo slot
  è occupato, l'intera operazione viene annullata e l'admin vede quali slot
  confliggono e con chi.
- **Società**: non si registrano da sole. L'admin le crea dal pannello e la
  società riceve via email il link personale `/accesso/<token>` (anche dopo
  ogni «Rigenera link», e su richiesta con «Invia link»); il pannello mostra
  comunque il link, da consegnare a mano se l'email non arriva. Visitarlo
  imposta un cookie di sessione firmato (HMAC-SHA256 con `ADMIN_SECRET`).
  Rigenerare il link o sospendere la società invalida immediatamente ogni
  sessione già emessa.
  Nota di sicurezza: il link è la credenziale della società e l'email non è
  un canale sicuro (scelta consapevole del committente per semplificare la
  consegna). Chi legge quell'email può prenotare a nome della società: in
  caso di dubbio l'admin rigenera il link dal pannello e il vecchio smette
  subito di funzionare. Le altre notifiche non contengono mai il link.
- **Sospensione**: cancella anche tutte le prenotazioni future della società
  e annulla le sue richieste in attesa (operazione atomica, tracciata in
  `audit_log`). La riattivazione non ripristina nulla.
- **Eliminazione** (migrazione `0010`): una società già sospesa può essere
  eliminata dall'admin (`DELETE /api/admin/societa/:id`, conferma digitando il
  nome). È un'eliminazione *logica*: la riga viene marcata con `eliminata_at`
  e sparisce da elenco, società prenotabili e accessi, ma non viene cancellata
  dal database, perché report e CSV leggono nome e tariffa oraria con una JOIN
  su `societa.id` e le ore già svolte devono restare contabilizzabili. Le
  prenotazioni passate quindi restano; quelle future vengono liberate con la
  stessa cascata della sospensione. Non è reversibile dal pannello. La società
  di casa (id 1, seed della migrazione `0001`, con cui l'admin prenota le
  attività interne) non è eliminabile: il server risponde 409 e il pannello
  non mostra il pulsante, riconoscendola dal campo `di_casa` dell'elenco.
- **Ricorrenze** (migrazione `0008`): una richiesta può chiedere lo stesso
  orario per più giorni della settimana (es. lunedì, mercoledì e venerdì) e/o
  ripetersi ogni settimana, per massimo 4 settimane piene (finestra di 28
  giorni, quindi al più 7 × 4 = 28 occorrenze). Il giorno della data scelta fa
  sempre parte della serie; senza ripetizione settimanale gli altri giorni
  valgono solo per la settimana di quella data. L'admin approva o rifiuta
  l'intera serie con una sola decisione; all'approvazione le occorrenze
  vengono materializzate in un unico batch atomico come richieste
  indipendenti, così una singola data si può annullare senza rompere la
  serie. Anche la prenotazione diretta dell'admin può essere ricorrente, con
  le stesse regole: la serie nasce già approvata e viene materializzata
  subito, nello stesso batch.
- **Annullamenti** (migrazione `0005`): una richiesta ancora in attesa può
  essere ritirata direttamente dalla società; una prenotazione approvata
  futura invece si annulla solo con una richiesta di tipo `annullamento`
  (riferita alla prenotazione, al massimo una pendente per volta grazie a un
  indice UNIQUE parziale) che l'admin approva — liberando gli slot in un
  batch atomico — o rifiuta, sempre con motivazione. L'admin conserva la
  cancellazione diretta immediata dal suo pannello (che fa decadere le
  richieste di annullamento pendenti). Le richieste annullate restano nel
  database con stato `annullata` e timestamp `annullata_at`, per poter
  verificare quando una società ha rinunciato a uno slot.
- **Modifiche e annullamenti dal calendario** (migrazione `0009`): nel
  pannello admin e nell'area società ogni prenotazione propria nel calendario
  (settimana e mese) e nelle liste apre un popup di dettagli con le azioni
  disponibili. La **società** modifica direttamente le proprie richieste
  ancora in attesa (singole e ricorrenti, quest'ultime nell'intera
  definizione: giorni, orario, periodo, attività, note); per una prenotazione
  **approvata** invia invece una richiesta di tipo `modifica` (nuovi data,
  orario, attività, note) o di `annullamento`, che l'admin approva o rifiuta
  con motivazione: fino alla decisione resta valida la prenotazione attuale,
  e su ogni prenotazione può esserci una sola richiesta pendente (indice
  UNIQUE parziale). All'approvazione di una modifica la prenotazione
  originale viene aggiornata sul posto, con lo stesso id (il feed ICS
  aggiorna l'evento invece di ricrearlo), scambiando gli slot in un batch
  atomico; se cambia la data l'occorrenza esce dalla sua ricorrenza.
  L'**admin** modifica e annulla le prenotazioni approvate subito, senza
  motivazione, con email alla società; le richieste pendenti su una
  prenotazione modificata o annullata dall'admin decadono. L'admin non
  modifica mai una richiesta in attesa: la approva o la rifiuta soltanto.
  Su una prenotazione **ricorrente** il popup chiede l'ambito: *solo questa
  data* oppure *questa e le successive* occorrenze della serie; alla serie si
  propagano orario, attività e note, mai la data. Quando la società chiede
  modifica o annullamento su più occorrenze nasce un **gruppo** di richieste
  (`gruppo_id` comune) che l'admin decide in blocco con una sola motivazione
  (`POST /api/admin/gruppi/:gruppo/approva|rifiuta`) e che la società ritira
  tutto insieme; le richieste di un gruppo non si decidono singolarmente. Il
  controllo di disponibilità di una modifica ignora gli slot della
  prenotazione stessa, che verranno liberati nello stesso batch.
- **Motivazione delle decisioni** (migrazione `0004`): approvare o rifiutare
  una richiesta o una ricorrenza richiede una motivazione (2–300 caratteri,
  validata lato server). Per l'approvazione può essere breve ("ok"), per il
  rifiuto deve spiegare il perché. La motivazione è salvata sulla riga decisa
  (per le ricorrenze viene copiata in ogni richiesta materializzata), è
  visibile alla società nella sua area accanto allo stato ed è registrata in
  `audit_log`.
- **Colore per società** (migrazione `0006`): l'admin assegna a ogni società
  un colore `#RRGGBB` (validato lato server, default `#3b82f6`) alla
  creazione o dalla modifica. Nel calendario admin e in quello dell'area
  società ogni prenotazione usa il colore della sua società (sfondo
  semitrasparente + barra piena, con il nome nella cella e legenda
  dell'intervallo mostrato).
- **Calendario dell'area società** (`GET /api/societa/calendario`): stessa
  vista del pannello admin, con nome e colore della società su ogni fascia
  prenotata, così ogni società vede chi occupa la struttura. Titolo
  dell'attività e note restano riservati (non escono dall'API), le fasce
  altrui non sono cliccabili e le proprie richieste ancora in attesa sono
  evidenziate in giallo. Il rendering della griglia è condiviso con il
  pannello admin (`public/js/render-calendario.js`).
- **Tariffe e report mensile** (migrazione `0007`): ogni società ha una
  tariffa oraria (€/h), impostata dall'admin dal suo pannello (la creazione
  parte da 0). La vista "Report mensile" mostra, con una sola query aggregata,
  ore prenotate (slot approvati / 2), tariffa e importo per società più la
  riga totale; `GET /api/admin/report.csv?mese=AAAA-MM` esporta una riga per
  prenotazione in CSV per Excel italiano (BOM UTF-8, separatore `;`, numeri
  con la virgola, `Content-Disposition: attachment`). Le tariffe non
  compaiono mai nell'area società.
- **Vista settimanale o mensile**: nel pannello admin e nell'area società il
  calendario si commuta con l'interruttore "Settimana / Mese". La vista mensile
  disegna le settimane intere che contengono il mese (quindi anche i giorni di
  riempimento, in grigio) e mette nella cella di ogni giorno una voce per
  prenotazione — orario più nome società, con il colore della società; nell'area
  società si aggiungono le voci "In attesa" delle proprie richieste. Se le voci
  non entrano nella cella, quella cella scorre da sola. Il numero del giorno è
  un pulsante e apre la settimana corrispondente; il "+" del giorno apre il
  popup di prenotazione su quella data. Gli endpoint di calendario accettano
  `?mese=AAAA-MM` (oltre a `?settimana=AAAA-MM-GG`) e servono tutta la griglia
  con una sola query.
- **Calendario ICS**: ogni società ha un URL `/api/ics/<token>` da importare
  in Google Calendar (Impostazioni → Aggiungi calendario → Da URL) con le
  proprie prenotazioni approvate, fuso `Europe/Rome`. Un feed per struttura,
  con UID distinti per struttura (vedi sopra).

## Note operative

- **Fuso orario**: tutte le date/orari di dominio sono ora civile
  `Europe/Rome`; i timestamp tecnici (`*_at`) sono UTC.
- **Limiti piano gratuito**: nessuna query in loop (batch e query aggregate),
  batch di materializzazione ≤ ~7 statement, niente hashing password pesante
  (confronto in tempo costante su digest SHA-256).
- **Versioni**: `wrangler` è bloccato a `~4.35.0` per compatibilità con
  `@cloudflare/vitest-pool-workers`; `compatibility_date` in `wrangler.jsonc`
  è vincolata alla versione di workerd inclusa — non alzarla senza aggiornare
  entrambi.
- **Rate limit login**: 10 tentativi per IP ogni 15 minuti (tabella
  `rate_limit` su D1).
- **Audit**: le azioni rilevanti (accessi, approvazioni, annullamenti,
  sospensioni, login falliti) sono registrate nella tabella `audit_log`.
