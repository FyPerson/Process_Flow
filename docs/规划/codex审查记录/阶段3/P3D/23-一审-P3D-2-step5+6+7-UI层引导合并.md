**第一层：非技术总结**

**还差 1 个 medium CSS 修正才能进 step 8**。codex 给 1 medium + 3 low，门禁判断"修掉 CSS 叠加问题后可进 step 8"。

合并做 step 5+6+7（节点级 draggable / 分组快捷键提示 / 删除入口拆分）codex 整体方向认可，但抓出一个 CSS 视觉回归 bug：

- **Medium（CSS 叠加）**：我加的 `.not-editable { opacity: 0.85 }` **没和 `.is-deprecated { opacity: 0.5 }` 相乘**——CSS 不在同一元素相乘，而是后声明 + 更具体的选择器**覆盖**。结果"已废弃 + 不可编辑"的节点会从 0.5 被提亮到 0.85，比单纯废弃还显眼，违反 P3C 废弃语义。

- **Low 1（Ctrl+G UI 层用 `__canEdit` 而不是同源调 canEditNodeData）**：与 handleDelete 同源调不一致。建议改成同源 + 注释明确"派生字段仅 fast path、底层 gate 是唯一可信边界"。

- **Low 2（删除部分成功语义）**：选不可编辑节点 + 相连边时，边会被删但节点保留 —— 这是允许的（边走 canvasWritable）但 confirm 文案没说清楚。建议补"选中的连线仍会删除，即使连接到被跳过的节点"。

- **Low 3（删除 alert 与详情面板横幅重复）**：删除入口 alert 服务键盘 + 顶部按钮，详情面板蓝色横幅服务详情面板视图——不冗余，可保留，但建议文案短一些。

**第二层：技术细节（codex 一审原话）**

> codex-cli 0.128.0 / advice-only / confidence: medium
> 实际耗时：44 秒（预估 30-90 秒命中）
> 原文 wrapper：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260504_230628.json`
> 上下文文件（2 份）：本轮 patch + 22-二审 — 均成功载入

**Medium：not-editable 与 is-deprecated opacity 组合态覆盖**

[CustomNode/styles.css:582 + GroupNode/styles.css:139]：新增 `.not-editable > * { opacity: 0.85 }` 可能覆盖已有 `.is-deprecated` 的 0.5 透明度，而不一定是注释里描述的 `0.5 + 0.85` 叠加。CSS 的 opacity 不会在同一元素上相乘；如果两个规则都命中同一个直接子元素，后声明且选择器更具体的 `.not-editable` 很可能把废弃节点从 0.5 提亮到 0.85。

**修法**：显式排除废弃状态，或为组合态单独声明。例如 `.custom-flow-node.not-editable:not(.is-deprecated) > *:not(...) { opacity: 0.85; }`，分组节点同理；若确实要组合更暗，则加 `.custom-flow-node.is-deprecated.not-editable > *:not(...) { opacity: 0.5; }` 或目标值。

**Low 1：Ctrl+G UI 层依赖派生字段**

[FlowCanvas/index.tsx:837]：Ctrl+G 的 UI 前置检查只判断 `__canEdit === false`。如果某条导入或构造路径漏派生 `__canEdit`，这里会放过快捷键提示，用户会遇到底层 `onCreateGroup` 静默拒绝或行为不一致。

**修法**：UI 层也可直接调用 `canEditNodeData(n.data, user, !readOnly)`，与 handleDelete 保持同源。若保留派生字段，应在注释里明确这是仅用于提示的 fast path，底层 gate 是唯一可信边界。

**Low 2：删除部分成功语义**

[FlowCanvas/index.tsx:753]：删除改为部分成功后，若选中不可编辑节点及其相连边，确认后边会被删除但节点保留。业务上这是允许的，因为边按 canvasWritable 删除；但用户可能以为被跳过节点的相关连线也会保留。

**修法**：确认文案补一句"选中的连线仍会删除，即使连接到被跳过的节点"，或在实现中只删除显式选中的边并确保文案说清楚。

**Low 3：删除入口 alert 与详情面板蓝色横幅重复**

[FlowCanvas/index.tsx:759]：全部不可编辑且无边时的 alert 与详情面板蓝色横幅有重复，但它覆盖的是键盘/顶部按钮删除入口，属于不同入口的即时反馈，不构成阻塞。

**修法**：可以保留；建议文案保持短一些，避免频繁键盘操作时打断感过强。

---

**Codex 对 7 个关注点的回应（原话）**

1. **draggable 跟随 BFV 派生刷新合理**，前提是 useMemo deps 含 user/canvasWritable（已确认 ✓）
2. **CSS 组合态修最值得修**——实际风险不是过暗，而是废弃节点被提亮
3. **UI 层依赖派生 + 数据层兜底双层模型合理**，但快捷键提示建议改同源
4. **删除"可删的删、不可删的跳过"符合内部小团队场景**，比 all-or-nothing 少阻塞——需要文案说清楚
5. **删除入口 alert 不冗余**，服务键盘和工具栏入口
6. **仅凭本 patch 不能完整证明没漏直写 setNodes**，已知 undo/redo 挂 step 9 可接受
7. **修掉 CSS 组合态后可判定通过进入 step 8**

---

**Claude 判断**

| # | codex 意见 | Claude 判断 | 理由 |
|---|---|---|---|
| Medium CSS 组合态 | **必修** | 真 bug，违反 P3C 废弃语义。修法选项 A：`.not-editable:not(.is-deprecated)` 排除废弃；选项 B：组合态独立声明 `.is-deprecated.not-editable { opacity: 0.5 }`。倾向 A —— 废弃语义优先（0.5 已经够淡），不可编辑只是次要标记 |
| Low 1 Ctrl+G 同源调 | **修** | 与 handleDelete 同源是好实践，且 5 行成本。把 `n.data.__canEdit === false` 改成 `!canEditNodeData(n.data, user, !readOnly)` |
| Low 2 删除文案补充 | **修** | confirm 文案改一句澄清"边仍删"，2 行成本 |
| Low 3 alert 文案短一点 | **不改** | 现有文案"选中的节点你不是创建者..."已经简洁；缩短反而模糊"用标废弃代替"的指引 |

**用户决策**

按 Claude 判断全部采纳（用户原话："开干"，开干流程含修复一审建议）。

**修复结果**

| 修复 | 位置 | 状态 |
|---|---|---|
| Medium CSS not-editable 排除 .is-deprecated | [CustomNode/styles.css](E:/业务全景图/src/components/CustomNode/styles.css) + [GroupNode/styles.css](E:/业务全景图/src/components/GroupNode/styles.css) | ✅ |
| Low 1 Ctrl+G UI 同源调 canEditNodeData | [FlowCanvas/index.tsx](E:/业务全景图/src/components/FlowCanvas/index.tsx) | ✅ |
| Low 2 handleDelete confirm 文案补充边仍删 | [FlowCanvas/index.tsx](E:/业务全景图/src/components/FlowCanvas/index.tsx) handleDelete | ✅ |
| Low 3 alert 文案 | 不改（Claude 判断 + codex 二审同意）| — |
| 测试 | npm test 74/74 + tsc 0 错 | ✅ |

二审 codex 报告见 [24-二审](./24-二审-P3D-2-step5+6+7-CSS组合态修复.md)。

**门禁结论**

修复完成 → 二审通过 → 可进 step 8。
