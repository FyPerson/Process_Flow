# 01-codex审 — #35「加载画布即推 baseline +1」长期修法方案选择

- 日期：2026-05-08
- 阶段：P5 Day 5 挂账偿还（阶段 5 完工后债务偿还，#33/#34 在 Day 4 已偿还，本轮偿还 #35/#36）
- 类型：spec-critique / advice-only
- codex version：codex-cli 0.128.0
- 用户拍板：**整体采纳 codex 推荐——走方案 B + L1 改写挂账 + 补回归测试**

## 第一层：非技术总结

#35 原挂账描述把源头指向 useDraftAutosave，但 Claude 二次调查发现真因在 BFV 节点构造时未把服务端 size 注入 React Flow style。codex 验证 Claude 判断方向正确，并校正了表述细节——不是"测量值写回 style.width/height"，而是"普通节点丢失持久化 size 作为 React Flow 初始尺寸，反向同步时 convertNodesToStorage 从 style/measured/default 重新派生 size，造成加载即 dirty"。

codex confidence=high 推荐方案 B（在 BFV 普通节点构造时注入 `style.width/height`），原因：与 group 节点已有处理对称、改动最小局部、不影响合并不变量。明确不推荐方案 A（时间窗会吞用户真实编辑）和方案 B'（双源真值复杂度）。

落地需注意 number guard（不用 `||` 防 0 被吞），并补回归测试覆盖"加载后 updateSheetData 不 markDirty"。

## 第二层：codex 原话技术细节

### Summary

> 基于给出的代码，Claude 对主因方向的判断基本成立：无编辑 version +1 更像是 useMultiCanvas 的 5s 主版本 autosave 被 React Flow 反向同步触发，而不是 useDraftAutosave 的 30s draft PUT。推荐优先采用方案 B，但需要把问题表述从"style 被回写"修正为"普通节点未把持久化 size 注入 React Flow 节点，convertNodesToStorage 又从 style/measured 反推出 size"。

### Issues

#### high (2)

**H1 — `src/pages/BusinessFlowVisualization/index.tsx 普通节点构造 + src/hooks/useMultiCanvas.ts convertNodesToStorage`**（other）

> problem：候选方案 B 的根因描述大方向正确，但细节需要校正：给出的 convertNodesToStorage 代码并不要求 React Flow 一定把测量值写入 node.style.width/height；即使 measured 被 autoSaveFilter 过滤，size 字段仍会通过 node.measured?.width/height fallback 进入 storage。真正危险点是普通节点没有把服务端持久化的 node.size 注入到 React Flow 节点的 style 宽高，导致反向同步时用 DOM 测量值或默认值重算持久化 size。
>
> suggestion：技术债务和修法说明中把"测量值写回 style.width/height"改成"普通节点丢失持久化 size 作为 React Flow 初始尺寸，反向同步时 convertNodesToStorage 从 style/measured/default 重新派生 size，造成加载即 dirty"。落地 B 时在普通节点构造中注入 `style: { ...node.style, width: node.size?.width ?? node.style?.width, height: node.size?.height ?? node.style?.height }`，并注意 fallback 顺序不要让旧 style 覆盖 storage size。

**H2 — `src/components/FlowCanvas/index.tsx onDataChange effect`**（edge-case）

> problem：FlowCanvas 在 `[nodes, edges]` effect 中无条件把内部 nodes/edges 反向同步给 useMultiCanvas。即使方案 B 修复普通节点尺寸，仍需确认初次 mount 的 onDataChange 不会因为 React Flow 注入 measured、internals、selected、dragging、positionAbsolute 等运行时字段导致 storage 差异。当前 autoSaveFilter 过滤了一部分字段，但 size 是显式计算字段，仍是主要触发源。
>
> suggestion：方案 B 后补一个回归用例覆盖"从服务端 row.data 构造普通节点并立即 updateSheetData 不 markDirty"。如果现有 FlowCanvas 还会在 mount 后产生非尺寸差异，再针对具体 storage 字段过滤，而不是加时间窗吞改动。

#### medium (4)

**M1 — 候选方案 A**（contradiction）

> problem：A 的"加载稳定窗"与保存语义冲突：窗口期内真实用户编辑会被吞，而且 N ms 是经验值，无法证明 React Flow 测量、字体加载、面板布局变化都在窗口内完成。它只是掩盖 dirty 来源，不修正持久化 size 的数据流。
>
> suggestion：不建议作为主修法。最多作为临时止血开关，且需要明确仅过滤"仅 measured/size 归一化导致的差异"，不要简单跳过所有 updateSheetData 或 markDirty。

**M2 — 方案 B 落地说明**（missing-constraint）

> problem：方案 B 需要明确 width/height 的值域和类型。StorageNode.size 在 convertNodesToStorage 中按 number 保存，但部分 group expandedSize 支持 number|string；如果普通节点历史数据里 size 缺失、为 0、或被错误写成字符串，直接注入 style 可能造成布局异常或 React Flow 尺寸无效。
>
> suggestion：普通节点注入时只接受有限 number：`const width = typeof node.size?.width === 'number' ? node.size.width : undefined`，height 同理；缺失时保持现有 fallback。不要用 `||`，否则合法的 0 会被吞，虽然 UI 上 0 可能也应由 schema 禁止。

**M3 — `src/components/CustomNode/index.tsx NodeResizer`**（edge-case）

> problem：方案 B 通常不会破坏 NodeResizer 的 isVisible 逻辑，因为可见性只依赖 selected/readOnly/__canEdit；但它会改变 Resize 的初始基准：普通节点从"内容自然测量尺寸"变成"持久化尺寸"。这正是修复目标，但可能暴露历史数据里不准确 size 的显示问题。
>
> suggestion：落地后重点验证：加载已有画布后节点尺寸是否与保存前一致；拖拽 NodeResizer 后 convertNodesToStorage 是否仍把新 style.width/height 保存；刷新后新尺寸是否稳定；只读节点不可 resize 的行为不变。

**M4 — 候选方案 B'**（other）

> problem：B' 引入 data.__originalSize 等双源真值，会让持久化 size、React Flow style/measured、NodeResizer 输出之间产生同步义务。尤其用户 resize 后如果忘记更新 __originalSize，会丢失真实尺寸修改。
>
> suggestion：不推荐 B'。除非已经确认方案 B 会破坏渲染，否则不要把原始 storage size 藏进 data 再在 convertNodesToStorage 特判。

#### low (2)

**L1 — 技术债务登记 #35**（readability）

> problem：原挂账把源头指向 useDraftAutosave，容易误导后续修复去改 30s 草稿保存。给出的 useDraftAutosave 首次 tick 确实建立 baseline 并 return，不会 PUT draft；同时 5s autosave 依赖 dirty，符合现象中的 v+1 主版本推进。
>
> suggestion：改写为：加载服务端画布后，BFV 普通节点未把持久化 size 注入 React Flow style，FlowCanvas mount/测量触发 onDataChange，convertNodesToStorage 用 style/measured/default 重算 size，updateSheetData 判定节点变化并 markDirty，5s 后 useMultiCanvas.save 推进主版本 version。useDraftAutosave 不是主因。

**L2 — 阶段 5 B 方案合并不变量**（other）

> problem：A/B/B' 本身都不直接推进 serverVersionRef，也不改变 save() 的 merged defer/apply 逻辑；但 A 如果吞掉真实用户编辑，会让 projectRef 未包含用户意图，间接影响后续合并输入。B' 如果丢 resize，也会让合并基线内容与用户看到的内容产生偏差。
>
> suggestion：从合并不变量角度，B 风险最低：它只让加载后的 projectRef 与 React Flow 初始节点尺寸一致，不改变 serverVersionRef 推进策略。避免采用会跳过真实 updateSheetData 的时间窗方案。

### Recommendations

1. 推荐方案 B，confidence=high。它最贴合当前代码的数据流，改动局部，能直接消除普通节点加载后尺寸归一化导致的假 dirty，并且与 group 节点已有处理对称。
2. 不推荐方案 A 作为长期修法；它会吞窗口期真实编辑，且窗口长度不可证明。
3. 不推荐方案 B'；它引入双源真值，后续 NodeResizer、导入、复制、合并都要维护额外同步规则。
4. 建议补客户端回归测试：服务端普通节点含 size 但 style 无 width/height 时，BFV 构造出的 React Flow node 应带 style.width/height；随后 updateSheetData 不应 markDirty 或改变 project。另补 resize 后 size 能保存并刷新稳定的测试。

### Risks

1. 历史画布中 size 数据不准确时，方案 B 会忠实显示历史 size，而不是让内容自然撑开；这可能被用户感知为节点尺寸变化。
2. 如果 CustomNode CSS 对固定 width/height 下文本溢出处理不好，注入尺寸后可能出现截断或布局压缩，需要视觉回归。
3. 如果普通节点的 node.style 本身已有 width/height 且与 node.size 冲突，需要明确以持久化 size 为准，否则问题可能继续存在。
4. FlowCanvas 全文件未完整提供，无法排除还有其他 mount 后反向同步字段触发 dirty；需要 Claude 在落地前读完整 FlowCanvas/useFlowHandlers 的 nodes change 处理。

### Notes for Claude Code

> 落地时优先做最小补丁：只改 BFV 普通节点构造的 style 宽高注入，并保持 group 逻辑对称。用 number guard，避免字符串或缺失 size 直接进 style。不要改 useDraftAutosave。补测时不要依赖 5s 定时器，直接验证构造节点和 updateSheetData 的 dirty/project 结果；若必须测集成路径，用 fake timers。另请检查 src/components/FlowCanvas/index.tsx 和 useFlowHandlers，确认没有 selected/measured/internals 之外的运行时字段进入 storage。

### Confidence

high

---

## 原始文件路径

- prompt：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\prompt-35.txt`
- final.txt：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_spec-critique_20260508_131807.final.txt`
- json wrapper：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_spec-critique_20260508_131807.json`
- raw jsonl：`C:\Users\FY\AppData\Local\Temp\codex-bridge-workspace\runs\codex_spec-critique_20260508_131807.raw.jsonl`

---

## 用户决策（2026-05-08 整体拍板）

**整体采纳 codex 推荐**，走以下三件事：

1. **方案 B 落地**：BFV 普通节点构造时注入 `style.width/height`（按 H1 + M2 的细节要求——number guard，不用 `||`）
2. **L1 改写挂账**：技术债务登记 #35 改写为"BFV 普通节点未把持久化 size 注入 React Flow style → 反向同步时 convertNodesToStorage 重算 size 触发 markDirty → 5s autosave 推主版本"
3. **补回归测试**：覆盖"从服务端 row.data 构造普通节点并立即 updateSheetData 不 markDirty"（不依赖 5s 定时器）

H2 验证步骤纳入 Claude 落地前的检查清单（grep selected/measured/internals 之外的运行时字段是否进入 storage）。M3 视觉回归列入用户实测验收点。

A 方案、B' 方案不采纳；理由记录在归档。

---

## Claude 落地动作（2026-05-08 Day 5 挂账偿还落地完成）

### 代码改动

1. 新增 [src/pages/BusinessFlowVisualization/buildNodeStyleWithPersistedSize.ts](../../../../../../src/pages/BusinessFlowVisualization/buildNodeStyleWithPersistedSize.ts)（37 行）
   - 纯函数：`(inlineStyle, size) → React.CSSProperties`
   - codex H1 fallback 顺序：持久化 size 优先于 inlineStyle width/height
   - codex M2 number guard：`typeof size?.width === 'number'` 而非 `||`，防合法的 0 被吞 / 字符串污染 style
2. 新增 [src/pages/BusinessFlowVisualization/buildNodeStyleWithPersistedSize.test.ts](../../../../../../src/pages/BusinessFlowVisualization/buildNodeStyleWithPersistedSize.test.ts)（9 case / 478→487）
   - number / 0（防 || 写法）/ 缺失 / 字符串 / fallback 顺序 / 装饰字段保留 / 回归核心 7 个矩阵
3. [src/pages/BusinessFlowVisualization/index.tsx](../../../../../../src/pages/BusinessFlowVisualization/index.tsx) 普通节点构造改用 helper：`style: buildNodeStyleWithPersistedSize(node.style, node.size)`
4. **#36 同轮顺手做**：[tmp-test/test-p5-day4-conflict-flow.py](../../../../../../tmp-test/test-p5-day4-conflict-flow.py) P2.10 toast 采样前移 + 兜底 WARN→FAIL（tmp-test/ 在 .gitignore，不入仓）

### 验证结果

- npm test 478 → **487**（+9 全过）
- tsc 三端 0 错（client / server / test）
- lint:ids + check:invariants + check:conflict-guards + typecheck:test 全过

### 文档同步

- 技术债务登记 #35 / #36 整条移到底部"已偿还"段，含真因校正说明（codex L1）
- 本归档（Day5-挂账偿还/01-codex审-35加载即推baseline.md）

### 待用户实测后再 bump 部署

按 CLAUDE.md "动手前 reality check 反幻觉原则"+ "npm test 全过 ≠ 修对真路径"——v1.16.2 → v1.16.3 同日同款踩过。

**实测路径**（部署前必跑）：
1. admin 登录创公共画布 + 加节点 + publish
2. user01 登录打开该画布
3. 静止 35s 不操作（覆盖 5s autosave + 30s draft autosave 两个周期）
4. 验收：不应弹"画布加载失败 forbidden_modify_others_node" 或 forbidden_remove Toast
5. GET `/api/canvases/:id` 看 version 仍在 baseline（不应推进 +1）

实测通过 → bump v1.16.4 / 部署生产 / 闭环。

