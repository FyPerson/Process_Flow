# 01 代码审查 — P3B 节点 ID 改 nanoid

- **审查类型**：code-review / advice-only
- **codex 版本**：codex-cli 0.128.0
- **调用时间**：2026-05-06 10:04
- **confidence**：medium
- **wrapper JSON**：`%TEMP%\codex-bridge-workspace\runs\codex_code-review_20260506_100333.json`

## 第一层（非技术总结）

codex 给 confidence=medium，方向认可（长度 10 + 字符集 + 5 处替换合理），可进提交候选。提了 1 medium + 3 low，主要是**回归保护**（没 lint 拦未来拼 Date.now）、**测试断言不一致**、**潜在嵌套引用字段未 remap**、**onAddNode 残留死代码**。门禁判断："可以进 commit + bump v1.10.0；三端部署前建议补全文搜索 + 持久化路径确认"。

## 第二层（codex 原话技术细节）

### 🟡 Issue 1（medium / edge-case）— 跨对象引用 remap 未完整覆盖

- **Location**：`src/hooks/useFlowClipboard.ts` / `src/hooks/useMultiCanvas.ts`
- **Problem**：粘贴和 duplicateSheet 路径只重写了节点自身 id、parentId、relatedNodeIds 以及 connector.sourceID/targetID，但如果节点 data/detailConfig/style 中还有业务字段直接引用旧 node.id，这些引用不会随 nodeIdMap 更新。当前提供文件无法确认是否存在这类字段；任务中特别提到 replace item.id 一致性，但 ids.test 只覆盖生成器格式和随机性，未覆盖跨对象引用一致性。
- **Suggestion**：检查 FlowNodeData、detailConfig、relatedNodeIds 之外是否还有节点引用字段。若存在，集中做一个 `remapCopiedNodeReferences(node, idMap)` helper，并在粘贴和 duplicateSheet 复用；端到端测试应断言复制后所有可导航/可替换引用都指向新 id，而不是旧 id。

### ⚪ Issue 2（low / missing-constraint）— 测试断言长度不一致

- **Location**：`src/utils/ids.test.ts`
- **Problem**：单测只验证 newNodeId 的总长度为 12，newGroupId/newEdgeId 没有同样验证长度。虽然正则已间接约束 10 位随机串，但长度断言不一致，未来 RANDOM_LEN 或前缀改动时可能漏报一部分生成器。
- **Suggestion**：给 newGroupId 和 newEdgeId 也补 `assert.equal(id.length, 12)`，并可额外断言三者均通过同一个 `^[nge]_[A-Za-z0-9_-]{10}$` 风格的 helper 校验。

### ⚪ Issue 3（low / readability）— onAddNode 残留死代码

- **Location**：`src/hooks/useFlowOperations.ts:onAddNode`
- **Problem**：onAddNode 内仍保留 `const currentNodes = setNodes instanceof Function ? [] : [];` 这段无效代码和注释。它与 P3B 无直接功能冲突，但会干扰后续审查者判断当前 nodes 来源，尤其本次正是在统一 ID 生成入口。
- **Suggestion**：删除这段无用变量和注释，保留 `nodes.map(...)` 的 existingNames 逻辑即可。

### ⚪ Issue 4（low / missing-constraint）— 缺 lint/CI 拦未来回归

- **Location**：工程门禁 / lint
- **Problem**：目前回归保护主要依赖单测和 Playwright，不能阻止未来开发者在业务代码中重新写入 `Date.now()` 拼 ID、`new_node_`、`group_`、`edge-` 或 `id: "node1"` 这类旁路生成。
- **Suggestion**：提交前至少加一个轻量脚本或 lint 检查：扫描 `src/` 中与节点/边/分组生成相关的 `Date.now()` 拼接、`new_node_`、`group_${`、`edge-${`、`copied_` 等模式。ESLint 自定义规则也可以，但对该项目规模，先用 CI 脚本更务实。

## Recommendations

1. **碰撞评估**：64 字符集、10 位随机串 = 60 bit 空间。同一前缀下 1000 个 ID 的生日碰撞概率约 4.3e-13；按 5000 ID 约 1.1e-11。对"单画布 <1000 节点、5 人并发、总用户 <100"足够，长度 10 不算不足。
2. 5 个主要生成口已覆盖。import/migration/fixture 是否还存在生成口无法完整确认（因为 server/schemas/canvas.ts 和 tmp-test/test-p3b-nanoid-ids.py 未提供正文），建议 Claude Code 再用全文搜索确认 `Date.now()`、`new_node_`、`group_`、`edge-`、`sheet_` 的语义边界。
3. 粘贴和 duplicateSheet 删除 index 本身不影响 nodeIdMap：映射是按旧 id 到新 id 建立，parentId、relatedNodeIds、connector.sourceID/targetID 的 remap 仍成立。需要关注的是是否还有未列入 remap 的嵌套业务引用字段。
4. **门禁判断**：在已声明 tsc、单测和 Playwright 全过的前提下，可以进 commit 和 bump v1.10.0；三端部署前建议补齐全文搜索记录或回归扫描脚本，并确认服务端 ShortIdSchema 对 12 位前缀 ID 的持久化路径已覆盖。

## Risks

1. nanoid 碰撞风险在当前规模下可以接受，主要实际风险是遗漏某个生成入口或嵌套引用字段未 remap。
2. 如果没有 lint/CI 扫描，未来直接拼 Date.now 或写固定 ID 的回归概率高于随机碰撞概率。
3. 服务端 schema 和端到端测试文件未展开，无法独立确认 ShortIdSchema 长度上限、严格字段过滤和持久化验证细节。

## notes_for_claude_code

本审查只基于提供的文件片段和任务说明，没有读取仓库全文、没有执行测试。建议在最终提交前做一次 `rg "Date\.now\(|new_node_|group_\$|edge-\$|copied_|id: ['\"]node" src server tests tmp-test` 类似的人工核对，并把结果写进提交说明或部署记录。

---

## Claude 判断 / 用户决策 / 落地动作

- ✅ **Issue 1（medium / 跨对象引用 remap）部分采纳** — grep + 类型审计验证 FlowNodeData/FlowDefinition.nodes/FlowConnector/GroupNodeData 引用其他节点 ID 的字段只有 3 个（parentId / relatedNodeIds / connector.sourceID/targetID），detailConfig/style 不含节点引用。**结论**：不需独立 remapCopiedNodeReferences helper（过度设计）。Playwright 加 case 4b 显式断言"指向当前 sheet 内"。**注**：二审揪出此修法不彻底（idMap 写了没用），二审/三审继续修。
- ✅ **Issue 2（low / 长度断言）采纳** — newGroupId/newEdgeId 各补 assert.equal(id.length, 12)
- ✅ **Issue 3（low / onAddNode 死代码）采纳** — 删 `const currentNodes = setNodes instanceof Function ? [] : []` + Hack 注释
- ✅ **Issue 4（low / lint 兜底）采纳** — 新增 scripts/check-id-generation.mjs + npm script lint:ids + 接到 npm test 前置；后续二审/三审/四审持续扩展
- 后续：触发 02 二审验证修法是否到位
