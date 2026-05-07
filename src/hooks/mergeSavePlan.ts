// Day 4 F-6 + H4：merged 分支决策抽取为纯函数（可单测 B 方案不变量）
//
// 背景：useMultiCanvas saveCanvas() 的 merged 分支当前是 9 件 setter / ref / await 副作用混合。
// 直接 hook 单测需要 testing-library/renderHook，与项目"dependencies 极简"原则不合。
//
// 解法：把"merged 后该做什么"抽成纯函数返回 MergedSavePlan，hook 里执行 plan。
// - 类型层把 B 方案不变量变成不变量：defer plan 没有任何"推进 ref"字段，编译期就守住
// - g1（状态不变断言）变为纯函数 case：appliedToLocal=false → 期望 action='defer' + plan 不携任何 apply 字段
// - g2（两轮保存）变为纯函数序列：第一轮 defer / 第二轮 apply 双方改动都在 mergedData
//
// 关联决策：
// - Day 3 末尾审三审锁定的 B 方案（serverVersionRef ≡ projectRef 服务端基线不变量）
// - Day 4 H4 / D-4：g1 状态不变断言 + g2 两轮保存 + g3 grep 脚本（F-7）
// - Day 4 M3：appliedToLocal 必须在 merged 分支入口冻结，不能被异步 await/setState 漂移

import type { MultiCanvasProject } from '../types/flow';
import type { MergeReport } from '../api/canvases.types';

/** 服务端 merged=true 响应的关键字段（hook 收到的 SaveCanvasResultClient 子集） */
export interface MergedServerResult {
  version: number;
  mergedFromVersion: number;
  mergedData: MultiCanvasProject;
  report: MergeReport;
}

/** apply plan：默认路径（changeSeq 等）— 推进 ref + 替换 project + 删草稿 */
export interface ApplyMergedPlan {
  action: 'apply';
  newVersion: number;
  newProjectData: MultiCanvasProject;
  shouldDeleteDraft: true;
  shouldClearDirty: true;
  shouldBumpLoadRevision: true;
  shouldResetDraftAutosaveSnapshot: true;
}

/** defer plan：B 方案路径（changeSeq 不等）— **不携带任何"推进"字段**
 *
 * 类型守门：defer plan 在编译期就不能 access newVersion / newProjectData / shouldDeleteDraft 等字段。
 * 这把"changeSeq 不等时 server-side state 不动"从运行期约定升级为类型不变量。 */
export interface DeferMergedPlan {
  action: 'defer';
  /** 仅供 console.warn / 测试断言；不参与 hook 副作用 */
  reason: 'change_seq_diverged_during_save';
}

export type MergedSavePlan = ApplyMergedPlan | DeferMergedPlan;

/** 纯函数：merged 分支根据 appliedToLocal 给出 plan
 *
 * @param appliedToLocal 必须在 merged 分支入口冻结的 boolean（M3 调整）
 * @param serverResult 服务端透传的 merged 结果
 *
 * B 方案不变量（Day 3 三审 PASS）：appliedToLocal=false 时 plan **绝不**携带任何推进/替换字段。 */
export function planMergedSave(
  appliedToLocal: boolean,
  serverResult: MergedServerResult,
): MergedSavePlan {
  if (appliedToLocal) {
    return {
      action: 'apply',
      newVersion: serverResult.version,
      newProjectData: serverResult.mergedData,
      shouldDeleteDraft: true,
      shouldClearDirty: true,
      shouldBumpLoadRevision: true,
      shouldResetDraftAutosaveSnapshot: true,
    };
  }
  return {
    action: 'defer',
    reason: 'change_seq_diverged_during_save',
  };
}
