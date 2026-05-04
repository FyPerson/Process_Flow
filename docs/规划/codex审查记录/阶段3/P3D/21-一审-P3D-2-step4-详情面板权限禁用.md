**第一层：非技术总结**

**还不能进 step 5**。codex 一审找到 2 个真漏洞 + 2 个边界确认 + 1 个低优先级文档：

- **High 1（标废弃公开权限被吞）**：我把所有传给 NodePropertiesPanel 的 onNodeChange 都换成了 safeOnNodeChange（canEdit=false 时 no-op），但 **DeprecateNodeSection 也接受同一个回调**——结果普通用户对别人的节点点"标废弃"会被详情面板层 no-op 提前吞掉，破坏 P3C 公开权限。这是真漏洞，而且我代码注释里已经写明"DeprecateNodeSection 直接传 onNodeChange + readOnly"——但实际代码没做到。
- **High 2（解散分组 admin-only 数据层缺）**：我在 GroupPropertiesPanel 按钮加了 `disabled={!isAdmin}`，但 useFlowOperations.onUngroup 只查 canEditNodeData（admin 默认放行），没有专门的 user.role==='admin' gate。其它入口（快捷键、未来新 UI）一旦绕过详情面板按钮，"分组作者解散自己分组"就会成立，与 06-范围审查定调的 admin-only 不一致。
- **Medium 1（fieldset 边界）**：fieldset disabled 是浏览器原生属性，会无差别 disabled 所有 button/input。如果 DeprecateNodeSection 实际在 fieldset 内部，按钮也会被 disabled，公开权限直接消失。**这条要立即核实**。
- **Medium 2（边 fallback）**：canEdit fallback 到 canvasWritable 对边正确，但建议加注释 + 轻量测试锁定。
- **Low（游客横幅）**：user=null 且 readOnly=true 时显示黄色横幅，但依赖上游保证 user=null 必伴 readOnly=true。建议在 prop 注释或运行时显式约束。

**关键诊断**：High 1 + Medium 1 是同一个根因——**我的 fieldset 实际包到了 NodePropertiesPanel 的整个 tab-content，而 DeprecateNodeSection 在 NodeDetailPanel 顶层，不在 NodePropertiesPanel 内**。所以 fieldset 没误伤标废弃按钮。但 safeOnNodeChange 这个回调被传给了 NodePropertiesPanel（disabled 后无所谓）和 DeprecateNodeSection（!）—— DeprecateNodeSection 收到的是 safeOnNodeChange 不是原始 onNodeChange，**所以 High 1 是真的**。

修法：让 DeprecateNodeSection 直接传 `canvasWritable ? onNodeChange : (() => undefined)` —— 不走 canEdit 那条路。

**第二层：技术细节（codex 原话）**

> codex-cli 0.128.0 / advice-only / confidence: medium
> 实际耗时：68 秒（预估 30-90 秒，命中）
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260504_215246.json`
> 上下文文件（3 份）：本轮 patch + 20-九审 + 06-范围审查 — 均成功载入

**High 1：标废弃公开权限回调被 canEdit 层 no-op 吞掉**

[NodeDetailPanel/index.tsx](E:/业务全景图/src/components/NodeDetailPanel/index.tsx) DeprecateNodeSection 回调链路：代码注释写明 DeprecateNodeSection 不应被 canEdit 包裹，但本 diff 中普通节点面板仍把 onNodeChange={safeOnNodeChange} 传入 NodePropertiesPanel；而 safeOnNodeChange 在 canEdit=false 时是 no-op。若 DeprecateNodeSection 仍通过该回调触发 is_deprecated 更新，普通用户对他人节点的标废弃会被详情面板层提前吞掉，破坏 P3C 的公开权限。

**修法**：把普通编辑回调和公开标废弃回调显式拆开：普通属性/样式/截图等继续用 canEdit gate；DeprecateNodeSection 使用 canvasWritable/readOnly gate 下的原始 onNodeChange，依赖中心层 isPublicDeprecateUpdate 放行。建议新增一个组件级用例：非作者、非管理员、readOnly=false 点击标废弃时必须调用 onNodeChange。

**High 2：解散分组 admin-only 数据层缺失**

[NodeDetailPanel/index.tsx](E:/业务全景图/src/components/NodeDetailPanel/index.tsx) 与 [GroupPropertiesPanel.tsx](E:/业务全景图/src/components/NodeDetailPanel/GroupPropertiesPanel.tsx) onUngroup：解散分组 admin-only 目前在详情面板里通过 disabled 和 safeOnUngroup=isAdmin 控制，但 brief 同时说明 useFlowOperations.onUngroup 只有 canEditNodeData 检查，没有专门 admin-only 检查。这样其它调用入口、测试入口或未来 UI 入口仍可能让分组作者解散自己的分组，和 06-范围审查定调的 admin-only 语义不一致。

**修法**：在数据层入口 useFlowOperations.onUngroup 增加明确的 user.role==='admin' gate，且拒绝路径必须早于 setNodes/saveHistory/autosave。补一个测试：普通作者对自己创建的 group 调用 onUngroup 不应产生节点 parentId 变更或历史保存。

**Medium 1：fieldset disabled 边界**

[NodePropertiesPanel.tsx](E:/业务全景图/src/components/NodeDetailPanel/NodePropertiesPanel.tsx) fieldset disabled：fieldset disabled 包住整个 tab-content 会禁用其中所有 button/input/select/textarea。如果 DeprecateNodeSection、截图上传/删除、页面选择、样式按钮等任一"例外权限"组件位于 tab-content 内，它们会被浏览器原生 disabled 直接拦截，React 回调层无法再按更细权限放行。

**修法**：确认 DeprecateNodeSection 不在 disabled fieldset 内；若在，必须移出或为普通编辑区单独包 fieldset。建议锁定：非作者可见并可点击标废弃按钮，但普通编辑控件 disabled。

**Medium 2：边 canEdit fallback**

[NodeDetailPanel/index.tsx](E:/业务全景图/src/components/NodeDetailPanel/index.tsx) canEdit fallback：selectedElement.type==='edge' 时 canEdit fallback 到 canvasWritable 的口径是合理的，因为边当前没有 creator 语义；但需要确保边详情面板没有被节点级 fieldset/canEdit 误包。

**修法**：保持边编辑只受 canvasWritable 控制，并补注释或轻量测试：非作者选中边时，边属性编辑不因节点 creator 权限被禁用。

**Low：游客横幅**

[NodeDetailPanel/index.tsx](E:/业务全景图/src/components/NodeDetailPanel/index.tsx) 游客横幅：user=null 且 readOnly=true 时只显示黄色只读横幅，符合游客路径预期；但这依赖上游保证游客 readOnly=true。

**修法**：可在 prop 注释中写明 user=null 必须伴随 readOnly=true，或在蓝色横幅条件里显式要求 !!user。

---

**Claude 判断**

| # | codex 意见 | Claude 判断 | 理由 |
|---|---|---|---|
| H1 标废弃 safeOnNodeChange 吞掉 | **必修** | 真漏洞、修法明确、代价 5 行：把 DeprecateNodeSection 的 onNodeChange 单独走 `canvasWritable ? onNodeChange : (() => undefined)` 而不是 safeOnNodeChange |
| H2 onUngroup 数据层 admin-only | **必修** | UI 层 disabled 是装饰，数据层才是真防护。useFlowOperations.onUngroup 已 import canEditNodeData + user，加一个 `if (user?.role !== 'admin') return` 即可，5 行 |
| M1 fieldset 边界确认 | **核实即可** | 我自己验证：fieldset 在 NodePropertiesPanel 内部，DeprecateNodeSection 在 NodeDetailPanel 顶层（兄弟节点不是子节点）—— 实际**没有**误伤。但 codex 提醒值得：补一句 JSDoc 注释 "DeprecateNodeSection 必须在 fieldset 外部" |
| M2 边 fallback 注释 | **加注释 + 1 个测试** | canEdit 拆分逻辑里加注释说明边的边界 |
| L1 游客 user=null 必伴 readOnly=true | **加注释** | 在 NodeDetailPanel 的 user prop JSDoc 加一行约束声明 |

**修复方案**

- High 1：DeprecateNodeSection 收到的 onNodeChange 改成 `canvasWritable ? onNodeChange : (() => undefined)`，不走 canEdit
- High 2：useFlowOperations.onUngroup 加 `if (user?.role !== 'admin') return`
- Medium 1：JSDoc 注释 "DeprecateNodeSection 必须在 fieldset 外部"
- Medium 2：canEdit useMemo 注释 + （可选）补一个 helper 单测锁定边的 fallback
- Low：user prop JSDoc 补 "user=null 必伴 readOnly=true" 约定

**用户决策**

按 Claude 判断全部采纳（用户原话："继续"）。

**修复结果**

| 修复 | 位置 | 状态 |
|---|---|---|
| H1 DeprecateNodeSection 走 canvasWritable | [NodeDetailPanel/index.tsx](E:/业务全景图/src/components/NodeDetailPanel/index.tsx) 新增 safeOnDeprecateChange | ✅ |
| H2 useFlowOperations.onUngroup admin-only 数据层 gate | [useFlowOperations.ts](E:/业务全景图/src/hooks/useFlowOperations.ts) onUngroup 顶部 `if (!canvasWritable) return; if (!user || user.role !== 'admin') return;` | ✅ |
| M1 fieldset 边界注释 | NodeDetailPanel.tsx DeprecateNodeSection 渲染处 | ✅ |
| M2 边 canEdit fallback 注释 | NodeDetailPanel.tsx canEdit useMemo | ✅ |
| L1 user=null 必伴 readOnly=true 约定 | NodeDetailPanel user prop JSDoc | ✅ |
| step 9 RTL 集成测占位（H1/H2 两项） | canEditNode.test.ts 末尾清单第 5/6 项 | ✅ |
| 测试 | npm test 74/74 全过 + tsc 0 错 | ✅ |

二审 codex 报告见 [22-二审](./22-二审-P3D-2-step4-公开权限+admin-only.md)。

**门禁结论**

修复完成 → 二审通过 → 可进 step 5。
