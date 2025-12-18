import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import './styles.css';

interface ScreenshotViewerProps {
  screenshot: {
    id: string;
    title?: string;
    url?: string;
    componentType?: 'page' | 'image';
    description?: string;
  } | null;
  visible: boolean;
  onClose: () => void;
}

export function ScreenshotViewer({ screenshot, visible, onClose }: ScreenshotViewerProps) {
  useEffect(() => {
    if (visible) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [visible, screenshot]);

  if (!visible || !screenshot) {
    return null;
  }

  const isPageComponent =
    screenshot.componentType === 'page' || screenshot.url?.startsWith('component:');

  const content = (
    <div className="screenshot-viewer-overlay" onClick={onClose}>
      <div className="screenshot-viewer-content" onClick={(e) => e.stopPropagation()}>
        <div className="screenshot-viewer-header">
          <h3>{screenshot.title}</h3>
          <button className="screenshot-viewer-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="screenshot-viewer-body">
          {isPageComponent ? (
            <div className="screenshot-page-container">
              <iframe
                src={
                  screenshot.url === 'component:ContractTightPage'
                    ? '/pages/紧密型/contract-tight.html'
                    : screenshot.url === 'component:ConstructionTeamAddPage'
                      ? '/pages/施工班组/construction-team-add.html'
                      : screenshot.url === 'component:TightProjectApplyPage'
                        ? '/pages/紧密型/tight-project-apply.html'
                        : screenshot.url === 'component:ForeignTaxReimbursementPage'
                          ? '/pages/财务/foreign-tax-reimbursement.html'
                          : screenshot.url === 'component:TightHandoverListPage'
                            ? '/pages/紧密型/tight-handover-list.html'
                            : screenshot.url === 'component:InvoiceApplyPage'
                              ? '/pages/财务/invoice-apply.html'
                              : screenshot.url === 'component:SettlementApplyPage'
                                ? '/pages/财务/settlement-apply.html'
                                : screenshot.url === 'component:PaymentOffsetSettlementPage'
                                  ? '/pages/财务/payment-offset-settlement.html'
                                  : '/pages/紧密型/tight-project-apply.html'
                }
                className="screenshot-page-iframe"
                title={screenshot.title}
                frameBorder="0"
              />
            </div>
          ) : (
            <img src={screenshot.url} alt={screenshot.title} className="screenshot-viewer-image" />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
