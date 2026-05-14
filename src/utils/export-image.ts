// 画布导出图片工具：基于 html-to-image
//   - exportCanvasAsPng / Jpg / Svg —— 把当前 React Flow 视图截屏为图片下载
//
// 关键约束：
//   1. 截屏目标是 .react-flow__viewport（含所有节点/连线），不是 .react-flow（会带上 Controls/MiniMap/工具栏）
//   2. 调用前 caller 应先 fitView()，否则只截到当前 viewport 可见部分；本工具不直接调 fitView（避免依赖 react-flow 实例）
//   3. 文件名格式：${canvasName}-${YYYYMMDD-HHmm}.{ext}，canvasName 经 safeName 过滤
//   4. 背景色默认 '#ffffff'，避免透明背景在 PNG/JPG 上看起来异常

import { toPng, toJpeg, toSvg } from 'html-to-image';

const VIEWPORT_SELECTOR = '.react-flow__viewport';

// v1.18.5 #38：html-to-image 性能优化（默认对所有调用生效）
//   - skipFonts: true —— 跳过 fontEmbed（默认 fontEmbed 会下载嵌入所有 @font-face 资源，4 节点画布 5s 的主因）
//   - cacheBust: false —— 不在 url 上加时间戳，允许浏览器缓存命中（@xyflow CSS / 图标）
//   - pixelRatio 1.5 —— 清晰度仍 > 1x（普通屏幕够用），耗时较 2x 砍约 40%
//
// 后续如需"高清渠道"再做时分场景：默认快速 1.5x，用户长按下拉给"高清 2x"选项
const HTML_TO_IMAGE_PERF_OPTS = {
  skipFonts: true,
  cacheBust: false,
};

/** 文件名安全字符过滤：Windows/Linux 文件系统不允许的字符替换为 _，长度上限 80 */
export function safeFilename(name: string): string {
  return (name || 'canvas')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .slice(0, 80);
}

/** 时间戳格式 YYYYMMDD-HHmm（不含秒，避免 1 分钟内多次导出文件名相同 — 1 分钟内重复属低概率） */
export function formatExportTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes())
  );
}

/** 构造完整导出文件名 */
export function buildExportFilename(canvasName: string, ext: 'png' | 'jpg' | 'svg'): string {
  return `${safeFilename(canvasName)}-${formatExportTimestamp()}.${ext}`;
}

/** 触发浏览器下载 data URL（不在 DOM 留 a 标签） */
function triggerDownloadFromDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** 查找 React Flow viewport 节点；找不到抛错（caller 应在画布加载后调用） */
function getViewportElement(): HTMLElement {
  const el = document.querySelector(VIEWPORT_SELECTOR) as HTMLElement | null;
  if (!el) {
    throw new Error(`未找到画布元素 (${VIEWPORT_SELECTOR})，请确认画布已加载`);
  }
  return el;
}

export interface ExportImageOptions {
  /** 背景色，默认 '#ffffff'；SVG 传 null 可保持透明 */
  backgroundColor?: string | null;
  /** 设备像素比，默认 2（高清） */
  pixelRatio?: number;
  /** 截图前钩子：调用方在此调 fitView() 并 await 一帧让 viewport transform 稳定 */
  beforeCapture?: () => Promise<void> | void;
}

const DEFAULT_OPTIONS = {
  backgroundColor: '#ffffff' as string | null,
  pixelRatio: 1.5,
};

export async function exportCanvasAsPng(
  canvasName: string,
  options: ExportImageOptions = {},
): Promise<void> {
  if (options.beforeCapture) await options.beforeCapture();
  const el = getViewportElement();
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dataUrl = await toPng(el, {
    backgroundColor: opts.backgroundColor ?? undefined,
    pixelRatio: opts.pixelRatio,
    ...HTML_TO_IMAGE_PERF_OPTS,
  });
  triggerDownloadFromDataUrl(dataUrl, buildExportFilename(canvasName, 'png'));
}

export async function exportCanvasAsJpg(
  canvasName: string,
  options: ExportImageOptions = {},
): Promise<void> {
  if (options.beforeCapture) await options.beforeCapture();
  const el = getViewportElement();
  const opts = { ...DEFAULT_OPTIONS, ...options };
  // JPG 不支持透明背景，强制 '#ffffff'（即使 caller 传 null 也覆盖）
  const dataUrl = await toJpeg(el, {
    backgroundColor: opts.backgroundColor ?? '#ffffff',
    pixelRatio: opts.pixelRatio,
    quality: 0.95,
    ...HTML_TO_IMAGE_PERF_OPTS,
  });
  triggerDownloadFromDataUrl(dataUrl, buildExportFilename(canvasName, 'jpg'));
}

export async function exportCanvasAsSvg(
  canvasName: string,
  options: ExportImageOptions = {},
): Promise<void> {
  if (options.beforeCapture) await options.beforeCapture();
  const el = getViewportElement();
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dataUrl = await toSvg(el, {
    backgroundColor: opts.backgroundColor ?? undefined,
    ...HTML_TO_IMAGE_PERF_OPTS,
  });
  triggerDownloadFromDataUrl(dataUrl, buildExportFilename(canvasName, 'svg'));
}
