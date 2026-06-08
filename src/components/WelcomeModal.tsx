import React from 'react';
import { X, Sparkles } from 'lucide-react';

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WelcomeModal({ isOpen, onClose }: WelcomeModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md p-6 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center space-x-2 text-yellow-400">
            <Sparkles className="w-6 h-6" />
            <h2 className="text-xl font-bold text-white">Welcome!</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-slate-300 mb-6 font-sans">
          Welcome to the trading platform. Get ready to trade with real-time candles, smart indicators, and high-fidelity analytics.
        </p>
        <button
          onClick={onClose}
          className="w-full py-2.5 bg-yellow-500 hover:bg-yellow-600 text-black font-bold rounded-lg transition-colors"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}
