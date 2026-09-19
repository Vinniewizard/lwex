import React, { useState, useEffect, useRef } from 'react';
import { 
  RefreshCw, ShieldCheck, DollarSign, Coins, MessageSquare, 
  Clock, ArrowRight, ChevronRight, AlertCircle, X, Send, CheckCircle, 
  ShieldAlert, UserCheck, Award, Zap, BookOpen, Star, Filter, Info, ChevronDown
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
  
  // User P2P portfolio information
  const [userInfo, setUserInfo] = useState<UserInfo>({
    balance: 0,
    verificationStatus: 'unverified',
    completedTrades: 0
  });

  const [activeTab, setActiveTab] = useState<'market' | 'my-trades'>('market');
  
  // Interactive search/filter states (Paxful Menu Style)
  const [filterType, setFilterType] = useState<'all' | 'buy' | 'sell'>('all');
  const [selectedCoin, setSelectedCoin] = useState<string>('all');
  const [selectedPayment, setSelectedPayment] = useState<string>('all');
  const [filterEligibleOnly, setFilterEligibleOnly] = useState<boolean>(false);
  const [minAmountFilter, setMinAmountFilter] = useState<string>('');

  const [showCreateForm, setShowCreateForm] = useState(false);
  
  // Custom posting states with seller conditions
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
      console.error('Error fetching user info:', e);
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
    
    // Eligible to sell what they have in account validation
    if (newOrder.type === 'sell') {
      if (userInfo.balance < Number(newOrder.amount)) {
        setErrorMessage(`Insufficient balance. You are trying to sell ${newOrder.amount} crypto but you only have ${userInfo.balance.toFixed(4)} in your wallet.`);
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
      alert('Please log in to trade.');
      return;
    }
    if (!tradeTermsAccepted && order.terms) {
      setErrorMessage("You must read and accept the seller's payment terms and conditions first.");
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
        // Open the newly created trade escrow session
        await refreshCurrentTrade(data.tradeId);
        setActiveTab('my-trades');
        fetchMyTrades();
        fetchUserInfo();
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
        fetchUserInfo();
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

  // Check if current user is eligible to buy/sell based on specific advertisement criteria
  const checkUserEligibility = (order: P2POrder): { eligible: boolean; reasons: string[] } => {
    const reasons: string[] = [];
    if (!currentUser) {
      return { eligible: false, reasons: ['Please log in to participate in trading.'] };
    }
    
    // If user is the owner of the offer, they can't initiate trade with themselves
    if (order.user_id === currentUser.id) {
      return { eligible: false, reasons: ['This is your own offer.'] };
    }

    // KYC Check: If offer requires KYC, current user must be verified
    if (order.required_kyc === 1 && userInfo.verificationStatus !== 'verified') {
      reasons.push('Identity verification (KYC) is required by this seller.');
    }

    // Trades Check: Minimum completed trades
    if (order.required_min_trades > 0 && userInfo.completedTrades < order.required_min_trades) {
      reasons.push(`Minimum of ${order.required_min_trades} completed trade(s) required (You have: ${userInfo.completedTrades}).`);
    }

    // Sell offer eligibility: If we want to SELL (by taking a BUY order), we must have enough crypto balance
    if (order.type === 'buy') {
      if (userInfo.balance < order.amount) {
        reasons.push(`Insufficient crypto balance in wallet. You need at least ${order.amount} ${order.coin} to fulfill this buy order.`);
      }
    }

    return {
      eligible: reasons.length === 0,
      reasons
    };
  };

  const filteredOrders = orders.filter(o => {
    // 1. Action Type Filter
    if (filterType !== 'all' && o.type !== filterType) return false;
    
    // 2. Coin Filter
    if (selectedCoin !== 'all' && o.coin !== selectedCoin) return false;

    // 3. Payment Method Filter
    if (selectedPayment !== 'all' && o.paymentMethod !== selectedPayment) return false;

    // 4. Min Amount Filter
    if (minAmountFilter && o.amount < Number(minAmountFilter)) return false;

    // 5. Eligible Only Filter
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
    <div className={`rounded-xl border ${isDark ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-gray-200 text-zinc-900'} overflow-hidden shadow-2xl`}>
      
      {/* Premium Paxful Branding Header */}
      <div className={`p-6 border-b ${isDark ? 'border-zinc-800 bg-gradient-to-r from-zinc-950 to-zinc-900' : 'border-gray-100 bg-gradient-to-r from-gray-50 to-white'} flex flex-col md:flex-row md:items-center md:justify-between gap-4`}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-1.5 rounded-lg text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h1 className="text-lg font-black tracking-tight flex items-center gap-2">
              Paxful Escrow P2P Portal
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-emerald-500/20">
                Escrow 100% Guaranteed
              </span>
            </h1>
          </div>
          <p className="text-xs text-zinc-400">Trade directly with verified buyers and sellers safely. Funds held securely in smart escrow.</p>
        </div>
        
        {/* User Balance and Verified Badge */}
        {currentUser && (
          <div className="flex items-center gap-3 bg-zinc-900/40 p-3 rounded-xl border border-zinc-800/80">
            <div className="space-y-0.5 text-right">
              <p className="text-[10px] uppercase font-bold text-zinc-500">My Escrow Balance</p>
              <p className="text-xs font-black text-indigo-400">{userInfo.balance.toFixed(4)} Crypto Units</p>
              <div className="flex items-center justify-end gap-1">
                {userInfo.verificationStatus === 'verified' ? (
                  <span className="text-[9px] text-emerald-400 font-bold flex items-center gap-0.5">
                    <UserCheck className="h-3 w-3" /> KYC Verified
                  </span>
                ) : (
                  <span className="text-[9px] text-rose-400 font-bold flex items-center gap-0.5">
                    <Info className="h-3 w-3" /> KYC Unverified
                  </span>
                )}
                <span className="text-[9px] text-zinc-500 font-bold">• {userInfo.completedTrades} Completed Trades</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hero Stats Section (Paxful UI Style) */}
      <div className={`grid grid-cols-1 md:grid-cols-3 border-b ${isDark ? 'border-zinc-800 bg-zinc-950/20' : 'border-gray-100 bg-gray-50/20'} divide-y md:divide-y-0 md:divide-x ${isDark ? 'divide-zinc-800' : 'divide-gray-100'}`}>
        <div className="p-4 flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-zinc-300">Ultra-Fast Releases</h4>
            <p className="text-[10px] text-zinc-500">Average release time of escrow is &lt; 3.5 minutes</p>
          </div>
        </div>
        <div className="p-4 flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-zinc-300">Escrow Security Guard</h4>
            <p className="text-[10px] text-zinc-500">Coins are locked safely inside verified escrow vaults</p>
          </div>
        </div>
        <div className="p-4 flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
            <Award className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-zinc-300">Global Peer-to-Peer</h4>
            <p className="text-[10px] text-zinc-500">Pick from hundreds of trusted payment processors globally</p>
          </div>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className={`p-4 border-b ${isDark ? 'border-zinc-800 bg-zinc-900/10' : 'border-gray-100 bg-gray-50/10'} flex items-center justify-between`}>
        <div className="flex gap-2 p-1 bg-zinc-900/30 rounded-xl border border-zinc-800">
          <button 
            onClick={() => { setActiveTab('market'); setCurrentTrade(null); }}
            className={`text-xs px-4 py-2 rounded-lg font-bold transition-all ${activeTab === 'market' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'}`}
          >
            Browse Offers Menu
          </button>
          <button 
            onClick={() => { setActiveTab('my-trades'); }}
            className={`text-xs px-4 py-2 rounded-lg font-bold transition-all flex items-center gap-1.5 ${activeTab === 'my-trades' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'}`}
          >
            My Active Escrows
            {activeTrades.filter(t => t.status === 'open' || t.status === 'paid').length > 0 && (
              <span className="bg-amber-500 text-black text-[9px] font-black h-4 w-4 rounded-full flex items-center justify-center animate-bounce">
                {activeTrades.filter(t => t.status === 'open' || t.status === 'paid').length}
              </span>
            )}
          </button>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold transition-all shadow-lg flex items-center gap-1"
          >
            <Coins className="h-4 w-4" />
            {showCreateForm ? 'Close Posting panel' : 'Create Trade Advertisement'}
          </button>
          <button 
            onClick={() => { fetchOrders(); fetchMyTrades(); fetchUserInfo(); }}
            className="p-2 rounded-xl bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all border border-zinc-800"
            title="Refresh All Orders"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Advanced Paxful Multi-criteria Searching and Filtering Menu */}
      {activeTab === 'market' && (
        <div className={`p-5 border-b ${isDark ? 'border-zinc-800 bg-zinc-950/40' : 'border-gray-50/50 bg-white'} space-y-4`}>
          <div className="flex items-center gap-1.5 text-xs font-black uppercase text-indigo-400 tracking-wider">
            <Filter className="h-3.5 w-3.5" />
            Find Your Optimal Peer-to-Peer Deal
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {/* Filter by Buy/Sell */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase font-extrabold text-zinc-500">I want to...</label>
              <select 
                value={filterType} 
                onChange={(e) => setFilterType(e.target.value as any)}
                className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">Buy or Sell Everything</option>
                <option value="buy">BUY Crypto (From sellers' ads)</option>
                <option value="sell">SELL Crypto (To buyers' ads)</option>
              </select>
            </div>

            {/* Filter by Cryptocurrency Coin */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase font-extrabold text-zinc-500">Select Asset</label>
              <select 
                value={selectedCoin} 
                onChange={(e) => setSelectedCoin(e.target.value)}
                className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All Cryptocurrencies (USDT, BTC, ETH)</option>
                <option value="USDT">USDT Tether</option>
                <option value="BTC">Bitcoin (BTC)</option>
                <option value="ETH">Ethereum (ETH)</option>
              </select>
            </div>

            {/* Filter by Payment Method */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase font-extrabold text-zinc-500">Payment Processor</label>
              <select 
                value={selectedPayment} 
                onChange={(e) => setSelectedPayment(e.target.value)}
                className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="all">All Payment Options</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Wise">Wise Payment</option>
                <option value="Revolut">Revolut Express</option>
                <option value="PayPal">PayPal Balance</option>
                <option value="Cash App">Cash App Instant</option>
              </select>
            </div>

            {/* Filter by Min Volume Amount */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase font-extrabold text-zinc-500">Minimum Crypto Amount</label>
              <input 
                type="number"
                placeholder="e.g. 10"
                value={minAmountFilter}
                onChange={(e) => setMinAmountFilter(e.target.value)}
                className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={filterEligibleOnly} 
                  onChange={(e) => setFilterEligibleOnly(e.target.checked)}
                  className="rounded border-zinc-800 text-indigo-600 focus:ring-indigo-500 bg-zinc-900"
                />
                Show Only Offers I am Eligible to Fulfill
              </label>
            </div>

            <div className="text-[11px] text-zinc-500">
              Found <span className="font-bold text-indigo-400">{filteredOrders.length}</span> active advertisement(s) matching your parameters.
            </div>
          </div>
        </div>
      )}

      {/* Create Trade Offer Panel (Paxful UI Style) */}
      {showCreateForm && (
        <form onSubmit={createOrder} className="p-6 border-b border-zinc-800 bg-indigo-950/20 space-y-6">
          <div className="flex items-center gap-2 text-indigo-400 pb-1 border-b border-zinc-800/50">
            <Coins className="h-5 w-5" />
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider">Configure New P2P Advertisement</h3>
              <p className="text-[11px] text-zinc-400">Specify your trade parameters and user conditions to filter out unqualified buyers/sellers.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-bold text-zinc-400">I want to...</label>
              <select 
                value={newOrder.type}
                onChange={(e) => setNewOrder({...newOrder, type: e.target.value})}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="buy">BUY CRYPTO (Hold seller escrow)</option>
                <option value="sell">SELL CRYPTO (Release your escrow)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-bold text-zinc-400">Crypto Coin</label>
              <select 
                value={newOrder.coin}
                onChange={(e) => setNewOrder({...newOrder, coin: e.target.value})}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="USDT">USDT</option>
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-bold text-zinc-400 flex justify-between">
                <span>Total Crypto Amount</span>
                {newOrder.type === 'sell' && (
                  <button 
                    type="button" 
                    onClick={() => setNewOrder({...newOrder, amount: userInfo.balance.toString()})}
                    className="text-[9px] text-indigo-400 hover:underline font-bold"
                  >
                    Sell Max ({userInfo.balance.toFixed(2)})
                  </button>
                )}
              </label>
              <input 
                type="number" 
                required 
                placeholder="e.g. 500"
                value={newOrder.amount}
                onChange={(e) => setNewOrder({...newOrder, amount: e.target.value})}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-bold text-zinc-400">Fiat Price per Unit (USD)</label>
              <input 
                type="number" 
                required 
                placeholder="e.g. 1.00"
                value={newOrder.price}
                onChange={(e) => setNewOrder({...newOrder, price: e.target.value})}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-bold text-zinc-400">Payment Processor</label>
              <select 
                value={newOrder.paymentMethod}
                onChange={(e) => setNewOrder({...newOrder, paymentMethod: e.target.value})}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option>Bank Transfer</option>
                <option>Wise</option>
                <option>Revolut</option>
                <option>PayPal</option>
                <option>Cash App</option>
              </select>
            </div>

            {/* Custom Paxful Seller Conditions Configuration */}
            <div className="grid grid-cols-2 gap-3 bg-zinc-900/40 p-3 rounded-xl border border-zinc-800">
              <div className="flex flex-col gap-1.5 justify-center">
                <span className="text-[10px] uppercase font-extrabold text-zinc-500">Security Requirement</span>
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                  <input 
                    type="checkbox"
                    checked={newOrder.required_kyc}
                    onChange={(e) => setNewOrder({...newOrder, required_kyc: e.target.checked})}
                    className="rounded border-zinc-800 text-indigo-600 focus:ring-indigo-500 bg-zinc-950"
                  />
                  Require KYC Verified User
                </label>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-extrabold text-zinc-500">Min Completed Trades</label>
                <input 
                  type="number"
                  placeholder="0"
                  value={newOrder.required_min_trades}
                  onChange={(e) => setNewOrder({...newOrder, required_min_trades: e.target.value})}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-bold text-zinc-400">Sellers Conditions & Payment Instructions (Paxful Terms)</label>
            <textarea 
              rows={2}
              placeholder="e.g., Transfer must be sent from your personal bank account matching your KYC profile name. Provide screenshot of transaction confirmation. No third-party payments."
              value={newOrder.terms}
              onChange={(e) => setNewOrder({...newOrder, terms: e.target.value})}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {errorMessage && (
            <div className="p-3.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {errorMessage}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button 
              type="button" 
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 rounded-xl text-xs font-bold text-zinc-400"
            >
              Cancel
            </button>
            <button 
              type="submit"
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-lg shadow-indigo-600/10 transition-all"
            >
              Confirm and Post Advertisement
            </button>
          </div>
        </form>
      )}

      {/* Offers Menu Browser (Paxful Cards and Row Design) */}
      {activeTab === 'market' && (
        <div className="overflow-x-auto">
          {filteredOrders.length === 0 ? (
            <div className="p-16 text-center text-zinc-500 space-y-3">
              <Coins className="h-12 w-12 text-zinc-600 mx-auto" />
              <p className="text-sm font-bold">No advertisements matches your search parameters.</p>
              <p className="text-xs text-zinc-600">Consider adjusting your payment filters or coin type in the browse menu above.</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs min-w-[700px]">
              <thead className={`border-b ${isDark ? 'border-zinc-800 bg-zinc-900/30' : 'border-gray-100 bg-gray-50'}`}>
                <tr className="text-zinc-400 font-bold tracking-wider uppercase text-[10px]">
                  <th className="p-4">Merchants & Trust Status</th>
                  <th className="p-4">Advertisement Type</th>
                  <th className="p-4">Locked Escrow Capacity</th>
                  <th className="p-4">Best Unit Price</th>
                  <th className="p-4">Sellers Conditions & Payment</th>
                  <th className="p-4 text-right">Initiation Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {filteredOrders.map(order => {
                  const isMyOrder = currentUser?.id === order.user_id;
                  const { eligible, reasons } = checkUserEligibility(order);

                  return (
                    <tr key={order.id} className={`${isDark ? 'hover:bg-zinc-900/40' : 'hover:bg-gray-50/50'} transition-all`}>
                      {/* Merchant detail column */}
                      <td className="p-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-extrabold text-zinc-200 text-sm flex items-center gap-1">
                            {isMyOrder ? 'My Advertisement' : `User_${order.user_id.slice(0, 6)}`}
                            {!isMyOrder && <span className="h-2 w-2 rounded-full bg-emerald-500" title="Online now" />}
                          </span>
                          <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                            <span className="text-amber-500 font-bold flex items-center gap-0.5">
                              <Star className="h-3 w-3 fill-amber-500" /> 4.98
                            </span>
                            <span>• 100% Trust Score</span>
                          </div>
                        </div>
                      </td>

                      {/* Buy or sell label */}
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                          order.type === 'buy' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                          {order.type === 'buy' ? 'BUY CRYPTO (Pays Fiat)' : 'SELL CRYPTO (Wants Fiat)'}
                        </span>
                      </td>

                      {/* Cryptocurrency capacity */}
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="text-zinc-200 font-bold text-sm">
                            {order.amount} {order.coin}
                          </span>
                          <span className="text-[10px] text-zinc-500">Available limits: 10 - {order.amount} {order.coin}</span>
                        </div>
                      </td>

                      {/* Price per coin */}
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="text-indigo-400 font-black text-sm tracking-wide">
                            ${order.price.toFixed(2)} USD
                          </span>
                          <span className="text-[10px] text-zinc-500">per {order.coin} unit</span>
                        </div>
                      </td>

                      {/* Conditions Checklist / Payment details */}
                      <td className="p-4">
                        <div className="flex flex-col gap-1 max-w-xs">
                          {/* Payment Processor Badges */}
                          <div className="flex items-center gap-1.5">
                            <span className="px-2.5 py-0.5 bg-zinc-800/80 rounded-lg text-zinc-300 text-[10px] font-bold border border-zinc-700/50">
                              {order.paymentMethod}
                            </span>
                          </div>

                          {/* Specific criteria tag checks */}
                          <div className="flex flex-wrap gap-1">
                            {order.required_kyc === 1 && (
                              <span className="bg-indigo-500/10 text-indigo-400 text-[9px] px-1.5 py-0.5 rounded font-bold border border-indigo-500/15 flex items-center gap-0.5">
                                <UserCheck className="h-2.5 w-2.5" /> KYC req
                              </span>
                            )}
                            {order.required_min_trades > 0 && (
                              <span className="bg-amber-500/10 text-amber-400 text-[9px] px-1.5 py-0.5 rounded font-bold border border-amber-500/15 flex items-center gap-0.5">
                                <Award className="h-2.5 w-2.5" /> &gt;={order.required_min_trades} trades
                              </span>
                            )}
                            {!order.required_kyc && order.required_min_trades === 0 && (
                              <span className="text-zinc-500 text-[9px] italic">No strict constraints</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Button initiate controls */}
                      <td className="p-4 text-right">
                        {isMyOrder ? (
                          <span className="text-[10px] text-zinc-500 font-bold italic">Active ad posted by you</span>
                        ) : eligible ? (
                          <button 
                            onClick={() => { 
                              setSelectedOrder(order); 
                              setInitiateAmount(order.amount.toString()); 
                              setTradeTermsAccepted(false);
                            }}
                            className={`px-4.5 py-2 rounded-xl font-bold text-xs shadow-lg transition-all transform hover:scale-[1.03] ${
                              order.type === 'buy' 
                                ? 'bg-rose-600 hover:bg-rose-700 text-white' 
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            }`}
                          >
                            {order.type === 'buy' ? 'Sell Crypto' : 'Buy Crypto'}
                          </button>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <span className="px-3.5 py-1.5 bg-zinc-800 text-zinc-500 rounded-xl font-bold text-xs cursor-not-allowed select-none">
                              Ineligible
                            </span>
                            <span className="text-[9px] text-rose-500 text-right font-medium max-w-[150px] truncate" title={reasons.join(', ')}>
                              {reasons[0]}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Trade Initiation Modal (Paxful Terms & Conditions Screen) */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={() => setSelectedOrder(null)}>
          <div className={`w-full max-w-lg p-6 rounded-2xl border ${isDark ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-zinc-200 text-zinc-900'} space-y-4`} onClick={e => e.stopPropagation()}>
            
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-extrabold text-base flex items-center gap-1.5">
                  <ShieldCheck className="h-5 w-5 text-indigo-500" />
                  Initiate Safe Escrow Trade
                </h3>
                <p className="text-xs text-zinc-400">Trading with User_{selectedOrder.user_id.slice(0,6)}</p>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Seller terms & requirements */}
            {selectedOrder.terms && (
              <div className="p-4 bg-amber-500/5 border border-amber-500/10 rounded-xl space-y-2">
                <h4 className="text-xs font-black text-amber-500 flex items-center gap-1 uppercase tracking-wider">
                  <BookOpen className="h-3.5 w-3.5" />
                  Seller's Payment Terms & Conditions
                </h4>
                <p className="text-xs text-zinc-300 leading-relaxed italic bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-800">
                  "{selectedOrder.terms}"
                </p>
                <label className="flex items-center gap-2 pt-1 text-xs text-zinc-300 cursor-pointer select-none">
                  <input 
                    type="checkbox"
                    checked={tradeTermsAccepted}
                    onChange={(e) => setTradeTermsAccepted(e.target.checked)}
                    className="rounded border-zinc-800 text-indigo-600 focus:ring-indigo-500 bg-zinc-950"
                  />
                  I read, understood and agree to fulfill the seller's terms
                </label>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 p-3 bg-zinc-950/50 rounded-xl border border-zinc-800 text-xs">
              <div>
                <p className="text-zinc-500 font-semibold uppercase text-[10px]">Payment Method</p>
                <p className="font-bold text-indigo-400 text-sm">{selectedOrder.paymentMethod}</p>
              </div>
              <div>
                <p className="text-zinc-500 font-semibold uppercase text-[10px]">Exchange Rate</p>
                <p className="font-bold text-zinc-200 text-sm">${selectedOrder.price.toFixed(2)} USD</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-zinc-400 flex justify-between">
                  <span>Define Trade Amount ({selectedOrder.coin})</span>
                  <span className="text-[11px] text-zinc-500">Max limit: {selectedOrder.amount} {selectedOrder.coin}</span>
                </label>
                <div className="relative">
                  <input 
                    type="number"
                    value={initiateAmount}
                    onChange={(e) => setInitiateAmount(e.target.value)}
                    max={selectedOrder.amount}
                    placeholder="Enter amount"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <span className="absolute right-4 top-3 text-xs font-bold text-zinc-400">{selectedOrder.coin}</span>
                </div>
              </div>

              <div className="p-3 bg-indigo-950/20 rounded-xl border border-indigo-500/10 flex justify-between items-center text-xs">
                <span className="text-zinc-400 font-medium">Estimated Fiat Transaction Volume:</span>
                <span className="font-black text-emerald-400 text-base">
                  ${(Number(initiateAmount) * selectedOrder.price).toFixed(2)} USD
                </span>
              </div>

              {errorMessage && (
                <div className="p-3 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-xl text-xs flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button 
                onClick={() => initiateTrade(selectedOrder)}
                className={`w-full py-3.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow ${
                  selectedOrder.type === 'buy' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                } text-white`}
              >
                <ShieldCheck className="h-4.5 w-4.5" />
                Initialize Locked Escrow Vault
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Trades Tab */}
      {activeTab === 'my-trades' && !currentTrade && (
        <div className="p-5 space-y-4">
          <h3 className="text-sm font-bold text-zinc-400 flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-indigo-500" />
            Your Active Trade Escrows & Contracts
          </h3>
          {activeTrades.length === 0 ? (
            <div className="p-16 text-center text-zinc-500 space-y-3">
              <MessageSquare className="h-12 w-12 text-zinc-600 mx-auto" />
              <p className="text-sm font-bold">You are not involved in any active P2P contracts right now.</p>
              <p className="text-xs text-zinc-600">Browse the offers menu to initiate a trade session instantly.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeTrades.map(trade => {
                const isBuyer = trade.buyer_id === currentUser?.id;
                return (
                  <div 
                    key={trade.id}
                    onClick={() => refreshCurrentTrade(trade.id)}
                    className={`p-5 rounded-2xl border ${isDark ? 'bg-zinc-900/60 hover:bg-zinc-900 border-zinc-800' : 'bg-white hover:bg-gray-50 border-gray-200'} cursor-pointer transition-all hover:scale-[1.01]`}
                  >
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${
                          trade.status === 'open' ? 'bg-amber-500 animate-pulse' :
                          trade.status === 'paid' ? 'bg-indigo-500 animate-pulse' :
                          trade.status === 'completed' ? 'bg-emerald-500' : 'bg-zinc-600'
                        }`} />
                        <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                          Trade Contract #{trade.id.slice(0, 8)}
                        </span>
                      </div>
                      <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider ${
                        trade.status === 'open' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/15' :
                        trade.status === 'paid' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/15' :
                        trade.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {trade.status}
                      </span>
                    </div>

                    <div className="space-y-2 text-xs border-t border-b border-zinc-800/40 py-3 my-2">
                      <div className="flex justify-between">
                        <span className="text-zinc-500 font-semibold">Your Escrow Role:</span>
                        <span className="font-extrabold text-indigo-400 uppercase tracking-wide">
                          {isBuyer ? 'Buyer (Paying Fiat)' : 'Seller (Crypto Deposited)'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500 font-semibold">Asset:</span>
                        <span className="font-bold text-zinc-200">{trade.amount} {trade.coin}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500 font-semibold">Volume to Pay:</span>
                        <span className="font-black text-emerald-400">${(trade.amount * trade.price).toFixed(2)} USD</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end text-xs font-bold text-indigo-400 items-center gap-1">
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

      {/* Paxful Escrow Live Trade Dashboard (The Interactive Stage) */}
      {activeTab === 'my-trades' && currentTrade && (
        <div className="flex flex-col lg:flex-row border-t border-zinc-800 min-h-[500px]">
          
          {/* Left Panel: Escrow instructions, checklist controls, timer, terms */}
          <div className="w-full lg:w-1/2 p-6 border-b lg:border-b-0 lg:border-r border-zinc-800 space-y-6">
            <button 
              onClick={() => { setCurrentTrade(null); fetchMyTrades(); }}
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 font-semibold border border-zinc-800 rounded-lg px-2.5 py-1 w-fit bg-zinc-900/40"
            >
              <ArrowRight className="h-4 w-4 rotate-180" />
              Return to active contracts list
            </button>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-black text-white flex items-center gap-1.5">
                  <ShieldCheck className="h-5.5 w-5.5 text-emerald-500 animate-pulse" />
                  Verified Escrow Lock
                </h3>
                <span className={`text-xs font-black px-3 py-1 rounded-full uppercase tracking-widest border ${
                  currentTrade.status === 'open' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                  currentTrade.status === 'paid' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' :
                  currentTrade.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-zinc-800 text-zinc-400'
                }`}>
                  {currentTrade.status === 'open' ? 'Awaiting Payment' : currentTrade.status === 'paid' ? 'Payment Marked' : currentTrade.status}
                </span>
              </div>
              <p className="text-xs text-zinc-500">Contract Hash: <span className="font-mono text-zinc-400 text-[11px]">{currentTrade.id}</span></p>
            </div>

            {/* Display Terms of the Trade order inside the active chat dashboard! */}
            {orders.find(o => o.id === currentTrade.order_id)?.terms && (
              <div className="p-4 bg-indigo-950/25 border border-indigo-500/20 rounded-xl space-y-2">
                <h4 className="text-[11px] uppercase font-black text-indigo-400 flex items-center gap-1.5">
                  <BookOpen className="h-4 w-4" />
                  Seller's Verified Payment terms
                </h4>
                <p className="text-xs text-zinc-300 leading-relaxed italic">
                  "{orders.find(o => o.id === currentTrade.order_id)?.terms}"
                </p>
              </div>
            )}

            {/* Locked Escrow Information Metrics */}
            <div className="grid grid-cols-2 gap-3 p-4 bg-zinc-900/60 rounded-xl border border-zinc-800 text-xs">
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-extrabold">Cryptocurrency Held</p>
                <p className="text-sm font-black text-zinc-200">{currentTrade.amount} {currentTrade.coin}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-extrabold">Fiat Volume Owed</p>
                <p className="text-sm font-black text-emerald-400">${(currentTrade.amount * currentTrade.price).toFixed(2)} USD</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-extrabold">Counterparty Buyer Account</p>
                <p className="text-xs font-semibold text-zinc-400 truncate">{currentTradeBuyerEmail || 'Loading...'}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-extrabold">Counterparty Seller Account</p>
                <p className="text-xs font-semibold text-zinc-400 truncate">{currentTradeSellerEmail || 'Loading...'}</p>
              </div>
            </div>

            {/* Expire cancellation timer box */}
            {currentTrade.status === 'open' && (
              <div className="p-4 bg-amber-500/5 rounded-xl border border-amber-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-amber-500 animate-spin-slow" />
                  <div>
                    <h4 className="text-xs font-black text-zinc-300 uppercase">Buyer Payment Deadline</h4>
                    <p className="text-[10px] text-zinc-500">Auto-cancellations release escrow back to seller if unpaid.</p>
                  </div>
                </div>
                <span className="text-sm font-black text-amber-400 tracking-widest bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-850">
                  {timeLeft}
                </span>
              </div>
            )}

            {/* Actions panel controls */}
            <div className="space-y-3">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-zinc-500">P2P Escrow Action Commands</h4>
              
              {currentUser?.id === currentTrade.buyer_id ? (
                // BUYER PANEL
                <div className="space-y-3">
                  {currentTrade.status === 'open' && (
                    <button 
                      onClick={() => markAsPaid(currentTrade.id)}
                      className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/10 transition-all"
                    >
                      <CheckCircle className="h-5 w-5" />
                      I Have Completed payment (Mark Paid)
                    </button>
                  )}
                  {currentTrade.status === 'open' && (
                    <button 
                      onClick={() => cancelTrade(currentTrade.id)}
                      className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-850 text-rose-400 hover:text-rose-300 rounded-xl text-xs font-bold transition-all border border-zinc-800"
                    >
                      Abort Escrow & Cancel Trade
                    </button>
                  )}
                  {currentTrade.status === 'paid' && (
                    <div className="space-y-3">
                      <div className="p-3.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-xs text-indigo-400 flex items-center gap-2 font-medium">
                        <Clock className="h-4.5 w-4.5 animate-pulse" />
                        You marked this as paid! Seller is reviewing transaction logs.
                      </div>
                      <button 
                        onClick={() => disputeTrade(currentTrade.id)}
                        className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-850 text-amber-500 rounded-xl text-xs font-bold transition-all border border-zinc-800"
                      >
                        Raise Trade Dispute with Admin Support
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                // SELLER PANEL
                <div className="space-y-3">
                  {(currentTrade.status === 'open' || currentTrade.status === 'paid') && (
                    <button 
                      onClick={() => releaseEscrow(currentTrade.id)}
                      className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/10 transition-all"
                    >
                      <ShieldCheck className="h-5 w-5" />
                      Verify Payment Received & Release Cryptocurrency
                    </button>
                  )}
                  {currentTrade.status === 'open' && (
                    <button 
                      onClick={() => cancelTrade(currentTrade.id)}
                      className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-850 text-rose-400 hover:text-rose-300 rounded-xl text-xs font-bold transition-all border border-zinc-800"
                    >
                      Cancel Trade & Reclaim Locked Escrow
                    </button>
                  )}
                  {currentTrade.status === 'paid' && (
                    <button 
                      onClick={() => disputeTrade(currentTrade.id)}
                      className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-850 text-amber-500 rounded-xl text-xs font-bold transition-all border border-zinc-800"
                    >
                      Raise Trade Dispute with Admin Support
                    </button>
                  )}
                </div>
              )}

              {currentTrade.status === 'completed' && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs flex items-center gap-3">
                  <CheckCircle className="h-6 w-6 shrink-0" />
                  <div>
                    <h5 className="font-extrabold text-sm">Escrow Released Successfully</h5>
                    <p className="text-[11px] text-emerald-500/80">Cryptocurrency has been deposited into the buyer's active balance. Trade finalized.</p>
                  </div>
                </div>
              )}

              {currentTrade.status === 'cancelled' && (
                <div className="p-4 bg-zinc-900 text-zinc-400 border border-zinc-800 rounded-xl text-xs flex items-center gap-3">
                  <AlertCircle className="h-6 w-6 shrink-0" />
                  <div>
                    <h5 className="font-extrabold text-sm">Escrow Aborted / Cancelled</h5>
                    <p className="text-[11px] text-zinc-500 font-medium">Locked assets have been credited back to the seller's balance safely.</p>
                  </div>
                </div>
              )}

              {currentTrade.status === 'disputed' && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-xl text-xs flex items-center gap-3">
                  <ShieldAlert className="h-6 w-6 shrink-0" />
                  <div>
                    <h5 className="font-extrabold text-sm">Dispute Initiated</h5>
                    <p className="text-[11px] text-amber-500/80">Support admins are reviewing chat transcripts, proof screenshots, and transaction history.</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Live Chat Messages and Send Form */}
          <div className="w-full lg:w-1/2 flex flex-col min-h-[400px]">
            <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/20 shrink-0">
              <span className="text-xs font-extrabold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4 text-indigo-500" />
                Live Trade Chat Console
              </span>
              <button 
                onClick={() => refreshCurrentTrade(currentTrade.id)}
                className="px-2.5 py-1 rounded bg-zinc-900/80 hover:bg-zinc-850 text-zinc-400 hover:text-white transition-all text-[11px] flex items-center gap-1 font-semibold border border-zinc-800"
              >
                <RefreshCw className="h-3 w-3" />
                Reload Messages
              </button>
            </div>

            {/* Chat message listings */}
            <div className="flex-1 p-4 overflow-y-auto max-h-[380px] space-y-3 bg-zinc-900/15">
              {getChatMessages(currentTrade.chat_messages).map((m) => {
                const isSystem = m.sender === 'system';
                const isMe = m.sender === currentUser?.id;
                
                if (isSystem) {
                  return (
                    <div key={m.id} className="p-3 bg-indigo-950/40 border border-indigo-500/10 rounded-xl text-[11px] text-indigo-300 text-center flex flex-col gap-1 mx-4">
                      <ShieldCheck className="h-4 w-4.5 text-indigo-400 mx-auto" />
                      <span className="font-medium">{m.text}</span>
                    </div>
                  );
                }

                return (
                  <div key={m.id} className={`flex flex-col max-w-[80%] ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                    <span className="text-[9px] text-zinc-500 font-bold mb-0.5">
                      {isMe ? 'You' : m.senderEmail || 'Trader'}
                    </span>
                    <div className={`p-3 rounded-2xl text-xs leading-relaxed ${
                      isMe 
                        ? 'bg-indigo-600 text-white rounded-tr-none shadow-md' 
                        : (isDark ? 'bg-zinc-800 text-zinc-200 rounded-tl-none border border-zinc-700/30' : 'bg-gray-100 text-zinc-800 rounded-tl-none')
                    }`}>
                      {m.text}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input box */}
            {currentTrade.status !== 'completed' && currentTrade.status !== 'cancelled' && (
              <form onSubmit={sendChatMessage} className="p-3.5 border-t border-zinc-800 flex gap-2 bg-zinc-950/40 shrink-0">
                <input 
                  type="text"
                  placeholder="Ask questions, share bank details, or send payment receipt confirmation..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="flex-1 bg-zinc-900 border border-zinc-800/80 rounded-xl px-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                />
                <button type="submit" className="p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all shadow-md shrink-0">
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
