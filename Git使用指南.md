# Git 本地仓库使用指南

## 仓库状态

✅ **Git 仓库已初始化**  
📍 **位置**: `E:\业务全景图_google\.git`  
🌿 **当前分支**: `main`  
📝 **最新提交**: `feat: 分组功能完全修复 - 稳定版本`

## 常用 Git 命令

### 查看状态
```powershell
# 查看当前状态
git status

# 查看提交历史
git log

# 查看简洁的提交历史
git log --oneline

# 查看最近 5 次提交
git log --oneline -n 5
```

### 提交更改
```powershell
# 1. 查看修改的文件
git status

# 2. 添加所有修改的文件到暂存区
git add .

# 或者添加特定文件
git add src/components/FlowCanvas/index.tsx

# 3. 提交更改
git commit -m "描述你的更改"

# 例如：
git commit -m "fix: 修复分组节点拖动问题"
```

### 查看差异
```powershell
# 查看工作区的修改
git diff

# 查看暂存区的修改
git diff --staged

# 查看特定文件的修改
git diff src/hooks/useFlowOperations.ts
```

### 撤销更改
```powershell
# 撤销工作区的修改（危险操作！）
git checkout -- 文件名

# 撤销暂存区的文件（保留工作区修改）
git reset HEAD 文件名

# 回退到上一次提交（危险操作！）
git reset --hard HEAD^

# 回退到指定提交
git reset --hard 提交ID
```

### 分支管理
```powershell
# 查看所有分支
git branch

# 创建新分支
git branch feature/new-feature

# 切换分支
git checkout feature/new-feature

# 创建并切换到新分支
git checkout -b feature/new-feature

# 合并分支（先切换到主分支）
git checkout main
git merge feature/new-feature

# 删除分支
git branch -d feature/new-feature
```

## 推荐工作流程

### 日常开发
```powershell
# 1. 开始新功能前，创建新分支
git checkout -b feature/新功能名称

# 2. 进行开发...

# 3. 提交更改
git add .
git commit -m "feat: 实现新功能"

# 4. 切换回主分支
git checkout main

# 5. 合并新功能
git merge feature/新功能名称

# 6. 删除功能分支（可选）
git branch -d feature/新功能名称
```

### 修复 Bug
```powershell
# 1. 创建修复分支
git checkout -b fix/bug描述

# 2. 修复 bug...

# 3. 提交修复
git add .
git commit -m "fix: 修复XX问题"

# 4. 合并到主分支
git checkout main
git merge fix/bug描述

# 5. 删除修复分支
git branch -d fix/bug描述
```

### 创建里程碑
```powershell
# 为重要版本打标签
git tag -a v1.0.0 -m "版本 1.0.0 - 分组功能完全修复"

# 查看所有标签
git tag

# 查看标签详情
git show v1.0.0

# 回退到特定标签
git checkout v1.0.0
```

## 提交信息规范

建议使用以下格式：

```
<类型>: <简短描述>

<详细描述>（可选）
```

**类型**：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式调整（不影响功能）
- `refactor`: 重构（不是新功能也不是 bug 修复）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建过程或辅助工具的变动

**示例**：
```powershell
git commit -m "feat: 添加节点对齐功能"
git commit -m "fix: 修复分组节点保存问题"
git commit -m "docs: 更新 README"
git commit -m "refactor: 重构自动保存逻辑"
```

## Git 与 ZIP 备份对比

### Git 优势
✅ 完整的版本历史  
✅ 轻松回退到任何版本  
✅ 分支管理，安全尝试新功能  
✅ 查看每次修改的详细内容  
✅ 占用空间小（增量存储）

### ZIP 备份优势
✅ 简单直观  
✅ 易于分享和归档  
✅ 不需要学习 Git  

### 建议
**同时使用两种方式**：
- **Git**：日常开发，版本控制
- **ZIP**：重要里程碑，长期归档

## 常见问题

### Q: 如何查看某个文件的修改历史？
```powershell
git log --follow -- 文件路径
```

### Q: 如何恢复已删除的文件？
```powershell
git checkout HEAD -- 文件路径
```

### Q: 如何查看两次提交之间的差异？
```powershell
git diff 提交ID1 提交ID2
```

### Q: 如何修改最后一次提交信息？
```powershell
git commit --amend -m "新的提交信息"
```

### Q: 如何暂存当前工作？
```powershell
# 暂存当前修改
git stash

# 查看暂存列表
git stash list

# 恢复暂存
git stash pop
```

## 下一步

1. **定期提交**：每完成一个小功能就提交一次
2. **使用分支**：尝试新功能时创建新分支
3. **打标签**：为稳定版本打标签
4. **备份仓库**：定期将整个 `.git` 文件夹备份到安全位置

## 快速参考

```powershell
# 初始化（已完成）
git init

# 日常工作流
git status              # 查看状态
git add .               # 添加所有修改
git commit -m "消息"    # 提交
git log --oneline       # 查看历史

# 分支操作
git branch              # 查看分支
git checkout -b 分支名  # 创建并切换分支
git merge 分支名        # 合并分支

# 回退操作
git reset --hard HEAD^  # 回退到上一次提交
git checkout -- 文件    # 撤销文件修改
```
