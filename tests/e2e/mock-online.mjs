// Starts the stand-in for Open Food Facts / USDA on a fixed port, for
// browser tests on a machine with no internet access.
//   node tests/e2e/mock-online.mjs 4010
import http from 'node:http';
import { OFF_PRODUCTS, USDA_FOODS } from '../helpers.js';

const port = Number(process.argv[2] || 4010);
const state = { down: false, slowMs: 0 };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // Test controls: /__state?down=1&slowMs=0
    if (url.pathname === '/__state') {
      if (url.searchParams.has('down')) state.down = url.searchParams.get('down') === '1';
      if (url.searchParams.has('slowMs')) state.slowMs = Number(url.searchParams.get('slowMs'));
      return send(200, state);
    }
    if (state.slowMs) await new Promise((resolve) => setTimeout(resolve, state.slowMs));
    if (state.down) return send(500, { error: 'down' });

    const product = /^\/api\/v2\/product\/(\d+)\.json$/.exec(url.pathname);
    if (product) {
      const p = OFF_PRODUCTS[product[1]];
      return p ? send(200, { status: 1, product: p }) : send(404, { status: 0 });
    }
    if (url.pathname === '/cgi/search.pl') {
      const term = (url.searchParams.get('search_terms') || '').toLowerCase();
      const country = url.searchParams.get('tag_0');
      const products = Object.values(OFF_PRODUCTS).filter(
        (p) => `${p.product_name} ${p.brands}`.toLowerCase().includes(term) && (country ? p.countries_tags.includes(`en:${country}`) : true),
      );
      return send(200, { count: products.length, products });
    }
    if (url.pathname === '/fdc/v1/foods/search') {
      const term = (url.searchParams.get('query') || '').toLowerCase();
      return send(200, { foods: USDA_FOODS.filter((f) => f.description.toLowerCase().includes(term)) });
    }
    return send(404, { error: 'unknown path' });
  })
  .listen(port, '127.0.0.1', () => console.log(`mock online food databases on http://127.0.0.1:${port}`));
