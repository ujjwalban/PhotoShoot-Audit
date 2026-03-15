import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import { MemorySessionStorage } from '@shopify/shopify-app-session-storage-memory';

let shopify;
const sessionStorage = new MemorySessionStorage();

export function setupAuth(app) {
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

  // Begin OAuth
  app.get('/auth', async (req, res) => {
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
        // Redirect to OAuth
        return res.redirect(`/auth?shop=${shop}`);
      }

      req.shopifySession = validSession;
      req.shopify = shopify;
      next();
    } catch (err) {
      console.error('Session middleware error:', err);
      res.redirect(`/auth?shop=${req.query.shop || ''}`);
    }
  });
}

export { shopify };
