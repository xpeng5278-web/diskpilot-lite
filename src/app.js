(function () {
  'use strict';

  const core = DiskPilotCore;
  const app = document.getElementById('app');
  const escapeHtml = (text) =>
    String(text).replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[character]
    );
  const readEmbeddedJson = (id) =>
    JSON.parse(document.getElementById(id).textContent.replace(/<\\\//g, '</'));
  let result;
  let meta;
  let selected = new Set();
  let tier = 'light';
  let saved = false;
  let busy = false;
  const suggestionAnchors = (suggestion) =>
    suggestion.allAnchors || suggestion.anchors;
  const unionAmount = (items) =>
    core.unionBytes(items.flatMap(suggestionAnchors));
  const gigabytes = (bytes) => (bytes / 1073741824).toFixed(1);
  function parseCsv(text) {
    const aggregator = core.createAggregator({
      rules: DiskPilotRules
    });
    const parser = core.createCsvParser({
      onRow: aggregator.add
    });
    parser.push(text);
    parser.end();
    return aggregator.result();
  }
  function sourceDescription() {
    const description =
      meta.source === 'real'
        ? '真实扫描 · ' +
          (meta.drive || 'C:') +
          ' · ' +
          String(meta.scannedAt || '')
            .slice(0, 16)
            .replace('T', ' ')
        : meta.source === 'import'
          ? '你导入的 CSV（' + meta.filename + '）'
          : '示例数据（不是你的电脑）';
    return '数据来源：' + description + (saved ? ' · 已保存的报告' : '');
  }
  function updateCounts() {
    document.getElementById('selected').textContent = selected.size
      ? '你已勾选：约 ' +
        gigabytes(
          unionAmount(
            result.suggestions.filter((suggestion) =>
              selected.has(suggestion.id)
            )
          )
        ) +
        ' GB'
      : '你还没有勾选任何建议';
    for (const tierName of ['light', 'medium', 'heavy']) {
      const tierSelected = result.suggestions.filter(
        (suggestion) =>
          suggestion.tier === tierName && selected.has(suggestion.id)
      );
      // 这一档还没勾选时显示「0 GB」，避免出现「0 字节」这种让人困惑的写法。
      document.getElementById('count-' + tierName).textContent = tierSelected.length === 0
        ? '0 GB'
        : core.formatBytes(
          unionAmount(
            tierSelected
          )
        );
    }
  }
  function sourceHtml() {
    const demoNotice =
      meta.source === 'demo'
        ? '<p class="demo">这不是你的电脑。要获得真实报告，请双击「一键扫描C盘.cmd」，或在下方导入 WizTree CSV。</p>'
        : '';
    return `<p class="source">${escapeHtml(sourceDescription())}</p>${demoNotice}`;
  }

  function summaryHtml() {
    const diskSpace = Number.isFinite(meta.totalBytes)
      ? `<p>C 盘总空间：${core.formatBytes(meta.totalBytes)}；剩余：${core.formatBytes(meta.freeBytes)}</p>`
      : '';
    return `
      <section>
        <h1>这些建议最多涉及约 ${gigabytes(result.maxBytes)} GB，实际能腾出多少，要看你最后清了哪些
          <span class="help">
            <button aria-label="查看去重说明" aria-expanded="false">?</button>
            <span class="tooltip" role="tooltip">同一个文件夹只算一次，不会重复加总</span>
          </span>
        </h1>
        <p id="selected"></p>
        ${diskSpace}
        <small>建议大小是涉及目录的占用上限，不代表其中全部内容都可以清理。勾选仅用于计划。</small>
      </section>`;
  }

  function tierTabHtml([tierName, label]) {
    const suggestions = result.suggestions.filter(
      (suggestion) => suggestion.tier === tierName
    );
    return `
      <button id="tab-${tierName}" role="tab" aria-controls="suggestions"
        aria-selected="${tierName === tier}" data-tier="${tierName}">
        ${label}<br>
        <small>已勾选 <span id="count-${tierName}"></span> / 共 ${core.formatBytes(unionAmount(suggestions))}</small>
      </button>`;
  }

  function suggestionsHtml() {
    const tiers = [
      ['light', '轻度（放心清）'],
      ['medium', '中度（在软件里清）'],
      ['heavy', '重度（先看再清）']
    ];
    return `
      <h2>按风险查看建议</h2>
      <div class="tabs" role="tablist" aria-label="建议档位">${tiers.map(tierTabHtml).join('')}</div>
      <div id="suggestions" role="tabpanel"></div>`;
  }

  function categoryHtml(category) {
    const percentage = Math.min(
      100,
      result.totalBytes ? (category.bytes / result.totalBytes) * 100 : 0
    );
    return `
      <div class="category">
        <div class="category-title">
          <span>${escapeHtml(category.label)}</span><span>${core.formatBytes(category.bytes)}</span>
        </div>
        <div class="bar"><span style="width:${percentage}%"></span></div>
      </div>`;
  }

  function categoriesHtml() {
    return `
      <section>
        <h2>分类概览</h2>
        <p>Windows、Program Files、WinSxS 等系统文件不要手动删。</p>
        ${result.categories.map(categoryHtml).join('')}
      </section>`;
  }

  function importHtml() {
    return `
      <section>
        <h2>用自己导出的 CSV 生成报告</h2>
        <ol>
          <li>打开 WizTree，左上角选「C:」，点「扫描」(Scan)。</li>
          <li>扫描完按 Ctrl+Alt+E，或在左侧树里右键 C: → “Export to CSV file...” （中文界面类似「导出到 CSV 文件」）。</li>
          <li>保存到 D 盘或 U 盘（不要存 C 盘），然后把文件拖进来或点「选择 CSV 文件」。</li>
        </ol>
        <div class="drop" id="drop">
          <p class="drop-hint">把 CSV 文件拖到这里，或者</p>
          <label class="file-button" for="file">选择 CSV 文件</label>
          <input id="file" class="visually-hidden" type="file" accept=".csv,.tsv,text/csv">
        </div>
        <progress id="progress" max="100" value="0" hidden></progress>
        <p id="status" role="status" aria-live="polite"></p>
      </section>`;
  }

  function suggestionHtml(suggestion) {
    const paths = suggestion.anchors
      .slice(0, 3)
      .map((anchor) => `<li>${escapeHtml(anchor.path)}</li>`)
      .join('');
    const additionalPaths =
      suggestion.anchorCount > 3
        ? `<p>等 ${suggestion.anchorCount} 处</p>`
        : '';
    const settingsLink = suggestion.where.includes('设置 > 系统 > 存储')
      ? '<p><a href="ms-settings:storagesense">打开 Windows 设置（存储）</a></p>'
      : '';
    return `
      <article class="card">
        <div class="card-head">
          <input type="checkbox" aria-label="勾选${escapeHtml(suggestion.name)}"
            data-id="${escapeHtml(suggestion.id)}" ${selected.has(suggestion.id) ? 'checked' : ''}>
          <div><h3>${escapeHtml(suggestion.name)}</h3><span class="size">${core.formatBytes(suggestion.bytes)}</span></div>
        </div>
        <ul class="paths">${paths}</ul>
        ${additionalPaths}
        <p><strong>去哪里清：</strong>${escapeHtml(suggestion.where)}</p>
        ${settingsLink}
        <p class="risk">${escapeHtml(suggestion.risk)}</p>
      </article>`;
  }

  function render() {
    app.innerHTML = [
      sourceHtml(),
      summaryHtml(),
      suggestionsHtml(),
      categoriesHtml(),
      importHtml()
    ].join('');
    document.querySelectorAll('[data-tier]').forEach(
      (button) =>
        (button.onclick = () => {
          tier = button.dataset.tier;
          document
            .querySelectorAll('[data-tier]')
            .forEach((element) =>
              element.setAttribute('aria-selected', element === button)
            );
          renderItems();
        })
    );
    const help = document.querySelector('.help');
    help.querySelector('button').onclick = () => {
      help.classList.toggle('open');
      help
        .querySelector('button')
        .setAttribute('aria-expanded', help.classList.contains('open'));
    };
    document.getElementById('file').onchange = (event) => {
      if (event.target.files[0]) {
        importFile(event.target.files[0]);
      }
    };
    const drop = document.getElementById('drop');
    drop.ondragover = (event) => {
      event.preventDefault();
      drop.classList.add('over');
    };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (event) => {
      event.preventDefault();
      drop.classList.remove('over');
      if (event.dataTransfer.files[0]) {
        importFile(event.dataTransfer.files[0]);
      }
    };
    renderItems();
    updateCounts();
  }
  function renderItems() {
    const list = result.suggestions.filter(
      (suggestion) => suggestion.tier === tier
    );
    const panel = document.getElementById('suggestions');
    panel.setAttribute('aria-labelledby', 'tab-' + tier);
    panel.innerHTML = list.length
      ? list.map(suggestionHtml).join('')
      : '<section>这一档暂无可勾建议</section>';
    panel.querySelectorAll('input').forEach(
      (element) =>
        (element.onchange = () => {
          if (element.checked) {
            selected.add(element.dataset.id);
          } else {
            selected.delete(element.dataset.id);
          }
          updateCounts();
        })
    );
  }
  async function importFile(file) {
    if (busy) {
      return;
    }
    busy = true;
    document.getElementById('save').disabled = true;
    document.getElementById('file').disabled = true;
    const status = document.getElementById('status');
    const progress = document.getElementById('progress');
    progress.hidden = false;
    try {
      const chunkSize = 4 * 1024 * 1024;
      const first = new Uint8Array(
        await file.slice(0, chunkSize).arrayBuffer()
      );
      const decoder = new TextDecoder(core.decodeHelpers.sniffEncoding(first), {
        fatal: true
      });
      const aggregator = core.createAggregator({
        rules: DiskPilotRules
      });
      const parser = core.createCsvParser({
        onRow: aggregator.add
      });
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        const bytes =
          offset === 0
            ? first
            : new Uint8Array(
                await file.slice(offset, offset + chunkSize).arrayBuffer()
              );
        parser.push(
          decoder.decode(bytes, {
            stream: true
          })
        );
        const percentage = Math.round(
          (Math.min(file.size, offset + bytes.length) / file.size) * 100
        );
        progress.value = percentage;
        status.textContent =
          '正在本机读取「' + file.name + '」，不会上传… ' + percentage + '%';
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      parser.push(decoder.decode());
      parser.end();
      const nextResult = aggregator.result();
      if (!nextResult.rowCount || nextResult.skipped === nextResult.rowCount) {
        throw new Error('没有可读取的文件或文件夹行');
      }
      result = nextResult;
      meta = {
        source: 'import',
        filename: file.name
      };
      saved = false;
      selected = new Set();
      render();
      document.getElementById('status').textContent =
        '已选择文件「' + file.name + '」，已在本机生成报告。';
    } catch (error) {
      status.textContent =
        '读取失败：' + error.message + '。请确认选择的是 WizTree 导出的 CSV。';
    } finally {
      busy = false;
      document.getElementById('save').disabled = false;
      document.getElementById('file').disabled = false;
    }
  }
  function resultForSave() {
    // Older saved reports may contain uncapped lists. Union uses the retained anchors.
    const suggestions = result.suggestions.map((suggestion) => {
      const allAnchors = [...suggestionAnchors(suggestion)]
        .sort((left, right) => right.bytes - left.bytes)
        .slice(0, 300);
      return {
        ...suggestion,
        allAnchors,
        anchors: allAnchors.slice(0, 50),
        bytes: core.unionBytes(allAnchors)
      };
    });
    return { ...result, suggestions, maxBytes: unionAmount(suggestions) };
  }

  /** 本地日期 YYYY-MM-DD（不用 toISOString，避免时区把日期算错）。 */
  function localDateText(date) {
    return (
      date.getFullYear() +
      '-' +
      String(date.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(date.getDate()).padStart(2, '0')
    );
  }

  /**
   * 「保存这份报告」：生成一份独立 HTML（同一套代码 + 当前聚合结果与勾选状态），
   * 通过浏览器下载保存，文件名 DiskPilot报告-YYYY-MM-DD.html。
   */
  function save() {
    const name = 'DiskPilot报告-' + localDateText(new Date()) + '.html';
    const saveStatus = document.getElementById('save-status');
    try {
      const documentCopy = document.documentElement.cloneNode(true);
      documentCopy.querySelector('#app').innerHTML = '';
      documentCopy.querySelector('#save').disabled = false;
      documentCopy.querySelector('#save-status').textContent = '';
      documentCopy.querySelector('#dp-embedded-csv').textContent = '';
      documentCopy.querySelector('#dp-embedded-meta').textContent = 'null';
      documentCopy.querySelector('#dp-embedded-result').textContent =
        JSON.stringify({
          result: resultForSave(),
          meta,
          selected: [...selected],
          saved: true
        }).replace(/</g, '\\u003c');
      const html = '<!doctype html>\n' + documentCopy.outerHTML;
      const url = URL.createObjectURL(
        new Blob([html], {
          type: 'text/html;charset=utf-8'
        })
      );
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = name;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      saveStatus.textContent =
        '已保存到浏览器的「下载」文件夹，文件名是 ' +
        name +
        '，按 Ctrl+J 可以直接打开下载记录';
    } catch (error) {
      saveStatus.textContent = '保存失败：' + error.message;
    }
  }
  document.getElementById('save').onclick = save;
  try {
    const embeddedMeta = readEmbeddedJson('dp-embedded-meta');
    const csv = document
      .getElementById('dp-embedded-csv')
      .textContent.replace(/<\\\//g, '</');
    const snapshot = readEmbeddedJson('dp-embedded-result');
    if (embeddedMeta && csv) {
      meta = embeddedMeta;
      result = parseCsv(csv);
    } else if (snapshot) {
      ({ result, meta } = snapshot);
      selected = new Set(snapshot.selected);
      saved = true;
    } else {
      meta = {
        source: 'demo'
      };
      result = parseCsv(DiskPilotDemo);
    }
    if (!saved) {
      selected = new Set();
    }
    render();
  } catch (error) {
    app.textContent = '报告读取失败：' + error.message + '。请重新生成报告。';
  }
})();
