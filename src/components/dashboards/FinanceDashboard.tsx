/**
 * @file FinanceDashboard.tsx
 * @description 가계부/금융 대시보드 (`F8`, `mylore://dashboard/finance`): 실시간 알림 거래내역 조회 및 엑셀(`.xlsx`/`.csv`) 명세서 대조·병합.
 */
import React from 'react';
import { FinanceTransaction } from '../../types/mylore';
import { openExternalUrlInChrome } from '../../services/tauriClient';

export interface FinanceDashboardProps {
  reconcileResultMsg: string;
  setReconcileResultMsg: React.Dispatch<React.SetStateAction<string>>;
  financeSubTab: 'all' | 'card' | 'bank';
  setFinanceSubTab: React.Dispatch<React.SetStateAction<'all' | 'card' | 'bank'>>;
  allTransactions: FinanceTransaction[];
  excelInputRef: React.MutableRefObject<HTMLInputElement | null>;
  handleExcelUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function FinanceDashboard({
  reconcileResultMsg,
  setReconcileResultMsg,
  financeSubTab,
  setFinanceSubTab,
  allTransactions,
  excelInputRef,
  handleExcelUpload,
}: FinanceDashboardProps) {
  const filteredTx = allTransactions.filter((tx) => {
    if (financeSubTab === 'all') return true;
    const inst = (tx.institution || '').toLowerCase();
    const isCard =
      inst.includes('카드') ||
      inst.includes('card') ||
      inst.includes('페이') ||
      inst.includes('현대') ||
      inst.includes('삼성') ||
      inst.includes('롯데');
    return financeSubTab === 'card' ? isCard : !isCard;
  });

  return (
    <div className="finance-workspace">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '14px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
            💳 금융 대쉬보드
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
            카드사용목록 · 통장목록 · 은행 엑셀(.xlsx/.csv) 분석 및 금융 통합 데이터를 관리합니다.
          </p>
        </div>
      </div>

      {reconcileResultMsg && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'var(--accent-soft)',
            border: '1px solid var(--accent-primary)',
            borderRadius: '8px',
            marginBottom: '14px',
            color: '#e0e7ff',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ whiteSpace: 'pre-wrap' }}>{reconcileResultMsg}</span>
          <button
            className="toolbar-btn"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={() => setReconcileResultMsg('')}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div
          style={{
            padding: '14px 16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className={`toolbar-btn ${financeSubTab === 'all' ? 'primary' : ''}`}
              onClick={() => setFinanceSubTab('all')}
            >
              📊 전체 ({allTransactions.length})
            </button>
            <button
              className={`toolbar-btn ${financeSubTab === 'card' ? 'primary' : ''}`}
              onClick={() => setFinanceSubTab('card')}
            >
              💳 카드사용목록
            </button>
            <button
              className={`toolbar-btn ${financeSubTab === 'bank' ? 'primary' : ''}`}
              onClick={() => setFinanceSubTab('bank')}
            >
              🏦 통장목록
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={handleExcelUpload}
            />
            <button
              className="toolbar-btn primary"
              onClick={() => excelInputRef.current?.click()}
            >
              📊 은행·카드 엑셀(.xlsx/.csv) 분석 및 최신 데이터 추가
            </button>
            <button
              className="toolbar-btn"
              onClick={() =>
                openExternalUrlInChrome(
                  'https://obank.kbstar.com/quics?page=C025255'
                )
              }
            >
              🏦 KB국민 빠른조회
            </button>
            <button
              className="toolbar-btn"
              onClick={() =>
                openExternalUrlInChrome(
                  'https://bank.shinhan.com/index.jsp#010101100000'
                )
              }
            >
              🏦 신한 간편조회
            </button>
            <button
              className="toolbar-btn"
              onClick={() =>
                openExternalUrlInChrome(
                  'https://www.shinhancard.com/pconts/html/myPage/useList/MOBFM001/MOBFM001R01.html'
                )
              }
            >
              💳 신한카드 명세서
            </button>
          </div>
        </div>

        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--bg-secondary)',
            borderLeft: '4px solid var(--accent-primary)',
            borderRadius: '6px',
            fontSize: '12.5px',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: 'var(--text-primary)' }}>
            📌 금융 데이터 통합 로드맵 (추후 마일스톤):
          </strong>{' '}
          <code>finance/금전관리.xlsx</code>, <code>금전관리2.xlsx</code> 및 하위{' '}
          <code>backup</code> 폴더의 과거 데이터를 정밀 분석하여 중복 내역을 제거하고 순수{' '}
          <strong>Raw Data</strong>만 추출·관리하며, 향후 카카오페이·온라인 주문목록 연동 및 전용 대시보드 차트가 이 탭에 순차적으로 업데이트됩니다.
        </div>

        <div>
          <h3 style={{ marginBottom: '10px', fontSize: '15px' }}>
            {financeSubTab === 'card'
              ? `💳 카드사용목록 (${filteredTx.length}건)`
              : financeSubTab === 'bank'
                ? `🏦 통장목록 (${filteredTx.length}건)`
                : `🗄️ 전체 금융 거래내역 (${filteredTx.length}건)`}
          </h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>상태</th>
                <th>거래일시</th>
                <th>금융사(카드/은행)</th>
                <th>가맹점 / 적요</th>
                <th>금액</th>
                <th>분류</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {filteredTx.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      textAlign: 'center',
                      padding: '24px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    표시할 금융 내역이 없습니다. 우측 상단 [은행·카드 엑셀 분석 및 최신 데이터 추가] 버튼으로 엑셀을 불러오세요.
                  </td>
                </tr>
              ) : (
                filteredTx.map((tx) => (
                  <tr key={tx.id}>
                    <td>
                      <span className={`verify-badge ${tx.verifyStatus}`}>
                        {tx.verifyStatus}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {tx.txDate} {tx.txTime}
                    </td>
                    <td>{tx.institution}</td>
                    <td style={{ fontWeight: 600 }}>{tx.merchant}</td>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                      }}
                    >
                      {tx.amount.toLocaleString()}원
                    </td>
                    <td>{tx.category}</td>
                    <td>{tx.memo}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
