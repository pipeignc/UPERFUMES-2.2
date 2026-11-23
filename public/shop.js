(function () {
  'use strict';
  const money = n => '$' + n.toLocaleString('es-CL');
  const node = (tag, text, className) => { const n = document.createElement(tag); n.textContent = text; if (className) n.className=className; return n; };
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\bjpg\b/g,'jean paul gaultier');
  async function init() {
    let data;
    try { const response=await fetch('/api/catalog'); if(!response.ok) throw Error(); data=await response.json(); }
    catch {
      const status = document.getElementById('packList') || document.getElementById('shopCount');
      if (status) status.textContent = 'No pudimos cargar el catálogo. Recarga la página para volver a intentar.';
      return;
    }
    const grid=document.getElementById('perfumeGrid');
    if(grid) {
      const controls = document.getElementById('catalogSearch');
      const fields = controls.elements;
      const toggle = document.getElementById('toggleFilters');
      const panel = document.getElementById('catalogFilters');
      toggle.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
      });
      function filter() {
        const terms=normalize(document.getElementById('shopSearch').value).split(/\s+/).filter(Boolean);
        const occasion=fields.occasion.value;
        const profile=fields.profile.value;
        const budget=Number(fields.budget.value) || Infinity;
        const stock=fields.stock.checked;
        const family=fields.family.value;
        let count=0;
        grid.querySelectorAll('.perfume-card[data-perfume]').forEach(card=>{
          const p=data.products[card.dataset.perfume]; if(!p) return;
          const visible=terms.every(t=>normalize(p.house+' '+p.name+' '+p.badge).includes(t)) && (!occasion||p.occasions.includes(occasion)) && (!profile||p.profiles.includes(profile)) && (!stock||p.available) && p.formats.some(f=>f.price<=budget && (!stock||f.available)) && (!family||p.family===family);
          card.hidden=!visible; card.classList.toggle('is-filtered-out',!visible); if(visible) count++;
        });
        document.getElementById('shopCount').textContent=count+' fragancias · '+(count?'elige un tamaño para comprar':'prueba otros filtros');
      }
      grid.querySelectorAll('.perfume-card[data-perfume]').forEach(card=>{
        const p=data.products[card.dataset.perfume]; if(!p) return;
        const price=Math.min(...p.formats.map(f=>f.price));
        card.prepend(node('p','Desde '+money(price)+' · 3 ml · '+(p.available?'Disponible':'Agotado'),'shop-from'));
        card.querySelectorAll('.decant-buy').forEach(button=>{
          const format=p.formats.find(f=>f.ml===Number(button.dataset.ml));
          button.disabled=!format?.available;
          button.querySelector('.decant-price').textContent=format?.available?money(format.price):'Agotado';
        });
      });
      const showResults = () => document.getElementById('coleccion').scrollIntoView({block:'start'});
      controls.addEventListener('submit', e => { e.preventDefault(); panel.hidden = true; toggle.setAttribute('aria-expanded','false'); showResults(); });
      controls.addEventListener('input', () => { filter(); showResults(); });
      fields.query.value = new URLSearchParams(location.search).get('query') || '';
      controls.addEventListener('reset', () => setTimeout(filter, 0));
      filter();
    }
    const cards = document.getElementById('packList');
    if (cards) {
      cards.replaceChildren();
      (data.packs||[]).forEach(pack=>{
        const card=node('article','','shop-pack'); card.append(node('h3',pack.name));
        const photo = document.createElement('img');
        photo.className = 'pack-photo';
        photo.src = '/images/' + pack.id + '.png';
        photo.alt = pack.items.slice(0, 2).map(item => item.name).join(' y ');
        photo.width = 1536;
        photo.height = 1024;
        card.prepend(photo);
        const list=node('ul','');
        pack.items.forEach(item=>{const li=node('li','');const a=node('a',item.name+' · 3 ml'); a.href='/producto.html?id='+item.perfumeId;li.append(a);list.append(li);});card.append(list);
        const price=node('p',''); price.append(node('del',money(pack.originalPrice)),node('strong',' '+money(pack.price)+' CLP'));card.append(price,node('p','Ahorras '+money(pack.originalPrice-pack.price)+'. Despacho calculado al pagar.'));
        const button=node('button',pack.available?'Agregar pack al carrito':'Pack agotado','cart-btn cart-btn--primary');button.type='button';button.disabled=!pack.available;
        button.addEventListener('click',()=>{ if(window.UPCart.add(pack.id,3,1))window.UPCart.open(); });card.append(button);cards.append(card);
      });
    }
    const productId=new URLSearchParams(location.search).get('id');
    const p=data.products[productId];
    if(p && document.getElementById('productInfo')) {
      const details=node('section','','shop-details');
      details.append(node('h2','¿Es para ti?'),node('p',p.summary),node('p','Intensidad: '+p.intensity+'. Depende de la piel y de cuántas veces apliques.'),node('p','Ideal para: '+p.occasions.join(', ')+'.'));
      const media=node('figure','');
      if(p.decantImage) {const image=document.createElement('img');image.src=p.decantImage;image.alt='Decant de '+p.name+' que se entrega';media.append(image,node('figcaption','Presentación del decant. Elige los mililitros arriba.'));}
      else media.append(node('figcaption','La imagen principal muestra el frasco de referencia. Recibes un decant del tamaño seleccionado; la foto de la muestra aún no está disponible.'));
      details.append(media);document.getElementById('productInfo').append(details);
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
