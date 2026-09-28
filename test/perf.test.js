'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { chunks } = require('../scripts/gen-synthetic-csv');
const core = require('../src/core');
const rules = require('../src/rules');
test('一百万行以 4 MB 分块解析聚合，低于 20 秒', () => {
  const data = Buffer.concat(
    [...chunks(1000000)].map((character) => Buffer.from(character))
  );
  const aggregator = core.createAggregator({
    rules
  });
  const parser = core.createCsvParser({
    onRow: aggregator.add
  });
  const decoder = new TextDecoder();
  const start = performance.now();
  for (let index = 0; index < data.length; index += 4 * 1024 * 1024) {
    parser.push(
      decoder.decode(data.subarray(index, index + 4 * 1024 * 1024), {
        stream: true
      })
    );
  }
  parser.push(decoder.decode());
  parser.end();
  const result = aggregator.result();
  const seconds = (performance.now() - start) / 1000;
  console.log(
    '性能测试：一百万行，' +
      (data.length / 1048576).toFixed(1) +
      ' MB，耗时 ' +
      seconds.toFixed(3) +
      ' 秒'
  );
  assert.equal(result.rowCount, 1000000);
  assert.ok(result.fileRows && result.folderRows);
  assert.ok(seconds < 20, '处理耗时应低于 20 秒');
});
