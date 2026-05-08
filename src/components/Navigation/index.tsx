import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.tsx';
import { patchSelfNickname, type ApiError } from '../../auth/api.ts';
import './styles.css';

interface PageLink {
    path: string;
    title: string;
    category: string;
}

const SYSTEM_PAGES: PageLink[] = [
    { path: '/construction-team-add', title: '施工班组新增', category: '施工班组' },
    { path: '/contract-tight', title: '(紧密型单项)收入合同起拟', category: '紧密型' },
    { path: '/tight-handover-list', title: '紧密型项目交接清单', category: '紧密型' },
    { path: '/tight-project-apply', title: '紧密型项目申请', category: '紧密型' },
    { path: '/foreign-tax-reimbursement', title: '外经证税款报销', category: '财务' },
    { path: '/invoice-apply', title: '开票申请', category: '财务' },
    { path: '/payment-offset-settlement', title: '回款冲销结算单申请', category: '财务' },
    { path: '/settlement-apply', title: '结算单申请', category: '财务' },
    { path: '/contract-draft', title: '收入合同起拟', category: '收入合同' },
];

export function Navigation() {
    const location = useLocation();
    const [searchTerm, setSearchTerm] = useState('');
    const { status, user, isGuest, logout, applyUserUpdate } = useAuth();

    // 顶栏头像下拉（2026-05-08：自助改昵称入口）
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);
    const accountMenuRef = useRef<HTMLDivElement | null>(null);
    const [nickDialog, setNickDialog] = useState<{ value: string } | null>(null);
    const [nickSubmitting, setNickSubmitting] = useState(false);
    const [nickError, setNickError] = useState<string | null>(null);

    // 点外面关账户菜单
    useEffect(() => {
        if (!accountMenuOpen) return;
        const onClick = (e: MouseEvent) => {
            if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
                setAccountMenuOpen(false);
            }
        };
        window.addEventListener('mousedown', onClick);
        return () => window.removeEventListener('mousedown', onClick);
    }, [accountMenuOpen]);

    const handleSubmitNickname = useCallback(async () => {
        if (!nickDialog) return;
        if (nickSubmitting) return;
        const trimmed = nickDialog.value.trim();
        if (trimmed.length < 1 || trimmed.length > 30) {
            setNickError('昵称需 1-30 字符（trim 后非空）');
            return;
        }
        setNickSubmitting(true);
        setNickError(null);
        try {
            const updated = await patchSelfNickname(trimmed);
            applyUserUpdate(updated);
            setNickDialog(null);
        } catch (err) {
            const apiErr = err as ApiError;
            if (apiErr.status === 401) {
                setNickError('登录已失效，请重新登录');
            } else if (apiErr.error === 'invalid_input') {
                setNickError('昵称需 1-30 字符（trim 后非空）');
            } else {
                setNickError(apiErr.message || `修改失败（${apiErr.error || apiErr.status}）`);
            }
        } finally {
            setNickSubmitting(false);
        }
    }, [nickDialog, nickSubmitting, applyUserUpdate]);

    const isActive = (path: string) => location.pathname === path;

    const isSystemPageActive = () => {
        return SYSTEM_PAGES.some(page => page.path === location.pathname);
    };

    const filteredPages = useMemo(() => {
        if (!searchTerm) return SYSTEM_PAGES;
        const lowerTerm = searchTerm.toLowerCase();
        return SYSTEM_PAGES.filter(
            page =>
                page.title.toLowerCase().includes(lowerTerm) ||
                page.category.toLowerCase().includes(lowerTerm)
        );
    }, [searchTerm]);

    return (
        <header className="navigation-header">
            <div className="app-title">业务流程可视化平台</div>

            <nav className="nav-links">
                <Link
                    to="/"
                    className={`nav-link ${isActive('/') ? 'active' : ''}`}
                >
                    流程图
                </Link>

                {user?.role === 'admin' && (
                    <Link
                        to="/admin"
                        className={`nav-link ${isActive('/admin') ? 'active' : ''}`}
                    >
                        管理后台
                    </Link>
                )}

                <a
                    href="/manual.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="nav-link"
                    title="新窗口打开使用手册"
                >
                    📖 使用手册
                </a>

                <div className="dropdown-container">
                    <div className={`nav-link dropdown-trigger ${isSystemPageActive() ? 'active' : ''}`}>
                        系统示例页面
                        <span style={{ fontSize: '10px', transform: 'translateY(1px)' }}>▼</span>
                    </div>
                    <div className="dropdown-menu">
                        <div className="search-container">
                            <input
                                type="text"
                                className="search-input"
                                placeholder="搜索页面..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                        <div className="menu-items-container">
                            {filteredPages.length > 0 ? (
                                filteredPages.map((page) => (
                                    <Link
                                        key={page.path}
                                        to={page.path}
                                        className={`dropdown-item ${isActive(page.path) ? 'active' : ''}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <span className="page-title">{page.title}</span>
                                        <span className="page-category">{page.category}</span>
                                    </Link>
                                ))
                            ) : (
                                <div className="no-results">未找到相关页面</div>
                            )}
                        </div>
                    </div>
                </div>
            </nav>

            <div className="account-bar">
                {status === 'authenticated' && user ? (
                    <div className="account-menu-container" ref={accountMenuRef}>
                        <button
                            type="button"
                            className="account-menu-trigger"
                            onClick={() => setAccountMenuOpen((v) => !v)}
                            title={`${user.username} (${user.role})`}
                        >
                            <span className="account-username">{user.nickname}</span>
                            {user.role === 'admin' && <span className="account-role-tag">admin</span>}
                            <span className="account-menu-arrow">▼</span>
                        </button>
                        {accountMenuOpen && (
                            <div className="account-menu">
                                <div className="account-menu-info">
                                    <div className="account-menu-info-line">
                                        昵称：<span className="account-menu-info-value">{user.nickname}</span>
                                    </div>
                                    <div className="account-menu-info-line account-menu-info-sub">
                                        登录用户名：{user.username}
                                    </div>
                                </div>
                                <div className="account-menu-divider" />
                                <button
                                    type="button"
                                    className="account-menu-item"
                                    onClick={() => {
                                        setNickError(null);
                                        setNickDialog({ value: user.nickname });
                                        setAccountMenuOpen(false);
                                    }}
                                >
                                    修改昵称
                                </button>
                                <button
                                    type="button"
                                    className="account-menu-item account-menu-item-danger"
                                    onClick={() => {
                                        setAccountMenuOpen(false);
                                        logout();
                                    }}
                                >
                                    退出登录
                                </button>
                            </div>
                        )}
                    </div>
                ) : isGuest ? (
                    <>
                        <span className="account-guest">游客模式（只读）</span>
                        <button type="button" className="account-action" onClick={logout}>
                            登录
                        </button>
                    </>
                ) : null}
            </div>

            {nickDialog && (
                <div
                    className="account-nick-backdrop"
                    onClick={() => !nickSubmitting && setNickDialog(null)}
                >
                    <div className="account-nick-dialog" onClick={(e) => e.stopPropagation()}>
                        <h3>修改昵称</h3>
                        <input
                            type="text"
                            placeholder="昵称（1-30 字符，trim 后非空）"
                            value={nickDialog.value}
                            onChange={(e) =>
                                setNickDialog((d) => (d ? { ...d, value: e.target.value } : d))
                            }
                            maxLength={30}
                            autoFocus
                            disabled={nickSubmitting}
                            autoComplete="off"
                        />
                        {nickError && <div className="account-nick-error">{nickError}</div>}
                        <div className="account-nick-actions">
                            <button
                                type="button"
                                onClick={() => setNickDialog(null)}
                                disabled={nickSubmitting}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSubmitNickname()}
                                disabled={nickSubmitting || nickDialog.value.trim().length < 1}
                            >
                                {nickSubmitting ? '提交中…' : '确认修改'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </header>
    );
}
