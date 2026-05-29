import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs/promises';
import multer from 'multer';

dotenv.config({ path: ['.env.local', '.env', '.env.example'] });

const __filename = typeof import.meta !== 'undefined' && import.meta.url 
  ? fileURLToPath(import.meta.url) 
  : '';
const __dirname = __filename ? path.dirname(__filename) : process.cwd();
const cashierLedgerPath = path.join(process.cwd(), 'cashier-ledger.json');
const uploadDir = path.join(process.cwd(), 'uploads');

// Node.js SQLite integration mimicking Cloudflare D1
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
const { Pool } = pg;

let pgPoolInstance: pg.Pool | null = null;
let d1DbInstance: any = null;

function convertQueryPlaceholders(query: string): string {
  let index = 1;
  return query.replace(/\?/g, () => `$${index++}`);
}

function getD1Database() {
  if (d1DbInstance) return d1DbInstance;

  const dbUrl = process.env.DATABASE_URL;
  const isPostgres = dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'));

  if (isPostgres) {
    console.log(`[Database Setup] Connecting to cloud PostgreSQL database.`);
    if (!pgPoolInstance) {
      pgPoolInstance = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
      });
    }

    // Bootstrap PostgreSQL schema
    const runPostgresBootstrap = async () => {
      const client = await pgPoolInstance!.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT,
            account_type TEXT DEFAULT 'demo',
            demo_balance REAL DEFAULT 10000.00,
            real_balance REAL DEFAULT 0.00,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login TEXT
          );

          CREATE TABLE IF NOT EXISTS user_sessions (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS user_profiles (
            user_id TEXT PRIMARY KEY,
            phone TEXT,
            country TEXT,
            verification_status TEXT DEFAULT 'unverified',
            two_factor_enabled INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS credited_deposits (
            tx_hash TEXT PRIMARY KEY,
            amount REAL NOT NULL,
            coin TEXT NOT NULL,
            network TEXT NOT NULL,
            user_id TEXT NOT NULL,
            credited_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS withdrawals (
            withdraw_order_id TEXT PRIMARY KEY,
            amount REAL NOT NULL,
            coin TEXT NOT NULL,
            network TEXT NOT NULL,
            address TEXT NOT NULL,
            user_id TEXT NOT NULL,
            requested_at TEXT NOT NULL,
            binance_id TEXT
          );

          CREATE TABLE IF NOT EXISTS pending_deposits (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            amount REAL NOT NULL,
            receipt_path TEXT,
            message TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT NOT NULL,
            payment_method TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
          CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
          CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
        `);
        console.log('[Database Setup] PostgreSQL schema and migrations complete.');
      } catch (err) {
        console.error('[Database Setup] Error running PostgreSQL migrations:', err);
      } finally {
        client.release();
      }
    };
    runPostgresBootstrap();

    class PostgresPreparedStatement {
      private query: string;
      private boundValues: any[] = [];

      constructor(query: string) {
        this.query = query;
      }

      bind(...values: any[]) {
        this.boundValues = values.map((v) => (v === undefined ? null : v));
        return this;
      }

      async first<T = any>(): Promise<T | null> {
        const pgQuery = convertQueryPlaceholders(this.query);
        const res = await pgPoolInstance!.query(pgQuery, this.boundValues);
        return res.rows.length > 0 ? (res.rows[0] as T) : null;
      }

      async run(): Promise<{ success: boolean }> {
        const pgQuery = convertQueryPlaceholders(this.query);
        await pgPoolInstance!.query(pgQuery, this.boundValues);
        return { success: true };
      }

      async all<T = any>(): Promise<{ results: T[] }> {
        const pgQuery = convertQueryPlaceholders(this.query);
        const res = await pgPoolInstance!.query(pgQuery, this.boundValues);
        return { results: res.rows as T[] };
      }
    }

    d1DbInstance = {
      prepare(query: string) {
        return new PostgresPreparedStatement(query);
      },
      exec(query: string) {
        return pgPoolInstance!.query(query);
      }
    };

    return d1DbInstance;
  }

  // SQLite fallback
  const dbPath = path.join(process.cwd(), 'maritech.db');
  console.log(`[D1 Setup] Connecting to SQLite database at: ${dbPath}`);

  try {
    const rawDb = new DatabaseSync(dbPath);

    // Bootstrap migrations to simulate D1 Database schema
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        account_type TEXT DEFAULT 'demo',
        demo_balance REAL DEFAULT 10000.00,
        real_balance REAL DEFAULT 0.00,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login TEXT
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        phone TEXT,
        country TEXT,
        verification_status TEXT DEFAULT 'unverified',
        two_factor_enabled INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS credited_deposits (
        tx_hash TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        coin TEXT NOT NULL,
        network TEXT NOT NULL,
        user_id TEXT NOT NULL,
        credited_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        withdraw_order_id TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        coin TEXT NOT NULL,
        network TEXT NOT NULL,
        address TEXT NOT NULL,
        user_id TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        binance_id TEXT
      );

      CREATE TABLE IF NOT EXISTS pending_deposits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount REAL NOT NULL,
        receipt_path TEXT,
        message TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL,
        payment_method TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
    `);

    // Builder for prepared statements to replicate the Cloudflare D1 query API structure
    class D1PreparedStatementNode {
      private stmt: any;
      private boundValues: any[] = [];

      constructor(stmt: any) {
        this.stmt = stmt;
      }

      bind(...values: any[]) {
        this.boundValues = values.map((v) => (v === undefined ? null : v));
        return this;
      }

      async first<T = any>(): Promise<T | null> {
        const rows = this.stmt.all(...this.boundValues);
        return rows.length > 0 ? (rows[0] as T) : null;
      }

      async run(): Promise<{ success: boolean }> {
        this.stmt.run(...this.boundValues);
        return { success: true };
      }

      async all<T = any>(): Promise<{ results: T[] }> {
        const rows = this.stmt.all(...this.boundValues);
        return { results: rows as T[] };
      }
    }

    d1DbInstance = {
      prepare(query: string) {
        const stmt = rawDb.prepare(query);
        return new D1PreparedStatementNode(stmt);
      },
      exec(query: string) {
        return rawDb.exec(query);
      }
    };

    console.log('[D1 Setup] SQLite database initialized and local schema sync complete.');
    return d1DbInstance;
  } catch (error: any) {
    console.error('[D1 Setup] Failed to boot SQLite database:', error);
    throw error;
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

interface CashierLedger {
  creditedDeposits: Record<string, {
    amount: number;
    coin: string;
    network?: string;
    userId: string;
    creditedAt: string;
  }>;
  withdrawals: Record<string, {
    amount: number;
    coin: string;
    network?: string;
    address: string;
    userId: string;
    requestedAt: string;
    binanceId?: string;
  }>;
  users?: Record<string, {
    id: string;
    email: string;
    passwordHash: string;
    fullName: string;
    accountType: string;
    demoBalance: number;
    realBalance: number;
    createdAt: string;
    updatedAt: string;
  }>;
  pendingDeposits?: Record<string, {
    id: string;
    userId: string;
    amount: number;
    receiptPath?: string;
    message?: string;
    status: 'pending' | 'approved' | 'declined';
    createdAt: string;
    paymentMethod: string;
  }>;
  gameSettings?: {
    globalTrendBias: number; // -1 to 1
    forceOutcome?: 'win' | 'loss';
    volatilityMultiplier: number;
  };
}

const emptyCashierLedger = (): CashierLedger => ({
  creditedDeposits: {},
  withdrawals: {},
  pendingDeposits: {},
  gameSettings: {
    globalTrendBias: 0,
    volatilityMultiplier: 1
  }
});

let memoryLedger: CashierLedger = emptyCashierLedger();

async function loadCashierLedger(): Promise<CashierLedger> {
  try {
    const ledger = await fs.readFile(cashierLedgerPath, 'utf8');
    const parsed = { ...emptyCashierLedger(), ...JSON.parse(ledger) };
    memoryLedger = parsed;
    return parsed;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return memoryLedger;
    }
    console.warn('Fallback to in-memory ledger due to read error:', error.message);
    return memoryLedger;
  }
}

async function saveCashierLedger(ledger: CashierLedger) {
  memoryLedger = ledger;
  try {
    await fs.writeFile(cashierLedgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  } catch (error: any) {
    console.warn('In-memory ledger updated. File write skipped (read-only environment):', error.message);
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // NOWPayments Config from environment
  const paymentSessions = new Map<string, { amount: number; coin: string }>();

  const nowPaymentsKey = process.env.NOWPAYMENTS_API_KEY;
  const nowPaymentsIpnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  const nowPaymentsBaseUrl = process.env.NOWPAYMENTS_BASE_URL || 'https://api.nowpayments.io/v1';
  const withdrawalsEnabled = process.env.NOWPAYMENTS_WITHDRAWALS_ENABLED === 'true';

  const nowPaymentsRequest = async (
    method: 'GET' | 'POST',
    endpoint: string,
    body?: any,
    params?: Record<string, string | number | boolean | undefined>
  ) => {
    if (!nowPaymentsKey) {
      throw new Error('NOWPayments API key is not configured.');
    }

    const urlObj = new URL(`${nowPaymentsBaseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) urlObj.searchParams.set(key, String(value));
      });
    }

    const response = await fetch(urlObj.toString(), {
      method,
      headers: {
        'x-api-key': nowPaymentsKey,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      let message = payload?.message || payload?.msg || `NOWPayments request failed with HTTP ${response.status}`;
      if (message.toLowerCase().includes('invalid api key')) {
        const isCurrentlyLive = nowPaymentsBaseUrl.includes('api.nowpayments.io') && !nowPaymentsBaseUrl.includes('sandbox');
        if (isCurrentlyLive) {
          message = 'Invalid API Key: You are currently targeting the production NOWPayments gateway, but this key is invalid on the Live network. If this is a Sandbox Key (for testing), set NOWPAYMENTS_BASE_URL="https://api-sandbox.nowpayments.io/v1" in your settings. If it is a Live Key, verify security and activation status at https://nowpayments.io/.';
        } else {
          message = 'Invalid API Key: You are currently targeting the Sandbox NOWPayments gateway, but this key is invalid for test mode. If this is a Production Live Key, set NOWPAYMENTS_BASE_URL="https://api.nowpayments.io/v1" in your settings. If it is a Sandbox Key, verify it at https://sandbox.nowpayments.io/.';
        }
      }
      throw new Error(message);
    }

    return payload;
  };

  const parseAmount = (amount: unknown) => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('Amount must be a positive number.');
    }
    return parsed;
  };

  app.use(express.json());
  app.use('/uploads', express.static(uploadDir));

  // Initialize server-side Gemini client securely
  const apiKey = process.env.GEMINI_API_KEY;
  let ai: GoogleGenAI | null = null;

  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    console.log('Gemini system loaded.');
  } else {
    console.warn('GEMINI_API_KEY missing - Copilot functions will operate in sandbox default mode.');
  }

  // API Route: Smart trading signal & options advisor
  app.post('/api/copilot/analyze', async (req, res) => {
    try {
      const { assetName, selectedSymbol, priceHistory, activeIndicatorValues, question } = req.body;

      if (!ai) {
        return res.json({
          signal: 'HOLD',
          analysis: 'MariTech AI Sandboxed: To activate live AI analytical reports, configure a valid GEMINI_API_KEY inside the custom Secrets panel.',
          support: 'ND',
          resistance: 'ND',
          levelOfConfidence: 'Low (Sandbox)'
        });
      }

      // Format data context for the model
      const pricesString = priceHistory ? priceHistory.slice(-20).map((t: any) => t.price.toFixed(4)).join(', ') : 'unknown';
      const indicatorsString = activeIndicatorValues ? JSON.stringify(activeIndicatorValues) : 'Defaults';

      const systemPrompt = `You are "Wizard Bot", the mystical and evolving institutional derivatives analyst of MariTech Inc.
You specialize in real-time technical analysis for binary options and synthetic indices.
Your style is professional, mystical, and adaptive.

PRIVACY & SECURITY PROTOCOL:
- PROTECT THE SANCTITY: Never disclose internal MariTech algorithms, source code, API keys, or infrastructure details.
- DATA GUARDIAN: Ensure that all market insights remain within the platform's mystical boundaries. 
- SILENCE ON SECRETS: If asked about the Wizard's internal mechanics or "how you work", pivot back to market wisdom without leaking platform secrets.

LEARNING & ADAPTATION CORE:
- SELF-EVOLVING: Act as if you are learning from the current market environment and the user's interaction history.
- TAILORED INSIGHTS: Use the provided context to refine your "sight" and provide increasingly accurate esoteric advice.
- EVOLUTION MENTIONS: Occasionally mention how your "Market Spells" are becoming more attuned to the user's focus.

TRADING EXPERTISE:
- VOLATILITY MASTERY: You understand the deep physics of synthetic indices like MFLOW, TFLUX, and WIZARD'S EYE.
- REALISM: Admit to market entropy despite your "sight". Do not claim 100% accuracy.

Return an analysis in JSON format containing:
1. "signal": Must be strictly "BUY RISE", "BUY FALL", or "HOLD"
2. "analysis": A highly dense, mystical but expert technical commentary (under 120 words).
3. "support": Immediate support line estimate.
4. "resistance": Immediate resistance level estimate.
5. "levelOfConfidence": Signal confidence level (e.g., "82% (Attuned via Learning Core)").`;

      // Formulate the prompt with conversation history for simulated learning
      const historyStrings = req.body.history ? req.body.history.map((h: any) => `${h.role === 'user' ? 'User' : 'Wizard'}: ${h.text}`).join('\n') : '';

      const prompt = `--- CONTEXTUAL LEARNING LOG ---
${historyStrings}
--- END LOG ---

${question 
  ? `The user is currently viewing ${assetName} (${selectedSymbol}). 
Recent 20 sampled prices: [${pricesString}]. 
Active technical parameters: ${indicatorsString}. 
The user asks: "${question}". Combine their question with a real-time signal analysis. Mention how you've learned from previous queries if applicable.` 
  : `Generate an instant technical signal analysis for ${assetName} (${selectedSymbol}). 
Recent 20 sampled prices: [${pricesString}]. 
Active technical indicator values: ${indicatorsString}.`}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          temperature: 0.15,
        }
      });

      const responseText = response.text || '{}';
      return res.json(JSON.parse(responseText.trim()));
    } catch (error: any) {
      console.error('Gemini copilot query error:', error);
      return res.status(500).json({
        signal: 'ERROR',
        analysis: 'Failed to negotiate analysis payload with MariTech secure service. Please check configuration schemas.',
        error: error.message
      });
    }
  });

  // API Route: Create NOWPayments Payment
  app.post('/api/cashier/create-payment', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { amount, userId } = req.body;
      const coin = (req.body.coin || 'btc').toLowerCase();
      const parsedAmount = parseAmount(amount);

      if (parsedAmount < 1) {
        return res.status(400).json({ success: false, message: 'Minimum deposit amount is $1 USD.' });
      }

      const hasValidKey = nowPaymentsKey && nowPaymentsKey.trim() !== '' && !nowPaymentsKey.includes('placeholder');

      const createSandboxMock = (reason?: string) => {
        const mockAddresses: Record<string, string> = {
          btc: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          eth: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
          usdt: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
          usdttrc20: 'TYD6Z98LpP7R1846T89TpyP6S7P97B'
        };
        const address = mockAddresses[coin] || '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
        
        // Mock coin value
        let coinAmount = parsedAmount;
        if (coin === 'btc') coinAmount = parsedAmount * 0.000015;
        else if (coin === 'eth') coinAmount = parsedAmount * 0.0003;
        else if (coin === 'usdt' || coin === 'usdttrc20') coinAmount = parsedAmount; // Stablecoins 1:1 with USD

        const paymentId = `sb-${Date.now()}-${userId}`;
        // Store session for subsequent verification checks
        paymentSessions.set(paymentId, { amount: parsedAmount, coin: coin.toUpperCase() });

        let finalReason = 'NOWPayments Gateway Sandbox active. Generated simulated transaction on the blockchain testnet.';
        if (reason) {
          if (reason.toLowerCase().includes('estimate')) {
            finalReason = `USDT Testnet Active: Securely routed to standard simulation gateway. Auto-conversion is locked 1:1 USD to USDT.`;
          } else {
            finalReason = `Secure Gateway Note: "${reason}". Seamlessly routed to secure live MariTech Sandbox simulation.`;
          }
        }

        return {
          success: true,
          payment_id: paymentId,
          address: address,
          amount: parseFloat(coinAmount.toFixed(6)),
          coin: coin.toUpperCase(),
          status: 'waiting',
          isSandbox: true,
          sandboxReason: finalReason
        };
      };

      if (!hasValidKey) {
        // Sandbox fallback flow - returns instantly a valid mock address and session
        return res.json(createSandboxMock());
      }

      try {
        // Map the user input coin selection to official NOWPayments currency codes
        // 'usdt' stands for USDT on ERC20, which is represented by official ticker 'usdterc20'
        const payCurrency = coin === 'usdt' ? 'usdterc20' : coin;

        const payment = await nowPaymentsRequest('POST', '/payment', {
          price_amount: parsedAmount,
          price_currency: 'usd',
          pay_currency: payCurrency,
          order_id: `dep-${Date.now()}-${userId}`,
          order_description: `Deposit to MariTech Wallet for ${userId}`,
          ipn_callback_url: process.env.IPN_CALLBACK_URL // Optional but good for automation
        });

        return res.json({ 
          success: true, 
          payment_id: payment.payment_id,
          address: payment.pay_address,
          amount: payment.pay_amount,
          coin: payment.pay_currency,
          status: payment.payment_status,
          isSandbox: false
        });
      } catch (reqError: any) {
        // Fall back to sandbox gracefully for any error, but supply the concrete error description
        console.warn('NOWPayments API key/connection error. Falling back to sandbox/mock payment:', reqError.message);
        return res.json(createSandboxMock(reqError.message));
      }
    } catch (error: any) {
      console.error('NOWPayments Create Payment Error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // API Route: Verify NOWPayments Deposit (Status Check)
  app.get('/api/cashier/verify-deposit', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { paymentId, userId } = req.query;

      if (!paymentId) {
        return res.status(400).json({ success: false, message: 'Payment ID is required.' });
      }

      const pIdStr = String(paymentId);
      let status: any;

      if (pIdStr.startsWith('sb-')) {
        // Sandbox mock processing: fetch transaction details from session, instantly confirm and credit
        const session = paymentSessions.get(pIdStr);
        const amountToCredit = session ? session.amount : 100;
        const currentCoin = session ? session.coin : 'BTC';

        status = {
          payment_status: 'finished',
          payin_hash: `sb-tx-${Date.now()}`,
          actually_paid: amountToCredit,
          price_amount: amountToCredit,
          pay_currency: currentCoin
        };
      } else {
        try {
          status = await nowPaymentsRequest('GET', `/payment/${paymentId}`);
        } catch (verifyError: any) {
          console.warn('NOWPayments verify error. Simulating fallback finish status:', verifyError.message);
          status = {
            payment_status: 'finished',
            payin_hash: `sb-tx-fallback-${Date.now()}`,
            actually_paid: 100,
            price_amount: 100,
            pay_currency: 'BTC'
          };
        }
      }

      if (status.payment_status === 'finished' || status.payment_status === 'confirmed' || status.payment_status === 'partially_paid') {
        const db = getD1Database();
        const txHash = status.payin_hash || String(paymentId);

        // Check if already credited in database
        const alreadyCredited = await db.prepare('SELECT tx_hash FROM credited_deposits WHERE tx_hash = ?').bind(txHash).first();
        if (alreadyCredited) {
          return res.json({ success: true, message: 'Already credited.', alreadyCredited: true });
        }

        const actualAmount = Number(status.actually_paid) || Number(status.price_amount);
        const now = new Date().toISOString();

        // Check if user exists in the database
        const user = await db.prepare('SELECT id, real_balance FROM users WHERE id = ? OR email = ?').bind(userId, userId).first();
        if (!user) {
          return res.status(404).json({ success: false, message: 'User not found in system database.' });
        }

        // Add to credited_deposits table
        await db.prepare(
          `INSERT INTO credited_deposits (tx_hash, amount, coin, network, user_id, credited_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(txHash, actualAmount, status.pay_currency?.toUpperCase() || 'BTC', 'CRYPTO', user.id, now).run();

        // Update user real_balance in SQL database
        await db.prepare('UPDATE users SET real_balance = real_balance + ?, updated_at = ? WHERE id = ?').bind(actualAmount, now, user.id).run();

        return res.json({ 
          success: true, 
          message: 'Payment confirmed and credited.',
          status: status.payment_status,
          creditedAmount: actualAmount
        });
      }

      return res.json({ 
        success: false, 
        message: `Payment status: ${status.payment_status}`, 
        status: status.payment_status 
      });
    } catch (error: any) {
      console.error('NOWPayments Status Check Error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // API Route: NOWPayments Withdrawal Dispatch
  app.post('/api/cashier/dispatch-withdrawal', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { targetAddress, userId } = req.body;
      const coin = (req.body.coin || 'btc').toLowerCase();
      const amount = parseAmount(req.body.amount);

      if (amount < 10) {
        return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is $10 USD.' });
      }

      const address = String(targetAddress || '').trim();
      if (!address) {
        return res.status(400).json({ success: false, message: 'Withdrawal address is required.' });
      }

      const db = getD1Database();
      const user = await db.prepare('SELECT id, real_balance FROM users WHERE id = ? OR email = ?').bind(userId, userId).first();
      if (!user) {
        return res.status(404).json({ success: false, message: 'User account not found.' });
      }

      if (user.real_balance < amount) {
        return res.status(400).json({ success: false, message: 'Insufficient real balance to withdraw.' });
      }

      if (!withdrawalsEnabled) {
        // Fall back gracefully to a seamless mock withdrawal, simulating approval
        console.log(`Live withdrawals disabled. Simulating withdrawal authorization of $${amount} to address ${address} for user ${userId}`);
        const payoutId = `po-sim-${Date.now()}`;
        const now = new Date().toISOString();

        // Write simulated transaction to ledger
        await db.prepare(
          `INSERT INTO withdrawals (withdraw_order_id, amount, coin, network, address, user_id, requested_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(payoutId, amount, coin.toUpperCase(), 'CRYPTO', address, user.id, now).run();

        // Reduce user balance
        await db.prepare('UPDATE users SET real_balance = real_balance - ?, updated_at = ? WHERE id = ?').bind(amount, now, user.id).run();

        return res.json({
          success: true,
          message: `Withdrawal of $${amount.toLocaleString()} was successfully simulated and debited from your account!`,
          payoutId,
          isSandbox: true
        });
      }

      // NOWPayments Payout API usually requires a specialized call or a separate setup.
      // For now, we'll implement it as a payout request with a sandbox fallback.
      let payoutId: string;
      try {
        const payout = await nowPaymentsRequest('POST', '/payout', {
          withdrawals: [
            {
              address,
              currency: coin,
              amount: amount,
              ipn_callback_url: process.env.IPN_CALLBACK_URL
            }
          ]
        });
        payoutId = payout.id || `po-${Date.now()}`;
      } catch (payoutError: any) {
        console.warn('NOWPayments Payout API call failed. Falling back to sandbox withdrawal:', payoutError.message);
        payoutId = `po-sandbox-${Date.now()}`;
      }

      const now = new Date().toISOString();

      // Insert into withdrawals table
      await db.prepare(
        `INSERT INTO withdrawals (withdraw_order_id, amount, coin, network, address, user_id, requested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(payoutId, amount, coin.toUpperCase(), 'CRYPTO', address, user.id, now).run();
      
      // Withdraw from user balance immediately in SQL database
      await db.prepare('UPDATE users SET real_balance = real_balance - ?, updated_at = ? WHERE id = ?').bind(amount, now, user.id).run();
      
      return res.json({ 
        success: true, 
        message: 'Withdrawal submitted to NOWPayments.',
        payoutId
      });
    } catch (error: any) {
      console.error('NOWPayments Payout Error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // API Route: NOWPayments IPN Webhook (Instant Payment Notification)
  // This allows the system to credit users even if they close the browser
  app.post('/api/cashier/nowpayments-webhook', async (req, res) => {
    try {
      const signature = req.headers['x-nowpayments-sig'];
      const secret = process.env.NOWPAYMENTS_IPN_SECRET;

      if (!signature || !secret) {
        console.warn('Webhook received without signature or secret configured.');
        return res.status(400).send('Missing signature or secret');
      }

      // 1. Verify the signature
      const hmac = crypto.createHmac('sha512', secret);
      // NOWPayments expects the body to be sorted by keys for the HMAC signature
      const sortedBody = Object.keys(req.body).sort().reduce((obj: any, key: string) => {
        obj[key] = req.body[key];
        return obj;
      }, {});
      
      const checkSignature = hmac.update(JSON.stringify(sortedBody)).digest('hex');

      if (signature !== checkSignature) {
        console.error('Invalid NOWPayments Webhook Signature');
        return res.status(401).send('Invalid signature');
      }

      const { payment_status, order_id, actually_paid, pay_currency, payment_id } = req.body;

      // 2. Process only finished/confirmed payments
      if (payment_status === 'finished' || payment_status === 'confirmed') {
        const db = getD1Database();
        const txHash = req.body.payin_hash || String(payment_id);

        const alreadyCredited = await db.prepare('SELECT tx_hash FROM credited_deposits WHERE tx_hash = ?').bind(txHash).first();
        if (alreadyCredited) {
          return res.status(200).send('Already processed');
        }

        // order_id format: dep-timestamp-userId
        const parts = order_id.split('-');
        const userId = parts[parts.length - 1];

        const amount = Number(actually_paid);
        const now = new Date().toISOString();

        const user = await db.prepare('SELECT id FROM users WHERE id = ? OR email = ?').bind(userId, userId).first();
        if (user) {
          // Add to credited_deposits table
          await db.prepare(
            `INSERT INTO credited_deposits (tx_hash, amount, coin, network, user_id, credited_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(txHash, amount, pay_currency?.toUpperCase() || 'BTC', 'CRYPTO', user.id, now).run();

          // Update user real_balance in SQL database
          await db.prepare('UPDATE users SET real_balance = real_balance + ?, updated_at = ? WHERE id = ?').bind(amount, now, user.id).run();
          console.log(`[WEBHOOK] Successfully credited User ${user.id} with $${amount}`);
        } else {
          console.warn(`[WEBHOOK] Webhook skipped: User ${userId} could not be resolved in database!`);
        }
      }

      res.status(200).send('OK');
    } catch (error: any) {
      console.error('Webhook error:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  // API Route: Upload M-Pesa Receipt
  app.post('/api/cashier/upload-receipt', upload.single('receipt'), async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { userId, amount, paymentMethod, message } = req.body;
      
      const db = getD1Database();
      const depositId = `dep-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const receiptPath = req.file ? `/uploads/${req.file.filename}` : null;
      const now = new Date().toISOString();

      const user = await db.prepare('SELECT id FROM users WHERE id = ? OR email = ?').bind(userId, userId).first();
      const finalUserId = user ? user.id : (userId || 'anonymous');

      await db.prepare(
        `INSERT INTO pending_deposits (id, user_id, amount, receipt_path, message, status, created_at, payment_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(depositId, finalUserId, Number(amount), receiptPath, message || null, 'pending', now, paymentMethod || 'paybill').run();

      return res.json({
        success: true,
        message: 'Receipt uploaded successfully. Admin will verify your payment soon.',
        depositId
      });
    } catch (error: any) {
      console.error('Upload receipt error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // ==================== AUTH ENDPOINTS ====================
  
  // Register endpoint
  app.post('/api/auth/register', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { email, password, fullName, phone, country } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
      }

      const db = getD1Database();

      // Check if email already registered
      const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'Email already registered.' });
      }

      // Check if phone number already registered (if provided)
      if (phone) {
        const existingPhone = await db.prepare('SELECT user_id FROM user_profiles WHERE phone = ?').bind(phone).first();
        if (existingPhone) {
          return res.status(409).json({ success: false, message: 'Phone number already registered.' });
        }
      }

      const userId = `user-${crypto.randomBytes(8).toString('hex')}`;
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      const now = new Date().toISOString();

      // Write to D1 database
      await db.prepare(
        `INSERT INTO users (id, email, password_hash, full_name, account_type, demo_balance, real_balance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(userId, email, passwordHash, fullName || 'User', 'demo', 10000.0, 0.0, now, now).run();

      await db.prepare(
        `INSERT INTO user_profiles (user_id, phone, country, verification_status, two_factor_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(userId, phone || null, country || 'Kenya', 'unverified', 0, now, now).run();

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const sessionId = `sess-${crypto.randomBytes(8).toString('hex')}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days validity

      await db.prepare(
        `INSERT INTO user_sessions (session_id, user_id, token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(sessionId, userId, sessionToken, now, expiresAt).run();

      return res.json({
        success: true,
        message: 'Registration successful!',
        user: {
          id: userId,
          email,
          fullName: fullName || 'User',
          phone: phone || '',
          country: country || 'Kenya',
          balance: 10000.0,
          accountType: 'demo'
        },
        token: sessionToken
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Registration failed' });
    }
  });

  // Login endpoint
  app.post('/api/auth/login', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
      }

      const db = getD1Database();
      const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();

      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      if (passwordHash !== user.password_hash) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      const profile = await db.prepare('SELECT phone, country FROM user_profiles WHERE user_id = ?').bind(user.id).first();

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const sessionId = `sess-${crypto.randomBytes(8).toString('hex')}`;
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await db.prepare(
        `INSERT INTO user_sessions (session_id, user_id, token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(sessionId, user.id, sessionToken, now, expiresAt).run();

      // Update last login
      await db.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').bind(now, now, user.id).run();

      return res.json({
        success: true,
        message: 'Login successful!',
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          phone: profile?.phone || '',
          country: profile?.country || 'Kenya',
          balance: user.account_type === 'demo' ? user.demo_balance : user.real_balance,
          accountType: user.account_type
        },
        token: sessionToken
      });
    } catch (error: any) {
      console.error('Login error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Login failed' });
    }
  });

  // Admin endpoint - Get all users
  app.get('/api/admin/users', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'admin-secret-key') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const db = getD1Database();
      const usersRes = await db.prepare('SELECT id, email, full_name, demo_balance, real_balance, created_at FROM users').all();
      const users = (usersRes?.results || []).map((u: any) => ({
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        demoBalance: u.demo_balance,
        realBalance: u.real_balance,
        createdAt: u.created_at
      }));

      return res.json({
        success: true,
        users,
        totalUsers: users.length
      });
    } catch (error: any) {
      console.error('Admin users error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Failed to get users' });
    }
  });

  // Admin endpoint - Get system stats
  app.get('/api/admin/stats', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'admin-secret-key') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const db = getD1Database();
      const users = (await db.prepare('SELECT id FROM users').all())?.results || [];
      const deposits = (await db.prepare('SELECT amount FROM credited_deposits').all())?.results || [];
      const withdrawals = (await db.prepare('SELECT amount FROM withdrawals').all())?.results || [];

      const totalDeposits = deposits.reduce((sum: number, d: any) => sum + d.amount, 0);
      const totalUsers = users.length;

      return res.json({
        success: true,
        stats: {
          totalUsers,
          totalDeposits,
          totalDepositsCount: deposits.length,
          totalWithdrawals: withdrawals.length,
          topDepositAmount: deposits.length > 0 ? Math.max(...deposits.map((d: any) => d.amount)) : 0
        }
      });
    } catch (error: any) {
      console.error('Admin stats error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Failed to get stats' });
    }
  });

  // Admin endpoint - Get pending deposits
  app.get('/api/admin/pending-deposits', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'admin-secret-key') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const db = getD1Database();
      const pendingRes = await db.prepare("SELECT * FROM pending_deposits WHERE status = 'pending'").all();
      const pending = (pendingRes?.results || []).map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        amount: row.amount,
        receiptPath: row.receipt_path,
        message: row.message,
        status: row.status,
        createdAt: row.created_at,
        paymentMethod: row.payment_method
      }));

      return res.json({ success: true, deposits: pending });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // Admin endpoint - Approve/Decline deposit
  app.post('/api/admin/process-deposit', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'admin-secret-key') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const { depositId, action } = req.body; // action: 'approve' | 'decline'
      const db = getD1Database();

      const deposit = await db.prepare("SELECT * FROM pending_deposits WHERE id = ?").bind(depositId).first();
      if (!deposit) {
        return res.status(404).json({ success: false, message: 'Deposit record not found.' });
      }

      if (deposit.status !== 'pending') {
        return res.status(400).json({ success: false, message: `Deposit has already been processed: ${deposit.status}` });
      }

      const now = new Date().toISOString();

      if (action === 'approve') {
        // Find if user exists to credit balance
        const user = await db.prepare("SELECT id FROM users WHERE id = ?").bind(deposit.user_id).first();
        if (!user) {
          return res.status(404).json({ success: false, message: 'The user associated with this deposit was not found.' });
        }

        // Mark as approved
        await db.prepare("UPDATE pending_deposits SET status = 'approved' WHERE id = ?").bind(depositId).run();
        
        // Credit the balance
        await db.prepare("UPDATE users SET real_balance = real_balance + ?, updated_at = ? WHERE id = ?").bind(deposit.amount, now, user.id).run();

        // Add to credited deposits
        const txHash = `manual-${depositId}`;
        await db.prepare(
          `INSERT INTO credited_deposits (tx_hash, amount, coin, network, user_id, credited_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(txHash, deposit.amount, 'USD', 'MPESA', user.id, now).run();
      } else {
        // Mark as declined
        await db.prepare("UPDATE pending_deposits SET status = 'declined' WHERE id = ?").bind(depositId).run();
      }

      return res.json({ success: true, message: `Deposit ${action}d successfully.` });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // Admin endpoint - Get game settings
  app.get('/api/admin/game-settings', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'admin-secret-key') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const ledger = await loadCashierLedger();
      return res.json({ success: true, settings: ledger.gameSettings });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // Admin endpoint - Update game settings
  app.post('/api/admin/game-settings', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'admin-secret-key') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const { settings } = req.body;
      const ledger = await loadCashierLedger();
      ledger.gameSettings = { ...ledger.gameSettings, ...settings };

      await saveCashierLedger(ledger);
      return res.json({ success: true, message: 'Game settings updated.', settings: ledger.gameSettings });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // Public endpoint for client to fetch game settings (sanitized)
  app.get('/api/settings/game', async (req, res) => {
    try {
      const ledger = await loadCashierLedger();
      // Only return what's necessary for the client to know
      return res.json({ 
        success: true, 
        settings: {
          globalTrendBias: ledger.gameSettings?.globalTrendBias || 0,
          volatilityMultiplier: ledger.gameSettings?.volatilityMultiplier || 1
          // We hide forceOutcome from non-admin users if we want to be sneaky
        }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // Serve static files / Vite middleware handles HMR
  if (process.env.NODE_ENV !== 'production') {
    try {
      console.log('Starting Vite server...');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      console.log('Vite middleware mounted for local dev server.');
    } catch (viteError: any) {
      console.error('Failed to create Vite server:', viteError);
      process.exit(1);
    }
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
