export const getIframeUrl = (componentKey: string): string => {
    switch (componentKey) {
        case 'component:ContractTightPage':
            return '/pages/紧密型/contract-tight.html';
        case 'component:ConstructionTeamAddPage':
            return '/pages/施工班组/construction-team-add.html';
        case 'component:TightProjectApplyPage':
            return '/pages/紧密型/tight-project-apply.html';
        case 'component:ForeignTaxReimbursementPage':
            return '/pages/财务/foreign-tax-reimbursement.html';
        case 'component:TightHandoverListPage':
            return '/pages/紧密型/tight-handover-list.html';
        case 'component:InvoiceApplyPage':
            return '/pages/财务/invoice-apply.html';
        case 'component:SettlementApplyPage':
            return '/pages/财务/settlement-apply.html';
        case 'component:PaymentOffsetSettlementPage':
            return '/pages/财务/payment-offset-settlement.html';
        case 'component:ContractDraftPage':
            return '/pages/收入合同/收入合同起拟.html';
        default:
            // Default fallback or return original if not found
            return '/pages/紧密型/tight-project-apply.html';
    }
};
