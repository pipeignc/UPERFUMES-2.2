const db = require('../db');
const { CATALOG } = require('../data/catalog');

const seed = db.prepare('INSERT OR IGNORE INTO inventory.perfumes (id, ml) VALUES (?, 100)');
db.transaction(() => Object.keys(CATALOG).forEach(id => seed.run(id)))();

const balance = db.prepare('SELECT ml FROM inventory.perfumes WHERE id = ?');
const debit = db.prepare('UPDATE inventory.perfumes SET ml = ml - ? WHERE id = ? AND ml >= ?');
const record = db.prepare('INSERT INTO inventory.allocations (buy_order, perfume_id, ml) VALUES (?, ?, ?)');
const allocations = db.prepare('SELECT perfume_id, ml FROM inventory.allocations WHERE buy_order = ?');
const credit = db.prepare('UPDATE inventory.perfumes SET ml = ml + ? WHERE id = ?');
const clear = db.prepare('DELETE FROM inventory.allocations WHERE buy_order = ?');

function availableMl(id) {
  return balance.get(id)?.ml ?? 0;
}

function insufficient(id) {
  const error = new Error('Stock insuficiente para ' + CATALOG[id].name + '. Revisa los tamaños y cantidades.');
  error.code = 'INSUFFICIENT_STOCK';
  return error;
}

// Called inside the order transaction, after combining all sizes and pack components.
function reserve(buyOrder, amounts) {
  for (const [id, ml] of amounts) {
    if (!debit.run(ml, id, ml).changes) throw insufficient(id);
    record.run(buyOrder, id, ml);
  }
}

function release(buyOrder) {
  for (const row of allocations.all(buyOrder)) credit.run(row.ml, row.perfume_id);
  clear.run(buyOrder);
}

module.exports = { availableMl, insufficient, reserve, release };
