import 'dotenv/config';
import express from 'express';
import { Liquid } from 'liquidjs';
import { fileURLToPath } from 'url';
import path from 'path';
import { setupAuth } from '../server/shopifyAuth.js';
import dashboardRoute from '../server/routes/dashboard.js';
import productDetailRoute from '../server/routes/productDetail.js';
import webhooksRoute from '../server/routes/webhooks.js';

// Resolve __dirname equivalent for ESM (works on Windows + Linux/Vercel)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const app = express();

// Trust Vercel's reverse proxy so req.protocol and req.ip are correct
app.set('trust proxy', 1);

// Allow Shopify Admin to embed this app in an iframe
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com;"
  );
  next();
});

// Liquid engine — use path.join for cross-platform safety
const viewsDir = path.join(projectRoot, 'views');
const pagesDir = path.join(viewsDir, 'pages');
const layoutsDir = path.join(viewsDir, 'layouts');
const partialsDir = path.join(viewsDir, 'partials');

const engine = new Liquid({
  root: [pagesDir, layoutsDir, partialsDir],
  extname: '.liquid',
  layouts: layoutsDir,
  partials: partialsDir,
});

app.engine('liquid', engine.express());
app.set('views', viewsDir);
app.set('view engine', 'liquid');

// Static files
app.use('/public', express.static(path.join(projectRoot, 'public')));

// Body parsers
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth
setupAuth(app);

// Routes
app.get('/app', dashboardRoute);
app.get('/app/dashboard', dashboardRoute);
app.get('/app/products/:id', productDetailRoute);
app.post('/webhooks', webhooksRoute);

// Root — when Shopify opens the app it passes ?shop=...&host=...
// Forward everything to /app so the session-token loader runs (not /auth which does old OAuth)
app.get('/', (req, res) => {
  const shop = req.query.shop;
  if (shop) {
    const q = new URLSearchParams(req.query);
    return res.redirect('/app?' + q.toString());
  }
  res.send('<h2>Photoshoot Diagnostic</h2><p>Install this app from your Shopify partner dashboard.</p>');
});

// Handle 404s
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export default app;
