import React, { useState, useEffect, useRef } from 'react';
import { 
  RefreshCw, ShieldCheck, DollarSign, Coins, MessageSquare, 
  Clock, ArrowRight, ChevronRight, AlertCircle, X, Send, CheckCircle, ShieldAlert 
} from 'lucide-react';

interface P2POrder {
  id: string;
  user_id: string;
  type: 'buy' | 'sell';
  coin: string;
  amount: number;
  price: number;
  status: 'open' | 'trading' | 'completed' | 'cancelled';
  paymentMethod: string;
}

interface TradeSession {
  id: string;
  order_id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  price: number;
  coin: string;
  status: 'open' | 'paid' | 'completed' | 'cancelled' | 'disputed';
  chat_messages: string; // JSON string
  created_at: string;
}

interface ChatMessage {
  id: string;
  sender: string;
  senderEmail?: string;
  text: string;
  timestamp: string;
}

interface P2PMarketplaceProps {
  currentUser: any;
  isDark: boolean;
}

export default function P2PMarketplace({ currentUser, isDark }: P2PMarketplaceProps) {
  const [orders, setOrders] = useState<P2POrder[]>([]);
  const [activeTrades, setActiveTrades] = useState<TradeSession[]>([]);
  const [currentTrade, setCurrentTrade] = useState<TradeSession | null>(null);
  const [currentTradeBuyerEmail, setCurrentTradeBuyerEmail] = useState('');
  const [currentTradeSellerEmail, setCurrentTradeSellerEmail] = useState('');
  
  const [activeTab, setActiveTab] = useState<'market' | 'my-trades'>('market');
  const [filterType, setFilterType] = useState<'all' | 'buy' | 'sell'>('all');
  const [onlyHighTrust, setOnlyHighTrust] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  
  const [newOrder, setNewOrder] = useState({ type: 'buy', coin: 'USDT', amount: '', price: '', paymentMethod: 'Bank Transfer' });
  const [selectedOrder, setSelectedOrder] = useState<P2POrder | null>(null);
  const [initiateAmount, setInitiateAmount] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  
  const [timeLeft, setTimeLeft] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchOrders();
    if (currentUser) {
      fetchMyTrades();
    }
  }, [currentUser]);

  // Autorefresh active trade chat & status
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (currentTrade) {
      interval = setInterval(() => {
        refreshCurrentTrade(currentTrade.id);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [currentTrade?.id]);

  // Scroll to bottom on new chat message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentTrade?.chat_messages]);

  // Countdown timer for 30 minutes expired
  useEffect(() => {
    if (!currentTrade) return;
    const timer = setInterval(() => {
      const created = new Date(currentTrade.created_at).getTime();
      const expires = created + 30 * 60 * 1000;
      const remaining = expires - Date.now();
      if (remaining <= 0) {
        setTimeLeft('Expired');
        clearInterval(timer);
      } else {
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        setTimeLeft(`${mins}:${secs < 10 ? '0' : ''}${secs}`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [currentTrade]);

  const fetchOrders = async () => {
    try {
      const response = await fetch('/api/p2p/orders');
      const data = await response.json();
      if (data.success) {
        setOrders(data.orders);
      }
    } catch (e) {
      console.error('Error fetching orders:', e);
    }
  };

  const fetchMyTrades = async () => {
    if (!currentUser) return;
    try {
      const response = await fetch('/api/p2p/trades', {
        headers: { 'Authorization': `Bearer ${currentUser.id}` }
      });
      const data = await response.json();
      if (data.success) {
        setActiveTrades(data.trades);
      }
    } catch (e) {
      console.error('Error fetching my trades:', e);
    }
  };

  const refreshCurrentTrade = async (tradeId: string) => {
    if (!currentUser) return;
    try {
      const response = await fetch(`/api/p2p/trades/${tradeId}`, {
        headers: { 'Authorization': `Bearer ${currentUser.id}` }
      });
      const data = await response.json();
      if (data.success) {
        setCurrentTrade(data.trade);
        setCurrentTradeBuyerEmail(data.buyerEmail);
        setCurrentTradeSellerEmail(data.sellerEmail);
      }
    } catch (e) {
      console.error('Error refreshing trade details:', e);
    }
  };

  const createOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setErrorMessage('');
    
    if (newOrder.type === 'sell') {
      try {
        const response = await fetch('/api/p2p/balance', {
          headers: { 'Authorization': `Bearer ${currentUser.id}` }
        });
        const data = await response.json();
        if (data.success && data.balance < Number(newOrder.amount)) {
          setErrorMessage('Insufficient balance to sell this amount.');
          return;
        }
      } catch (err) {
        console.error(err);
      }
    }
    
    try {
      const response = await fetch('/api/p2p/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.id}` },
        body: JSON.stringify(newOrder)
      });
      const data = await response.json();
      if (data.success) {
        setShowCreateForm(false);
        setNewOrder({ type: 'buy', coin: 'USDT', amount: '', price: '', paymentMethod: 'Bank Transfer' });
        fetchOrders();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const initiateTrade = async (order: P2POrder) => {
    if (!currentUser) {
      alert('Please log in to trade.');
      return;
    }
    setErrorMessage('');
    const amount = Number(initiateAmount) || order.amount;
    
    try {
      const response = await fetch('/api/p2p/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.id}` },
        body: JSON.stringify({ orderId: order.id, amount })
      });
      const data = await response.json();
      if (data.success) {
        setSelectedOrder(null);
        setInitiateAmount('');
        // Open the newly created trade escrow session
        await refreshCurrentTrade(data.tradeId);
        setActiveTab('my-trades');
        fetchMyTrades();
      } else {
        setErrorMessage(data.message || 'Failed to initiate trade.');
      }
    } catch (e: any) {
      setErrorMessage('Error initiating trade.');
    }
  };

  const markAsPaid = async (tradeId: string) => {
    if (!currentUser) return;
    try {
      const response = await fetch(`/api/p2p/trades/${tradeId}/mark-paid`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentUser.id}` }
      });
      const data = await response.json();
      if (data.success) {
        refreshCurrentTrade(tradeId);
        fetchMyTrades();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const releaseEscrow = async (tradeId: string) => {
    if (!currentUser) return;
    if (!confirm('Are you absolutely sure you want to release the escrowed cryptocurrency? This cannot be undone.')) return;
    try {
      const response = await fetch(`/api/p2p/trades/${tradeId}/release`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentUser.id}` }
      });
      const data = await response.json();
      if (data.success) {
        refreshCurrentTrade(tradeId);
        fetchMyTrades();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const cancelTrade = async (tradeId: string) => {
    if (!currentUser) return;
    if (!confirm('Are you sure you want to cancel this trade? Any locked cryptocurrency will be refunded to the seller.')) return;
    try {
      const response = await fetch(`/api/p2p/trades/${tradeId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentUser.id}` }
      });
      const data = await response.json();
      if (data.success) {
        refreshCurrentTrade(tradeId);
        fetchMyTrades();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const disputeTrade = async (tradeId: string) => {
    if (!currentUser) return;
    try {
      const response = await fetch(`/api/p2p/trades/${tradeId}/dispute`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentUser.id}` }
      });
      const data = await response.json();
      if (data.success) {
        refreshCurrentTrade(tradeId);
        fetchMyTrades();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !currentTrade || !chatInput.trim()) return;
    
    const text = chatInput.trim();
    setChatInput('');
    
    try {
      const response = await fetch(`/api/p2p/trades/${currentTrade.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.id}` },
        body: JSON.stringify({ text })
      });
      const data = await response.json();
      if (data.success) {
        refreshCurrentTrade(currentTrade.id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const filteredOrders = orders.filter(o => {
    const matchType = filterType === 'all' || o.type === filterType;
    return matchType;
  });

  const getChatMessages = (messagesJson: string): ChatMessage[] => {
    try {
      return JSON.parse(messagesJson || '[]');
    } catch {
      return [];
    }
  };

  return (
    <div className={`rounded-xl border ${isDark ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-gray-200 text-zinc-900'} overflow-hidden shadow-xl`}>
      
      {/* P2P Header Tabs */}
      <div className={`p-4 border-b ${isDark ? 'border-zinc-800 bg-zinc-900/40' : 'border-gray-100 bg-gray-50/50'} flex flex-col gap-3 md:flex-row md:items-center md:justify-between`}>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-indigo-500" />
          <h2 className="text-base font-bold tracking-tight">Paxful-Style P2P Escrow Marketplace</h2>
        </div>
        
        <div className="flex gap-2 bg-zinc-900/10 p-1 rounded-lg border border-zinc-500/20 max-w-xs">
          <button 
            onClick={() => { setActiveTab('market'); setCurrentTrade(null); }} 
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === 'market' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'}`}
          >
            Browse Offers
          </button>
          <button 
            onClick={() => { setActiveTab('my-trades'); }} 
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === 'my-trades' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'} flex items-center gap-1`}
          >
            My Trades
            {activeTrades.filter(t => t.status === 'open' || t.status === 'paid').length > 0 && (
              <span className="bg-amber-500 text-black text-[9px] font-bold h-4 w-4 rounded-full flex items-center justify-center">
                {activeTrades.filter(t => t.status === 'open' || t.status === 'paid').length}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'market' && (
        <>
          {/* Filters and Actions */}
          <div className="p-4 flex flex-col gap-3 border-b border-zinc-800 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-1 border-b border-zinc-800 w-fit pb-1">
              {(['all', 'buy', 'sell'] as const).map(tab => (
                <button 
                  key={tab} 
                  onClick={() => setFilterType(tab)} 
                  className={`text-xs px-4 py-1.5 font-semibold uppercase tracking-wider transition-all ${filterType === tab ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  {tab === 'all' ? 'All Offers' : tab === 'buy' ? 'Buy Crypto' : 'Sell Crypto'}
                </button>
              ))}
            </div>

            <div className="flex gap-2 items-center">
              <button 
                onClick={() => setShowCreateForm(!showCreateForm)} 
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg font-bold transition-all shadow"
              >
                {showCreateForm ? 'Cancel Creation' : 'Create Trade Offer'}
              </button>
              <button 
                onClick={() => { fetchOrders(); fetchMyTrades(); }} 
                className="p-2 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all border border-zinc-800"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* New Order Form */}
          {showCreateForm && (
            <form onSubmit={createOrder} className="p-5 border-b border-zinc-800 bg-indigo-950/25 space-y-4 transition-all">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-bold text-indigo-400">Create a New P2P Advertisement</h3>
                <p className="text-xs text-zinc-400">Post an offer with custom pricing. Selling requires sufficient crypto balance which will be held securely in escrow when a trade starts.</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-zinc-400">Offer Type</label>
                  <select 
                    value={newOrder.type} 
                    onChange={(e) => setNewOrder({...newOrder, type: e.target.value as 'buy'|'sell'})} 
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="buy">BUY CRYPTO (You buy from users)</option>
                    <option value="sell">SELL CRYPTO (You sell to users)</option>
                  </select>
                </div>
                
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-zinc-400">Crypto Coin</label>
                  <select 
                    value={newOrder.coin} 
                    onChange={(e) => setNewOrder({...newOrder, coin: e.target.value})} 
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="USDT">USDT</option>
                    <option value="BTC">BTC</option>
                    <option value="ETH">ETH</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-zinc-400">Total Amount</label>
                  <input 
                    type="number" 
                    required 
                    placeholder="e.g. 500" 
                    value={newOrder.amount} 
                    onChange={(e) => setNewOrder({...newOrder, amount: e.target.value})} 
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white focus:border-indigo-500 focus:outline-none" 
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-zinc-400">Price (USD)</label>
                  <input 
                    type="number" 
                    required 
                    placeholder="e.g. 1.00" 
                    value={newOrder.price} 
                    onChange={(e) => setNewOrder({...newOrder, price: e.target.value})} 
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white focus:border-indigo-500 focus:outline-none" 
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-zinc-400">Payment Method</label>
                  <select 
                    value={newOrder.paymentMethod} 
                    onChange={(e) => setNewOrder({...newOrder, paymentMethod: e.target.value})} 
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  >
                    <option>Bank Transfer</option>
                    <option>Wise</option>
                    <option>Revolut</option>
                    <option>PayPal</option>
                    <option>Cash App</option>
                  </select>
                </div>
              </div>

              {errorMessage && (
                <div className="p-3 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {errorMessage}
                </div>
              )}

              <div className="flex justify-end">
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-xs font-bold shadow-md transition-all">
                  Post Offer to Market
                </button>
              </div>
            </form>
          )}

          {/* Offers Table */}
          <div className="overflow-x-auto">
            {filteredOrders.length === 0 ? (
              <div className="p-12 text-center text-zinc-500 space-y-2">
                <Coins className="h-10 w-10 text-zinc-600 mx-auto" />
                <p className="text-sm">No active advertisements currently match your selection.</p>
                <p className="text-xs text-zinc-600">Be the first to post an advertisement!</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs min-w-[600px]">
                <thead className={`border-b ${isDark ? 'border-zinc-800 bg-zinc-900/30' : 'border-gray-100 bg-gray-50'}`}>
                  <tr className="text-zinc-400 font-semibold">
                    <th className="p-4">Merchant / Advertiser</th>
                    <th className="p-4">Type</th>
                    <th className="p-4">Crypto Available</th>
                    <th className="p-4">Price per Unit</th>
                    <th className="p-4">Payment Method</th>
                    <th className="p-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filteredOrders.map(order => {
                    const isMyOrder = currentUser?.id === order.user_id;
                    return (
                      <tr key={order.id} className={`${isDark ? 'hover:bg-zinc-900/40' : 'hover:bg-gray-50/50'} transition-colors`}>
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-zinc-200">
                              {isMyOrder ? 'You (My Offer)' : `User_${order.user_id.slice(0, 5)}`}
                            </span>
                            <span className="text-[10px] text-zinc-400">Trust Score: 99% • 180+ Trades</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${order.type === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                            {order.type === 'buy' ? 'Wants to Buy' : 'Wants to Sell'}
                          </span>
                        </td>
                        <td className="p-4 text-zinc-300 font-medium">
                          {order.amount} {order.coin}
                        </td>
                        <td className="p-4 font-extrabold text-indigo-400 text-sm">
                          ${order.price.toFixed(2)} USD
                        </td>
                        <td className="p-4">
                          <span className="px-2 py-1 bg-zinc-800/80 rounded-lg text-zinc-300 text-[11px] font-medium border border-zinc-700/50">
                            {order.paymentMethod}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          {isMyOrder ? (
                            <span className="text-xs text-zinc-500 font-medium italic">Active ad posted by you</span>
                          ) : (
                            <button 
                              onClick={() => { setSelectedOrder(order); setInitiateAmount(order.amount.toString()); }} 
                              className={`px-4 py-2 rounded-lg font-bold text-xs shadow transition-all ${
                                order.type === 'buy' 
                                  ? 'bg-rose-600 hover:bg-rose-700 text-white' 
                                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              }`}
                            >
                              {order.type === 'buy' ? 'Sell Crypto' : 'Buy Crypto'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Trade Initiation Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={() => setSelectedOrder(null)}>
          <div className={`w-full max-w-md p-6 rounded-2xl border ${isDark ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-zinc-200 text-zinc-900'}`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-bold text-lg">Start Escrow Trade</h3>
                <p className="text-xs text-zinc-400">Trade with User_{selectedOrder.user_id.slice(0, 5)}</p>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="bg-indigo-950/20 border border-indigo-500/20 p-4 rounded-xl mb-4 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Payment Method:</span>
                <span className="font-bold text-indigo-400">{selectedOrder.paymentMethod}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Price per unit:</span>
                <span className="font-bold">${selectedOrder.price.toFixed(2)} USD</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Available amount:</span>
                <span className="font-bold text-zinc-300">{selectedOrder.amount} {selectedOrder.coin}</span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-zinc-400">Amount to Trade ({selectedOrder.coin})</label>
                <div className="relative">
                  <input 
                    type="number" 
                    value={initiateAmount}
                    onChange={(e) => setInitiateAmount(e.target.value)}
                    max={selectedOrder.amount}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-zinc-500 font-bold">{selectedOrder.coin}</span>
                </div>
              </div>

              <div className="flex justify-between items-center p-3 bg-zinc-950/40 rounded-xl border border-zinc-800/80 text-xs">
                <span className="text-zinc-400">Total USD you pay/receive:</span>
                <span className="font-extrabold text-sm text-indigo-400">
                  ${(Number(initiateAmount) * selectedOrder.price).toFixed(2)} USD
                </span>
              </div>

              {errorMessage && (
                <div className="p-3 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {errorMessage}
                </div>
              )}

              <button 
                onClick={() => initiateTrade(selectedOrder)}
                className={`w-full py-3 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow ${
                  selectedOrder.type === 'buy' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                } text-white`}
              >
                <ShieldCheck className="h-4 w-4" />
                Initiate Escrow Trade
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Trades Tab */}
      {activeTab === 'my-trades' && !currentTrade && (
        <div className="p-4 space-y-4">
          <h3 className="text-sm font-bold text-zinc-400">Active Trade Sessions</h3>
          {activeTrades.length === 0 ? (
            <div className="p-12 text-center text-zinc-500 space-y-2">
              <MessageSquare className="h-10 w-10 text-zinc-600 mx-auto" />
              <p className="text-sm">You do not have any active trades currently.</p>
              <p className="text-xs text-zinc-600">Select an offer from the market to start a trade session.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeTrades.map(trade => {
                const isBuyer = trade.buyer_id === currentUser?.id;
                const otherParty = isBuyer ? 'Seller' : 'Buyer';
                return (
                  <div 
                    key={trade.id} 
                    onClick={() => refreshCurrentTrade(trade.id)}
                    className={`p-4 rounded-xl border ${isDark ? 'bg-zinc-900 hover:bg-zinc-900/80 border-zinc-800' : 'bg-white hover:bg-gray-50 border-gray-200'} cursor-pointer transition-all hover:scale-[1.01]`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2.5 w-2.5 rounded-full ${
                          trade.status === 'open' ? 'bg-amber-500' :
                          trade.status === 'paid' ? 'bg-indigo-500' :
                          trade.status === 'completed' ? 'bg-emerald-500' : 'bg-zinc-500'
                        }`} />
                        <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                          Trade #{trade.id.slice(0, 8)}
                        </span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${
                        trade.status === 'open' ? 'bg-amber-500/10 text-amber-500' :
                        trade.status === 'paid' ? 'bg-indigo-500/10 text-indigo-400' :
                        trade.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {trade.status}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">My Role:</span>
                        <span className="font-bold text-indigo-400">{isBuyer ? 'Buyer' : 'Seller (Escrow)'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Asset:</span>
                        <span className="font-semibold text-zinc-200">{trade.amount} {trade.coin}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Fiat Amount:</span>
                        <span className="font-bold text-emerald-400">${(trade.amount * trade.price).toFixed(2)} USD</span>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-zinc-800/60 flex justify-end text-xs font-semibold text-indigo-400 items-center gap-1">
                      Enter Escrow Dashboard
                      <ChevronRight className="h-4 w-4" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Paxful Escrow Trade Dashboard View */}
      {activeTab === 'my-trades' && currentTrade && (
        <div className="flex flex-col lg:flex-row border-t border-zinc-800 min-h-[500px]">
          
          {/* Left Panel: Escrow Instructions, Timer, Status, Actions */}
          <div className="w-full lg:w-1/2 p-6 border-b lg:border-b-0 lg:border-r border-zinc-800 space-y-6">
            <button 
              onClick={() => { setCurrentTrade(null); fetchMyTrades(); }} 
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 font-semibold"
            >
              <ArrowRight className="h-4 w-4 rotate-180" />
              Back to Active Trades List
            </button>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-white flex items-center gap-1.5">
                  <ShieldCheck className="h-5 w-5 text-emerald-500" />
                  Live Trade Escrow
                </h3>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                  currentTrade.status === 'open' ? 'bg-amber-500/20 text-amber-500' :
                  currentTrade.status === 'paid' ? 'bg-indigo-500/20 text-indigo-400' :
                  currentTrade.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                }`}>
                  {currentTrade.status}
                </span>
              </div>
              <p className="text-xs text-zinc-400">Trade ID: <span className="font-mono text-zinc-300">{currentTrade.id}</span></p>
            </div>

            {/* Escrow Details */}
            <div className="grid grid-cols-2 gap-3 p-4 bg-zinc-900/60 rounded-xl border border-zinc-800">
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Cryptocurrency</p>
                <p className="text-sm font-bold text-zinc-200">{currentTrade.amount} {currentTrade.coin}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Fiat Amount</p>
                <p className="text-sm font-bold text-emerald-400">${(currentTrade.amount * currentTrade.price).toFixed(2)} USD</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Buyer Account</p>
                <p className="text-xs font-medium text-zinc-400 truncate">{currentTradeBuyerEmail || 'Loading...'}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Seller Account</p>
                <p className="text-xs font-medium text-zinc-400 truncate">{currentTradeSellerEmail || 'Loading...'}</p>
              </div>
            </div>

            {/* State-specific Instructions */}
            <div className="p-4 bg-indigo-950/20 rounded-xl border border-indigo-500/20 space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-500" />
                <div>
                  <h4 className="text-xs font-bold text-white">Escrow Cancellation Timer</h4>
                  <p className="text-[11px] text-zinc-400">Trade auto-cancels and refunds to seller if not paid within limit.</p>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-zinc-400 font-medium">Time Remaining:</span>
                <span className={`text-sm font-black tracking-widest ${timeLeft === 'Expired' ? 'text-rose-500' : 'text-amber-400'}`}>
                  {timeLeft}
                </span>
              </div>
            </div>

            {/* Actions Panel */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Escrow Controls</h4>
              
              {currentUser?.id === currentTrade.buyer_id ? (
                // Buyer Controls
                <div className="space-y-3">
                  {currentTrade.status === 'open' && (
                    <button 
                      onClick={() => markAsPaid(currentTrade.id)}
                      className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow"
                    >
                      <CheckCircle className="h-4.5 w-4.5" />
                      I have paid [Seller] (Mark as Paid)
                    </button>
                  )}
                  {currentTrade.status === 'open' && (
                    <button 
                      onClick={() => cancelTrade(currentTrade.id)}
                      className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-rose-400 hover:text-rose-300 rounded-lg text-xs font-bold transition-all border border-zinc-700"
                    >
                      Cancel Escrow Trade
                    </button>
                  )}
                  {currentTrade.status === 'paid' && (
                    <div className="space-y-2">
                      <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-[11px] text-indigo-400 flex items-center gap-1.5">
                        <Clock className="h-4 w-4" />
                        Waiting for seller to release crypto...
                      </div>
                      <button 
                        onClick={() => disputeTrade(currentTrade.id)}
                        className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-amber-500 rounded-lg text-xs font-bold transition-all border border-zinc-700"
                      >
                        Initiate Trade Dispute
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                // Seller Controls
                <div className="space-y-3">
                  {(currentTrade.status === 'open' || currentTrade.status === 'paid') && (
                    <button 
                      onClick={() => releaseEscrow(currentTrade.id)}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow"
                    >
                      <ShieldCheck className="h-4.5 w-4.5" />
                      Verify Payment & Release Cryptocurrency
                    </button>
                  )}
                  {currentTrade.status === 'open' && (
                    <button 
                      onClick={() => cancelTrade(currentTrade.id)}
                      className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-rose-400 hover:text-rose-300 rounded-lg text-xs font-bold transition-all border border-zinc-700"
                    >
                      Cancel Trade & Refund Escrow
                    </button>
                  )}
                  {currentTrade.status === 'paid' && (
                    <button 
                      onClick={() => disputeTrade(currentTrade.id)}
                      className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-amber-500 rounded-lg text-xs font-bold transition-all border border-zinc-700"
                    >
                      Initiate Trade Dispute
                    </button>
                  )}
                </div>
              )}

              {currentTrade.status === 'completed' && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  <div>
                    <h5 className="font-bold">Trade Successfully Completed</h5>
                    <p className="text-[11px] text-emerald-500/80">The held crypto has been released to the buyer's active balance.</p>
                  </div>
                </div>
              )}

              {currentTrade.status === 'cancelled' && (
                <div className="p-4 bg-zinc-800/60 border border-zinc-700/50 text-zinc-400 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  <div>
                    <h5 className="font-bold">Trade Cancelled</h5>
                    <p className="text-[11px] text-zinc-500">Any locked escrow assets have been fully returned to the seller.</p>
                  </div>
                </div>
              )}

              {currentTrade.status === 'disputed' && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-xl text-xs flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5" />
                  <div>
                    <h5 className="font-bold">Dispute Opened</h5>
                    <p className="text-[11px] text-amber-500/80">Support will review chat and verify transaction proofs. Keep details ready.</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Live Chat Messages and Send Form */}
          <div className="w-full lg:w-1/2 flex flex-col min-h-[400px]">
            <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/20">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4 text-indigo-500" />
                Escrow Live Chat
              </span>
              <button 
                onClick={() => refreshCurrentTrade(currentTrade.id)}
                className="p-1 rounded bg-zinc-800/80 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all text-[11px] flex items-center gap-1 font-semibold"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh Chat
              </button>
            </div>

            {/* Chat History */}
            <div className="flex-1 p-4 overflow-y-auto max-h-[350px] space-y-3 bg-zinc-900/15">
              {getChatMessages(currentTrade.chat_messages).map((m) => {
                const isSystem = m.sender === 'system';
                const isMe = m.sender === currentUser?.id;
                
                if (isSystem) {
                  return (
                    <div key={m.id} className="p-3 bg-indigo-950/40 border border-indigo-500/10 rounded-xl text-[11px] text-indigo-300 text-center flex flex-col gap-1 mx-4">
                      <ShieldCheck className="h-4.5 w-4.5 text-indigo-400 mx-auto" />
                      <span>{m.text}</span>
                    </div>
                  );
                }

                return (
                  <div key={m.id} className={`flex flex-col max-w-[80%] ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                    <span className="text-[9px] text-zinc-500 font-bold mb-0.5">
                      {isMe ? 'You' : m.senderEmail || 'Trader'}
                    </span>
                    <div className={`p-3 rounded-2xl text-xs ${
                      isMe 
                        ? 'bg-indigo-600 text-white rounded-tr-none' 
                        : (isDark ? 'bg-zinc-800 text-zinc-200 rounded-tl-none' : 'bg-gray-100 text-zinc-800 rounded-tl-none')
                    }`}>
                      {m.text}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Send Input Form */}
            {currentTrade.status !== 'completed' && currentTrade.status !== 'cancelled' && (
              <form onSubmit={sendChatMessage} className="p-3 border-t border-zinc-800 flex gap-2 bg-zinc-950/60">
                <input 
                  type="text"
                  placeholder="Share details, questions, or payment confirmations..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                />
                <button type="submit" className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all">
                  <Send className="h-4 w-4" />
                </button>
              </form>
            )}
          </div>

        </div>
      )}

    </div>
  );
}
