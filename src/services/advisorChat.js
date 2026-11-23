const { listCatalog } = require('../data/catalog');
const { normalize, search } = require('./shop');

const occasions = [
  [/oficina|trabajo/, 'oficina'], [/noche|fiesta|discoteca/, 'noche'],
  [/cita|romantic/, 'cita'], [/formal|evento|boda/, 'formal'],
  [/universidad|diario|clases|dia a dia/, 'diario']
];
const profiles = [[/fresc|limpio/, 'fresco'], [/dulce|vainilla/, 'dulce'], [/madera/, 'amaderado']];
const families = [
  [/citric/, 'citrico'], [/aromatic/, 'aromatico'], [/amaderad/, 'amaderado'],
  [/floral/, 'floral'], [/oriental/, 'oriental'], [/gourmand/, 'gourmand']
];
const climates = [[/verano|calor|calido/, 'calido'], [/invierno|frio/, 'frio'], [/templado/, 'templado']];

function mentionedProducts(text, catalog) {
  const words = text.split(' ');
  const scored = catalog.map(p => {
    const name = normalize(p.name).split(' ');
    const matches = name.filter(word => word.length >= 4 && words.includes(word));
    const house = text.includes(normalize(p.house));
    return { p, score: matches.length * 2 + Number(house) };
  });
  const best = Math.max(0, ...scored.map(entry => entry.score));
  return scored.filter(entry => best && entry.score === best).map(entry => entry.p);
}

function criteria(message, catalog) {
  const text = normalize(message);
  const amount = message.match(/(?:\$\s*|(?:menos de|hasta|presupuesto(?: de)?|por|tengo)\s*)(\d[\d.]*)(?:\s*(mil|k))?|(\d[\d.]*)\s*(mil|k|pesos|clp)\b/i);
  const budget = amount && Number((amount[1] || amount[3]).replace(/\./g, '')) * (/mil|k/i.test(amount[2] || amount[4] || '') ? 1000 : 1);
  return {
    named: mentionedProducts(text, catalog), budget,
    occasion: occasions.find(([pattern]) => pattern.test(text))?.[1],
    profile: profiles.find(([pattern]) => pattern.test(text))?.[1],
    climate: climates.find(([pattern]) => pattern.test(text))?.[1],
    family: families.find(([pattern]) => pattern.test(text))?.[1]
  };
}

function chat(message, history, result) {
  const text = normalize(message);
  const reply = (answer, items = [], matched = true) => ({ answer, items, matched, sources: ['Catálogo de UPERFUMES'] });
  if (/despacho|envio/.test(text)) return reply('El despacho se calcula por región en el carrito. Selecciona tu región para ver el costo antes de pagar.');
  if (/webpay|transferencia|\bpago\b|\bpagar\b/.test(text)) return reply('Puedes pagar con Webpay o transferencia. En el carrito verás el total con despacho antes de confirmar.');
  if (/como funciona|como elegir/.test(text)) return reply('En el recomendador, indica tu ocasión, clima y presupuesto. Si prefieres conversar, dime qué notas te gustan o qué perfume quieres conocer.');

  const catalog = Object.values(listCatalog());
  const current = criteria(message, catalog);
  const recent = Array.isArray(history) ? history.slice(-8) : [];
  const followup = /^(y\b|ese\b|esa\b|otra\b|otro\b|cuanto cuesta|que notas|que tamanos|en \d+ ml)/.test(text);
  const alternativeRequested = /\botr[oa]s?\b/.test(text);
  let named = current.named;
  if (followup && !named.length) {
    const lastUser = recent.findLast(h => h?.role === 'user' && typeof h.content === 'string');
    const prior = criteria(lastUser?.content.slice(0,1000) || '', catalog);
    current.budget ??= prior.budget;
    current.occasion ??= prior.occasion;
    current.profile ??= prior.profile;
    current.family ??= prior.family;
    current.climate ??= prior.climate;
    named = prior.named;
    if (!named.length) {
      const lastAnswer = recent.findLast(h => h?.role === 'assistant' && typeof h.content === 'string');
      named = mentionedProducts(normalize(lastAnswer?.content.slice(0,1000)), catalog);
    }
  }
  const reference = named[0];
  const shopping = reference || current.budget != null || current.occasion || current.profile || current.family || current.climate;
  if (!shopping) return reply('¿Qué perfume tienes en mente? También puedo buscar por familia olfativa, ocasión o presupuesto en pesos chilenos.', [], false);

  const budget = current.budget ?? 100000000;
  const filters = { ...current, budget, stock: true };
  let products = search(named.length ? named : catalog, filters);
  const alternative = reference && (!products.length || alternativeRequested);
  if (alternative) {
    products = search(catalog.filter(p => !named.includes(p)), filters)
      .filter(p => named.some(n => n.family === p.family || n.profiles.some(tag => p.profiles.includes(tag))));
  }
  if (current.climate) products = products.filter(p => p.climates.includes(current.climate));
  const size = text.match(/\b(\d+)\s*ml\b/);
  if (size) products = products.filter(p => p.formats.some(f => f.ml === Number(size[1]) && f.available && f.price <= budget));
  products.sort((a,b) => Math.min(...a.formats.filter(f=>f.available).map(f=>f.price)) - Math.min(...b.formats.filter(f=>f.available).map(f=>f.price)) || a.name.localeCompare(b.name));
  const items = products.slice(0,3).map(p => result(p,budget,p.summary));
  if (!items.length) return reply('No encontré un decant disponible con esa combinación. ¿Quieres cambiar el tamaño, la ocasión o el presupuesto?');
  const first = products[0];
  let answer = first.house + ' ' + first.name + ' · ' + first.i18n.es.family + '. ' + first.summary;
  if (/notas|huele|aroma/.test(text)) {
    const notes = first.i18n.es.notes;
    answer = first.name + ' abre con ' + notes.top + '. En el corazón lleva ' + notes.heart + ' y en el fondo, ' + notes.base + '.';
  } else if (/precio|cuesta|vale|tamanos|formatos|\bml\b/.test(text)) {
    const prices = items[0].formats.filter(f => !size || f.ml === Number(size[1]));
    answer = first.name + ' está disponible en ' + prices.map(f=>f.ml+' ml por $'+f.price.toLocaleString('es-CL')).join(', ') + '.';
  }
  if (alternative) answer = 'Entre las alternativas de perfil similar, te sugiero ' + first.name + '. ' + first.summary;
  else if (reference && /\bedp\b/.test(text) && named.every(p=>p.badge==='EDT')) answer = 'La versión EDP no figura en el catálogo. Una alternativa disponible es '+items[0].name+'.';
  return reply(answer, items);
}

module.exports = { chat };
