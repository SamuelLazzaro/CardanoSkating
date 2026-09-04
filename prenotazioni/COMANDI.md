# Comandi — riferimento operativo

Cheat-sheet dei comandi del sistema prenotazioni, organizzato per operazione.
Per la spiegazione di come funziona il sistema vedi [README.md](README.md).

> ⚠️ **Tutti i comandi vanno eseguiti da dentro `prenotazioni/`**, mai dalla
> root del repo: dalla root `npx` risolve un wrangler diverso e non trova
> `wrangler.jsonc`.

> ℹ️ Il nome del database D1 è **`cardanoskating-prenotazioni`**
> (il binding nel codice si chiama `DB`, ma nei comandi wrangler va usato
> sempre il nome del database).

---

## Riepilogo comandi npm

| Comando | Cosa fa | Quando chiamarlo |
|---|---|---|
| `npm run dev` | Avvia il dev server locale su `http://localhost:8787` | Durante lo sviluppo, per provare le modifiche in locale |
| `npm run deploy` | Compila e pubblica il Worker (codice + frontend `public/`) su Cloudflare | Dopo ogni modifica che vuoi portare in produzione |
| `npm test` | Esegue tutta la suite di test (unit + integrazione su D1 isolato) | Prima di ogni commit e prima di ogni deploy |
| `npm run test:watch` | Test in modalità watch (rilancia al salvataggio) | Durante lo sviluppo di logica o API |
| `npm run typecheck` | Controllo dei tipi TypeScript (`tsc --noEmit`) | Prima di ogni commit; sempre insieme ai test |
| `npm run migrate:local` | Applica le migrazioni al database **locale** (`.wrangler/`) | Al primo setup e dopo ogni nuova migrazione, prima di `npm run dev` |
| `npm run migrate:remote` | Applica le migrazioni al database di **produzione** (chiede conferma) | Solo quando c'è una nuova migrazione, **prima** del deploy |

---

## Operazioni

### Aggiornare il server remoto dopo una modifica

Il caso più frequente: hai modificato codice in `src/` o frontend in `public/`
e vuoi portare la modifica in produzione.

```bash
npm test              # la suite deve essere verde
npm run typecheck     # nessun errore di tipi
npm run deploy        # pubblica il Worker su Cloudflare
```

Se la modifica include una **nuova migrazione**, vedi l'operazione
[Aggiungere una migrazione](#aggiungere-una-migrazione-al-database): il
`migrate:remote` va fatto **prima** del deploy.

### Sviluppo locale quotidiano

```bash
npm run dev           # dev server su http://localhost:8787
```

Pagine: `/area` area società (la radice `/` ci reindirizza) · `/admin` pannello
admin (password = `ADMIN_PASSWORD` in `.dev.vars`).

In parallelo, se stai toccando logica o API:

```bash
npm run test:watch    # rilancia i test a ogni salvataggio
```

### Setup iniziale dell'ambiente locale (una tantum per macchina)

```bash
npm install

# secret locali: copia l'esempio e imposta i valori (file ignorato da git)
cp .dev.vars.example .dev.vars

# crea/aggiorna il database locale (file sqlite in .wrangler/)
npm run migrate:local
```

### Aggiungere una migrazione al database

```bash
# 1. genera migrations/000N_nome.sql, poi compilalo con l'SQL
npx wrangler d1 migrations create cardanoskating-prenotazioni nome_migrazione

# 2. applicala in locale e verifica che tutto funzioni
npm run migrate:local
npm test

# 3. backup del DB di produzione (consigliato prima di ogni migrate:remote)
#    → vedi "Backup del database"

# 4. applicala in produzione, POI pubblica il codice che la usa
npm run migrate:remote
npm run deploy
```

L'ordine migrazione → deploy evita che il nuovo codice giri contro uno schema
vecchio. Le migrazioni sono applicate in ordine di nome file; wrangler tiene
traccia di quelle già eseguite, quindi rilanciare i comandi è sicuro.

### Backup del database

```bash
# produzione → file SQL (bash / WSL)
npx wrangler d1 export cardanoskating-prenotazioni --remote --output backup-$(date +%Y%m%d).sql

# stessa cosa da PowerShell
npx wrangler d1 export cardanoskating-prenotazioni --remote --output backup-$(Get-Date -Format yyyyMMdd).sql

# database locale
npx wrangler d1 export cardanoskating-prenotazioni --local --output backup-locale.sql
```

Quando: prima di ogni `migrate:remote` e periodicamente (i file di backup non
vanno committati).

### Ripristinare un backup

```bash
# su un database vuoto appena creato
npx wrangler d1 execute cardanoskating-prenotazioni --remote --file backup-YYYYMMDD.sql
```

### Ripartire da un database locale vuoto

```bash
# cancella lo stato locale e ricrea lo schema
rm -rf .wrangler          # PowerShell: Remove-Item -Recurse -Force .wrangler
npm run migrate:local
```

### Primo deploy in produzione (una tantum)

Prerequisito: `npx wrangler login` (autenticazione sull'account Cloudflare).

```bash
# 1. crea il database D1 e copia l'id in wrangler.jsonc (campo database_id)
npx wrangler d1 create cardanoskating-prenotazioni

# 2. crea i secret di produzione (mai nel codice, mai in git)
npx wrangler secret put ADMIN_SECRET      # chiave HMAC firma cookie: stringa casuale lunga (es. openssl rand -hex 32)
npx wrangler secret put ADMIN_PASSWORD    # password del pannello admin

# 3. schema del database in produzione
npm run migrate:remote

# 4. pubblica il Worker
npm run deploy
```

Dopo il primo deploy: entra in `/admin` e verifica email/referente della
società "Cardano Skating S.R.L. S.S.D." creata dal seed (l'email deve
coincidere con `EMAIL_ADMIN` di `wrangler.jsonc`, altrimenti la società di
casa riceve le notifiche come una società esterna).

### Ripartire da un database di produzione vuoto

Da usare solo finché il sistema non è in uso reale (cancella TUTTI i dati).
Svuota il DB mantenendo lo stesso `database_id`, così `wrangler.jsonc` non
cambia; la tabella `d1_migrations` va eliminata anche lei, altrimenti wrangler
crede che le migrazioni siano già applicate.

```bash
# 1. backup, per sicurezza → vedi "Backup del database"

# 2. elimina tutte le tabelle (chiede conferma)
npx wrangler d1 execute cardanoskating-prenotazioni --remote --command "DROP TABLE IF EXISTS prenotazioni; DROP TABLE IF EXISTS richieste; DROP TABLE IF EXISTS ricorrenze; DROP TABLE IF EXISTS rate_limit; DROP TABLE IF EXISTS audit_log; DROP TABLE IF EXISTS societa; DROP TABLE IF EXISTS d1_migrations;"

# 3. ricrea lo schema (riapplica tutte le migrazioni, seed compreso)
npm run migrate:remote

# 4. pubblica il codice
npm run deploy
```

Alternativa equivalente: `npx wrangler d1 delete cardanoskating-prenotazioni`
seguito da `npx wrangler d1 create cardanoskating-prenotazioni` — ma il nuovo
`database_id` va poi copiato in `wrangler.jsonc`.

### Gestire i secret di produzione

```bash
npx wrangler secret list                  # elenca i secret esistenti (solo i nomi)
npx wrangler secret put ADMIN_PASSWORD    # crea o aggiorna (chiede il valore in input)
```

Quando: al primo deploy e ogni volta che va ruotata la password admin o la
chiave di firma. Attenzione: cambiare `ADMIN_SECRET` invalida tutte le sessioni
attive (i cookie firmati con la chiave vecchia non sono più validi).
