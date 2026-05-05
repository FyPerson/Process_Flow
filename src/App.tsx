import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.tsx';
import { LoginPage } from './auth/LoginPage.tsx';
import { Navigation } from './components/Navigation';
import { AdminPage } from './pages/Admin';
import { BusinessFlowVisualization } from './pages/BusinessFlowVisualization';

/** /admin 路由 guard：非 admin 重定向 / + alert（前端兜底，服务端 requireFreshAdmin 是真防护） */
function AdminRoute() {
  const { user } = useAuth();
  if (!user || user.role !== 'admin') {
    // 用 Navigate 而非 alert + redirect，避免 alert 阻塞渲染；alert 在 useEffect 里也可，但这里简单走重定向
    return <Navigate to="/" replace />;
  }
  return <AdminPage />;
}

function AppShell() {
  const { status } = useAuth();

  // 启动时正在用旧 token 验身份，简单 splash 避免闪 LoginPage
  if (status === 'loading') {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94a3b8',
          fontSize: 14,
        }}
      >
        正在加载…
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginPage />;
  }

  // authenticated 或 guest：进入主应用（游客只读由各页面自行判断 useAuth().readOnly）
  return (
    <>
      <Navigation />
      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route
            path="/"
            element={
              <div style={{ flex: 1, position: 'relative' }}>
                <BusinessFlowVisualization />
              </div>
            }
          />
          <Route
            path="/construction-team-add"
            element={
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <iframe
                  src="/pages/施工班组/construction-team-add.html"
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  title="施工班组入库"
                />
              </div>
            }
          />
          <Route
            path="/contract-tight"
            element={
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <iframe
                  src="/pages/紧密型/contract-tight.html"
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  title="紧密型合同"
                />
              </div>
            }
          />
          <Route
            path="/tight-handover-list"
            element={
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <iframe
                  src="/pages/紧密型/tight-handover-list.html"
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  title="紧密型项目交接清单"
                />
              </div>
            }
          />
          <Route
            path="/tight-project-apply"
            element={
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <iframe
                  src="/pages/紧密型/tight-project-apply.html"
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  title="紧密型项目申请"
                />
              </div>
            }
          />
          <Route
            path="/foreign-tax-reimbursement"
            element={
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <iframe
                  src="/pages/财务/foreign-tax-reimbursement.html"
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  title="外经证税款报销"
                />
              </div>
            }
          />
          <Route
            path="/invoice-apply"
            element={
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <iframe
                  src="/pages/财务/invoice-apply.html"
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  title="开票申请"
                />
              </div>
            }
          />
          <Route
            path="/settlement-apply"
            element={
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <iframe
                  src="/pages/财务/settlement-apply.html"
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  title="结算单申请"
                />
              </div>
            }
          />
          <Route
            path="/payment-offset-settlement"
            element={
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <iframe
                  src="/pages/财务/payment-offset-settlement.html"
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  title="回款冲销结算单申请"
                />
              </div>
            }
          />
          <Route
            path="/contract-draft"
            element={
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <iframe
                  src="/pages/收入合同/收入合同起拟.html"
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  title="收入合同起拟"
                />
              </div>
            }
          />
          <Route
            path="/admin"
            element={<AdminRoute />}
          />
        </Routes>
      </main>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: '#0f172a',
          }}
        >
          <AppShell />
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
