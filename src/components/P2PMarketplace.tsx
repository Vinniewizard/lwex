import React, { useState, useEffect, useRef } from 'react';
import { 
  RefreshCw, ShieldCheck, DollarSign, Coins, MessageSquare, 
  Clock, ArrowRight, ChevronRight, AlertCircle, X, Send, CheckCircle, 
  ShieldAlert, UserCheck, Award, Zap, BookOpen, Star, Filter, Info, ChevronDown, Check
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
  required_kyc: number;
  required_min_trades: number;
  terms: string;
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

interface UserInfo {
  balance: number;
  verificationStatus: 'verified' | 'unverified';
  completedTrades: number;
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
  
  // User profile details
  const [userInfo, setUserInfo] = useState<UserInfo>({
    balance: 0,
    verificationStatus: 'unverified',
    completedTrades: 0
  });

  // Flat tab state: 'browse-buy' | 'browse-sell' | 'my-escrows'
  const [activeView, setActiveView] = useState<'browse-buy' | 'browse-sell' | 'my-escrows'>('browse-buy');
  
  // Professional filters
  const [selectedCoin, setSelectedCoin] = useState<string>('all');
  const [selectedPayment, setSelectedPayment] = useState<string>('all');
  const [filterEligibleOnly, setFilterEligibleOnly] = useState<boolean>(false);
  const [minAmountFilter, setMinAmountFilter] = useState<string>('');

  const [showCreateForm, setShowCreateForm] = useState(false);
  
  // Offer creation form
  const [newOrder, setNewOrder] = useState({ 
    type: 'buy', 
    coin: 'USDT', 
    amount: '', 
    price: '', 
    paymentMethod: 'Bank Transfer',
    required_kyc: false,
    required_min_trades: '0',
    terms: ''
  });

  const [selectedOrder, setSelectedOrder] = useState<P2POrder | null>(null);
  const [initiateAmount, setInitiateAmount] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [tradeTermsAccepted, setTradeTermsAccepted] = useState(false);
  
  const [timeLeft, setTimeLeft] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchOrders();
    if (currentUser) {
      fetchMyTrades();
      fetchUserInfo();
    }
  }, [currentUser]);

  // Autorefresh live trade chat
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (currentTrade) {
      interval = setInterval(() => {
        refreshCurrentTrade(currentTrade.id);
      }, 3500);
    }
    return () => clearInterval(interval);
  }, [currentTrade?.id]);

  // Automatic scroll on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentTrade?.chat_messages]);

  // Countdown timer calculation
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
      console.error('Error fetching P2P ads:', e);
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
      console.error('Error fetching trades list:', e);
    }
  };

  const fetchUserInfo = async () => {
    if (!currentUser) return;
    try {
      const response = await fetch('/api/p2p/user-info', {
        headers: { 'Authorization': `Bearer ${currentUser.id}` }
      });
      const data = await response.json();
      if (data.success) {
        setUserInfo({
          balance: data.balance,
          verificationStatus: data.verificationStatus || 'unverified',
          completedTrades: data.completedTrades || 0
        });
      }
    } catch (e) {
      console.error('Error loading P2P portfolio information:', e);
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
      console.error('Error loading active trade contract details:', e);
    }
  };

  const createOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setErrorMessage('');
    
    if (newOrder.type === 'sell') {
      if (userInfo.balance < Number(newOrder.amount)) {
        setErrorMessage(`Insufficient crypto balance. You cannot list ${newOrder.amount} for sale because your wallet currently only has ${userInfo.balance.toFixed(4)}.`);
        return;
      }
    }
    
    try {
      const response = await fetch('/api/p2p/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.id}` },
        body: JSON.stringify({
          ...newOrder,
          required_min_trades: Number(newOrder.required_min_trades) || 0
        })
      });
      const data = await response.json();
      if (data.success) {
        setShowCreateForm(false);
        setNewOrder({ 
          type: 'buy', 
          coin: 'USDT', 
          amount: '', 
          price: '', 
          paymentMethod: 'Bank Transfer',
          required_kyc: false,
          required_min_trades: '0',
          terms: ''
        });
        fetchOrders();
        fetchUserInfo();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const initiateTrade = async (order: P2POrder) => {
    if (!currentUser) {
      alert('Please sign in or register to begin P2P trading.');
      return;
    }
    if (!tradeTermsAccepted && order.terms) {
      setErrorMessage("Please read and check the box to accept the counterparty's trade conditions.");
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
        setTradeTermsAccepted(false);
        await refreshCurrentTrade(data.tradeId);
        setActiveView('my-escrows');
        fetchMyTrades();
        fetchUserInfo();
      } else {
        setErrorMessage(data.message || 'Error occurred during trade initialization.');
      }
    } catch (e: any) {
      setErrorMessage('Communication error with the secure escrow servers.');
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
    if (!confirm('CONFIRMATION: Are you sure you wish to release the escrow funds? Once released, this action is irreversible and the crypto is immediately sent to the buyer.')) return;
    try {
      const response = await fetch(`/api/p2p/trades/${tradeId}/release`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentUser.id}` }
      });
      const data = await response.json();
      if (data.success) {
        refreshCurrentTrade(tradeId);
        fetchMyTrades();
        fetchUserInfo();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const cancelTrade = async (tradeId: string) => {
    if (!currentUser) return;
    if (!confirm('Are you sure you want to cancel this contract? The held escrow balance will be returned back to the seller.')) return;
    try {
      const response = await fetch(`/api/p2p/trades/${tradeId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentUser.id}` }
      });
      const data = await response.json();
      if (data.success) {
        refreshCurrentTrade(tradeId);
        fetchMyTrades();
        fetchUserInfo();
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

  const checkUserEligibility = (order: P2POrder): { eligible: boolean; reasons: string[] } => {
    const reasons: string[] = [];
    if (!currentUser) {
      return { eligible: false, reasons: ['Please log in to trade.'] };
    }
    if (order.user_id === currentUser.id) {
      return { eligible: false, reasons: ['Your own listed ad.'] };
    }
    if (order.required_kyc === 1 && userInfo.verificationStatus !== 'verified') {
      reasons.push('Requires identity verification (KYC).');
    }
    if (order.required_min_trades > 0 && userInfo.completedTrades < order.required_min_trades) {
      reasons.push(`Requires at least ${order.required_min_trades} completed P2P trades.`);
    }
    if (order.type === 'buy') {
      if (userInfo.balance < order.amount) {
        reasons.push(`You need at least ${order.amount} ${order.coin} in your balance to fulfill this buy ad.`);
      }
    }
    return {
      eligible: reasons.length === 0,
      reasons
    };
  };

  const filteredOrders = orders.filter(o => {
    // Separate by views
    if (activeView === 'browse-buy' && o.type !== 'sell') return false; // Seller wants to sell, so we buy
    if (activeView === 'browse-sell' && o.type !== 'buy') return false; // Buyer wants to buy, so we sell

    if (selectedCoin !== 'all' && o.coin !== selectedCoin) return false;
    if (selectedPayment !== 'all' && o.paymentMethod !== selectedPayment) return false;
    if (minAmountFilter && o.amount < Number(minAmountFilter)) return false;

    if (filterEligibleOnly) {
      const { eligible } = checkUserEligibility(o);
      if (!eligible) return false;
    }
    return true;
  });

  const getChatMessages = (messagesJson: string): ChatMessage[] => {
    try {
      return JSON.parse(messagesJson || '[]');
    } catch {
      return [];
    }
  };

  return (
    <div className={`rounded-xl border ${isDark ? 'bg-zinc-950 border-zinc-900 text-white shadow-2xl' : 'bg-white border-gray-200 text-zinc-900 shadow-xl'} overflow-hidden`}>
      
      {/* 1. Header Banner & Dynamic stats */}
      <div className={`p-6 border-b ${isDark ? 'border-zinc-900 bg-zinc-900/30' : 'border-gray-100 bg-gray-50/50'} flex flex-col md:flex-row md:items-center justify-between gap-4`}>
        <div className="space-y-1">
          <h1 className="text-xl font-black tracking-tight flex items-center gap-2">
            P2P Escrow Trading Desk
            <span className="text-[10px] bg-indigo-500/10 text-indigo-400 font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider border border-indigo-500/20">
              Paxful Protected
            </span>
          </h1>
          <p className="text-xs text-zinc-400 font-medium">Deals with 0% commissions. Your locked assets are held inside automated safe escrow storage.</p>
        </div>

        <div className="flex gap-2 bg-zinc-900/10 p-1.5 rounded-xl border border-zinc-850 max-w-sm">
          {(['browse-buy', 'browse-sell', 'my-escrows'] as const).map(tab => (
            <button 
              key={tab}
              onClick={() => { setActiveView(tab); setCurrentTrade(null); }}
              className={`text-xs px-3.5 py-2 rounded-lg font-bold transition-all whitespace-nowrap ${activeView === tab ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'}`}
            >
              {tab === 'browse-buy' ? 'Buy Crypto' : tab === 'browse-sell' ? 'Sell Crypto' : 'My Trades'}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Top Banner Statistics Bar */}
      <div className={`grid grid-cols-2 md:grid-cols-4 border-b ${isDark ? 'border-zinc-900 bg-zinc-950/30' : 'border-gray-50 bg-gray-50/30'} divide-x ${isDark ? 'divide-zinc-900' : 'divide-gray-100'} text-xs font-semibold text-zinc-400`}>
        <div className="p-4 flex items-center gap-3">
          <Zap className="h-5 w-5 text-indigo-400 shrink-0" />
          <div>
            <p className="text-[10px] text-zinc-500 font-bold uppercase">Avg Speed</p>
            <p className="text-zinc-200 font-extrabold">&lt;3 Minutes</p>
          </div>
        </div>
        <div className="p-4 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
          <div>
            <p className="text-[10px] text-zinc-500 font-bold uppercase">Escrow Safety</p>
            <p className="text-emerald-400 font-extrabold">100% Protected</p>
          </div>
        </div>
        <div className="p-4 flex items-center gap-3">
          <Coins className="h-5 w-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-[10px] text-zinc-500 font-bold uppercase">Marketplace Volume</p>
            <p className="text-zinc-200 font-extrabold">$24,910 USD</p>
          </div>
        </div>
        <div className="p-4 flex items-center gap-3">
          <UserCheck className="h-5 w-5 text-indigo-400 shrink-0" />
          <div>
            <p className="text-[10px] text-zinc-500 font-bold uppercase">Online Operators</p>
            <p className="text-zinc-200 font-extrabold">98 Verified</p>
          </div>
        </div>
      </div>

      {/* 3. Main Dashboard Layout (Split Column Arrangement) */}
      <div className="flex flex-col lg:flex-row">
        
        {/* Left Action Column (75% screen width) */}
        <div className="w-full lg:w-3/4 p-6 border-b lg:border-b-0 lg:border-r border-zinc-900 space-y-6">
          
          {/* Active Contract / Chat Session Screen */}
          {activeView === 'my-escrows' && currentTrade ? (
            <div className="space-y-6">
              <button 
                onClick={() => { setCurrentTrade(null); fetchMyTrades(); }}
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 font-semibold bg-zinc-900/60 border border-zinc-800 px-3 py-1.5 rounded-lg w-fit"
              >
                <ArrowRight className="h-4 w-4 rotate-180" />
                Back to Contracts List
              </button>

              {/* Sub-split: Left Side Contract details, Right Side chat */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                
                {/* Contract Status Details (5 columns) */}
                <div className="md:col-span-5 space-y-5">
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <h3 className="font-extrabold text-base text-zinc-200">Contract Desk</h3>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        currentTrade.status === 'open' ? 'bg-amber-500/10 text-amber-500' :
                        currentTrade.status === 'paid' ? 'bg-indigo-500/10 text-indigo-400' :
                        currentTrade.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {currentTrade.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-500 font-mono select-all truncate">HASH: {currentTrade.id}</p>
                  </div>

                  {orders.find(o => o.id === currentTrade.order_id)?.terms && (
                    <div className="p-3 bg-indigo-950/20 border border-indigo-500/15 rounded-xl space-y-1.5">
                      <span className="text-[10px] uppercase font-black text-indigo-400 flex items-center gap-1">
                        <BookOpen className="h-3 w-3" />
                        Seller's Trade Terms
                      </span>
                      <p className="text-xs text-zinc-300 italic leading-relaxed select-all">
                        "{orders.find(o => o.id === currentTrade.order_id)?.terms}"
                      </p>
                    </div>
                  )}

                  <div className="space-y-2.5 p-4 bg-zinc-900/60 rounded-xl border border-zinc-850 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Asset to Transact:</span>
                      <span className="font-bold text-zinc-200">{currentTrade.amount} {currentTrade.coin}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Fiat Value:</span>
                      <span className="font-black text-emerald-400">${(currentTrade.amount * currentTrade.price).toFixed(2)} USD</span>
                    </div>
                    <div className="flex justify-between border-t border-zinc-800/40 pt-2.5">
                      <span className="text-zinc-500">Buyer Email:</span>
                      <span className="font-semibold text-zinc-300 truncate max-w-[120px]">{currentTradeBuyerEmail || 'Trader'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Seller Email:</span>
                      <span className="font-semibold text-zinc-300 truncate max-w-[120px]">{currentTradeSellerEmail || 'Trader'}</span>
                    </div>
                  </div>

                  {currentTrade.status === 'open' && (
                    <div className="p-3 bg-amber-500/5 rounded-xl border border-amber-500/10 flex items-center justify-between text-xs">
                      <span className="text-zinc-400 font-medium">Payment Deadline:</span>
                      <span className="font-mono font-black text-amber-400 tracking-wider bg-zinc-950 px-2.5 py-1 rounded">
                        {timeLeft}
                      </span>
                    </div>
                  )}

                  {/* Actions Area */}
                  <div className="space-y-2 pt-1">
                    {currentUser?.id === currentTrade.buyer_id ? (
                      // Buyer Actions
                      <>
                        {currentTrade.status === 'open' && (
                          <button 
                            onClick={() => markAsPaid(currentTrade.id)}
                            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow transition-all hover:scale-[1.01]"
                          >
                            <CheckCircle className="h-4.5 w-4.5" />
                            I Have Made Payment
                          </button>
                        )}
                        {currentTrade.status === 'open' && (
                          <button 
                            onClick={() => cancelTrade(currentTrade.id)}
                            className="w-full py-2 bg-zinc-900 hover:bg-zinc-850 text-rose-400 rounded-xl text-xs font-bold transition-all border border-zinc-800"
                          >
                            Cancel and Refund
                          </button>
                        )}
                        {currentTrade.status === 'paid' && (
                          <div className="space-y-2">
                            <div className="p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl text-xs text-indigo-400 text-center animate-pulse">
                              Awaiting seller confirmation...
                            </div>
                            <button 
                              onClick={() => disputeTrade(currentTrade.id)}
                              className="w-full py-2 bg-zinc-900 hover:bg-zinc-850 text-amber-500 rounded-xl text-xs font-bold transition-all border border-zinc-800"
                            >
                              Raise Dispute
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      // Seller Actions
                      <>
                        {(currentTrade.status === 'open' || currentTrade.status === 'paid') && (
                          <button 
                            onClick={() => releaseEscrow(currentTrade.id)}
                            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow transition-all hover:scale-[1.01]"
                          >
                            <ShieldCheck className="h-4.5 w-4.5" />
                            Release Escrow Asset
                          </button>
                        )}
                        {currentTrade.status === 'open' && (
                          <button 
                            onClick={() => cancelTrade(currentTrade.id)}
                            className="w-full py-2 bg-zinc-900 hover:bg-zinc-850 text-rose-400 rounded-xl text-xs font-bold border border-zinc-800"
                          >
                            Abort Escrow Contract
                          </button>
                        )}
                        {currentTrade.status === 'paid' && (
                          <button 
                            onClick={() => disputeTrade(currentTrade.id)}
                            className="w-full py-2 bg-zinc-900 hover:bg-zinc-850 text-amber-500 rounded-xl text-xs font-bold border border-zinc-800"
                          >
                            Raise Dispute
                          </button>
                        )}
                      </>
                    )}

                    {currentTrade.status === 'completed' && (
                      <div className="p-3 bg-emerald-500/10 text-emerald-400 text-xs text-center font-bold rounded-xl border border-emerald-500/20">
                        ✓ Trade completed successfully.
                      </div>
                    )}
                    {currentTrade.status === 'cancelled' && (
                      <div className="p-3 bg-zinc-900 text-zinc-400 text-xs text-center font-bold rounded-xl border border-zinc-800">
                        ✕ Trade cancelled. Escrow returned.
                      </div>
                    )}
                    {currentTrade.status === 'disputed' && (
                      <div className="p-3 bg-amber-500/10 text-amber-500 text-xs text-center font-bold rounded-xl border border-amber-500/20">
                        ⚠ Dispute opened. Admin is reviewing logs.
                      </div>
                    )}
                  </div>
                </div>

                {/* Live Chat Component (7 columns) */}
                <div className="md:col-span-7 flex flex-col border border-zinc-900 bg-zinc-900/10 rounded-2xl overflow-hidden min-h-[380px]">
                  <div className="p-3 bg-zinc-900/40 border-b border-zinc-900 flex justify-between items-center text-xs">
                    <span className="font-extrabold text-zinc-300">Live Escrow Chat Console</span>
                    <button 
                      onClick={() => refreshCurrentTrade(currentTrade.id)}
                      className="p-1 text-zinc-400 hover:text-white"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex-1 p-4 overflow-y-auto max-h-[280px] space-y-3">
                    {getChatMessages(currentTrade.chat_messages).map((m) => {
                      const isSystem = m.sender === 'system';
                      const isMe = m.sender === currentUser?.id;

                      if (isSystem) {
                        return (
                          <div key={m.id} className="p-2.5 bg-indigo-950/25 text-[11px] text-indigo-400 border border-indigo-500/10 text-center rounded-xl mx-4">
                            {m.text}
                          </div>
                        );
                      }

                      return (
                        <div key={m.id} className={`flex flex-col max-w-[85%] ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                          <span className="text-[9px] text-zinc-500 font-bold mb-0.5">{isMe ? 'You' : m.senderEmail || 'Trader'}</span>
                          <div className={`p-2.5 rounded-2xl text-xs leading-relaxed ${isMe ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-zinc-850 text-zinc-200 rounded-tl-none'}`}>
                            {m.text}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>

                  {currentTrade.status !== 'completed' && currentTrade.status !== 'cancelled' && (
                    <form onSubmit={sendChatMessage} className="p-3 border-t border-zinc-900 bg-zinc-950/40 flex gap-2">
                      <input 
                        type="text"
                        placeholder="Type standard response..."
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                      <button type="submit" className="p-2.5 bg-indigo-600 text-white rounded-xl">
                        <Send className="h-4 w-4" />
                      </button>
                    </form>
                  )}
                </div>

              </div>
            </div>
          ) : activeView === 'my-escrows' ? (
            // Active Escrows List
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-extrabold text-sm text-zinc-300">Active trade contracts under escrow protection</h3>
                <span className="text-xs text-zinc-500">Auto-refresh active every 3s</span>
              </div>

              {activeTrades.length === 0 ? (
                <div className="p-16 text-center text-zinc-500 border border-zinc-900 rounded-2xl bg-zinc-900/10 space-y-2">
                  <MessageSquare className="h-10 w-10 text-zinc-600 mx-auto" />
                  <p className="text-sm font-bold">No ongoing P2P contracts found.</p>
                  <p className="text-xs text-zinc-600">Browse the Buy/Sell offers in the main menu to initiate.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeTrades.map(trade => {
                    const isBuyer = trade.buyer_id === currentUser?.id;
                    return (
                      <div 
                        key={trade.id}
                        onClick={() => refreshCurrentTrade(trade.id)}
                        className={`p-4 rounded-xl border border-zinc-900 bg-zinc-950/40 hover:bg-zinc-900/50 cursor-pointer transition-all hover:scale-[1.01]`}
                      >
                        <div className="flex justify-between items-center mb-2.5">
                          <span className="text-xs font-black text-zinc-200">Contract #{trade.id.slice(0, 8)}</span>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wide ${
                            trade.status === 'open' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' :
                            trade.status === 'paid' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' :
                            trade.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-400'
                          }`}>
                            {trade.status}
                          </span>
                        </div>

                        <div className="space-y-1 text-xs border-t border-b border-zinc-900/40 py-2.5 my-2">
                          <div className="flex justify-between">
                            <span className="text-zinc-500">Trading Asset:</span>
                            <span className="font-bold text-zinc-300">{trade.amount} {trade.coin}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-zinc-500">Fiat Value:</span>
                            <span className="font-extrabold text-emerald-400">${(trade.amount * trade.price).toFixed(2)} USD</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-zinc-500">My Position:</span>
                            <span className="font-bold text-indigo-400">{isBuyer ? 'Buyer (Paying)' : 'Seller (Escrow Held)'}</span>
                          </div>
                        </div>

                        <div className="flex justify-end text-xs font-semibold text-indigo-400 items-center gap-0.5 pt-1">
                          Open Escrow Panel
                          <ChevronRight className="h-4 w-4" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            // Browse Menu Offers List
            <div className="space-y-5">
              
              {/* Searching, filter panel inside content area */}
              <div className="p-4 bg-zinc-900/10 border border-zinc-900 rounded-2xl flex flex-wrap gap-4 items-center justify-between">
                <div className="flex flex-wrap gap-2">
                  <select 
                    value={selectedCoin} 
                    onChange={(e) => setSelectedCoin(e.target.value)}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="all">All Cryptocurrencies</option>
                    <option value="USDT">USDT Tether</option>
                    <option value="BTC">BTC Bitcoin</option>
                    <option value="ETH">ETH Ethereum</option>
                  </select>

                  <select 
                    value={selectedPayment} 
                    onChange={(e) => setSelectedPayment(e.target.value)}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="all">All Payment Methods</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Wise">Wise</option>
                    <option value="Revolut">Revolut</option>
                    <option value="PayPal">PayPal</option>
                    <option value="Cash App">Cash App</option>
                  </select>

                  <input 
                    type="number"
                    placeholder="Min amount filter"
                    value={minAmountFilter}
                    onChange={(e) => setMinAmountFilter(e.target.value)}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white w-32 placeholder-zinc-500"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={filterEligibleOnly} 
                    onChange={(e) => setFilterEligibleOnly(e.target.checked)}
                    className="rounded bg-zinc-900 border-zinc-800 text-indigo-600"
                  />
                  Eligible Offers Only
                </label>
              </div>

              {/* Offers listings container */}
              <div className="border border-zinc-900 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-xs min-w-[650px]">
                  <thead className={`border-b ${isDark ? 'border-zinc-900 bg-zinc-900/40' : 'border-gray-100 bg-gray-50/50'} text-zinc-400 uppercase tracking-wider text-[9px] font-extrabold`}>
                    <tr>
                      <th className="p-4">Merchants</th>
                      <th className="p-4">Exchange Rate</th>
                      <th className="p-4">Escrow Capacity</th>
                      <th className="p-4">Payment & Conditions</th>
                      <th className="p-4 text-right">Escrow Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {filteredOrders.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-12 text-center text-zinc-500 space-y-2">
                          <Coins className="h-10 w-10 text-zinc-600 mx-auto" />
                          <p className="text-sm">No active advertisements match your filter choices.</p>
                        </td>
                      </tr>
                    ) : (
                      filteredOrders.map(order => {
                        const isMyOrder = currentUser?.id === order.user_id;
                        const { eligible, reasons } = checkUserEligibility(order);

                        return (
                          <tr key={order.id} className={`${isDark ? 'hover:bg-zinc-900/30' : 'hover:bg-gray-50/50'} transition-all`}>
                            
                            {/* Merchant */}
                            <td className="p-4">
                              <div className="flex flex-col">
                                <span className="font-extrabold text-zinc-200 flex items-center gap-1">
                                  {isMyOrder ? 'You' : `Merchant_${order.user_id.slice(0, 5)}`}
                                  {!isMyOrder && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                                </span>
                                <span className="text-[10px] text-zinc-500">100% Trust • 80+ Trades</span>
                              </div>
                            </td>

                            {/* Rate */}
                            <td className="p-4">
                              <span className="font-black text-indigo-400 text-sm">${order.price.toFixed(2)} USD</span>
                              <span className="text-[10px] text-zinc-500 block">per unit</span>
                            </td>

                            {/* Available */}
                            <td className="p-4 font-bold text-zinc-300">
                              {order.amount} {order.coin}
                            </td>

                            {/* Terms */}
                            <td className="p-4">
                              <div className="flex flex-col gap-1">
                                <span className="px-2 py-0.5 bg-zinc-900 text-zinc-300 text-[10px] font-bold rounded-lg border border-zinc-800 w-fit">
                                  {order.paymentMethod}
                                </span>
                                <div className="flex gap-1">
                                  {order.required_kyc === 1 && (
                                    <span className="bg-indigo-500/10 text-indigo-400 text-[9px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/10">🛡️ KYC req</span>
                                  )}
                                  {order.required_min_trades > 0 && (
                                    <span className="bg-amber-500/10 text-amber-400 text-[9px] font-bold px-1.5 py-0.5 rounded border border-amber-500/10">🏆 &gt;={order.required_min_trades} trades</span>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Action Control */}
                            <td className="p-4 text-right">
                              {isMyOrder ? (
                                <span className="text-[10px] text-zinc-500 font-bold italic">My active ad</span>
                              ) : eligible ? (
                                <button 
                                  onClick={() => {
                                    setSelectedOrder(order);
                                    setInitiateAmount(order.amount.toString());
                                    setTradeTermsAccepted(false);
                                  }}
                                  className={`px-4 py-2 rounded-xl text-xs font-black text-white ${
                                    activeView === 'browse-buy' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                                  }`}
                                >
                                  {activeView === 'browse-buy' ? 'Buy' : 'Sell'} {order.coin}
                                </button>
                              ) : (
                                <div className="flex flex-col items-end gap-0.5">
                                  <span className="px-3 py-1.5 bg-zinc-900 text-zinc-600 rounded-xl font-bold text-xs cursor-not-allowed">
                                    Ineligible
                                  </span>
                                  <span className="text-[9px] text-rose-500 max-w-[120px] truncate" title={reasons[0]}>
                                    {reasons[0]}
                                  </span>
                                </div>
                              )}
                            </td>

                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

            </div>
          )}

        </div>

        {/* Right Sidebar Column (25% screen width) */}
        <div className="w-full lg:w-1/4 p-6 bg-zinc-900/10 flex flex-col gap-6">
          
          {/* Portfolio & Wallet Status section */}
          <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-900 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-zinc-800">
              <span className="text-[10px] uppercase font-black text-zinc-400 tracking-wider">P2P Escrow Account</span>
              <UserCheck className="h-4 w-4 text-indigo-500" />
            </div>

            <div className="space-y-1">
              <p className="text-[10px] text-zinc-500 uppercase font-bold">My Crypto Balance</p>
              <h3 className="text-lg font-black text-indigo-400 tracking-wide">
                {userInfo.balance.toFixed(4)} Units
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div className="p-2.5 rounded-xl bg-zinc-950/50 border border-zinc-900 text-center">
                <p className="text-[9px] text-zinc-500 font-bold uppercase">KYC Status</p>
                <p className={`font-black text-[10px] uppercase tracking-wide mt-0.5 ${userInfo.verificationStatus === 'verified' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {userInfo.verificationStatus}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-950/50 border border-zinc-900 text-center">
                <p className="text-[9px] text-zinc-500 font-bold uppercase">Contracts Done</p>
                <p className="font-black text-[10px] mt-0.5 text-zinc-200">
                  {userInfo.completedTrades} Completed
                </p>
              </div>
            </div>

            {userInfo.verificationStatus !== 'verified' && (
              <div className="p-2.5 bg-rose-500/10 text-rose-400 text-[10px] rounded-xl border border-rose-500/10 flex items-start gap-1.5 font-medium leading-relaxed">
                <Info className="h-4 w-4 shrink-0" />
                <span>Unverified profiles may not participate in advertisements requiring identity verified statuses.</span>
              </div>
            )}
          </div>

          {/* Quick Post Ad Section */}
          <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-900 space-y-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-zinc-300">Quick Advertisement listing</h4>
            <p className="text-[10px] text-zinc-500 leading-relaxed">Create a customized peer-to-peer ad with limits, payment processor, and verification requirements instantly.</p>
            
            <button 
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-lg shadow-indigo-600/10 transition-all flex items-center justify-center gap-1.5"
            >
              <Coins className="h-4 w-4" />
              {showCreateForm ? 'Close ad panel' : 'Launch advertisement form'}
            </button>
          </div>

          {/* Quick Pending contracts indicator list */}
          <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-900 space-y-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-zinc-300 flex items-center justify-between">
              Pending Contracts
              {activeTrades.filter(t => t.status === 'open' || t.status === 'paid').length > 0 && (
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
              )}
            </h4>
            
            {activeTrades.filter(t => t.status === 'open' || t.status === 'paid').length === 0 ? (
              <p className="text-[10px] text-zinc-500">No active pending transactions currently held in escrow.</p>
            ) : (
              <div className="space-y-2">
                {activeTrades.filter(t => t.status === 'open' || t.status === 'paid').map(trade => (
                  <div 
                    key={trade.id}
                    onClick={() => { refreshCurrentTrade(trade.id); setActiveView('my-escrows'); }}
                    className="p-2 bg-zinc-950/50 border border-zinc-850 hover:bg-zinc-905 cursor-pointer rounded-xl flex items-center justify-between text-[11px]"
                  >
                    <div className="truncate pr-2">
                      <span className="font-extrabold text-zinc-300">#{trade.id.slice(0, 6)}</span>
                      <span className="text-[9px] text-zinc-500 block">{trade.amount} {trade.coin}</span>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wide ${trade.status === 'paid' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-amber-500/10 text-amber-500'}`}>
                      {trade.status === 'paid' ? 'Paid' : 'Escrow'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>

      {/* Trade Initiation Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={() => setSelectedOrder(null)}>
          <div className={`w-full max-w-md p-6 rounded-2xl border ${isDark ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-zinc-200 text-zinc-900'} space-y-4`} onClick={e => e.stopPropagation()}>
            
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-extrabold text-base flex items-center gap-1.5">
                  <ShieldCheck className="h-5 w-5 text-indigo-500" />
                  Initiate Secure Trade Escrow
                </h3>
                <p className="text-xs text-zinc-400">Locking crypto with User_{selectedOrder.user_id.slice(0,6)}</p>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            {selectedOrder.terms && (
              <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl space-y-2">
                <span className="text-[10px] uppercase font-extrabold text-amber-500 flex items-center gap-1">
                  <BookOpen className="h-3 w-3" /> Counterparty Payment conditions
                </span>
                <p className="text-xs text-zinc-300 leading-relaxed italic bg-zinc-950 p-2.5 rounded border border-zinc-850">
                  "{selectedOrder.terms}"
                </p>
                <label className="flex items-center gap-1.5 pt-0.5 text-xs text-zinc-300 cursor-pointer select-none">
                  <input 
                    type="checkbox"
                    checked={tradeTermsAccepted}
                    onChange={(e) => setTradeTermsAccepted(e.target.checked)}
                    className="rounded border-zinc-850 text-indigo-600 focus:ring-indigo-500 bg-zinc-950"
                  />
                  I agree to meet terms
                </label>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 p-3 bg-zinc-950/40 rounded-xl border border-zinc-850 text-xs">
              <div>
                <span className="text-zinc-500 uppercase text-[9px] font-bold">Payment Method</span>
                <p className="font-black text-indigo-400">{selectedOrder.paymentMethod}</p>
              </div>
              <div>
                <span className="text-zinc-500 uppercase text-[9px] font-bold">Price per crypto</span>
                <p className="font-black text-zinc-300">${selectedOrder.price.toFixed(2)} USD</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-extrabold text-zinc-400 flex justify-between">
                  <span>Crypto Trade Size ({selectedOrder.coin})</span>
                  <span className="text-[11px] text-zinc-500 font-medium">Max: {selectedOrder.amount} units</span>
                </label>
                <div className="relative">
                  <input 
                    type="number"
                    value={initiateAmount}
                    onChange={(e) => setInitiateAmount(e.target.value)}
                    max={selectedOrder.amount}
                    placeholder="Enter crypto units"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                  <span className="absolute right-4 top-3 text-xs font-bold text-zinc-500">{selectedOrder.coin}</span>
                </div>
              </div>

              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-850 flex justify-between items-center text-xs">
                <span className="text-zinc-500 font-medium">Fiat transaction value:</span>
                <span className="font-black text-emerald-400 text-sm">
                  ${(Number(initiateAmount) * selectedOrder.price).toFixed(2)} USD
                </span>
              </div>

              {errorMessage && (
                <div className="p-3 bg-rose-500/10 text-rose-400 border border-rose-500/15 rounded-xl text-xs flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button 
                onClick={() => initiateTrade(selectedOrder)}
                className={`w-full py-3.5 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 text-white ${
                  selectedOrder.type === 'buy' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                <ShieldCheck className="h-4.5 w-4.5" />
                Initialize Locked Escrow
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
