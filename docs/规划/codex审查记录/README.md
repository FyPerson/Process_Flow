# codex 审查记录索引

记录各阶段经历的 codex 审查、commit、评级、关键经验沉淀。

每个阶段有自己的 README 讲该阶段的故事；本文只做**跨阶段索引**。

## 阶段 2 ✅ 已完成（2026-04-30 P2J 验收通过）

| 子阶段 | 范围 | 轮次 | 评级 | 详情 |
|---|---|---|---|---|
| [P2H](./P2H/) | 保存 UI + 自动保存 + 冲突状态机 + readOnly 全入口禁写 | 8 | 90% production-ready | [P2H/README.md](./P2H/README.md) |
| [P2I](./P2I/) | 导出/导入 JSON UI + 冲突逃生口本地副本 | 3 | 88%→修复后通过 | [P2I/](./P2I/) |
| [P2J](../../规划/P2J测试/) | Playwright 端到端验收 | — | 17/20 PASS（剩 3 个测试脚本可靠性问题） | [P2J测试/README.md](../P2J测试/README.md) |

阶段 2 累计 **18 个 commit + 11 轮 codex 审查 + Playwright 端到端测试**。详见 [`docs/规划/多人协作-方案.md`](../多人协作-方案.md) 阶段 2 验收章节。

## 阶段 3+

（待开始）

---

## 维护方式

- 每个阶段开始审查前，先建子目录 `docs/规划/codex审查记录/<阶段标识>/`（如 `P2H` / `P3X`）
- 阶段内的具体审查记录用编号命名：`<NN>-<轮次>-<commit>-<主题>.md`
- 阶段结束后写 `<阶段>/README.md` 做该阶段叙事 + 经验沉淀
- 在本 README 添加一行索引指向新阶段

详细操作流程见 [`.claude/skills/deploy/SKILL.md`](../../../.claude/skills/deploy/SKILL.md) "codex 审查归档流程"章节。
