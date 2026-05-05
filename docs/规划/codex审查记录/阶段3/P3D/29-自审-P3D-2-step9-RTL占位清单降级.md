# P3D-2 step 9 — RTL 集成测占位清单降级（自审 checklist 归档）

> **决策**：step 9 不引入 RTL + jsdom 测试基建。
> **理由**：内部项目 / 5 人并发 / < 100 用户，引入测试基建（vitest / jsdom / @testing-library/react / @testing-library/jest-dom）的一次性成本不划算。
> 这 7 项原计划 RTL 集成测降级为"自审 checklist + 部署后人工验证"，本文件作为持久化清单。
>
> **前置条件**：本清单不再阻塞 step 9 完成，但**进入 P3F（admin 后台 UI）或 P4（心跳 + auto-save）时**应重新评估，因为这两阶段会引入更多 React hook 行为边界，届时引 RTL 可能值得。

---

## 7 项 RTL 占位清单（保留至独立测试基建到位）

每条含：场景 / 需断言行为 / 当前 helper 单测覆盖度 / 风险评估。

### 1. onNodeUpdate ghost nodeId 早退副作用断言（九审 Medium）

**场景**：FlowCanvas 调 `onNodeUpdate('nonexistent', { name: 'x' })`
**需断言**：setNodes / setSelectedElement / saveHistory / triggerAutoSave 都不被调用
**helper 单测覆盖**：`canApplyNodeUpdate` 已测拒绝逻辑，但 React 副作用未被独立断言
**风险**：低 —— 早退在 useFlowHandlers.ts 实现，自审已确认拒绝路径不触发 setSelectedElement
**回归人工检查**：DevTools 打开 → 修改不存在节点 ID → 详情面板状态不变化 / Network 无 autosave 触发

### 2. onUpdateGroupLabel 拒绝路径不调副作用（八审 M1）

**场景**：普通用户 + 别人创建的 group → 调 onUpdateGroupLabel(otherGroupId, '新名字')
**需断言**：setNodes / saveHistory / triggerAutoSave 都不被调用
**helper 单测覆盖**：canEditNodeData 已测拒绝；副作用要靠 RTL
**风险**：低 —— useFlowOperations.onUpdateGroupLabel 已 gate 在 canEditNodeData 之前
**回归人工检查**：以普通用户登录 → 双击别人 group 改名 → 名字不变化 + autosave 不触发

### 3. updatedStyle === {} 行为锁定（七审 L1 + 八审 L2 + 九审 Low 2）

**场景**：普通用户 + 别人节点 + 仅 is_deprecated=true + style={}（不是 undefined）
**需断言**：被 canApplyNodeUpdate 拒（因为 isPublicDeprecateUpdate 视 {} 为有 style）
**helper 单测覆盖**：✅ 已覆盖（isPublicDeprecateUpdate 的 updatedStyle != null 判定 + 27-二审 low 1 加的 style 非 object 测试链）
**风险**：极低 —— 已有单测锁定行为
**结论**：**这条已被 helper 单测覆盖**，可视为已偿还

### 4. saveHistory React 18 StrictMode 双调用幂等（八审 / 九审 Low 1）

**场景**：StrictMode 包装下连续触发 setNodes updater
**需断言**：history 栈顶 snapshot 只有 1 条，不重复
**helper 单测覆盖**：snapshotsEqual 私有函数没暴露成 export，但 saveHistory 内的"栈顶判等跳过"逻辑已实现（useFlowHistory.ts step 9 修法）
**风险**：低 —— 已实现幂等判等，但在真实 React 18 StrictMode 下未做端到端验证
**回归人工检查**：dev 服 + StrictMode 开启（main.tsx 默认开）→ 拖动节点 1 次 → ctrl+z 一次能撤销（如果重复入栈则需要 2 次）

### 5. useFlowOperations.onUngroup admin-only 数据层 gate（step 4 一审 H2）

**场景**：普通用户（非 admin）作为 group creator → 调 onUngroup → 不应产生副作用
**需断言**：setNodes / saveHistory / triggerAutoSave 都不被调用
**helper 单测覆盖**：useFlowOperations 内的 admin-only gate 用户已 codex 二审通过（step 4 v1.2.0 commit aad1ca2），但拒绝路径副作用未被独立断言
**风险**：低
**回归人工检查**：普通用户对自己 group 走详情面板"解散分组"按钮 → 按钮 disabled（UI 层）；通过 DevTools 直接调用 onUngroup → 节点不变化

### 6. DeprecateNodeSection 公开权限不被 canEdit 吞（step 4 一审 H1）

**场景**：普通用户 + 别人创建的可写画布节点 + 点标废弃按钮
**需断言**：onNodeChange 被实际调用（不被 safeOnDeprecateChange 吞），dataUpdates 含 is_deprecated=true
**helper 单测覆盖**：✅ canApplyNodeUpdate + isPublicDeprecateUpdate 已锁定数据层放行；UI 层链路已 codex 二审通过（step 4 v1.2.0）
**风险**：极低
**回归人工检查**：普通用户在公共画布点别人节点的"标废弃"按钮 → 节点变灰 + autosave 触发 + 服务端保存成功

### 7. useFlowClipboard.pasteNodes 粘贴=新节点（八审）

**场景**：复制别人节点 → 粘贴 → 粘贴出来的节点应带 __localNew=true（视为本地新增）
**需断言**：粘贴节点 data.__localNew===true，creator_id 重置或与当前用户对齐
**helper 单测覆盖**：useFlowClipboard.copyNodes / pasteNodes 内逻辑已自审通过（八审），但端到端未验
**风险**：低
**回归人工检查**：普通用户复制别人节点 → 粘贴 → 粘贴出的副本可立即编辑（说明 __localNew 已设）

---

## 整体风险评估

- 7 项里有 2 项（#3 + #6）实际已被 helper 单测充分覆盖，可视为偿还
- 其余 5 项（#1 / #2 / #4 / #5 / #7）的核心数据层逻辑已被 helper 单测兜住，缺的是"React 副作用断言"和"端到端流程"
- 内网 5 人项目 + 已部署 + 用户可即时反馈 → 这些边界场景被实际触发后能 1 天内修
- **结论**：通过 step 9 门禁可接受

## 后续触发引入 RTL 的判定标准

满足任一条则重新评估引入 RTL：

1. P3F admin 后台 UI 引入新的 React hook 边界（用户管理 / 共有画布管理）
2. P4 心跳 + auto-save 引入定时器副作用 + 草稿恢复弹窗
3. P5 合并算法引入更复杂的 conflict 状态机
4. 实战中出现"helper 单测全过但端到端 bug"≥ 2 起

---

## P2J 残留 3/20 Playwright 手动用例

这部分**不是 step 9 引入的**，是 P2J 阶段债。已登记在 [docs/规划/技术债务登记.md](../../技术债务登记.md) 第 6 项。继续保留在债务登记，**不在本归档处理**。
