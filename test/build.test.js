'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const vm = require('node:vm');
const { build, crc32 } = require('../scripts/build');
const root = path.resolve(__dirname, '..');
const files = new Map(build());
test('压缩包五个 UTF-8 文件、大小限制、校验与解压内容', () => {
  const zip = fs.readFileSync(
    path.join(root, 'dist/DiskPilot-Lite-0.2.0-win.zip')
  );
  assert.ok(zip.length < 1048576);
  let offset = 0;
  const names = [];
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(zip.readUInt16LE(offset + 6), 0x0800);
    const size = zip.readUInt32LE(offset + 18);
    const length = zip.readUInt16LE(offset + 26);
    const extra = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + length).toString();
    const start = offset + 30 + length + extra;
    const data = zlib.inflateRawSync(zip.subarray(start, start + size));
    assert.deepEqual(data, files.get(name));
    assert.equal(crc32(data), zip.readUInt32LE(offset + 14));
    names.push(name);
    offset = start + size;
  }
  assert.deepEqual(names, [
    '一键扫描C盘.cmd',
    'DiskPilot-Scan-C.cmd',
    'diskpilot-lite.ps1',
    'DiskPilot报告.html',
    '使用说明.txt'
  ]);
  assert.equal(zip.readUInt32LE(offset), 0x02014b50);
});
test('单文件报告 CSP、无外部资源、内联脚本可解析', () => {
  const html = files.get('DiskPilot报告.html').toString();
  assert.ok(Buffer.byteLength(html) <= 500 * 1024);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*["']https?:\/\//i);
  assert.doesNotMatch(html, /\{\{(?:CORE|APP|STYLE|RULES|DEMO)\}\}/);
  for (const scriptMatch of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    new vm.Script(scriptMatch[1]);
  }
  assert.match(html, /id="dp-embedded-result">null/);
});
test('启动器 ASCII、CRLF、路径引号及异常暂停', () => {
  const bytes = files.get('一键扫描C盘.cmd');
  const launcher = bytes.toString();
  assert.deepEqual(bytes, files.get('DiskPilot-Scan-C.cmd'));
  assert.ok([...bytes].every((byte) => byte < 128));
  assert.doesNotMatch(launcher, /(?<!\r)\n/);
  assert.match(launcher, /chcp 65001 >nul/);
  assert.match(
    launcher,
    /-ExecutionPolicy Bypass -File "%~dp0diskpilot-lite.ps1"/
  );
  assert.doesNotMatch(launcher, /EnableDelayedExpansion/i);
  for (const line of launcher
    .split('\r\n')
    .filter((lineValue) => lineValue.includes('%~dp0'))) {
    assert.match(line, /"%~dp0[^"\r\n]*"/);
  }
  for (const label of ['unpack', 'missing', 'failed']) {
    const block = launcher.split(':' + label + '\r\n')[1].split(/\r\n:\w/)[0];
    assert.match(block, /pause\r\nexit/);
  }
  assert.match(
    launcher,
    /-File[^\r\n]+\r\nif errorlevel 1 goto failed\r\nexit \/b 0/
  );
  assert.match(launcher, /\[char\[\]\]/);
});
test('PowerShell 与说明 BOM、CRLF、5.1 语法、安全删除约束', () => {
  for (const name of ['diskpilot-lite.ps1', '使用说明.txt']) {
    const data = files.get(name);
    assert.deepEqual(data.subarray(0, 3), Buffer.from([239, 187, 191]));
    assert.doesNotMatch(data.toString(), /(?<!\r)\n/);
  }
  const powershell = files.get('diskpilot-lite.ps1').toString();
  assert.doesNotMatch(
    powershell,
    /\?\?|\?\.|&&|\|\||\s\?\s[^\r\n]+\s:\s|-Parallel\b/
  );
  assert.match(
    powershell,
    /winget install --id AntibodySoftware.WizTree -e --source winget --accept-package-agreements --accept-source-agreements --silent/
  );
  for (const text of ['/exportfiles=0', '/admin=1', '-Verb RunAs']) {
    assert.ok(powershell.includes(text));
  }
  assert.equal((powershell.match(/Remove-Item/gi) || []).length, 1);
  assert.match(powershell, /Remove-Item -LiteralPath \$csvPath/);
  assert.doesNotMatch(
    powershell,
    /-Recurse|Move-Item|Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer/
  );
  assert.match(powershell, /param\(\[switch\]\$NoRun\)/);  // 许可说明必须在询问 Y 之前打印。
  const eulaAt = powershell.indexOf(
    '安装即表示你同意 WizTree 的许可协议（个人免费），协议原文见：https://diskanalyzer.com/eula'
  );
  const askAt = powershell.indexOf("Read-Host '输入 Y 并回车 = 安装；直接回车 = 不安装'");
  const installAt = powershell.indexOf('& winget install');
  assert.ok(eulaAt > 0 && eulaAt < askAt && askAt < installAt);
});
