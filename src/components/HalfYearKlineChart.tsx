import type {StockPrice} from '../types';
import './HalfYearKlineChart.css';
export default function HalfYearKlineChart({stockCode,currentPrice,prices}: {stockCode:string;currentPrice:number;prices:StockPrice[]}) {
    const rawRows = prices;
    const points = rawRows
      .map(row => ({
        date: row.mdate,
        open: parseFloat(row.open_d),
        high: parseFloat(row.high_d),
        low: parseFloat(row.low_d),
        close: parseFloat(row.close_d),
      }))
      .filter(row =>
        row.date &&
        Number.isFinite(row.open) &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low) &&
        Number.isFinite(row.close) &&
        row.high >= row.low
      )
      .slice(-126);

    if (points.length < 12) {
      return (
        <div className="half-year-kline-panel half-year-kline-empty" aria-label="半年 K 線資料不足">
          <div className="half-year-kline-title">半年K線</div>
          <div className="half-year-kline-placeholder">資料累積中</div>
        </div>
      );
    }

    const width = 230;
    const height = 112;
    const padX = 8;
    const padTop = 8;
    const padBottom = 15;
    const chartHeight = height - padTop - padBottom;
    const highs = points.map(point => point.high);
    const lows = points.map(point => point.low);
    const maxPrice = Math.max(...highs);
    const minPrice = Math.min(...lows);
    const range = Math.max(maxPrice - minPrice, maxPrice * 0.02, 1);
    const y = (value: number) => padTop + ((maxPrice - value) / range) * chartHeight;
    const xStep = (width - padX * 2) / Math.max(points.length - 1, 1);
    const candleWidth = Math.max(1, Math.min(5, xStep * 0.64));
    const firstClose = points[0].close;
    const lastClose = points[points.length - 1].close || currentPrice;
    const halfYearChange = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
    const isTrendUp = halfYearChange >= 0;
    const ma20 = points.map((_, index) => {
      if (index < 19) return null;
      const window = points.slice(index - 19, index + 1);
      return window.reduce((sum, point) => sum + point.close, 0) / window.length;
    });
    const maPath = ma20
      .map((value, index) => value === null ? '' : `${padX + index * xStep},${y(value)}`)
      .filter(Boolean)
      .join(' ');
    const startLabel = points[0].date.slice(5).replace('-', '/');
    const endLabel = points[points.length - 1].date.slice(5).replace('-', '/');

    return (
      <div className="half-year-kline-panel" aria-label={`${stockCode} 半年日 K 線`}>
        <div className="half-year-kline-head">
          <span>半年K線</span>
          <span className={isTrendUp ? 'text-profit' : 'text-loss'}>
            {isTrendUp ? '+' : ''}{halfYearChange.toFixed(1)}%
          </span>
        </div>
        <svg className="half-year-kline-svg" viewBox={`0 0 ${width} ${height}`} role="img">
          {[0.25, 0.5, 0.75].map(level => (
            <line
              key={level}
              x1={padX}
              x2={width - padX}
              y1={padTop + chartHeight * level}
              y2={padTop + chartHeight * level}
              className="half-year-kline-grid"
            />
          ))}
          {maPath && (
            <polyline
              points={maPath}
              className="half-year-kline-ma"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {points.map((point, index) => {
            const x = padX + index * xStep;
            const openY = y(point.open);
            const closeY = y(point.close);
            const highY = y(point.high);
            const lowY = y(point.low);
            const up = point.close >= point.open;
            const bodyY = Math.min(openY, closeY);
            const bodyHeight = Math.max(Math.abs(closeY - openY), 1.4);
            return (
              <g key={`${point.date}-${index}`} className={up ? 'half-year-kline-up' : 'half-year-kline-down'}>
                <line x1={x} x2={x} y1={highY} y2={lowY} vectorEffect="non-scaling-stroke" />
                <rect
                  x={x - candleWidth / 2}
                  y={bodyY}
                  width={candleWidth}
                  height={bodyHeight}
                  rx="0.8"
                />
              </g>
            );
          })}
          <text x={padX} y={height - 3} className="half-year-kline-date">{startLabel}</text>
          <text x={width - padX} y={height - 3} textAnchor="end" className="half-year-kline-date">{endLabel}</text>
        </svg>
      </div>
    );
  }
