**第一层：非技术总结**

**还不能进 step 4。** 三审找到的 critical 已修，但 codex 四审挖出更深的"防呆"问题：节点 ID 一致性 / 唯一性。

- **High 1**：`replace` 改节点时，攻击者可以在 change 里写 `id='我自己的节点'` 但 `item.id='别人节点'` —— ID 错配会污染数据。需要校验 `item.id === change.id`。
- **High 2**：`add` 新增节点时，攻击者可以构造 `__localNew=true` 但 `id=已有别人节点的id` —— 造成 ID 重复 / 覆盖。需要校验"新 ID 不能与现有节点重复"（admin 也执行——这是数据完整性约束，不是权限例外）。
- **Medium**：`handleDelete` 只看 `__canEdit`，万一某个节点 `__canEdit` 没派生（undefined），仍会进入删除流程。改为同源调 `canEditNodeData`。
- **Low**：旧测试名"按 item.data.creator_id 过滤"已和现实现矛盾，要改名。

**第二层：技术细节（codex 原话）**

**High 1：replace 不校验 item.id === change.id**

[canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) `filterNodeChangesByPermission` replace 分支按 change.id 找原节点判权是正确方向，但没有校验 change.item 存在且 item.id === change.id。已获准编辑自己节点的用户如果构造 change.id='mine'、item.id='other'，可能把一次合法 replace 变成 ID 污染或重复 ID 写入，后续保存/索引逻辑如果按 id 合并会有越权或数据污染风险。

**修法**：replace 分支在判权前增加结构校验——必须有 item，必须 item.id === change.id；否则 fail-closed。

**High 2：add 不校验 ID 唯一性**

add 分支普通用户要求 __localNew===true 是必要修复，但没有校验 item.id 为新 ID。构造 add item.id 等于现有他人节点且 __localNew=true 时，可能绕过 replace 判权语义并制造重复 ID/覆盖风险。

**修法**：add 分支要求 item.id 是非空字符串，且 nodes 中不存在同 ID；这个唯一性约束建议 admin 也执行，因为它是数据完整性约束，不是权限例外。

**Medium：handleDelete 依赖派生字段不同源**

[FlowCanvas/index.tsx](E:/业务全景图/src/components/FlowCanvas/index.tsx) `handleDelete` 的 all-or-nothing 只检查 `__canEdit === false`；如果 `__canEdit` 尚未派生、派生丢失或陈旧，仍会弹确认并调用 deleteElements。即使 wrappedOnNodesChange 后续拦截，也可能出现确认删除 N 个但实际只删部分节点的体验和历史/自动保存边界问题。

**修法**：handleDelete 直接复用 `canEditNodeData(n.data, user, !readOnly)` 做 selectedNodes 全量判定，不要只依赖 __canEdit。

**Low：测试名与实现矛盾**

[canEditNode.test.ts](E:/业务全景图/src/auth/canEditNode.test.ts) "replace 类型按 item.data.creator_id 过滤"测试名仍写"按 item.data.creator_id 过滤"，与当前实现"按原节点 data 判权"相矛盾。

**修复方案（待修）**

| 严重度 | 修复 | 预计 |
|---|---|---|
| 🔴 high | replace 前置：item 必存在 + item.id === change.id 否则 fail-closed | 5 分钟 |
| 🔴 high | add 前置：item.id 非空 + nodes 中无同 ID（admin 也执行） | 5 分钟 |
| 🟡 medium | handleDelete 改用 canEditNodeData 同源判权 | 5 分钟 |
| ⚪ low | 测试名改"按原节点 creator_id 判权" | 1 分钟 |
| 测试 | replace ID mismatch / add duplicate id / handleDelete __canEdit undefined | 10 分钟 |

**Claude 判断**

全修。理由：
1. **越审越深，但都是真漏洞**。codex 这次提的 ID 一致性/唯一性确实是攻击面：合法用户拖出节点本来就不该指定 id（前端生成 nanoid/uuid），所以校验 `item.id === change.id` 和"add 不复用已有 id"对**正常路径零影响**，对恶意构造则关上。
2. **handleDelete 用 canEditNodeData 同源**比 `__canEdit` 派生字段更稳，且 useFlowOperations 那条路径（onUpdateGroupLabel）我之前就是这么做的，保持一致性。
3. **修复成本低**，每条 5-10 行，无架构改动。

**结论**

不能进 step 4。补完上述修复后进入五审。
