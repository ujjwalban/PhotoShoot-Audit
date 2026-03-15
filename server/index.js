import 'dotenv/config';
import express from 'express';
import { Liquid } from 'liquidjs';
import { fileURLToPath } from 'url';
import path from 'path';
import { setupAuth } from './shopifyAuth.js';
import dashboardRoute from './routes/dashboard.js';
import productDetailRoute from './routes/productDetail.js';
import webhooksRoute from './routes/webhooks.js';

// Resolve __dirname equivalent for ESM (works on Windows + Linux)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3000;

// Shopify Admin embeds apps in an iframe. Allow Shopify origins to frame this app.
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com;"
  );
  next();
});

// When deployed behind a proxy (Vercel), respect X-Forwarded-*.
app.set('trust proxy', 1);

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

// Raw body for webhooks MUST come before json parser
app.use('/webhooks', express.raw({ type: 'application/json' }));

// JSON/form parsing for everything else
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Shopify OAuth (installs auth routes + session middleware on /app/*)
setupAuth(app);

// App routes (all require authenticated session via middleware in setupAuth)
app.get('/app', dashboardRoute);
app.get('/app/dashboard', dashboardRoute);
app.get('/app/products/:id', productDetailRoute);

// Webhooks
app.post('/webhooks', webhooksRoute);

// Root — when opened from admin with shop (and host), go to /app so session-token flow runs. No auth redirect.
app.get('/', (req, res) => {
  const shop = req.query.shop;
  const host = req.query.host;
  if (shop) {
    const q = new URLSearchParams(req.query);
    return res.redirect('/app?' + q.toString());
  }
  res.send('<h2>Photoshoot Diagnostic</h2><p>Install this app from your Shopify partner dashboard.</p>');
});

app.listen(PORT, () => console.log(`Photoshoot Diagnostic running on port ${PORT}`));
