// export-image 纯函数单测
//
// 覆盖范围：
//   - safeFilename: 文件名安全字符过滤 + 长度截断
//   - formatExportTimestamp: 时间戳格式 YYYYMMDD-HHmm
//   - buildExportFilename: 文件名 + 时间戳 + 扩展名拼接
//
// 不覆盖：
//   - exportCanvasAsPng/Jpg/Svg：依赖 DOM + html-to-image，由 T-3 顶栏接入后的手工验证保护
//     （项目按 F-16b 决策刻意不引入 RTL/jsdom）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  safeFilename,
  formatExportTimestamp,
  buildExportFilename,
} from './export-image';

test('safeFilename: 替换 Windows/Linux 非法字符', () => {
  assert.equal(safeFilename('foo/bar'), 'foo_bar');
  assert.equal(safeFilename('foo\\bar'), 'foo_bar');
  assert.equal(safeFilename('a:b*c?d"e<f>g|h'), 'a_b_c_d_e_f_g_h');
});

test('safeFilename: 连续非法字符压缩成单下划线', () => {
  assert.equal(safeFilename('foo///bar'), 'foo_bar');
  assert.equal(safeFilename('foo:*?bar'), 'foo_bar');
});

test('safeFilename: 普通中文/英文/数字保留', () => {
  assert.equal(safeFilename('发薪算薪全流程'), '发薪算薪全流程');
  assert.equal(safeFilename('Canvas-2026_v1'), 'Canvas-2026_v1');
});

test('safeFilename: 空字符串 → fallback "canvas"', () => {
  assert.equal(safeFilename(''), 'canvas');
});

test('safeFilename: 长度上限 80（防超长 canvasName 撑爆文件系统）', () => {
  const long = 'a'.repeat(200);
  assert.equal(safeFilename(long).length, 80);
});

test('formatExportTimestamp: 格式 YYYYMMDD-HHmm', () => {
  // 2026-05-14 09:05:42 → 20260514-0905（秒被丢）
  const d = new Date(2026, 4, 14, 9, 5, 42);
  assert.equal(formatExportTimestamp(d), '20260514-0905');
});

test('formatExportTimestamp: 月份/日期/时分 < 10 补 0', () => {
  const d = new Date(2026, 0, 1, 0, 0, 0);
  assert.equal(formatExportTimestamp(d), '20260101-0000');
});

test('formatExportTimestamp: 默认参数 = 当前时间（格式正确即可）', () => {
  const ts = formatExportTimestamp();
  assert.match(ts, /^\d{8}-\d{4}$/);
});

test('buildExportFilename: 拼接 canvasName + 时间戳 + 扩展名', () => {
  const fn = buildExportFilename('测试画布', 'png');
  assert.match(fn, /^测试画布-\d{8}-\d{4}\.png$/);
});

test('buildExportFilename: 支持 png/jpg/svg 三种扩展名', () => {
  assert.match(buildExportFilename('a', 'png'), /\.png$/);
  assert.match(buildExportFilename('a', 'jpg'), /\.jpg$/);
  assert.match(buildExportFilename('a', 'svg'), /\.svg$/);
});

test('buildExportFilename: canvasName 含非法字符被过滤', () => {
  const fn = buildExportFilename('a/b:c*d', 'png');
  assert.match(fn, /^a_b_c_d-\d{8}-\d{4}\.png$/);
});
