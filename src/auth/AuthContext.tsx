// 全局登录态 store（用 React Context，不引入 zustand 等库）
//
// 三种状态：
// - status='loading'：启动时正在用 token 调 /api/auth/me 验证
// - status='unauthenticated'：无 token / token 失效 / 主动选择游客
// - status='authenticated'：登录成功，含 user
// - status='guest'：用户在登录页选了"以游客身份继续"
//
// 调用方按 status 决定渲染：登录页 / 应用 / 只读应用

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  fetchMe,
  getStoredToken,
  login as apiLogin,
  setStoredToken,
  type UserPublic,
} from './api.ts';

const GUEST_FLAG_KEY = 'business-flow:guest';

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated' | 'guest';

interface AuthContextValue {
  status: AuthStatus;
  user: UserPublic | null;
  /** 是否游客模式（authenticated=false 但 status='guest'）*/
  isGuest: boolean;
  /** 是否只读模式（游客 = 只读，登录用户 = 可编辑） */
  readOnly: boolean;

  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  continueAsGuest: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserPublic | null>(null);

  // 启动时：有 token 就验证；否则看 guest 标记；都没就 unauthenticated
  useEffect(() => {
    const token = getStoredToken();
    if (token) {
      fetchMe()
        .then((u) => {
          setUser(u);
          setStatus('authenticated');
        })
        .catch(() => {
          // token 过期或无效 → 清掉
          setStoredToken(null);
          setUser(null);
          if (sessionStorage.getItem(GUEST_FLAG_KEY) === '1') {
            setStatus('guest');
          } else {
            setStatus('unauthenticated');
          }
        });
    } else if (sessionStorage.getItem(GUEST_FLAG_KEY) === '1') {
      setStatus('guest');
    } else {
      setStatus('unauthenticated');
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await apiLogin(username, password);
    setStoredToken(r.token);
    sessionStorage.removeItem(GUEST_FLAG_KEY);
    setUser(r.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    sessionStorage.removeItem(GUEST_FLAG_KEY);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const continueAsGuest = useCallback(() => {
    setStoredToken(null);
    sessionStorage.setItem(GUEST_FLAG_KEY, '1');
    setUser(null);
    setStatus('guest');
  }, []);

  const value: AuthContextValue = {
    status,
    user,
    isGuest: status === 'guest',
    readOnly: status === 'guest',
    login,
    logout,
    continueAsGuest,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>');
  return ctx;
}
