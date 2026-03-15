/**
 * Shopify app authentication (OAuth + session tokens).
 *
 * FLOW FOR EMBEDDED APP (no cookies in iframe):
 * 1. Admin opens app → GET / or /app?shop=...&host=... (host = base64 from Shopify).
 * 2. Root redirects to /app with same query. Middleware sees no token but has host → sends loader HTML.
 * 3. Loader loads App Bridge from Shopify CDN, createApp({ apiKey, host }), getSessionToken(app).
 * 4. Loader redirects to same URL with ?token=JWT. Middleware decodes JWT, runs token exchange, stores session, renders app.
 * 5. In-app links preserve token via client script so navigation doesn’t lose it.
 *
 * FALLBACK: No host (e.g. direct install) → use stored session or show “Re-authenticate” (opens /auth in top window).
 */
import '@shopify/shopify-api/adapters/node';
import { shopifyApi, ApiVersion, RequestedTokenType } from '@shopify/shopify-api';
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

/** Auth URL for a given shop (used for links). */
export function getAuthUrl(req, shop) {
  const baseUrl = getAppBaseUrl(req);
  return `${baseUrl}/auth?shop=${encodeURIComponent(shop)}`;
}

/** Send HTML that breaks out of iframe and goes to /auth (so OAuth cookie is first-party). Use for initial install only. */
export function sendAuthBreakout(res, req, shop) {
  const authUrl = getAuthUrl(req, shop);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>` +
    `<script>window.top.location.href = ${JSON.stringify(authUrl)};</script>` +
    `<p>Redirecting to install…</p></body></html>`
  );
}

/** Send "click to re-authenticate" page. Does NOT auto-redirect, so no refresh loop when session is not persisted (e.g. Vercel serverless). */
function sendReauthPage(res, req, shop) {
  const authUrl = getAuthUrl(req, shop);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;max-width:360px;margin:40px auto;padding:20px;text-align:center;">` +
    `<p>Session expired or not found.</p>` +
    `<p><a href="${authUrl.replace(/"/g, '&quot;')}" target="_top" style="display:inline-block;padding:10px 20px;background:#5c6ac4;color:white;text-decoration:none;border-radius:6px;">Re-authenticate</a></p>` +
    `</body></html>`
  );
}

/**
 * Sends the embedded app session-token loader page.
 * This page runs inside the Shopify Admin iframe: loads App Bridge, gets a session token (no cookies),
 * then redirects to the same URL with ?token=JWT so the backend can exchange it for an access token.
 * Uses Shopify's official App Bridge CDN and waits for script load + timeout for reviewability.
 */
function sendSessionTokenLoader(res, req, shop, host) {
  const apiKey = process.env.SHOPIFY_API_KEY || '';
  const baseUrl = getAppBaseUrl(req);
  const currentPath = req.originalUrl || req.url;
  const sep = currentPath.includes('?') ? '&' : '?';
  const redirectPrefix = baseUrl + currentPath + sep + 'token=';
  const appBridgeScriptUrl = 'https://cdn.shopify.com/shopifycloud/app-bridge.js';
  const timeoutMs = 12000;

  const loaderHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Loading app…</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f6f6f7; }
    .box { text-align: center; padding: 2rem; max-width: 360px; }
    .msg { color: #202223; margin-bottom: 1rem; }
    .err { color: #d72c0d; }
    a { color: #2c6ecb; }
  </style>
</head>
<body>
  <div class="box">
    <p class="msg" id="msg">Loading…</p>
    <p class="msg err" id="err" style="display:none;"></p>
    <a id="retry" href="#" style="display:none;">Retry</a>
  </div>
  <script>
(function() {
  var apiKey = ${JSON.stringify(apiKey)};
  var host = ${JSON.stringify(host || '')};
  var redirectPrefix = ${JSON.stringify(redirectPrefix)};
  var timeoutMs = ${timeoutMs};
  var msg = document.getElementById('msg');
  var errEl = document.getElementById('err');
  var retryLink = document.getElementById('retry');

  function showError(title, detail) {
    msg.textContent = title;
    if (detail) { errEl.textContent = detail; errEl.style.display = 'block'; }
    var p = new URLSearchParams(window.location.search);
    p.delete('token');
    var q = p.toString();
    retryLink.href = window.location.pathname + (q ? '?' + q : '');
    retryLink.style.display = 'inline';
  }

  if (!apiKey || !host) {
    showError('Configuration error', 'Missing shop or host. Reopen the app from Shopify Admin.');
    return;
  }

  var timedOut = false;
  var timeoutId = setTimeout(function() {
    timedOut = true;
    showError('Loading is taking too long.', 'Close this app and open it again from the Shopify admin.');
  }, timeoutMs);

  var script = document.createElement('script');
  script.src = ${JSON.stringify(appBridgeScriptUrl)};
  script.onerror = function() {
    if (timedOut) return;
    clearTimeout(timeoutId);
    showError('Could not load App Bridge.', 'Check your connection and retry.');
  };
  script.onload = function() {
    if (timedOut) return;
    clearTimeout(timeoutId);

    var Ab = window['app-bridge'] || window['AppBridge'];
    if (!Ab) {
      showError('App Bridge did not load.', 'Try reopening the app from Shopify Admin.');
      return;
    }
    var createApp = Ab.createApp || (Ab.default && Ab.default.createApp);
    if (typeof createApp !== 'function') {
      showError('App Bridge version not supported.', '');
      return;
    }
    var app = createApp({ apiKey: apiKey, host: host });
    var getSessionToken = (Ab.utilities && Ab.utilities.getSessionToken) || (app && app.getSessionToken);
    if (typeof getSessionToken !== 'function') {
      showError('Session token not available.', '');
      return;
    }
    var promise = getSessionToken(app);
    if (!promise || typeof promise.then !== 'function') {
      showError('Could not get session token.', '');
      return;
    }
    promise.then(function(token) {
      if (timedOut || !token) return;
      window.location.replace(redirectPrefix + encodeURIComponent(token));
    }).catch(function(e) {
      if (timedOut) return;
      clearTimeout(timeoutId);
      showError('Session token failed.', (e && e.message) || 'Reopen the app from Shopify Admin.');
    });
  };
  document.head.appendChild(script);
})();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(loaderHtml);
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
  // Supports session tokens (embedded app, no cookies) and fallback to stored session.
  app.use('/app', async (req, res, next) => {
    try {
      const shop = req.query.shop || req.headers['x-shopify-shop-domain'];
      const host = req.query.host;
      const sessionToken =
        (req.headers.authorization && req.headers.authorization.match(/^Bearer\s+(.+)$/)?.[1]) ||
        req.query.token ||
        req.query.id_token;

      if (!shop) {
        return res.status(400).send('Missing shop parameter. Add ?shop=yourstore.myshopify.com');
      }

      let session = null;

      if (sessionToken) {
        try {
          const payload = await shopify.session.decodeSessionToken(sessionToken);
          const shopFromToken = (payload.dest || '').replace(/^https:\/\//, '').replace(/\/$/, '');
          const sessionId = shopify.session.getJwtSessionId(shopFromToken, payload.sub);
          session = await sessionStorage.loadSession(sessionId);
          if (session && session.accessToken && (!session.expires || new Date(session.expires) > new Date())) {
            req.shopifySession = session;
            req.shopify = shopify;
            return next();
          }
          const exchanged = await shopify.auth.tokenExchange({
            shop: shopFromToken,
            sessionToken,
            requestedTokenType: RequestedTokenType.OnlineAccessToken,
          });
          await sessionStorage.storeSession(exchanged.session);
          req.shopifySession = exchanged.session;
          req.shopify = shopify;
          return next();
        } catch (tokenErr) {
          console.error('Session token error:', tokenErr);
          // Don't fall through to loader — would cause reload loop. Show reauth instead.
          return sendReauthPage(res, req, shop);
        }
      }

      // No valid token: if embedded (has host), serve loader to get session token (no cookies needed)
      if (host) {
        return sendSessionTokenLoader(res, req, shop, host);
      }

      // No host: try stored session (e.g. after OAuth in top window)
      const sessions = await sessionStorage.findSessionsByShop(shop);
      const validSession = sessions.find(s => s.accessToken && (!s.expires || new Date(s.expires) > new Date()));
      if (validSession) {
        req.shopifySession = validSession;
        req.shopify = shopify;
        return next();
      }

      return sendReauthPage(res, req, shop);
    } catch (err) {
      console.error('Session middleware error:', err);
      const shop = req.query.shop || '';
      if (shop) return sendAuthBreakout(res, req, shop);
      return res.redirect('/');
    }
  });
}

export { shopify };
