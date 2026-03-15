import { shopify } from '../shopifyAuth.js';

/**
 * Extract numeric ID from a Shopify GID string.
 * "gid://shopify/Product/1234567890" → "1234567890"
 */
export function extractId(gid = '') {
  if (!gid) return '';
  const parts = String(gid).split('/');
  return parts[parts.length - 1];
}

/**
 * Build a GraphQL client for a given session.
 */
function getClient(session) {
  return new shopify.clients.Graphql({ session });
}

/**
 * Fetch all products (up to 50) with images and variants.
 */
export async function fetchAllProducts(session) {
  const client = getClient(session);

  const query = `{
    products(first: 50) {
      edges {
        node {
          id
          title
          productType
          totalInventory
          images(first: 10) {
            edges {
              node {
                url
                width
                height
                altText
              }
            }
          }
          variants(first: 1) {
            edges {
              node {
                price
              }
            }
          }
        }
      }
    }
  }`;

  const response = await client.request(query);
  const edges = response?.data?.products?.edges || [];

  return edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    productType: node.productType || 'Uncategorized',
    totalInventory: node.totalInventory || 0,
    price: parseFloat(node.variants?.edges?.[0]?.node?.price || '0'),
    images: (node.images?.edges || []).map(e => ({
      url: e.node.url,
      width: e.node.width,
      height: e.node.height,
      altText: e.node.altText || '',
    })),
  }));
}

/**
 * Fetch analytics for all products using ShopifyQL.
 * Returns array of { productId, title, productType, sessions, productViews, addedToCart, orders }
 */
export async function fetchProductAnalytics(session) {
  const client = getClient(session);

  const query = `{
    shopifyqlQuery(query: "FROM products SHOW product_id, product_title, product_type, sessions, product_views, added_to_carts, orders, conversion_rate SINCE -30d ORDER BY product_views DESC LIMIT 50") {
      __typename
      ... on TableResponse {
        tableData {
          rowData
          columns {
            name
            dataType
          }
        }
      }
      ... on ParseErrorResponse {
        parseErrors {
          code
          message
          range {
            start { line character }
            end { line character }
          }
        }
      }
    }
  }`;

  try {
    const response = await client.request(query);
    const result = response?.data?.shopifyqlQuery;

    if (!result || result.__typename !== 'TableResponse') {
      console.warn('ShopifyQL returned no TableResponse. Analytics will be empty.');
      if (result?.__typename === 'ParseErrorResponse') {
        console.warn('ShopifyQL parse errors:', JSON.stringify(result.parseErrors));
      }
      return [];
    }

    const { columns, rowData } = result.tableData;
    const colNames = columns.map(c => c.name);

    return rowData.map(row => {
      const obj = {};
      colNames.forEach((name, i) => { obj[name] = row[i]; });
      return {
        productId: String(obj.product_id || ''),
        title: obj.product_title || '',
        productType: obj.product_type || 'Uncategorized',
        sessions: parseInt(obj.sessions || 0, 10),
        productViews: parseInt(obj.product_views || 0, 10),
        addedToCart: parseInt(obj.added_to_carts || 0, 10),
        orders: parseInt(obj.orders || 0, 10),
        conversionRate: parseFloat(obj.conversion_rate || 0),
      };
    });
  } catch (err) {
    console.error('fetchProductAnalytics error:', err.message);
    return [];
  }
}

/**
 * Fetch a single product by numeric ID or GID.
 */
export async function fetchSingleProduct(session, productId) {
  const client = getClient(session);
  const gid = productId.startsWith('gid://') ? productId : `gid://shopify/Product/${productId}`;

  const query = `{
    product(id: "${gid}") {
      id
      title
      descriptionHtml
      productType
      totalInventory
      images(first: 10) {
        edges {
          node {
            url
            width
            height
            altText
          }
        }
      }
      variants(first: 5) {
        edges {
          node {
            price
            title
            sku
          }
        }
      }
    }
  }`;

  const response = await client.request(query);
  const node = response?.data?.product;
  if (!node) throw new Error(`Product not found: ${gid}`);

  return {
    id: node.id,
    title: node.title,
    descriptionHtml: node.descriptionHtml || '',
    productType: node.productType || 'Uncategorized',
    totalInventory: node.totalInventory || 0,
    price: parseFloat(node.variants?.edges?.[0]?.node?.price || '0'),
    images: (node.images?.edges || []).map(e => ({
      url: e.node.url,
      width: e.node.width,
      height: e.node.height,
      altText: e.node.altText || '',
    })),
    variants: (node.variants?.edges || []).map(e => ({
      price: parseFloat(e.node.price || '0'),
      title: e.node.title,
      sku: e.node.sku || '',
    })),
  };
}

/**
 * Fetch return-related data for a specific product.
 * Scans orders in the last 90 days for misleading-photo signals.
 */
export async function fetchProductReturns(session, productGid) {
  const client = getClient(session);

  // Query orders that contain this product, look at refunds + notes
  const query = `{
    orders(first: 50, query: "created_at:>-90d") {
      edges {
        node {
          id
          note
          lineItems(first: 20) {
            edges {
              node {
                product {
                  id
                }
                quantity
              }
            }
          }
          refunds(first: 5) {
            refundLineItems(first: 10) {
              edges {
                node {
                  restockType
                  lineItem {
                    product {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

  try {
    const response = await client.request(query);
    const orders = response?.data?.orders?.edges || [];

    // Filter orders that contain this product
    const productNumericId = extractId(productGid);
    const productOrders = orders.filter(({ node: order }) =>
      order.lineItems.edges.some(({ node: li }) =>
        li.product && extractId(li.product.id) === productNumericId
      )
    );

    let totalOrders = productOrders.length;
    let totalReturns = 0;
    let notAsDescribed = 0;

    const misleadingPhrases = [
      'looks different', 'not like photo', 'color is off',
      'smaller than expected', 'not as shown', 'different color',
      'not what i expected', 'wrong color', 'looks nothing like',
    ];

    for (const { node: order } of productOrders) {
      const noteText = (order.note || '').toLowerCase();

      // Count refunds for this product
      for (const refund of (order.refunds || [])) {
        const hasProductRefund = refund.refundLineItems.edges.some(({ node: rli }) =>
          rli.lineItem?.product && extractId(rli.lineItem.product.id) === productNumericId
        );
        if (hasProductRefund) {
          totalReturns++;
          if (misleadingPhrases.some(phrase => noteText.includes(phrase))) {
            notAsDescribed++;
          }
        }
      }
    }

    return { totalOrders, totalReturns, notAsDescribed };
  } catch (err) {
    console.error('fetchProductReturns error:', err.message);
    return { totalOrders: 0, totalReturns: 0, notAsDescribed: 0 };
  }
}
