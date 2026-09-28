(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DiskPilotCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Create a streaming CSV parser that emits normalized WizTree rows.
   * @param {{onRow: function(Object): void}} options Row callback.
   * @returns {{push: function(string): void, end: function(): void}} Streaming parser.
   */
  function createCsvParser({ onRow }) {
    let fields = [];
    let field = '';
    let quoted = false;
    let pendingQuote = false;
    let afterCarriageReturn = false;
    let first = true;
    let columns;
    let preamble = 0;
    function emitRow() {
      fields.push(field);
      field = '';
      const values = fields;
      fields = [];
      if (values.every((value) => !value.trim())) {
        return;
      }
      if (!columns) {
        const names = values.map((value) => value.trim().toLowerCase());
        const find = (aliases) =>
          names.findIndex((value) => aliases.includes(value));
        const candidate = [
          find(['file name', '文件名', '文件名称']),
          find(['size', '大小']),
          find(['allocated', '分配', '已分配'])
        ];
        if (candidate.every((index) => index >= 0)) {
          columns = candidate;
        } else if (++preamble > 5) {
          throw new Error('未找到有效的 WizTree 表头，请重新导出 CSV');
        }
        return;
      }
      const path = values[columns[0]];
      const rawAllocated = (values[columns[2]] || '').trim();
      const size = Number(values[columns[1]]);
      const isDir = !!path && path.endsWith('\\');
      const allocated =
        !isDir && /^0\d/.test(rawAllocated)
          ? 0
          : rawAllocated === ''
            ? size
            : Number(rawAllocated);
      onRow({
        path,
        isDir,
        size,
        allocated
      });
    }
    function consumeUnquotedCharacter(character) {
      if (character === '"' && field === '') {
        quoted = true;
      } else if (character === ',' || character === '\t') {
        fields.push(field);
        field = '';
      } else if (character === '\r' || character === '\n') {
        emitRow();
        afterCarriageReturn = character === '\r';
      } else {
        field += character;
      }
    }
    return {
      /** Consume a text chunk, preserving quoted fields across chunk boundaries. */
      push(text) {
        for (let index = 0; index < text.length; index++) {
          const character = text[index];
          if (first) {
            first = false;
            if (character === '\ufeff') {
              continue;
            }
          }
          if (afterCarriageReturn) {
            afterCarriageReturn = false;
            if (character === '\n') {
              continue;
            }
          }
          if (pendingQuote) {
            pendingQuote = false;
            if (character === '"') {
              field += '"';
              continue;
            }
            quoted = false;
            consumeUnquotedCharacter(character);
            continue;
          }
          if (quoted) {
            if (character === '"') {
              pendingQuote = true;
            } else {
              field += character;
            }
          } else {
            consumeUnquotedCharacter(character);
          }
        }
      },
      /** Finish the final row and validate the CSV header and quotes. */
      end() {
        if (quoted && !pendingQuote) {
          throw new Error('CSV 引号没有闭合');
        }
        if (field || fields.length) {
          emitRow();
        }
        if (!columns) {
          throw new Error('未找到 WizTree CSV 表头');
        }
      }
    };
  }
  const normalize = (path) =>
    path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  /**
   * Sum anchors once, excluding duplicates and descendants of included paths.
   * @param {Array<{path: string, bytes: number}>} anchors Paths and their occupied bytes.
   * @returns {number} Occupied bytes in the supplied union.
   */
  function unionBytes(anchors) {
    // A trailing separator keeps sibling names from matching as descendants.
    const sorted = anchors
      .map((anchor) => ({
        path: normalize(anchor.path) + '\\',
        bytes: anchor.bytes
      }))
      .sort((anchor, otherAnchor) =>
        anchor.path < otherAnchor.path
          ? -1
          : anchor.path > otherAnchor.path
            ? 1
            : otherAnchor.bytes - anchor.bytes
      );
    let previous = '';
    let total = 0;
    for (const anchor of sorted) {
      if (
        previous &&
        (anchor.path === previous || anchor.path.startsWith(previous))
      ) {
        continue;
      }
      previous = anchor.path;
      total += anchor.bytes;
    }
    return total;
  }
  const categoryNames = {
    system: '系统与 Windows',
    programs: '已安装的软件',
    appdata: '应用数据与缓存(AppData)',
    personal: '个人文件',
    downloads: '下载',
    recycle: '回收站',
    other: '其他与根目录文件（含 pagefile.sys、hiberfil.sys 等）'
  };
  function bucket(parts) {
    // Bucket roots are disjoint; child folder totals must not be added again.
    let id = 'other';
    let depth = 2;
    if (parts[1] === 'windows') {
      id = 'system';
    } else if (['program files', 'program files (x86)'].includes(parts[1])) {
      id = 'programs';
    } else if (parts[1] === 'programdata') {
      id = 'appdata';
    } else if (parts[1] === '$recycle.bin') {
      id = 'recycle';
    } else if (parts[1] === 'users') {
      depth = 4;
      if (parts[3] === 'appdata') {
        id = 'appdata';
      } else if (parts[3] === 'downloads') {
        id = 'downloads';
      } else if (
        ['desktop', 'documents', 'pictures', 'videos', 'music'].includes(
          parts[3]
        ) ||
        (parts[3] || '').startsWith('onedrive')
      ) {
        id = 'personal';
      }
    }
    return {
      id,
      depth
    };
  }
  /**
   * Collect rows into category buckets and capped suggestion anchors.
   * @param {{rules?: Array<Object>}} [options] Ordered suggestion rules.
   * @returns {{add: function(Object): void, result: function(): Object}} Aggregator.
   */
  function createAggregator({ rules = [] } = {}) {
    let rowCount = 0;
    let fileRows = 0;
    let folderRows = 0;
    let skipped = 0;
    let fileTotal = 0;
    const roots = new Map();
    const buckets = new Map();
    const ruleAnchors = rules.map(() => new Map());
    const patternGroups = new Map();
    const anywherePatterns = [];
    rules.forEach((rule, index) =>
      rule.patterns.forEach((pattern) => {
        const entry = {
          index,
          pattern
        };
        if (pattern[0] === '**') {
          anywherePatterns.push(entry);
        } else {
          const key =
            pattern[0] === '*' || /:$/.test(pattern[0])
              ? pattern[1]
              : pattern[0];
          if (!patternGroups.has(key)) {
            patternGroups.set(key, []);
          }
          patternGroups.get(key).push(entry);
        }
      })
    );
    // The match ends at the anchor directory, never at a file name.
    // A leading ** uses the first matching segment at any depth.
    function match(parts, pattern, isDir) {
      let start = 1;
      let patternParts = pattern;
      if (patternParts[0] === '**') {
        patternParts = patternParts.slice(1);
        start = parts.indexOf(patternParts[0], 1);
        if (start < 0) {
          return 0;
        }
      } else if (patternParts[0] === '*' || /:$/.test(patternParts[0])) {
        patternParts = patternParts.slice(1);
      }
      if (start + patternParts.length > parts.length - (isDir ? 0 : 1)) {
        return 0;
      }
      for (
        let patternIndex = 0;
        patternIndex < patternParts.length;
        patternIndex++
      ) {
        if (
          patternParts[patternIndex] !== '*' &&
          patternParts[patternIndex] !== parts[start + patternIndex]
        ) {
          return 0;
        }
      }
      return start + patternParts.length;
    }
    return {
      /** Add one parsed row without double-counting folder and file totals. */
      add(row) {
        rowCount++;
        if (
          !row.path ||
          !Number.isFinite(row.allocated) ||
          row.allocated < 0 ||
          !Number.isFinite(row.size)
        ) {
          skipped++;
          return;
        }
        const path = normalize(row.path);
        const parts = path.split('\\');
        const bytes = row.allocated;
        if (row.isDir) {
          folderRows++;
        } else {
          fileRows++;
          fileTotal += bytes;
        }
        if (row.isDir && parts.length === 1) {
          roots.set(path, bytes);
        }
        const categoryBucket = bucket(parts);
        const key = parts.slice(0, categoryBucket.depth).join('\\');
        if (
          (!row.isDir && parts.length > categoryBucket.depth) ||
          (row.isDir && parts.length === categoryBucket.depth)
        ) {
          let bucketTotals = buckets.get(key);
          if (!bucketTotals) {
            bucketTotals = {
              id: categoryBucket.id,
              files: 0,
              folder: null
            };
            buckets.set(key, bucketTotals);
          }
          if (row.isDir) {
            bucketTotals.folder = bytes;
          } else {
            bucketTotals.files += bytes;
          }
        }
        let chosen;
        const matches = [];
        for (const entry of (patternGroups.get(parts[1]) || []).concat(
          anywherePatterns
        )) {
          const depth = match(parts, entry.pattern, row.isDir);
          if (depth) {
            matches.push({
              index: entry.index,
              depth
            });
            if (!chosen || entry.index < chosen.index) {
              chosen = {
                index: entry.index,
                depth
              };
            }
          }
        }
        if (!chosen) {
          return;
        }
        // 首条规则决定归属；祖先目录的文件总量仍须包含被其他规则认领的子目录。
        // 仅被首条规则认领过的锚点才展示，辅助计数不会新增重复建议。
        const seen = new Set();
        for (const matchedPattern of matches) {
          const anchor = parts.slice(0, matchedPattern.depth).join('\\');
          const key = matchedPattern.index + ':' + anchor;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          let anchorTotals = ruleAnchors[matchedPattern.index].get(anchor);
          if (!anchorTotals) {
            anchorTotals = {
              path:
                row.path
                  .replace(/\\+$/, '')
                  .split('\\')
                  .slice(0, matchedPattern.depth)
                  .join('\\') + '\\',
              files: 0,
              folder: null,
              active: false
            };
            ruleAnchors[matchedPattern.index].set(anchor, anchorTotals);
          }
          if (
            matchedPattern.index === chosen.index &&
            matchedPattern.depth === chosen.depth
          ) {
            anchorTotals.active = true;
          }
          if (row.isDir && matchedPattern.depth === parts.length) {
            anchorTotals.folder = bytes;
          } else if (!row.isDir) {
            anchorTotals.files += bytes;
          }
        }
      },
      /** Return category totals and the largest 300 anchors per suggestion. */
      result() {
        const totals = Object.fromEntries(
          Object.keys(categoryNames).map((key) => [key, 0])
        );
        for (const categoryBucket of buckets.values()) {
          totals[categoryBucket.id] +=
            categoryBucket.folder === null
              ? categoryBucket.files
              : categoryBucket.folder;
        }
        const totalBytes = roots.size
          ? [...roots.values()].reduce((total, bytes) => total + bytes, 0)
          : fileTotal;
        totals.other = Math.max(
          0,
          totalBytes -
            Object.entries(totals)
              .filter(([key]) => key !== 'other')
              .reduce((total, [, bytes]) => total + bytes, 0)
        );
        const suggestions = rules
          .map((rule, index) => {
            const allAnchors = [...ruleAnchors[index].values()]
              .filter((anchor) => anchor.active)
              .map((anchor) => ({
                path: anchor.path,
                bytes: anchor.folder === null ? anchor.files : anchor.folder
              }))
              .filter((anchor) => anchor.bytes > 0)
              .sort((left, right) => right.bytes - left.bytes);
            const anchorCount = allAnchors.length;
            // Union totals use only the 300 largest anchors, also retained in saved reports.
            allAnchors.splice(300);
            return {
              ...rule,
              patterns: undefined,
              bytes: unionBytes(allAnchors),
              anchors: allAnchors.slice(0, 50),
              allAnchors,
              anchorCount
            };
          })
          .filter((rule) => rule.bytes > 0);
        return {
          totalBytes,
          rowCount,
          fileRows,
          folderRows,
          skipped,
          kind: fileRows ? (folderRows ? 'mixed' : 'files') : 'folders',
          categories: Object.entries(categoryNames).map(([id, label]) => ({
            id,
            label,
            bytes: totals[id]
          })),
          suggestions,
          maxBytes: unionBytes(
            suggestions.flatMap((suggestion) => suggestion.allAnchors)
          )
        };
      }
    };
  }
  /**
   * Detect BOMs, then probe UTF-8 before falling back to GB18030.
   * @param {Uint8Array} bytes Initial bytes, which may end inside a character.
   * @returns {string} TextDecoder encoding name.
   */
  function sniffEncoding(bytes) {
    if (bytes[0] === 255 && bytes[1] === 254) {
      return 'utf-16le';
    }
    if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
      return 'utf-8';
    }
    try {
      new TextDecoder('utf-8', {
        fatal: true
      }).decode(bytes, {
        stream: true
      });
      return 'utf-8';
    } catch {
      return 'gb18030';
    }
  }
  /**
   * Format a byte count for the Chinese report UI.
   * @param {number} bytes Occupied bytes.
   * @returns {string} Chinese capacity label.
   */
  function formatBytes(bytes) {
    if (bytes >= 1073741824) {
      return '约 ' + (bytes / 1073741824).toFixed(1) + ' GB';
    }
    if (bytes >= 1048576) {
      return Math.round(bytes / 1048576) + ' MB';
    }
    if (bytes >= 1024) {
      return Math.round(bytes / 1024) + ' KB';
    }
    return Math.round(bytes) + ' 字节';
  }
  return {
    categoryLabels: categoryNames,
    createCsvParser,
    createAggregator,
    unionBytes,
    formatBytes,
    decodeHelpers: {
      sniffEncoding
    }
  };
});
