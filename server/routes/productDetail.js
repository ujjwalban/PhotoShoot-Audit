import {
  fetchSingleProduct,
  fetchProductAnalytics,
  fetchProductReturns,
  extractId,
} from '../services/shopify.js';
import { computeBenchmarks, diagnoseProduct } from '../services/diagnosis.js';
import { analyzeImages } from '../services/imageAnalysis.js';

export default async function productDetailRoute(req, res) {
  const session = req.shopifySession;
  const productId = req.params.id;
  const productGid = `gid://shopify/Product/${productId}`;

  try {
    // Fetch everything in parallel
    const [product, analytics, returns] = await Promise.all([
      fetchSingleProduct(session, productId),
      fetchProductAnalytics(session),
      fetchProductReturns(session, productGid),
    ]);

    // Benchmarks from all analytics
    const benchmarks = computeBenchmarks(analytics);

    // This product's analytics
    const stats = analytics.find(a => extractId(a.productId) === productId) || {};

    const impressions = stats.sessions || 0;
    const views = stats.productViews || 0;
    const atc = stats.addedToCart || 0;
    const purchases = stats.orders || 0;

    // AI image analysis — only for this product, right now
    const imageScores = await analyzeImages(product.images, product.title, product.productType);

    const productData = {
      ...product,
      numericId: productId,
      impressions,
      productViews: views,
      addedToCart: atc,
      purchases,
      ctr: impressions > 0 ? +(views / impressions * 100).toFixed(1) : 0,
      atcRate: views > 0 ? +(atc / views * 100).toFixed(1) : 0,
      imageCount: product.images.length,
      firstImage: product.images[0]?.url || null,
      ...returns,
    };

    const returnRate = returns.totalOrders > 0
      ? +((returns.totalReturns / returns.totalOrders) * 100).toFixed(1)
      : 0;

    const diagnosis = diagnoseProduct(productData, benchmarks, imageScores);

    // Category peers — same productType, different product
    const peers = analytics
      .filter(a =>
        a.productType === product.productType &&
        extractId(a.productId) !== productId
      )
      .slice(0, 5)
      .map(a => ({
        title: a.title,
        ctr: a.sessions > 0 ? +(a.productViews / a.sessions * 100).toFixed(1) : 0,
        atcRate: a.productViews > 0 ? +(a.addedToCart / a.productViews * 100).toFixed(1) : 0,
      }));

    res.render('product-detail', {
      layout: 'app',
      shop: session.shop,
      host: req.query.host,
      active_page: 'products',
      page_script: 'product-detail',
      product: productData,
      images: product.images,
      imageScores,
      diagnosis,
      benchmarks,
      returnRate,
      peers,
    });
  } catch (err) {
    console.error('Product detail error:', err);
    res.status(500).send(`Error loading product: ${err.message}`);
  }
}
