/**
 * Retired legacy backtest initialization entry point.
 * Historical reports and tables are preserved. This script does not connect to
 * providers or databases, modify old records, or fabricate past weekly membership.
 */
console.error('舊版回測初始化已停用，所有模式（含 --signals-only、--prices-only、--simons-only）均不再執行。');
console.error('週榜趨勢資料由 /api/backtest-daily-collect 保存真實觀察日起的週榜與官方日K。');
console.error('新策略回測需要當時已觀察的歷史週榜快照與完整官方價格/成交模擬，不能以目前榜單回填歷史。既有報告與資料保持保留，不代表新策略績效。');
process.exitCode = 1;
