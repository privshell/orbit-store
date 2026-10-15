'use strict';
/* ORBIT // STORE WebUI */
const MOD = '/data/adb/modules/orbit_store';
const CLI = `sh ${MOD}/store.sh`;
const DEFAULT_SOURCE = 'https://modules.kernelsu.org/';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HAS_KSU = typeof window.ksu !== 'undefined' && typeof window.ksu.exec === 'function';
const VALID_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/;
const VALID_URL = /^https:\/\/[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ts = x => Date.parse(x || '') || 0;
const OS = window.OrbitSources || { LISTS: [], CATALOGS: [] };

/* ---------- shell bridge ---------- */
let cbn = 0;
function exec(cmd) {
  return new Promise(resolve => {
    if (!HAS_KSU) return resolve({ errno: 1, stdout: '', stderr: 'not running inside a root manager' });
    const name = `__orbit_cb_${Date.now()}_${cbn++}`;
    window[name] = (errno, stdout, stderr) => { delete window[name]; resolve({ errno, stdout: stdout || '', stderr: stderr || '' }); };
    try { window.ksu.exec(cmd, '{}', name); } catch (e) { delete window[name]; resolve({ errno: 1, stdout: '', stderr: String(e) }); }
  });
}
const cli = a => exec(`${CLI} ${a}`);
async function cliJSON(a, fb) {
  const r = await cli(a);
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  try { return JSON.parse(lines[lines.length - 1]); } catch (e) { return fb; }
}
const q = s => `'${String(s).replace(/'/g, '')}'`;

/* ---------- settings (local) ---------- */
const PREF = {
  get author() { return localStorage.getItem('orbit.author') || 'kreza6173-pixel'; },
  set author(v) { localStorage.setItem('orbit.author', v); },
  get pre() { return localStorage.getItem('orbit.pre') === '1'; },
  set pre(v) { localStorage.setItem('orbit.pre', v ? '1' : '0'); },
  cat(k) { return localStorage.getItem('orbit.cat.' + k) !== '0'; },
  setCat(k, v) { localStorage.setItem('orbit.cat.' + k, v ? '1' : '0'); }
};

/* ---------- state ---------- */
const S = {
  sources: [DEFAULT_SOURCE], modules: [], byId: new Map(), installed: new Map(), details: new Map(),
  tools: {}, tab: 'browse', q: '', sort: 'updated', tag: '', cached: false, failed: [], busy: new Set(), pendingReboot: false,
  lists: new Map(), listKey: (OS.LISTS[0] || {}).key || '', listCat: '', listQ: '', listLoading: false
};

/* ---------- ui helpers ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
function openSheet(html, bind) { $('#sheet').innerHTML = html; $('#sheetBg').classList.add('on'); $('#sheet').scrollTop = 0; if (bind) bind($('#sheet')); }
function closeSheet() { $('#sheetBg').classList.remove('on'); }
$('#sheetBg').addEventListener('click', e => { if (e.target.id === 'sheetBg') closeSheet(); });
function confirmSheet(title, text, ok, danger) {
  return new Promise(res => openSheet(`<h2>${esc(title)}</h2><p class="hint">${esc(text)}</p><div class="toolbar"><button class="${danger ? 'danger' : 'primary'}" id="cOk" style="flex:1">${esc(ok)}</button><button class="ghost" id="cNo" style="flex:1">Cancel</button></div>`, s => {
    $('#cOk', s).onclick = () => { closeSheet(); res(true); };
    $('#cNo', s).onclick = () => { closeSheet(); res(false); };
  }));
}
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function iconHtml(m) {
  const url = m.icon ? absUrl(m._src, m.icon) : '';
  const img = url ? `<img loading="lazy" src="${esc(url)}" onerror="this.remove()">` : '';
  return `<div class="ic" style="background:hsl(${hue(m.id)} 70% 72%)">${esc((m.name || m.id).trim().charAt(0).toUpperCase())}${img}</div>`;
}
function absUrl(base, path) {
  try { const u = new URL(path, base); return u.protocol === 'https:' ? u.href : ''; } catch (e) { return ''; }
}
function htmlToText(h) {
  if (!h) return '';
  const d = new DOMParser().parseFromString(String(h), 'text/html');
  d.querySelectorAll('li').forEach(li => li.prepend('• '));
  d.querySelectorAll('br,p,li,h1,h2,h3,h4,div,pre').forEach(el => el.append('\n'));
  return (d.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000; if (!isFinite(s)) return '';
  if (s < 3600) return `${Math.max(1, s / 60 | 0)}m ago`; if (s < 86400) return `${s / 3600 | 0}h ago`;
  if (s < 86400 * 60) return `${s / 86400 | 0}d ago`; return new Date(iso).toLocaleDateString();
}
const authorsText = m => (m.authors || []).map(a => a.name).filter(Boolean).join(', ') || (m.starsRepository || '').split('/')[0] || (m._repo ? m._repo.owner : '') || 'Unknown';
function fmtSize(n) { if (!n) return ''; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, n / 1024 | 0) + ' KB'; }

/* ---------- network ---------- */
async function getText(url) {
  if (!VALID_URL.test(url)) throw new Error('invalid url');
  const r = await cli(`get ${q(url)}`);
  let out = r.stdout;
  if (!out.includes('#ORBIT-FAILED') && out.trim()) {
    if (out.includes('#ORBIT-CACHED')) { S.cached = true; out = out.replace(/\n?#ORBIT-CACHED\s*$/, ''); }
    return out;
  }
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
const getJSON = async url => JSON.parse(await getText(url));

/* ---------- loading ---------- */
async function loadSources() {
  const r = await cli('sources');
  const list = r.stdout.split('\n').map(s => s.trim()).filter(s => VALID_URL.test(s));
  S.sources = list.length ? list.map(s => s.endsWith('/') ? s : s + '/') : [DEFAULT_SOURCE];
}
async function loadInstalled() {
  const arr = await cliJSON('installed', []);
  S.installed = new Map();
  for (const m of arr) { const cur = S.installed.get(m.id); if (!cur || m.pending) S.installed.set(m.id, m); }
}
/* KernelSU-API sources first (they win on id collisions), then the extra catalogs in order. */
async function loadRegistry() {
  S.cached = false; S.failed = [];
  const all = new Map();
  const main = await Promise.all(S.sources.map(async base => {
    try {
      const j = await getJSON(base + 'api/v1/modules.json');
      return (j.modules || []).filter(m => m && VALID_ID.test(m.id || '')).map(m => Object.assign({}, m, { _src: base }));
    } catch (e) { S.failed.push(base); return []; }
  }));
  const extra = await Promise.all(OS.CATALOGS.filter(c => PREF.cat(c.key)).map(async c => {
    try {
      const j = await getJSON(c.url);
      const list = c.key === 'mmar' ? OS.parseMmar(j) : OS.parseKsun(j, [...S.installed.values()]);
      return list.filter(m => VALID_ID.test(m.id)).map(m => Object.assign(m, { _src: c.web + '/' }));
    } catch (e) { S.failed.push(c.name); return []; }
  }));
  for (const group of [...main, ...extra]) for (const m of group) if (!all.has(m.id)) all.set(m.id, m);
  S.modules = [...all.values()];
  S.byId = all;
}
async function loadAll() {
  $('#subline').textContent = 'Loading...';
  $('#list').innerHTML = '<div class="empty"><span class="spin"></span> Fetching modules</div>';
  S.tools = await cliJSON('tools', {});
  await loadSources();
  await loadInstalled();
  await loadRegistry();
  renderAll();
  prefetchAlt();
}
/* Alt Repo entries carry no version in the index; read module.prop of installed ones so updates show up. */
async function prefetchAlt() {
  const want = S.modules.filter(m => m._kind === 'mmar' && S.installed.has(m.id) && !m.stable);
  for (const m of want) { try { await getDetail(m); } catch (e) { } }
  if (want.length) renderAll();
}

/* ---------- module state ---------- */
function stateOf(m) {
  const i = S.installed.get(m.id);
  if (S.busy.has(m.id)) return 'busy';
  if (!i) return 'none';
  if (i.pending) return 'pending';
  const rv = m.stable ? m.stable.versionCode : 0;
  return rv > i.versionCode ? 'update' : 'installed';
}
function actionBtn(m) {
  const st = stateOf(m);
  if (st === 'busy') return `<button class="act done" disabled><span class="spin"></span></button>`;
  if (st === 'update') return `<button class="act upd" data-install="${esc(m.id)}">Update</button>`;
  if (st === 'installed') return `<button class="act done" data-open="${esc(m.id)}">Installed</button>`;
  if (st === 'pending') return `<button class="act done" data-reboot="1">Reboot</button>`;
  return `<button class="act" data-install="${esc(m.id)}">Install</button>`;
}
function card(m) {
  const i = S.installed.get(m.id);
  const tags = [];
  if (m._label) tags.push(`<span class="chip src">${esc(m._label)}</span>`);
  if (m.metamodule) tags.push('<span class="chip meta">Metamodule</span>');
  if (m.stable && m.stable.publishedAt && Date.now() - Date.parse(m.stable.publishedAt) < 3 * 86400000) tags.push('<span class="chip new">New release</span>');
  if (m.stars) tags.push(`<span class="chip">★ ${m.stars}</span>`);
  if (m.stable && m.stable.version) tags.push(`<span class="chip">${esc(m.stable.version)}</span>`);
  if (i && stateOf(m) === 'update') tags.push(`<span class="chip">installed ${esc(i.version)}</span>`);
  const when = m.stable && m.stable.publishedAt ? m.stable.publishedAt : m.updatedAt;
  return `<div class="card" data-id="${esc(m.id)}">${iconHtml(m)}<div class="meta"><div class="name">${esc(m.name || m.id)}</div><div class="by">${esc(authorsText(m))}${when ? ' · ' + esc(ago(when)) : ''}</div><div class="sum">${esc(m.summary || (m._kind === 'mmar' ? 'Tap for details' : ''))}</div><div class="row">${tags.join('')}${actionBtn(m)}</div></div></div>`;
}

/* ---------- render ---------- */
function filtered() {
  const t = S.q.trim().toLowerCase();
  let list = S.modules.filter(m => {
    if (S.tag && !(m.tags || []).includes(S.tag)) return false;
    if (!t) return true;
    return `${m.id} ${m.name} ${m.summary} ${authorsText(m)} ${(m.tags || []).join(' ')} ${m._label || ''}`.toLowerCase().includes(t);
  });
  const by = { updated: (a, b) => ts(b.updatedAt) - ts(a.updatedAt), stars: (a, b) => (b.stars || 0) - (a.stars || 0), name: (a, b) => (a.name || a.id).localeCompare(b.name || b.id) };
  return list.sort(by[S.sort]);
}
function renderBrowse() {
  const list = filtered();
  const n = [];
  if (S.failed.length) n.push(`<div class="err">Could not reach ${S.failed.map(esc).join(', ')}. Check your connection or the download tools in Settings.</div>`);
  if (S.cached) n.push('<div class="warn">Showing a cached copy of the catalog. Pull Refresh when you are online.</div>');
  if (!HAS_KSU) n.push('<div class="warn">Open this page from your root manager (KernelSU, APatch or a WebUI-capable manager) to install modules.</div>');
  $('#notice').innerHTML = n.join('');
  const shown = list.slice(0, 400);
  $('#list').innerHTML = shown.length ? shown.map(card).join('') + (list.length > shown.length ? `<div class="empty">${list.length - shown.length} more, refine the search to see them.</div>` : '') : '<div class="empty">No modules found.</div>';
  const counts = new Map(); S.modules.forEach(m => (m.tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const pin = ['alt-repo', 'ksu-next'].filter(t => counts.has(t));
  const tags = [...pin, ...top.filter(t => !pin.includes(t))].slice(0, 26);
  $('#tagbar').innerHTML = `<button data-tag="" class="${S.tag ? '' : 'on'}">All</button>` + tags.map(t => `<button data-tag="${esc(t)}" class="${S.tag === t ? 'on' : ''}">${esc(t)}</button>`).join('');
}
function updates() { return S.modules.filter(m => stateOf(m) === 'update'); }
function renderInstalled() {
  const reg = S.modules.filter(m => S.installed.has(m.id));
  const ups = updates();
  const local = [...S.installed.values()].filter(i => !S.byId.has(i.id));
  $('#updHint').textContent = ups.length ? `${ups.length} update${ups.length > 1 ? 's' : ''} available` : 'Everything is up to date';
  $('#updAll').style.display = ups.length > 1 ? '' : 'none';
  const ord = reg.sort((a, b) => (stateOf(b) === 'update') - (stateOf(a) === 'update'));
  $('#instList').innerHTML = (ord.map(card).join('') +
    (local.length ? `<h4 class="hint" style="margin-top:16px">Not in the catalog</h4>` + local.map(i => `<div class="card"><div class="ic" style="background:hsl(${hue(i.id)} 30% 40%)">${esc((i.name || i.id).charAt(0).toUpperCase())}</div><div class="meta"><div class="name">${esc(i.name || i.id)}</div><div class="by">${esc(i.author)} · ${esc(i.version)}${i.state !== 'enabled' ? ' · ' + esc(i.state) : ''}${i.pending ? ' · reboot pending' : ''}</div><div class="by mono">${esc(i.id)}</div></div></div>`).join('') : '')) || '<div class="empty">No modules installed.</div>';
  const b = $('#updBadge'); b.textContent = ups.length; b.classList.toggle('on', ups.length > 0);
}
function isFeatured(m) {
  const a = PREF.author.toLowerCase(); if (!a) return false;
  return (m.authors || []).some(x => (x.name || '').toLowerCase() === a || (x.url || '').toLowerCase().replace(/\/+$/, '').endsWith('/' + a)) || (m.starsRepository || '').toLowerCase().startsWith(a + '/') || (m._repo && m._repo.owner.toLowerCase() === a);
}
function renderMine() {
  const list = S.modules.filter(isFeatured);
  $('#mineList').innerHTML = list.length ? list.map(card).join('') : `<div class="empty">No modules by ${esc(PREF.author)} in the catalog yet.</div>`;
}
function renderHeader() {
  const ups = updates().length;
  $('#subline').textContent = `${S.modules.length} modules · ${S.installed.size} installed${ups ? ` · ${ups} update${ups > 1 ? 's' : ''}` : ''}`;
}
function renderAll() { renderHeader(); renderBrowse(); renderInstalled(); renderMine(); if (S.tab === 'settings') renderSettings(); if (S.tab === 'lists') renderLists(); }

/* ---------- curated lists ---------- */
async function loadList(key) {
  const L = OS.LISTS.find(l => l.key === key); if (!L || S.lists.has(key)) return;
  S.listLoading = true; renderLists();
  let failed = 0;
  const parts = await Promise.all(L.parts.map(async p => {
    try { return L.parse(await getText(p.url), p.cat); } catch (e) { failed++; return []; }
  }));
  const seen = new Set(), items = [];
  parts.flat().forEach(it => { const k = it.cat + '|' + it.url; if (!seen.has(k)) { seen.add(k); items.push(it); } });
  S.lists.set(key, { items, failed, total: L.parts.length });
  S.listLoading = false;
  if (S.tab === 'lists') renderLists();
}
function listItems() {
  const d = S.lists.get(S.listKey); if (!d) return [];
  const t = S.listQ.trim().toLowerCase();
  return d.items.filter(it => (!S.listCat || it.cat === S.listCat) && (!t || `${it.name} ${it.desc} ${it.cat} ${it.sub} ${it.badges.join(' ')}`.toLowerCase().includes(t)));
}
function lcard(it, idx) {
  const gh = OS.ghRepo(it.url);
  const chips = [`<span class="chip">${esc(it.sub || it.cat)}</span>`].concat(it.badges.slice(0, 4).map(b => `<span class="chip">${esc(b)}</span>`));
  return `<div class="card lcard"><div class="ic" style="background:hsl(${hue(it.name)} 55% 66%)">${esc(it.name.charAt(0).toUpperCase())}</div><div class="meta"><div class="name">${esc(it.name)}</div><div class="by mono">${esc(it.url.replace(/^https:\/\//, '').slice(0, 60))}</div><div class="sum">${esc(it.desc)}</div><div class="row">${chips.join('')}<span style="flex:1"></span>${gh ? `<button class="ghost" data-lrel="${idx}">Releases</button>` : ''}<button class="ghost" data-lopen="${idx}">Open</button></div></div></div>`;
}
function renderLists() {
  const box = $('#listsBox'); if (!box) return;
  const L = OS.LISTS.find(l => l.key === S.listKey);
  if (!L) { box.innerHTML = '<div class="empty">No lists configured.</div>'; return; }
  const d = S.lists.get(S.listKey);
  if (!d && !S.listLoading) { loadList(S.listKey); return; }
  const seg = `<div class="seg" id="lseg">${OS.LISTS.map(l => `<button data-l="${esc(l.key)}" class="${l.key === S.listKey ? 'on' : ''}">${esc(l.name)}</button>`).join('')}</div>`;
  if (!d) { box.innerHTML = seg + '<div class="empty"><span class="spin"></span> Fetching the list</div>'; bindLists(box); return; }
  const cats = [...new Set(d.items.map(i => i.cat))];
  const counts = new Map(); d.items.forEach(i => counts.set(i.cat, (counts.get(i.cat) || 0) + 1));
  const items = listItems();
  S.listView = items;
  box.innerHTML = seg +
    `<p class="hint">${d.items.length} entries in ${cats.length} categories · <a href="#" id="lweb">${esc(L.web.replace(/^https:\/\//, ''))}</a></p>` +
    (d.failed ? `<div class="warn">${d.failed} of ${d.total} parts could not be loaded. Refresh to retry.</div>` : '') +
    `<div class="tags" id="lcats"><button data-c="" class="${S.listCat ? '' : 'on'}">All</button>${cats.map(c => `<button data-c="${esc(c)}" class="${S.listCat === c ? 'on' : ''}">${esc(c)} <small>${counts.get(c)}</small></button>`).join('')}</div>` +
    `<div class="list">${items.length ? items.slice(0, 300).map((it, i) => lcard(it, i)).join('') : '<div class="empty">Nothing matches.</div>'}</div>` +
    `<p class="hint" style="margin-top:12px">Lists are read-only links curated by their maintainers. ORBIT does not vet them. Releases installs the latest GitHub release zip of that repository.</p>`;
  bindLists(box);
}
function bindLists(box) {
  $$('#lseg button', box).forEach(b => b.onclick = () => { S.listKey = b.dataset.l; S.listCat = ''; renderLists(); });
  $$('#lcats button', box).forEach(b => b.onclick = () => { S.listCat = b.dataset.c; renderLists(); });
  const w = $('#lweb', box); if (w) w.onclick = e => { e.preventDefault(); const L = OS.LISTS.find(l => l.key === S.listKey); if (L) cli(`open ${q(L.web)}`); };
}
function openListRepo(it) {
  const r = OS.ghRepo(it.url); if (!r) return;
  const hit = S.modules.find(m => m._repo && m._repo.full === r.full) || S.modules.find(m => (m.starsRepository || '').toLowerCase() === r.full);
  if (hit) return openDetail(hit.id);
  const id = OS.slugId('gh.', r.owner + '.' + r.repo); if (!id) return toast('Unsupported repository name');
  if (!S.byId.has(id)) S.byId.set(id, { id, name: it.name, summary: it.desc, authors: [{ name: r.owner }], tags: [], _kind: 'gh', _label: 'List', _repo: r, _src: 'https://github.com/' });
  openDetail(id);
}
$('#lq').addEventListener('input', e => { S.listQ = e.target.value; renderLists(); });

/* ---------- events ---------- */
$('#q').addEventListener('input', e => { S.q = e.target.value; renderBrowse(); });
$('#sort').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('#sort button').forEach(x => x.classList.toggle('on', x === b)); S.sort = b.dataset.s; renderBrowse(); });
$('#tagbar').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.tag = b.dataset.tag; renderBrowse(); });
$('#refresh').onclick = () => { S.lists.clear(); S.details.clear(); loadAll(); };
document.addEventListener('click', e => {
  const lo = e.target.closest('[data-lopen]');
  if (lo) { e.stopPropagation(); const it = (S.listView || [])[+lo.dataset.lopen]; if (it) cli(`open ${q(it.url)}`); return; }
  const lr = e.target.closest('[data-lrel]');
  if (lr) { e.stopPropagation(); const it = (S.listView || [])[+lr.dataset.lrel]; if (it) openListRepo(it); return; }
  const ins = e.target.closest('[data-install]');
  if (ins) { e.stopPropagation(); return installModule(ins.dataset.install); }
  const rb = e.target.closest('[data-reboot]');
  if (rb) { e.stopPropagation(); return rebootPrompt(); }
  const op = e.target.closest('[data-open]');
  const c = op || e.target.closest('.card[data-id]');
  if (c && !e.target.closest('.sheet')) openDetail(op ? op.dataset.open : c.dataset.id);
});
$('#updAll').onclick = async () => {
  const ups = updates();
  if (!(await confirmSheet('Update all', `Install ${ups.length} updates one after another?`, 'Update all'))) return;
  for (const m of ups) await installModule(m.id, null, true);
  rebootPrompt();
};
$$('nav.bottom button').forEach(b => b.onclick = () => {
  S.tab = b.dataset.tab;
  $$('nav.bottom button').forEach(x => x.classList.toggle('on', x === b));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + S.tab));
  window.scrollTo(0, 0);
  if (S.tab === 'settings') renderSettings();
  if (S.tab === 'lists') renderLists();
});

/* ---------- details ---------- */
const repoUrl = r => `https://github.com/${r.owner}/${r.repo}`;
/* Alt Repo: module.prop gives name/version, the index gives a source-archive zip that is repacked on the device. */
async function mmarDetail(m) {
  const p = OS.parseProp(await getText(m._prop));
  let notes = '';
  if (m._notes && VALID_URL.test(m._notes)) { try { notes = (await getText(m._notes)).slice(0, 6000); } catch (e) { } }
  const vc = parseInt(p.versionCode, 10) || 0;
  m.name = p.name || m.id; m.summary = p.description || ''; m.authors = p.author ? [{ name: p.author }] : [];
  m.stable = { version: p.version || '', versionCode: vc };
  return {
    id: m.id, name: m.name, summary: m.summary, authors: m.authors, tags: m.tags, stars: m.stars, stable: m.stable,
    homepage: m._repo ? repoUrl(m._repo) : '', support: p.support || '', source: m._repo ? { fullName: m._repo.owner + '/' + m._repo.repo, url: repoUrl(m._repo) } : null,
    releases: [{ tag: 'archive', version: p.version || 'latest', versionCode: vc, prerelease: false, publishedAt: m.updatedAt, changelogHtml: notes, archive: true, zip: { url: m._zip, size: 0, sha256: '' } }],
    _note: 'Built from the repository source archive on this device. The Alt Repo publishes no checksum.'
  };
}
/* GitHub repository: newest releases with a zip asset; the asset digest is used as sha256 when GitHub provides one. */
async function ghDetail(m) {
  const r = m._repo;
  const rels = OS.ghReleases(await getJSON(`https://api.github.com/repos/${r.owner}/${r.repo}/releases?per_page=15`));
  const st = rels.find(x => !x.prerelease) || rels[0];
  if (st) m.stable = { version: st.version, versionCode: 0, publishedAt: st.publishedAt };
  return {
    id: m.id, name: m.name, summary: m.summary, authors: m.authors, tags: m.tags, license: m.license, stable: m.stable,
    homepage: repoUrl(r), source: { fullName: r.owner + '/' + r.repo, url: repoUrl(r) }, releases: rels,
    _note: 'Releases come straight from GitHub. The module id is only known after install, so update checks are not available for this entry.'
  };
}
async function getDetail(m) {
  if (S.details.has(m.id)) return S.details.get(m.id);
  let d;
  if (m._kind === 'mmar') d = await mmarDetail(m);
  else if (m._kind === 'gh') d = await ghDetail(m);
  else d = await getJSON(absUrl(m._src, m.detail || `api/v1/modules/${m.id}.json`));
  S.details.set(m.id, d);
  return d;
}
function pickRelease(d) {
  const rels = (d.releases || []).filter(r => r.zip && r.zip.url);
  const sv = d.stable && d.stable.versionCode;
  return rels.find(r => sv && r.versionCode === sv && !r.prerelease) || rels.find(r => !r.prerelease) || rels[0];
}
function compat(d) {
  const w = [], c = d.compatibility || {}, sdk = +S.tools.sdk || 0;
  if (c.androidMinApi && sdk && sdk < c.androidMinApi) w.push(`Needs Android API ${c.androidMinApi}+, this device is API ${sdk}.`);
  if (c.androidMaxApi && sdk && sdk > c.androidMaxApi) w.push(`Declared for Android API ${c.androidMaxApi} or lower, this device is API ${sdk}.`);
  const abis = String(S.tools.abis || S.tools.abi || '').split(',').filter(Boolean);
  if (c.architectures && c.architectures.length && abis.length && !c.architectures.some(a => abis.includes(a))) w.push(`Built for ${c.architectures.join(', ')}, this device is ${abis.join(', ')}.`);
  if (d.metamodule) {
    const other = [...S.installed.values()].filter(i => i.meta && i.id !== d.id && i.state !== 'remove');
    if (other.length) w.push(`This is a metamodule and ${other.map(o => o.name || o.id).join(', ')} is already installed. Two metamodules at once usually cause a bootloop.`);
  }
  if (d.health && d.health.status && d.health.status !== 'ok') w.push(`The catalog reports this module as "${d.health.status}".`);
  return w;
}
async function openDetail(id) {
  const m = S.byId.get(id); if (!m) return;
  openSheet(`<div class="empty"><span class="spin"></span> Loading ${esc(m.name || m.id)}</div>`);
  let d;
  try { d = await getDetail(m); } catch (e) {
    const src = m._repo ? repoUrl(m._repo) : '';
    openSheet(`<h2>${esc(m.name || m.id)}</h2><div class="err">Could not load module details (${esc(e.message)}).${m._kind === 'gh' ? ' GitHub allows 60 anonymous API calls per hour, try again later.' : ''}</div>${src ? `<div class="row" style="margin-top:12px"><button class="ghost" id="srcOpen">Open repository</button></div>` : ''}`, s => { const b = $('#srcOpen', s); if (b) b.onclick = () => cli(`open ${q(src)}`); });
    return;
  }
  const i = S.installed.get(id), warns = compat(d);
  const rels = (d.releases || []).filter(r => r.zip && (PREF.pre || !r.prerelease));
  const links = [['Homepage', d.homepage], ['Support', d.support], ['Source', d.source && d.source.url]].filter((l, k, a) => l[1] && VALID_URL.test(l[1]) && a.findIndex(x => x[1] === l[1]) === k);
  const ch = rels[0] ? htmlToText(rels[0].changelogHtml) : '';
  renderAll();
  openSheet(`
    <div style="display:flex;gap:12px;align-items:center">${iconHtml(m)}<div class="meta"><h2>${esc(d.name || id)}</h2><div class="by">${esc(authorsText(d.authors && d.authors.length ? d : m))}</div></div></div>
    <p class="hint" style="margin-top:10px">${esc(d.summary || '')}</p>
    ${warns.map(w => `<div class="warn">${esc(w)}</div>`).join('')}
    ${d._note ? `<div class="warn">${esc(d._note)}</div>` : ''}
    <div class="row">${m._label ? `<span class="chip src">${esc(m._label)}</span>` : ''}${(d.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}${d.metamodule ? '<span class="chip meta">Metamodule</span>' : ''}${d.license ? `<span class="chip">${esc(d.license)}</span>` : ''}${d.stars ? `<span class="chip">★ ${d.stars}</span>` : ''}</div>
    <div class="row" style="margin-top:12px">${i ? `<span class="hint" style="margin:0">Installed ${esc(i.version)}${i.pending ? ' (reboot pending)' : ''}</span>` : ''}${rels.length ? actionBtn(m) : ''}</div>
    ${ch ? `<h4>What's new in ${esc(rels[0].version)}</h4><div class="prose">${esc(ch)}</div>` : ''}
    <h4>Versions</h4>
    <div>${rels.length ? rels.slice(0, 15).map(r => `<div class="rel"><div class="meta"><div class="name">${esc(r.version)}${r.prerelease ? ' <span class="chip meta">pre-release</span>' : ''}${r.immutable ? ' <span class="chip">immutable</span>' : ''}${r.archive ? ' <span class="chip">source archive</span>' : ''}</div><div class="by">${esc(ago(r.publishedAt))}${r.zip.size ? ' · ' + esc(fmtSize(r.zip.size)) : ''}${r.asset ? ' · ' + esc(r.asset) : ''}</div><div class="mono" style="color:var(--mu)">sha256 ${esc((r.zip.sha256 || 'not provided').slice(0, 24))}${r.zip.sha256 ? '...' : ''}</div></div><button class="ghost" data-rel="${esc(r.tag)}">Install</button></div>`).join('') : '<div class="hint">No downloadable releases with a zip file.</div>'}</div>
    <h4>Details</h4>
    <div class="kv"><span>ID</span><span class="mono">${esc(m._kind === 'gh' ? 'set by the zip' : id)}</span>${d.compatibility && d.compatibility.androidMinApi ? `<span>Min Android API</span><span>${esc(d.compatibility.androidMinApi)}</span>` : ''}${d.compatibility && d.compatibility.architectures ? `<span>Architectures</span><span>${esc(d.compatibility.architectures.join(', '))}</span>` : ''}<span>Source</span><span>${esc(d.source ? d.source.fullName : m._src)}</span><span>Catalog</span><span>${esc(m._label || m._src)}</span></div>
    ${links.length || d.readme ? `<div class="row" style="margin-top:12px">${links.map(l => `<button class="ghost" data-link="${esc(l[1])}">${l[0]}</button>`).join('')}${d.readme ? '<button class="ghost" id="readme">Description</button>' : ''}</div>` : ''}
    <div id="readmeBox"></div>`, s => {
    $$('[data-rel]', s).forEach(b => b.onclick = () => installModule(id, b.dataset.rel));
    $$('[data-link]', s).forEach(b => b.onclick = () => cli(`open ${q(b.dataset.link)}`));
    const rb = $('#readme', s);
    if (rb) rb.onclick = async () => {
      rb.disabled = true; $('#readmeBox', s).innerHTML = '<p class="hint"><span class="spin"></span> Loading</p>';
      try { const t = await getText(absUrl(m._src, d.readme)); let txt = t; try { const j = JSON.parse(t); txt = j.html || j.markdown || j.content || t; } catch (e) { } $('#readmeBox', s).innerHTML = `<h4>Description</h4><div class="prose">${esc(htmlToText(txt))}</div>`; }
      catch (e) { $('#readmeBox', s).innerHTML = '<div class="err">Could not load the description.</div>'; }
    };
  });
}

/* ---------- install ---------- */
function logSheet(title) {
  openSheet(`<h2>${esc(title)}</h2><p class="hint" id="jobState"><span class="spin"></span> Working</p><pre class="log" id="jobLog"></pre><div class="toolbar" id="jobBtns"></div>`);
  return {
    log: t => { const el = $('#jobLog'); if (el) { el.textContent = t; el.scrollTop = el.scrollHeight; } },
    state: (h) => { const el = $('#jobState'); if (el) el.innerHTML = h; },
    done: (ok) => { const el = $('#jobBtns'); if (!el) return; el.innerHTML = ok ? '<button class="primary" id="jbR" style="flex:1">Reboot now</button><button class="ghost" id="jbL" style="flex:1">Later</button>' : '<button class="ghost" id="jbL" style="flex:1">Close</button>'; const r = $('#jbR'); if (r) r.onclick = () => cli('reboot'); $('#jbL').onclick = closeSheet; }
  };
}
async function pollJob(id, ui, prefix) {
  for (let n = 0; n < 1200; n++) {
    await sleep(600);
    const j = await cliJSON(`job ${q(id)}`, { status: 'none', log: '' });
    ui.log(prefix + (j.log || ''));
    if (j.status !== 'running') return j;
  }
  return { status: 'fail', log: 'Timed out' };
}
async function webviewDownload(id, url, size, ui) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (size && buf.length !== size) throw new Error(`size ${buf.length}, expected ${size}`);
  const CH = 48 * 1024;
  for (let i = 0, k = 0; i < buf.length; i += CH, k++) {
    let bin = ''; const part = buf.subarray(i, i + CH);
    for (let j = 0; j < part.length; j++) bin += String.fromCharCode(part[j]);
    const r = await cliJSON(`chunk ${q(id)} ${k} ${q(btoa(bin))}`, { ok: false });
    if (!r.ok) throw new Error('could not write the file');
    ui.state(`<span class="spin"></span> Saving ${Math.min(100, Math.round((i + CH) / buf.length * 100))}%`);
  }
}
async function installModule(id, tag, quiet) {
  const m = S.byId.get(id); if (!m || S.busy.has(id)) return;
  if (!HAS_KSU) return toast('Open ORBIT from your root manager to install');
  let d;
  try { d = await getDetail(m); } catch (e) { return toast('Could not load module details'); }
  const rel = tag ? (d.releases || []).find(r => r.tag === tag) : pickRelease(d);
  if (!rel || !rel.zip || !VALID_URL.test(rel.zip.url)) return toast('No downloadable release');
  const warns = compat(d);
  if (!quiet && warns.length && !(await confirmSheet('Install anyway?', warns.join(' '), 'Install', true))) return;
  const sha = /^[0-9a-f]{64}$/.test(rel.zip.sha256 || '') ? rel.zip.sha256 : '-';
  const mode = rel.archive ? ' archive' : '';
  if (!quiet && sha === '-' && !(await confirmSheet('No checksum', rel.archive ? 'This module comes from the Alt Repo as a source archive. It has no published checksum, ORBIT rebuilds it into a flashable zip on this device.' : 'The source has no sha256 for this file, so it cannot be verified.', 'Install unverified', true))) return;
  S.busy.add(id); renderAll();
  const ui = logSheet(`${d.name || id} ${rel.version}`);
  let res = await cliJSON(`install ${q(id)} ${q(rel.zip.url)} ${sha}${mode}`, { ok: false, error: 'engine not reachable' });
  let j = res.ok ? await pollJob(id, ui, '') : { status: 'fail', log: res.error };
  if (j.status === 'nodl') {
    const prev = j.log + '\nRoot download tools failed, retrying through the WebView...\n';
    ui.log(prev);
    try {
      await webviewDownload(id, rel.zip.url, rel.zip.size, ui);
      res = await cliJSON(`install ${q(id)} local ${sha}${mode}`, { ok: false });
      j = res.ok ? await pollJob(id, ui, prev) : { status: 'fail', log: prev + 'Could not start the installer.' };
    } catch (e) { j = { status: 'fail', log: prev + 'WebView download failed: ' + e.message }; ui.log(j.log); }
  }
  S.busy.delete(id);
  const ok = j.status === 'ok';
  ui.state(ok ? '<span class="okc">Installed. Reboot to activate.</span>' : '<span class="badc">Install failed. See the log above.</span>');
  ui.done(ok);
  if (ok) S.pendingReboot = true;
  await loadInstalled(); renderAll();
  return ok;
}
function rebootPrompt() {
  openSheet('<h2>Reboot to apply</h2><p class="hint">Installed and updated modules become active after a reboot.</p><div class="toolbar"><button class="primary" id="rbN" style="flex:1">Reboot now</button><button class="ghost" id="rbL" style="flex:1">Later</button></div>', s => {
    $('#rbN', s).onclick = () => cli('reboot'); $('#rbL', s).onclick = closeSheet;
  });
}

/* ---------- settings ---------- */
function renderSettings() {
  const t = S.tools, yn = v => v ? '<span class="okc">yes</span>' : '<span class="badc">no</span>';
  const cnt = k => S.modules.filter(m => m._kind && (k === 'mmar' ? m._kind === 'mmar' : m._kind === 'gh' && m._label === 'KSU Next')).length;
  $('#settingsBox').innerHTML = `
  <div class="box"><h3>Catalog sources</h3><p class="hint">One base URL per line. Each must serve the KernelSU Modules API (api/v1/modules.json). These win when IDs collide with the extra catalogs.</p>
    <textarea id="srcs">${esc(S.sources.join('\n'))}</textarea>
    <div class="toolbar" style="margin-top:8px"><button class="ghost" id="srcReset">Reset</button><button class="primary" id="srcSave" style="flex:1">Save and reload</button></div></div>
  <div class="box"><h3>Extra catalogs</h3><p class="hint">Merged into Browse with a source label. Duplicates of KernelSU catalog IDs are skipped.</p>
    ${OS.CATALOGS.map(c => `<div class="toolbar"><span style="flex:1">${esc(c.name)}<br><small class="hint">${PREF.cat(c.key) ? cnt(c.key) + ' modules' : 'off'}</small></span><button class="ghost" data-catweb="${esc(c.web)}">Site</button><button class="ghost" data-cat="${esc(c.key)}">${PREF.cat(c.key) ? 'On' : 'Off'}</button></div>`).join('')}</div>
  <div class="box"><h3>Curated lists</h3><p class="hint">Shown in the Lists tab, grouped by category.</p><div class="kv">${OS.LISTS.map(l => `<span>${esc(l.name)}</span><span class="mono">${esc(l.web.replace(/^https:\/\//, ''))}</span>`).join('')}</div></div>
  <div class="box"><h3>Featured author</h3><p class="hint">GitHub user or author name shown in the Featured tab.</p>
    <div class="toolbar"><input class="f" id="auth" value="${esc(PREF.author)}"><button class="ghost" id="authSave">Save</button></div></div>
  <div class="box"><h3>Versions</h3><div class="toolbar"><span>Show pre-releases in version lists</span><button class="ghost" id="preT">${PREF.pre ? 'On' : 'Off'}</button></div></div>
  <div class="box"><h3>Diagnostics</h3><div class="kv">
    <span>Installer</span><span>${esc(t.installer || 'unknown')}</span><span>curl</span><span>${yn(t.curl)}</span><span>busybox wget</span><span>${yn(t.wget)}</span>
    <span>WebView fallback</span><span>${yn(true)}</span><span>Android API</span><span>${esc(t.sdk || '-')}</span><span>ABI</span><span>${esc(t.abis || t.abi || '-')}</span><span>Device</span><span>${esc(t.device || '-')}</span></div>
    <div class="toolbar" style="margin-top:12px"><button class="ghost" id="rb" style="flex:1">Reboot</button></div></div>
  <div class="box"><h3>About</h3><div class="kv"><span>Version</span><span>v1.1.0</span><span>Author</span><span>kreza6173-pixel</span><span>Checks</span><span>sha256 is verified whenever the source publishes one; unverified installs always ask first</span></div></div>`;
  const b = $('#settingsBox');
  $('#srcSave', b).onclick = async () => {
    const lines = $('#srcs', b).value.split('\n').map(s => s.trim()).filter(Boolean);
    const bad = lines.filter(l => !VALID_URL.test(l));
    if (bad.length) return toast('Only https URLs are allowed');
    await cli(`setsources ${q(btoa(lines.join('\n')))}`); S.details.clear(); toast('Sources saved'); loadAll();
  };
  $('#srcReset', b).onclick = () => { $('#srcs', b).value = DEFAULT_SOURCE; };
  $$('[data-cat]', b).forEach(x => x.onclick = () => { PREF.setCat(x.dataset.cat, !PREF.cat(x.dataset.cat)); S.details.clear(); toast('Catalogs updated'); loadAll(); });
  $$('[data-catweb]', b).forEach(x => x.onclick = () => cli(`open ${q(x.dataset.catweb)}`));
  $('#authSave', b).onclick = () => { PREF.author = $('#auth', b).value.trim(); renderMine(); toast('Saved'); };
  $('#preT', b).onclick = e => { PREF.pre = !PREF.pre; e.target.textContent = PREF.pre ? 'On' : 'Off'; };
  $('#rb', b).onclick = rebootPrompt;
}

loadAll();
