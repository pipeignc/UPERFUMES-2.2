const express = require('express');
const path = require('node:path');
const { CATALOG } = require('../data/catalog');
const inventory = require('../services/inventory');

const router = express.Router();
const threshold = Number(process.env.LOW_STOCK_THRESHOLD_ML || '20');
if (!Number.isSafeInteger(threshold) || threshold < 1) {
  throw new Error('LOW_STOCK_THRESHOLD_ML debe ser un entero positivo.');
}

router.use(require('../middleware/adminAuth'));
router.get('/admin-stock', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/admin-stock.html'));
});
router.get('/api/admin-stock', (req, res) => {
  const products = Object.entries(CATALOG).map(([id, product]) => {
    const stockMl = inventory.availableMl(id);
    return { id, house: product.house, name: product.name, badge: product.badge, stockMl,
      status: stockMl < Math.min(...Object.keys(product.prices).map(Number)) ? 'agotado' : stockMl <= threshold ? 'bajo' : 'disponible' };
  }).sort((a, b) => a.stockMl - b.stockMl || a.name.localeCompare(b.name));
  res.json({ thresholdMl: threshold, products });
});

module.exports = router;
