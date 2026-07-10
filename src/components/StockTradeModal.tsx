import { useEffect, useMemo, useState } from 'react';
import { formatMoney, formatPrice, useStore } from '../store';
import { createTradeSnapshotWebp, type TradeSnapshotPayload } from '../utils/tradeSnapshot';
import './StockTradeModal.css';

type TradeMode = 'buy' | 'sell';

type RiskWarning = {
  title: string;
  message: string;
  tip: string;
  icon: string;
  level?: 'info' | 'caution' | 'danger';
  details?: Array<{ label: string; value: string; tone?: 'normal' | 'profit' | 'loss' | 'warning' }>;
};

type StockTradeModalProps = {
  isOpen: boolean;
  mode: TradeMode;
  stockCode: string;
  stockName: string;
  price: number;
  industry?: string;
  snapshotContext?: Partial<TradeSnapshotPayload>;
  onClose: () => void;
};

export default function StockTradeModal({
  isOpen,
  mode,
  stockCode,
  stockName,
  price,
  industry,
  snapshotContext,
  onClose,
}: StockTradeModalProps) {
  const { user, holdings, dataReady, executeBuy, executeSell, getPortfolioSummary } = useStore();
  const holding = holdings.find(h => h.stockCode === stockCode);
  const summary = getPortfolioSummary();
  const [tradeMode, setTradeMode] = useState<TradeMode>(mode);
  const [quantity, setQuantity] = useState('');
  const [tradeUnit, setTradeUnit] = useState<'share' | 'lot'>('share');
  const [tradeReason, setTradeReason] = useState('');
  const [tradeResult, setTradeResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTrading, setIsTrading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [pendingWarnings, setPendingWarnings] = useState<RiskWarning[]>([]);
  const [showWarningModal, setShowWarningModal] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTradeMode(mode);
    setQuantity('');
    setTradeUnit('share');
    setTradeReason('');
    setTradeResult(null);
    setIsTrading(false);
    setSelectedFiles([]);
    setAttachmentError('');
    setPendingWarnings([]);
    setShowWarningModal(false);
  }, [isOpen, mode, stockCode]);

  const quantityNumber = parseInt(quantity, 10);
  const tradeShares = Number.isFinite(quantityNumber) && quantityNumber > 0
    ? quantityNumber * (tradeUnit === 'lot' ? 1000 : 1)
    : 0;
  const tradeUnitLabel = tradeUnit === 'lot' ? '張' : '股';

  const modalTitle = useMemo(() => (
    `${tradeMode === 'buy' ? '🛒 買入' : '💰 賣出'} ${stockName || stockCode}`
  ), [stockCode, stockName, tradeMode]);

  if (!isOpen) return null;

  async function handleTrade() {
    if (!stockCode || price <= 0) return;
    const qty = tradeShares;

    if (tradeMode === 'buy') {
      const warnings: RiskWarning[] = [];
      const totalAssets = summary.totalAssets;
      const buyAmount = qty * price;
      const feeRate = user?.brokerFeeRate ?? 0.001425;
      const minFee = user?.brokerMinFee ?? 20;
      const estimatedFee = Math.max(minFee, Math.round(buyAmount * feeRate));
      const finalBuyCost = buyAmount + estimatedFee;
      const stopLossPct = Math.min(80, Math.max(1, user?.stopLossAlertPct ?? 20));
      const stopLossPrice = price * (1 - stopLossPct / 100);
      const existingShares = holding?.totalShares ?? 0;
      const existingAvgCost = holding?.avgCost ?? 0;
      const existingCost = existingShares * existingAvgCost;
      const existingMarketValue = existingShares * price;
      const existingPnL = existingMarketValue - existingCost;
      const existingPnLPct = existingCost > 0 ? (existingPnL / existingCost) * 100 : 0;
      const newShares = existingShares + qty;
      const newAvgCost = newShares > 0 ? (existingCost + buyAmount) / newShares : price;
      const newPositionValue = newShares * price;
      const newPositionWeight = totalAssets > 0 ? (newPositionValue / totalAssets) * 100 : 0;
      const newPositionCost = existingCost + buyAmount;
      const balanceAfter = user ? user.availableBalance - finalBuyCost : null;
      const addOnStopLossLoss = Math.round(Math.max(0, price - stopLossPrice) * qty);
      const wholePositionStopLossPnL = Math.round((stopLossPrice - newAvgCost) * newShares);
      const addOnDetails: RiskWarning['details'] = holding ? [
        { label: '目前持股', value: `${existingShares.toLocaleString('zh-TW')} 股` },
        { label: '目前平均成本', value: `NT$ ${formatPrice(existingAvgCost)}` },
        { label: '目前價格', value: `NT$ ${formatPrice(price)}` },
        {
          label: '目前帳面損益',
          value: `${existingPnL >= 0 ? '+' : '-'}NT$ ${formatMoney(Math.abs(existingPnL))} (${existingPnLPct >= 0 ? '+' : ''}${existingPnLPct.toFixed(1)}%)`,
          tone: existingPnL >= 0 ? 'profit' : 'loss',
        },
        { label: '這次買入', value: `${qty.toLocaleString('zh-TW')} 股 / NT$ ${formatMoney(buyAmount)}` },
        { label: '預估含手續費花費', value: `NT$ ${formatMoney(finalBuyCost)}`, tone: 'warning' },
        { label: '買後總持股', value: `${newShares.toLocaleString('zh-TW')} 股` },
        { label: '買後平均成本', value: `NT$ ${formatPrice(newAvgCost)}`, tone: price < existingAvgCost ? 'warning' : 'normal' },
        { label: '買後總投入成本', value: `NT$ ${formatMoney(newPositionCost)}` },
        { label: '買後部位市值', value: `NT$ ${formatMoney(newPositionValue)}（總資產 ${newPositionWeight.toFixed(1)}%）`, tone: newPositionWeight > 15 ? 'warning' : 'normal' },
        { label: `跌到 -${stopLossPct}% 參考價`, value: `NT$ ${formatPrice(stopLossPrice)}` },
        { label: '本次加碼可能損失', value: `NT$ ${formatMoney(addOnStopLossLoss)}`, tone: 'loss' },
        {
          label: '整檔到參考價損益',
          value: `${wholePositionStopLossPnL >= 0 ? '+' : '-'}NT$ ${formatMoney(Math.abs(wholePositionStopLossPnL))}`,
          tone: wholePositionStopLossPnL >= 0 ? 'profit' : 'loss',
        },
        ...(balanceAfter !== null ? [{ label: '買後可用餘額', value: `NT$ ${formatMoney(balanceAfter)}`, tone: balanceAfter < 0 ? 'loss' : 'normal' } as const] : []),
      ] : undefined;

      if (totalAssets > 0 && newPositionValue / totalAssets > 0.15) {
        const pct = newPositionWeight.toFixed(1);
        warnings.push({
          icon: '📦',
          title: '單一股票部位偏高',
          message: `買入後，「${stockName || stockCode}」將占你總資金的 ${pct}%，超過了建議的 15% 上限。`,
          tip: '部位太集中時，單一股票下跌會明顯影響整體資產。下單前請確認這不是因為一時看好而把資金壓得太集中。',
          level: 'danger',
          details: [
            { label: '買後部位市值', value: `NT$ ${formatMoney(newPositionValue)}` },
            { label: '買後總資產占比', value: `${pct}%`, tone: 'warning' },
            { label: '建議上限', value: '15%' },
          ],
        });
      }

      if (holding) {
        if (price > holding.avgCost) {
          const profitRate = ((price - holding.avgCost) / holding.avgCost) * 100;
          warnings.push({
            icon: '📈',
            title: '獲利中加碼提醒',
            message: `目前這檔已有 ${profitRate.toFixed(1)}% 帳面獲利。獲利加碼可以是順勢，但買完後平均成本會提高，部位也會變大。`,
            tip: '請確認這次加碼是因為新的理由仍然成立，而不是因為目前賺錢就追高。加碼後如果回跌，原本獲利可能會被吃掉。',
            level: 'caution',
            details: addOnDetails,
          });
        } else if (price < holding.avgCost) {
          const lossRate = ((holding.avgCost - price) / holding.avgCost) * 100;
          const halfStopLossPct = stopLossPct / 2;
          const isOverStopLoss = lossRate >= stopLossPct;
          const isNearStopLoss = !isOverStopLoss && lossRate >= halfStopLossPct;
          warnings.push({
            icon: isOverStopLoss ? '🛑' : isNearStopLoss ? '🚨' : '⚠️',
            title: isOverStopLoss
              ? '超過停損提醒仍想攤平'
              : isNearStopLoss
                ? '接近停損區攤平警告'
                : '虧損中攤平警告',
            message: isOverStopLoss
              ? `目前已虧損 ${lossRate.toFixed(1)}%，超過你設定的 -${stopLossPct}% 停損提醒。這次買入會降低平均成本，但也會把更多資金放進正在虧損的股票。`
              : isNearStopLoss
                ? `目前已虧損 ${lossRate.toFixed(1)}%，接近你設定的 -${stopLossPct}% 停損提醒。攤平前要先確認走勢或理由是否真的改善。`
                : `目前已虧損 ${lossRate.toFixed(1)}%。攤平會讓平均成本下降，但帳面虧損不會消失，總投入金額會變大。`,
            tip: isOverStopLoss
              ? '這是最高風險加碼情境。請確認不是因為不想認賠而加碼；如果投資理由已經改變，先停下來比繼續投入更重要。'
              : '攤平不是降低風險，只是用更多資金換一個較低的平均成本。請把加碼後的總投入、總部位和可能損失一起看。',
            level: isOverStopLoss || isNearStopLoss ? 'danger' : 'caution',
            details: addOnDetails,
          });
        } else {
          warnings.push({
            icon: '⚖️',
            title: '接近成本加碼提醒',
            message: '目前價格接近你的平均成本。這次買入後部位會變大，後續上漲或下跌對帳戶的影響也會放大。',
            tip: '加碼前請先確認這筆新增資金的目的，是提高長期部位，還是只是因為價格沒有明顯變動就順手買進。',
            level: 'info',
            details: addOnDetails,
          });
        }
      }

      if (holding && holding.totalShares > 0) {
        const oneThirdShares = holding.totalShares / 3;
        if (qty > oneThirdShares) {
          const addOnPct = (qty / holding.totalShares) * 100;
          warnings.push({
            icon: '⚠️',
            title: '一次加碼太多了！',
            message: `你已持有 ${holding.totalShares.toLocaleString('zh-TW')} 股，這次想再買 ${qty.toLocaleString('zh-TW')} 股，等於現持股的 ${addOnPct.toFixed(1)}%，超過建議的 1/3。`,
            tip: '穩健的加碼方式通常是分批，而不是一次把部位拉大。請確認這筆單就算判斷錯了，帳戶仍然承受得住。',
            level: 'danger',
            details: [
              { label: '目前持股', value: `${holding.totalShares.toLocaleString('zh-TW')} 股` },
              { label: '本次加碼', value: `${qty.toLocaleString('zh-TW')} 股` },
              { label: '加碼比例', value: `${addOnPct.toFixed(1)}%`, tone: 'warning' },
              { label: '建議上限', value: `${Math.floor(oneThirdShares).toLocaleString('zh-TW')} 股以內` },
            ],
          });
        }
      }

      if (warnings.length > 0) {
        setPendingWarnings(warnings);
        setShowWarningModal(true);
        return;
      }
    }

    await doExecuteTrade();
  }

  async function doExecuteTrade() {
    if (!stockCode) return;
    if (price <= 0) {
      setTradeResult({ success: false, message: '❌ 無法取得目前股價，請稍後重試或重新整理頁面。' });
      return;
    }
    if (isTrading) return;
    setIsTrading(true);
    setShowWarningModal(false);
    const qty = tradeShares;

    try {
      const result = tradeMode === 'buy'
        ? await executeBuy(stockCode, stockName || stockCode, qty, price, industry || holding?.industry || '', tradeReason.trim())
        : await executeSell(stockCode, qty, price, tradeReason.trim());
      let finalMessage = result.message;

      if (result.success && result.trade) {
        const latestState = useStore.getState();
        const latestHolding = latestState.holdings.find(h => h.stockCode === stockCode);
        const latestUser = latestState.user;
        const snapshotPayload: TradeSnapshotPayload = {
          stockCode,
          stockName: stockName || stockCode,
          tradeType: tradeMode,
          quantity: qty,
          price,
          totalAmount: result.trade.totalAmount,
          reason: tradeReason.trim(),
          timestamp: result.trade.timestamp,
          ...snapshotContext,
          holdingSharesAfter: latestHolding?.totalShares ?? 0,
          avgCostAfter: latestHolding?.avgCost ?? null,
          balanceAfter: latestUser?.availableBalance ?? null,
        };
        try {
          const snapshotBlob = await createTradeSnapshotWebp(snapshotPayload);
          const { chartPrices: _chartPrices, ...snapshotMeta } = snapshotPayload;
          void _chartPrices;
          const uploadResult = await latestState.uploadTradeAttachments(
            result.trade.id,
            stockCode,
            [snapshotBlob],
            'auto_snapshot',
            snapshotMeta as unknown as Record<string, unknown>
          );
          if (uploadResult.error) finalMessage += `\n⚠️ 自動快照保存失敗：${uploadResult.error}`;
        } catch (snapshotErr) {
          console.warn('create trade snapshot failed:', snapshotErr);
          finalMessage += '\n⚠️ 自動快照保存失敗，可稍後在交易紀錄補充附件。';
        }

        if (selectedFiles.length > 0) {
          const manualResult = await latestState.uploadTradeAttachments(result.trade.id, stockCode, selectedFiles, 'manual');
          if (manualResult.error) finalMessage += `\n⚠️ 手動附件保存失敗：${manualResult.error}`;
        }
      }

      setTradeResult({ success: result.success, message: finalMessage });
      if (result.success) {
        setQuantity('');
        setTradeUnit('share');
        setTradeReason('');
        setSelectedFiles([]);
        setAttachmentError('');
      }
    } catch (err) {
      console.error('doExecuteTrade error:', err);
      setTradeResult({ success: false, message: '⚠️ 交易時發生錯誤，請檢查網路後再試一次。' });
    } finally {
      setIsTrading(false);
    }
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-handle"></div>
          {tradeResult?.success ? (
            <div className="trade-success-screen stock-trade-success-screen">
              <div className="stock-trade-success-icon">🎉</div>
              <h3 className="stock-trade-success-title">{tradeMode === 'buy' ? '買入成功！' : '賣出成功！'}</h3>
              <div className="trade-result trade-success stock-trade-result">{tradeResult.message}</div>
              <button
                className="btn btn-buy btn-lg btn-block"
                onClick={() => {
                  onClose();
                  setTradeResult(null);
                }}
              >
                太棒了
              </button>
            </div>
          ) : (
            <>
              <h3 className="trade-modal-title">{modalTitle}</h3>

              <div className="trade-modal-price">
                以收盤價 <strong>NT$ {formatPrice(price)}</strong> 交易
              </div>

              {tradeMode === 'buy' && user && (
                <div className="trade-modal-balance">
                  可用餘額：NT$ {formatMoney(user.availableBalance)}
                </div>
              )}
              {tradeMode === 'sell' && holding && (
                <div className="trade-modal-balance">
                  可賣股數：{holding.totalShares.toLocaleString('zh-TW')} 股
                </div>
              )}

              <div className="input-group">
                <div className="trade-unit-header">
                  <label className="input-label">交易單位</label>
                  <div className="trade-unit-toggle" role="group" aria-label="選擇交易單位">
                    <button
                      type="button"
                      className={`trade-unit-btn${tradeUnit === 'share' ? ' active' : ''}`}
                      onClick={() => setTradeUnit('share')}
                    >
                      股
                    </button>
                    <button
                      type="button"
                      className={`trade-unit-btn${tradeUnit === 'lot' ? ' active' : ''}`}
                      onClick={() => setTradeUnit('lot')}
                    >
                      張
                    </button>
                  </div>
                </div>
                <input
                  className="input-field"
                  type="number"
                  min="1"
                  step="1"
                  placeholder={tradeUnit === 'lot' ? '輸入要交易的張數' : '輸入要交易的股數'}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                <div className="trade-unit-hint">
                  {quantity && tradeShares > 0
                    ? `${quantity} ${tradeUnitLabel} = ${tradeShares.toLocaleString('zh-TW')} 股`
                    : tradeUnit === 'lot'
                      ? '1 張 = 1,000 股'
                      : '以 1 股為單位交易'}
                </div>
              </div>

              <div className="input-group stock-trade-note-group">
                <label className="input-label">投資筆記（告訴 PPBear 為什麼想{tradeMode === 'buy' ? '買' : '賣'}？）</label>
                <textarea
                  className="input-field stock-trade-note"
                  placeholder="我想要因為..."
                  value={tradeReason}
                  onChange={(e) => setTradeReason(e.target.value)}
                />
              </div>

              <div className="input-group stock-trade-attachment-group">
                <label className="input-label">補充附件（可選 JPG / PNG / PDF）</label>
                <input
                  className="stock-trade-file-input"
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    const allowed = files.filter(file => ['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) && file.size <= 10 * 1024 * 1024);
                    setAttachmentError(allowed.length !== files.length ? '部分檔案格式不支援或超過 10MB，已自動略過。' : '');
                    setSelectedFiles(allowed.slice(0, 6));
                  }}
                />
                {selectedFiles.length > 0 && (
                  <div className="stock-trade-file-list">
                    {selectedFiles.map((file, idx) => (
                      <div key={`${file.name}-${idx}`} className="stock-trade-file-chip">
                        <span>{file.type === 'application/pdf' ? 'PDF' : 'IMG'}</span>
                        <strong>{file.name}</strong>
                        <button type="button" onClick={() => setSelectedFiles(files => files.filter((_, fileIdx) => fileIdx !== idx))}>移除</button>
                      </div>
                    ))}
                  </div>
                )}
                {attachmentError && <div className="stock-trade-attachment-error">{attachmentError}</div>}
              </div>

              {quantity && tradeShares > 0 && (() => {
                const q = tradeShares;
                const baseValue = q * price;
                const feeRate = user?.brokerFeeRate ?? 0.001425;
                const minFee = user?.brokerMinFee ?? 20;
                const taxRate = user?.brokerTaxRate ?? 0.003;
                const estFee = Math.max(minFee, Math.round(baseValue * feeRate));
                const estTax = tradeMode === 'sell' ? Math.round(baseValue * taxRate) : 0;
                const finalTotal = tradeMode === 'buy' ? baseValue + estFee : baseValue - estFee - estTax;
                const stopLossPct = Math.min(80, Math.max(1, user?.stopLossAlertPct ?? 20));
                const stopLossPrice = price * (1 - stopLossPct / 100);
                const estimatedStopLossLoss = Math.round((price - stopLossPrice) * q);
                const affordableLossPct = user?.availableBalance
                  ? (estimatedStopLossLoss / Math.max(user.availableBalance, 1)) * 100
                  : 0;

                return (
                  <div className="trade-preview">
                    <div className="trade-preview-row">
                      <span>交易股數</span>
                      <span>{q.toLocaleString('zh-TW')} 股</span>
                    </div>
                    <div className="trade-preview-row">
                      <span>股票市值</span>
                      <span>NT$ {formatMoney(baseValue)}</span>
                    </div>
                    <div className="trade-preview-row">
                      <span>券商手續費</span>
                      <span>NT$ {formatMoney(estFee)}</span>
                    </div>
                    {tradeMode === 'sell' && (
                      <div className="trade-preview-row">
                        <span>證交稅</span>
                        <span>NT$ {formatMoney(estTax)}</span>
                      </div>
                    )}
                    <div className="trade-preview-row stock-trade-preview-total">
                      <span>預估{tradeMode === 'buy' ? '總花費' : '實收金額'}</span>
                      <span className={tradeMode === 'buy' ? '' : 'text-profit'}>NT$ {formatMoney(finalTotal)}</span>
                    </div>
                    {tradeMode === 'buy' && (
                      <div className="trade-risk-preview">
                        <div className="stock-trade-risk-head">
                          <span>🛡️ 停損風險預估</span>
                          <strong>-{stopLossPct}%</strong>
                        </div>
                        <div className="trade-preview-row">
                          <span>停損參考價</span>
                          <span>NT$ {formatPrice(stopLossPrice)}</span>
                        </div>
                        <div className="trade-preview-row">
                          <span>跌到停損時預估損失</span>
                          <span className="text-loss">NT$ {formatMoney(estimatedStopLossLoss)}</span>
                        </div>
                        <div className="stock-trade-risk-note">
                          如果股價跌到 NT$ {formatPrice(stopLossPrice)}，這筆單大約會虧 NT$ {formatMoney(estimatedStopLossLoss)}
                          {user?.availableBalance ? `，約佔目前可用餘額 ${affordableLossPct.toFixed(1)}%。` : '。'}
                          下單前先想想：這個損失你能接受嗎？
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {tradeResult && !tradeResult.success && (
                <div className="trade-result trade-error">{tradeResult.message}</div>
              )}

              <button
                className={`btn ${tradeMode === 'buy' ? 'btn-buy' : 'btn-sell'} btn-lg btn-block`}
                disabled={isTrading || !dataReady}
                onClick={() => {
                  if (!dataReady) {
                    alert('⚠️ 帳號資料尚未同步完成，請稍候幾秒後再下單！');
                    return;
                  }
                  if (!quantity || tradeShares <= 0) {
                    alert(`⚠️ 請輸入大於 0 的正確交易${tradeUnitLabel}數！`);
                    return;
                  }
                  if (!tradeReason.trim()) {
                    alert(`⚠️ 下單前請先填寫「投資筆記」，告訴 PPBear 為什麼想${tradeMode === 'buy' ? '買' : '賣'}這檔股票喔！`);
                    return;
                  }
                  handleTrade();
                }}
                style={(isTrading || !dataReady) ? { opacity: 0.85, cursor: 'not-allowed' } : {}}
              >
                {!dataReady ? (
                  <span className="stock-trade-spinner-label">
                    <span className="stock-trade-spinner" />
                    資料同步中...
                  </span>
                ) : isTrading ? (
                  <span className="stock-trade-spinner-label">
                    <span className="stock-trade-spinner" />
                    交易中，請稍候...
                  </span>
                ) : `確認${tradeMode === 'buy' ? '買入' : '賣出'}`}
              </button>
            </>
          )}
        </div>
      </div>

      {showWarningModal && (
        <div className="modal-overlay">
          <div className="modal-content stock-trade-warning-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-handle"></div>
            <div className="stock-trade-warning-icon">🐻‍❄️</div>
            <h3 className="stock-trade-warning-title">讓 PPBear 先警告你！</h3>
            <p className="stock-trade-warning-subtitle">
              這次交易有 {pendingWarnings.length} 個地方需要注意，但你還是可以自己決定
            </p>

            {pendingWarnings.map((w, idx) => (
              <div key={idx} className={`stock-trade-warning-card ${w.level || 'info'}`}>
                <div className="stock-trade-warning-card-title">
                  {w.icon} <span>{w.title}</span>
                </div>
                <p>{w.message}</p>
                {w.details && w.details.length > 0 && (
                  <div className="stock-trade-warning-details">
                    {w.details.map((detail, detailIdx) => (
                      <div key={`${detail.label}-${detailIdx}`}>
                        <span>{detail.label}</span>
                        <strong className={detail.tone ? `tone-${detail.tone}` : ''}>{detail.value}</strong>
                      </div>
                    ))}
                  </div>
                )}
                <div className="stock-trade-warning-tip">
                  💡 <strong>投資教室：</strong> {w.tip}
                </div>
              </div>
            ))}

            <div className="stock-trade-warning-actions">
              <button
                className="btn stock-trade-warning-cancel"
                disabled={isTrading}
                onClick={() => setShowWarningModal(false)}
              >
                再想想🤔
              </button>
              <button
                className="btn btn-buy stock-trade-warning-confirm"
                disabled={isTrading}
                onClick={doExecuteTrade}
              >
                {isTrading ? (
                  <span className="stock-trade-spinner-label">
                    <span className="stock-trade-spinner small" />
                    交易中，請稍候...
                  </span>
                ) : pendingWarnings.some(w => w.level === 'danger')
                  ? '我知道後果，仍要買'
                  : '我已看過數據，仍要買'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
