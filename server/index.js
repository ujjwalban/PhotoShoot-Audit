import 'dotenv/config';
import express from 'express';
import { Liquid } from 'liquidjs';
import { setupAuth } from './shopifyAuth.js';
import dashboardRoute from './routes/dashboard.js';
import productDetailRoute from './routes/productDetail.js';
import webhooksRoute from './routes/webhooks.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Liquid engine — search pages, then layouts, then partials
const engine = new Liquid({
  root: [
    new URL('../views/pages', import.meta.url).pathname,
    new URL('../views/layouts', import.meta.url).pathname,
    new URL('../views/partials', import.meta.url).pathname,
  ],
  extname: '.liquid',
  layouts: new URL('../views/layouts', import.meta.url).pathname,
  partials: new URL('../views/partials', import.meta.url).pathname,
});

app.engine('liquid', engine.express());
app.set('views', new URL('../views', import.meta.url).pathname);
app.set('view engine', 'liquid');

// Static files
app.use('/public', express.static(new URL('../public', import.meta.url).pathname));

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
