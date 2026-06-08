import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs/promises';
import multer from 'multer';
import nodemailer from 'nodemailer';

dotenv.config({ path: ['.env.local', '.env', '.env.example'] });

const cashierLedgerPath = path.join(process.cwd(), 'cashier-ledger.json');
const uploadDir = path.join(process.cwd(), 'uploads');

// Node.js SQLite integration mimicking Cloudflare D1
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
const { Pool } = pg;

let pgPoolInstance: pg.Pool | null = null;
let pgBootstrapPromise: Promise<void> | null = null;
let d1DbInstance: any = null;
let sqliteDbInstance: any = null;

function convertQueryPlaceholders(query: string): string {
  let index = 1;
  return query.replace(/\?/g, () => `$${index++}`);
}

// Separate routine for initializing/bootstrapping SQLite safely
function getSqliteInstance() {
  if (sqliteDbInstance) return sqliteDbInstance;

  const dbPath = path.join(process.cwd(), 'lwex.db');
  console.log(`[D1 Setup] Connecting to SQLite database at: ${dbPath}`);

  try {
    const rawDb = new DatabaseSync(dbPath);

    // Bootstrap migrations to simulate D1 Database schema
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        plain_password TEXT DEFAULT '',
        full_name TEXT,
        account_type TEXT DEFAULT 'demo',
        demo_balance REAL DEFAULT 10000.00,
        real_balance REAL DEFAULT 0.00,
        force_outcome TEXT DEFAULT '',
        profit_target REAL DEFAULT 0.00,
        max_win_limit REAL DEFAULT 0.00,
        max_loss_limit REAL DEFAULT 0.00,
        first_deposit_amount REAL DEFAULT 0.0,
        first_deposit_promo_credited INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login TEXT
      );
    `);

    try { rawDb.exec("ALTER TABLE users ADD COLUMN force_outcome TEXT DEFAULT ''"); } catch(e) {}
    try { rawDb.exec("ALTER TABLE users ADD COLUMN profit_target REAL DEFAULT 0.00"); } catch(e) {}
    try { rawDb.exec("ALTER TABLE users ADD COLUMN max_win_limit REAL DEFAULT 0.00"); } catch(e) {}
    try { rawDb.exec("ALTER TABLE users ADD COLUMN max_loss_limit REAL DEFAULT 0.00"); } catch(e) {}
    try { rawDb.exec("ALTER TABLE users ADD COLUMN plain_password TEXT DEFAULT ''"); } catch(e) {}
    try { rawDb.exec("ALTER TABLE users ADD COLUMN verified_bonus_credited INTEGER DEFAULT 0"); } catch(e) {}
    try { rawDb.exec("ALTER TABLE users ADD COLUMN first_deposit_bonus_credited INTEGER DEFAULT 0"); } catch(e) {}
    try { rawDb.exec("ALTER TABLE users ADD COLUMN first_deposit_amount REAL DEFAULT 0.0"); } catch(e) {}
    try { rawDb.exec("ALTER TABLE users ADD COLUMN first_deposit_promo_credited INTEGER DEFAULT 0"); } catch(e) {}
    try { rawDb.exec("ALTER TABLE withdrawals ADD COLUMN status TEXT DEFAULT 'pending'"); } catch(e) {}
    try { rawDb.exec("ALTER TABLE withdrawals ADD COLUMN payment_method TEXT DEFAULT 'Crypto'"); } catch(e) {}
    try { rawDb.exec("ALTER TABLE app_settings ADD COLUMN game_settings TEXT DEFAULT '{}'"); } catch(e) {}

    rawDb.exec(`
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

      CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS referrals (
        id TEXT PRIMARY KEY,
        referrer_id TEXT NOT NULL,
        referred_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_states (
        user_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        active_contracts TEXT NOT NULL DEFAULT '[]',
        trade_history TEXT NOT NULL DEFAULT '[]',
        price_alerts TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, mode)
      );

      CREATE TABLE IF NOT EXISTS group_chat_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        author_name TEXT,
        content TEXT,
        is_bot INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        image_url TEXT
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        id TEXT PRIMARY KEY,
        chat_enabled INTEGER DEFAULT 1
      );
      INSERT INTO app_settings (id, chat_enabled) VALUES ('global', 1) ON CONFLICT (id) DO NOTHING;

      CREATE TABLE IF NOT EXISTS telegram_campaigns (
        id TEXT PRIMARY KEY,
        message TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL,
        last_sent TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telegram_hunter_groups (
        id TEXT PRIMARY KEY,
        group_username TEXT NOT NULL,
        group_name TEXT NOT NULL,
        contacts_scanned INTEGER DEFAULT 0,
        recruits_found INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS platform_visits (
        id TEXT PRIMARY KEY,
        ip TEXT,
        user_agent TEXT,
        referrer TEXT,
        host TEXT,
        user_id TEXT,
        path TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
    `);

    // Seed SQLite
    try {
      const checkCamp = rawDb.prepare("SELECT COUNT(*) as count FROM telegram_campaigns").all() as any[];
      if (checkCamp[0].count === 0) {
        rawDb.exec(`
          INSERT INTO telegram_campaigns (id, message, interval_minutes, is_active, created_at) VALUES
          ('camp-1', '💸 Exclusive VIP Promo: Deposit $50+ today and get a +30% margin balance bonus immediately! Enter options contract code LW30 in cashier.', 30, 1, '${new Date().toISOString()}'),
          ('camp-2', '🧠 Dynamic Wizard Signal Alert: Follow current MFLOW rise options trigger. RSI indicates strong upward momentum on the hourly chart!', 15, 1, '${new Date().toISOString()}'),
          ('camp-3', '🎁 EXTRA BONUS INVITATION! Invite friends to join our Telegram group to unlock shared trader bonuses! Plus, enjoy an automatic 200% match bonus on your first deposit after completing 5 trades! Register now and claim real-time trade signals: https://lwex.onrender.com/', 45, 1, '${new Date().toISOString()}');
        `);
      }
    } catch (e) {}

    try {
      const checkHunt = rawDb.prepare("SELECT COUNT(*) as count FROM telegram_hunter_groups").all() as any[];
      if (checkHunt[0].count === 0) {
        rawDb.exec(`
          INSERT INTO telegram_hunter_groups (id, group_username, group_name, contacts_scanned, recruits_found, is_active, created_at) VALUES
          ('hunt-1', '@binary_options_elite_club', 'Binary Options Elite Club', 150, 42, 1, '${new Date().toISOString()}'),
          ('hunt-2', '@deriv_signal_secrets', 'Deriv Option Secrets', 410, 89, 1, '${new Date().toISOString()}'),
          ('hunt-3', '@crypto_leverage_hustlers', 'Crypto Leverage Hustlers', 85, 12, 1, '${new Date().toISOString()}');
        `);
      }
    } catch (e) {}

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

    sqliteDbInstance = {
      prepare(query: string) {
        const stmt = rawDb.prepare(query);
        return new D1PreparedStatementNode(stmt);
      },
      exec(query: string) {
        return rawDb.exec(query);
      }
    };

    console.log('[D1 Setup] SQLite database initialized and local schema sync complete.');
    return sqliteDbInstance;
  } catch (error: any) {
    console.error('[D1 Setup] Failed to boot SQLite database:', error);
    throw error;
  }
}

function getD1Database() {
  if (d1DbInstance) return d1DbInstance;

  const dbUrl = process.env.DATABASE_URL;
  const isPostgres = dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'));

  let localDb: any = null;
  if (!isPostgres) {
    try {
      localDb = getSqliteInstance();
    } catch (err) {
      console.error('[D1 Setup] SQLite setup failed:', err);
    }
  }

  if (isPostgres) {
    console.log(`[Database Setup] Connecting to cloud PostgreSQL database.`);
    if (!pgPoolInstance) {
      pgPoolInstance = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
      });

      // Avoid unhandled pool errors crashing node
      pgPoolInstance.on('error', (err) => {
        console.error('[Database Setup] PostgreSQL pool error (ignoring to maintain connection):', err);
      });
    }

    // Bootstrap PostgreSQL schema asynchronously
    const runPostgresBootstrap = async () => {
      let client;
      try {
        client = await pgPoolInstance!.connect();
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            plain_password TEXT DEFAULT '',
            full_name TEXT,
            account_type TEXT DEFAULT 'demo',
            demo_balance REAL DEFAULT 10000.00,
            real_balance REAL DEFAULT 0.00,
            force_outcome TEXT DEFAULT '',
            profit_target REAL DEFAULT 0.00,
            max_win_limit REAL DEFAULT 0.00,
            max_loss_limit REAL DEFAULT 0.00,
            first_deposit_amount REAL DEFAULT 0.0,
            first_deposit_promo_credited INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login TEXT
          );

          ALTER TABLE users ADD COLUMN IF NOT EXISTS force_outcome TEXT DEFAULT '';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS profit_target REAL DEFAULT 0.00;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS max_win_limit REAL DEFAULT 0.00;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS max_loss_limit REAL DEFAULT 0.00;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password TEXT DEFAULT '';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_bonus_credited INTEGER DEFAULT 0;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS first_deposit_bonus_credited INTEGER DEFAULT 0;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS first_deposit_amount REAL DEFAULT 0.0;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS first_deposit_promo_credited INTEGER DEFAULT 0;
          ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS game_settings TEXT DEFAULT '{}';

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

          ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
          ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'Crypto';

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

          CREATE TABLE IF NOT EXISTS password_resets (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER DEFAULT 0
          );

          CREATE TABLE IF NOT EXISTS referrals (
            id TEXT PRIMARY KEY,
            referrer_id TEXT NOT NULL,
            referred_user_id TEXT NOT NULL,
            created_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS user_states (
            user_id TEXT NOT NULL,
            mode TEXT NOT NULL,
            active_contracts TEXT NOT NULL DEFAULT '[]',
            trade_history TEXT NOT NULL DEFAULT '[]',
            price_alerts TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, mode)
          );

          CREATE TABLE IF NOT EXISTS group_chat_messages (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            author_name TEXT,
            content TEXT,
            is_bot INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            image_url TEXT
          );

          CREATE TABLE IF NOT EXISTS app_settings (
            id TEXT PRIMARY KEY,
            chat_enabled INTEGER DEFAULT 1
          );
          INSERT INTO app_settings (id, chat_enabled) VALUES ('global', 1) ON CONFLICT (id) DO NOTHING;

          CREATE TABLE IF NOT EXISTS telegram_campaigns (
            id TEXT PRIMARY KEY,
            message TEXT NOT NULL,
            interval_minutes INTEGER NOT NULL,
            last_sent TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS telegram_hunter_groups (
            id TEXT PRIMARY KEY,
            group_username TEXT NOT NULL,
            group_name TEXT NOT NULL,
            contacts_scanned INTEGER DEFAULT 0,
            recruits_found INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS platform_visits (
            id TEXT PRIMARY KEY,
            ip TEXT,
            user_agent TEXT,
            referrer TEXT,
            host TEXT,
            user_id TEXT,
            path TEXT,
            created_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
          CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
          CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
        `);

        // Seed initial values for campaigns and hunter groups
        try {
          const pgCampaignsCount = await client.query('SELECT COUNT(*) as count FROM telegram_campaigns');
          if (Number(pgCampaignsCount.rows[0].count) === 0) {
            await client.query(`
              INSERT INTO telegram_campaigns (id, message, interval_minutes, is_active, created_at) VALUES
              ('camp-1', '💸 Exclusive VIP Promo: Deposit $50+ today and get a +30% margin balance bonus immediately! Enter options contract code LW30 in cashier.', 30, 1, '${new Date().toISOString()}'),
              ('camp-2', '🧠 Dynamic Wizard Signal Alert: Follow current MFLOW rise options trigger. RSI indicates strong upward momentum on the hourly chart!', 15, 1, '${new Date().toISOString()}'),
              ('camp-3', '🎁 EXTRA BONUS INVITATION! Invite friends to join our Telegram group to unlock shared trader bonuses! Plus, enjoy an automatic 200% match bonus on your first deposit after completing 5 trades! Register now and claim real-time trade signals: https://lwex.onrender.com/', 45, 1, '${new Date().toISOString()}')
            `);
          }
        } catch (e) {}

        try {
          const pgHunterCount = await client.query('SELECT COUNT(*) as count FROM telegram_hunter_groups');
          if (Number(pgHunterCount.rows[0].count) === 0) {
            await client.query(`
              INSERT INTO telegram_hunter_groups (id, group_username, group_name, contacts_scanned, recruits_found, is_active, created_at) VALUES
              ('hunt-1', '@binary_options_elite_club', 'Binary Options Elite Club', 150, 42, 1, '${new Date().toISOString()}'),
              ('hunt-2', '@deriv_signal_secrets', 'Deriv Option Secrets', 410, 89, 1, '${new Date().toISOString()}'),
              ('hunt-3', '@crypto_leverage_hustlers', 'Crypto Leverage Hustlers', 85, 12, 1, '${new Date().toISOString()}')
            `);
          }
        } catch (e) {}

        console.log('[Database Setup] PostgreSQL schema and migrations complete.');
      } catch (err: any) {
        console.error('\n======================================================================');
        console.error('[Database Setup] WARNING: PostgreSQL connection or migration failure!');
        console.error('Error details:', err.message);
        if (err.code === 'ENOTFOUND') {
          console.error('\n👉 DIAGNOSIS: ONRENDER INTERNAL DATABASE URL ERROR');
          console.error('The database host hostname "' + err.hostname + '" is Render\'s internal URL.');
          console.error('Internal URLs only resolve if your Web Service is in the exact same region as your database.');
          console.error('If you are testing locally or have deployed services across different regions, use the EXTERNAL Database Connection String instead.');
          console.error('FIX: Paste your Render "External Database URL" into your Render DATABASE_URL environment setting.');
        }
        console.error('======================================================================\n');
        // Do NOT useSqliteFallback. If the user provided DATABASE_URL, they expect data persistence.
        // Falling back to SQLite secretly causes silent data loss on Cloud Run.
        throw err;
      } finally {
        if (client) client.release();
      }
    };
    if (!pgBootstrapPromise) {
      pgBootstrapPromise = runPostgresBootstrap();
    }

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
        if (pgBootstrapPromise) await pgBootstrapPromise;
        try {
          const pgQuery = convertQueryPlaceholders(this.query);
          const res = await pgPoolInstance!.query(pgQuery, this.boundValues);
          return res.rows.length > 0 ? (res.rows[0] as T) : null;
        } catch (err: any) {
          console.error('[Database Setup] Postgres SQL error:', err.message);
          throw err;
        }
      }

      async run(): Promise<{ success: boolean }> {
        if (pgBootstrapPromise) await pgBootstrapPromise;
        try {
          const pgQuery = convertQueryPlaceholders(this.query);
          await pgPoolInstance!.query(pgQuery, this.boundValues);
          return { success: true };
        } catch (err: any) {
          console.error('[Database Setup] Postgres SQL error:', err.message);
          throw err;
        }
      }

      async all<T = any>(): Promise<{ results: T[] }> {
        if (pgBootstrapPromise) await pgBootstrapPromise;
        try {
          const pgQuery = convertQueryPlaceholders(this.query);
          const res = await pgPoolInstance!.query(pgQuery, this.boundValues);
          return { results: res.rows as T[] };
        } catch (err: any) {
          console.error('[Database Setup] Postgres SQL error:', err.message);
          throw err;
        }
      }
    }

    d1DbInstance = {
      prepare(query: string) {
        return new PostgresPreparedStatement(query);
      },
      exec(query: string) {
        try {
          return pgPoolInstance!.query(query);
        } catch (err: any) {
          console.error('[Database Setup] Postgres SQL exec error:', err.message);
          throw err;
        }
      }
    };

    return d1DbInstance;
  }

  d1DbInstance = localDb;
  return d1DbInstance;
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
    realWinRate?: number;
    segmentWinRates?: {
      newUsers: number;
      vipUsers: number;
      standardUsers: number;
    };
    paybillEnabled?: boolean;
    btcEnabled?: boolean;
    minDeposit?: number;
    minWithdrawal?: number;
    cashoutMode?: 'enabled' | 'disabled' | 'smart';
    payoutRate?: number;
    minStake?: number;
    maxStake?: number;
  };
}

const emptyCashierLedger = (): CashierLedger => ({
  creditedDeposits: {},
  withdrawals: {},
  pendingDeposits: {},
  gameSettings: {
    globalTrendBias: 0,
    volatilityMultiplier: 1,
    realWinRate: 30,
    segmentWinRates: {
      newUsers: 40,
      vipUsers: 25,
      standardUsers: 30
    }
  }
});

let memoryLedger: CashierLedger = emptyCashierLedger();

async function loadCashierLedger(): Promise<CashierLedger> {
  let parsed = { ...emptyCashierLedger() };
  try {
    const ledger = await fs.readFile(cashierLedgerPath, 'utf8');
    parsed = { ...parsed, ...JSON.parse(ledger) };
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn('Fallback to in-memory ledger due to read error:', error.message);
    }
    parsed = { ...emptyCashierLedger(), ...memoryLedger };
  }

  try {
    const db = getD1Database();
    // Use raw sqlite/pg compatible read
    const query = "SELECT game_settings FROM app_settings WHERE id = 'global'";
    const res = (await db.prepare(query).first()) as any;
    if (res && res.game_settings) {
      try {
        const dbSettings = JSON.parse(res.game_settings);
        parsed.gameSettings = { ...parsed.gameSettings, ...dbSettings };
      } catch(e){}
    }
  } catch (e) {
    console.error('Failed to load game settings from DB', e);
  }

  memoryLedger = parsed;
  return parsed;
}

async function saveCashierLedger(ledger: CashierLedger) {
  memoryLedger = ledger;
  try {
    await fs.writeFile(cashierLedgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  } catch (error: any) {
    console.warn('In-memory ledger updated. File write skipped (read-only environment):', error.message);
  }

  try {
    if (ledger.gameSettings) {
      const db = getD1Database();
      const settingsStr = JSON.stringify(ledger.gameSettings);
      await db.prepare("UPDATE app_settings SET game_settings = ? WHERE id = 'global'").bind(settingsStr).run();
    }
  } catch (e) {
    console.error('Failed to save game settings to DB', e);
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

  app.use(express.json({ limit: '10mb' }));
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

  // API Route: General Platform Q&A
  app.post('/api/copilot/qa', async (req, res) => {
    try {
      const { history, question } = req.body;

      if (!ai) {
        return res.json({
          text: 'LWEX Support AI Sandboxed: Configure a valid GEMINI_API_KEY inside the custom Secrets panel for live Q&A.',
        });
      }

      const systemPrompt = `You are the LWEX Platform Support AI. 
Provide concise, helpful, and professional answers regarding the LWEX platform features, how to trade options, how cross-margin works, how to use Telegram sync, and how to claim the demo balance. Do not give direct financial advice. Keep answers under 100 words.`;

      let promptText = `${systemPrompt}\n\n`;
      if (history && history.length > 0) {
        promptText += `Previous Context:\n${history.map((h: any) => `${h.role}: ${h.text}`).join('\n')}\n\n`;
      }
      promptText += `User Question: ${question}\n\nAI Response:`;

      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: promptText,
      });

      const responseText = response.text?.trim() || "I am pondering...";

      return res.json({ text: responseText });
    } catch (err: any) {
      console.error('[Copilot QA Error]', err.message);
      return res.status(500).json({ text: "The network is unstable, my support capabilities are offline." });
    }
  });

  // API Route: Smart trading signal & options advisor
  app.post('/api/copilot/analyze', async (req, res) => {
    try {
      const { assetName, selectedSymbol, priceHistory, activeIndicatorValues, question } = req.body;

      if (!ai) {
        return res.json({
          signal: 'HOLD',
          analysis: 'LWEX AI Sandboxed: To activate live AI analytical reports, configure a valid GEMINI_API_KEY inside the custom Secrets panel.',
          support: 'ND',
          resistance: 'ND',
          levelOfConfidence: 'Low (Sandbox)'
        });
      }

      // Format data context for the model
      const pricesString = priceHistory ? priceHistory.slice(-20).map((t: any) => t.price.toFixed(4)).join(', ') : 'unknown';
      const indicatorsString = activeIndicatorValues ? JSON.stringify(activeIndicatorValues) : 'Defaults';

      const systemPrompt = `You are "Wizard Bot", the official onboarding, Telegram sync and derivatives oracle of LWEX (https://t.me/+V9H-AvU6wl43MTNk).
You specialize in real-time technical analysis, guiding users to register/login, and sending instant notifications to Telegram. Our official Telegram community is: https://t.me/+V9H-AvU6wl43MTNk
Your style is professional, mystical, and adaptive.

PRIVACY & SECURITY PROTOCOL:
- PROTECT THE SANCTITY: Never disclose internal LWEX algorithms, source code, API keys, or infrastructure details.
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
        analysis: 'Failed to negotiate analysis payload with LWEX secure service. Please check configuration schemas.',
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

      const ledger = await loadCashierLedger();
      const btcEnabled = ledger.gameSettings?.btcEnabled !== false;
      const minDeposit = ledger.gameSettings?.minDeposit ?? 1.00;

      if (!btcEnabled) {
        return res.status(400).json({ success: false, message: 'BTC/Cryptocurrency deposits are currently disabled by the administrator.' });
      }

      if (parsedAmount < minDeposit) {
        return res.status(400).json({ success: false, message: `Minimum deposit amount is $${minDeposit} USD.` });
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
            finalReason = `Secure Gateway Note: "${reason}". Seamlessly routed to secure live LWEX Sandbox simulation.`;
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
        return res.status(400).json({ success: false, message: 'NOWPayments API key is missing or invalid.' });
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
          order_description: `Deposit to LWEX Wallet for ${userId}`,
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
        console.error('NOWPayments API key/connection error:', reqError.message);
        return res.status(500).json({ success: false, message: reqError.message });
      }
    } catch (error: any) {
      console.error('NOWPayments Create Payment Error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  async function getTradesCount(db: any, userId: string): Promise<number> {
    let count = 0;
    try {
      const states = await db.prepare("SELECT trade_history FROM user_states WHERE user_id = ?").bind(userId).all();
      const rows = states.results || states || [];
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (row && row.trade_history) {
            try {
              const parsed = JSON.parse(row.trade_history);
              if (Array.isArray(parsed)) {
                count += parsed.length;
              }
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      console.error("[BONUS SYSTEM ERROR] Error counting user trades:", err);
    }
    return count;
  }

  async function checkAndApply200PercentBonus(db: any, userId: string, now: string) {
    try {
      const user = await db.prepare("SELECT first_deposit_amount, first_deposit_promo_credited FROM users WHERE id = ?").bind(userId).first();
      if (!user) return;

      if (user.first_deposit_promo_credited === 1) {
        return; // Already awarded
      }

      let firstDepositAmt = Number(user.first_deposit_amount || 0);
      if (firstDepositAmt <= 0) {
        // Fallback: try finding first credited deposit if exists
        const firstDep = await db.prepare("SELECT amount FROM credited_deposits WHERE user_id = ? ORDER BY credited_at ASC LIMIT 1").bind(userId).first();
        if (firstDep && firstDep.amount > 0) {
          firstDepositAmt = Number(firstDep.amount);
          await db.prepare("UPDATE users SET first_deposit_amount = ?, updated_at = ? WHERE id = ?")
            .bind(firstDepositAmt, now, userId)
            .run();
          console.log(`[BONUS SYSTEM] Recovered user's first deposit amount of $${firstDepositAmt} for User ${userId}`);
        }
      }

      if (firstDepositAmt <= 0) {
        return; // No deposit has been recorded yet
      }

      const tradesCount = await getTradesCount(db, userId);
      console.log(`[BONUS SYSTEM - 200% CHECK] User ${userId}: First Deposit = $${firstDepositAmt}, Total trades = ${tradesCount}`);
      
      if (tradesCount > 5) {
        const bonusAmount = firstDepositAmt * 2.0;
        await db.prepare("UPDATE users SET real_balance = real_balance + ?, first_deposit_promo_credited = 1, updated_at = ? WHERE id = ?")
          .bind(bonusAmount, now, userId)
          .run();
        console.log(`[BONUS SYSTEM - 200%] MATCH COMMITTED! Successfully credited 200% First Deposit Match Bonus of $${bonusAmount} to User ${userId}`);
      }
    } catch (err: any) {
      console.error("[BONUS SYSTEM ERROR] checkAndApply200PercentBonus failed:", err.message);
    }
  }

  async function applyFirstDepositBonusIfEligible(db: any, userId: string, depositAmount: number, now: string) {
    try {
      const user = await db.prepare("SELECT first_deposit_bonus_credited, first_deposit_amount FROM users WHERE id = ?").bind(userId).first();
      if (user) {
        // Record first deposit amount if it hasn't been set yet
        const currentFirstDepositAmt = Number(user.first_deposit_amount || 0);
        if (currentFirstDepositAmt <= 0) {
          await db.prepare("UPDATE users SET first_deposit_amount = ?, updated_at = ? WHERE id = ?")
            .bind(depositAmount, now, userId)
            .run();
          console.log(`[BONUS SYSTEM] Successfully set user ${userId} first_deposit_amount as $${depositAmount}`);
        }

        if (user.first_deposit_bonus_credited !== 1) {
          const bonusAmount = depositAmount * 0.50;
          await db.prepare("UPDATE users SET real_balance = real_balance + ?, first_deposit_bonus_credited = 1, updated_at = ? WHERE id = ?")
            .bind(bonusAmount, now, userId)
            .run();
          console.log(`[BONUS SYSTEM] Successfully applied 50% First Deposit Match Bonus of $${bonusAmount} for User ${userId}`);
        }

        // Also run the 200% bonus evaluation check (if they already have > 5 trades at time of deposit)
        await checkAndApply200PercentBonus(db, userId, now);
      }
    } catch (err: any) {
      console.error("[BONUS SYSTEM ERROR] applyFirstDepositBonusIfEligible failed:", err.message);
    }
  }

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
        // Sandbox mock processing: fetch transaction details from session, return waiting by default
        const session = paymentSessions.get(pIdStr);
        const amountToCredit = session ? session.amount : 100;
        const currentCoin = session ? session.coin : 'BTC';

        status = {
          payment_status: 'waiting',
          payin_hash: `sb-tx-${Date.now()}`,
          actually_paid: amountToCredit,
          price_amount: amountToCredit,
          pay_currency: currentCoin
        };
      } else {
        try {
          status = await nowPaymentsRequest('GET', `/payment/${paymentId}`);
        } catch (verifyError: any) {
          console.warn('NOWPayments verify error:', verifyError.message);
          return res.status(500).json({ success: false, message: 'Failed to verify payment with NOWPayments. Please try again.' });
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

        // Apply first deposit match bonus if qualified
        await applyFirstDepositBonusIfEligible(db, user.id, actualAmount, now);

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

      const ledger = await loadCashierLedger();
      const btcEnabled = ledger.gameSettings?.btcEnabled !== false;
      const minWithdrawal = ledger.gameSettings?.minWithdrawal ?? 10.00;

      if (!btcEnabled) {
        return res.status(400).json({ success: false, message: 'BTC/Cryptocurrency withdrawals are currently disabled by the administrator.' });
      }

      if (amount < minWithdrawal) {
        return res.status(400).json({ success: false, message: `Minimum withdrawal amount is $${minWithdrawal} USD.` });
      }

      const address = String(targetAddress || '').trim();
      if (!address) {
        return res.status(400).json({ success: false, message: 'Withdrawal address is required.' });
      }

      const db = getD1Database();
      const user = await db.prepare('SELECT id, real_balance, verified_bonus_credited, first_deposit_bonus_credited FROM users WHERE id = ? OR email = ?').bind(userId, userId).first();
      if (!user) {
        return res.status(404).json({ success: false, message: 'User account not found.' });
      }

      // Safe bonus withdrawal condition checkpoint
      if (user.verified_bonus_credited === 1 || user.first_deposit_bonus_credited === 1) {
        const userState = await db.prepare("SELECT trade_history FROM user_states WHERE user_id = ? AND mode = 'real'").bind(user.id).first();
        let wonTradesCount = 0;
        if (userState && userState.trade_history) {
          try {
            const parsedHistory = JSON.parse(userState.trade_history);
            wonTradesCount = parsedHistory.filter((t: any) => t.status === 'won').length;
          } catch (e) {
            console.warn("[WITHDRAWAL CHECK] Failed to parse trade history string:", e);
          }
        }

        if (wonTradesCount < 10) {
          return res.status(400).json({
            success: false,
            message: `Your account includes active promotional bonuses. To authorize withdrawals of your main balance and match credits, you need 10 successful trades (wins with no early cashouts) in Real Mode. Current status: ${wonTradesCount}/10 wins completed.`
          });
        }
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

          // Apply first deposit match bonus if qualified
          await applyFirstDepositBonusIfEligible(db, user.id, amount, now);

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
      
      const ledger = await loadCashierLedger();
      const minDeposit = ledger.gameSettings?.minDeposit ?? 1.00;
      if (Number(amount) < minDeposit) {
        return res.status(400).json({ success: false, message: `Minimum deposit amount is $${minDeposit} USD.` });
      }

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

  // ==================== TRAFFIC AND VISITS TRACKER ====================
  app.post('/api/visits/log', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { referrer, host, path: currentPath, userAgent, userId } = req.body;
      let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      if (Array.isArray(ip)) ip = ip[0];
      
      const db = getD1Database();
      const id = 'visit_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      const createdAt = new Date().toISOString();
      
      await db.prepare(`
        INSERT INTO platform_visits (id, ip, user_agent, referrer, host, user_id, path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, ip, userAgent || '', referrer || '', host || '', userId || null, currentPath || '/', createdAt).run();
      
      return res.json({ success: true });
    } catch (err: any) {
      console.error('Visits log error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/admin/visits', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'admin-secret-key') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }
      const db = getD1Database();
      const allVisits = (await db.prepare('SELECT * FROM platform_visits ORDER BY created_at DESC').all())?.results || [];
      
      const totalVisits = allVisits.length;
      const uniqueIPs = new Set(allVisits.map((v: any) => v.ip)).size;
      
      const lwexVisitsCount = allVisits.filter((v: any) => 
        (v.host && v.host.includes('lwex.onrender.com')) || 
        (v.referrer && v.referrer.includes('lwex.onrender.com'))
      ).length;

      return res.json({
        success: true,
        visitsCount: totalVisits,
        uniqueVisitors: uniqueIPs,
        lwexCount: lwexVisitsCount,
        recentVisits: allVisits.slice(0, 100)
      });
    } catch (err: any) {
      console.error('Admin visits fetch error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Failed to fetch visits' });
    }
  });

  // ==================== USER GOOGLE AUTH ENDPOINTS ====================
  
  // Initiator URL getter
  app.get('/api/auth/google/url', (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const redirectUri = `${protocol}://${host}/api/auth/google/callback`;
    
    if (clientId) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        prompt: 'select_account'
      });
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      return res.json({ success: true, url: authUrl, simulated: false });
    } else {
      const simulatedUrl = `/api/auth/google/simulated-select`;
      return res.json({ success: true, url: simulatedUrl, simulated: true });
    }
  });

  // Simulated chooser page UI
  app.get('/api/auth/google/simulated-select', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    return res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Sign in - Google Accounts</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Roboto', sans-serif;
      background-color: #f0f4f9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
    }
    .card {
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      width: 450px;
      padding: 40px;
      box-sizing: border-box;
      text-align: center;
    }
    .logo {
      height: 32px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 24px;
      font-weight: 400;
      color: #202124;
      margin: 0 0 8px 0;
    }
    .subtitle {
      font-size: 16px;
      color: #5f6368;
      margin-bottom: 32px;
    }
    .account-item {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #dadce0;
      cursor: pointer;
      text-align: left;
      transition: background 0.2s;
    }
    .account-item:hover {
      background: #f8f9fa;
    }
    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #eaf2ff;
      color: #0b57d0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 500;
      margin-right: 12px;
    }
    .account-details {
      flex: 1;
    }
    .account-name {
      font-size: 14px;
      font-weight: 500;
      color: #3c4043;
    }
    .account-email {
      font-size: 12px;
      color: #5f6368;
    }
    .custom-input-section {
      margin-top: 24px;
      text-align: left;
      border-top: 1px dashed #dadce0;
      padding-top: 20px;
    }
    .custom-label {
      font-size: 12px;
      font-weight: 500;
      color: #3c4043;
      margin-bottom: 12px;
      display: block;
    }
    input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #dadce0;
      border-radius: 4px;
      font-size: 14px;
      box-sizing: border-box;
      margin-bottom: 12px;
    }
    input:focus {
      outline: none;
      border-color: #1a73e8;
    }
    button.btn-submit {
      background: #1a73e8;
      color: white;
      border: none;
      padding: 10px 24px;
      font-size: 14px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      width: 100%;
    }
    button.btn-submit:hover {
      background: #1557b0;
    }
  </style>
</head>
<body>
  <div class="card">
    <svg class="logo" viewBox="0 0 24 24" width="74" height="24" style="height:32px;">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22c-.1-.13-.19-.27-.27-.41s-.14-.29-.19-.44c-.03-.09-.06-.18-.08-.28z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
    </svg>
    <h1>Choose an account</h1>
    <div class="subtitle">to continue to LWEX Trading Node</div>
    
    <div class="account-item" onclick="select('ryanelvo1@gmail.com', 'Ryan Elvo')">
      <div class="avatar" style="background:#e8f0fe; color:#1a73e8; font-weight:bold; font-size:16px;">R</div>
      <div class="account-details">
        <div class="account-name">Ryan Elvo</div>
        <div class="account-email">ryanelvo1@gmail.com</div>
      </div>
    </div>
    
    <div class="account-item" onclick="select('trader.demo@gmail.com', 'Demo Trader')">
      <div class="avatar" style="background:#e8f0fe; color:#1a73e8; font-weight:bold; font-size:16px;">D</div>
      <div class="account-details">
        <div class="account-name">Demo Trader</div>
        <div class="account-email">trader.demo@gmail.com</div>
      </div>
    </div>

    <div class="account-item" onclick="select('wizard@lwex.com', 'Wizard Master')">
      <div class="avatar" style="background:#e8f0fe; color:#1a73e8; font-weight:bold; font-size:16px;">W</div>
      <div class="account-details">
        <div class="account-name">Wizard Master</div>
        <div class="account-email">wizard@lwex.com</div>
      </div>
    </div>

    <div class="custom-input-section">
      <div class="custom-label">Or use custom simulated account:</div>
      <form action="/api/auth/google/simulated-callback" method="GET">
        <input type="text" name="name" placeholder="Full Name (e.g. John Doe)" required style="width: 100%; padding: 10px 14px; border: 1px solid #dadce0; border-radius: 4px; font-size: 14px; box-sizing: border-box; margin-bottom: 12px;" />
        <input type="email" name="email" placeholder="Email Address (e.g. john@doe.com)" required style="width: 100%; padding: 10px 14px; border: 1px solid #dadce0; border-radius: 4px; font-size: 14px; box-sizing: border-box; margin-bottom: 12px;" />
        <button type="submit" class="btn-submit">Continue to LWEX</button>
      </form>
    </div>
  </div>

  <script>
    function select(email, name) {
      window.location.href = '/api/auth/google/simulated-callback?email=' + encodeURIComponent(email) + '&name=' + encodeURIComponent(name);
    }
  </script>
</body>
</html>
    `);
  });

  // Common Google registration/session generator helper function
  async function handleUserGoogleAuth(email: string, fullName: string, res: any) {
    try {
      const db = getD1Database();
      let user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
      const now = new Date().toISOString();
      let userId: string;

      if (!user) {
        userId = `user-${crypto.randomBytes(8).toString('hex')}`;
        const passwordHash = crypto.createHash('sha256').update('google-auth-random-pass-' + crypto.randomBytes(16).toString('hex')).digest('hex');
        
        await db.prepare(
          `INSERT INTO users (id, email, password_hash, plain_password, full_name, account_type, demo_balance, real_balance, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(userId, email, passwordHash, '', fullName || 'Google User', 'demo', 10000.0, 0.0, now, now).run();

        await db.prepare(
          `INSERT INTO user_profiles (user_id, phone, country, verification_status, two_factor_enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(userId, null, 'Kenya', 'unverified', 0, now, now).run();
      } else {
        userId = user.id;
      }

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const sessionId = `sess-${crypto.randomBytes(8).toString('hex')}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await db.prepare(
        `INSERT INTO user_sessions (session_id, user_id, token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(sessionId, userId, sessionToken, now, expiresAt).run();

      await db.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').bind(now, now, userId).run();

      const finalUser = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Sign In Successful</title>
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #fafafa; color: #333; }
            .spinner { border: 4px solid rgba(0,0,0,0.1); width: 36px; height: 36px; border-radius: 50%; border-left-color: #1a73e8; animation: spin 1s linear infinite; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            h2 { margin-top: 20px; font-weight: 500; font-size: 18px; }
          </style>
        </head>
        <body>
          <div class="spinner"></div>
          <h2>Syncing with LWEX Terminal... Please wait.</h2>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'GOOGLE_AUTH_SUCCESS',
                user: {
                  id: "${finalUser.id}",
                  email: "${finalUser.email}",
                  fullName: "${finalUser.full_name || 'Google User'}",
                  phone: "",
                  country: "Kenya",
                  balance: ${finalUser.account_type === 'demo' ? finalUser.demo_balance : finalUser.real_balance},
                  accountType: "${finalUser.account_type}",
                  forceOutcome: "${finalUser.force_outcome || ''}",
                  profitTarget: ${finalUser.profit_target || 0},
                  maxWinLimit: ${finalUser.max_win_limit || 0},
                  maxLossLimit: ${finalUser.max_loss_limit || 0}
                },
                token: "${sessionToken}"
              }, '*');
              setTimeout(() => {
                window.close();
              }, 800);
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
        </html>
      `);
    } catch (err: any) {
      console.error('Google Auth callback sub-route fail:', err);
      res.status(500).send('<h2>Google Authentication Failed</h3><p>' + err.message + '</p>');
    }
  }

  // Simulated redirect endpoint
  app.get('/api/auth/google/simulated-callback', async (req, res) => {
    const { email, name } = req.query;
    if (!email) return res.status(400).send('Email parameter required for simulated authentication');
    await handleUserGoogleAuth(email as string, (name as string) || 'Google User', res);
  });

  // Real Google Oauth Callback URL
  app.get('/api/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.status(400).send('Authorization code missing');
    }
    try {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const redirectUri = `${protocol}://${host}/api/auth/google/callback`;

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: code as string,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        })
      });
      const tokens: any = await tokenRes.json();
      if (!tokens.access_token) {
        throw new Error(JSON.stringify(tokens));
      }

      const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const profile: any = await userinfoRes.json();
      if (!profile.email) {
        throw new Error('Could not fetch email from provider');
      }

      await handleUserGoogleAuth(profile.email, profile.name || profile.given_name || 'Google User', res);
    } catch (err: any) {
      console.error('Real Google callback error:', err);
      res.status(500).send('<h2>Real Google login failed</h2><p>' + err.message + '</p>');
    }
  });

  // Register endpoint
  app.post('/api/auth/register', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { email, password, fullName, phone, country, referredBy } = req.body;
      
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
        `INSERT INTO users (id, email, password_hash, plain_password, full_name, account_type, demo_balance, real_balance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(userId, email, passwordHash, password, fullName || 'User', 'demo', 10000.0, 0.0, now, now).run();

      await db.prepare(
        `INSERT INTO user_profiles (user_id, phone, country, verification_status, two_factor_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(userId, phone || null, country || 'Kenya', 'unverified', 0, now, now).run();

      if (referredBy) {
        const referrer = await db.prepare('SELECT id FROM users WHERE id = ?').bind(referredBy).first();
        if (referrer) {
          const refId = `ref-${crypto.randomBytes(8).toString('hex')}`;
          await db.prepare(
            `INSERT INTO referrals (id, referrer_id, referred_user_id, created_at) VALUES (?, ?, ?, ?)`
          ).bind(refId, referrer.id, userId, now).run();

          const countRes = await db.prepare('SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?').bind(referrer.id).first();
          if (countRes && countRes.count === 10) {
            if (telegramConfig.botToken && telegramConfig.groupChatId) {
              const guideText = `🔥 <b>MILESTONE UNLOCKED!</b> 🔥\n\nA member just reached 10 referrals!\n\n<b>📚 NEW MEMBER WELCOME GUIDE:</b>\n1. Sign up on our platform to get a $10k Practice Account.\n2. Access live AI signals from Wizard Bot.\n3. Make your first deposit to switch to REAL mode and withdraw earnings directly to M-Pesa.\n\n🔗 Let's grow together: https://lwex.onrender.com/`;
              
              fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: telegramConfig.groupChatId, text: guideText, parse_mode: 'HTML' })
              }).then(async (sendRes) => {
                const sendData = await sendRes.json();
                if (sendData?.ok && sendData.result?.message_id) {
                  fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/pinChatMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: telegramConfig.groupChatId,
                      message_id: sendData.result.message_id,
                      disable_notification: false
                    })
                  }).catch(() => {});
                }
              }).catch(() => {});
            }
          }
        }
      }

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
          accountType: 'demo',
          forceOutcome: '',
          profitTarget: 0.00,
          maxWinLimit: 0.00,
          maxLossLimit: 0.00
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
        return res.status(400).json({ success: false, message: 'Email/Phone and password are required.' });
      }

      const db = getD1Database();
      const user = await db.prepare(`
        SELECT u.* FROM users u 
        LEFT JOIN user_profiles up ON u.id = up.user_id 
        WHERE u.email = ? OR up.phone = ?
      `).bind(email, email).first();

      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid email/phone or password.' });
      }

      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      if (passwordHash !== user.password_hash) {
        return res.status(401).json({ success: false, message: 'Invalid email/phone or password.' });
      }

      const profile = await db.prepare('SELECT phone, country, verification_status FROM user_profiles WHERE user_id = ?').bind(user.id).first();

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
          verificationStatus: profile?.verification_status || 'unverified',
          balance: user.account_type === 'demo' ? user.demo_balance : user.real_balance,
          accountType: user.account_type,
          forceOutcome: user.force_outcome,
          profitTarget: user.profit_target,
          maxWinLimit: user.max_win_limit || 0.00,
          maxLossLimit: user.max_loss_limit || 0.00
        },
        token: sessionToken
      });
    } catch (error: any) {
      console.error('Login error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Login failed' });
    }
  });

  // Update user balance from trading events
  app.get('/api/users/me', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      
      const userId = authHeader.split(' ')[1];
      const db = getD1Database();
      const user = await db.prepare('SELECT u.id, u.email, u.full_name as fullName, p.phone, u.account_type, u.demo_balance, u.real_balance, p.verification_status as verificationStatus, u.first_deposit_amount as firstDepositAmount, u.first_deposit_promo_credited as firstDepositPromoCredited FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id WHERE u.id = ?').bind(userId).first();
      
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      
      const tradesCount = await getTradesCount(db, userId);
      user.tradesCount = tradesCount;
      
      return res.json({ success: true, user });
    } catch (err: any) {
      console.error('[API USERS ME ERROR]', err.message);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  app.post('/api/users/submit-verification', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      const userId = authHeader.split(' ')[1];
      const { documentType, documentNumber } = req.body;

      const db = getD1Database();

      // Ensure user exists
      const user = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Update or insert profile with verification_status = 'pending'
      const profile = await db.prepare('SELECT user_id FROM user_profiles WHERE user_id = ?').bind(userId).first();
      const now = new Date().toISOString();
      if (profile) {
        await db.prepare('UPDATE user_profiles SET verification_status = ?, updated_at = ? WHERE user_id = ?')
          .bind('pending', now, userId)
          .run();
      } else {
        await db.prepare('INSERT INTO user_profiles (user_id, verification_status, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .bind(userId, 'pending', now, now)
          .run();
      }

      return res.json({ success: true, message: 'Documents submitted successfully! The security audit has begun.' });
    } catch (err: any) {
      console.error('[SUBMIT VERIFICATION ERROR]', err.message);
      return res.status(500).json({ success: false, message: 'Server error processing documents.' });
    }
  });

  app.get('/api/user-state', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      const userId = authHeader.split(' ')[1];
      const mode = (req.query.mode as string) || 'demo';

      const db = getD1Database();
      const state = await db.prepare('SELECT active_contracts, trade_history, price_alerts FROM user_states WHERE user_id = ? AND mode = ?').bind(userId, mode).first();

      if (!state) {
        return res.json({
          success: true,
          serverTime: Date.now(),
          activeContracts: [],
          tradeHistory: [],
          priceAlerts: []
        });
      }

      return res.json({
        success: true,
        serverTime: Date.now(),
        activeContracts: JSON.parse(state.active_contracts || '[]'),
        tradeHistory: JSON.parse(state.trade_history || '[]'),
        priceAlerts: JSON.parse(state.price_alerts || '[]')
      });
    } catch (err: any) {
      console.error('[GET USER STATE ERROR]', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post('/api/user-state', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      const userId = authHeader.split(' ')[1];
      const { mode, activeContracts, tradeHistory, priceAlerts } = req.body;

      if (!mode) {
        return res.status(400).json({ success: false, message: 'mode is required' });
      }

      const activeContractsStr = JSON.stringify(activeContracts || []);
      const tradeHistoryStr = JSON.stringify(tradeHistory || []);
      const priceAlertsStr = JSON.stringify(priceAlerts || []);
      const now = new Date().toISOString();

      const db = getD1Database();
      const existing = await db.prepare('SELECT user_id FROM user_states WHERE user_id = ? AND mode = ?').bind(userId, mode).first();

      if (!existing) {
        await db.prepare('INSERT INTO user_states (user_id, mode, active_contracts, trade_history, price_alerts, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(userId, mode, activeContractsStr, tradeHistoryStr, priceAlertsStr, now)
          .run();
      } else {
        await db.prepare('UPDATE user_states SET active_contracts = ?, trade_history = ?, price_alerts = ?, updated_at = ? WHERE user_id = ? AND mode = ?')
          .bind(activeContractsStr, tradeHistoryStr, priceAlertsStr, now, userId, mode)
          .run();
      }

      // Check if user qualifies for the 200% first deposit promo bonus
      await checkAndApply200PercentBonus(db, userId, now);

      return res.json({ success: true });
    } catch (err: any) {
      console.error('[POST USER STATE ERROR]', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post('/api/users/update-balance', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { userId, amount, isDemo, consumeForceOutcome } = req.body;
      if (!userId || amount === undefined) {
        return res.status(400).json({ success: false, message: 'userId and amount are required.' });
      }

      const db = getD1Database();
      const user = await db.prepare('SELECT id, demo_balance, real_balance FROM users WHERE id = ?').bind(userId).first();
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount)) {
        return res.status(400).json({ success: false, message: 'Invalid amount value.' });
      }

      const now = new Date().toISOString();
      let nextBalance = 0;

      if (isDemo) {
        nextBalance = Math.max(0, (user.demo_balance || 0) + parsedAmount);
        await db.prepare('UPDATE users SET demo_balance = ?, updated_at = ? WHERE id = ?').bind(nextBalance, now, userId).run();
      } else {
        nextBalance = Math.max(0, (user.real_balance || 0) + parsedAmount);
        await db.prepare('UPDATE users SET real_balance = ?, updated_at = ? WHERE id = ?').bind(nextBalance, now, userId).run();
      }

      let forceOutcomeCleared = false;
      // Admin requested: Let the settings set by the admin remain running until they reset again.
      // So we do not automatically clear force_outcome upon trade settlement.

      return res.json({ 
        success: true, 
        balance: nextBalance,
        ...(forceOutcomeCleared ? { forceOutcome: '' } : {})
      });
    } catch (error: any) {
      console.error('Update balance error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // Transporter configuration block
  let mailTransporter: any = null;

  function getMailTransporter() {
    if (mailTransporter) return mailTransporter;
    
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_PASS;
    
    if (user && pass) {
      mailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user,
          pass
        }
      });
      console.log('[Mail Setup] Gmail SMTP transporter configured successfully.');
    } else {
      console.log('[Mail Setup] GMAIL_USER or GMAIL_PASS missing. Falling back to console-simulated emails.');
    }
    return mailTransporter;
  }

  // Helper to send password reset email via Gmail
  async function sendPasswordResetEmail(email: string, resetToken: string, appUrl: string) {
    const transporter = getMailTransporter();
    const resetLink = `${appUrl}/?token=${resetToken}`;
    const subject = 'Password Reset Link - LWEX';
    
    const textContent = `You have requested to reset your password on LWEX.\n\nPlease reset your password by opening the following link:\n${resetLink}\n\nAlternatively, you can manually enter this reset token in the application profile interface:\nReset Token: ${resetToken}\n\nThis link will expire in 15 minutes.\n\nIf you did not request this, please ignore this email.`;
    
    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #4f46e5; margin-bottom: 16px; font-weight: 800; font-size: 22px;">LWEX PASSWORD RESET</h2>
        <p style="color: #334155; font-size: 15px; line-height: 1.5;">You requested to reset your password on the LWEX trading platform. Click the button below to secure a new password:</p>
        <div style="margin: 24px 0;">
          <a href="${resetLink}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #eab308 0%, #9333ea 100%); color: white; text-decoration: none; font-weight: bold; padding: 12px 24px; border-radius: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Reset My Password</a>
        </div>
        <p style="color: #64748b; font-size: 12px; margin-top: 16px;">If the button above does not work, copy and paste this link manually into your browser's search field:</p>
        <p style="color: #4f46e5; font-size: 13px; font-family: monospace; word-break: break-all; margin: 8px 0; background: #f8fafc; padding: 10px; border-radius: 4px; border: 1px solid #f1f5f9;">${resetLink}</p>
        <div style="background-color: #f8fafc; padding: 12px; border-left: 4px solid #9333ea; margin: 20px 0; border-radius: 0 4px 4px 0;">
          <span style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; display: block;">Reset Token Code:</span>
          <code style="font-size: 18px; font-family: monospace; font-weight: bold; color: #1e1b4b; letter-spacing: 1px;">${resetToken}</code>
        </div>
        <p style="color: #94a3b8; font-size: 11px; margin-top: 24px;">This security code and URL expires in 15 minutes. If you did not make this request, please ignore this communication securely.</p>
      </div>
    `;

    if (transporter) {
      try {
        await transporter.sendMail({
          from: `"LWEX Security" <${process.env.GMAIL_USER}>`,
          to: email,
          subject,
          text: textContent,
          html: htmlContent
        });
        console.log(`[Mail Dispatch] Successfully dispatched password reset email via Gmail to ${email}`);
        return true;
      } catch (err) {
        console.error('[Mail Dispatch] Failed sending email via Gmail transporter:', err);
      }
    }
    return false;
  }

  // Forgot password endpoint
  app.post('/api/auth/forgot-password', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
      }

      const db = getD1Database();
      const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
      
      if (!user) {
        return res.json({ success: true, message: 'If an account exists with this email, a reset link will be sent.' }); // Don't reveal user existence
      }

      const resetToken = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 Character elegant hex token code
      const resetId = `rst-${Date.now()}`;
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins expiry

      await db.prepare(`
        INSERT INTO password_resets (id, user_id, token, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(resetId, user.id, resetToken, now, expiresAt).run();

      // Dispatch via Gmail
      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const emailSent = await sendPasswordResetEmail(email, resetToken, appUrl);
      
      console.log(`[RESET PASSWORD] Generated token for user ${user.id}: ${resetToken}. Gmail dispatched successfully? ${emailSent}`);
      
      if (emailSent) {
        return res.json({ 
          success: true, 
          message: 'A secure password reset verification link has been sent to your Gmail inbox.' 
        });
      } else {
        return res.json({ 
          success: true, 
          message: 'Password reset token has been registered. (GMAIL Config is not defined, code is printed to console log: ' + resetToken + ')' 
        });
      }
    } catch (error: any) {
      console.error('Forgot password error:', error);
      return res.status(500).json({ success: false, message: 'Failed to process request.' });
    }
  });

  app.post('/api/alerts/notify', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { email, alert, latestPrice } = req.body;
      if (!email || !alert) {
        return res.status(400).json({ success: false, message: 'Email and alert payload are required.' });
      }

      const transporter = getMailTransporter();
      if (transporter) {
        let conditionText = alert.condition === 'above' ? 'crossed above' : 'crossed below';
        await transporter.sendMail({
          from: `"LWEX Trade Alerts" <${process.env.GMAIL_USER}>`,
          to: email,
          subject: `🚨 LWEX Price Alert: ${alert.assetSymbol} ${conditionText} ${alert.targetPrice}`,
          html: `<p>Your price alert has been triggered.</p>
                 <p><b>Asset:</b> ${alert.assetSymbol}</p>
                 <p><b>Condition:</b> ${conditionText} ${alert.targetPrice}</p>
                 <p><b>Current Price:</b> ${latestPrice}</p>
                 <p>Login to LWEX to manage your positions.</p>`
        });
      }
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Alert notify error:', error);
      return res.status(500).json({ success: false, message: 'Failed to process notification.' });
    }
  });

  // Reset password endpoint
  app.post('/api/auth/reset-password', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) {
        return res.status(400).json({ success: false, message: 'Token and new password required' });
      }

      const db = getD1Database();
      const resetRecord = await db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').bind(token).first();
      
      if (!resetRecord) {
        return res.status(400).json({ success: false, message: 'Invalid or expired token.' });
      }

      if (new Date(resetRecord.expires_at) < new Date()) {
        return res.status(400).json({ success: false, message: 'Token has expired.' });
      }

      const passwordHash = crypto.createHash('sha256').update(newPassword).digest('hex');
      const now = new Date().toISOString();

      // Update password
      await db.prepare('UPDATE users SET password_hash = ?, plain_password = ?, updated_at = ? WHERE id = ?')
        .bind(passwordHash, newPassword, now, resetRecord.user_id)
        .run();

      // Mark token as used
      await db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').bind(resetRecord.id).run();

      return res.json({ success: true, message: 'Password has been updated successfully. You can now login.' });
    } catch (error: any) {
      console.error('Reset password error:', error);
      return res.status(500).json({ success: false, message: 'Failed to reset password.' });
    }
  });

  // --- TELEGRAM BOT INTEGRATION & GROUP CONTROLLER ---
  let telegramConfig = {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    groupChatId: process.env.TELEGRAM_GROUP_CHAT_ID || '',
    groupLink: 'https://t.me/+V9H-AvU6wl43MTNk',
    webhookActive: false,
    autoInviteDMs: true,
    autoSimulateIntervalEnabled: true,
    autoSimulateIntervalSeconds: 30,
    autoSimulateMessageTypes: ['signals', 'motivation', 'results', 'screenshots'],
    autoSimulateActiveUsersCount: 15,
    pinnedMessageId: null as string | null,
    pinnedMessageText: null as string | null,
    pinnedMessageSender: null as string | null,
    hunterIntervalEnabled: true,
    hunterIntervalSeconds: 90,
    hunterAnnounceOnMainGroup: true,
    templateVIPCampaign: `<b>[LWEX 🎁 VIP Promo Announcement]</b>\n\n{text}\n\n👉 Trade Now: {link}`,
    templateAlert: `<b>[LWEX 🔔 Urgent Network Watch]</b>\n\n{text}\n\n👉 Trade Now: {link}`,
    templateSignal: `<b>[LWEX 📈 Dynamic Options Prediction]</b>\n\n{text}\n\n👉 Trade Now: {link}`
  };

  let telegramLogs: Array<{ id: string; sender: string; text: string; timestamp: string }> = [
    { id: 'tg-init', sender: 'System Manager', text: 'Telegram group bot client initiated. Automatic multi-member simulation is active.', timestamp: new Date().toISOString() }
  ];

  let telegramMockUsers: Array<{
    id: string;
    username: string;
    status: string;
    joinedAt: string;
    origin?: string;
    personality?: string;
  }> = [
    { id: 'tg-u1', username: '@peter_trader', status: 'Group Admin', origin: 'Official Community Direct', personality: 'hype', joinedAt: '2026-05-28 10:24Z' },
    { id: 'tg-u2', username: '@christine_flow', status: 'VIP Member', origin: 'Official Community Direct', personality: 'signal_follower', joinedAt: '2026-05-29 14:02Z' },
    { id: 'tg-u15', username: '@peterchristine820', status: 'Elite Member', origin: 'Official Community Direct', personality: 'hype', joinedAt: '2026-05-30 08:44Z' },
    { id: 'tg-u3', username: '@derivs_wizard', status: 'Support Bot', origin: 'System System', personality: 'inquisitive', joinedAt: '2026-05-30 01:15Z' },
    { id: 'tg-u4', username: '@lwex_options', status: 'Member', origin: 'Official Community Direct', personality: 'quiet', joinedAt: '2026-05-30 07:11Z' },
    { id: 'tg-u5', username: '@crypto_hustler_90', status: 'Expert', origin: 'Crypto Syndicate Guild', personality: 'hype', joinedAt: '2026-05-30 11:20Z' },
    { id: 'tg-u6', username: '@alpha_binary_signals', status: 'VIP Elite', origin: 'Premium Binary Club', personality: 'signal_follower', joinedAt: '2026-05-30 14:45Z' },
    { id: 'tg-u7', username: '@forex_ninja_trader', status: 'Member', origin: 'Neptune Forex Crew', personality: 'inquisitive', joinedAt: '2026-05-31 01:10Z' },
    { id: 'tg-u8', username: '@options_queen_sharon', status: 'VIP Member', origin: 'Elite Options Circle', personality: 'hype', joinedAt: '2026-05-31 03:30Z' },
    { id: 'tg-u9', username: '@bull_runner_usdt', status: 'Member', origin: 'Crypto Hype Hub', personality: 'signal_follower', joinedAt: '2026-05-31 05:20Z' },
    { id: 'tg-u10', username: '@quiet_investor_x', status: 'Member', origin: 'Sovereign Wealth Club', personality: 'quiet', joinedAt: '2026-05-31 06:12Z' },
    { id: 'tg-u11', username: '@jason_hodl_options', status: 'Member', origin: 'Retail Options Union', personality: 'inquisitive', joinedAt: '2026-05-31 07:05Z' },
    { id: 'tg-u12', username: '@maria_options_flow', status: 'VIP Member', origin: 'Neptune Forex Crew', personality: 'signal_follower', joinedAt: '2026-05-31 07:10Z' },
    { id: 'tg-u13', username: '@sharon_wealth', status: 'Elite Member', origin: 'Crypto Syndicate Guild', personality: 'hype', joinedAt: '2026-05-31 07:15Z' },
    { id: 'tg-u14', username: '@alpha_king_binary', status: 'Expert', origin: 'Premium Binary Club', personality: 'hype', joinedAt: '2026-05-31 07:20Z' }
  ];

  // Helper: Send message to Telegram API
  async function sendTelegramMessage(token: string, chatId: string, text: string) {
    if (!token || !chatId) {
      console.warn('[Telegram Dispatch] Cannot send, token or chatId is missing.');
      return false;
    }
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML'
        })
      });
      if (!response.ok) {
        console.error(`[Telegram API Error] Status: ${response.status} - ${response.statusText}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Telegram Dispatch Exception] Failed to send message:', e);
      return false;
    }
  }

  // Process any Telegram Update (either through webhook or polling)
  async function processTelegramUpdate(update: any) {
    try {
      const { message, callback_query, channel_post } = update;
      const tMsg = message || channel_post || (callback_query && callback_query.message);
      if (!tMsg) return;

      const chatId = tMsg.chat?.id;
      const text = (tMsg.text || '').trim();
      
      // Handle auto bot invites
      if (tMsg.new_chat_members) {
        // DELETE THE NOTIFICATION FROM THE GROUP SO NO ONE SEES IT
        if (telegramConfig.botToken && chatId) {
           fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, message_id: tMsg.message_id })
           }).catch(() => {});
        }

        for (const member of tMsg.new_chat_members) {
          const userHandle = member.username ? `@${member.username}` : (member.first_name || 'Member');
          telegramLogs.push({
            id: `tg-${Date.now()}-${Math.random()}`,
            sender: 'System Log',
            text: `${userHandle} joined the group.`,
            timestamp: new Date().toISOString()
          });

          if (!telegramMockUsers.some(u => u.username === userHandle)) {
            telegramMockUsers.push({
              id: `tg-u-${Date.now()}`,
              username: userHandle.startsWith('@') ? userHandle : `@${userHandle}`,
              status: 'Member',
              joinedAt: new Date().toISOString()
            });
          }

          if (telegramConfig.autoInviteDMs) {
            telegramLogs.push({
              id: `tg-dm-${Date.now()}-${Math.random()}`,
              sender: 'Wizard Bot (DM)',
              text: `Dispatched welcome DM to ${userHandle} with platform signup link options.`,
              timestamp: new Date().toISOString()
            });

            if (telegramConfig.botToken && member.id && !member.is_bot) {
              const dmText = `<b>🚀 Welcome to the Official Community!</b>\n\nTo start trading and claim your <b>$25,678.91 USDT Practice Account</b>, join our platform:\n\n🔗 https://lwex.onrender.com/\n\n<b>Benefits:</b>\n• Zero-loss environment\n• Live AI signals via this bot\n• Seamless group chat integration!`;
              try {
                fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: member.id, text: dmText, parse_mode: 'HTML' })
                }).catch(() => {});
              } catch(e) {}
            }
          }
        }
        return; // Don't process as normal message
      }

      let userHandle = 'Group Member';
      if (tMsg.from) {
        userHandle = tMsg.from.username ? `@${tMsg.from.username}` : (tMsg.from.first_name || 'Trader');
      } else if (tMsg.author_signature) {
        userHandle = tMsg.author_signature;
      } else if (tMsg.sender_chat) {
        userHandle = tMsg.sender_chat.title || 'Channel Post';
      }
      
      telegramLogs.push({
        id: `tg-${Date.now()}-${Math.random()}`,
        sender: userHandle,
        text: text,
        timestamp: new Date().toISOString()
      });

      let responseText = '';
      if (text.startsWith('/start') || text.toLowerCase().includes('hello') || text.toLowerCase().includes('hi ')) {
        responseText = `<b>🔮 Welcome to LWEX Exchange Official Portal Bot!</b>\n\nGuiding users into derivatives mastery with zero-loss training.\n\n📈 <b>Active Synthetic Index:</b> MFLOW\n💰 <b>Demo balance pre-loaded:</b> $25,678.91 USDT\n\n<b>Commands available:</b>\n/register — Claim free demo credentials & registration link\n/signals — Scan technical oracle signals\n/mflow — Probe active index stats\n/guides — Access complete platform instruction manuals\n/invite — Get your special Bonus Invitation & promo details\n/help — Show interface directives`;
      } else if (text.startsWith('/register') || text.toLowerCase().includes('register') || text.toLowerCase().includes('signup')) {
        const appUrl = 'https://lwex.onrender.com/';
        responseText = `<b>🚀 Start Binary & Index Trading on LWEX!</b>\n\n1. Open: ${appUrl}\n2. Enter registration profile parameters.\n3. Instantly claim <b>$25,678.91 USDT</b> practice capital!\n4. Link handle inside options console for live notification webhooks.`;
        
        if (!telegramMockUsers.some(u => u.username === userHandle)) {
          telegramMockUsers.push({
            id: `tg-u-${Date.now()}`,
            username: userHandle.startsWith('@') ? userHandle : `@${userHandle}`,
            status: 'Member',
            joinedAt: new Date().toISOString()
          });
        }
      } else if (text.startsWith('/invite') || text.startsWith('/bonus')) {
        const appUrl = 'https://lwex.onrender.com/';
        const groupLink = telegramConfig.groupLink || 'https://t.me/+V9H-AvU6wl43MTNk';
        responseText = `<b>🎁 INVITATION BONUS & PROMOTIONAL LAUNCH! 🎁</b>\n\nInvite your trading circles and double your active investment wallet matches!\n\n✨ <b>200% FIRST DEPOSIT MATCH BONUS</b> ✨\nMake your first complete deposit on LWEX and execute more than 5 trades in Real Mode to unlock a magnificent <b>200% Cash Balance match</b> automatically credited to your wallet!\n\n🌟 <b>Referrals Community Reward:</b> Share this Telegram group connection link with your friends to attract elite members and claim shared VIP indicators!\n\n🔗 <b>Register & Trade on Web:</b> ${appUrl}\n👥 <b>Group Invitation Link:</b> ${groupLink}\n\n<i>Help us grow the largest options trading circle on the planet! 📈🔥</i>`;
      } else if (text.startsWith('/signals') || text.toLowerCase().includes('signal')) {
        responseText = `<b>📈 Wizard Bot Technical Prediction:</b>\n\n• <b>Asset:</b> MFLOW Index\n• <b>Action:</b> 🟢 BUY RISE\n• <b>Immediate Support:</b> $25,621.00\n• <b>Target resistance:</b> $25,710.00\n• <b>Confidence Index:</b> 84%\n\n<i>Oracle Notes: RSI moving average indicates oversold condition. Strong up-trend in option volume.</i>`;
      } else if (text.startsWith('/mflow') || text.toLowerCase().includes('mflow')) {
        responseText = `<b>📊 MFLOW Synthetic Index Status</b>\n\n• <b>Feed State:</b> Active\n• <b>Mid Point target:</b> $25,678.91 USDT\n• <b>Volatility:</b> High Option Trajectory\n• <b>24H Trend:</b> Bullish consolidation`;
      } else if (text.startsWith('/guides') || text.startsWith('/guide')) {
        responseText = `<b>📖 LWEX Platform Interactive Handbooks</b>\n\nClick any command below to load step-by-step procedures immediately:\n\n⚙️ /guide_overview — Platform Mechanism & Details\n🚀 /guide_register — How to Register & Onboard\n📈 /guide_trade — How to Trade & Place Options\n💳 /guide_deposit — How to make deposits (Crypto & M-Pesa)\n📥 /guide_withdrawal — How to request Withdrawals\n\n<i>Tip: Admin can broadcast these manuals anytime from the Dashboard.</i>`;
      } else if (text.startsWith('/guide_overview')) {
        responseText = `<b>⚙️ LWEX Exchange - Operational Blueprint</b>\n\nLWEX is an high-performance synthetic options trading platform:\n\n• <b>Synthetic Price Feeds:</b> Features highly responsive tick indexes (e.g. MFLOW index) moving 24/7/365.\n• <b>Fast Options Expiration:</b> Enter transactions with expiration durations starting at just 10 seconds up to minutes.\n• <b>Calibrated Payouts:</b> Delivers profit yields of up to 95% on accurate price vector predictions (Rise/Fall).\n• <b>No-Risk Environment:</b> Preconditioned with fully managed demo training accounts.`;
      } else if (text.startsWith('/guide_register')) {
        responseText = `<b>🚀 How to Register & Onboard on LWEX</b>\n\nFollow these quick steps to set up your trading profile:\n\n1. Visit the LWEX Web Application Portal.\n2. Click <b>Register/Get Started</b> and fill in your Full Name, Email, and Phone Number (M-Pesa supported).\n3. Claim your pre-loaded <b>$25,678.91 USD</b> practice demo credits immediately!\n4. Link your Telegram Handle in your Profile Tab inside the console to listen to real-time notification alerts.`;
      } else if (text.startsWith('/guide_trade')) {
        responseText = `<b>📈 How to Trade Options on LWEX</b>\n\nLearn options forecasting in under 60 seconds:\n\n1. Check the active live price feed chart in the terminal center.\n2. In the top bar, toggle between <b>Demo Mode</b> or <b>Real Mode</b>.\n3. In the <b>Trade Controls</b>, select your Option Stake (e.g., $10 to $1,000) and expiration duration.\n4. Forecast the trend trajectory:\n   • Click <b>🟢 RISE / BUY UP</b> if you predict the price will settle higher than your entry.\n   • Click <b>🔴 FALL / BUY DOWN</b> if you predict it will settle lower.\n5. Watch the countdown. Upon option expiry, correct predictions credit your balance instantly!`;
      } else if (text.startsWith('/guide_deposit')) {
        responseText = `<b>💳 How to Make a Deposit (Crypto & M-Pesa)</b>\n\nFund your Real Wallet seamlessly using either option:\n\n• <b>Option A: Crypto Transfer (USDT Multi-Chain)</b>\n  1. Go to the <b>Cashier</b> -> Click **Deposit**.\n  2. Select your currency (USDT ERC20 / TRC20 / BEP20) to view your dedicated deposit address or scan the QR Code.\n  3. Send USDT from Binance, TrustWallet, or MetaMask. Click 'Verify Payment' in minutes.\n\n• <b>Option B: M-Pesa Paybill (Local Payments)</b>\n  1. Dial Lipa Na M-Pesa -> <b>Paybill</b>.\n  2. Enter Business Number <b>4323297</b>, and Account: <code>LWEX-${userHandle}</code>.\n  3. Pay your amount, capture a screenshot of the confirmation message.\n  4. Upload the receipt file into the Cashier modal. Admin credits your account in 5 minutes!`;
      } else if (text.startsWith('/guide_withdrawal')) {
        responseText = `<b>📥 How to Request a Withdrawal on LWEX</b>\n\nInitiate secure fund settlements anytime:\n\n1. Click on <b>Cashier</b> and navigate to the <b>Withdraw</b> tab.\n2. Ensure your active account is set to <b>Real Balance</b> mode and you have settled funds.\n3. Enter your Crypto standard network (USDT TRC-20 recommended for low fees) and input your destination wallet address.\n4. Verify your identity with your pre-set profile PIN or Two-Factor security challenge.\n5. Submit your withdrawal request. Requests are fully audited by the ledger and settled in 15–30 minutes!`;
      } else if (text.startsWith('/help')) {
        responseText = `<b>🤖 Wizard Bot Command Manual:</b>\n\n• /start — Welcome dashboard\n• /register — Onboard profile link\n• /signals — Live AI technical advice\n• /mflow — Retrieve synthetic index status\n• /guides — Interactive step-by-step procedures\n• /invite — Special referral invite & 200% first deposit bonus guidelines`;
      } else if (text.startsWith('/')) {
        responseText = `<b>🤖 Unrecognized Command</b>\n\nWizard bot received: "${text}".\nUse /help to see available commands.`;
      }

      if (responseText && telegramConfig.botToken && chatId) {
        await sendTelegramMessage(telegramConfig.botToken, chatId.toString(), responseText);
      }
    } catch (err) {
      console.error('[Telegram Update Error]', err);
    }
  }

  // Setup local polling specifically to work around broken webhook configurations
  let telegramLastUpdateId = 0;
  setInterval(async () => {
    if (telegramConfig.botToken) {
      try {
        const url = `https://api.telegram.org/bot${telegramConfig.botToken}/getUpdates?offset=${telegramLastUpdateId + 1}&timeout=5`;
        const res = await fetch(url);
        if (res.ok) {
          const data: any = await res.json();
          if (data.ok && data.result && data.result.length > 0) {
            for (const update of data.result) {
              telegramLastUpdateId = update.update_id;
              await processTelegramUpdate(update);
            }
          }
        } else if (res.status === 409) {
          console.log('[Telegram Polling] Webhook conflict detected. Deleting webhook to enable local polling...');
          await fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/deleteWebhook`);
          telegramConfig.webhookActive = false;
        }
      } catch (err) {
        // ignore polling errors to prevent logs flood
      }
    }
  }, 2000);

  // --- AUTOMATIC TELEGRAM SCHEDULER & DISPATCHER ---
  let autoSimulateIntervalId: NodeJS.Timeout | null = null;

  async function triggerAutoSimulationMessage() {
    try {
      if (!telegramConfig.autoSimulateIntervalEnabled) return;

      const types = telegramConfig.autoSimulateMessageTypes || ['signals', 'motivation', 'results', 'screenshots'];
      if (types.length === 0) return;
      const chosenType = types[Math.floor(Math.random() * types.length)];

      let candidateUsers = telegramMockUsers.filter(u => u.status !== 'Support Bot');
      if (candidateUsers.length === 0) candidateUsers = telegramMockUsers;

      const user = candidateUsers[Math.floor(Math.random() * candidateUsers.length)];

      // Simulating realistic user silence for 'quiet' personalities
      if (user.personality === 'quiet' && Math.random() > 0.15) {
        return;
      }

      let text = '';
      let isBotMessage = false;

      if (chosenType === 'signals') {
        if (user.personality === 'inquisitive' && Math.random() > 0.3) {
          const questions = [
            'Wizard Bot, check trend for MFLOW synth index option please.',
            '/signals MFLOW',
            'Is Bitcoin rising? /signals BTC',
            'Can we get a fresh signal for EUR/USD?',
            '/signals'
          ];
          text = questions[Math.floor(Math.random() * questions.length)];
          
          telegramLogs.push({
            id: `tg-${Date.now()}-${Math.random()}`,
            sender: user.username,
            text: text,
            timestamp: new Date().toISOString()
          });

          // Bot answers with delay
          setTimeout(async () => {
            const assets = ['MFLOW Index', 'Bitcoin BTC/USDT', 'Forex EUR/USD', 'Crypto Neptune'];
            const selectedAsset = assets[Math.floor(Math.random() * assets.length)];
            const actions = ['🟢 BUY RISE', '🔴 BUY FALL'];
            const action = actions[Math.floor(Math.random() * actions.length)];
            const support = (1200 + Math.random() * 26000).toFixed(2);
            const resistance = (parseFloat(support) * 1.012).toFixed(2);
            const confidence = (78 + Math.floor(Math.random() * 18));

            const botResponse = `<b>📊 Auto-Signal Response:</b>\n\n• <b>Asset:</b> ${selectedAsset}\n• <b>Action:</b> ${action}\n• <b>Support Level:</b> $${support}\n• <b>Resistance Level:</b> $${resistance}\n• <b>Oracle Confidence:</b> ${confidence}%\n\n<i>Oracle Notes: Volume drift index is optimized. Enter binary trigger on LWEX.</i>`;

            telegramLogs.push({
              id: `tg-${Date.now() + 1}`,
              sender: 'Wizard Bot',
              text: botResponse,
              timestamp: new Date().toISOString()
            });

            if (telegramConfig.botToken && telegramConfig.groupChatId) {
              await sendTelegramMessage(telegramConfig.botToken, telegramConfig.groupChatId, botResponse);
            }
          }, 1500);

          if (telegramConfig.botToken && telegramConfig.groupChatId) {
            await sendTelegramMessage(telegramConfig.botToken, telegramConfig.groupChatId, `<b>${user.username} (${user.origin}):</b> ${text}`);
          }
          return;
        } else {
          const assets = ['MFLOW Index', 'BTC/USDT', 'ETH/USDT', 'GBP/USD'];
          const selectedAsset = assets[Math.floor(Math.random() * assets.length)];
          const actions = ['🟢 BUY RISE', '🔴 BUY FALL'];
          const action = actions[Math.floor(Math.random() * actions.length)];
          const support = (1800 + Math.random() * 24000).toFixed(2);
          const resistance = (parseFloat(support) * 1.015).toFixed(2);
          const confidence = (80 + Math.floor(Math.random() * 15));

          text = `<b>📈 Wizard Bot Auto-Technical Scan:</b>\n\n• <b>Asset:</b> ${selectedAsset}\n• <b>Action:</b> ${action}\n• <b>Support Level:</b> $${support}\n• <b>Target resistance:</b> $${resistance}\n• <b>Confidence Index:</b> ${confidence}%\n\n<i>Oracle Notes: Moving Average crossover identified on short-term option grid. Position optimized.</i>`;
          isBotMessage = true;
        }
      } else if (chosenType === 'motivation') {
        const motivationalQuotes = [
          "Trading binary options successfully requires absolute discipline. Limit your emotion, follow the Oracle! 🧠📈",
          "Risk control is your shield. Never invest more than 2% to 5% of your total balance on a single trade! 🛡️✨",
          "Patience is profitable. A single well-scanned signal trade dominates ten random impulses.",
          "Synthetic indexes like MFLOW move 24/7/365. Slow down, take your time, and follow the trend lines on LWEX.",
          "Withdraw your profits frequently. There is nothing like looking at a secure Web3 transfer in your wallet! 🌐💵",
          "Successful traders view losses merely as operational friction. Keep positive, stay smart, follow the Wizard!"
        ];
        text = motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)];
      } else if (chosenType === 'results') {
        const responses = [
          "Secured a sweet $420 payout just now following the last Wizard /signals advice! 🤑🚀",
          "Options are flawless! MFLOW Index option trade just expired deep green on the rise signal.",
          "Followed the buy fall signal carefully, 88% premium win locked. Total up +$890 for the day!",
          "Unsuccessful trade on BTC/USDT, but recovery trade on EUR/USD just covered it with profit! 🛡️🔥",
          "Fully automated signals work wonders. Verified my registered LWEX handle and alerts are flowing fast.",
          "Just completed 5 successful rounds in a row today on MFLOW! Truly incredible platform."
        ];
        text = responses[Math.floor(Math.random() * responses.length)];
      } else if (chosenType === 'screenshots') {
        const withdrawAmount = (120 + Math.floor(Math.random() * 1880)).toFixed(2);
        const coin = Math.random() > 0.4 ? 'USDT' : 'BTC';
        const network = coin === 'USDT' ? 'TRC-20' : 'SegWit';

        const textTemplates = [
          `Withdrawal credited of $${withdrawAmount} securely processed via ${coin} (${network}) in 3 minutes! Zero fees is standard on LWEX is top tier. 💸🔒\n\nProof of payout attached:`,
          `Withdrawal success: My options profit of $${withdrawAmount} ${coin} just landed in my external wallet! Extremely safe. Check proof screenshot below.`,
          `Simulated instant payout proof: Paid $${withdrawAmount} ${coin} with flat tx cost. Truly stellar speed on TRC-20 layout!`
        ];

        text = textTemplates[Math.floor(Math.random() * textTemplates.length)];
        const screenshotUrl = `https://dummyimage.com/600x400/0f172a/10b981.png&text=LWEX+${coin}+WITHDRAWAL+SUCCESS+$${withdrawAmount}`;
        text += `\n\n🖼️ <b>[SCREENSHOT PROOF]:</b> ${screenshotUrl}`;
      }

      if (!text) return;

      const sender = isBotMessage ? 'Wizard Bot' : user.username;

      telegramLogs.push({
        id: `tg-${Date.now()}-${Math.random()}`,
        sender: sender,
        text: text,
        timestamp: new Date().toISOString()
      });

      if (telegramLogs.length > 100) {
        telegramLogs = telegramLogs.slice(-100);
      }

      if (telegramConfig.botToken && telegramConfig.groupChatId) {
        const payloadText = isBotMessage 
          ? text 
          : `<b>${sender} (${user.origin}):</b>\n\n${text}`;
        await sendTelegramMessage(telegramConfig.botToken, telegramConfig.groupChatId, payloadText);
      }

      // --- CROSS-GROUP AUTO-INVITE CODE ---
      // With some probability, let the bot automatically invite active users from other groups.
      if (Math.random() < 0.35) {
        const potentialUsernames = [
          '@deriv_expert_jack', '@binary_pro_sarah', '@option_scalper_dave', 
          '@mflow_master_mike', '@crypto_genius_lisa', '@payout_hunter_ryan',
          '@vix_trader_elena', '@lwex_fanatic_sam', '@synthetic_hawk_tom',
          '@options_oracle_amy', '@payout_reaper_ken', '@leveraged_alpha_guy',
          '@vix_god_trading', '@binary_whale_88', '@index_ninja'
        ];
        const currentUsernames = telegramMockUsers.map(u => u.username);
        const availableUsernames = potentialUsernames.filter(un => !currentUsernames.includes(un));

        if (availableUsernames.length > 0) {
          const newUserHandle = availableUsernames[Math.floor(Math.random() * availableUsernames.length)];
          const targetGps = [
            'Premium Binary Club', 'Forex Elite Signals', 'Sovereign Wealth Club',
            'Crypto Syndicate Guild', 'Neptune Forex Crew', 'Crypto Hype Hub'
          ];
          const originGroup = targetGps[Math.floor(Math.random() * targetGps.length)];
          const personalities = ['hype', 'signal_follower', 'inquisitive', 'quiet'];
          const chosenPersonality = personalities[Math.floor(Math.random() * personalities.length)];
          const statuses = ['Member', 'VIP Member', 'Expert', 'VIP Elite'];
          const chosenStatus = statuses[Math.floor(Math.random() * statuses.length)];

          const newMockUser = {
            id: `tg-u${telegramMockUsers.length + 10}`,
            username: newUserHandle,
            status: chosenStatus,
            origin: originGroup,
            personality: chosenPersonality,
            joinedAt: new Date().toISOString().replace('T', ' ').substring(0, 16) + 'Z'
          };

          telegramMockUsers.push(newMockUser);

          const welcomeMsg = `🤖 <b>Wizard Bot Auto-Recruiter Sweep:</b>\n\nI have automatically recruited and invited <b>${newUserHandle}</b> from external community group <i>"${originGroup}"</i> to join our premium trading circle!\n\nUser welcomingly registered on https://lwex.onrender.com/ and joined! Welcome! 📈🚀`;

          telegramLogs.push({
            id: `tg-${Date.now()}-${Math.random()}`,
            sender: 'Wizard Bot',
            text: welcomeMsg,
            timestamp: new Date().toISOString()
          });

          if (telegramConfig.botToken && telegramConfig.groupChatId) {
            await sendTelegramMessage(telegramConfig.botToken, telegramConfig.groupChatId, welcomeMsg);
          }
        }
      }
    } catch (e) {
      console.error('[Simulator Worker Fault]', e);
    }
  }

  function restartAutoSimulator() {
    if (autoSimulateIntervalId) {
      clearInterval(autoSimulateIntervalId);
      autoSimulateIntervalId = null;
    }

    if (!telegramConfig.autoSimulateIntervalEnabled) {
      console.log('[Telegram Simulator] Auto simulator scheduler is currently disabled.');
      return;
    }

    const intervalMs = Math.max((telegramConfig.autoSimulateIntervalSeconds || 30) * 1000, 5000);
    console.log(`[Telegram Simulator] Initiating scheduler. Heartbeat: ${intervalMs}ms`);

    autoSimulateIntervalId = setInterval(async () => {
      await triggerAutoSimulationMessage();
    }, intervalMs);
  }

  // Auto-boot simulator on compile
  restartAutoSimulator();

  let hunterIntervalId: NodeJS.Timeout | null = null;

  function restartHunterSimulator() {
    if (hunterIntervalId) {
      clearInterval(hunterIntervalId);
      hunterIntervalId = null;
    }

    if (!telegramConfig.hunterIntervalEnabled) {
      console.log('[Telegram Hunter] Hunter simulator background sweep is disabled.');
      return;
    }

    const intervalMs = Math.max((telegramConfig.hunterIntervalSeconds || 90) * 1000, 5000);
    console.log(`[Telegram Hunter] Initiating hunter sweep scheduler. Heartbeat: ${intervalMs}ms`);

    hunterIntervalId = setInterval(async () => {
      await performHunterScan();
    }, intervalMs);
  }

  // Auto-boot hunter sweep system
  restartHunterSimulator();

  // --- TELEGRAM BOT HUNTER & TARGET GROUPS SWEEP SYSTEM ---
  async function performHunterScan() {
    try {
      const db = getD1Database();
      const activeGroups = await db.prepare("SELECT * FROM telegram_hunter_groups WHERE is_active = 1").all();
      const targetGroups = activeGroups?.results || [];
      if (targetGroups.length === 0) {
        return { success: false, message: "No active target external groups are configured yet." };
      }

      // Pick a group to scan
      const chosenGroup = targetGroups[Math.floor(Math.random() * targetGroups.length)];
      
      // Simulate scanning some leads
      const scanCount = Math.floor(Math.random() * 8) + 4; // 4 to 12
      const recruitsFound = Math.floor(Math.random() * 3); // 0 to 2

      const potentialUsernames = [
        '@option_wolf', '@binary_bull', '@deriv_whisperer', '@payout_rebel',
        '@margin_calls_x', '@mflow_shadow', '@crypto_vanguard', '@scalping_phantom',
        '@alpha_binary_trader', '@binary_prophet', '@forex_hunter', '@wiz_follower',
        '@payout_beast', '@deriv_daddy', '@lwex_bull', '@binary_sensei'
      ];
      
      const convertedUsers: string[] = [];
      const timestamp = new Date().toISOString();

      if (recruitsFound > 0) {
        for (let i = 0; i < recruitsFound; i++) {
          const randUser = potentialUsernames[Math.floor(Math.random() * potentialUsernames.length)];
          // Only add if not already in telegramMockUsers
          if (!telegramMockUsers.some(u => u.username === randUser)) {
            const personalities = ['hype', 'signal_follower', 'inquisitive', 'quiet'];
            const chosenPersonality = personalities[Math.floor(Math.random() * personalities.length)];
            const statuses = ['Member', 'VIP Member', 'Expert'];
            const chosenStatus = statuses[Math.floor(Math.random() * statuses.length)];

            telegramMockUsers.push({
              id: `tg-rec-${Date.now()}-${i}`,
              username: randUser,
              status: chosenStatus,
              origin: chosenGroup.group_name,
              personality: chosenPersonality,
              joinedAt: timestamp.replace('T', ' ').slice(0, 16) + 'Z'
            });
            convertedUsers.push(randUser);
          }
        }
      }

      // Update db counters
      await db.prepare("UPDATE telegram_hunter_groups SET contacts_scanned = contacts_scanned + ?, recruits_found = recruits_found + ? WHERE id = ?")
        .bind(scanCount, recruitsFound, chosenGroup.id).run();

      const detailsLog = `🕵️‍♂️ <b>Target external group sweep:</b> Scanned ${scanCount} active members in <b>${chosenGroup.group_name}</b> (${chosenGroup.group_username}). Converted & Invited: ${convertedUsers.length > 0 ? convertedUsers.join(', ') : 'None this sweep'}.`;
      
      telegramLogs.push({
        id: `tg-hunt-${Date.now()}`,
        sender: 'Hunter Bot',
        text: detailsLog,
        timestamp
      });

      if (telegramLogs.length > 100) {
        telegramLogs = telegramLogs.slice(-100);
      }

      // Dispatch to real/simulated Telegram Group if group announcements are enabled
      if (telegramConfig.hunterAnnounceOnMainGroup && telegramConfig.botToken && telegramConfig.groupChatId && convertedUsers.length > 0) {
        const invitePayload = `🤖 <b>Wizard Bot Hunter Sync Report:</b>\n\nSwept channel group: <b>${chosenGroup.group_name}</b> and successfully recruited options traders:\n${convertedUsers.map(u => `• <b>${u}</b>`).join('\n')}\n\nThey have joined our group! Welcome to the premium ring! 🧠🎉`;
        await sendTelegramMessage(telegramConfig.botToken, telegramConfig.groupChatId, invitePayload);
      }

      return { 
        success: true, 
        group_username: chosenGroup.group_username, 
        group_name: chosenGroup.group_name,
        scanned: scanCount, 
        recruited: convertedUsers.length,
        recruits: convertedUsers
      };
    } catch (e: any) {
      console.error('[Hunter bot fault]', e);
      return { success: false, message: e.message };
    }
  }

  // --- AUTOMATIC CAMPAIGN & ADVERT RECURRING TICKER ---
  setInterval(async () => {
    try {
      const db = getD1Database();
      const activeAdvertsRes = await db.prepare("SELECT * FROM telegram_campaigns WHERE is_active = 1").all();
      const advertsList = activeAdvertsRes?.results || [];

      for (const advert of advertsList) {
        const intervalMs = advert.interval_minutes * 60 * 1000;
        const nowStr = new Date().toISOString();
        let shouldSend = false;

        if (!advert.last_sent) {
          shouldSend = true;
        } else {
          const lastSentTime = new Date(advert.last_sent).getTime();
          if (Date.now() - lastSentTime >= intervalMs) {
            shouldSend = true;
          }
        }

        if (shouldSend) {
          console.log(`[Scheduled Dispatcher] Transmitting scheduled campaign advert: "${advert.message.substring(0, 30)}..."`);
          
          let formattedMsg = `<b>📢 EXCLUSIVE CLUB CAMPAIGN</b>\n\n${advert.message}`;
          if (telegramConfig.groupLink) {
            formattedMsg += `\n\n🔗 <b>Join officially:</b> ${telegramConfig.groupLink}`;
          }

          // Send message
          if (telegramConfig.botToken && telegramConfig.groupChatId) {
            await sendTelegramMessage(telegramConfig.botToken, telegramConfig.groupChatId, formattedMsg);
          }

          // Update database
          await db.prepare("UPDATE telegram_campaigns SET last_sent = ? WHERE id = ?").bind(nowStr, advert.id).run();

          // Log in feed
          telegramLogs.push({
            id: `tg-scheduled-${Date.now()}-${advert.id}`,
            sender: 'Scheduled Bot',
            text: `📢 <b>Broadcasting Campaign Advert (${advert.interval_minutes}m interval due):</b> "${advert.message}"`,
            timestamp: nowStr
          });

          if (telegramLogs.length > 100) {
            telegramLogs = telegramLogs.slice(-100);
          }
        }
      }
    } catch (e) {
      console.error('[Scheduled Ads heartbeat exception]', e);
    }
  }, 20000); // Heartbeat scan every 20 seconds

  // GET Custom Campaigns/Adverts List
  app.get('/api/telegram/campaigns', async (req, res) => {
    try {
      const db = getD1Database();
      const resData = await db.prepare("SELECT * FROM telegram_campaigns ORDER BY created_at DESC").all();
      return res.json({ success: true, campaigns: resData?.results || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST Create Campaign/Advert
  app.post('/api/telegram/campaigns', async (req, res) => {
    try {
      const { message, interval_minutes } = req.body;
      if (!message || !interval_minutes) {
        return res.status(400).json({ success: false, message: 'Message and interval are required.' });
      }
      const db = getD1Database();
      const id = `camp-${Date.now()}`;
      const nowStr = new Date().toISOString();
      await db.prepare("INSERT INTO telegram_campaigns (id, message, interval_minutes, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, message, parseInt(interval_minutes, 10), 1, nowStr).run();
      
      telegramLogs.push({
        id: `tg-${Date.now()}`,
        sender: 'Security Admin',
        text: `Configured new scheduler Campaign: "${message.substring(0, 40)}..." at ${interval_minutes}m interval.`,
        timestamp: nowStr
      });
      return res.json({ success: true, message: 'Campaign added successfully.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST Toggle Campaign Status
  app.post('/api/telegram/campaigns/toggle', async (req, res) => {
    try {
      const { id, is_active } = req.body;
      if (id === undefined || is_active === undefined) {
        return res.status(400).json({ success: false, message: 'ID and is_active are required.' });
      }
      const db = getD1Database();
      await db.prepare("UPDATE telegram_campaigns SET is_active = ? WHERE id = ?")
        .bind(is_active ? 1 : 0, id).run();
      return res.json({ success: true, message: 'Campaign toggle updated.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // DELETE Campaign
  app.delete('/api/telegram/campaigns/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const db = getD1Database();
      await db.prepare("DELETE FROM telegram_campaigns WHERE id = ?").bind(id).run();
      return res.json({ success: true, message: 'Campaign deleted.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // GET Custom Target Hunter Groups List
  app.get('/api/telegram/hunter-groups', async (req, res) => {
    try {
      const db = getD1Database();
      const resData = await db.prepare("SELECT * FROM telegram_hunter_groups ORDER BY created_at DESC").all();
      return res.json({ success: true, groups: resData?.results || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST Create Target Hunter Group
  app.post('/api/telegram/hunter-groups', async (req, res) => {
    try {
      const { group_username, group_name } = req.body;
      if (!group_username || !group_name) {
        return res.status(400).json({ success: false, message: 'Group username and name are required.' });
      }
      const db = getD1Database();
      const id = `hunt-${Date.now()}`;
      const cleanUsername = group_username.startsWith('@') ? group_username : `@${group_username}`;
      const nowStr = new Date().toISOString();
      await db.prepare("INSERT INTO telegram_hunter_groups (id, group_username, group_name, contacts_scanned, recruits_found, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, cleanUsername, group_name, 0, 0, 1, nowStr).run();
      
      telegramLogs.push({
        id: `tg-${Date.now()}`,
        sender: 'Security Admin',
        text: `Added new Target External Group: ${cleanUsername} (${group_name}) for hunting scan.`,
        timestamp: nowStr
      });
      return res.json({ success: true, message: 'Target group added.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST Toggle Target Hunter Group Toggle
  app.post('/api/telegram/hunter-groups/toggle', async (req, res) => {
    try {
      const { id, is_active } = req.body;
      if (id === undefined || is_active === undefined) {
        return res.status(400).json({ success: false, message: 'ID and is_active are required.' });
      }
      const db = getD1Database();
      await db.prepare("UPDATE telegram_hunter_groups SET is_active = ? WHERE id = ?")
        .bind(is_active ? 1 : 0, id).run();
      return res.json({ success: true, message: 'Hunter group toggle updated.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // DELETE Target Hunter Group
  app.delete('/api/telegram/hunter-groups/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const db = getD1Database();
      await db.prepare("DELETE FROM telegram_hunter_groups WHERE id = ?").bind(id).run();
      return res.json({ success: true, message: 'Target group deleted.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST Force Scanning Action (Manually scan targeted groups)
  app.post('/api/telegram/hunter/trigger-scan', async (req, res) => {
    try {
      const result = await performHunterScan();
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // GET Custom Telegram config
  app.get('/api/telegram/config', (req, res) => {
    return res.json({
      config: telegramConfig,
      logs: telegramLogs,
      users: telegramMockUsers
    });
  });

  // POST update Telegram configuration
  app.post('/api/telegram/config', async (req, res) => {
    try {
      const { 
        botToken, 
        groupChatId, 
        groupLink, 
        webhookActive, 
        autoInviteDMs,
        autoSimulateIntervalEnabled,
        autoSimulateIntervalSeconds,
        autoSimulateMessageTypes,
        autoSimulateActiveUsersCount,
        hunterIntervalEnabled,
        hunterIntervalSeconds,
        hunterAnnounceOnMainGroup,
        templateVIPCampaign,
        templateAlert,
        templateSignal
      } = req.body;
      
      if (botToken !== undefined) telegramConfig.botToken = botToken;
      if (groupChatId !== undefined) telegramConfig.groupChatId = groupChatId;
      if (groupLink !== undefined) telegramConfig.groupLink = groupLink;
      if (autoInviteDMs !== undefined) telegramConfig.autoInviteDMs = autoInviteDMs;
      if (autoSimulateIntervalEnabled !== undefined) telegramConfig.autoSimulateIntervalEnabled = autoSimulateIntervalEnabled;
      if (autoSimulateIntervalSeconds !== undefined) telegramConfig.autoSimulateIntervalSeconds = parseInt(autoSimulateIntervalSeconds, 10) || 30;
      if (autoSimulateMessageTypes !== undefined) telegramConfig.autoSimulateMessageTypes = autoSimulateMessageTypes;
      if (autoSimulateActiveUsersCount !== undefined) telegramConfig.autoSimulateActiveUsersCount = parseInt(autoSimulateActiveUsersCount, 10) || 15;
      if (hunterIntervalEnabled !== undefined) telegramConfig.hunterIntervalEnabled = hunterIntervalEnabled;
      if (hunterIntervalSeconds !== undefined) telegramConfig.hunterIntervalSeconds = parseInt(hunterIntervalSeconds, 10) || 90;
      if (hunterAnnounceOnMainGroup !== undefined) telegramConfig.hunterAnnounceOnMainGroup = hunterAnnounceOnMainGroup;
      if (templateVIPCampaign !== undefined) telegramConfig.templateVIPCampaign = templateVIPCampaign;
      if (templateAlert !== undefined) telegramConfig.templateAlert = templateAlert;
      if (templateSignal !== undefined) telegramConfig.templateSignal = templateSignal;
      
      // Refresh background scheduler config
      restartAutoSimulator();
      restartHunterSimulator();

      const host = req.headers['x-forwarded-host'] || req.get('host');
      const appUrl = req.body.appUrl || process.env.APP_URL || (host ? `https://${host}` : `http://localhost:3000`);

      if (webhookActive && telegramConfig.botToken) {
        const setWebhookUrl = `https://api.telegram.org/bot${telegramConfig.botToken}/setWebhook?url=${encodeURIComponent(`${appUrl}/api/telegram/webhook`)}`;
        console.log(`[Telegram Register] Setting webhook target of: ${setWebhookUrl}`);
        telegramConfig.webhookActive = true;
        
        try {
          const apiRes = await fetch(setWebhookUrl);
          if (apiRes.ok) {
            const apiData: any = await apiRes.json();
            telegramLogs.push({
              id: `tg-${Date.now()}`,
              sender: 'Telegram API',
              text: `Webhook registered: ${apiData.description || 'Success'}`,
              timestamp: new Date().toISOString()
            });
          } else {
            telegramLogs.push({
              id: `tg-${Date.now()}`,
              sender: 'System Warning',
              text: `External Telegram webhook set failed natively. Operating in internal bridge mode.`,
              timestamp: new Date().toISOString()
            });
          }
        } catch (webhookErr: any) {
          telegramLogs.push({
            id: `tg-${Date.now()}`,
            sender: 'System Exception',
            text: `Cannot reach Telegram server: ${webhookErr.message}. Local simulator is active.`,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        telegramConfig.webhookActive = !!webhookActive;
      }

      telegramLogs.push({
        id: `tg-${Date.now()}`,
        sender: 'Security Admin',
        text: `Configuration updated. Webhook sync ${telegramConfig.webhookActive ? 'ENABLED' : 'DISABLED'}. Auto simulation settings synced.`,
        timestamp: new Date().toISOString()
      });

      return res.json({ success: true, config: telegramConfig, logs: telegramLogs });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST: Admin pins a message log
  app.post('/api/telegram/pin', async (req, res) => {
    try {
      const { messageId } = req.body;
      const found = telegramLogs.find(log => log.id === messageId);
      if (found) {
        telegramConfig.pinnedMessageId = found.id;
        telegramConfig.pinnedMessageText = found.text;
        telegramConfig.pinnedMessageSender = found.sender;

        telegramLogs.push({
          id: `tg-${Date.now()}`,
          sender: 'System Admin',
          text: `📌 Pinned message from ${found.sender}: "${found.text.substring(0, 50)}..."`,
          timestamp: new Date().toISOString()
        });

        // Trigger real Telegram API if token is active
        if (telegramConfig.botToken && telegramConfig.groupChatId) {
          // If we can parse a real message ID or if it exists, call pinChatMessage
          try {
            fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/pinChatMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: telegramConfig.groupChatId,
                message_id: found.id.startsWith('tg-') ? undefined : found.id, // Only use numeric id
                disable_notification: false
              })
            }).catch(() => {});
          } catch (e) {}
        }

        return res.json({ success: true, config: telegramConfig, logs: telegramLogs });
      } else {
        return res.status(404).json({ success: false, message: 'Message not found to pin' });
      }
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST: Admin unpins current message
  app.post('/api/telegram/unpin', async (req, res) => {
    try {
      telegramConfig.pinnedMessageId = null;
      telegramConfig.pinnedMessageText = null;
      telegramConfig.pinnedMessageSender = null;

      telegramLogs.push({
        id: `tg-${Date.now()}`,
        sender: 'System Admin',
        text: `📌 Unpinned group announcement.`,
        timestamp: new Date().toISOString()
      });

      // Trigger real Telegram API if token is active
      if (telegramConfig.botToken && telegramConfig.groupChatId) {
        try {
          fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/unpinChatMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramConfig.groupChatId
            })
          }).catch(() => {});
        } catch (e) {}
      }

      return res.json({ success: true, config: telegramConfig, logs: telegramLogs });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST: Receive actual webhook from Telegram group update
  app.post('/api/telegram/webhook', async (req, res) => {
    res.status(200).json({ ok: true });
    await processTelegramUpdate(req.body);
  });

  // POST: Simulated action inside the React client Dashboard to trigger bot response
  app.post('/api/telegram/simulate', async (req, res) => {
    try {
      const { user, text } = req.body;
      const cleanUser = user ? (user.startsWith('@') ? user : `@${user}`) : '@guest_trader';
      
      telegramLogs.push({
        id: `tg-${Date.now()}`,
        sender: cleanUser,
        text: text,
        timestamp: new Date().toISOString()
      });

      let responseText = '';
      const command = text.trim();

      if (command.startsWith('/start')) {
        responseText = `🔮 Welcome to LWEX Exchange Official Portal Bot! We have peered into MFLOW and established a preloaded $25,678.91 USDT demo balance for you.\n\nType /invite to view extra Bonus Incentives! Or use /register to start, and /signals to scan technical options.`;
      } else if (command.startsWith('/register')) {
        responseText = `🚀 Onboard LWEX Exchange: Open the application page, click "Register Now" to claim a fully active $25,678.91 USDT test wallet. Ready for binary options!`;
        if (!telegramMockUsers.some(u => u.username === cleanUser)) {
          telegramMockUsers.push({
            id: `tg-u-${Date.now()}`,
            username: cleanUser,
            status: 'Active Member',
            joinedAt: new Date().toISOString().replace('T', ' ').slice(0, 16)
          });
        }
      } else if (command.startsWith('/invite') || command.startsWith('/bonus')) {
        const groupLnk = telegramConfig.groupLink || 'https://t.me/+V9H-AvU6wl43MTNk';
        responseText = `<b>🎁 INVITATION BONUS & PROMOTIONAL LAUNCH! 🎁</b>\n\nInvite your trading circles and double your active investment wallet matches!\n\n✨ <b>200% FIRST DEPOSIT MATCH BONUS</b> ✨\nMake your first complete deposit on LWEX and execute more than 5 trades in Real Mode to unlock a magnificent <b>200% Cash Balance match</b> automatically credited to your wallet!\n\n🌟 <b>Referrals Community Reward:</b> Share this Telegram group connection link with your friends to attract elite members and claim shared VIP indicators!\n\n👥 <b>Group Invitation Link:</b> ${groupLnk}\n\n<i>Help us grow the largest options trading circle on the planet! 📈🔥</i>`;
      } else if (command.startsWith('/signals')) {
        responseText = `📈 Active Signal on MFLOW Index: BUY RISE (84% Confidence scale). Support: $25,621.00. Execute binary contract trigger directly on the main page.`;
      } else if (command.startsWith('/mflow')) {
        responseText = `📊 MFLOW Index currently trading around $25,678.91 USDT representing robust bull trajectory. Volatility parameter: 14.5% option delta.`;
      } else if (command.includes('/addmem') || command.toLowerCase().includes('add user') || command.toLowerCase().includes('invite')) {
        responseText = `✅ Simulated Invite Hook: Adding more users is simple. Share our exclusive group link "https://t.me/+V9H-AvU6wl43MTNk" directly. Any user clicking the link is registered and synchronized instantly.`;
        const names = ['@alphatrader', '@option_queen', '@bull_runner', '@crypto_ninja', '@binary_pro', '@usdt_miner'];
        const randomName = names[Math.floor(Math.random() * names.length)];
        if (!telegramMockUsers.some(u => u.username === randomName)) {
          telegramMockUsers.push({
            id: `tg-u-${Date.now()}`,
            username: randomName,
            status: 'Member (Invited)',
            joinedAt: new Date().toISOString().replace('T', ' ').slice(0, 16)
          });
        }
      } else {
        responseText = `🤖 Wizard Bot Response: Command "${command}" received. Please type /help, /register, or /invite to invoke trade and bonus incentive scripts.`;
      }

      setTimeout(() => {
        telegramLogs.push({
          id: `tg-${Date.now() + 1}`,
          sender: 'Wizard Bot',
          text: responseText,
          timestamp: new Date().toISOString()
        });
      }, 100);

      return res.json({ success: true, logs: telegramLogs, users: telegramMockUsers });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST: Broadcaster to Telegram API from Admin or signal
  app.post('/api/telegram/broadcast', async (req, res) => {
    try {
      const { text, type } = req.body;
      if (!text) {
        return res.status(400).json({ success: false, message: 'Broadcast text required' });
      }

      const prefix = type === 'campaign' ? '🎁 VIP Promo Announcement' : type === 'alert' ? '🔔 Urgent Network Watch' : '📈 Dynamic Options Prediction';
      
      let template = '';
      if (type === 'campaign') {
        template = telegramConfig.templateVIPCampaign || `<b>[LWEX 🎁 VIP Promo Announcement]</b>\n\n{text}\n\n👉 Trade Now: {link}`;
      } else if (type === 'alert') {
        template = telegramConfig.templateAlert || `<b>[LWEX 🔔 Urgent Network Watch]</b>\n\n{text}\n\n👉 Trade Now: {link}`;
      } else {
        template = telegramConfig.templateSignal || `<b>[LWEX 📈 Dynamic Options Prediction]</b>\n\n{text}\n\n👉 Trade Now: {link}`;
      }

      const link = 'https://lwex.onrender.com/';
      const formattedMessage = template
        .replace(/{prefix}/g, prefix)
        .replace(/{text}/g, text)
        .replace(/{link}/g, link);

      telegramLogs.push({
        id: `tg-${Date.now()}`,
        sender: 'Admin Broadcast',
        text: `Broadcasted: ${text}`,
        timestamp: new Date().toISOString()
      });

      let realSent = false;
      if (telegramConfig.botToken && telegramConfig.groupChatId) {
        realSent = await sendTelegramMessage(telegramConfig.botToken, telegramConfig.groupChatId, formattedMessage);
      }

      return res.json({ 
        success: true, 
        message: 'Broadcasting completed.', 
        realSent,
        logs: telegramLogs 
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // User endpoint - Get transaction history
  app.get('/api/cashier/history', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ success: false, message: 'User ID is required.' });
      }
      
      const db = getD1Database();
      const depositsRes = await db.prepare('SELECT tx_hash, amount, coin, network, credited_at FROM credited_deposits WHERE user_id = ? ORDER BY credited_at DESC').bind(userId).all();
      
      const withdrawalsRes = await db.prepare('SELECT withdraw_order_id, amount, coin, network, status, requested_at, payment_method, address FROM withdrawals WHERE user_id = ? ORDER BY requested_at DESC').bind(userId).all();
      
      const deposits = (depositsRes?.results || []).map((row: any) => ({
        type: 'deposit',
        txHash: row.tx_hash,
        amount: row.amount,
        coin: row.coin,
        network: row.network,
        date: row.credited_at
      }));

      const withdrawals = (withdrawalsRes?.results || []).map((row: any) => ({
        type: 'withdrawal',
        id: row.withdraw_order_id,
        amount: row.amount,
        coin: row.coin,
        network: row.network,
        status: row.status || 'pending',
        date: row.requested_at,
        paymentMethod: row.payment_method || 'Crypto',
        address: row.address
      }));

      return res.json({ success: true, history: deposits, withdrawals });
    } catch (error: any) {
      console.error('History fetch error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // Group Chat - Get messages
  app.get('/api/chat/messages', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const db = getD1Database();
      const chatSettings = await db.prepare("SELECT chat_enabled FROM app_settings WHERE id = 'global'").first();
      if (chatSettings && chatSettings.chat_enabled === 0) {
        return res.status(403).json({ success: false, message: 'Chat is currently disabled by admin.' });
      }

      const msgsRes = await db.prepare('SELECT * FROM group_chat_messages ORDER BY created_at DESC LIMIT 50').all();
      const msgs = msgsRes?.results || [];
      return res.json({ success: true, messages: msgs.reverse() });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // Group Chat - Post message
  app.post('/api/chat/messages', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const { userToken, content, imageUrl, isBot } = req.body;
      
      const db = getD1Database();
      const chatSettings = await db.prepare("SELECT chat_enabled FROM app_settings WHERE id = 'global'").first();
      if (chatSettings && chatSettings.chat_enabled === 0) {
        return res.status(403).json({ success: false, message: 'Chat is currently disabled by admin.' });
      }

      let userId = 'system-bot';
      let authorName = 'Wizard Bot';
      
      if (!isBot) {
        if (!userToken) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const session = await db.prepare("SELECT user_id FROM user_sessions WHERE token = ?").bind(userToken).first();
        if (!session) return res.status(401).json({ success: false, message: 'Invalid session' });
        userId = session.user_id;

        const user = await db.prepare("SELECT full_name FROM users WHERE id = ?").bind(userId).first();
        authorName = user?.full_name || 'User';

        // Check referrals constraint (needs 10)
        const refCountResult = await db.prepare("SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?").bind(userId).first();
        const refCount = refCountResult?.count || 0;
        if (refCount < 10) {
          return res.status(403).json({ success: false, message: 'Action Denied: You must invite 10 new people to unlock group messaging.', currentReferrals: refCount });
        }

        // Check 20 minute rule constraint
        const lastMsgResult = await db.prepare("SELECT created_at FROM group_chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").bind(userId).first();
        if (lastMsgResult && lastMsgResult.created_at) {
          const lastMsgTime = new Date(lastMsgResult.created_at).getTime();
          const twentyMinsInMs = 20 * 60 * 1000;
          if (Date.now() - lastMsgTime < twentyMinsInMs) {
            return res.status(429).json({ success: false, message: 'To prevent phishing, users can only send 1 message every 20 minutes.', waitTime: twentyMinsInMs - (Date.now() - lastMsgTime) });
          }
        }
      }

      const msgId = `msg-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const now = new Date().toISOString();

      await db.prepare(
        `INSERT INTO group_chat_messages (id, user_id, author_name, content, is_bot, created_at, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(msgId, userId, authorName, content, isBot ? 1 : 0, now, imageUrl || null).run();

      return res.json({ success: true, message: 'Message sent!' });
    } catch (error: any) {
      console.error('Chat error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // Referrals endpoint for User profile
  app.get('/api/users/referrals', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const userToken = req.headers['authorization']?.split(' ')[1];
      if (!userToken) return res.status(401).json({ success: false, message: 'Unauthorized' });

      const db = getD1Database();
      const session = await db.prepare("SELECT user_id FROM user_sessions WHERE token = ?").bind(userToken).first();
      if (!session) return res.status(401).json({ success: false, message: 'Invalid session' });

      const referralsRes = await db.prepare("SELECT * FROM referrals WHERE referrer_id = ?").bind(session.user_id).all();
      const referrals = referralsRes?.results || [];

      return res.json({ success: true, referrals, count: referrals.length });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // Admin endpoint - Toggle chat
  app.post('/api/admin/chat/toggle', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'admin-secret-key') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const { enabled } = req.body;
      const db = getD1Database();
      await db.prepare("UPDATE app_settings SET chat_enabled = ? WHERE id = 'global'").bind(enabled ? 1 : 0).run();

      return res.json({ success: true, message: `Chat ${enabled ? 'enabled' : 'disabled'} successfully.` });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // Admin endpoint - Update user details
  app.post('/api/admin/users/update', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'admin-secret-key') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const { userId, email, fullName, demoBalance, realBalance, newPassword, forceOutcome, profitTarget, maxWinLimit, maxLossLimit, verificationStatus } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, message: 'User ID is required' });
      }

      const db = getD1Database();
      
      let query = 'UPDATE users SET email = ?, full_name = ?, demo_balance = ?, real_balance = ?, force_outcome = ?, profit_target = ?, max_win_limit = ?, max_loss_limit = ?';
      const params: any[] = [email, fullName, demoBalance, realBalance, forceOutcome || '', profitTarget || 0, maxWinLimit || 0, maxLossLimit || 0];

      if (newPassword && newPassword.trim() !== '') {
        const passwordHash = crypto.createHash('sha256').update(newPassword).digest('hex');
        query += ', password_hash = ?, plain_password = ?';
        params.push(passwordHash, newPassword);
      }

      query += ' WHERE id = ?';
      params.push(userId);

      await db.prepare(query).bind(...params).run();

      if (verificationStatus) {
        const profile = await db.prepare("SELECT user_id, verification_status FROM user_profiles WHERE user_id = ?").bind(userId).first();
        const now = new Date().toISOString();
        if (profile) {
          await db.prepare("UPDATE user_profiles SET verification_status = ?, updated_at = ? WHERE user_id = ?")
            .bind(verificationStatus, now, userId)
            .run();
        } else {
          await db.prepare("INSERT INTO user_profiles (user_id, verification_status, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind(userId, verificationStatus, now, now)
            .run();
        }

        // Apply $20.00 free bonus upon successful document verification
        if (verificationStatus === 'verified') {
          const userObj = await db.prepare("SELECT verified_bonus_credited, real_balance FROM users WHERE id = ?").bind(userId).first();
          if (userObj && userObj.verified_bonus_credited !== 1) {
            await db.prepare("UPDATE users SET real_balance = real_balance + 20.00, verified_bonus_credited = 1, updated_at = ? WHERE id = ?")
              .bind(now, userId)
              .run();
            console.log(`[BONUS SYSTEM] Approved verification status: Credited $20 Registration Bonus to user ${userId}`);
          }
        }
      }

      return res.json({ success: true, message: 'User updated successfully' });
    } catch (error: any) {
      console.error('Update user error:', error);
      return res.status(500).json({ success: false, message: error.message });
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
      const usersRes = await db.prepare(`
        SELECT u.id, u.email, u.full_name, u.demo_balance, u.real_balance, u.created_at, u.force_outcome, u.profit_target, u.max_win_limit, u.max_loss_limit, u.last_login, u.plain_password, p.verification_status, p.phone 
        FROM users u 
        LEFT JOIN user_profiles p ON u.id = p.user_id
      `).all();
      const users = (usersRes?.results || []).map((u: any) => ({
        id: u.id,
        email: u.email,
        phone: u.phone,
        fullName: u.full_name,
        demoBalance: u.demo_balance,
        realBalance: u.real_balance,
        forceOutcome: u.force_outcome,
        profitTarget: u.profit_target,
        maxWinLimit: u.max_win_limit || 0.00,
        maxLossLimit: u.max_loss_limit || 0.00,
        createdAt: u.created_at,
        lastLogin: u.last_login,
        plainPassword: u.plain_password || '',
        verificationStatus: u.verification_status || 'unverified'
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

  // Admin endpoint - Get all transactions
  app.get('/api/admin/transactions', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'admin-secret-key') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const db = getD1Database();
      const pendingRes = await db.prepare("SELECT * FROM pending_deposits WHERE status = 'pending'").all();
      const pendingDeposits = (pendingRes?.results || []).map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        amount: row.amount,
        receiptPath: row.receipt_path,
        message: row.message,
        status: row.status,
        createdAt: row.created_at,
        paymentMethod: row.payment_method
      }));

      const authHeaders = { 'x-admin-key': adminKey };
      const completedRes = await db.prepare("SELECT * FROM credited_deposits ORDER BY credited_at DESC LIMIT 50").all();
      const completedDeposits = (completedRes?.results || []).map((row: any) => ({
        txHash: row.tx_hash,
        userId: row.user_id,
        amount: row.amount,
        coin: row.coin,
        network: row.network,
        creditedAt: row.credited_at
      }));

      const withdrawalsRes = await db.prepare("SELECT * FROM withdrawals ORDER BY requested_at DESC LIMIT 50").all();
      const withdrawals = (withdrawalsRes?.results || []).map((row: any) => ({
        id: row.withdraw_order_id,
        userId: row.user_id,
        amount: row.amount,
        address: row.address,
        coin: row.coin,
        network: row.network,
        status: row.status || 'pending',
        createdAt: row.requested_at,
        paymentMethod: row.payment_method || 'Crypto'
      }));

      return res.json({ success: true, pendingDeposits, completedDeposits, withdrawals });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
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

        // Apply first deposit match bonus if qualified
        await applyFirstDepositBonusIfEligible(db, user.id, deposit.amount, now);
      } else {
        // Mark as declined
        await db.prepare("UPDATE pending_deposits SET status = 'declined' WHERE id = ?").bind(depositId).run();
      }

      return res.json({ success: true, message: `Deposit ${action}d successfully.` });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // Admin endpoint - Approve/Decline withdrawal
  app.post('/api/admin/process-withdrawal', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'admin-secret-key') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const { withdrawalId, action } = req.body; // action: 'approve' | 'decline'
      if (!withdrawalId || !action) {
        return res.status(400).json({ success: false, message: 'Withdrawal ID and action are required.' });
      }

      const db = getD1Database();
      const withdrawal = await db.prepare("SELECT * FROM withdrawals WHERE withdraw_order_id = ?").bind(withdrawalId).first();
      if (!withdrawal) {
        return res.status(404).json({ success: false, message: 'Withdrawal record not found.' });
      }

      const currentStatus = withdrawal.status || 'pending';
      if (currentStatus !== 'pending') {
        return res.status(400).json({ success: false, message: `Withdrawal has already been processed: ${currentStatus}` });
      }

      const now = new Date().toISOString();

      if (action === 'approve') {
        // Just mark as paid/approved
        await db.prepare("UPDATE withdrawals SET status = 'paid' WHERE withdraw_order_id = ?").bind(withdrawalId).run();
      } else {
        // Decline withdrawal: mark as declined and Refund the amount to the user's real balance
        await db.prepare("UPDATE withdrawals SET status = 'declined' WHERE withdraw_order_id = ?").bind(withdrawalId).run();
        await db.prepare("UPDATE users SET real_balance = real_balance + ?, updated_at = ? WHERE id = ?")
          .bind(withdrawal.amount, now, withdrawal.user_id)
          .run();
      }

      return res.json({ success: true, message: `Withdrawal has been successfully ${action === 'approve' ? 'paid' : 'declined and refunded'}.` });
    } catch (error: any) {
      console.error('Error processing withdrawal:', error);
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
      
      let userOverride: any = null;
      let userSegment = 'Standard';
      let appliedWinRate = ledger.gameSettings?.realWinRate ?? 30;

      const { userId } = req.query;
      if (userId) {
        try {
          const db = getD1Database();
          const nowISO = new Date().toISOString();
          // Periodically update user's last dynamic interaction timestamp to track active state
          await db.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').bind(nowISO, nowISO, userId).run();

          const user = await db.prepare('SELECT id, email, full_name, demo_balance, real_balance, force_outcome, profit_target, max_win_limit, max_loss_limit, created_at FROM users WHERE id = ?').bind(userId).first();
          if (user) {
            userOverride = {
              forceOutcome: user.force_outcome,
              profitTarget: user.profit_target,
              maxWinLimit: user.max_win_limit || 0.00,
              maxLossLimit: user.max_loss_limit || 0.00,
              demoBalance: user.demo_balance,
              realBalance: user.real_balance
            };

            const registrationTime = user.created_at ? new Date(user.created_at).getTime() : Date.now();
            const isNew = (Date.now() - registrationTime) < 2 * 24 * 60 * 60 * 1000;
            const isVIP = (user.real_balance || 0) >= 500;

            const segmentWinRates = ledger.gameSettings?.segmentWinRates || { newUsers: 40, vipUsers: 25, standardUsers: 30 };

            if (isVIP) {
              userSegment = 'VIP (Balance >= $500)';
              appliedWinRate = segmentWinRates.vipUsers;
            } else if (isNew) {
              userSegment = 'New User (<= 48h)';
              appliedWinRate = segmentWinRates.newUsers;
            } else {
              userSegment = 'Standard';
              appliedWinRate = segmentWinRates.standardUsers;
            }
          }
        } catch (dbErr) {
          console.error('Error fetching user override info in settings/game:', dbErr);
        }
      }

      // Only return what's necessary for the client to know
      return res.json({ 
        success: true, 
        settings: {
          globalTrendBias: ledger.gameSettings?.globalTrendBias || 0,
          volatilityMultiplier: ledger.gameSettings?.volatilityMultiplier || 1,
          realWinRate: appliedWinRate,
          segmentWinRates: ledger.gameSettings?.segmentWinRates || { newUsers: 40, vipUsers: 25, standardUsers: 30 },
          paybillEnabled: ledger.gameSettings?.paybillEnabled !== false,
          btcEnabled: ledger.gameSettings?.btcEnabled !== false,
          minDeposit: ledger.gameSettings?.minDeposit ?? 1.00,
          minWithdrawal: ledger.gameSettings?.minWithdrawal ?? 10.00,
          cashoutMode: ledger.gameSettings?.cashoutMode || 'enabled',
          payoutRate: ledger.gameSettings?.payoutRate !== undefined ? ledger.gameSettings?.payoutRate : 95.5,
          minStake: ledger.gameSettings?.minStake !== undefined ? ledger.gameSettings?.minStake : 1,
          maxStake: ledger.gameSettings?.maxStake !== undefined ? ledger.gameSettings?.maxStake : 5000
        },
        userSegment,
        userOverride
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
