**第一层：非技术总结**

**还不能进 step 4。** 四审的 4 项修复中 3 项已闭环（replace ID 错配、handleDelete 同源判权、测试改名），但 add ID 唯一性还差一层：之前修了"add 不能复用现有节点 ID"，但忘了**同一批操作里多个 add 互相之间也不能 ID 重复**——比如一次粘贴 5 个节点，攻击者构造其中 2 个 ID 一样，目前会全部放行。

另外 codex 还指了 2 个 medium：admin 路径 ID 完整性校验做得不够全 / handleGroupChange 找不到目标节点时没有早退。

**第二层：技术细节（codex 原话）**

**High：add 同批重复 ID 未拦**

[canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) `filterNodeChangesByPermission` add 分支：`add` 只检查 `item.id` 是否与当前 `nodes` 重复，未检查同一个 `changes` 数组内多个 `add` 使用相同新 ID 的情况。两个重复新 ID 都不存在于当前 `nodes` 时会同时通过过滤，可能导致应用后出现重复节点 ID、覆盖或 React Flow 状态异常；admin 路径同样受影响。

**修法**：在过滤前预扫描本批 `add` 的 `item.id` 计数，`id` 为空、非字符串或计数大于 1 的 `add` 全部拒绝；同时用 `Set(nodes.map(n => n.id))` 检查现有 ID。补测试：普通用户和 admin 在同一批中提交两个相同新 ID 的 `add`，应全部拒绝或至少保证最终只放行一个且行为明确。

**Medium 1：admin 短路前的 ID 校验不全**

`replace` 的 `item.id === change.id` 已在 admin 短路前校验，但 admin 的 `replace` 仍不要求目标节点存在；`position`、`dimensions`、`remove` 对 admin 也会在缺少有效目标校验前直接放行。多数情况下下游可能只是 no-op，但这与"数据完整性约束 admin 也执行"的原则不一致。

**修法**：将通用的 `id` 类型、非空、目标节点存在校验提升到 admin 短路前；至少对 `replace` 先确认 `nodes` 中存在 `change.id`，对 `position`、`dimensions`、`remove` 也要求有效 string ID 且目标存在。补 admin 缺 ID、ghost ID 的测试。

**Medium 2：handleGroupChange 找不到目标时没早退**

[FlowCanvas/index.tsx](E:/业务全景图/src/components/FlowCanvas/index.tsx) `handleGroupChange` 在找不到目标分组节点时不会早退，而是继续执行 `setNodes(...map...)` 和 `triggerAutoSave()`。这会让无效或过期的分组更新触发一次无意义状态更新和自动保存，和注释里"拒绝路径必须在所有 setState 之前"的目标不完全一致。

**修法**：在 `targetNode` 不存在时立即 `return`；再对存在的目标执行 `canEditNodeData`。同时补一个目标不存在时不调用更新和保存的用例。

**修复方案（待修）**

| 严重度 | 修复 | 预计 |
|---|---|---|
| 🔴 high | add 分支：预扫描本批 changes，统计 item.id 计数，重复（>1）或与现有 nodes 同 ID 全拒 | 10 分钟 |
| 🟡 medium 1 | 通用 ID 校验提到 admin 短路前（id 非空 + nodes 中存在/不存在的语义统一） | 5 分钟 |
| 🟡 medium 2 | handleGroupChange targetNode 不存在时早退（在 setNodes 和 triggerAutoSave 之前） | 3 分钟 |
| 测试 | 同批重复 add（普通用户 + admin）/ admin replace ghost / handleGroupChange ghost | 10 分钟 |

**Claude 判断**

全修。理由：

1. **High 是真漏洞**：粘贴/批量创建路径就是同批多个 add，5 个节点 ID 相同的场景虽然恶意构造才会出现，但 fail-closed 兜底很便宜（一个 Map 计数 + 几行预扫描）。
2. **Medium 1**（admin 通用 ID 校验）和 high 同源——把所有 ID 结构校验提到 admin 短路之前，admin 也走完整性约束，逻辑更一致，重构成本低，可以一次改完。
3. **Medium 2**（handleGroupChange）虽然代码改 5 行，但是真路径漏洞——之前每轮 codex 都没看这个函数，这次抓到了。

**结论**

不能进 step 4。补完上述修复后进入六审。
