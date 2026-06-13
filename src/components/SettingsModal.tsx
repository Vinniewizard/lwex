import React, { useState } from 'react';
import { X, User, Settings as SettingsIcon, Shield, CreditCard, LogOut, Clock, Globe, Phone as PhoneIcon, Edit2, Check, Mail, Lock, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { Account } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account;
  theme: 'dark' | 'light';
  currentUser?: any;
  onUpdateUser?: (user: any) => void;
  onLogout?: () => void;
  tradeHistory?: any[];
}

export default function SettingsModal({ isOpen, onClose, account, theme, currentUser, onUpdateUser, onLogout, tradeHistory = [] }: SettingsModalProps) {
  const [isEditingPhone, setIsEditingPhone] = React.useState(false);
  const [phoneInput, setPhoneInput] = React.useState('');
  const [phoneError, setPhoneError] = React.useState('');
  const [isEditingEmail, setIsEditingEmail] = React.useState(false);
  const [emailInput, setEmailInput] = React.useState('');
  const [emailError, setEmailError] = React.useState('');
  
  const [tradeSettlement, setTradeSettlement] = React.useState(currentUser?.notifSettings?.tradeSettlement ?? true);
  const [balanceUpdate, setBalanceUpdate] = React.useState(currentUser?.notifSettings?.balanceUpdate ?? true);
  const [promotion, setPromotion] = React.useState(currentUser?.notifSettings?.promotion ?? false);
  const [broadcastFrequency, setBroadcastFrequency] = React.useState(currentUser?.notifSettings?.broadcastFrequency ?? '1h');
  const isAdmin = currentUser?.email === 'admin@lwex.com' ||
                  currentUser?.email === 'peterchristine' ||
                  currentUser?.email === 'lucasantiago';

  const [activeSettingsTab, setActiveSettingsTab] = useState('profile');
  
  const [demoModeEnabled, setDemoModeEnabled] = useState(
    JSON.parse(localStorage.getItem('lwex_admin_demo_enabled') ?? 'true')
  );
  const [realModeEnabled, setRealModeEnabled] = useState(
    JSON.parse(localStorage.getItem('lwex_admin_real_enabled') ?? 'true')
  );

  const saveNotifSettings = () => {
    if (currentUser && onUpdateUser) {
      const updatedUser = {
        ...currentUser,
        notifSettings: { tradeSettlement, balanceUpdate, promotion, broadcastFrequency }
      };
      
      const users = JSON.parse(localStorage.getItem('lwex_users') || '[]');
      const updatedUsers = users.map((u: any) => u.email === currentUser.email ? updatedUser : u);
      localStorage.setItem('lwex_users', JSON.stringify(updatedUsers));
      onUpdateUser(updatedUser);
    }
  };

  const saveAdminSettings = (demo: boolean, real: boolean) => {
    localStorage.setItem('lwex_admin_demo_enabled', JSON.stringify(demo));
    localStorage.setItem('lwex_admin_real_enabled', JSON.stringify(real));
    setDemoModeEnabled(demo);
    setRealModeEnabled(real);
  };

  const [docType, setDocType] = React.useState('National ID');
  const [docNum, setDocNum] = React.useState('');
  const [verifyingMsg, setVerifyingMsg] = React.useState('');
  const [verifyingError, setVerifyingError] = React.useState('');
  const [docFile, setDocFile] = React.useState<File | null>(null);
  const [submittingVerification, setSubmittingVerification] = React.useState(false);

  React.useEffect(() => {
    if (currentUser) {
      setPhoneInput(currentUser.phone || '');
      setEmailInput(currentUser.email || '');
    }
  }, [currentUser]);

  if (!isOpen) return null;

  const isDark = theme === 'dark';

  const handleSavePhone = () => {
    if (!/^(07\d{8}|254\d{7})$/.test(phoneInput)) {
      setPhoneError('Phone exactly 10 digits starting with 254/07');
      return;
    }
    setPhoneError('');
    setIsEditingPhone(false);
    
    if (currentUser && onUpdateUser) {
      const users = JSON.parse(localStorage.getItem('lwex_users') || '[]');
      const updatedUsers = users.map((u: any) => {
          if (u.email === currentUser.email) {
              return { ...u, phone: phoneInput };
          }
          return u;
      });
      localStorage.setItem('lwex_users', JSON.stringify(updatedUsers));
      onUpdateUser({ ...currentUser, phone: phoneInput });
    }
  };

  const handleSaveEmail = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
      setEmailError('Please enter a valid email address');
      return;
    }
    setEmailError('');
    setIsEditingEmail(false);
    
    if (currentUser && onUpdateUser) {
      const users = JSON.parse(localStorage.getItem('lwex_users') || '[]');
      const updatedUsers = users.map((u: any) => {
          if (u.email === currentUser.email) {
              return { ...u, email: emailInput };
          }
          return u;
      });
      localStorage.setItem('lwex_users', JSON.stringify(updatedUsers));
      onUpdateUser({ ...currentUser, email: emailInput });
    }
  };

  const handleSubmitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docNum.trim()) {
      setVerifyingError('Document number or ID number is required.');
      return;
    }
    setVerifyingError('');
    setVerifyingMsg('');
    setSubmittingVerification(true);

    try {
      const response = await fetch('/api/users/submit-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentUser?.id}`
        },
        body: JSON.stringify({
          documentType: docType,
          documentNumber: docNum
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Verification submission failed.');
      }

      setVerifyingMsg(data.message || 'Documents submitted successfully!');
      
      if (currentUser && onUpdateUser) {
        onUpdateUser({
          ...currentUser,
          verificationStatus: 'pending'
        });
      }
    } catch (err: any) {
      setVerifyingError(err.message || 'Network error submitting documents.');
    } finally {
      setSubmittingVerification(false);
    }
  };



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 transition-all backdrop-blur-sm">
      <div className={`w-full max-w-lg rounded-2xl border p-0 shadow-2xl relative overflow-hidden flex flex-col ${
        isDark ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-gray-150 text-black'
      }`}>
        
        {/* Header */}
        <div className={`p-6 flex items-center justify-between border-b ${isDark ? 'border-zinc-800 bg-zinc-900/50' : 'border-gray-100 bg-gray-50'}`}>
          <div className="flex items-center space-x-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${isDark ? 'bg-zinc-800 shadow-inner' : 'bg-white shadow-sm border border-gray-100'}`}>
              <SettingsIcon className={`h-5 w-5 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`} />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">Personal Settings</h2>
              <p className="text-[10px] text-gray-500 font-mono uppercase font-bold tracking-widest">User Profile & Node Security</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`rounded-full h-8 w-8 flex items-center justify-center transition-colors cursor-pointer ${
              isDark ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white' : 'bg-white text-gray-400 hover:bg-gray-100 hover:text-black border border-gray-100'
            }`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[80vh]">
          {/* Tabs */}
          <div className="flex space-x-2 border-b border-zinc-800 pb-2">
            <button onClick={() => setActiveSettingsTab('profile')} className={`text-xs font-bold px-3 py-1 rounded ${activeSettingsTab === 'profile' ? 'bg-indigo-600 text-white' : 'text-zinc-500'}`}>Profile</button>
            <button onClick={() => setActiveSettingsTab('notifications')} className={`text-xs font-bold px-3 py-1 rounded ${activeSettingsTab === 'notifications' ? 'bg-indigo-600 text-white' : 'text-zinc-500'}`}>Notifications</button>
            {isAdmin && <button onClick={() => setActiveSettingsTab('admin')} className={`text-xs font-bold px-3 py-1 rounded ${activeSettingsTab === 'admin' ? 'bg-indigo-600 text-white' : 'text-zinc-500'}`}>Admin</button>}
          </div>

          {activeSettingsTab === 'notifications' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">Trade Settlement Notifications</span>
                <input type="checkbox" checked={tradeSettlement} onChange={(e) => { setTradeSettlement(e.target.checked); saveNotifSettings(); }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Balance Update Notifications</span>
                <input type="checkbox" checked={balanceUpdate} onChange={(e) => { setBalanceUpdate(e.target.checked); saveNotifSettings(); }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Promotion Notifications</span>
                <input type="checkbox" checked={promotion} onChange={(e) => { setPromotion(e.target.checked); saveNotifSettings(); }} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Broadcast Frequency</label>
                <select value={broadcastFrequency} onChange={(e) => { setBroadcastFrequency(e.target.value); saveNotifSettings(); }} className="w-full p-2 bg-zinc-800 rounded">
                  <option value="realtime">Realtime</option>
                  <option value="30m">Every 30m</option>
                  <option value="1h">Every 1h</option>
                </select>
              </div>
            </div>
          ) : activeSettingsTab === 'admin' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">Enable Demo Mode</span>
                <input type="checkbox" checked={demoModeEnabled} onChange={(e) => saveAdminSettings(e.target.checked, realModeEnabled)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Enable Real Mode</span>
                <input type="checkbox" checked={realModeEnabled} onChange={(e) => saveAdminSettings(demoModeEnabled, e.target.checked)} />
              </div>
            </div>
          ) : (
            <>
              {/* User Identity Card */}
              <div className={`rounded-xl p-5 border ${isDark ? 'bg-zinc-900/40 border-zinc-800' : 'bg-gray-50/50 border-gray-100'}`}>
                <div className="flex items-center space-x-4">
                  <div className="h-14 w-14 rounded-full bg-black flex items-center justify-center text-white text-xl font-black">
                    {account.mode === 'demo' ? 'D' : 'R'}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm">{currentUser?.email || 'LWEX Client'}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide border ${
                        account.mode === 'real' 
                          ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' 
                          : 'bg-green-500/10 text-green-500 border-green-500/20'
                      }`}>
                        {account.mode === 'real' ? 'Verified Live' : 'Demo Node'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 font-mono mt-0.5">{currentUser ? 'Logged In' : 'CR198273645'}</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* User Details Settings */}
          {currentUser && (
            <div className="space-y-3">
              {/* Email Section */}
              <div className={`p-4 rounded-xl border ${isDark ? 'bg-zinc-900/20 border-zinc-800' : 'bg-white border-gray-100'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 text-sm">
                    <Mail className={`h-4 w-4 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`} />
                    {isEditingEmail ? (
                      <div className="flex flex-col space-y-2">
                         <input
                           type="email"
                           value={emailInput}
                           onChange={(e) => setEmailInput(e.target.value)}
                           className={`rounded px-2 py-1 text-xs border focus:outline-none focus:ring-1 focus:ring-yellow-500 ${
                             isDark ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-gray-50 border-gray-200 text-black'
                           }`}
                         />
                         {emailError && <span className="text-[10px] text-red-500">{emailError}</span>}
                      </div>
                    ) : (
                      <span className="font-bold tracking-tight">{currentUser.email}</span>
                    )}
                  </div>
                  <div>
                    {isEditingEmail ? (
                      <button 
                        onClick={handleSaveEmail}
                        className="p-1.5 rounded-md bg-green-500 text-white hover:bg-green-600 transition-colors"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    ) : (
                      <button 
                        onClick={() => {
                          setEmailInput(currentUser.email);
                          setIsEditingEmail(true);
                        }}
                        className={`p-1.5 rounded-md transition-colors ${
                          isDark ? 'bg-zinc-800 text-zinc-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-black'
                        }`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className={`p-4 rounded-xl border ${isDark ? 'bg-zinc-900/20 border-zinc-800' : 'bg-white border-gray-100'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 text-sm">
                    <PhoneIcon className={`h-4 w-4 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`} />
                    {isEditingPhone ? (
                      <div className="flex flex-col space-y-2">
                         <input
                           type="text"
                           value={phoneInput}
                           onChange={(e) => setPhoneInput(e.target.value)}
                           className={`rounded px-2 py-1 text-xs border focus:outline-none focus:ring-1 focus:ring-yellow-500 ${
                             isDark ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-gray-50 border-gray-200 text-black'
                           }`}
                         />
                         {phoneError && <span className="text-[10px] text-red-500">{phoneError}</span>}
                      </div>
                    ) : (
                      <span className="font-bold font-mono tracking-wide">{currentUser.phone}</span>
                    )}
                  </div>
                  <div>
                    {isEditingPhone ? (
                      <button 
                        onClick={handleSavePhone}
                        className="p-1.5 rounded-md bg-green-500 text-white hover:bg-green-600 transition-colors"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    ) : (
                      <button 
                        onClick={() => {
                          setPhoneInput(currentUser.phone);
                          setIsEditingPhone(true);
                        }}
                        className={`p-1.5 rounded-md transition-colors ${
                          isDark ? 'bg-zinc-800 text-zinc-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-black'
                        }`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>


            </div>
          )}

          {/* Document Verification & Withdraw Unlock Progress */}
          {currentUser && (
            <div className={`p-5 rounded-xl border space-y-4 ${
              isDark ? 'bg-zinc-900/30 border-zinc-800' : 'bg-gray-50 border-gray-150'
            }`}>
              <div className="flex items-center justify-between border-b pb-2.5 border-slate-900/10 dark:border-zinc-800">
                <div className="flex items-center space-x-2 text-sm font-bold animate-pulse-slow">
                  <FileText className="h-4 w-4 text-amber-500" />
                  <span>Document Verification & Registration Bonus</span>
                </div>
                <div>
                  {currentUser.verificationStatus === 'verified' && (
                    <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Approved
                    </span>
                  )}
                  {currentUser.verificationStatus === 'pending' && (
                    <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                      Pending Review
                    </span>
                  )}
                  {currentUser.verificationStatus === 'rejected' && (
                    <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                      Rejected
                    </span>
                  )}
                  {(currentUser.verificationStatus === 'unverified' || !currentUser.verificationStatus) && (
                    <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                      Unverified
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Indicator if Verified */}
              {currentUser.verificationStatus === 'verified' ? (
                <div className="space-y-3.5">
                  <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-extrabold flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      Congratulations! Your documents have been successfully verified.
                    </p>
                    <p className="text-[10px] text-gray-400 mt-1">
                      A free <strong>$20.00 Registration Bonus</strong> has been credited to your real account! Plus, you qualify for a <strong>50% First Deposit Match Bonus</strong>!
                    </p>
                  </div>

                  {/* Progressive Withdrawal Trade Count Monitor */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-gray-400 font-bold uppercase tracking-wider text-[9px]">
                        Bonus Withdrawal Unlock Progress
                      </span>
                      <span className="font-mono text-amber-500 font-extrabold text-xs">
                        {Math.min(tradeHistory.filter((t: any) => t.status === 'won').length, 10)} / 10 Trades
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden border border-zinc-700/50">
                      <div 
                        className="bg-gradient-to-r from-amber-500 to-yellow-400 h-full transition-all duration-500"
                        style={{ width: `${Math.min((tradeHistory.filter((t: any) => t.status === 'won').length / 10) * 100, 100)}%` }}
                      ></div>
                    </div>

                    <div className="flex items-start gap-1.5 p-2.5 rounded bg-amber-500/5 border border-amber-500/10">
                      <Lock className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-[9px] text-gray-500 leading-normal">
                        {tradeHistory.filter((t: any) => t.status === 'won').length >= 10 ? (
                          <span className="text-emerald-400 font-bold">🎉 Unlock condition has been met! Your balance and bonuses are fully withdrawable.</span>
                        ) : (
                          <span>To unlock withdrawability for your registration bonus and first deposit match, you must complete <strong>10 successful trades (natural winnings without early cashout)</strong> in Real Mode. ({10 - Math.min(tradeHistory.filter((t: any) => t.status === 'won').length, 10)} wins left)</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              ) : currentUser.verificationStatus === 'pending' ? (
                <div className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/15 space-y-2">
                  <div className="flex items-center space-x-2 text-amber-500 font-bold text-xs">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                    <span>Identity Verification Pending Review</span>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-relaxed font-sans">
                    The security department is actively auditing your passport or national identification details. This automated audit usually takes 10-15 minutes. Once approved, your free registration bonus will be credited!
                  </p>
                </div>
              ) : (
                /* Submission Form */
                <form onSubmit={handleSubmitVerification} className="space-y-3.5">
                  <p className="text-[11px] text-gray-400 leading-normal">
                    Submit registration documents to receive a <strong>$20 Free Bonus</strong> credited instantly upon approval + <strong>50% First Deposit Match Bonus</strong>!
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Document Type</label>
                      <select
                        value={docType}
                        onChange={(e) => setDocType(e.target.value)}
                        className={`w-full text-xs rounded px-2.5 py-1.5 border focus:outline-none focus:ring-1 focus:ring-yellow-500 ${
                          isDark ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-gray-250 text-black'
                        }`}
                      >
                        <option value="National ID">National ID / I-Card</option>
                        <option value="International Passport">International Passport</option>
                        <option value="Drivers License">Driver's License</option>
                        <option value="Proof of Address">Proof of Address / Utility</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-gray-400">ID / Serial Number</label>
                      <input
                        type="text"
                        placeholder="e.g. A3849102X"
                        value={docNum}
                        onChange={(e) => setDocNum(e.target.value)}
                        className={`w-full text-xs rounded px-2.5 py-1.5 border focus:outline-none focus:ring-1 focus:ring-yellow-500 ${
                          isDark ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-gray-250 text-black'
                        }`}
                        required
                      />
                    </div>
                  </div>

                  {/* Drag and Drop Box wrapper */}
                  <div className={`border border-dashed p-4 rounded-xl text-center space-y-1.5 cursor-pointer relative ${
                    isDark ? 'border-zinc-850 bg-zinc-900/10 hover:bg-zinc-900/20' : 'border-gray-200 bg-gray-50/50 hover:bg-gray-50'
                  }`}>
                    <input 
                      type="file" 
                      accept="image/*,.pdf" 
                      onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 opacity-0 cursor-pointer text-[0px]" 
                    />
                    <FileText className="h-5 w-5 text-gray-400 mx-auto" strokeWidth={1.5} />
                    <p className="text-[10px] font-bold text-slate-300">
                      {docFile ? `Selected: ${docFile.name}` : "Upload clean image of ID (Front & Back)"}
                    </p>
                    <p className="text-[8px] text-gray-500">Supports PDF, PNG & JPEG formats up to 10MB.</p>
                  </div>

                  {/* Success / Error Messages */}
                  {verifyingMsg && (
                    <div className="flex items-center gap-1.5 text-[10px] text-emerald-500 font-bold bg-emerald-500/5 p-2 rounded border border-emerald-500/10">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{verifyingMsg}</span>
                    </div>
                  )}
                  {verifyingError && (
                    <div className="flex items-center gap-1.5 text-[10px] text-rose-500 font-bold bg-rose-500/5 p-2 rounded border border-rose-500/10">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span>{verifyingError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submittingVerification}
                    className="w-full text-xs text-center font-bold bg-amber-500 hover:bg-amber-650 disabled:opacity-50 text-zinc-950 py-2 rounded-lg cursor-pointer transition-all active:scale-95 flex items-center justify-center gap-1.5"
                  >
                    {submittingVerification ? "Uploading & Auditing..." : "Submit Registration Docs"}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Account Details Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className={`p-4 rounded-xl border ${isDark ? 'bg-zinc-900/20 border-zinc-800' : 'bg-white border-gray-100'}`}>
              <div className="flex items-center space-x-2 text-gray-400 mb-2">
                <CreditCard className="h-3.5 w-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Currency</span>
              </div>
              <p className="text-sm font-bold">USD - US Dollar</p>
            </div>
            <div className={`p-4 rounded-xl border ${isDark ? 'bg-zinc-900/20 border-zinc-800' : 'bg-white border-gray-100'}`}>
              <div className="flex items-center space-x-2 text-gray-400 mb-2">
                <Globe className="h-3.5 w-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Region</span>
              </div>
              <p className="text-sm font-bold">International (Global)</p>
            </div>
            <div className={`p-4 rounded-xl border ${isDark ? 'bg-zinc-900/20 border-zinc-800' : 'bg-white border-gray-100'}`}>
              <div className="flex items-center space-x-2 text-gray-400 mb-2">
                <Clock className="h-3.5 w-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Last Sync</span>
              </div>
              <p className="text-sm font-bold">Just Now</p>
            </div>
            <div className={`p-4 rounded-xl border ${isDark ? 'bg-zinc-900/20 border-zinc-800' : 'bg-white border-gray-100'}`}>
              <div className="flex items-center space-x-2 text-gray-400 mb-2">
                <Shield className="h-3.5 w-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Security</span>
              </div>
              <p className="text-sm font-bold">2FA Enabled</p>
            </div>
          </div>

          {/* Action List */}
          <div className="space-y-2">
            <button className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all text-sm font-bold ${
              isDark ? 'border-zinc-800 hover:bg-zinc-900' : 'border-gray-100 hover:bg-gray-50'
            }`}>
              <div className="flex items-center space-x-3">
                <User className="h-4 w-4 text-gray-400" />
                <span>Personal Information</span>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-300" />
            </button>
            
            {currentUser && (
              <button 
                onClick={() => {
                  if (onLogout) onLogout();
                  onClose();
                }}
                className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all text-sm font-bold hover:bg-red-50 hover:text-red-600 hover:border-red-100 group ${
                  isDark ? 'border-zinc-800 text-zinc-400' : 'border-gray-100 text-gray-500'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <LogOut className="h-4 w-4 text-gray-400 group-hover:text-red-500" />
                  <span>Logout Session</span>
                </div>
                <X className="h-4 w-4 text-gray-300 group-hover:text-red-400" />
              </button>
            )}
          </div>
        </div>

        <div className={`p-6 border-t ${isDark ? 'border-zinc-800' : 'border-gray-100'}`}>
          <p className="text-[10px] text-center text-gray-450 font-mono font-bold tracking-widest uppercase">
            LWEX Secure Node v2.0.4.stable
          </p>
        </div>
      </div>
    </div>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="m9 18 6-6-6-6"/>
    </svg>
  );
}
