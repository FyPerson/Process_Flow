// 登录页 + 游客入口
//
// 安全前提（v4.1 codex 复审强制）：
// - 用户输入用 React 文本节点渲染（{username} 而非 dangerouslySetInnerHTML）
// - 错误提示来自 server 的纯 JSON，不直接拼 HTML

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApiError } from './api.ts';
import { useAuth } from './AuthContext.tsx';

export function LoginPage() {
  const { login, continueAsGuest } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await login(username.trim(), password);
      // 成功后 AuthContext 会自动切到 authenticated；App 路由会渲染主应用
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 429) {
        setErrorMsg('登录尝试过多，请 1 分钟后再试');
      } else if (apiErr.error === 'invalid_credentials') {
        setErrorMsg('用户名或密码错误');
      } else if (apiErr.error === 'invalid_input') {
        setErrorMsg(apiErr.message || '输入有误');
      } else {
        setErrorMsg('登录失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f172a',
        color: '#e2e8f0',
        padding: '2rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          background: '#1e293b',
          borderRadius: 12,
          padding: '2rem',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        }}
      >
        <h1 style={{ margin: '0 0 0.25rem', fontSize: 22, fontWeight: 600 }}>业务全景图</h1>
        <p style={{ margin: '0 0 1.5rem', fontSize: 13, color: '#94a3b8' }}>
          登录以参与协作；游客可只读查看公开画布
        </p>

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>
            用户名
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              style={inputStyle}
              maxLength={20}
            />
          </label>

          <label style={labelStyle}>
            密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={inputStyle}
              maxLength={200}
            />
          </label>

          {errorMsg && (
            <div style={errorBoxStyle} role="alert">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !username.trim() || !password}
            style={primaryBtnStyle(submitting || !username.trim() || !password)}
          >
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>

        <div style={{ margin: '1.25rem 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 1, background: '#334155' }} />
          <span style={{ fontSize: 12, color: '#64748b' }}>或</span>
          <div style={{ flex: 1, height: 1, background: '#334155' }} />
        </div>

        <button type="button" onClick={continueAsGuest} style={secondaryBtnStyle}>
          以游客身份继续（只读）
        </button>

        <button
          type="button"
          onClick={() => navigate('/draft')}
          style={{ ...secondaryBtnStyle, marginTop: 8 }}
          title="无账号也能画流程图，仅本地保存"
        >
          📝 我来画需求（无需登录）
        </button>
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 11,
            color: '#64748b',
            textAlign: 'center',
          }}
        >
          无账号也能画流程图，仅本地保存
        </p>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '0.875rem',
  fontSize: 13,
  color: '#cbd5e1',
};

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 6,
  padding: '0.5rem 0.75rem',
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};

const errorBoxStyle: React.CSSProperties = {
  margin: '0.5rem 0 1rem',
  padding: '0.5rem 0.75rem',
  background: '#7f1d1d',
  border: '1px solid #b91c1c',
  borderRadius: 6,
  fontSize: 13,
  color: '#fecaca',
};

const primaryBtnStyle = (disabled: boolean): React.CSSProperties => ({
  width: '100%',
  padding: '0.625rem 1rem',
  background: disabled ? '#1e40af55' : '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'background 0.15s',
});

const secondaryBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 1rem',
  background: 'transparent',
  color: '#94a3b8',
  border: '1px solid #334155',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
};
