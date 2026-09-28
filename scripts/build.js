'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const read = (name) =>
  fs.readFileSync(path.join(root, 'src', name), 'utf8').replace(/^\ufeff/, '');
const crlf = (text) => text.replace(/\r?\n/g, '\r\n');
const bom = (text) => Buffer.from('\ufeff' + crlf(text), 'utf8');
/** Compute the unsigned CRC-32 checksum required by ZIP entries. */
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;
  for (const [name, data] of files) {
    const filename = Buffer.from(name);
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    // ZIP local headers use UTF-8 names (bit 11), deflate (8), and a fixed DOS date.
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(33, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(filename.length, 26);
    localRecords.push(localHeader, filename, compressed);
    // Central directory entries point back to each local header's byte offset.
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE(offset, 42);
    centralRecords.push(entry, filename);
    offset += localHeader.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(centralRecords);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(directory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  return Buffer.concat([...localRecords, directory, endRecord]);
}
/** Build both language packages from the same scanner and report sources. */
function packageFiles(language) {
  const { english, unicode } = require('./localize');
  const modules = ['core.js', 'rules.js', 'demo-data.js', 'app.js'];
  const cn = modules.map(name => {
    const source = read(name);
    return language === 'en' && name === 'app.js'
      ? source.replaceAll('一键扫描C盘.cmd', 'Scan-C-Drive.cmd') : source;
  }).join('\n');
  const en = modules.map(name => english(read(name))).join('\n');
  let runtime = read('locale.js')
    .replace('/*{{EN_MODULES}}*/', () => en)
    .replace('/*{{CN_MODULES}}*/', () => cn);
  let html = language === 'en' ? english(read('report.html'), 'html').replace('lang="zh-CN"', 'lang="en"') : read('report.html');
  html = html.replace('/*{{STYLE}}*/', () => read('style.css').replace(/\/\*[\s\S]*?\*\//g, ''));
  for (const key of ['CORE', 'RULES', 'DEMO']) html = html.replace('/*{{' + key + '}}*/', '');
  html = html.replace('/*{{APP}}*/', () => unicode(runtime));
  if (Buffer.byteLength(html) > 500 * 1024) throw new Error('Report exceeds 500 KB');
  let launcher = read('launcher.cmd.tpl');
  if (language === 'en') {
    launcher = english(launcher, 'cmd')
      .replace('Qing xian jie ya. ', '')
      .replace('Zhao bu dao PowerShell. ', '')
      .replace('Qing zai Windows zhong yun xing, an ren yi jian guan bi.', 'Run this tool on Windows. Press any key to close.');
  }
  launcher = crlf(launcher.replace(/\{\{ZH:([^}]+)\}\}/g, (_, message) =>
    '-join [char[]](' + Array.from(message, c => '0x' + c.charCodeAt(0).toString(16).toUpperCase()).join(',') + ')'));
  if (/[^\x00-\x7f]/.test(launcher)) throw new Error('Launcher must be ASCII');
  return [
    [language === 'en' ? 'Scan-C-Drive.cmd' : '一键扫描C盘.cmd', Buffer.from(launcher)],
    ['diskpilot-lite.ps1', bom(language === 'en' ? english(read('diskpilot-lite.ps1'), 'ps') : read('diskpilot-lite.ps1'))],
    [language === 'en' ? 'View-Sample-or-Import-CSV.html' : '看示例或导入CSV.html', Buffer.from(html)],
    [language === 'en' ? 'README.txt' : '使用说明.txt', bom(read(language === 'en' ? 'README.txt' : '使用说明.txt'))]
  ];
}
function build() {
  fs.rmSync(path.join(root, 'build'), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  let chinese;
  for (const language of ['cn', 'en']) {
    const files = packageFiles(language);
    const directory = path.join(root, 'build', language);
    fs.mkdirSync(directory, { recursive: true });
    for (const [name, data] of files) fs.writeFileSync(path.join(directory, name), data);
    const archive = zip(files);
    if (archive.length >= 1024 * 1024) throw new Error('Archive exceeds 1 MB');
    const name = `DiskPilot-Lite-0.3.0-${language}-win.zip`;
    fs.writeFileSync(path.join(root, 'dist', name), archive);
    console.log(`${name}: ${archive.length} bytes, ${files.length} files`);
    if (language === 'cn') chinese = files;
  }
  return chinese;
}
if (require.main === module) build();
module.exports = { build, packageFiles, crc32 };
