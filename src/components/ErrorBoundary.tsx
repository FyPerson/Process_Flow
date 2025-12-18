import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        // 更新 state 以便下一次渲染显示降级 UI
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    private handleReload = () => {
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div style={{
                    height: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#f8fafc',
                    color: '#334155',
                    fontFamily: 'system-ui, sans-serif'
                }}>
                    <div style={{
                        padding: '2rem',
                        background: 'white',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        maxWidth: '500px',
                        width: '90%'
                    }}>
                        <h2 style={{ marginTop: 0, color: '#ef4444' }}>出错了！(Application Error)</h2>
                        <p>应用程序遇到意外错误，已停止运行。</p>
                        <div style={{
                            background: '#f1f5f9',
                            padding: '1rem',
                            borderRadius: '4px',
                            marginBottom: '1rem',
                            fontSize: '0.875rem',
                            overflowX: 'auto',
                            color: '#64748b'
                        }}>
                            {this.state.error?.message}
                        </div>
                        <button
                            onClick={this.handleReload}
                            style={{
                                backgroundColor: '#3b82f6',
                                color: 'white',
                                border: 'none',
                                padding: '0.5rem 1rem',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '1rem'
                            }}
                        >
                            重新加载页面
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
