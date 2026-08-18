import { Hono } from 'hono';
import type { Bindings } from './tipi';
import { pubblico } from './routes/pubblico';
import { societa } from './routes/societa';
import { admin } from './routes/admin';

const app = new Hono<{ Bindings: Bindings }>();

// Security headers on every Worker response.
// Static files in public/ are served before the Worker runs,
// so their headers live in public/_headers instead.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  c.header('Cache-Control', 'no-store');
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.route('/api/societa', societa);
app.route('/api/admin', admin);
app.route('/', pubblico);

// Generic handlers: never leak internal details to the client.
app.notFound((c) => c.json({ errore: 'Risorsa non trovata' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ errore: 'Errore interno' }, 500);
});

export default app;
