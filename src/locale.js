// Package language is the fallback when storage is unavailable or has no choice.
window.DiskPilotLocale = {
  language: 'cn',
  run(language) {
    this.language = language;
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    const text = language === 'en'
      ? ['DiskPilot Lite · C: cleanup suggestions', 'Suggestions only; no deletion',
        'Everything stays local: no network, no uploads, no file deletion', 'Save this report', '\u4e2d\u6587']
      : ['DiskPilot Lite · C 盘清理建议', '仅建议、不删除',
        '全部在本机完成：不联网、不上传、不删除任何文件', '保存这份报告', 'English'];
    document.title = text[0];
    document.querySelector('header strong').textContent = text[0];
    document.querySelector('header .badge').textContent = text[1];
    document.querySelector('header p').textContent = text[2];
    document.getElementById('save').textContent = text[3];
    document.getElementById('language').textContent = text[4];
    document.getElementById('save-status').textContent = '';
    if (language === 'en') {
      /*{{EN_MODULES}}*/
    } else {
      /*{{CN_MODULES}}*/
    }
  }
};
let initialLanguage = document.documentElement.lang === 'en' ? 'en' : 'cn';
try {
  const remembered = localStorage.getItem('diskpilot-language');
  if (remembered === 'en' || remembered === 'cn') initialLanguage = remembered;
} catch {}
window.DiskPilotLocale.run(initialLanguage);
