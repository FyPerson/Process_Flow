# 阶段 5 合并算法 4 天 MVP

| Day | 主题 | 状态 | 版本 | 归档 |
|---|---|---|---|---|
| Day 1 | 基建（类型 + computeDelta + schema parentId 真校验） | ✅ 完工 2026-05-06 | v1.12.0 | [Day1-基建/](Day1-基建/) |
| Day 2 | 合并算法（detector + applyDelta + tryMerge + saveCanvas 接合并） | 🔄 进行中 | - | [Day2-合并算法/](Day2-合并算法/) |
| Day 3 | 客户端（merged 响应 + 状态替换 + conflict_logs 写入） | ⏳ 待启动 | - | - |
| Day 4 | 真冲突 UI + Playwright + 部署 | ⏳ 待启动 | - | - |

## 关键决策快速索引

- [Day 1 11 项决策（取舍审）](Day1-基建/02-拍板记录.md)
- [Day 1 99-收尾](Day1-基建/99-收尾.md)
- [Day 2 7 判断点 + 4 新增风险](Day2-合并算法/03-拍板记录.md)

## codex 协作模式（Windows sandbox 1326 解决方案）

阶段 5 Day 2 取舍审实战发现 `codex exec --sandbox read-only` 在 Windows 上启 PowerShell 子进程一律 1326（CreateProcessWithLogonW failed）。

**根治写法**：

```bash
# ❌ 错误：codex 自己 spawn 读文件——sandbox 1326
codex exec --skip-git-repo-check --sandbox read-only \
  -o /tmp/codex-result.md \
  "$(cat /tmp/codex-prompt.txt)"  # 仅 brief + 文件路径

# ✅ 正确：本地 cat 文件内容前置到 prompt + stdin 注入避开 ARG_MAX
codex exec --skip-git-repo-check --sandbox read-only \
  -c MaxContextChars=180000 \
  -o /tmp/codex-result.md - \
  < /tmp/codex-prompt-with-files.txt  # 含全部所需文件内容
```

详见 [Day2-合并算法/03-拍板记录.md § codex 协作模式沉淀](Day2-合并算法/03-拍板记录.md#codex-协作模式沉淀应用到-codex-cli-bridge-skill)。
