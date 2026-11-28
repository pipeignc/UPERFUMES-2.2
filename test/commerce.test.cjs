const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {once} = require('node:events');
const {JSDOM,VirtualConsole,requestInterceptor} = require('jsdom');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'uperfumes-commerce-'));
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/data/commerce.json'),'utf8'));
process.env.DATABASE_PATH=path.join(temp,'orders.sqlite');
process.env.COMMERCE_CONFIG_PATH=path.join(temp,'commerce.json');
process.env.PERFUME_SERVICE_URL='http://127.0.0.1:1';
process.env.PUBLIC_BASE_URL='http://localhost';
fs.writeFileSync(process.env.COMMERCE_CONFIG_PATH,JSON.stringify(config));
let server,base;
before(async()=>{server=require('../src/app').listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;});
after(async()=>{await new Promise(r=>server.close(r));require('../src/db').close();fs.rmSync(temp,{recursive:true,force:true});});
async function post(route,body) {const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
const items=[{perfumeId:'pack-frescos',ml:3,qty:1}];
const order={items,region:'Metropolitana',quotedTotal:21776,customerName:'Cliente Test',customerEmail:'test@example.com',deliveryAddress:'Calle prueba 123',paymentMethod:'webpay'};
test('packs y despacho se calculan en servidor; Webpay recibe el total y se guarda el desglose',async()=>{
  const catalog=await (await fetch(base+'/api/catalog')).json();
  assert.deepEqual(catalog.packs.map(p=>p.price),[16776,14376]);
  for(const [region,shipping] of [['Metropolitana',5000],['Maule',10000],['Aysén',15000]]) {
    const result=await post('/api/quote',{items,region});assert.equal(result.status,200);assert.equal(result.body.total,16776+shipping);
  }
  let charged;
  require('../src/services/webpay').createTransaction=async args=>{charged=args.amount;return {token:'TEST_PACK',url:'https://example.com'};};
  const forged=await post('/api/orders',{...order,quotedTotal:1,amount:1,shipping:0});assert.equal(forged.status,409);assert.equal(charged,undefined);
  const created=await post('/api/orders',order);assert.equal(created.status,201);assert.equal(charged,21776);
  const saved=await (await fetch(base+'/api/orders/'+created.body.buyOrder)).json();
  assert.equal(saved.order.shippingAmount,5000);assert.equal(saved.order.subtotal,16776);assert.equal(saved.order.amount,21776);
  assert.match(saved.order.items[0].name,/Sauvage/);
  assert.equal((await post('/api/quote',{items,region:'No existe'})).status,400);
  assert.equal((await post('/api/quote',{items:[...items,{perfumeId:'pack-frescos',ml:3,qty:10}],region:'Metropolitana'})).status,400);
  fs.writeFileSync(process.env.COMMERCE_CONFIG_PATH,JSON.stringify({...config,shippingRegions:{...config.shippingRegions,Metropolitana:6000}}));
  try { assert.equal((await post('/api/orders',order)).status,409); }
  finally { fs.writeFileSync(process.env.COMMERCE_CONFIG_PATH,JSON.stringify(config)); }
});
test('comparador y chat toleran alias, presupuestos y concentraciones diferentes',async()=>{
  const compare=await post('/api/advisor/compare',{query:'JPG Elixir',budget_clp:15000});
  assert.equal(compare.body.items.length,1);assert.equal(compare.body.items[0].id,'jpg-le-male-elixir');
  assert.ok(compare.body.items[0].formats.every(f=>f.price<=15000));
  const chat=await post('/api/advisor/chat',{message:'Busco algo fresco para la universidad por menos de $15.000'});
  assert.ok(chat.body.items.length);assert.ok(chat.body.items.every(p=>p.formats.every(f=>f.price<=15000)));
  const concentration=await post('/api/advisor/chat',{message:'¿Cuánto cuesta Sauvage EDP?'});assert.match(concentration.body.answer,/alternativa/);
  const noBudget=await post('/api/advisor/compare',{query:'',budget_clp:1});assert.equal(noBudget.body.items.length,0);
  const fallback=await post('/api/advisor/recommendations',{age:25,climate:'Frío',occasion:'Oficina/Trabajo',gender:'Masculino',budget_clp:15000});
  assert.equal(fallback.body.mode,'catalog');assert.ok(fallback.body.items.length);assert.ok(fallback.body.items.every(p=>p.price<=15000));
});
test('agotados se excluyen de recomendaciones y packs y se rechazan al cobrar',async()=>{
  fs.writeFileSync(process.env.COMMERCE_CONFIG_PATH,JSON.stringify({...config,unavailableFormats:{'dior-sauvage-edt':[3,5,10]}}));
  try {
    const compare=await post('/api/advisor/compare',{query:'Sauvage',budget_clp:20000});assert.equal(compare.body.items.length,0);
    const alternatives=await post('/api/advisor/chat',{message:'Busco Sauvage por menos de $15.000'});
    assert.ok(alternatives.body.items.length);assert.ok(alternatives.body.items.every(p=>p.id!=='dior-sauvage-edt'));assert.match(alternatives.body.answer,/alternativas/);
    assert.equal((await post('/api/orders',order)).status,400);
    assert.equal((await post('/api/quote',{items:[{perfumeId:'dior-sauvage-edt',ml:3,qty:1}],region:'Metropolitana'})).status,400);
    const catalog=await (await fetch(base+'/api/catalog')).json();assert.equal(catalog.packs[0].available,false);
  } finally {fs.writeFileSync(process.env.COMMERCE_CONFIG_PATH,JSON.stringify(config));}
});
async function until(fn) {for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('UI timeout');}
test('catálogo filtra sin duplicar tarjetas y agrega el pack completo al carrito',async()=>{
  const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  const openPage = page => JSDOM.fromURL(base+page,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
    resources:{interceptors:[requestInterceptor(r=>{if(!r.url.startsWith(base))return new Response('',{headers:{'Content-Type':'text/css'}});})]},
    beforeParse(w){w.matchMedia=()=>({matches:true});w.fetch=(url,opts)=>fetch(new URL(url,base),opts);w.Element.prototype.scrollIntoView=function(){};}});
  const dom = await openPage('/');
  try {
    const doc=dom.window.document;
    await until(()=>doc.querySelectorAll('.shop-from').length === 12);
    doc.querySelector('#toggleFilters').click();
    assert.equal(doc.querySelector('#catalogFilters').hidden,false);
    const form=doc.querySelector('#catalogSearch');
    form.elements.family.value='citrico';
    form.elements.occasion.value='diario';
    form.elements.family.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    assert.equal(doc.querySelectorAll('#perfumeGrid article:not([hidden])').length,2);
    form.reset();
    await until(()=>doc.querySelectorAll('#perfumeGrid article:not([hidden])').length===12);
    const search=doc.querySelector('#shopSearch');search.value='JPG Elixir';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    const visible=[...doc.querySelectorAll('#perfumeGrid .perfume-card[data-perfume]')].filter(e=>!e.hidden);assert.equal(visible.length,1);assert.equal(visible[0].dataset.perfume,'jpg-le-male-elixir');
    assert.ok(doc.querySelector('a[href="/packs.html"]'));
  } finally { dom.window.close(); }
  const packs = await openPage('/packs.html');
  try {
    const doc = packs.window.document;
    await until(()=>doc.querySelectorAll('.shop-pack button').length===2);
    doc.querySelector('[data-lang="en"]').click();
    assert.equal(doc.querySelector('.shop-pack h3').textContent, 'Fresh everyday scents');
    doc.querySelector('[data-lang="pt"]').click();
    assert.equal(doc.querySelector('.shop-pack button').textContent, 'Adicionar pack ao carrinho');
    doc.querySelector('.shop-pack button').click();assert.deepEqual(JSON.parse(JSON.stringify(packs.window.UPCart.items())),[{id:'pack-frescos',ml:3,qty:1}]);
    await until(()=>doc.querySelector('#cartDrawer').textContent.includes('16.776'));const cards = doc.querySelectorAll('.shop-pack');
    assert.deepEqual(Array.from(cards, card => card.querySelector('img').getAttribute('src')),
      ['/images/pack-frescos.png','/images/pack-dulces.png']);
    cards[1].querySelector('button').click();
    assert.deepEqual(Array.from(packs.window.UPCart.items(), line => line.id), ['pack-frescos','pack-dulces']);
    assert.deepEqual(errors,[]);
  }finally{packs.window.close();}
  const product = await openPage('/producto.html?id=dior-sauvage-edt');
  try {
    const doc = product.window.document;
    await until(()=>doc.querySelector('.shop-details h2'));
    doc.querySelector('[data-lang="pt"]').click();
    assert.equal(doc.querySelector('.shop-details h2').textContent, 'É para ti?');
    assert.match(doc.querySelector('.shop-details').textContent, /Intensidade/);
    doc.querySelector('[data-lang="en"]').click();
    assert.match(doc.querySelector('.shop-details').textContent, /Best for: everyday wear/);
  } finally { product.window.close(); }
});

test('el asesor cambia de tema después de Sauvage y el comparador combina filtros', async () => {
  const history = [{role:'user',content:'¿Cuánto cuesta Sauvage?'}];
  const ask = message => post('/api/advisor/chat',{message,history});
  const liquid = (await ask('¿Qué notas tiene Liquid Brun?')).body;
  assert.deepEqual(liquid.items.map(p=>p.id), ['french-avenue-liquid-brun']);
  assert.match(liquid.answer,/Liquid Brun.*corazón/);
  assert.equal((await ask('¿Y el despacho?')).body.items.length,0);
  assert.match((await ask('¿Y en 5 ml?')).body.answer,/Sauvage.*5 ml/);
  const filters = {budget_clp:7000, family:'citrico', occasion:'diario'};
  assert.deepEqual((await post('/api/advisor/compare',filters)).body.items.map(p=>p.id), ['mykonos-inferno','mancera-cedrat-boise']);
  assert.match((await ask('¿Qué notas tiene Mykonos Inferno?')).body.answer,/Inferno.*toronja.*cardamomo.*vetiver/i);
  assert.equal((await post('/api/advisor/compare',{...filters,budget_clp:3000})).body.items.length,0);
});

test('inventario en ml: pack y decants comparten saldo, la cancelación lo devuelve una sola vez', async () => {
  const id = 'dior-sauvage-edt';
  const stock = async () => (await (await fetch(base + '/api/catalog')).json()).products[id].stockMl;
  const before = await stock();
  const cart = [...items, {perfumeId:id, ml:5, qty:2}];
  const quote = await post('/api/quote', {items:cart, region:order.region});
  require('../src/services/webpay').createTransaction = async () => ({token:'STOCK_TEST',url:'https://example.com'});
  const purchase = await post('/api/orders', {...order,items:cart,quotedTotal:quote.body.total});
  assert.equal(purchase.status,201);
  assert.equal(await stock(),before - 13);
  const tooLarge = await post('/api/quote', {items:[{perfumeId:id,ml:10,qty:8},{perfumeId:id,ml:5,qty:4}],region:order.region});
  assert.equal(tooLarge.status,400);
  assert.equal(await stock(),before - 13);
  for (let attempt=0; attempt<2; attempt++) {
    await fetch(base + '/webpay/retorno?TBK_TOKEN=STOCK_TEST&TBK_ORDEN_COMPRA=' + purchase.body.buyOrder,{redirect:'manual'});
    assert.equal(await stock(),before);
  }
});

test('el panel privado protege la página y entrega el inventario con credenciales', async(t)=>{
  process.env.ADMIN_USERNAME='seller';
  process.env.ADMIN_PASSWORD='long-test-password';
  for(const route of ['/admin-stock','/api/admin-stock']) assert.equal((await fetch(base+route)).status,404);
  const privateServer=require('express')().use(require('../src/routes/adminStock')).listen(0,'127.0.0.1');
  await once(privateServer,'listening');
  t.after(()=>new Promise(resolve=>privateServer.close(resolve)));
  const local='http://127.0.0.1:'+privateServer.address().port;
  assert.equal((await fetch(local+'/api/admin-stock')).status,401);
  const denied=await fetch(local+'/admin-stock');
  assert.equal(denied.status,401);
  const headers={Authorization:'Basic '+Buffer.from('seller:long-test-password').toString('base64')};
  const page=await fetch(local+'/admin-stock',{headers});
  assert.equal(page.status,200);
  assert.match(await page.text(),/Inventario de perfumes/);
  const api=await fetch(local+'/api/admin-stock',{headers});
  assert.equal(api.status,200);
  const data=await api.json();
  assert.equal(data.products.length,12);
  assert.ok(data.products.every(item=>Number.isInteger(item.stockMl)));
});
