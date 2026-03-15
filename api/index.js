/**
 * Vercel serverless entry point.
 *
 * Exports the Express app as the default export so @vercel/node can wrap it.
 * All requests are routed here via vercel.json "routes".
 *
 * Template files (views/**) and static assets (public/**) are included in the
 * function bundle via builds[].config.includeFiles in vercel.json.
 */
import 'dotenv/config';
import express from 'express';
import { Liquid } from 'liquidjs';
import { fileURLToPath } from 'url';
import path from 'path';
import { setupAuth } from '../server/shopifyAuth.js';
import dashboardRoute from '../server/routes/dashboard.js';
import productDetailRoute from '../server/routes/productDetail.js';
import webhooksRoute from '../server/routes/webhooks.js';

/* ── paths ─────────────────────────────────────────────────────────────── */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const root       = path.resolve(__dirname, '..');

/* ── express ───────────────────────────────────────────────────────────── */
const app = express();
app.set('trust proxy', 1);

/* CSP — allow Shopify Admin to embed this app in an iframe */
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com;"
  );
  next();
});

/* ── Liquid template engine ────────────────────────────────────────────── */
const viewsDir    = path.join(root, 'views');
const pagesDir    = path.join(viewsDir, 'pages');
const layoutsDir  = path.join(viewsDir, 'layouts');
const partialsDir = path.join(viewsDir, 'partials');

const engine = new Liquid({
  root:     [pagesDir, layoutsDir, partialsDir],
  extname:  '.liquid',
  layouts:  layoutsDir,
  partials: partialsDir,
});

app.engine('liquid', engine.express());
app.set('views', viewsDir);
app.set('view engine', 'liquid');

/* ── static assets ─────────────────────────────────────────────────────── */
app.use('/public', express.static(path.join(root, 'public')));

/* ── body parsers ──────────────────────────────────────────────────────── */
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── auth (OAuth + session-token middleware on /app/*) ──────────────────── */
setupAuth(app);

/* ── app routes ────────────────────────────────────────────────────────── */
app.get('/app',              dashboardRoute);
app.get('/app/dashboard',    dashboardRoute);
app.get('/app/products/:id', productDetailRoute);
app.post('/webhooks',        webhooksRoute);

/* ── root redirect ─────────────────────────────────────────────────────── */
app.get('/', (req, res) => {
  if (req.query.shop) {
    return res.redirect('/app?' + new URLSearchParams(req.query).toString());
  }
  res.send(
    '<h2>Photoshoot Diagnostic</h2>' +
    '<p>Install this app from your Shopify partner dashboard.</p>'
  );
});

/* ── 404 ───────────────────────────────────────────────────────────────── */
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

export default app;
