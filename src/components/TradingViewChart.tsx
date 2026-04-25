import { useEffect, useRef, useState, memo } from 'react';

interface TradingViewChartProps {
  symbol: string; // e.g. "TWSE:2330" or "TPEX:6257"
  stockCode: string; // e.g. "2330" — 用於 Yahoo fallback
}

/**
 * 嵌入式 TradingView 即時技術線圖
 * 使用 Advanced Chart widget，若台股因授權限制無法顯示
 * 則自動 fallback 顯示 Yahoo 奇摩技術線圖連結
 */
const TradingViewChart = memo(function TradingViewChart({ symbol, stockCode }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setLoadFailed(false);

    // 清除舊 widget
    container.innerHTML = '';

    // 建立 widget 內容區
    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    widgetDiv.style.height = 'calc(100% - 32px)';
    widgetDiv.style.width = '100%';
    container.appendChild(widgetDiv);

    // 建立 TradingView 版權連結（免費使用必須保留）
    const copyrightDiv = document.createElement('div');
    copyrightDiv.className = 'tradingview-widget-copyright';
    copyrightDiv.style.cssText = 'font-size: 11px; color: #9db2bd; text-align: center; padding: 4px 0;';
    const link = document.createElement('a');
    link.href = 'https://www.tradingview.com/';
    link.rel = 'noopener nofollow';
    link.target = '_blank';
    link.style.color = '#9db2bd';
    link.textContent = 'TradingView 提供技術線圖';
    copyrightDiv.appendChild(link);
    container.appendChild(copyrightDiv);

    // 載入 TradingView Widget Script
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: symbol,
      interval: 'D',
      timezone: 'Asia/Taipei',
      theme: 'light',
      style: '1',        // Candlestick K 線
      locale: 'zh_TW',
      allow_symbol_change: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: 'https://www.tradingview.com',
    });

    script.onerror = () => setLoadFailed(true);
    container.appendChild(script);

    // 超時偵測：如果 10 秒後 widget 內容區仍然為空（無 iframe），視為載入失敗
    const timeout = setTimeout(() => {
      const iframe = container.querySelector('iframe');
      if (!iframe) {
        setLoadFailed(true);
      }
    }, 10000);

    return () => {
      clearTimeout(timeout);
      if (container) container.innerHTML = '';
    };
  }, [symbol]);

  if (loadFailed) {
    return (
      <div className="tv-chart-fallback">
        <div className="tv-chart-fallback-icon">📈</div>
        <div className="tv-chart-fallback-text">
          台股技術線圖載入中，或可直接查看：
        </div>
        <button
          className="tv-chart-fallback-btn"
          onClick={() => window.open(`https://tw.stock.yahoo.com/quote/${stockCode}.TW/technical-analysis`, '_blank')}
        >
          📊 開啟 Yahoo 奇摩技術線圖
        </button>
        <button
          className="tv-chart-fallback-btn tv-chart-fallback-btn-tv"
          onClick={() => window.open(`https://www.tradingview.com/chart/?symbol=TWSE:${stockCode}`, '_blank')}
        >
          📈 開啟 TradingView 線圖
        </button>
      </div>
    );
  }

  return (
    <div
      className="tradingview-widget-container"
      ref={containerRef}
      style={{ height: 420, width: '100%' }}
    />
  );
});

export default TradingViewChart;
