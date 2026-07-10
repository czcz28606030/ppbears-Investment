import type { StockPrice, TradeType } from '../types';

export type TradeSnapshotPayload = {
  stockCode: string;
  stockName: string;
  tradeType: TradeType;
  quantity: number;
  price: number;
  totalAmount: number;
  reason?: string;
  timestamp: number;
  market?: string;
  changePercent?: number | null;
  changeAmount?: number | null;
  open?: string | number | null;
  high?: string | number | null;
  low?: string | number | null;
  volume?: string | number | null;
  priceDate?: string;
  aiRecommendation?: string | null;
  stockEssenceScore?: string | number | null;
  cumulativeReturn?: string | number | null;
  holdingSharesAfter?: number | null;
  avgCostAfter?: number | null;
  balanceAfter?: number | null;
  chartPrices?: StockPrice[];
};

const WIDTH = 1080;
const HEIGHT = 1350;

function money(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return '--';
  return `NT$ ${Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`;
}

function compact(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '--';
  if (typeof value === 'number') return value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
  return String(value);
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, options: {
  size?: number;
  weight?: string;
  color?: string;
  align?: CanvasTextAlign;
  maxWidth?: number;
} = {}) {
  ctx.fillStyle = options.color || '#24170f';
  ctx.font = `${options.weight || '700'} ${options.size || 32}px "Noto Sans TC", "Microsoft JhengHei", Arial, sans-serif`;
  ctx.textAlign = options.align || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, y, options.maxWidth);
}

function drawMetric(ctx: CanvasRenderingContext2D, label: string, value: string, x: number, y: number, w: number, color = '#24170f') {
  drawRoundRect(ctx, x, y, w, 104, 22);
  ctx.fillStyle = '#fff9e8';
  ctx.fill();
  text(ctx, label, x + 24, y + 36, { size: 22, color: '#8a7c70', weight: '800' });
  text(ctx, value, x + 24, y + 78, { size: 28, color, weight: '900', maxWidth: w - 48 });
}

function drawChart(ctx: CanvasRenderingContext2D, prices: StockPrice[] | undefined, x: number, y: number, w: number, h: number) {
  drawRoundRect(ctx, x, y, w, h, 24);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(36, 23, 15, 0.08)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const valid = (prices || [])
    .map(p => ({
      open: Number(p.open_d),
      high: Number(p.high_d),
      low: Number(p.low_d),
      close: Number(p.close_d),
      volume: Number(p.volume),
    }))
    .filter(p => Number.isFinite(p.open) && Number.isFinite(p.high) && Number.isFinite(p.low) && Number.isFinite(p.close) && p.close > 0)
    .slice(-90);

  text(ctx, '技術線圖', x + 28, y + 46, { size: 28, weight: '900' });
  text(ctx, '日K / MA5 / MA20', x + 160, y + 46, { size: 22, color: '#9b8d80', weight: '800' });

  const chartX = x + 52;
  const chartY = y + 78;
  const chartW = w - 104;
  const chartH = h - 128;
  ctx.strokeStyle = 'rgba(36, 23, 15, 0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const gy = chartY + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(chartX, gy);
    ctx.lineTo(chartX + chartW, gy);
    ctx.stroke();
  }

  if (valid.length < 2) {
    text(ctx, '線圖資料暫無法保存', x + w / 2, y + h / 2, { size: 30, color: '#9b8d80', align: 'center' });
    return;
  }

  const min = Math.min(...valid.map(p => p.low));
  const max = Math.max(...valid.map(p => p.high));
  const scale = (value: number) => chartY + chartH - ((value - min) / Math.max(max - min, 1)) * chartH;
  const candleW = Math.max(4, chartW / valid.length * 0.52);

  valid.forEach((p, i) => {
    const cx = chartX + (i / Math.max(valid.length - 1, 1)) * chartW;
    const up = p.close >= p.open;
    ctx.strokeStyle = up ? '#dc2626' : '#16a34a';
    ctx.fillStyle = up ? '#dc2626' : '#16a34a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, scale(p.high));
    ctx.lineTo(cx, scale(p.low));
    ctx.stroke();
    const top = Math.min(scale(p.open), scale(p.close));
    const bottom = Math.max(scale(p.open), scale(p.close));
    ctx.fillRect(cx - candleW / 2, top, candleW, Math.max(bottom - top, 2));
  });

  const drawMa = (days: number, color: string) => {
    const points = valid.map((_, i) => {
      if (i < days - 1) return null;
      const avg = valid.slice(i - days + 1, i + 1).reduce((sum, p) => sum + p.close, 0) / days;
      return { x: chartX + (i / Math.max(valid.length - 1, 1)) * chartW, y: scale(avg) };
    }).filter(Boolean) as Array<{ x: number; y: number }>;
    if (points.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  };
  drawMa(5, '#f59e0b');
  drawMa(20, '#7b2cbf');
}

export async function createTradeSnapshotWebp(payload: TradeSnapshotPayload): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('snapshot_canvas_unavailable');

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#fff0b8');
  gradient.addColorStop(0.55, '#fff8df');
  gradient.addColorStop(1, '#f7fbff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawRoundRect(ctx, 64, 58, WIDTH - 128, HEIGHT - 116, 46);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
  ctx.fill();

  const tradeColor = payload.tradeType === 'buy' ? '#ff595e' : '#8ac926';
  const change = Number(payload.changePercent || 0);
  const changeColor = change >= 0 ? '#dc2626' : '#16a34a';
  const tradeLabel = payload.tradeType === 'buy' ? '買入' : '賣出';
  const date = new Date(payload.timestamp).toLocaleString('zh-TW', { hour12: false });

  text(ctx, `${payload.stockCode} ${payload.stockName}`, 104, 138, { size: 50, weight: '900', maxWidth: 700 });
  drawRoundRect(ctx, 782, 86, 194, 58, 29);
  ctx.fillStyle = tradeColor;
  ctx.fill();
  text(ctx, tradeLabel, 879, 125, { size: 30, weight: '900', color: '#fff', align: 'center' });
  text(ctx, date, 104, 188, { size: 25, color: '#8a7c70', weight: '800' });

  text(ctx, money(payload.price), 104, 286, { size: 74, weight: '900' });
  text(
    ctx,
    `${change >= 0 ? '+' : ''}${change.toFixed(2)}% ${payload.changeAmount != null ? `(${change >= 0 ? '+' : ''}${Number(payload.changeAmount).toFixed(2)}元)` : ''}`,
    104,
    336,
    { size: 34, weight: '900', color: changeColor }
  );

  drawMetric(ctx, '開盤', compact(payload.open), 104, 384, 204);
  drawMetric(ctx, '最高', compact(payload.high), 328, 384, 204, '#dc2626');
  drawMetric(ctx, '最低', compact(payload.low), 552, 384, 204, '#16a34a');
  drawMetric(ctx, '成交量', compact(payload.volume), 776, 384, 200);

  drawMetric(ctx, 'AI推薦度', compact(payload.aiRecommendation), 104, 522, 276, '#b91c1c');
  drawMetric(ctx, '股票本質分數', payload.stockEssenceScore != null ? `${compact(payload.stockEssenceScore)} / 10` : '--', 402, 522, 276, '#7b2cbf');
  drawMetric(ctx, '累積報酬率', compact(payload.cumulativeReturn), 700, 522, 276, '#0f766e');

  drawChart(ctx, payload.chartPrices, 104, 660, 872, 414);

  text(ctx, '交易摘要', 104, 1136, { size: 30, weight: '900' });
  const rows = [
    [`${tradeLabel}股數`, `${payload.quantity.toLocaleString('zh-TW')} 股`],
    ['成交金額', money(payload.totalAmount)],
    ['持股', payload.holdingSharesAfter != null ? `${payload.holdingSharesAfter.toLocaleString('zh-TW')} 股` : '--'],
    ['平均成本', payload.avgCostAfter != null ? money(payload.avgCostAfter) : '--'],
    ['可用餘額', payload.balanceAfter != null ? money(payload.balanceAfter) : '--'],
  ];
  rows.forEach((row, i) => {
    const y = 1192 + i * 42;
    text(ctx, row[0], 124, y, { size: 24, color: '#8a7c70', weight: '800' });
    text(ctx, row[1], 320, y, { size: 25, weight: '900', maxWidth: 620 });
  });
  if (payload.reason) {
    text(ctx, `筆記：${payload.reason}`, 104, 1306, { size: 24, color: '#5f5348', weight: '800', maxWidth: 872 });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('snapshot_webp_failed'));
    }, 'image/webp', 0.82);
  });
}
