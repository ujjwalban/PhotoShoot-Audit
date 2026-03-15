import '@shopify/shopify-api/adapters/node';
import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import { MemorySessionStorage } from '@shopify/shopify-app-session-storage-memory';

let shopify;
const sessionStorage = new MemorySessionStorage();

/** Build app base URL for redirects (respects Vercel/proxy). */
function getAppBaseUrl(req) {
  const envUrl = process.env.SHOPIFY_APP_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') === 'https' ? 'https' : req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  return `${proto}://${host}`;
}

/** Send HTML that breaks out of iframe and goes to /auth (so OAuth cookie is first-party). */
export function sendAuthBreakout(res, req, shop) {
  const baseUrl = getAppBaseUrl(req);
  const authUrl = `${baseUrl}/auth?shop=${encodeURIComponent(shop)}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>` +
    `<script>window.top.location.href = ${JSON.stringify(authUrl)};</script>` +
    `<p>Redirecting to install…</p></body></html>`
  );
}

export function setupAuth(app) {
  // SHOPIFY_APP_URL must match your app URL (e.g. https://photo-shoot-audit.vercel.app) for OAuth redirect_uri and cookies
  shopify = shopifyApi({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    scopes: process.env.SCOPES?.split(',') || ['read_products', 'read_orders', 'read_analytics'],
    hostName: (process.env.SHOPIFY_APP_URL || '').replace(/^https?:\/\//, ''),
    apiVersion: ApiVersion.January26,
    isEmbeddedApp: true,
    sessionStorage,
    logger: { level: 0 },
  });

  // Step 1: /auth — ensure we're in top window (break out of iframe), then go to /auth/start
  // This guarantees the OAuth cookie is set in a first-party context.
  app.get('/auth', (req, res) => {
    const shop = req.query.shop;
    if (!shop) return res.status(400).send('Missing shop parameter');
    const baseUrl = getAppBaseUrl(req);
    const authUrl = `${baseUrl}/auth?shop=${encodeURIComponent(shop)}`;
    const startUrl = `${baseUrl}/auth/start?shop=${encodeURIComponent(shop)}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>` +
      `<script>` +
      `if (window !== window.top) { window.top.location.href = ${JSON.stringify(authUrl)}; }` +
      `else { window.location.href = ${JSON.stringify(startUrl)}; }` +
      `</script>` +
      `<p>Redirecting…</p></body></html>`
    );
  });

  // Step 2: /auth/start — actually start OAuth (sets cookie and redirects to Shopify)
  app.get('/auth/start', async (req, res) => {
    const shop = req.query.shop;
    if (!shop) return res.status(400).send('Missing shop parameter');
    try {
      await shopify.auth.begin({
        shop: shopify.utils.sanitizeShop(shop, true),
        callbackPath: '/auth/callback',
        isOnline: true,
        rawRequest: req,
        rawResponse: res,
      });
    } catch (err) {
      console.error('Auth begin error:', err);
      res.status(500).send('OAuth error: ' + err.message);
    }
  });

  // OAuth callback
  app.get('/auth/callback', async (req, res) => {
    try {
      const callback = await shopify.auth.callback({
        rawRequest: req,
        rawResponse: res,
      });
      await sessionStorage.storeSession(callback.session);
      const shop = callback.session.shop;
      // Redirect into embedded app
      const redirectUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
      res.redirect(redirectUrl);
    } catch (err) {
      console.error('Auth callback error:', err);
      res.status(500).send('OAuth callback error: ' + err.message);
    }
  });

  // Session middleware — protect all /app/* routes
  app.use('/app', async (req, res, next) => {
    try {
      const shop = req.query.shop || req.headers['x-shopify-shop-domain'];

      if (!shop) {
        return res.status(400).send('Missing shop parameter. Add ?shop=yourstore.myshopify.com');
      }

      // Try to find an online session for this shop
      const sessions = await sessionStorage.findSessionsByShop(shop);
      const validSession = sessions.find(s => s.accessToken && (!s.expires || new Date(s.expires) > new Date()));

      if (!validSession) {
        // Break out of iframe so OAuth runs in top window (cookie is first-party)
        return sendAuthBreakout(res, req, shop);
      }

      req.shopifySession = validSession;
      req.shopify = shopify;
      next();
    } catch (err) {
      console.error('Session middleware error:', err);
      const shop = req.query.shop || '';
      if (shop) return sendAuthBreakout(res, req, shop);
      return res.redirect('/');
    }
  });
}

export { shopify };
