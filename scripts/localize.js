'use strict';
const translations = require('../src/locales/en.json');
const cjk = /[\p{Script=Han}]/u;
const aliases = ['文件名称', '文件名', '大小', '已分配', '分配'];
const unicode = text => text.replace(/[\u3400-\u9fff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
/** Translate only reviewed source phrases; reject any untranslated product copy.
 * CSV header aliases remain accepted in both languages, never displayed.
 */
function english(source, kind = 'js') {
  if (kind === 'ps') {
    source = source.replace(/ -or \$text -ceq '是'/, '');
    source = source.replace(/^\s*#.*$/gm, '');
  } else if (kind === 'js') {
    source = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }
  for (const alias of aliases) {
    const encoded = kind === 'ps'
      ? '(-join [char[]](' + [...alias].map(c => c.charCodeAt(0)).join(',') + '))'
      : "'" + unicode(alias) + "'";
    source = source.replaceAll("'" + alias + "'", encoded);
  }
  const entries = Object.entries(translations).sort((a, b) => b[0].length - a[0].length);
  // One pass prevents shorter keys from modifying translated phrases.
  const pattern = new RegExp(entries.map(([key]) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  source = source.replace(pattern, match => translations[match]);
  if (cjk.test(source)) throw new Error('Untranslated copy: ' + source.split('\n').filter(line => cjk.test(line)).join('\n'));
  return source;
}
module.exports = { english, unicode };
