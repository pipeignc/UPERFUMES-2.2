const router = require('express').Router();
const { listCatalog } = require('../data/catalog');
const { normalize, search } = require('../services/shop');
const { chat } = require('../services/advisorChat');
const money = n => '$' + n.toLocaleString('es-CL');
const occasionMap = {
  'Diario/Casual': 'diario', 'Oficina/Trabajo': 'oficina', 'Formal/Noche': 'formal',
  'Fiesta/Salida nocturna': 'noche', 'Deportivo/Ejercicio': 'diario',
  'Cita romántica': 'cita', 'Evento especial/Boda': 'formal'
};
function options(product, budget) {
  return product.formats.filter(f => f.available && f.price <= budget).map(f => ({...f, href:`/producto.html?id=${product.id}&ml=${f.ml}`}));
}
function result(product, budget, reason) {
  const formats = options(product, budget);
  const first = formats[0];
  return { id:product.id, name:product.house + ' ' + (product.name.endsWith(product.badge) ? product.name : product.name + ' ' + product.badge), formats,
    price:first.price, ml:first.ml, price_formatted:money(first.price), remaining_clp:budget-first.price,
    href:first.href, reason, available:true };
}
router.post('/compare', (req, res) => {
  const { budget_clp:budget, query = '', family = '', occasion = '' } = req.body;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 100000000 || ![query, family, occasion].every(value => typeof value === 'string' && value.length <= 120)) return res.status(400).json({detail:'Introduce un presupuesto válido y una búsqueda de hasta 120 caracteres.'});
  const products = search(Object.values(listCatalog()), {query, family, occasion, budget, stock:true});
  const items = products.map(p => result(p,budget,p.summary)).sort((a,b) => a.price-b.price || a.name.localeCompare(b.name));
  res.json({items, total_matches:items.length, currency:'CLP'});
});
router.post('/recommendations', async (req, res) => {
  const { budget_clp:budget, age, climate, occasion, gender } = req.body;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 100000000 || !Number.isInteger(age) || age<1 || age>120 || ![climate,occasion,gender].every(x=>typeof x==='string' && x.length<60)) return res.status(400).json({detail:'Revisa el perfil y el presupuesto.'});
  const products = Object.values(listCatalog()).filter(p=>p.available && options(p,budget).length);
  try {
    const response = await fetch(new URL('/api/recommendations',process.env.PERFUME_SERVICE_URL || 'http://127.0.0.1:8000'), {
      method:'POST', headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(5000),
      body:JSON.stringify({age,climate,occasion,gender,budget_clp:budget,rate:'950',top_n:null})
    });
    if (response.ok) {
      const predicted = (await response.json()).items;
      const items = predicted.map(item => {
        const product = products.find(p => {
          const label = p.name.endsWith(p.badge) ? p.name : p.name + ' ' + p.badge;
          return [label, p.house + ' ' + label].some(name => normalize(name) === normalize(item.name));
        });
        const card = product ? result(product, budget, product.summary) : { formats: [], available: false };
        return { ...card, name: item.name, modelPrice: item.price_clp, withinBudget: item.within_budget };
      });
      return res.json({ items, mode: 'model', notice: 'Fragancias ordenadas por afinidad con tu perfil.' });
    }
  } catch { /* El catálogo permite seguir eligiendo cuando el modelo está detenido. */ }
  const mappedOccasion = occasionMap[occasion] || (/oficina|trabajo/i.test(occasion)?'oficina': /noche|fiesta/i.test(occasion)?'noche': /cita/i.test(occasion)?'cita': /formal/i.test(occasion)?'formal':'diario');
  const mappedClimate = /fr[ií]o/i.test(climate)?'frio':/cal/i.test(climate)?'calido':'templado';
  const ranked = products.map(p => {
    const suitable = p.occasions.includes(mappedOccasion);
    return {p, score:(suitable?20:0)+(p.climates.includes(mappedClimate)?10:0),
      reason:'Alternativa del catálogo según tu perfil. '+(suitable?'Adecuado para '+mappedOccasion+'. ':'')+p.summary};
  }).sort((a,b)=>b.score-a.score || a.p.id.localeCompare(b.p.id));
  res.json({items:ranked.slice(0,3).map(({p,reason})=>result(p,budget,reason)), mode:'catalog', notice:'El modelo está desconectado. Estas alternativas proceden del catálogo.'});
});
router.post('/chat', (req,res) => {
  const message=req.body.message;
  if(typeof message!=='string' || !message.trim() || message.length>1000) return res.status(400).json({detail:'Escribe una consulta de hasta 1000 caracteres.'});
  res.json(chat(message, req.body.history, result, req.body.language));
});
module.exports=router;
