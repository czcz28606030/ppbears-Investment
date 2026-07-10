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
  industry?: string | null;
  changePercent?: number | null;
  changeAmount?: number | null;
  open?: string | number | null;
  high?: string | number | null;
  low?: string | number | null;
  volume?: string | number | null;
  priceDate?: string;
  aiRecommendation?: string | null;
  aiSignalLabel?: string | null;
  addPriorityScore?: string | number | null;
  addPriorityLabel?: string | null;
  stockEssenceScore?: string | number | null;
  cumulativeReturn?: string | number | null;
  chipScore?: string | number | null;
  chipLabel?: string | null;
  cautionLabel?: string | null;
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

function firstPart(value: string | null | undefined): string {
  const cleaned = String(value || '').split(',')[0]?.trim();
  return cleaned || '--';
}

function scoreDisplay(value: string | number | null | undefined, suffix = '分'): string {
  if (value === null || value === undefined || value === '') return '--';
  if (typeof value === 'number') return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}${suffix}`;
  return String(value);
}

function chipDisplay(score: string | number | null | undefined, label?: string | null): string {
  const scoreText = scoreDisplay(score, '分');
  const cleanLabel = String(label || '').replace(/[🏆✨👍⚠️🔴]/g, '').trim();
  if (scoreText === '--') return cleanLabel || '--';
  return cleanLabel ? `${scoreText} ${cleanLabel}` : scoreText;
}

function shareDisplay(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return '--';
  const shares = Number(value);
  if (Math.abs(shares) >= 1000) {
    const lots = shares / 1000;
    return `${lots.toLocaleString('zh-TW', { maximumFractionDigits: lots >= 100 ? 0 : 2 })} 張`;
  }
  return `${shares.toLocaleString('zh-TW')} 股`;
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

function drawInfoCard(ctx: CanvasRenderingContext2D, label: string, value: string, x: number, y: number, w: number, color = '#24170f') {
  drawRoundRect(ctx, x, y, w, 86, 18);
  ctx.fillStyle = '#fffaf0';
  ctx.fill();
  ctx.strokeStyle = 'rgba(36, 23, 15, 0.05)';
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, label, x + 18, y + 30, { size: 19, color: '#8a7c70', weight: '900' });
  text(ctx, value, x + 18, y + 64, { size: 24, color, weight: '900', maxWidth: w - 36 });
}

function drawPill(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, w: number, bg: string, color: string) {
  drawRoundRect(ctx, x, y, w, 42, 21);
  ctx.fillStyle = bg;
  ctx.fill();
  text(ctx, value, x + w / 2, y + 29, { size: 20, color, weight: '900', align: 'center', maxWidth: w - 20 });
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
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.fill();

  const tradeColor = payload.tradeType === 'buy' ? '#ff595e' : '#8ac926';
  const change = Number(payload.changePercent || 0);
  const changeColor = change >= 0 ? '#dc2626' : '#16a34a';
  const tradeLabel = payload.tradeType === 'buy' ? '買入' : '賣出';
  const date = new Date(payload.timestamp).toLocaleString('zh-TW', { hour12: false });
  const marketIndustry = `${payload.market || '--'} · ${firstPart(payload.industry)}`;

  text(ctx, `${payload.stockCode} ${payload.stockName}`, 104, 138, { size: 50, weight: '900', maxWidth: 640 });
  drawRoundRect(ctx, 782, 86, 194, 58, 29);
  ctx.fillStyle = tradeColor;
  ctx.fill();
  text(ctx, tradeLabel, 879, 125, { size: 30, weight: '900', color: '#fff', align: 'center' });
  text(ctx, date, 104, 188, { size: 25, color: '#8a7c70', weight: '800' });
  drawPill(ctx, marketIndustry, 104, 210, 344, '#dcfce7', '#047857');
  drawPill(ctx, compact(payload.aiSignalLabel), 468, 210, 230, '#eef2ff', '#4338ca');

  text(ctx, money(payload.price), 104, 314, { size: 74, weight: '900' });
  text(
    ctx,
    `${change >= 0 ? '+' : ''}${change.toFixed(2)}% ${payload.changeAmount != null ? `(${change >= 0 ? '+' : ''}${Number(payload.changeAmount).toFixed(2)}元)` : ''}`,
    104,
    364,
    { size: 34, weight: '900', color: changeColor }
  );

  drawRoundRect(ctx, 732, 210, 244, 154, 24);
  ctx.fillStyle = '#fff9e8';
  ctx.fill();
  text(ctx, '持股狀態', 758, 250, { size: 22, color: '#8a7c70', weight: '900' });
  text(ctx, shareDisplay(payload.holdingSharesAfter), 758, 300, { size: 36, weight: '900', maxWidth: 190 });
  text(ctx, `成本 ${payload.avgCostAfter != null ? compact(payload.avgCostAfter) : '--'}`, 758, 338, { size: 23, color: '#8a7c70', weight: '900', maxWidth: 190 });

  drawMetric(ctx, '開盤', compact(payload.open), 104, 410, 204);
  drawMetric(ctx, '最高', compact(payload.high), 328, 410, 204, '#dc2626');
  drawMetric(ctx, '最低', compact(payload.low), 552, 410, 204, '#16a34a');
  drawMetric(ctx, '成交量', compact(payload.volume), 776, 410, 200);

  drawMetric(ctx, 'AI推薦度', compact(payload.aiRecommendation), 104, 548, 276, '#b91c1c');
  drawMetric(ctx, '股票本質分數', scoreDisplay(payload.stockEssenceScore), 402, 548, 276, '#7b2cbf');
  drawMetric(ctx, '累積報酬率', compact(payload.cumulativeReturn), 700, 548, 276, '#0f766e');

  drawChart(ctx, payload.chartPrices, 104, 676, 872, 390);

  drawInfoCard(ctx, 'AI狀態', compact(payload.aiSignalLabel), 104, 1096, 204, '#4338ca');
  drawInfoCard(ctx, '加碼時機', payload.addPriorityScore != null ? `${compact(payload.addPriorityScore)}分` : '--', 328, 1096, 204, '#c2410c');
  drawInfoCard(ctx, '判讀', compact(payload.addPriorityLabel), 552, 1096, 204, '#9a3412');
  drawInfoCard(ctx, '風險提醒', compact(payload.cautionLabel), 776, 1096, 200, '#dc2626');

  drawInfoCard(ctx, '市場/產業', marketIndustry, 104, 1202, 276, '#047857');
  drawInfoCard(ctx, '籌碼', chipDisplay(payload.chipScore, payload.chipLabel), 402, 1202, 276, '#0f766e');
  drawInfoCard(ctx, `${tradeLabel}股數`, shareDisplay(payload.quantity), 700, 1202, 276, tradeColor);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('snapshot_webp_failed'));
    }, 'image/webp', 0.82);
  });
}