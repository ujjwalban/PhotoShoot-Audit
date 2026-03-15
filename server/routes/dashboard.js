import { fetchAllProducts, fetchProductAnalytics, extractId } from '../services/shopify.js';
import { computeBenchmarks, diagnoseProduct, getStageLabel } from '../services/diagnosis.js';

const STAGE_KEYS = [
  'thumbnail_ctr',
  'page_conversion',
  'too_few_images',
  'misleading_photos',
  'high_interest_low_conversion',
];

export default async function dashboardRoute(req, res) {
  const session = req.shopifySession;
  const stageFilter = req.query.stage || null;

  try {
    // Fetch live — no cache
    const [products, analytics] = await Promise.all([
      fetchAllProducts(session),
      fetchProductAnalytics(session),
    ]);

    // Merge product data with analytics
    const merged = products.map(p => {
      const numericId = extractId(p.id);
      const a = analytics.find(x => extractId(x.productId) === numericId) || {};

      const impressions = a.sessions || 0;
      const views = a.productViews || 0;
      const atc = a.addedToCart || 0;
      const orders = a.orders || 0;

      return {
        ...p,
        numericId,
        impressions,
        productViews: views,
        addedToCart: atc,
        purchases: orders,
        ctr: impressions > 0 ? +(views / impressions * 100).toFixed(1) : 0,
        atcRate: views > 0 ? +(atc / views * 100).toFixed(1) : 0,
        imageCount: p.images.length,
        firstImage: p.images[0]?.url || null,
        // Returns data not available on dashboard (too expensive to fetch per product)
        totalOrders: orders,
        totalReturns: 0,
        notAsDescribed: 0,
      };
    });

    // Compute benchmarks across all merged products
    const benchmarks = computeBenchmarks(merged);

    // Run diagnosis (no image scores on dashboard — AI is per product on detail page)
    const diagnosed = merged.map(p => ({ ...p, ...diagnoseProduct(p, benchmarks) }));

    // Stage filter counts
    const stageCounts = STAGE_KEYS.map(key => ({
      key,
      label: getStageLabel(key),
      count: diagnosed.filter(p => p.flags.includes(key)).length,
    }));

    // Apply stage filter
    const filtered = stageFilter
      ? diagnosed.filter(p => p.flags.includes(stageFilter))
      : diagnosed;

    // Sort: critical → warn → good, then by productViews desc
    const order = { critical: 0, warn: 1, good: 2 };
    filtered.sort((a, b) => {
      const healthDiff = (order[a.health] ?? 2) - (order[b.health] ?? 2);
      if (healthDiff !== 0) return healthDiff;
      return (b.productViews || 0) - (a.productViews || 0);
    });

    // Summary stats
    const critical = diagnosed.filter(p => p.health === 'critical');
    const warn = diagnosed.filter(p => p.health === 'warn');
    const healthy = diagnosed.filter(p => p.health === 'good');

    // Estimate missed add-to-carts from critical products
    const missedAtc = critical.reduce((sum, p) => {
      const expected = Math.round((benchmarks.avgAtcRate / 100) * (p.productViews || 0));
      return sum + Math.max(0, expected - (p.addedToCart || 0));
    }, 0);

    const avgPrice = critical.length > 0
      ? critical.reduce((s, p) => s + (p.price || 0), 0) / critical.length
      : 0;

    const revenueLost = Math.round(missedAtc * avgPrice);

    res.render('dashboard', {
      layout: 'app',
      shop: session.shop,
      host: req.query.host,
      active_page: 'dashboard',
      active_stage: stageFilter || '',
      benchmarks,
      products: filtered,
      stageCounts,
      totalProducts: diagnosed.length,
      summary: {
        total: diagnosed.length,
        healthy: healthy.length,
        warn: warn.length,
        critical: critical.length,
        missedAtc,
        revenueLost,
      },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).render('dashboard', {
      layout: 'app',
      shop: session.shop,
      host: req.query.host,
      active_page: 'dashboard',
      active_stage: '',
      benchmarks: { avgCtr: 0, avgAtcRate: 0 },
      products: [],
      stageCounts: [],
      totalProducts: 0,
      summary: { total: 0, healthy: 0, warn: 0, critical: 0, missedAtc: 0, revenueLost: 0 },
      error: err.message,
    });
  }
}
