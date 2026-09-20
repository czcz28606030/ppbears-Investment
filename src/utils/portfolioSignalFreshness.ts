export type PortfolioSignalPresentation = {
  status: 'current' | 'historical' | 'unverified';
  badgeLabel: string;
  dateLabel: string;
};

function normalizeDate(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!match) return '';
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
    ? `${year}-${month}-${day}`
    : '';
}

export function getPortfolioSignalPresentation(
  primaryLabel: string,
  signalDate: string,
  officialPriceDate: string,
  source: string,
): PortfolioSignalPresentation {
  const asOf = normalizeDate(signalDate);
  const quoteDate = normalizeDate(officialPriceDate);
  if (source === 'empty' || !asOf || !quoteDate) {
    return {
      status: 'unverified',
      badgeLabel: 'AI 訊號待核對',
      dateLabel: source !== 'empty' && asOf
        ? `IFAlgo 訊號日期 ${asOf}；官方價格日期待核對`
        : '無可驗證的 IFAlgo 訊號日期',
    };
  }
  if (asOf < quoteDate) {
    return {
      status: 'historical',
      badgeLabel: `歷史 ${primaryLabel}`,
      dateLabel: `截至 ${asOf}；官方價格至 ${quoteDate}`,
    };
  }
  return {
    status: 'current',
    badgeLabel: primaryLabel,
    dateLabel: `訊號日期 ${asOf}`,
  };
}
