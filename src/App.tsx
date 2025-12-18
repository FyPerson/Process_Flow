import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { BusinessFlowVisualization } from './pages/BusinessFlowVisualization';

import { Navigation } from './components/Navigation';

function App() {
  return (
    <BrowserRouter>
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0f172a',
        }}
      >
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
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      display: 'block',
                    }}
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
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      display: 'block',
                    }}
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
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      display: 'block',
                    }}
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
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      display: 'block',
                    }}
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
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      display: 'block',
                    }}
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
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      display: 'block',
                    }}
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
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      display: 'block',
                    }}
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
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      display: 'block',
                    }}
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
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      display: 'block',
                    }}
                    title="收入合同起拟"
                  />
                </div>
              }
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
