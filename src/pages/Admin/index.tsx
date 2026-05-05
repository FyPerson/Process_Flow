// admin 后台 shell（P3F-2）
//
// 顶层 tab：用户管理 / 共有画布管理（P3F-3 占位）
// admin 鉴权由路由 guard + requireFreshAdmin 服务端兜底；本组件假设进得来就是 admin

import { useState } from 'react';
import { UsersTab } from './UsersTab';
import './styles.css';

type AdminTab = 'users' | 'canvases';

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('users');

  return (
    <div className="admin-page">
      <div className="admin-tabs">
        <button
          type="button"
          className={`admin-tab ${tab === 'users' ? 'active' : ''}`}
          onClick={() => setTab('users')}
        >
          用户管理
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === 'canvases' ? 'active' : ''}`}
          onClick={() => setTab('canvases')}
        >
          共有画布管理
        </button>
      </div>
      <div className="admin-tab-content">
        {tab === 'users' ? <UsersTab /> : <CanvasesTabPlaceholder />}
      </div>
    </div>
  );
}

function CanvasesTabPlaceholder() {
  return (
    <div style={{ padding: 24, color: '#94a3b8', fontSize: 14 }}>
      共有画布管理（P3F-3 实施中）
    </div>
  );
}
