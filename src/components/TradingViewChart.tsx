import { useEffect, useRef, useState, memo, Component } from 'react';
import type { ReactNode } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
} from 'lightweight-charts';
import type { IChartApi, SeriesMarker, CandlestickData, LineData, HistogramData, Time } from 'lightweight-charts';
import type { StockPrice } from '../types';
import type { StrategyEvent } from '../utils/trendStrategy';

// ── Error Boundary ──────────────────────────────────
class ChartErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.warn('[StockChart] render error caught:', error.message);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

// ── Chart Component ─────────────────────────────────
interface StockChartProps {
  prices: StockPrice[];
  stockName: string;
  strategyEvents?: StrategyEvent[];
  showMa5?: boolean;
  showMa20?: boolean;
  visibleBars?: number;
}

function toDateStr(mdate: string): string {
  const d = mdate.replace(/-/g, '');
  if (d.length < 8) return '';
  const year = parseInt(d.slice(0, 4));
  const month = parseInt(d.slice(4, 6));
  const day = parseInt(d.slice(6, 8));
  if (isNaN(year) || isNaN(month) || isNaN(day)) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatChartDate(time: unknown, withYear = false): string {
  const raw = typeof time === 'string'
    ? time
    : typeof time === 'object' && time !== null && 'year' in time
      ? `${(time as { year: number; month: number; day: number }).year}-${String((time as { year: number; month: number; day: number }).month).padStart(2, '0')}-${String((time as { year: number; month: number; day: number }).day).padStart(2, '0')}`
      : '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(time ?? '');
  return withYear ? `${match[1]}/${match[2]}/${match[3]}` : `${match[2]}/${match[3]}`;
}

function buildStrategyEventMarkers(events: StrategyEvent[] | undefined, availableDates: Set<string>): SeriesMarker<string>[] {
  const styles = {
    entry: { color: '#7c3aed', text: '進場', position: 'belowBar', shape: 'arrowUp' },
    add: { color: '#2563eb', text: '加碼', position: 'belowBar', shape: 'arrowUp' },
    reduce: { color: '#d97706', text: '減碼', position: 'aboveBar', shape: 'arrowDown' },
    exit: { color: '#111827', text: '出場', position: 'aboveBar', shape: 'arrowDown' },
  } as const;
  const seen = new Set<string>();
  return (events || []).filter(event => {
    const key = `${event.date}:${event.action}`;
    if (!availableDates.has(event.date) || seen.has(key) || !styles[event.action]) return false;
    seen.add(key);
    return true;
  }).map(event => ({ time: event.date, ...styles[event.action] }))
    .sort((a, b) => a.time.localeCompare(b.time));
}
const StockChartInner = memo(function StockChartInner({
  prices,
  stockName,
  strategyEvents,
  showMa5 = true,
  showMa20 = true,
  visibleBars = 130,
}: StockChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    // 清除舊圖表
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    // 過濾有效 K 線資料
    const validPrices = prices.filter(p => {
      const o = parseFloat(p.open_d);
      const h = parseFloat(p.high_d);
      const l = parseFloat(p.low_d);
      const c = parseFloat(p.close_d);
      return p.mdate && !isNaN(o) && !isNaN(h) && !isNaN(l) && !isNaN(c) && o > 0 && c > 0;
    });

    if (validPrices.length === 0) return;

    try {
      // 建立圖表
      const chart = createChart(container, {
        layout: {
          background: { type: ColorType.Solid, color: '#FFFFFF' },
          textColor: '#555',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: 'rgba(0, 0, 0, 0.03)' },
          horzLines: { color: 'rgba(0, 0, 0, 0.03)' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        localization: {
          locale: 'zh-TW',
          dateFormat: 'yyyy/MM/dd',
          timeFormatter: (time: unknown) => formatChartDate(time, true),
        },
        rightPriceScale: {
          borderColor: 'rgba(0, 0, 0, 0.06)',
          scaleMargins: { top: 0.05, bottom: 0.25 },
        },
        timeScale: {
          borderColor: 'rgba(0, 0, 0, 0.06)',
          timeVisible: false,
          rightOffset: 3,
          barSpacing: 8,
          tickMarkFormatter: (time: unknown) => formatChartDate(time, false),
        },
        width: container.clientWidth,
        height: container.clientHeight,
      });
      chartRef.current = chart;

      // K 線資料（去重、排序）
      const candleMap = new Map<string, { time: string; open: number; high: number; low: number; close: number }>();
      for (const p of validPrices) {
        const t = toDateStr(p.mdate);
        if (t.length !== 10) continue;
        candleMap.set(t, {
          time: t,
          open: parseFloat(p.open_d),
          high: parseFloat(p.high_d),
          low: parseFloat(p.low_d),
          close: parseFloat(p.close_d),
        });
      }
      const uniqueCandles = Array.from(candleMap.values()).sort((a, b) => a.time.localeCompare(b.time));

      if (uniqueCandles.length === 0) return;

      // 加入 K 線 series（v5 API：chart.addSeries）
      // 台股配色：漲紅跌綠
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#dc2626',
        downColor: '#16a34a',
        borderUpColor: '#dc2626',
        borderDownColor: '#16a34a',
        wickUpColor: '#dc2626',
        wickDownColor: '#16a34a',
      });
      candleSeries.setData(uniqueCandles as CandlestickData<Time>[]);

      const tradingMarkers = buildStrategyEventMarkers(
        strategyEvents,
        new Set(uniqueCandles.map(candle => candle.time))
      );
      if (tradingMarkers.length > 0) {
        createSeriesMarkers(candleSeries, tradingMarkers, {
          autoScale: true,
          zOrder: 'top',
        });
      }

      // MA5 均線（黃色）
      if (showMa5 && uniqueCandles.length >= 5) {
        const ma5 = uniqueCandles.map((d, i) => {
          if (i < 4) return null;
          const sum = uniqueCandles.slice(i - 4, i + 1).reduce((acc, v) => acc + v.close, 0);
          return { time: d.time, value: +(sum / 5).toFixed(2) };
        }).filter(Boolean);

        const ma5Series = chart.addSeries(LineSeries, {
          color: '#f59e0b',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        ma5Series.setData(ma5 as LineData<Time>[]);
      }

      // MA20 均線（紫色）
      if (showMa20 && uniqueCandles.length >= 20) {
        const ma20 = uniqueCandles.map((d, i) => {
          if (i < 19) return null;
          const sum = uniqueCandles.slice(i - 19, i + 1).reduce((acc, v) => acc + v.close, 0);
          return { time: d.time, value: +(sum / 20).toFixed(2) };
        }).filter(Boolean);

        const ma20Series = chart.addSeries(LineSeries, {
          color: '#7B2CBF',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        ma20Series.setData(ma20 as LineData<Time>[]);
      }

      // 成交量 histogram
      const volMap = new Map<string, { time: string; value: number; color: string }>();
      for (const p of validPrices) {
        const t = toDateStr(p.mdate);
        if (t.length !== 10 || !p.volume) continue;
        const c = parseFloat(p.close_d);
        const o = parseFloat(p.open_d);
        volMap.set(t, {
          time: t,
          value: p.volume,
          color: c >= o ? 'rgba(220, 38, 38, 0.3)' : 'rgba(22, 163, 74, 0.3)',
        });
      }
      const uniqueVol = Array.from(volMap.values()).sort((a, b) => a.time.localeCompare(b.time));

      if (uniqueVol.length > 0) {
        const volSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
        });
        volSeries.priceScale().applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });
        volSeries.setData(uniqueVol as HistogramData<Time>[]);
      }

      // 預設顯示最近半年（約 130 個交易日）
      const HALF_YEAR_BARS = visibleBars;
      if (HALF_YEAR_BARS > 0 && uniqueCandles.length > HALF_YEAR_BARS) {
        const fromDate = uniqueCandles[uniqueCandles.length - HALF_YEAR_BARS].time;
        const toDate = uniqueCandles[uniqueCandles.length - 1].time;
        chart.timeScale().setVisibleRange({ from: fromDate as Time, to: toDate as Time });
      } else {
        chart.timeScale().fitContent();
      }

      // 響應式
      const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) chart.applyOptions({ width, height });
        }
      });
      ro.observe(container);

      return () => {
        ro.disconnect();
        chart.remove();
        chartRef.current = null;
      };
    } catch (err) {
      console.warn('[StockChart] chart creation error:', err);
    }
  }, [prices, stockName, strategyEvents, showMa5, showMa20, visibleBars]);

  return <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />;
});

/**
 * StockChart — 使用 lightweight-charts v5 繪製台股 K 線圖
 * 使用官方日 K 與已保存的持倉策略事件
 * 包含 Error Boundary 防止圖表錯誤影響整頁
 */
export default function StockChart({
  prices,
  stockName,
  strategyEvents,
  showMa5 = true,
  showMa20 = true,
  visibleBars = 130,
}: StockChartProps) {
  const [key, setKey] = useState(0);

  const fallback = (
    <div className="tv-chart-fallback">
      <div className="tv-chart-fallback-icon">📈</div>
      <div className="tv-chart-fallback-text">技術線圖載入失敗</div>
      <button className="tv-chart-fallback-btn" onClick={() => setKey(k => k + 1)}>
        🔄 重試
      </button>
    </div>
  );

  return (
    <ChartErrorBoundary key={key} fallback={fallback}>
      <StockChartInner
        prices={prices}
        stockName={stockName}
        strategyEvents={strategyEvents}
        showMa5={showMa5}
        showMa20={showMa20}
        visibleBars={visibleBars}
      />
    </ChartErrorBoundary>
  );
}
