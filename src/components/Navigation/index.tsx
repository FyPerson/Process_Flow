import { useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
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
        </header>
    );
}
