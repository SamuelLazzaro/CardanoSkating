# Prenotazioni palazzetto — Cardano Skating S.R.L. S.S.D.

Sistema di prenotazione delle fasce orarie del palazzetto dello sport per le
società sportive esterne autorizzate. Le società richiedono slot da 30 minuti
(08:00–24:00, 7 giorni su 7), l'amministratore approva o rifiuta; il vincolo
`UNIQUE` sul database garantisce che uno slot non possa mai essere prenotato
due volte.

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
│   ├── ics.ts            # generazione calendario iCalendar
│   └── routes/           # pubblico.ts, societa.ts, admin.ts
├── public/               # frontend statico
│   ├── index.html        # calendario pubblico (slot occupati, senza nomi)
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

Pagine: `/` calendario pubblico · `/area` area società · `/admin` pannello
amministrazione (password = `ADMIN_PASSWORD` di `.dev.vars`).

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

## Migrazioni

Le migrazioni vivono in `migrations/` e vengono applicate in ordine di nome.

```bash
# creare una nuova migrazione (genera migrations/000N_nome.sql da compilare)
npx wrangler d1 migrations create cardanoskating-prenotazioni nome_migrazione

# applicare le migrazioni
npm run migrate:local     # al database locale
npm run migrate:remote    # al database di produzione (chiede conferma)
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

## Backup e ripristino del database

```bash
# backup completo del DB di produzione in un file SQL
npx wrangler d1 export cardanoskating-prenotazioni --remote --output backup-$(date +%Y%m%d).sql

# backup del DB locale
npx wrangler d1 export cardanoskating-prenotazioni --local --output backup-locale.sql

# ripristino (su un DB vuoto appena creato)
npx wrangler d1 execute cardanoskating-prenotazioni --remote --file backup-YYYYMMDD.sql
```

Consiglio: fai un backup prima di ogni `migrate:remote`.

## Come funziona (in breve)

- **Slot**: ogni prenotazione occupa slot da 30 minuti identificati da
  `slot_key` (`YYYY-MM-DD_HHMM`, ora civile italiana). Il vincolo `UNIQUE`
  su `prenotazioni.slot_key` è la garanzia anti-doppia-prenotazione: le
  approvazioni avvengono in un `db.batch()` atomico e, se anche un solo slot
  è occupato, l'intera operazione viene annullata e l'admin vede quali slot
  confliggono e con chi.
- **Società**: non si registrano da sole. L'admin le crea dal pannello e
  consegna il link personale `/accesso/<token>`; visitarlo imposta un cookie
  di sessione firmato (HMAC-SHA256 con `ADMIN_SECRET`). Rigenerare il link o
  sospendere la società invalida immediatamente ogni sessione già emessa.
- **Sospensione**: cancella anche tutte le prenotazioni future della società
  e annulla le sue richieste in attesa (operazione atomica, tracciata in
  `audit_log`). La riattivazione non ripristina nulla.
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
- **Motivazione delle decisioni** (migrazione `0004`): approvare o rifiutare
  una richiesta o una ricorrenza richiede una motivazione (2–300 caratteri,
  validata lato server). Per l'approvazione può essere breve ("ok"), per il
  rifiuto deve spiegare il perché. La motivazione è salvata sulla riga decisa
  (per le ricorrenze viene copiata in ogni richiesta materializzata), è
  visibile alla società nella sua area accanto allo stato ed è registrata in
  `audit_log`.
- **Colore per società** (migrazione `0006`): l'admin assegna a ogni società
  un colore `#RRGGBB` (validato lato server, default `#3b82f6`) alla
  creazione o dalla modifica. Nel calendario admin ogni prenotazione usa il
  colore della sua società (sfondo semitrasparente + barra piena, con legenda
  della settimana); nell'area società le proprie prenotazioni usano il
  proprio colore. Il calendario pubblico resta neutro e anonimo.
- **Tariffe e report mensile** (migrazione `0007`): ogni società ha una
  tariffa oraria (€/h), impostata dall'admin dal suo pannello (la creazione
  parte da 0). La vista "Report mensile" mostra, con una sola query aggregata,
  ore prenotate (slot approvati / 2), tariffa e importo per società più la
  riga totale; `GET /api/admin/report.csv?mese=AAAA-MM` esporta una riga per
  prenotazione in CSV per Excel italiano (BOM UTF-8, separatore `;`, numeri
  con la virgola, `Content-Disposition: attachment`). Le tariffe non
  compaiono mai nell'area società né nella parte pubblica.
- **Vista settimanale o mensile**: nel pannello admin e nell'area società il
  calendario si commuta con l'interruttore "Settimana / Mese". La vista mensile
  disegna le settimane intere che contengono il mese (quindi anche i giorni di
  riempimento, in grigio) e mette nella cella di ogni giorno una voce per
  prenotazione — orario più nome società nel pannello admin, orario più
  "Tua prenotazione / In attesa / Occupato" nell'area società, che resta
  anonima come la vista settimanale — con i colori delle società. Se le voci
  non entrano nella cella, quella cella scorre da sola. Il numero del giorno è
  un pulsante e apre la settimana corrispondente; il "+" del giorno apre il
  popup di prenotazione su quella data. Gli endpoint di calendario accettano
  `?mese=AAAA-MM` (oltre a `?settimana=AAAA-MM-GG`) e servono tutta la griglia
  con una sola query.
- **Calendario ICS**: ogni società ha un URL `/api/ics/<token>` da importare
  in Google Calendar (Impostazioni → Aggiungi calendario → Da URL) con le
  proprie prenotazioni approvate, fuso `Europe/Rome`.

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
