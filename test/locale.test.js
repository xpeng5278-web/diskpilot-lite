'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { packageFiles } = require('../scripts/build');
const { english } = require('../scripts/localize');
const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const en = new Map(packageFiles('en'));
const cn = new Map(packageFiles('cn'));
function moduleValue(source) {
  const context = { module: { exports: {} } };
  vm.runInNewContext(source, context);
  return context.module.exports;
}
test('English package manifest, encodings, no CJK product source, and offline CSP', () => {
  assert.deepEqual([...en.keys()], ['Scan-C-Drive.cmd', 'diskpilot-lite.ps1', 'View-Sample-or-Import-CSV.html', 'README.txt']);
  for (const [name, bytes] of en) {
    assert.doesNotMatch(name, cjk);
    assert.doesNotMatch(bytes.toString(), cjk);
  }
  assert.ok([...en.get('Scan-C-Drive.cmd')].every(byte => byte < 128));
  for (const name of ['diskpilot-lite.ps1', 'README.txt']) {
    assert.equal(en.get(name).subarray(0, 3).toString('hex'), 'efbbbf');
    assert.doesNotMatch(en.get(name).toString(), /(?<!\r)\n/);
  }
  const html = en.get('View-Sample-or-Import-CSV.html').toString();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*["']https?:/);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  assert.throws(() => english("'遗漏翻译'"), /Untranslated/);
});
test('English rules preserve IDs, tiers and patterns, including Chinese apps', () => {
  const original = moduleValue(read('rules.js'));
  const translated = moduleValue(english(read('rules.js')));
  const structural = rules => JSON.stringify(rules.map(({id, tier, patterns}) => ({id, tier, patterns})));
  assert.equal(structural(original), structural(translated));
  assert.doesNotMatch(JSON.stringify(translated), cjk);
  for (const name of ['WeChat', 'WeCom', 'DingTalk', 'Feishu (Lark)', 'NetEase Cloud Music cache']) {
    assert.ok(translated.some(rule => rule.name === name));
  }
  assert.match(translated[0].where, /Settings > System > Storage > Temporary files/);
});
test('English parser outputs and errors have no CJK while Chinese CSV headers still parse', () => {
  const core = moduleValue(english(read('core.js')));
  const rules = moduleValue(english(read('rules.js')));
  const aggregator = core.createAggregator({rules});
  const parser = core.createCsvParser({onRow: aggregator.add});
  parser.push('文件名,大小,已分配\n"C:\\Users\\Alex\\Downloads\\",100,100\n');
  parser.end();
  assert.doesNotMatch(JSON.stringify(aggregator.result()), cjk);
  for (const value of [0, 100, 1024, 1048576, 1073741824]) assert.doesNotMatch(core.formatBytes(value), cjk);
  assert.throws(() => {
    const bad = core.createCsvParser({onRow() {}});
    bad.push('invalid'); bad.end();
  }, error => !cjk.test(error.message));
});
test('English scanner retains deletion, fallback and installation boundaries', () => {
  const ps = en.get('diskpilot-lite.ps1').toString();
  assert.equal((ps.match(/Remove-Item/g) || []).length, 1);
  assert.match(ps, /Remove-Item -LiteralPath \$CsvPath/);
  assert.doesNotMatch(ps, /-Recurse|Move-Item|Invoke-WebRequest/);
  for (const token of ['/admin=0', '/admin=1', '/exportfiles=0', '-Verb RunAs', '$HeartbeatSeconds = 30', '$TimeoutMinutes = 60', '$TimeoutMinutes = 20']) assert.ok(ps.includes(token));
  assert.ok(ps.indexOf('https://diskanalyzer.com/eula') < ps.indexOf('$answer = Read-Host'));
  assert.ok(ps.indexOf('Test-InstallConsent $answer') < ps.indexOf('& winget install'));
  assert.match(ps, /not bundled.*EULA forbids redistribution/);
  assert.equal((ps.match(/C-Drive-Report-/g) || []).length, 3);
});
const pwsh = process.env.PWSH || '/workspace/tools/pwsh/pwsh';
test('English PowerShell consent, console heartbeat and generated report', {skip: !fs.existsSync(pwsh)}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-en-'));
  for (const [name, bytes] of en) fs.writeFileSync(path.join(dir, name), bytes);
  fs.writeFileSync(path.join(dir, 'input.csv'), '\ufeff文件名,大小,已分配\n"C:\\Users\\Alex\\Downloads\\",20971520,20971520\n');
  const command = `
    . '${dir}/diskpilot-lite.ps1' -NoRun
    foreach ($answer in @('Y', 'y', ' Y ')) { if (-not (Test-InstallConsent $answer)) { throw 'consent rejected' } }
    foreach ($answer in @('', 'yes', '是', 'no', $null)) { if (Test-InstallConsent $answer) { throw 'unexpected consent' } }
    $csv = Convert-WizTreeCsvToEmbed -CsvPath '${dir}/input.csv'
    if (-not $csv.Contains('20971520')) { throw 'Chinese header alias was lost' }
    Show-InstallHelp
    Format-Elapsed ([TimeSpan]::FromSeconds(65))
    $p = Start-Process '${pwsh}' -ArgumentList '-NoProfile -Command Start-Sleep -Milliseconds 500' -PassThru
    $r = Wait-WizTreeExport -Process $p -CsvPath '${dir}/missing.csv' -SlowMode -HeartbeatSeconds 0 -PollSeconds 0.05 -MissingSeconds 0
    if ($r -ne 'missing') { throw 'unexpected wait result' }
    New-ReportHtml -TemplatePath '${dir}/View-Sample-or-Import-CSV.html' -OutPath '${dir}/C-Drive-Report-test.html' -CsvText 'File Name,Size,Allocated' -Meta @{source='real';drive='C:'}
  `;
  const result = spawnSync(pwsh, ['-NoProfile', '-Command', command], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, cjk);
  assert.match(result.stdout, /Slow mode may take more than 10 minutes/);
  assert.match(result.stdout, /program is responding/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'C-Drive-Report-test.html'), 'utf8'), cjk);
  fs.rmSync(dir, {recursive:true, force:true});
});
let chromium;
try { ({chromium} = require('playwright-core')); } catch { try { ({chromium} = require('/workspace/tools/node_modules/playwright-core')); } catch {} }
const browserPath = process.env.CHROME || '/usr/bin/google-chrome';
test('Bilingual browser: defaults, switch, persistence, import, save/reopen and zero network', {skip: !chromium || !fs.existsSync(browserPath)}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-locale-'));
  const enFile = path.join(dir, 'English.html');
  const cnFile = path.join(dir, 'Chinese.html');
  fs.writeFileSync(enFile, en.get('View-Sample-or-Import-CSV.html'));
  fs.writeFileSync(cnFile, cn.get('看示例或导入CSV.html'));
  const browser = await chromium.launch({executablePath: browserPath, headless:true, args:['--no-sandbox']});
  try {
    const context = await browser.newContext({acceptDownloads:true});
    const page = await context.newPage();
    const errors = [], network = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => {if (/^https?:/.test(r.url())) network.push(r.url());});
    await page.goto(pathToFileURL(enFile).href);
    const assertEnglish = async () => {
      const text = await page.locator('body').innerText();
      assert.doesNotMatch(text.replace('中文', ''), cjk);
      assert.equal(await page.locator('#language').innerText(), '中文');
      assert.doesNotMatch(await page.title(), cjk);
      const labels = await page.locator('[aria-label]').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')).join(' '));
      assert.doesNotMatch(labels, cjk);
    };
    await assertEnglish();
    for (const tier of ['medium','heavy','light']) {
      await page.locator('#tab-' + tier).click(); await assertEnglish();
    }
    await page.locator('.card input').first().check();
    await page.locator('#language').click();
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
    assert.equal(await page.locator('.card input').first().isChecked(), true);
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
    await page.locator('#language').click();
    await assertEnglish();
    await page.locator('#file').setInputFiles({name:'scan.csv', mimeType:'text/csv', buffer:Buffer.from('File Name,Size,Allocated\n"C:\\Users\\Alex\\Downloads\\",1073741824,1073741824\n')});
    await page.waitForFunction(() => document.querySelector('.source').textContent.includes('scan.csv'));
    await page.locator('#tab-heavy').click();
    await page.locator('.card input').check();
    await page.locator('#language').click();
    await page.locator('#language').click();
    await assertEnglish();
    assert.equal(await page.locator('.card input').isChecked(), true);
    assert.match(await page.locator('#selected').innerText(), /1.0 GB/);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#save').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^DiskPilot-Report-\d{4}-\d{2}-\d{2}\.html$/);
    const saved = path.join(dir, 'saved.html');
    await download.saveAs(saved);
    assert.doesNotMatch(fs.readFileSync(saved, 'utf8').replaceAll('中文', ''), cjk);
    await page.goto(pathToFileURL(saved).href);
    await assertEnglish();
    await page.locator('#tab-heavy').click();
    assert.equal(await page.locator('.card input').isChecked(), true);
    await page.locator('#file').setInputFiles({name:'bad.csv', mimeType:'text/csv', buffer:Buffer.from('bad')});
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Read failed'));
    await assertEnglish();
    await page.setViewportSize({width:390, height:844});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
    const fresh = await browser.newContext();
    const chinese = await fresh.newPage();
    await chinese.goto(pathToFileURL(cnFile).href);
    assert.equal(await chinese.locator('html').getAttribute('lang'), 'zh-CN');
    await chinese.locator('#language').click();
    assert.equal(await chinese.locator('html').getAttribute('lang'), 'en');
    assert.doesNotMatch((await chinese.locator('body').innerText()).replace('中文',''), cjk);
    // A blocked localStorage must not prevent offline viewing or switching.
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', {
      get() { throw new Error('Storage unavailable'); }
    }));
    const offline = await blocked.newPage();
    await offline.goto(pathToFileURL(enFile).href);
    assert.equal(await offline.locator('html').getAttribute('lang'), 'en');
    await offline.locator('#language').click();
    assert.equal(await offline.locator('html').getAttribute('lang'), 'zh-CN');
    await offline.reload();
    assert.equal(await offline.locator('html').getAttribute('lang'), 'en');
  } finally { await browser.close(); fs.rmSync(dir, {recursive:true,force:true}); }
});
