(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DiskPilotRules = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const rules = [];
  const storage = '打开 设置 > 系统 > 存储 > 临时文件';
  const personal =
    '右键该文件夹 > 属性 > 位置 > 移动，选 D 盘上的新文件夹（系统会帮你搬过去）；或逐个查看，把确定不要的文件删掉';
  const addRule = (id, tier, name, paths, where, risk) =>
    rules.push({
      id,
      tier,
      name,
      patterns: paths.map((path) => path.toLowerCase().split('\\')),
      where,
      risk
    });
  const local = 'users\\*\\appdata\\local\\';
  const roaming = 'users\\*\\appdata\\roaming\\';
  const documents = 'users\\*\\documents\\';
  addRule(
    'windows-temp',
    'light',
    'Windows 临时文件',
    ['windows\\temp'],
    storage,
    '先关闭正在使用的软件，仅勾选你确认的临时文件。'
  );
  addRule(
    'user-temp',
    'light',
    '你的临时文件',
    [local + 'temp'],
    storage,
    '正在使用的临时文件可跳过，不要强行处理。'
  );
  addRule(
    'recycle',
    'light',
    '回收站',
    ['$recycle.bin'],
    storage + ' > 回收站',
    '先打开回收站确认没有需要恢复的文件。'
  );
  addRule(
    'updates',
    'light',
    'Windows 更新缓存',
    ['windows\\softwaredistribution\\download'],
    storage + ' > Windows 更新清理',
    '使用系统清理，不要手动删除系统目录。'
  );
  addRule(
    'delivery',
    'light',
    '传递优化缓存',
    [
      'windows\\serviceprofiles\\networkservice\\appdata\\local\\microsoft\\windows\\deliveryoptimization'
    ],
    storage + ' > 传递优化文件',
    '让 Windows 处理，可能会重新下载缓存。'
  );
  for (const [id, name, base] of [
    ['edge', 'Edge', 'microsoft\\edge'],
    ['chrome', 'Chrome', 'google\\chrome']
  ]) {
    addRule(
      id,
      'light',
      name + ' 浏览器缓存',
      [
        local + base + '\\user data\\*\\cache',
        local + base + '\\user data\\*\\code cache'
      ],
      name +
        ' 右上角「…」> 设置 > 隐私和安全 > 清除浏览数据 > 缓存的图片和文件',
      '只选缓存；不要误选密码、Cookie 或浏览记录。'
    );
  }
  addRule(
    'thumbnails',
    'light',
    '缩略图缓存',
    [local + 'microsoft\\windows\\explorer'],
    storage + ' > 缩略图',
    '目录占用只是上限，不是整个目录都可清；缩略图会重新生成。'
  );
  addRule(
    'crashes',
    'light',
    '错误报告与崩溃转储',
    ['programdata\\microsoft\\windows\\wer', local + 'crashdumps'],
    storage + ' > 系统错误内存转储文件 / Windows 错误报告',
    '如果正在排查软件故障，请先保留错误报告。'
  );
  addRule(
    'wechat',
    'medium',
    '微信',
    [
      documents + 'wechat files',
      documents + 'xwechat_files',
      roaming + 'tencent\\wechat'
    ],
    '微信 左下角「≡」> 设置 > 存储空间 / 文件管理 > 清理；或把保存位置改到 D 盘',
    '聊天文件可能无法再次下载，先备份重要资料。'
  );
  addRule(
    'qq',
    'medium',
    'QQ',
    [documents + 'tencent files'],
    'QQ 左下角菜单 > 设置 > 文件管理 > 清理；在文件保存位置中选择 D 盘',
    '先保存重要聊天图片、视频和接收文件。'
  );
  addRule(
    'wxwork',
    'medium',
    '企业微信',
    [documents + 'wxwork'],
    '企业微信 左下角菜单 > 设置 > 文档 / 文件管理 > 清理缓存',
    '工作资料先备份，菜单名称可能因版本略有不同。'
  );
  addRule(
    'dingtalk',
    'medium',
    '钉钉',
    [roaming + 'dingtalk'],
    '钉钉 头像 > 设置 > 存储空间 / 缓存管理 > 清理',
    '先保存离线文件和重要工作资料。'
  );
  addRule(
    'lark',
    'medium',
    '飞书',
    [roaming + 'larkshell'],
    '飞书 头像 > 设置 > 通用 > 存储空间 > 清理缓存',
    '先确认重要文件已备份或仍可从云端下载。'
  );
  addRule(
    'music-cache',
    'medium',
    '网易云音乐缓存',
    [local + 'netease\\cloudmusic\\cache'],
    '网易云音乐 设置 > 下载设置 > 缓存设置 > 清除缓存',
    '离线播放可能需要重新加载。'
  );
  addRule(
    'old-windows',
    'medium',
    '以前的 Windows 安装',
    ['windows.old'],
    storage + ' > 以前的 Windows 安装',
    '清掉后不能回退系统，请确认新系统使用正常。'
  );
  addRule(
    'dev-cache',
    'medium',
    '开发缓存',
    [
      'users\\*\\.npm',
      'users\\*\\.gradle',
      'users\\*\\.m2',
      'users\\*\\.nuget\\packages',
      local + 'pip\\cache',
      local + 'yarn\\cache',
      local + 'pnpm'
    ],
    '先确认项目可以重新下载依赖；在对应开发工具的缓存设置中清理，不认识这些目录就保留',
    '可能需要重新联网下载依赖；离线开发或自定义包应先备份。'
  );
  addRule(
    'dependencies',
    'medium',
    '项目依赖',
    ['**\\node_modules'],
    '先确认项目有依赖清单和锁文件、可以重新安装；不确定时请让项目维护者处理',
    '项目可能暂时无法运行，不能当成普通垃圾直接清理。'
  );
  for (const [id, name] of [
    ['downloads', '下载'],
    ['desktop', '桌面'],
    ['documents', '文档'],
    ['pictures', '图片'],
    ['videos', '视频'],
    ['music', '音乐']
  ]) {
    addRule(
      id,
      'heavy',
      name,
      ['users\\*\\' + id],
      personal,
      '这里可能都是你的重要文件，请逐个查看并先备份。'
    );
  }
  addRule(
    'apple-backup',
    'heavy',
    'iPhone / iPad 备份',
    [
      roaming + 'apple computer\\mobilesync\\backup',
      'users\\*\\apple\\mobilesync\\backup'
    ],
    'iTunes 编辑 > 偏好设置 > 设备，或 Apple 设备 > 通用 > 管理备份，核对日期和设备后处理',
    '删除备份后无法用它恢复设备，请保留至少一份可用备份。'
  );
  return rules;
});
