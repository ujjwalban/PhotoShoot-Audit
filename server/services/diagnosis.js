/**
 * Diagnosis Engine — pure functions, no side effects, no storage.
 */

const STAGE_META = {
  thumbnail_ctr: {
    label: 'Low Thumbnail CTR',
    why: 'Product gets shown but nobody clicks — listing thumbnail is failing',
    fix: 'AI lifestyle thumbnail with better lighting, angles, and product context',
  },
  page_conversion: {
    label: 'Low Page Conversion',
    why: 'Users visit but don\'t add to cart — on-page photos aren\'t convincing',
    fix: 'AI hero shot with professional staging and product context',
  },
  image_quality: {
    label: 'Poor Image Quality',
    why: 'AI detected bad lighting, background, or composition issues',
    fix: 'AI photos with studio lighting and clean backgrounds',
  },
  too_few_images: {
    label: 'Too Few Images',
    why: 'Less than 3 images — not enough visual information for buyers',
    fix: 'AI multi-angle gallery: front, back, detail, lifestyle',
  },
  no_variety: {
    label: 'No Image Variety',
    why: 'Missing lifestyle shots, scale reference, or texture close-ups',
    fix: 'AI variety pack: lifestyle, texture detail, scale reference',
  },
  misleading_photos: {
    label: 'Misleading Photos',
    why: 'High "not as described" returns — photos set wrong expectations',
    fix: 'AI photos with accurate colors and realistic representation',
  },
  high_interest_low_conversion: {
    label: 'High Interest, Low Conversion',
    why: 'People WANT this product (healthy CTR) but photos lose the sale (terrible ATC)',
    fix: 'AI trust-building shots: texture detail, scale reference, lifestyle context',
  },
};

/**
 * Compute store-wide benchmarks from products with enough data.
 * @param {Array} products - merged product+analytics objects
 * @returns {{ avgCtr: number, avgAtcRate: number }}
 */
export function computeBenchmarks(products) {
  const qualifying = products.filter(p => (p.sessions || p.impressions || 0) > 50);

  if (qualifying.length === 0) {
    return { avgCtr: 3.0, avgAtcRate: 5.0 }; // sensible defaults
  }

  const avgCtr = qualifying.reduce((sum, p) => sum + (p.ctr || 0), 0) / qualifying.length;
  const avgAtcRate = qualifying.reduce((sum, p) => sum + (p.atcRate || 0), 0) / qualifying.length;

  return {
    avgCtr: +avgCtr.toFixed(2),
    avgAtcRate: +avgAtcRate.toFixed(2),
  };
}

/**
 * Get human-readable label for a stage key.
 */
export function getStageLabel(key) {
  return STAGE_META[key]?.label || key;
}

/**
 * Diagnose a single product.
 *
 * @param {Object} product - merged product data with analytics + returns
 * @param {Object} benchmarks - { avgCtr, avgAtcRate }
 * @param {Object|null} imageScores - from imageAnalysis service (or null)
 * @returns {{ health: 'good'|'warn'|'critical', flags: string[], flagDetails: Array }}
 */
export function diagnoseProduct(product, benchmarks, imageScores = null) {
  const flags = [];

  const {
    ctr = 0,
    atcRate = 0,
    impressions = 0,
    productViews = 0,
    imageCount = 0,
    totalReturns = 0,
    totalOrders = 0,
    notAsDescribed = 0,
  } = product;

  const { avgCtr, avgAtcRate } = benchmarks;

  // Stage 1: Low Thumbnail CTR
  if (ctr < avgCtr * 0.6 && impressions > 100) {
    flags.push('thumbnail_ctr');
  }

  // Stage 2: Low Page Conversion
  if (atcRate < avgAtcRate * 0.5 && productViews > 50) {
    flags.push('page_conversion');
  }

  // Stage 3: Poor Image Quality (only if AI scores available)
  if (imageScores && imageScores.overall < 50) {
    flags.push('image_quality');
  }

  // Stage 4: Too Few Images
  if (imageCount < 3) {
    flags.push('too_few_images');
  }

  // Stage 5: No Variety (only if AI scores available)
  if (imageScores) {
    const varietyCount = [
      imageScores.hasLifestyle,
      imageScores.hasScale,
      imageScores.hasDetail,
      imageScores.hasInUse,
      imageScores.hasMultiAngle,
    ].filter(Boolean).length;

    if (varietyCount < 2) {
      flags.push('no_variety');
    }
  }

  // Stage 6: Misleading Photos
  if (notAsDescribed > 2 || (totalOrders > 0 && totalReturns / totalOrders > 0.15)) {
    flags.push('misleading_photos');
  }

  // Stage 7: High Interest, Low Conversion
  if (ctr >= avgCtr * 0.8 && atcRate < avgAtcRate * 0.5 && productViews > 50) {
    if (!flags.includes('page_conversion')) {
      flags.push('high_interest_low_conversion');
    } else {
      // Add it alongside page_conversion if it qualifies
      flags.push('high_interest_low_conversion');
    }
  }

  // Deduplicate
  const uniqueFlags = [...new Set(flags)];

  const health = uniqueFlags.length === 0 ? 'good'
    : uniqueFlags.length <= 2 ? 'warn'
    : 'critical';

  const flagDetails = uniqueFlags.map(key => ({
    key,
    ...STAGE_META[key],
  }));

  return { health, flags: uniqueFlags, flagDetails };
}
