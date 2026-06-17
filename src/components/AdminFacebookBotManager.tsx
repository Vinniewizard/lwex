import React, { useState } from 'react';
import { PlusCircle, Trash2, Link as LinkIcon, AlertCircle, Loader2, CheckCircle2, XCircle, Search, Globe } from 'lucide-react';

interface FacebookConfig {
  enabled: boolean;
  autoInviteEnabled: boolean;
  targetAudienceKeyword: string;
  responseDelaySeconds: number;
  targetGroups: { id: number; url: string }[];
  broadcastEnabled: boolean;
  broadcastMessage: string;
}

interface AdminFacebookBotManagerProps {
  config: FacebookConfig;
  setConfig: React.Dispatch<React.SetStateAction<FacebookConfig>>;
  theme: 'dark' | 'light';
}

export const AdminFacebookBotManager: React.FC<AdminFacebookBotManagerProps> = ({ config, setConfig, theme }) => {
  const [error, setError] = useState<string | null>(null);
  const [groupStatuses, setGroupStatuses] = useState<Record<number, 'idle' | 'checking' | 'active' | 'invalid'>>({});

  const validateUrl = (url: string) => {
    // Basic Facebook group URL validation
    const facebookRegex = /^https:\/\/(www\.)?facebook\.com\/groups\/[a-zA-Z0-9_\-\.]+\/?$/;
    return facebookRegex.test(url);
  };

  const updateGroupUrl = (id: number, newUrl: string) => {
    if (newUrl && !validateUrl(newUrl)) {
      setError(`Facebook group URL format is invalid.`);
    } else {
      setError(null);
    }
    
    setConfig(prev => ({
      ...prev,
      targetGroups: prev.targetGroups.map(g => g.id === id ? { ...g, url: newUrl } : g)
    }));
  };

  const addGroup = () => {
    setConfig(prev => ({
      ...prev,
      targetGroups: [...prev.targetGroups, { id: Date.now(), url: '' }]
    }));
  };

  const removeGroup = (id: number) => {
    setConfig(prev => ({
      ...prev,
      targetGroups: prev.targetGroups.filter(g => g.id !== id)
    }));
    setGroupStatuses(prev => {
        const next = {...prev};
        delete next[id];
        return next;
    });
  };

  const checkLinkStatus = async (id: number, url: string) => {
    setGroupStatuses(prev => ({ ...prev, [id]: 'checking' }));
    // Simulate network delay for verification
    await new Promise(resolve => setTimeout(resolve, 1500));
    const isAlive = Math.random() > 0.2; 
    setGroupStatuses(prev => ({ ...prev, [id]: isAlive ? 'active' : 'invalid' }));
  };

  return (
    <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-gray-50 border-gray-200'}`}>
      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
        <Globe className="w-4 h-4 text-blue-500" />
        Facebook Group Targets
      </h3>

      {error && (
        <div className="flex items-center gap-2 text-red-500 text-[10px] font-bold mb-3 p-2 bg-red-50 dark:bg-red-900/10 rounded">
          <AlertCircle className="w-3 h-3" />
          {error}
        </div>
      )}

      <div className="space-y-2">
        {config.targetGroups.map(group => (
          <div key={group.id} className="flex gap-2">
            <input 
              type="text" 
              value={group.url} 
              onChange={(e) => updateGroupUrl(group.id, e.target.value)}
              placeholder="https://facebook.com/groups/..."
              className={`flex-1 bg-white dark:bg-zinc-950 border ${theme === 'dark' ? 'border-zinc-800' : 'border-slate-200'} rounded px-3 py-2 text-xs text-slate-900 dark:text-white`}
            />
            {group.url && (
              <button
                onClick={() => checkLinkStatus(group.id, group.url)}
                disabled={groupStatuses[group.id] === 'checking'}
                className={`flex items-center px-2 rounded transition-colors ${groupStatuses[group.id] === 'active' ? 'text-green-500' : groupStatuses[group.id] === 'invalid' ? 'text-red-500' : 'text-slate-500'}`}
                title="Check link status"
              >
                {groupStatuses[group.id] === 'checking' ? <Loader2 className="w-4 h-4 animate-spin" /> : 
                 groupStatuses[group.id] === 'active' ? <CheckCircle2 className="w-4 h-4" /> : 
                 groupStatuses[group.id] === 'invalid' ? <XCircle className="w-4 h-4" /> : <Search className="w-4 h-4" />}
              </button>
            )}
            <button 
              onClick={() => removeGroup(group.id)} 
              className="px-2 bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      <button 
        onClick={addGroup}
        className="mt-3 flex items-center gap-1.5 text-xs text-indigo-500 font-bold hover:text-indigo-400 transition-colors"
      >
        <PlusCircle className="w-3.5 h-3.5" />
        Add Facebook Group
      </button>
    </div>
  );
};
