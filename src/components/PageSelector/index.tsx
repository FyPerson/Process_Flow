import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './styles.css';

export interface PageOption {
  id: string;
  title: string;
  componentType: 'page';
  url: string;
  description?: string;
  thumbnail?: string;
}

// 页面组件映射表
export const PAGE_OPTIONS: PageOption[] = [
  {
    id: 'TightProjectApplyPage',
    title: '紧密型项目申请',
    componentType: 'page',
    url: 'component:TightProjectApplyPage',
    description: '紧密型项目申请页面，包含基本信息、结算信息、施工班组等',
  },
  {
    id: 'ContractTightPage',
    title: '（紧密型单项）收入合同起拟',
    componentType: 'page',
    url: 'component:ContractTightPage',
    description: '紧密型单项收入合同起拟页面，包含合同信息、客户信息、合同内容、交付信息等',
  },
  {
    id: 'ConstructionTeamAddPage',
    title: '施工班组申请',
    componentType: 'page',
    url: 'component:ConstructionTeamAddPage',
    description: '施工班组申请页面，包含基本信息、交付人员、启用状态等',
  },
  {
    id: 'ForeignTaxReimbursementPage',
    title: '外经证税金报销申请',
    componentType: 'page',
    url: 'component:ForeignTaxReimbursementPage',
    description: '外经证税金报销申请页面，包含基本信息、账号清单、申请明细等',
  },
  {
    id: 'TightHandoverListPage',
    title: '新增紧密型交接清单',
    componentType: 'page',
    url: 'component:TightHandoverListPage',
    description: '新增紧密型交接清单页面，包含项目概览、费用结算、保险缴纳、班组合同等',
  },
  {
    id: 'InvoiceApplyPage',
    title: '项目开票申请',
    componentType: 'page',
    url: 'component:InvoiceApplyPage',
    description: '项目开票申请页面，包含发票信息、明细信息等',
  },
  {
    id: 'SettlementApplyPage',
    title: '结算单申请',
    componentType: 'page',
    url: 'component:SettlementApplyPage',
    description: '结算单申请页面，包含基本信息、结算班组信息、收入信息、费用扣除、支付信息等',
  },
  {
    id: 'PaymentOffsetSettlementPage',
    title: '回款冲销结算单申请',
    componentType: 'page',
    url: 'component:PaymentOffsetSettlementPage',
    description:
      '回款冲销结算单申请页面，包含基本信息、结算班组信息、收入信息、费用扣除、支付信息等',
  },
  {
    id: 'ContractDraftPage',
    title: '收入合同起拟',
    componentType: 'page',
    url: 'component:ContractDraftPage',
    description: '收入合同起拟页面，包含客户信息、产品信息、合同内容等',
  },
];

interface PageSelectorProps {
  visible: boolean;
  onSelect: (page: PageOption) => void;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement>;
}

export function PageSelector({ visible, onSelect, onClose }: Omit<PageSelectorProps, 'triggerRef'>) {
  // Use generic ref for click outside
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // If clicking on overlay (outside the modal content)
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (visible) {
      // Add small timeout to prevent immediate closing if the trigger click bubbles up
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 0);

      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [visible, onClose]);

  if (!visible) return null;

  const popoverContent = (
    <>
      <div className="page-selector-overlay" />
      <div
        className="page-selector-popover"
        ref={popoverRef}
      >
        <div className="page-selector-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="page-selector-title">选择关联页面</span>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '18px', color: '#94a3b8', padding: '4px' }}
          >
            ×
          </button>
        </div>
        <div className="page-selector-list">
          {PAGE_OPTIONS.map((page) => (
            <div
              key={page.id}
              className="page-selector-item"
              onClick={() => {
                onSelect(page);
                onClose();
              }}
            >
              <div className="page-selector-item-icon">📄</div>
              <div className="page-selector-item-content">
                <div className="page-selector-item-title">{page.title}</div>
                {page.description && (
                  <div className="page-selector-item-description">{page.description}</div>
                )}
              </div>
              <div className="page-selector-item-arrow">→</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  return createPortal(popoverContent, document.body);
}
