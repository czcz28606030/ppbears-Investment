import test from 'node:test';
import assert from 'node:assert/strict';
import { getPortfolioSignalPresentation } from './portfolioSignalFreshness.ts';

test('a lagging IFAlgo buy signal displays neutral instead of a historical buy recommendation', () => {
  assert.deepEqual(getPortfolioSignalPresentation('AI 加碼', '2026-09-11', '20260918', 'shared-cache'), {
    status: 'historical',
    badgeLabel: 'AI 中立',
    dateLabel: 'IFAlgo 截至 2026-09-11；官方價格至 2026-09-18。資料未更新，AI 中立為預設顯示',
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
    badgeLabel: 'AI 中立',
    dateLabel: 'IFAlgo 無可用訊號；AI 中立為預設顯示',
  });
});

test('missing IFAlgo payload displays neutral fallback', () => {
  assert.deepEqual(getPortfolioSignalPresentation('AI 中立', '', '20260918', 'empty'), {
    status: 'unverified',
    badgeLabel: 'AI 中立',
    dateLabel: 'IFAlgo 無可用訊號；AI 中立為預設顯示',
  });
});

test('an unavailable quote date does not certify a signal as current', () => {
  assert.equal(getPortfolioSignalPresentation('AI 加碼', '2026-09-18', '', 'shared-cache').status, 'unverified');
});
