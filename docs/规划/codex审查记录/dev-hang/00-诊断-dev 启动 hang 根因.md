## 最可能根因
1. Vite `createViteServer` 卡住：只在 dev 分支，且 `await` 后才 `listen`。
2. `tsx watch` + Vite 双 watcher：Windows 下更易被缓存/文件锁放大。
3. WAL 低概率：778KB 不大，且 DB 初始化已成功。
4. `SELECT users` 低概率：需日志确认。

## 定位步骤
给 `bootstrapInitialAdmin`、`import('vite')`、`createViteServer`、`app.listen` 前后加耗时日志。  
开 Vite verbose：`$env:DEBUG='vite:*'; npm run dev`

## 长期解决方案
推荐改双进程：Express `3001` + Vite `5173`，Vite proxy `/api` 到后端。取舍是多一个 dev 进程，但 API health 不再被 Vite 阻塞。WAL 保留，在 `closeDb()` 前做 checkpoint。

## 临时缓解
```powershell
node --input-type=module -e "import Database from 'better-sqlite3';const db=new Database('E:/业务全景图-data/app.db');console.log(db.pragma('wal_checkpoint(TRUNCATE)'));db.close()"
```