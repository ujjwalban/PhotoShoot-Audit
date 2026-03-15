import Anthropic from '@anthropic-ai/sdk';

let anthropicClient = null;

function getClient() {
  if (!anthropicClient && process.env.ANTHROPIC_API_KEY) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

/**
 * Fetch an image URL and return it as a base64 string with media type.
 */
async function fetchImageAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${url}`);
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  // Shopify CDN serves webp and jpeg — Claude supports jpeg, png, gif, webp
  const mediaType = contentType.split(';')[0].trim();
  return { base64, mediaType: mediaType || 'image/jpeg' };
}

/**
 * Heuristic scoring when Anthropic API is not configured.
 */
export function fallbackScores(images) {
  const count = images.length;
  let base = count < 3 ? 30 : count <= 5 ? 50 : 70;

  // Boost for high resolution
  const highRes = images.filter(img => (img.width || 0) >= 1000 && (img.height || 0) >= 1000).length;
  base += highRes * 5;

  // Penalize for low resolution
  const lowRes = images.filter(img => (img.width || 0) < 400 || (img.height || 0) < 400).length;
  base -= lowRes * 10;

  // Check dimension variety (portrait vs square vs landscape) as proxy for angle variety
  const shapes = new Set(images.map(img => {
    if (!img.width || !img.height) return 'unknown';
    const ratio = img.width / img.height;
    if (ratio > 1.2) return 'landscape';
    if (ratio < 0.8) return 'portrait';
    return 'square';
  }));
  const hasVariety = shapes.size > 1;

  const overall = Math.max(0, Math.min(100, base));
  const lighting = Math.max(0, Math.min(100, base + 5));
  const background = Math.max(0, Math.min(100, base - 5));
  const composition = Math.max(0, Math.min(100, base));

  return {
    overall,
    lighting,
    background,
    composition,
    hasLifestyle: false,
    hasScale: false,
    hasDetail: count >= 4,
    hasInUse: false,
    hasMultiAngle: hasVariety,
    issues: count < 3 ? ['too_few_images'] : [],
    recommendations: count < 3
      ? ['Add at least 3 product images showing front, back, and lifestyle use']
      : ['Consider adding lifestyle shots to show product in context'],
    isFallback: true,
  };
}

/**
 * Analyze product images using Claude Vision.
 * Falls back gracefully if API key is not set or request fails.
 *
 * @param {Array} images - array of { url, width, height } objects
 * @param {string} productTitle
 * @param {string} productType
 */
export async function analyzeImages(images, productTitle, productType) {
  const client = getClient();

  if (!client || images.length === 0) {
    return fallbackScores(images);
  }

  // Take up to 5 images
  const targetImages = images.slice(0, 5);

  try {
    // Fetch images as base64
    const imageContents = await Promise.all(
      targetImages.map(async img => {
        try {
          const { base64, mediaType } = await fetchImageAsBase64(img.url);
          return {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          };
        } catch (err) {
          console.warn(`Skipping image (fetch failed): ${img.url} — ${err.message}`);
          return null;
        }
      })
    );

    const validImages = imageContents.filter(Boolean);
    if (validImages.length === 0) return fallbackScores(images);

    const prompt = `You are a product photography analyst for e-commerce. Analyze these product images for "${productTitle}" (category: ${productType || 'General'}).

Score the images and return ONLY valid JSON with no additional text or markdown:
{
  "lighting_score": <0-100>,
  "background_score": <0-100>,
  "composition_score": <0-100>,
  "image_types": ["lifestyle","plain_white","detail_closeup","in_use","scale_reference","multi_angle"],
  "issues": ["low_resolution","poor_lighting","cluttered_background","no_context","single_angle"],
  "recommendations": ["Specific actionable recommendation 1", "Specific actionable recommendation 2"]
}

Scoring guide:
- lighting_score: 90+ = professional studio, 70+ = good natural light, 50+ = acceptable, below 50 = dark/harsh shadows
- background_score: 90+ = clean white/neutral, 70+ = minimal distraction, 50+ = some clutter, below 50 = distracting
- composition_score: 90+ = centered, well-framed, multiple angles, 70+ = good framing, below 50 = poor angles or cropping

image_types: list ONLY types present in these images.
issues: list ONLY issues actually present.
recommendations: 2-3 specific, actionable improvements.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            ...validImages,
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const text = response.content[0]?.text || '';

    // Extract JSON — handle cases where Claude wraps in markdown
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');

    const parsed = JSON.parse(jsonMatch[0]);

    const imageTypes = parsed.image_types || [];
    const lighting = Math.max(0, Math.min(100, parsed.lighting_score || 50));
    const background = Math.max(0, Math.min(100, parsed.background_score || 50));
    const composition = Math.max(0, Math.min(100, parsed.composition_score || 50));
    const overall = Math.round((lighting + background + composition) / 3);

    return {
      overall,
      lighting,
      background,
      composition,
      hasLifestyle: imageTypes.includes('lifestyle'),
      hasScale: imageTypes.includes('scale_reference'),
      hasDetail: imageTypes.includes('detail_closeup'),
      hasInUse: imageTypes.includes('in_use'),
      hasMultiAngle: imageTypes.includes('multi_angle'),
      issues: parsed.issues || [],
      recommendations: parsed.recommendations || [],
      isFallback: false,
    };
  } catch (err) {
    console.error('AI image analysis failed, using fallback:', err.message);
    return fallbackScores(images);
  }
}
