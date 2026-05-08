// Day 4 F-16b：saveErrorDispatcher 纯函数单测（B 方案 + 04 范围判读审拍板）
//
// 覆盖 02-拍板记录 § F-16 子断言映射表中：
//   (f2) base_version_expired 重载  — case 1+2
//   (f3) 409 conflict 携 conflicts   — case 3+4+5
//   (h)  discardAndReload 不删草稿   — case 6+7（类型层 + 运行期双守）
//
// (h) 守门方式（仿 mergeSavePlan g1）：
// - 类型层：SaveErrorBaseVersionExpiredPlan/SaveErrorConflictPlan 的 shouldDeleteDraft 类型是
//   字面常量 `false`，编译期堵绕过路径
// - 运行期：Object.keys + 字面值断言双查，防止编译期 bypass

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planSaveError, type SaveErrorPlan } from './saveErrorDispatcher';
import type { ApiError } from '../api/canvases';
import type { Conflict } from '../api/canvases.types';

// ============================================================
// case 1-2：base_version_expired 路径（(f2) + (h)）
// ============================================================

describe('planSaveError — base_version_expired 路径 ((f2) + (h))', () => {
  it('1. 409 + error=base_version_expired + currentVersion → base_version_expired plan', () => {
    const err: ApiError = {
      status: 409,
      error: 'base_version_expired',
      currentVersion: 5,
    };
    const plan = planSaveError(err);

    assert.equal(plan.action, 'base_version_expired');
    if (plan.action !== 'base_version_expired') return; // narrow for TS
    assert.equal(plan.currentVersion, 5);
    assert.equal(plan.conflictReason, 'base_version_expired');
    // (h) 关键断言：shouldDeleteDraft 必须 false（运行期）
    assert.equal(plan.shouldDeleteDraft, false);
    // returnValue 给 save() 直接 return
    assert.deepEqual(plan.returnValue, {
      status: 'base_version_expired',
      currentVersion: 5,
    });
  });

  it('2. (h) 类型层守门 sanity：base_version_expired plan 的 shouldDeleteDraft 在运行期也是字面 false', () => {
    const err: ApiError = {
      status: 409,
      error: 'base_version_expired',
      currentVersion: 99,
    };
    const plan = planSaveError(err);
    if (plan.action !== 'base_version_expired') {
      assert.fail('expected base_version_expired plan');
    }
    // 不只是 falsy，而是字面 false（防止 0/null/undefined 漏过）
    assert.strictEqual(plan.shouldDeleteDraft, false);
    assert.equal(typeof plan.shouldDeleteDraft, 'boolean');
  });
});

// ============================================================
// case 3-5：conflict 路径（(f3)）
// ============================================================

describe('planSaveError — conflict 路径 ((f3))', () => {
  it('3. 409 + currentVersion + conflicts → conflict plan 携 conflicts 数组', () => {
    const conflicts: Conflict[] = [
      {
        type: 'node_modified_both',
        sheetId: 's1',
        targetId: 'n1',
        field: 'name',
        message: '双方都改了 n1.name',
      },
    ];
    const err: ApiError = {
      status: 409,
      error: 'conflict',
      currentVersion: 3,
      conflicts,
    };
    const plan = planSaveError(err);

    assert.equal(plan.action, 'conflict');
    if (plan.action !== 'conflict') return;
    assert.equal(plan.currentVersion, 3);
    assert.equal(plan.conflicts, conflicts); // 引用相等（dispatcher 不深拷）
    assert.equal(plan.conflictReason, 'conflict');
    // (h) conflict 路径同款：不删草稿
    assert.equal(plan.shouldDeleteDraft, false);
    assert.deepEqual(plan.returnValue, {
      status: 'conflict',
      currentVersion: 3,
      conflicts,
    });
  });

  it('4. 409 + currentVersion 但 conflicts undefined（D-12 文案落点）→ conflict plan 携 undefined', () => {
    // 服务端在某些 409 路径不返 conflicts（旧客户端兼容场景）
    const err: ApiError = {
      status: 409,
      error: 'conflict',
      currentVersion: 3,
      // conflicts 字段缺失
    };
    const plan = planSaveError(err);

    assert.equal(plan.action, 'conflict');
    if (plan.action !== 'conflict') return;
    assert.equal(plan.conflicts, undefined);
    // BFV ConflictResolutionDialog 渲染层处理 undefined fallback（不是 dispatcher 责任）
    assert.equal(plan.shouldDeleteDraft, false);
  });

  it('5. error 字段不是 base_version_expired 但 status=409 → 走 conflict 路径', () => {
    // 例如 forbidden_modify_others_node 是 403，但若服务端误返 409 仍归 conflict 兜底
    // 实际服务端 forbidden_* 是 403/409 不是 base_version_expired，dispatcher 按 currentVersion 判别
    const err: ApiError = {
      status: 409,
      error: 'forbidden_modify_others_node',
      currentVersion: 7,
    };
    const plan = planSaveError(err);
    assert.equal(plan.action, 'conflict');
  });
});

// ============================================================
// case 6-7：rethrow 兜底（非 409 / 数据形状非法）
// ============================================================

describe('planSaveError — rethrow 兜底', () => {
  it('6. 非 409（500 / 网络错误归一）→ rethrow plan', () => {
    const err: ApiError = {
      status: 500,
      error: 'data_integrity_error',
    };
    const plan = planSaveError(err);
    assert.equal(plan.action, 'rethrow');
    if (plan.action !== 'rethrow') return;
    assert.equal(plan.error, err);
    // rethrow plan 类型上没有 shouldDeleteDraft 字段（discriminated union narrowing）
  });

  it('7. 409 但缺 currentVersion（服务端响应形状非法）→ rethrow', () => {
    // base_version_expired 但没 currentVersion → 走 rethrow 不静默兜底
    const err: ApiError = {
      status: 409,
      error: 'base_version_expired',
      // currentVersion 缺失
    };
    const plan = planSaveError(err);
    assert.equal(plan.action, 'rethrow');
  });

  it('8. 409 + 任意 error + 缺 currentVersion → rethrow（不冒充 conflict 兜底）', () => {
    const err: ApiError = {
      status: 409,
      error: 'something_unknown',
    };
    const plan = planSaveError(err);
    assert.equal(plan.action, 'rethrow');
  });

  // codex 05 末尾审 R5 修法：补 currentVersion 字段类型非法测试
  // 旧用例只测"缺字段"，没测"字段类型非法（string/NaN）"——真实场景下服务端契约违反
  it('9. R5: 409 + base_version_expired + currentVersion 是 string（类型非法）→ rethrow', () => {
    // ApiError.currentVersion 类型是 number | undefined，但运行期可能服务端误返 string
    // typeof 'foo' === 'number' 是 false → 走 rethrow（不冒充 base_version_expired）
    const err = {
      status: 409,
      error: 'base_version_expired',
      currentVersion: '5' as unknown as number, // 真实场景模拟服务端契约违反
    } satisfies ApiError;
    const plan = planSaveError(err);
    assert.equal(plan.action, 'rethrow');
  });

  it('10. R5: 409 + conflict + currentVersion 是 null（类型非法）→ rethrow', () => {
    const err = {
      status: 409,
      error: 'conflict',
      currentVersion: null as unknown as number,
    } satisfies ApiError;
    const plan = planSaveError(err);
    assert.equal(plan.action, 'rethrow');
  });

  // F-17 末尾审 M1 修法：非 ApiError 形状必须 rethrow，不能二次异常
  // 入参从 ApiError 放宽为 unknown + 形状守卫
  it('11. F-17 M1: 入参 null → rethrow（不抛 TypeError）', () => {
    const plan = planSaveError(null);
    assert.equal(plan.action, 'rethrow');
    if (plan.action !== 'rethrow') return;
    assert.equal(plan.error.error, 'non_api_error_shape');
  });

  it('12. F-17 M1: 入参 undefined → rethrow', () => {
    const plan = planSaveError(undefined);
    assert.equal(plan.action, 'rethrow');
    if (plan.action !== 'rethrow') return;
    assert.equal(plan.error.error, 'non_api_error_shape');
  });

  it('13. F-17 M1: 入参普通 Error 实例（非 ApiError 形状）→ rethrow', () => {
    const plan = planSaveError(new Error('low-level fetch failure'));
    assert.equal(plan.action, 'rethrow');
    if (plan.action !== 'rethrow') return;
    assert.equal(plan.error.error, 'non_api_error_shape');
  });

  it('14. F-17 M1: 入参字符串 / 数字 → rethrow', () => {
    assert.equal(planSaveError('some error string').action, 'rethrow');
    assert.equal(planSaveError(404).action, 'rethrow');
    assert.equal(planSaveError(true).action, 'rethrow');
  });

  it('15. F-17 M1: 入参对象但缺 status 字段 → rethrow', () => {
    const plan = planSaveError({ error: 'some_error' });
    assert.equal(plan.action, 'rethrow');
  });

  it('16. F-17 M1: 入参对象但 status 是 string（非 number）→ rethrow', () => {
    const plan = planSaveError({ status: '409', error: 'conflict' });
    assert.equal(plan.action, 'rethrow');
  });
});

// ============================================================
// v1.16.2：403 forbidden_remove 路径
// ============================================================

describe('planSaveError — forbidden_remove 路径 (v1.16.2)', () => {
  it('17. 403 + forbidden_remove_node → forbidden_remove plan + message', () => {
    const plan = planSaveError({
      status: 403,
      error: 'forbidden_remove_node',
      message: 'cannot remove 1 node(s) on public canvas; only admin can physically delete',
    });
    if (plan.action !== 'forbidden_remove') {
      assert.fail(`expected forbidden_remove plan, got ${plan.action}`);
    }
    assert.match(plan.message, /admin/);
    assert.equal(plan.shouldDeleteDraft, false);
    assert.equal(plan.returnValue.status, 'forbidden_remove');
  });

  it('18. 403 + forbidden_delete_public_canvas → forbidden_remove plan + 中文 message', () => {
    const plan = planSaveError({
      status: 403,
      error: 'forbidden_delete_public_canvas',
      message: '只有管理员可以归档公共画布；普通用户请用"标废弃"代替',
    });
    if (plan.action !== 'forbidden_remove') {
      assert.fail(`expected forbidden_remove plan, got ${plan.action}`);
    }
    assert.match(plan.message, /管理员/);
    assert.equal(plan.shouldDeleteDraft, false);
  });

  it('19. 403 + forbidden_remove_node 但 message 缺失 → 用兜底文案', () => {
    const plan = planSaveError({ status: 403, error: 'forbidden_remove_node' });
    if (plan.action !== 'forbidden_remove') {
      assert.fail('expected forbidden_remove plan');
    }
    assert.match(plan.message, /标废弃/);
  });

  it('20. v1.16.3：403 + forbidden_modify_others_node → forbidden_remove plan（autosave 加载即推进 baseline 触发的友好处理）', () => {
    const plan = planSaveError({
      status: 403,
      error: 'forbidden_modify_others_node',
      message: 'cannot modify node n1 created by user 5',
    });
    if (plan.action !== 'forbidden_remove') {
      assert.fail(`expected forbidden_remove plan (v1.16.3 友好化), got ${plan.action}`);
    }
    assert.match(plan.message, /别人创建的节点/);
    assert.equal(plan.shouldDeleteDraft, false);
  });

  it('21. 403 + forbidden（无具体 code）→ rethrow', () => {
    const plan = planSaveError({ status: 403, error: 'forbidden' });
    assert.equal(plan.action, 'rethrow');
  });

  it('22. (h) 类型层守门：forbidden_remove plan 的 shouldDeleteDraft 是字面 false', () => {
    const plan = planSaveError({
      status: 403,
      error: 'forbidden_remove_node',
      message: 'x',
    });
    if (plan.action !== 'forbidden_remove') {
      assert.fail('expected forbidden_remove plan');
    }
    // 编译期：shouldDeleteDraft 类型是 false 字面常量；运行期 sanity
    const _typeCheck: false = plan.shouldDeleteDraft;
    void _typeCheck;
    assert.equal(plan.shouldDeleteDraft, false);
  });
});

// ============================================================
// (h) 类型层守门 sanity：检查 plan key 集合，防编译期 bypass
// ============================================================

describe('planSaveError — (h) 类型不变量 sanity check', () => {
  it('9. base_version_expired plan 的字段集合稳定（防止意外加推进字段）', () => {
    const plan = planSaveError({
      status: 409,
      error: 'base_version_expired',
      currentVersion: 5,
    });
    if (plan.action !== 'base_version_expired') {
      assert.fail('expected base_version_expired plan');
    }
    const keys = Object.keys(plan).sort();
    assert.deepEqual(keys, [
      'action',
      'conflictReason',
      'currentVersion',
      'returnValue',
      'shouldDeleteDraft',
    ]);
    // 反向验证：keys 字段集合相等已隐含 shouldClearDirty / shouldBumpLoadRevision 不存在
    // 类型层 narrowing（plan.action === 'base_version_expired'）守门防止编译期 bypass
    // 同 mergeSavePlan g1 模式：类型守门生效时不绕过它做运行期 cast 防御
  });

  it('10. conflict plan 的字段集合稳定', () => {
    const plan = planSaveError({
      status: 409,
      error: 'conflict',
      currentVersion: 3,
      conflicts: [],
    });
    if (plan.action !== 'conflict') {
      assert.fail('expected conflict plan');
    }
    const keys = Object.keys(plan).sort();
    assert.deepEqual(keys, [
      'action',
      'conflictReason',
      'conflicts',
      'currentVersion',
      'returnValue',
      'shouldDeleteDraft',
    ]);
  });

  it('11. action discriminant 稳定：所有路径都有 action 字段', () => {
    const plans: SaveErrorPlan[] = [
      planSaveError({ status: 409, error: 'base_version_expired', currentVersion: 1 }),
      planSaveError({ status: 409, error: 'conflict', currentVersion: 2, conflicts: [] }),
      planSaveError({ status: 500, error: 'data_integrity_error' }),
    ];
    for (const plan of plans) {
      assert.ok('action' in plan, 'every plan must have action discriminant');
      assert.ok(
        ['base_version_expired', 'conflict', 'rethrow'].includes(plan.action),
        `plan.action should be one of base_version_expired/conflict/rethrow, got ${plan.action}`,
      );
    }
  });
});
