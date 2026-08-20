# CardanoSkating — Istruzioni di progetto

## Sicurezza e credenziali (repository PUBBLICO su GitHub)

Questo repository è pubblico: nessun segreto deve mai finire nella history di git.

- Tutte le password, API key, token, certificati e qualsiasi altro dato privato
  devono stare in file dedicati (es. `.dev.vars`, `.env`) elencati nel
  `.gitignore`, così da non essere mai pushati sul repository.
- Prima di creare o modificare un file che contiene segreti, verificare che sia
  già coperto dal `.gitignore`; se non lo è, aggiungerlo al `.gitignore` PRIMA
  di scriverci il segreto.
- Non inserire mai segreti hardcoded nel codice sorgente, nei file di
  configurazione tracciati (es. `wrangler.toml`) o nei commenti.
- Per ogni file di segreti mantenere un template tracciato con valori
  placeholder (es. `.dev.vars.example`), così la struttura resta documentata
  senza esporre i valori reali.
- Per i segreti di produzione su Cloudflare Workers usare `wrangler secret put`,
  mai variabili in chiaro in `wrangler.toml`.
- Prima di ogni commit, controllare che nel diff non compaiano segreti.
