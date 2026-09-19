import React from 'react';
import { Wallet } from 'lucide-react';
import P2PMarketplace from './P2PMarketplace';

interface FinanceDashboardProps {
  currentUser: any;
  isDark: boolean;
}

export default function FinanceDashboard({ currentUser, isDark }: FinanceDashboardProps) {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Wallet className="h-6 w-6 text-indigo-500" />
        <h2 className="text-xl font-bold">Finance & P2P Marketplace</h2>
      </div>
      
      <P2PMarketplace currentUser={currentUser} isDark={isDark} />
    </div>
  );
}
