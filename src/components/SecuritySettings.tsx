import React, { useState } from 'react';
import { Shield, Key, AlertTriangle, Check, Copy } from 'lucide-react';

interface SecuritySettingsProps {
  currentUser: any;
  isDark: boolean;
  onUpdateUser: (user: any) => void;
}

export default function SecuritySettings({ currentUser, isDark, onUpdateUser }: SecuritySettingsProps) {
  const [antiPhishingCode, setAntiPhishingCode] = useState(currentUser?.anti_phishing_code || '');
  const [twoFaQr, setTwoFaQr] = useState('');
  const [twoFaSecret, setTwoFaSecret] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const saveAntiPhishing = async () => {
    try {
      const response = await fetch('/api/user/security/anti-phishing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser?.id}` },
        body: JSON.stringify({ antiPhishingCode })
      });
      if (response.ok) setMessage('Anti-phishing code updated!');
      else throw new Error('Failed to update.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const generate2Fa = async () => {
    try {
      const response = await fetch('/api/user/security/2fa/generate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentUser?.id}` }
      });
      const data = await response.json();
      if (data.success) {
        setTwoFaQr(data.qrCode);
        setTwoFaSecret(data.secret);
      } else throw new Error(data.message);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const verify2Fa = async () => {
    try {
      const response = await fetch('/api/user/security/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser?.id}` },
        body: JSON.stringify({ otp: otpInput })
      });
      const data = await response.json();
      if (data.success) {
        setMessage('2FA enabled successfully!');
        onUpdateUser({ ...currentUser, two_factor_enabled: 1 });
      } else throw new Error(data.message);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className={`p-4 rounded-xl border ${isDark ? 'bg-zinc-900/40 border-zinc-800' : 'bg-gray-50 border-gray-100'}`}>
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Anti-Phishing Code</h3>
        <p className="text-xs text-gray-500 mb-3">This code will appear in all official emails from LWEX.</p>
        <div className="flex gap-2">
          <input type="text" value={antiPhishingCode} onChange={(e) => setAntiPhishingCode(e.target.value)} className={`flex-1 p-2 rounded text-xs ${isDark ? 'bg-zinc-800' : 'bg-white'}`} placeholder="Enter unique phrase" />
          <button onClick={saveAntiPhishing} className="bg-indigo-600 text-white px-3 py-1 rounded text-xs font-bold">Save</button>
        </div>
      </div>

      <div className={`p-4 rounded-xl border ${isDark ? 'bg-zinc-900/40 border-zinc-800' : 'bg-gray-50 border-gray-100'}`}>
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Shield className="h-4 w-4 text-emerald-500" /> Two-Factor Authentication (2FA)</h3>
        {currentUser?.two_factor_enabled ? (
          <p className="text-xs text-emerald-500">2FA is enabled.</p>
        ) : (
          <>
            {!twoFaQr ? (
              <button onClick={generate2Fa} className="bg-indigo-600 text-white px-3 py-1 rounded text-xs font-bold">Setup 2FA</button>
            ) : (
              <div className="space-y-3">
                <img src={twoFaQr} alt="2FA QR Code" className="w-32 h-32" />
                <p className="text-xs font-mono text-gray-400">Secret: {twoFaSecret} <Copy className="inline h-3 w-3 cursor-pointer" /></p>
                <input type="text" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} className={`w-full p-2 rounded text-xs ${isDark ? 'bg-zinc-800' : 'bg-white'}`} placeholder="Enter OTP" />
                <button onClick={verify2Fa} className="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold w-full">Verify & Enable</button>
              </div>
            )}
          </>
        )}
      </div>
      
      {message && <p className="text-xs text-emerald-500 font-bold">{message}</p>}
      {error && <p className="text-xs text-red-500 font-bold">{error}</p>}
    </div>
  );
}
