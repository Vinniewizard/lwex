import { NotificationSettings, TradeHistoryItem } from '../types';

export const formatTelegramAlert = (
  type: 'trade' | 'balance' | 'promotion',
  settings: NotificationSettings,
  data: any
): string | null => {
  if (type === 'trade' && !settings.tradeSettlement) return null;
  if (type === 'balance' && !settings.balanceUpdate) return null;
  if (type === 'promotion' && !settings.promotion) return null;

  switch (type) {
    case 'trade':
      const trade = data as TradeHistoryItem;
      return `<b>TRADE SETTLEMENT</b>\n\nResult: <b>${trade.status.toUpperCase()}</b>\nAsset: ${trade.assetSymbol}\nProfit: <b>$${trade.profit.toFixed(2)}</b>\nMethod: USDT-TRC20`;
    case 'balance':
      return `<b>BALANCE UPDATE</b>\n\nNew Balance: <b>$${data.balance.toFixed(2)}</b>\nStatus: Processed ✅`;
    case 'promotion':
      return `<b>PROMOTION</b>\n\n${data.text}`;
    default:
      return null;
  }
};
