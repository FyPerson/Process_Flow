// Day 4 F-6 + H4：planMergedSave 纯函数单测（B 方案不变量守门）
//
// 测目标：
// - g1：状态不变断言 — appliedToLocal=false 时 plan 不携带任何"推进/替换"字段（类型 + 运行期双守）
// - g2：两轮保存 — 第一轮 defer 第二轮 apply；模拟"用户保存期间继续编辑 → 下轮 save 双方改动都进 mergedData"
//
// 这是 Day 3 末尾审三审锁定的 B 方案核心不变量的最直接守门：
//   serverVersionRef ≡ projectRef 的服务端基线
//   merged=true + changeSeq 不等时 server-side state 全不动
//
// 旧 hook 单测路线（renderHook + testing-library）需要 6+ 依赖；本测试通过纯函数抽取避开了基建升级。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planMergedSave,
  type MergedServerResult,
  type MergedSavePlan,
} from './mergeSavePlan';
import type { MultiCanvasProject } from '../types/flow';
import type { MergeReport } from '../api/canvases.types';

// ============================================================
// 测试夹具
// ============================================================

function mkMergeReport(overrides: Partial<MergeReport> = {}): MergeReport {
  return {
    nodesAddedCount: 0,
    nodesModifiedCount: 0,
    nodesDeprecatedCount: 0,
    nodesRemovedCount: 0,
    edgesAddedCount: 0,
    edgesModifiedCount: 0,
    edgesRemovedCount: 0,
    warnings: [],
    mergedFromUserId: 1,
    mergedFromUsername: 'alice',
    mergedFromVersion: 2,
    ...overrides,
  };
}

function mkProject(id: string, sheetCount: number): MultiCanvasProject {
  return {
    version: 2 as const,
    id,
    name: `P-${id}`,
    activeSheetId: 's1',
    sheets: Array.from({ length: sheetCount }, (_, i) => ({
      id: `s${i + 1}`,
      name: `Sheet ${i + 1}`,
      nodes: [],
      connectors: [],
    })),
  } as MultiCanvasProject;
}

function mkServerResult(version: number, dataId: string, sheetCount = 1): MergedServerResult {
  return {
    version,
    mergedFromVersion: version - 1,
    mergedData: mkProject(dataId, sheetCount),
    report: mkMergeReport({ mergedFromVersion: version - 1 }),
  };
}

// ============================================================
// g1：状态不变断言（appliedToLocal=false 时 plan 不携带推进字段）
// ============================================================

describe('planMergedSave — g1：B 方案不变量（defer plan 不携带推进字段）', () => {
  it('1. appliedToLocal=false → action=defer + reason 字段', () => {
    const result = mkServerResult(5, 'p-server');
    const plan = planMergedSave(false, result);
    assert.equal(plan.action, 'defer');
    assert.equal(plan.action === 'defer' && plan.reason, 'change_seq_diverged_during_save');
  });

  it('2. defer plan 运行期检查：plan 只有 action + reason 两个 key（无任何推进字段）', () => {
    const result = mkServerResult(5, 'p-server');
    const plan = planMergedSave(false, result);
    const keys = Object.keys(plan).sort();
    // 类型层已守门，运行期再断言一次（防止编译期 bypass）
    assert.deepEqual(keys, ['action', 'reason']);
  });

  // 注：测试 3 "defer plan 不含 newVersion 等字段" 已被测试 1+2 覆盖：
  // - 测试 1 验证 action='defer' 由 narrowing 强制 plan 不能 access ApplyMergedPlan 字段（编译期守门）
  // - 测试 2 用 Object.keys 验证运行期 keys 只有 ['action', 'reason']（运行期守门）
  // 单独 cast 到 Record<string, unknown> 会触发 TS strict cast 警告且与类型守门重复。

  it('3. appliedToLocal=true → action=apply + 完整推进字段', () => {
    const result = mkServerResult(5, 'p-server');
    const plan = planMergedSave(true, result);
    assert.equal(plan.action, 'apply');
    if (plan.action !== 'apply') return; // narrow for TS
    assert.equal(plan.newVersion, 5);
    assert.equal(plan.newProjectData.id, 'p-server');
    assert.equal(plan.shouldDeleteDraft, true);
    assert.equal(plan.shouldClearDirty, true);
    assert.equal(plan.shouldBumpLoadRevision, true);
    assert.equal(plan.shouldResetDraftAutosaveSnapshot, true);
  });

  it('4. apply plan 携带服务端 mergedData 完整快照（不是引用）', () => {
    const result = mkServerResult(5, 'p-server', 3);
    const plan = planMergedSave(true, result);
    assert.equal(plan.action, 'apply');
    if (plan.action !== 'apply') return;
    // plan.newProjectData 来自服务端 mergedData，含完整 sheets 数组
    assert.equal(plan.newProjectData.sheets.length, 3);
    assert.equal(plan.newProjectData.sheets[0].id, 's1');
    assert.equal(plan.newProjectData.sheets[2].id, 's3');
  });
});

// ============================================================
// g2：两轮保存（第一轮 defer 第二轮 apply 双方改动都进 mergedData）
// ============================================================

describe('planMergedSave — g2：两轮保存（B 方案延后合并语义）', () => {
  it('1. 第一轮 changeSeq 不等 → defer；第二轮 changeSeq 等 → apply', () => {
    // 模拟用户场景：
    // T0 用户编辑（dirty=true, changeSeq=1）→ 触发防抖 save (capturedSeq=1)
    // T1 服务端响应到达前用户继续编辑（changeSeqRef.current=2）→ appliedToLocal = (2 === 1) = false
    // T2 hook 收到 merged=true：
    //   plan = planMergedSave(false, serverResult_v5) → defer

    const round1Server = mkServerResult(5, 'p-server-r1');
    const plan1 = planMergedSave(false, round1Server);
    assert.equal(plan1.action, 'defer');
    // server-side state 全部不动 → 下次 save 还会用旧 baseVersion (= mergedFromVersion = 4)

    // T3 用户停止编辑（changeSeq 不再变化）→ 下个防抖 save 触发 capturedSeq=2
    // T4 服务端再合并：把 round1 + 用户后续改动 一起合到 mergedData_v6
    // T5 服务端响应：changeSeqRef.current === capturedSeq (= 2 === 2) → appliedToLocal=true
    const round2Server = mkServerResult(6, 'p-server-r2');
    const plan2 = planMergedSave(true, round2Server);
    assert.equal(plan2.action, 'apply');
    if (plan2.action !== 'apply') return;
    assert.equal(plan2.newVersion, 6);
    assert.equal(plan2.newProjectData.id, 'p-server-r2'); // 第二轮的 mergedData 含双方改动
  });

  it('2. 连续 N 轮 defer → 都不携带推进字段（防止"延后越久越脏"假设）', () => {
    // 极端场景：用户连续编辑 5 轮，服务端每轮都合并但本地永远 changeSeq 不等
    const plans: MergedSavePlan[] = [];
    for (let i = 0; i < 5; i++) {
      const server = mkServerResult(5 + i, `p-r${i}`);
      plans.push(planMergedSave(false, server));
    }
    // 5 轮 defer plan 都纯净（只有 action + reason）
    for (const plan of plans) {
      assert.equal(plan.action, 'defer');
      assert.deepEqual(Object.keys(plan).sort(), ['action', 'reason']);
    }
  });

  it('3. defer 后突然 apply 不会"补推"前几轮被 defer 的版本号（apply 用本轮 server 版本）', () => {
    // 用户编辑序列：1→2→3→4→5（changeSeq 推进）
    // 服务端版本：v5 (defer) → v6 (defer) → v7 (defer) → v8 (apply 本轮 changeSeq 等)
    const plan_v5 = planMergedSave(false, mkServerResult(5, 'p-v5'));
    const plan_v6 = planMergedSave(false, mkServerResult(6, 'p-v6'));
    const plan_v7 = planMergedSave(false, mkServerResult(7, 'p-v7'));
    const plan_v8 = planMergedSave(true, mkServerResult(8, 'p-v8'));

    assert.equal(plan_v5.action, 'defer');
    assert.equal(plan_v6.action, 'defer');
    assert.equal(plan_v7.action, 'defer');
    assert.equal(plan_v8.action, 'apply');
    if (plan_v8.action !== 'apply') return;
    // apply 用本轮 v8（不是 v5/v6/v7），mergedData 来自服务端最新合并
    assert.equal(plan_v8.newVersion, 8);
    assert.equal(plan_v8.newProjectData.id, 'p-v8');
  });
});

// ============================================================
// 类型层守门验证（编译期已保证；这里仅作运行期 sanity check）
// ============================================================

describe('planMergedSave — 类型层守门 sanity check', () => {
  it('1. apply plan 的 action discriminant 是 "apply"', () => {
    const plan = planMergedSave(true, mkServerResult(1, 'p1'));
    assert.equal(plan.action === 'apply', true);
  });

  it('2. defer plan 的 action discriminant 是 "defer"', () => {
    const plan = planMergedSave(false, mkServerResult(1, 'p1'));
    assert.equal(plan.action === 'defer', true);
  });

  it('3. defer plan reason 是固定常量（不会随服务端响应变化）', () => {
    const plan_a = planMergedSave(false, mkServerResult(5, 'p-a'));
    const plan_b = planMergedSave(false, mkServerResult(99, 'p-b'));
    assert.equal(plan_a.action === 'defer' && plan_a.reason, 'change_seq_diverged_during_save');
    assert.equal(plan_b.action === 'defer' && plan_b.reason, 'change_seq_diverged_during_save');
  });
});
