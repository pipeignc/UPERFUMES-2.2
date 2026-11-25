(function () {
'use strict';

// La API del asesor devuelve formatos disponibles y precios del catálogo.
const base = new URL('/api/advisor/', document.baseURI);
const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value) + ' CLP';
const history = [];
const { shopText: t, localize } = window.UPerfumes;

async function api(path, data) {
  const response = await fetch(new URL(path, base), data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Revisa los campos: usa montos positivos y las opciones disponibles.');
  }
  return response.json();
}

function feedback(id, text, error = false) {
  localize($(id), typeof text === 'function' ? text : () => text);
  $(id).classList.toggle('error', error);
}

function element(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

function showPanel() {
  const selected = ['recommend', 'compare', 'chat'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'recommend';
  document.querySelectorAll('[data-panel]').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.panel === selected)));
  document.querySelectorAll('.advisor-main .panel').forEach(panel => { panel.hidden = panel.id !== selected; });
  document.querySelectorAll('a[href^="/asesor.html#"]').forEach(link => {
    if (link.hash === '#' + selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => {
  location.hash = button.dataset.panel;
}));
window.addEventListener('hashchange', showPanel);
showPanel();

$('recommend-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button[type=submit]');
  button.disabled = true;
  const more = $('more-recommendations');
  more.hidden = true;
  $('recommend-results').replaceChildren();
  try {
    const data = Object.fromEntries(new FormData(event.target));
    data.age = Number(data.age);
    data.budget_clp = Number(data.budget_clp);

    feedback('recommend-message', () => t('loading'));
    const result = await api('recommendations', data);
    let shown = 0;
    function showNext(count) {
      const next = result.items.slice(shown, shown + count);
      next.forEach(perfume => $('recommend-results').append(productCard(perfume)));
      shown += next.length;
      more.hidden = shown >= result.items.length;
      localize(more, () => t('more', shown, result.items.length));
    }
    more.onclick = () => showNext(12);
    showNext(3);
    feedback('recommend-message', () => t(result.items.length ? (result.mode === 'catalog' ? 'fallback' : 'rank') : 'none'));
  } catch (error) { feedback('recommend-message', error.message, true); }
  finally { button.disabled = false; }
});

$('compare-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button[type=submit]');
  button.disabled = true;
  $('compare-table').hidden = true;
  $('compare-results').replaceChildren();
  try {
    const data = Object.fromEntries(new FormData(event.target));
    data.budget_clp = Number(data.budget_clp);

    feedback('compare-message', () => t('comparing'));
    const result = await api('compare', data);
    const formats = result.items.flatMap(perfume =>
      perfume.formats.map(format => ({ ...format, name: perfume.name }))
    ).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, 'es'));
    for (const format of formats) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      const link = element('a', format.name + ' · ' + format.ml + ' ml');
      link.href = format.href;
      cell.append(link);
      row.append(cell, element('td', money(format.price)), element('td', money(data.budget_clp - format.price)));
      $('compare-results').append(row);
    }
    $('compare-table').hidden = formats.length === 0;
    feedback('compare-message', () => formats.length ? t('count', formats.length) : t('noMatch'));
  } catch (error) { feedback('compare-message', error.message, true); }
  finally { button.disabled = false; }
});

function bubble(role, text, sources = []) {
  const item = element('article', '', 'bubble ' + role);
  item.append(localize(element('strong', ''), () => t(role === 'user' ? 'you' : 'chatName')), element('p', text));
  if (sources.length) item.append(localize(element('small', ''), () => t('source') + ': ' + t('catalog')));
  $('chat-log').append(item);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}

$('chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('chat-message').value.trim();
  if (!message) return;
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {

    bubble('user', message);
    feedback('chat-feedback', () => t('looking'));
    const result = await api('chat', { message, language: window.UPerfumes.getLang(), history: history.slice(-8) });
    bubble('assistant', result.answer, result.sources);
    (result.items || []).forEach(p => $('chat-log').append(productCard(p)));
    history.push({ role: 'user', content: message }, { role: 'assistant', content: result.answer });
    history.splice(0, Math.max(0, history.length - 8));
    $('chat-message').value = '';
    feedback('chat-feedback', '');
  } catch (error) { feedback('chat-feedback', error.message, true); }
  finally { button.disabled = false; $('chat-message').focus(); }
});

document.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => {
  $('chat-message').value = t(button.dataset.question);
  $('chat-message').focus();
}));

function productCard(p) {
  const card = element('article', '', 'perfume-card');
  card.append(element('h3', p.name));
  if (p.modelPrice != null) card.append(localize(element('p', ''), () =>
    t(p.withinBudget ? 'within' : 'over', money(p.modelPrice))));
  if (p.reason) {
    const profile = window.UPerfumes.PERFUMES.find(item => item.id === p.id);
    card.append(localize(element('p', ''), () => profile && window.UPerfumes.getLang() !== 'es'
      ? window.UPerfumes.pf(profile).desc : p.reason));
  }
  card.append(localize(element('small', ''), () => t(p.available ? 'sizes' : 'noSize')));
  p.formats.forEach(f => { const a = element('a', f.ml + ' ml · ' + money(f.price), 'cart-btn cart-btn--ghost'); a.href = f.href; card.append(a); });
  return card;
}
async function initialize() {
  try {
    const options = {climates:[['Cálido/Tropical','hot'],['Templado','mild'],['Frío','cold'],['Húmedo','humid'],['Árido/Desértico','dry']],occasions:[['Diario/Casual','casual'],['Oficina/Trabajo','work'],['Formal/Noche','formalNight'],['Fiesta/Salida nocturna','party'],['Deportivo/Ejercicio','sport'],['Cita romántica','romantic'],['Evento especial/Boda','wedding']],genders:[['Masculino','masc'],['Femenino','fem'],['Unisex','uni']]};
    for (const [id, values] of [['climate', options.climates], ['occasion', options.occasions], ['gender', options.genders]]) {
      values.forEach(([value, key]) => { const option = localize(element('option', ''), () => t(key)); option.value = value; $(id).append(option); });
    }
    localize($('service-status'), () => t('status'));
  } catch (error) { $('service-status').textContent = 'No pudimos conectar con el asesor. Revisa que el servicio esté iniciado.'; }
}
initialize();

})();
