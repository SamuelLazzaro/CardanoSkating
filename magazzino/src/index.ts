import { Hono } from 'hono';
import type { Bindings } from './tipi';
import { accesso } from './routes/accesso';
import { atleti } from './routes/atleti';
import { articoli } from './routes/articoli';
import { movimenti } from './routes/movimenti';
import { riepilogo } from './routes/riepilogo';

const app = new Hono<{ Bindings: Bindings }>();

// Header di sicurezza su ogni risposta del Worker.
// I file statici in public/ vengono serviti prima che il Worker giri,
// quindi i loro header stanno in public/_headers.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  c.header('Cache-Control', 'no-store');
});

app.get('/api/health', (c) => c.json({ ok: true }));

// Ogni router riservato applica da sé il middleware di sessione (richiedeUtente).
app.route('/api/atleti', atleti);
app.route('/api/articoli', articoli);
app.route('/api/movimenti', movimenti);
app.route('/api/riepilogo', riepilogo);
app.route('/api', accesso);

// Gestori generici: mai far trapelare dettagli interni al client.
app.notFound((c) => c.json({ errore: 'Risorsa non trovata' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ errore: 'Errore interno' }, 500);
});

export default app;
