'use strict';
/* ORBIT // STORE - extra catalogs and curated lists.
 * Loaded before app.js. Parsers are pure and tested in Node (tests/sources.test.js);
 * everything that touches the network or the page runs only when app.js calls it. */
(function (root) {
  const GH_REPO = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[\/#?].*)?$/;
  const ID_OK = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/;

  function ghRepo(url) {
    const m = GH_REPO.exec(String(url || '').trim());
    if (!m || ['orgs', 'topics', 'sponsors', 'settings', 'apps'].includes(m[1])) return null;
    return { owner: m[1], repo: m[2], full: (m[1] + '/' + m[2]).toLowerCase() };
  }
  function slugId(prefix, s) {
    const id = (prefix + String(s).replace(/[^A-Za-z0-9._-]+/g, '_')).slice(0, 64).replace(/[._-]+$/, '');
    return ID_OK.test(id) ? id : null;
  }
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  /* module.prop text -> object */
  function parseProp(txt) {
    const o = {};
    String(txt || '').split('\n').forEach(l => { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
    return o;
  }

  /* Magisk Modules Alt Repo: {modules:[{id, prop_url, zip_url, notes_url, stars, last_update}]} */
  function parseMmar(j) {
    return ((j && j.modules) || []).filter(m => m && ID_OK.test(m.id || '') && /^https:\/\//.test(m.zip_url || '')).map(m => ({
      id: m.id, name: m.id, summary: '', authors: [], stars: m.stars || 0,
      tags: ['alt-repo'], updatedAt: m.last_update ? new Date(m.last_update).toISOString() : '',
      _kind: 'mmar', _label: 'Alt Repo', _prop: m.prop_url, _zip: m.zip_url, _notes: m.notes_url,
      _repo: ghRepo((m.zip_url || '').replace(/\/archive\/.*$/, ''))
    }));
  }

  /* KernelSU Next modules repo: [{name, description, author, repoUrl, license, visibility}] */
  function parseKsun(arr, installed) {
    const byName = new Map();
    (installed || []).forEach(i => byName.set(norm(i.name), i.id));
    return (Array.isArray(arr) ? arr : []).map(m => {
      const r = ghRepo(m && m.repoUrl); if (!r) return null;
      const id = byName.get(norm(m.name)) || slugId('gh.', r.owner + '.' + r.repo);
      if (!id) return null;
      return {
        id, name: m.name, summary: m.description || '', authors: [{ name: m.author || r.owner }], stars: 0,
        tags: ['ksu-next'], updatedAt: '', license: m.license, _kind: 'gh', _label: 'KSU Next', _repo: r
      };
    }).filter(Boolean);
  }

  /* GitHub releases API -> catalog-style releases, one zip asset each. */
  function ghReleases(list) {
    return (Array.isArray(list) ? list : []).filter(r => r && !r.draft).map(r => {
      const zips = (r.assets || []).filter(a => /\.zip$/i.test(a.name || '') && /^https:\/\//.test(a.browser_download_url || ''));
      const a = zips.find(x => !/debug|source|symbols/i.test(x.name)) || zips[0];
      if (!a) return null;
      const dg = /^sha256:([0-9a-f]{64})$/.exec(a.digest || '');
      return {
        tag: r.tag_name, version: r.name || r.tag_name, versionCode: 0, prerelease: !!r.prerelease,
        publishedAt: r.published_at, changelogHtml: r.body || '', asset: a.name,
        zip: { url: a.browser_download_url, size: a.size || 0, sha256: dg ? dg[1] : '' }
      };
    }).filter(Boolean);
  }

  /* ---- curated lists (markdown) ---- */
  function cleanText(s) {
    return String(s || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]+/g, '').replace(/\s*\|.*$/, '').replace(/\s+/g, ' ').trim();
  }
  const ITEM = /^\s*[-*+]\s+\**\s*\[(?:⭐\s*)?([^\]]+)\]\((https?:\/\/[^)\s]+)\)\**\s*(?:[-–—:]\s*(.*))?$/;

  /* Generic awesome-list markdown: headings become categories, linked list items become entries. */
  function parseAwesome(md, fallbackCat) {
    let txt = String(md || '');
    if (txt.startsWith('---')) { const e = txt.indexOf('\n---', 3); if (e > 0) txt = txt.slice(e + 4); }
    const out = []; let h2 = fallbackCat || '', h3 = '';
    txt.split('\n').forEach(line => {
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { const t = cleanText(h[2]); if (h[1].length <= 2) { h2 = t; h3 = ''; } else h3 = t; return; }
      const m = ITEM.exec(line);
      if (!m || !/^https:\/\//.test(m[2])) return;
      const rest = m[3] || '';
      const badges = (rest.match(/`([^`]+)`/g) || []).map(b => b.replace(/`/g, ''));
      out.push({ name: cleanText(m[1]), url: m[2], desc: cleanText(rest.replace(/`[^`]+`/g, '')), cat: h2 || fallbackCat || 'General', sub: h3, badges });
    });
    return out;
  }

  /* The gist uses "### **Name**", a "🔗 [url](url)" line and a "**Purpose:**" line per entry. */
  function parseGist(md) {
    const out = []; let cat = 'General', cur = null;
    const push = () => { if (cur && cur.url) out.push(cur); cur = null; };
    String(md || '').split('\n').forEach(line => {
      let m;
      if ((m = /^##\s+(.*)$/.exec(line))) { push(); cat = cleanText(m[1]).replace(/^[^A-Za-z0-9]+/, ''); return; }
      if ((m = /^###\s+(.*)$/.exec(line))) { push(); cur = { name: cleanText(m[1]).replace(/^[^A-Za-z0-9]+/, ''), url: '', desc: '', cat, sub: '', badges: [] }; return; }
      if (!cur) return;
      if (!cur.url && (m = /\]\((https:\/\/[^)\s]+)\)/.exec(line))) { cur.url = m[1]; return; }
      if (!cur.desc && (m = /^\*\*(?:Purpose|What it does):\*\*\s*(.*)$/.exec(line.trim()))) cur.desc = cleanText(m[1]);
    });
    push();
    return out;
  }

  const AAR = 'https://raw.githubusercontent.com/awesome-android-root/awesome-android-root/main/docs/apps-and-modules/';
  const AAR_CATS = ['ad-blocking', 'app-modifications', 'audio', 'backup', 'customization', 'debloating', 'development',
    'file-management', 'gaming', 'networking', 'performance', 'privacy', 'root-management', 'security', 'system', 'utilities'];
  const LISTS = [
    { key: 'aar', name: 'Awesome Android Root', web: 'https://awesome-android-root.xyz/apps-and-modules/',
      parts: AAR_CATS.map(c => ({ cat: c.replace(/-/g, ' ').replace(/\b\w/g, x => x.toUpperCase()), url: AAR + c + '.md' })), parse: parseAwesome },
    { key: 'aksu', name: 'Awesome KernelSU', web: 'https://github.com/fynks/awesome-kernelsu',
      parts: [{ cat: '', url: 'https://raw.githubusercontent.com/fynks/awesome-kernelsu/main/README.md' }], parse: parseAwesome },
    { key: 'gist', name: 'Essential root modules', web: 'https://gist.github.com/supermarsx/26a1ace8dd4fa9bb88c482e28d51de35',
      parts: [{ cat: '', url: 'https://gist.githubusercontent.com/supermarsx/26a1ace8dd4fa9bb88c482e28d51de35/raw' }], parse: (md) => parseGist(md) }
  ];
  const CATALOGS = [
    { key: 'ksun', name: 'KernelSU Next modules', url: 'https://raw.githubusercontent.com/KernelSU-Next/KernelSU-Next-Modules-Repo/main/modules.json', web: 'https://github.com/KernelSU-Next/KernelSU-Next-Modules-Repo' },
    { key: 'mmar', name: 'Magisk Modules Alt Repo', url: 'https://raw.githubusercontent.com/Magisk-Modules-Alt-Repo/json/main/modules.json', web: 'https://github.com/Magisk-Modules-Alt-Repo' }
  ];

  const api = { ghRepo, slugId, parseProp, parseMmar, parseKsun, ghReleases, parseAwesome, parseGist, cleanText, LISTS, CATALOGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OrbitSources = api;
})(this);
