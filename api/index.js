import 'dotenv/config';
import express from 'express';
import { Liquid } from 'liquidjs';
import { setupAuth } from '../server/shopifyAuth.js';
import dashboardRoute from '../server/routes/dashboard.js';
import productDetailRoute from '../server/routes/productDetail.js';
import webhooksRoute from '../server/routes/webhooks.js';

const app = express();

// Liquid engine
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

// Root
app.get('/', (req, res) => {
  const shop = req.query.shop;
  if (shop) return res.redirect(`/auth?shop=${shop}`);
  res.send('<h2>Photoshoot Diagnostic</h2><p>Install this app from your Shopify partner dashboard.</p>');
});

// Handle 404s
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export default app;
