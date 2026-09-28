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
/** Build the standalone viewer and Windows archive; return packaged file pairs. */
function build() {
  let html = read('report.html');
  for (const [key, file] of [
    ['STYLE', 'style.css'],
    ['CORE', 'core.js'],
    ['RULES', 'rules.js'],
    ['DEMO', 'demo-data.js'],
    ['APP', 'app.js']
  ]) {
    html = html.replace('/*{{' + key + '}}*/', () => read(file));
  }
  if (Buffer.byteLength(html) > 500 * 1024) {
    throw new Error('报告超过 500 KB');
  }
  const launcher = crlf(
    read('launcher.cmd.tpl').replace(
      /\{\{ZH:([^}]+)\}\}/g,
      (_, message) =>
        '-join [char[]](' +
        Array.from(
          message,
          (character) =>
            '0x' + character.charCodeAt(0).toString(16).toUpperCase()
        ).join(',') +
        ')'
    )
  );
  if (/[^\x00-\x7f]/.test(launcher)) {
    throw new Error('启动器包含非 ASCII 字符');
  }
  const files = [
    ['一键扫描C盘.cmd', Buffer.from(launcher)],
    ['diskpilot-lite.ps1', bom(read('diskpilot-lite.ps1'))],
    ['看示例或导入CSV.html', Buffer.from(html)],
    ['使用说明.txt', bom(read('使用说明.txt'))]
  ];
  // 先清空 build/，避免旧文件名（例如改名前的文件）残留。
  fs.rmSync(path.join(root, 'build'), {
    recursive: true,
    force: true
  });
  fs.mkdirSync(path.join(root, 'build'), {
    recursive: true
  });
  fs.mkdirSync(path.join(root, 'dist'), {
    recursive: true
  });
  for (const [name, data] of files) {
    fs.writeFileSync(path.join(root, 'build', name), data);
  }
  const archive = zip(files);
  if (archive.length >= 1024 * 1024) {
    throw new Error('压缩包超过 1 MB');
  }
  fs.writeFileSync(
    path.join(root, 'dist', 'DiskPilot-Lite-0.2.0-win.zip'),
    archive
  );
  console.log(
    '构建完成：报告 ' +
      Buffer.byteLength(html) +
      ' 字节，压缩包 ' +
      archive.length +
      ' 字节，共 ' +
      files.length +
      ' 个文件。'
  );
  return files;
}
if (require.main === module) {
  build();
}
module.exports = {
  build,
  crc32
};
