import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

interface P2POrder {
  id: string;
  user_id: string;
  type: 'buy' | 'sell';
  coin: string;
  amount: number;
  price: number;
  status: 'open' | 'escrow' | 'paid' | 'completed';
  paymentMethod: string;
  sellerTrustScore: number;
  completedTrades: number;
  chatMessages: { sender: string; text: string }[];
}

interface P2PMarketplaceProps {
  currentUser: any;
  isDark: boolean;
}

export default function P2PMarketplace({ currentUser, isDark }: P2PMarketplaceProps) {
  const [orders, setOrders] = useState<P2POrder[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newOrder, setNewOrder] = useState({ type: 'buy', coin: 'USDT', amount: '', price: '', paymentMethod: 'Bank Transfer' });
  const [selectedOrder, setSelectedOrder] = useState<P2POrder | null>(null);
  const [onlyHighTrust, setOnlyHighTrust] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'buy' | 'sell'>('all');

  // ...
  const filteredOrders = orders.filter(o => 
    (!onlyHighTrust || o.sellerTrustScore >= 95) &&
    (filterType === 'all' || o.type === filterType)
  );

  const fetchOrders = async () => {
    // Mocked data enhancement for demo purpose
    const response = await fetch('/api/p2p/orders');
    const data = await response.json();
    if (data.success) {
      setOrders(data.orders.map((o: any) => ({
        ...o,
        paymentMethod: o.paymentMethod || 'Bank Transfer',
        sellerTrustScore: 98,
        completedTrades: 150,
        chatMessages: [{ sender: 'System', text: 'Order created.' }]
      })));
    }
  };

  const createOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    
    if (newOrder.type === 'sell') {
        const response = await fetch('/api/p2p/balance', {
            headers: { 'Authorization': `Bearer ${currentUser.id}` }
        });
        const data = await response.json();
        if (data.success && data.balance < Number(newOrder.amount)) {
            alert('Insufficient balance to sell this amount.');
            return;
        }
    }
    
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
  };

  const markAsPaid = async (orderId: string) => {
    await fetch(`/api/p2p/orders/${orderId}/mark-paid`, { method: 'POST' });
    fetchOrders();
  };

  const releaseAssets = async (orderId: string) => {
    await fetch(`/api/p2p/orders/${orderId}/release`, { method: 'POST' });
    fetchOrders();
  };

  return (
    <div className={`rounded-lg border ${isDark ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-gray-200'} overflow-hidden`}>
      <div className="p-4 border-b border-zinc-800 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-bold">P2P Trading</h2>
          <div className="flex gap-2">
              <label className="flex items-center gap-1 text-xs text-zinc-400 cursor-pointer">
                <input type="checkbox" checked={onlyHighTrust} onChange={(e) => setOnlyHighTrust(e.target.checked)} />
                High Trust (95%+)
              </label>
              <button onClick={() => setShowCreateForm(!showCreateForm)} className="text-xs bg-indigo-600 text-white px-2 py-1 rounded">Post Order</button>
              <button onClick={fetchOrders} className="text-zinc-400 hover:text-white"><RefreshCw className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex gap-2 border-b border-zinc-800">
          {(['all', 'buy', 'sell'] as const).map(tab => (
              <button key={tab} onClick={() => setFilterType(tab)} className={`text-xs px-3 py-1 ${filterType === tab ? 'text-white border-b-2 border-indigo-500' : 'text-zinc-500'}`}>
                  {tab.toUpperCase()}
              </button>
          ))}
        </div>
      </div>
      
      {showCreateForm && (
        <form onSubmit={createOrder} className="p-4 border-b border-zinc-800 space-y-3">
            <h3 className="text-sm font-bold">Post New Advertisement</h3>
            <p className="text-xs text-zinc-400">Set your trade parameters to attract buyers/sellers. Ensure your pricing and payment method are accurate.</p>
            <div className="flex gap-2 flex-wrap">
              <select value={newOrder.type} onChange={(e) => setNewOrder({...newOrder, type: e.target.value as 'buy'|'sell'})} className="bg-zinc-900 border border-zinc-800 rounded p-1 text-xs text-white">
                <option value="buy">BUY</option>
                <option value="sell">SELL</option>
              </select>
              <input type="text" placeholder="Coin (e.g. USDT)" value={newOrder.coin} onChange={(e) => setNewOrder({...newOrder, coin: e.target.value})} className="bg-zinc-900 border border-zinc-800 rounded p-1 text-xs text-white w-24" />
              <input type="number" placeholder="Amount" value={newOrder.amount} onChange={(e) => setNewOrder({...newOrder, amount: e.target.value})} className="bg-zinc-900 border border-zinc-800 rounded p-1 text-xs text-white w-20" />
              <input type="number" placeholder="Price" value={newOrder.price} onChange={(e) => setNewOrder({...newOrder, price: e.target.value})} className="bg-zinc-900 border border-zinc-800 rounded p-1 text-xs text-white w-20" />
              <select value={newOrder.paymentMethod} onChange={(e) => setNewOrder({...newOrder, paymentMethod: e.target.value})} className="bg-zinc-900 border border-zinc-800 rounded p-1 text-xs text-white">
                <option>Bank Transfer</option>
                <option>Wise</option>
                <option>Revolut</option>
              </select>
              <button type="submit" className="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold">Confirm & Post</button>
            </div>
        </form>
      )}
      
      <table className="w-full text-left text-xs">
        <thead className={`border-b ${isDark ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-200 bg-gray-50'}`}>
          <tr className="text-zinc-500">
            <th className="p-3">Advertiser</th>
            <th className="p-3">Price</th>
            <th className="p-3">Payment</th>
            <th className="p-3">Available</th>
            <th className="p-3">Action</th>
            <th className="p-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {filteredOrders.map(order => (
            <tr key={order.id} onClick={() => setSelectedOrder(order)} className={`${isDark ? 'hover:bg-zinc-900' : 'hover:bg-gray-50'} cursor-pointer`}>
              <td className="p-3 font-medium text-zinc-300">User_{order.user_id.slice(0, 4)}</td>
              <td className={`p-3 font-bold ${order.type === 'buy' ? 'text-emerald-500' : 'text-rose-500'}`}>${order.price.toFixed(2)}</td>
              <td className="p-3 text-zinc-400">{order.paymentMethod}</td>
              <td className="p-3 text-zinc-400">{order.amount} {order.coin}</td>
              <td className="p-3">
                {order.status === 'open' && (
                  <button className={`px-4 py-1.5 rounded font-bold ${order.type === 'buy' ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20' : 'bg-rose-500/10 text-rose-500 hover:bg-rose-500/20'}`}>
                    {order.type === 'buy' ? 'Buy' : 'Sell'} {order.coin}
                  </button>
                )}
                {order.status === 'escrow' && currentUser?.id !== order.user_id && (
                  <button onClick={(e) => { e.stopPropagation(); markAsPaid(order.id); }} className="bg-indigo-600 text-white px-3 py-1 rounded text-xs font-bold">Confirm Payment</button>
                )}
                {order.status === 'paid' && currentUser?.id === order.user_id && (
                  <button onClick={(e) => { e.stopPropagation(); releaseAssets(order.id); }} className="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold">Release Assets</button>
                )}
              </td>
              <td className="p-3">
                <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                  order.status === 'open' ? 'bg-zinc-800 text-zinc-400' :
                  order.status === 'escrow' ? 'bg-amber-500/20 text-amber-500' :
                  order.status === 'paid' ? 'bg-indigo-500/20 text-indigo-500' :
                  'bg-emerald-500/20 text-emerald-500'
                }`}>
                  {order.status === 'open' ? 'Open' :
                   order.status === 'escrow' ? 'Escrow Held' :
                   order.status === 'paid' ? 'Payment Received' : 'Released'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedOrder(null)}>
            <div className={`w-full max-w-lg p-6 rounded-xl border ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`} onClick={e => e.stopPropagation()}>
                <h3 className="font-bold mb-4">Order #{selectedOrder.id.slice(0,8)}</h3>
                <div className="flex gap-4 mb-4">
                    <div className="flex-1 p-3 rounded bg-zinc-800/50">
                        <p className="text-xs text-zinc-400">Seller Trust</p>
                        <p className="text-lg font-bold text-emerald-500">{selectedOrder.sellerTrustScore}%</p>
                    </div>
                    <div className="flex-1 p-3 rounded bg-zinc-800/50">
                        <p className="text-xs text-zinc-400">Trades</p>
                        <p className="text-lg font-bold text-zinc-200">{selectedOrder.completedTrades}</p>
                    </div>
                </div>
                <div className="h-40 overflow-y-auto mb-4 bg-zinc-800/30 rounded p-2 text-xs">
                    {selectedOrder.chatMessages.map((m, i) => <p key={i}><span className="font-bold">{m.sender}:</span> {m.text}</p>)}
                </div>
                <input 
                  type="text" 
                  placeholder="Type message..." 
                  className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-xs text-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                        setSelectedOrder({...selectedOrder, chatMessages: [...selectedOrder.chatMessages, {sender: 'You', text: e.currentTarget.value.trim()}]});
                        e.currentTarget.value = '';
                    }
                  }}
                />
            </div>
        </div>
      )}
    </div>
  );
}
