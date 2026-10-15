const assert = require('assert');
const S = require('../module/webroot/sources.js');
let n = 0; const ok = (name, f) => { f(); n++; console.log('ok -', name); };

ok('github repo urls', () => {
  assert.deepStrictEqual(S.ghRepo('https://github.com/JingMatrix/NeoZygisk/'), { owner: 'JingMatrix', repo: 'NeoZygisk', full: 'jingmatrix/neozygisk' });
  assert.strictEqual(S.ghRepo('https://github.com/ZG089/Re-Malwack/blob/main/README.md').repo, 'Re-Malwack');
  assert.strictEqual(S.ghRepo('https://gitlab.com/a/b'), null);
  assert.strictEqual(S.ghRepo('https://github.com/orgs/x'), null);
});
ok('alt repo catalog', () => {
  const m = S.parseMmar({ modules: [
    { id: 'acc', stars: 13, last_update: 1697485290000, prop_url: 'https://raw.githubusercontent.com/Magisk-Modules-Alt-Repo/acc/master/module.prop', zip_url: 'https://github.com/Magisk-Modules-Alt-Repo/acc/archive/master.zip' },
    { id: '1_MARS', zip_url: 'https://github.com/Magisk-Modules-Alt-Repo/x/archive/14.zip' },
    { id: 'bad id', zip_url: 'https://x' }] });
  assert.strictEqual(m.length, 2);
  assert.strictEqual(m[0]._kind, 'mmar'); assert.strictEqual(m[0]._repo.full, 'magisk-modules-alt-repo/acc');
  assert.ok(m[0].updatedAt.startsWith('2023-'));
});
ok('ksu next list, matched to installed names', () => {
  const m = S.parseKsun([
    { name: 'Bindhosts', description: 'Systemless hosts', author: 'xx', repoUrl: 'https://github.com/bindhosts/bindhosts' },
    { name: 'NeoZygisk', repoUrl: 'https://github.com/JingMatrix/NeoZygisk/' },
    { name: 'Broken', repoUrl: 'not a url' }], [{ id: 'bindhosts', name: 'bindhosts' }]);
  assert.strictEqual(m.length, 2);
  assert.strictEqual(m[0].id, 'bindhosts');
  assert.strictEqual(m[1].id, 'gh.JingMatrix.NeoZygisk');
});
ok('github releases pick a zip and the digest', () => {
  const r = S.ghReleases([
    { tag_name: 'v2', name: 'v2.0', published_at: '2026-09-01T00:00:00Z', assets: [
      { name: 'mod-debug.zip', browser_download_url: 'https://github.com/a/b/releases/download/v2/mod-debug.zip' },
      { name: 'mod.zip', size: 10, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: 'https://github.com/a/b/releases/download/v2/mod.zip' }] },
    { tag_name: 'v1', assets: [{ name: 'app.apk', browser_download_url: 'https://x/app.apk' }] },
    { tag_name: 'v0', draft: true, assets: [] }]);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].asset, 'mod.zip'); assert.strictEqual(r[0].zip.sha256, 'a'.repeat(64));
});
ok('awesome list markdown', () => {
  const md = '---\ntitle: x\n---\n# Backup & Restore\n## Backup Apps & Tools\n' +
    '- **[⭐ Swift Backup](https://play.google.com/store/apps/details?id=org.swiftapps.swiftbackup)** - Modern backup solution. `Proprietary`\n' +
    '- **[DataBackup](https://github.com/XayahSuSuSu/Android-DataBackup)** - DataBackup for Android 7.0+. `FOSS` | [🌱](https://f-droid.org/x)\n' +
    '- [What is it?](#what)\n';
  const e = S.parseAwesome(md, 'Backup');
  assert.strictEqual(e.length, 2);
  assert.deepStrictEqual(e[0], { name: 'Swift Backup', url: 'https://play.google.com/store/apps/details?id=org.swiftapps.swiftbackup', desc: 'Modern backup solution.', cat: 'Backup Apps & Tools', sub: '', badges: ['Proprietary'] });
  assert.strictEqual(e[1].desc, 'DataBackup for Android 7.0+.'); assert.deepStrictEqual(e[1].badges, ['FOSS']);
});
ok('gist format', () => {
  const md = '## 🔑 Magisk / Zygisk Core Modules\n\n### 🧬 **ZygiskNext**\n\n🔗 [https://github.com/Dr-TSNG/ZygiskNext](https://github.com/Dr-TSNG/ZygiskNext)\n\n**Purpose:** Next‑gen Zygisk implementation.\n\n### 🧪 **PlayIntegrityFork**\n🔗 [x](https://github.com/osm0sis/PlayIntegrityFork)\n**What it does:** Fix verdicts.\n';
  const e = S.parseGist(md);
  assert.strictEqual(e.length, 2);
  assert.deepStrictEqual([e[0].name, e[0].url, e[0].desc, e[0].cat], ['ZygiskNext', 'https://github.com/Dr-TSNG/ZygiskNext', 'Next‑gen Zygisk implementation.', 'Magisk / Zygisk Core Modules']);
  assert.strictEqual(e[1].desc, 'Fix verdicts.');
});
ok('module.prop', () => {
  assert.deepStrictEqual(S.parseProp('id=acc\nname=ACC\nversionCode=202\r\nbad'), { id: 'acc', name: 'ACC', versionCode: '202' });
});
console.log(n + ' tests passed');
