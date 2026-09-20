import test from 'node:test';
import assert from 'node:assert/strict';
import { getPortfolioSignalPresentation } from './portfolioSignalFreshness.ts';

test('an IFAlgo buy signal behind the official quote is historical, not current', () => {
  assert.deepEqual(getPortfolioSignalPresentation('AI 加碼', '2026-09-11', '20260918', 'shared-cache'), {
    status: 'historical',
    badgeLabel: '歷史 AI 加碼',
    dateLabel: '截至 2026-09-11；官方價格至 2026-09-18',
  });
});

test('a signal on the latest official trading day remains current over the weekend', () => {
  assert.deepEqual(getPortfolioSignalPresentation('AI 加碼', '2026-09-18', '20260918', 'ifalgo-live'), {
    status: 'current',
    badgeLabel: 'AI 加碼',
    dateLabel: '訊號日期 2026-09-18',
  });
});

test('an empty or undated signal is not presented as current advice', () => {
  assert.deepEqual(getPortfolioSignalPresentation('AI 加碼', '2026-09-20', '20260918', 'empty'), {
    status: 'unverified',
    badgeLabel: 'AI 訊號待核對',
    dateLabel: '無可驗證的 IFAlgo 訊號日期',
  });
});

test('an unavailable quote date does not certify a signal as current', () => {
  assert.equal(getPortfolioSignalPresentation('AI 加碼', '2026-09-18', '', 'shared-cache').status, 'unverified');
});
