import React from 'react';
import { Clock, AlertTriangle, Play, RefreshCw, X } from 'lucide-react';

interface SessionTimeoutModalProps {
  isOpen: boolean;
  secondsRemaining: number;
  onKeepAlive: () => void;
  onClearSession: () => void;
  theme: 'dark' | 'light';
}

export default function SessionTimeoutModal({
  isOpen,
  secondsRemaining,
  onKeepAlive,
  onClearSession,
  theme
}: SessionTimeoutModalProps) {
  if (!isOpen) return null;

  const percentage = (secondsRemaining / 60) * 1000; // For micro animations if needed

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md transition-all animate-fade-in">
      <div 
        id="session-timeout-modal-card"
        className={`w-full max-w-md rounded-2xl border p-6 flex flex-col shadow-2xl relative overflow-hidden transition-transform animate-scale-in ${
          theme === 'dark' 
            ? 'border-zinc-800 bg-zinc-950 text-white' 
            : 'border-zinc-200 bg-white text-zinc-950'
        }`}
      >
        {/* Glow accent */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1.5 bg-amber-500 rounded-b-full shadow-[0_0_20px_rgba(245,158,11,0.5)]"></div>

        {/* Header visual */}
        <div className="flex items-center space-x-3.5 mb-5 mt-2">
          <div className="h-11 w-11 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center animate-pulse shrink-0">
            <Clock className="h-5.5 w-5.5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-base font-black tracking-tight font-sans">
              Simulation Session Timeout
            </h3>
            <p className="text-[10px] text-zinc-400 font-mono uppercase font-bold tracking-widest mt-0.5">
              Idle Security Checkpoint
            </p>
          </div>
        </div>

        {/* Content body */}
        <div className="space-y-4 flex-1">
          <p className={`text-xs leading-relaxed ${theme === 'dark' ? 'text-zinc-305 text-zinc-300' : 'text-zinc-600'}`}>
            You have been inactive for a while. To protect our simulation node resources and preserve your active demo portfolio configurations, this guest session will automatically release in:
          </p>

          {/* Large dynamic countdown display */}
          <div className={`p-4 rounded-xl border flex flex-col items-center justify-center space-y-2 relative overflow-hidden ${
            theme === 'dark' ? 'bg-zinc-900/40 border-zinc-900' : 'bg-zinc-50 border-zinc-150'
          }`}>
            {/* Ambient progress circle indicator background */}
            <div className="text-4xl sm:text-5xl font-mono font-black tracking-tighter text-amber-500 animate-pulse">
              {secondsRemaining}s
            </div>
            <div className="text-[10px] uppercase tracking-wider font-extrabold text-zinc-400 font-mono">
              Seconds Remaining
            </div>
          </div>

          <div className={`text-[11px] px-3 py-2 rounded-lg flex items-start gap-2 ${
            theme === 'dark' ? 'bg-amber-500/5 text-amber-400 border border-amber-500/10' : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}>
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
            <span>
              <strong>Note:</strong> Expiration will clear all pending deals, active contracts, and reset the simulated balance back to <strong>$10,000.00</strong>.
            </span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row gap-2.5 mt-6 w-full">
          <button
            onClick={onClearSession}
            id="session-timeout-clear-btn"
            className={`flex-1 select-none font-bold py-2.5 px-4 rounded-xl text-xs uppercase tracking-wider transition-all order-2 sm:order-1 ${
              theme === 'dark' 
                ? 'bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-white border border-zinc-805 border-zinc-800' 
                : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-600 hover:text-zinc-950 border border-zinc-200'
            }`}
          >
            Reset Session
          </button>
          
          <button
            onClick={onKeepAlive}
            id="session-timeout-keepalive-btn"
            className="flex-1 select-none font-black py-2.5 px-4 rounded-xl text-xs uppercase tracking-wider text-slate-950 bg-amber-500 hover:bg-amber-600 shadow-[0_4px_12px_rgba(245,158,11,0.2)] hover:shadow-[0_4px_16px_rgba(245,158,11,0.35)] hover:-translate-y-0.5 transition-all order-1 sm:order-2 flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5 animate-spin-slow" />
            Keep Alive
          </button>
        </div>
      </div>
    </div>
  );
}
