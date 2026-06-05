var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
var import_genai = require("@google/genai");
var import_dotenv = __toESM(require("dotenv"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var import_promises = __toESM(require("fs/promises"), 1);
var import_multer = __toESM(require("multer"), 1);
var import_nodemailer = __toESM(require("nodemailer"), 1);
var import_node_sqlite = require("node:sqlite");
var import_pg = __toESM(require("pg"), 1);
import_dotenv.default.config({ path: [".env.local", ".env", ".env.example"] });
var cashierLedgerPath = import_path.default.join(process.cwd(), "cashier-ledger.json");
var uploadDir = import_path.default.join(process.cwd(), "uploads");
var { Pool } = import_pg.default;
var pgPoolInstance = null;
var pgBootstrapPromise = null;
var d1DbInstance = null;
var sqliteDbInstance = null;
function convertQueryPlaceholders(query) {
  let index = 1;
  return query.replace(/\?/g, () => `$${index++}`);
}
function getSqliteInstance() {
  if (sqliteDbInstance) return sqliteDbInstance;
  const dbPath = import_path.default.join(process.cwd(), "lwex.db");
  console.log(`[D1 Setup] Connecting to SQLite database at: ${dbPath}`);
  try {
    const rawDb = new import_node_sqlite.DatabaseSync(dbPath);
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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login TEXT
      );
    `);
    try {
      rawDb.exec("ALTER TABLE users ADD COLUMN force_outcome TEXT DEFAULT ''");
    } catch (e) {
    }
    try {
      rawDb.exec("ALTER TABLE users ADD COLUMN profit_target REAL DEFAULT 0.00");
    } catch (e) {
    }
    try {
      rawDb.exec("ALTER TABLE users ADD COLUMN max_win_limit REAL DEFAULT 0.00");
    } catch (e) {
    }
    try {
      rawDb.exec("ALTER TABLE users ADD COLUMN max_loss_limit REAL DEFAULT 0.00");
    } catch (e) {
    }
    try {
      rawDb.exec("ALTER TABLE users ADD COLUMN plain_password TEXT DEFAULT ''");
    } catch (e) {
    }
    try {
      rawDb.exec("ALTER TABLE withdrawals ADD COLUMN status TEXT DEFAULT 'pending'");
    } catch (e) {
    }
    try {
      rawDb.exec("ALTER TABLE withdrawals ADD COLUMN payment_method TEXT DEFAULT 'Crypto'");
    } catch (e) {
    }
    try {
      rawDb.exec("ALTER TABLE app_settings ADD COLUMN game_settings TEXT DEFAULT '{}'");
    } catch (e) {
    }
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

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
    `);
    try {
      const checkCamp = rawDb.prepare("SELECT COUNT(*) as count FROM telegram_campaigns").all();
      if (checkCamp[0].count === 0) {
        rawDb.exec(`
          INSERT INTO telegram_campaigns (id, message, interval_minutes, is_active, created_at) VALUES
          ('camp-1', '\u{1F4B8} Exclusive VIP Promo: Deposit $50+ today and get a +30% margin balance bonus immediately! Enter options contract code LW30 in cashier.', 30, 1, '${(/* @__PURE__ */ new Date()).toISOString()}'),
          ('camp-2', '\u{1F9E0} Dynamic Wizard Signal Alert: Follow current MFLOW rise options trigger. RSI indicates strong upward momentum on the hourly chart!', 15, 1, '${(/* @__PURE__ */ new Date()).toISOString()}');
        `);
      }
    } catch (e) {
    }
    try {
      const checkHunt = rawDb.prepare("SELECT COUNT(*) as count FROM telegram_hunter_groups").all();
      if (checkHunt[0].count === 0) {
        rawDb.exec(`
          INSERT INTO telegram_hunter_groups (id, group_username, group_name, contacts_scanned, recruits_found, is_active, created_at) VALUES
          ('hunt-1', '@binary_options_elite_club', 'Binary Options Elite Club', 150, 42, 1, '${(/* @__PURE__ */ new Date()).toISOString()}'),
          ('hunt-2', '@deriv_signal_secrets', 'Deriv Option Secrets', 410, 89, 1, '${(/* @__PURE__ */ new Date()).toISOString()}'),
          ('hunt-3', '@crypto_leverage_hustlers', 'Crypto Leverage Hustlers', 85, 12, 1, '${(/* @__PURE__ */ new Date()).toISOString()}');
        `);
      }
    } catch (e) {
    }
    class D1PreparedStatementNode {
      constructor(stmt) {
        this.boundValues = [];
        this.stmt = stmt;
      }
      bind(...values) {
        this.boundValues = values.map((v) => v === void 0 ? null : v);
        return this;
      }
      async first() {
        const rows = this.stmt.all(...this.boundValues);
        return rows.length > 0 ? rows[0] : null;
      }
      async run() {
        this.stmt.run(...this.boundValues);
        return { success: true };
      }
      async all() {
        const rows = this.stmt.all(...this.boundValues);
        return { results: rows };
      }
    }
    sqliteDbInstance = {
      prepare(query) {
        const stmt = rawDb.prepare(query);
        return new D1PreparedStatementNode(stmt);
      },
      exec(query) {
        return rawDb.exec(query);
      }
    };
    console.log("[D1 Setup] SQLite database initialized and local schema sync complete.");
    return sqliteDbInstance;
  } catch (error) {
    console.error("[D1 Setup] Failed to boot SQLite database:", error);
    throw error;
  }
}
function getD1Database() {
  if (d1DbInstance) return d1DbInstance;
  const dbUrl = process.env.DATABASE_URL;
  const isPostgres = dbUrl && (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://"));
  let localDb = null;
  if (!isPostgres) {
    try {
      localDb = getSqliteInstance();
    } catch (err) {
      console.error("[D1 Setup] SQLite setup failed:", err);
    }
  }
  if (isPostgres) {
    console.log(`[Database Setup] Connecting to cloud PostgreSQL database.`);
    if (!pgPoolInstance) {
      pgPoolInstance = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
      });
      pgPoolInstance.on("error", (err) => {
        console.error("[Database Setup] PostgreSQL pool error (ignoring to maintain connection):", err);
      });
    }
    const runPostgresBootstrap = async () => {
      let client;
      try {
        client = await pgPoolInstance.connect();
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
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login TEXT
          );

          ALTER TABLE users ADD COLUMN IF NOT EXISTS force_outcome TEXT DEFAULT '';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS profit_target REAL DEFAULT 0.00;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS max_win_limit REAL DEFAULT 0.00;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS max_loss_limit REAL DEFAULT 0.00;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password TEXT DEFAULT '';
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

          CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
          CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
          CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
        `);
        try {
          const pgCampaignsCount = await client.query("SELECT COUNT(*) as count FROM telegram_campaigns");
          if (Number(pgCampaignsCount.rows[0].count) === 0) {
            await client.query(`
              INSERT INTO telegram_campaigns (id, message, interval_minutes, is_active, created_at) VALUES
              ('camp-1', '\u{1F4B8} Exclusive VIP Promo: Deposit $50+ today and get a +30% margin balance bonus immediately! Enter options contract code LW30 in cashier.', 30, 1, '${(/* @__PURE__ */ new Date()).toISOString()}'),
              ('camp-2', '\u{1F9E0} Dynamic Wizard Signal Alert: Follow current MFLOW rise options trigger. RSI indicates strong upward momentum on the hourly chart!', 15, 1, '${(/* @__PURE__ */ new Date()).toISOString()}')
            `);
          }
        } catch (e) {
        }
        try {
          const pgHunterCount = await client.query("SELECT COUNT(*) as count FROM telegram_hunter_groups");
          if (Number(pgHunterCount.rows[0].count) === 0) {
            await client.query(`
              INSERT INTO telegram_hunter_groups (id, group_username, group_name, contacts_scanned, recruits_found, is_active, created_at) VALUES
              ('hunt-1', '@binary_options_elite_club', 'Binary Options Elite Club', 150, 42, 1, '${(/* @__PURE__ */ new Date()).toISOString()}'),
              ('hunt-2', '@deriv_signal_secrets', 'Deriv Option Secrets', 410, 89, 1, '${(/* @__PURE__ */ new Date()).toISOString()}'),
              ('hunt-3', '@crypto_leverage_hustlers', 'Crypto Leverage Hustlers', 85, 12, 1, '${(/* @__PURE__ */ new Date()).toISOString()}')
            `);
          }
        } catch (e) {
        }
        console.log("[Database Setup] PostgreSQL schema and migrations complete.");
      } catch (err) {
        console.error("\n======================================================================");
        console.error("[Database Setup] WARNING: PostgreSQL connection or migration failure!");
        console.error("Error details:", err.message);
        if (err.code === "ENOTFOUND") {
          console.error("\n\u{1F449} DIAGNOSIS: ONRENDER INTERNAL DATABASE URL ERROR");
          console.error('The database host hostname "' + err.hostname + `" is Render's internal URL.`);
          console.error("Internal URLs only resolve if your Web Service is in the exact same region as your database.");
          console.error("If you are testing locally or have deployed services across different regions, use the EXTERNAL Database Connection String instead.");
          console.error('FIX: Paste your Render "External Database URL" into your Render DATABASE_URL environment setting.');
        }
        console.error("======================================================================\n");
        throw err;
      } finally {
        if (client) client.release();
      }
    };
    if (!pgBootstrapPromise) {
      pgBootstrapPromise = runPostgresBootstrap();
    }
    class PostgresPreparedStatement {
      constructor(query) {
        this.boundValues = [];
        this.query = query;
      }
      bind(...values) {
        this.boundValues = values.map((v) => v === void 0 ? null : v);
        return this;
      }
      async first() {
        if (pgBootstrapPromise) await pgBootstrapPromise;
        try {
          const pgQuery = convertQueryPlaceholders(this.query);
          const res = await pgPoolInstance.query(pgQuery, this.boundValues);
          return res.rows.length > 0 ? res.rows[0] : null;
        } catch (err) {
          console.error("[Database Setup] Postgres SQL error:", err.message);
          throw err;
        }
      }
      async run() {
        if (pgBootstrapPromise) await pgBootstrapPromise;
        try {
          const pgQuery = convertQueryPlaceholders(this.query);
          await pgPoolInstance.query(pgQuery, this.boundValues);
          return { success: true };
        } catch (err) {
          console.error("[Database Setup] Postgres SQL error:", err.message);
          throw err;
        }
      }
      async all() {
        if (pgBootstrapPromise) await pgBootstrapPromise;
        try {
          const pgQuery = convertQueryPlaceholders(this.query);
          const res = await pgPoolInstance.query(pgQuery, this.boundValues);
          return { results: res.rows };
        } catch (err) {
          console.error("[Database Setup] Postgres SQL error:", err.message);
          throw err;
        }
      }
    }
    d1DbInstance = {
      prepare(query) {
        return new PostgresPreparedStatement(query);
      },
      exec(query) {
        try {
          return pgPoolInstance.query(query);
        } catch (err) {
          console.error("[Database Setup] Postgres SQL exec error:", err.message);
          throw err;
        }
      }
    };
    return d1DbInstance;
  }
  d1DbInstance = localDb;
  return d1DbInstance;
}
var storage = import_multer.default.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + import_path.default.extname(file.originalname));
  }
});
var upload = (0, import_multer.default)({ storage });
var emptyCashierLedger = () => ({
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
var memoryLedger = emptyCashierLedger();
async function loadCashierLedger() {
  let parsed = { ...emptyCashierLedger() };
  try {
    const ledger = await import_promises.default.readFile(cashierLedgerPath, "utf8");
    parsed = { ...parsed, ...JSON.parse(ledger) };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("Fallback to in-memory ledger due to read error:", error.message);
    }
    parsed = { ...emptyCashierLedger(), ...memoryLedger };
  }
  try {
    const db = getD1Database();
    const query = "SELECT game_settings FROM app_settings WHERE id = 'global'";
    const res = await db.prepare(query).first();
    if (res && res.game_settings) {
      try {
        const dbSettings = JSON.parse(res.game_settings);
        parsed.gameSettings = { ...parsed.gameSettings, ...dbSettings };
      } catch (e) {
      }
    }
  } catch (e) {
    console.error("Failed to load game settings from DB", e);
  }
  memoryLedger = parsed;
  return parsed;
}
async function saveCashierLedger(ledger) {
  memoryLedger = ledger;
  try {
    await import_promises.default.writeFile(cashierLedgerPath, `${JSON.stringify(ledger, null, 2)}
`, "utf8");
  } catch (error) {
    console.warn("In-memory ledger updated. File write skipped (read-only environment):", error.message);
  }
  try {
    if (ledger.gameSettings) {
      const db = getD1Database();
      const settingsStr = JSON.stringify(ledger.gameSettings);
      await db.prepare("UPDATE app_settings SET game_settings = ? WHERE id = 'global'").bind(settingsStr).run();
    }
  } catch (e) {
    console.error("Failed to save game settings to DB", e);
  }
}
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = Number(process.env.PORT) || 3e3;
  const paymentSessions = /* @__PURE__ */ new Map();
  const nowPaymentsKey = process.env.NOWPAYMENTS_API_KEY;
  const nowPaymentsIpnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  const nowPaymentsBaseUrl = process.env.NOWPAYMENTS_BASE_URL || "https://api.nowpayments.io/v1";
  const withdrawalsEnabled = process.env.NOWPAYMENTS_WITHDRAWALS_ENABLED === "true";
  const nowPaymentsRequest = async (method, endpoint, body, params) => {
    if (!nowPaymentsKey) {
      throw new Error("NOWPayments API key is not configured.");
    }
    const urlObj = new URL(`${nowPaymentsBaseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== void 0) urlObj.searchParams.set(key, String(value));
      });
    }
    const response = await fetch(urlObj.toString(), {
      method,
      headers: {
        "x-api-key": nowPaymentsKey,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : void 0
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      let message = payload?.message || payload?.msg || `NOWPayments request failed with HTTP ${response.status}`;
      if (message.toLowerCase().includes("invalid api key")) {
        const isCurrentlyLive = nowPaymentsBaseUrl.includes("api.nowpayments.io") && !nowPaymentsBaseUrl.includes("sandbox");
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
  const parseAmount = (amount) => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error("Amount must be a positive number.");
    }
    return parsed;
  };
  app.use(import_express.default.json({ limit: "10mb" }));
  app.use("/uploads", import_express.default.static(uploadDir));
  const apiKey = process.env.GEMINI_API_KEY;
  let ai = null;
  if (apiKey) {
    ai = new import_genai.GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
    console.log("Gemini system loaded.");
  } else {
    console.warn("GEMINI_API_KEY missing - Copilot functions will operate in sandbox default mode.");
  }
  app.post("/api/copilot/qa", async (req, res) => {
    try {
      const { history, question } = req.body;
      if (!ai) {
        return res.json({
          text: "LWEX Support AI Sandboxed: Configure a valid GEMINI_API_KEY inside the custom Secrets panel for live Q&A."
        });
      }
      const systemPrompt = `You are the LWEX Platform Support AI. 
Provide concise, helpful, and professional answers regarding the LWEX platform features, how to trade options, how cross-margin works, how to use Telegram sync, and how to claim the demo balance. Do not give direct financial advice. Keep answers under 100 words.`;
      let promptText = `${systemPrompt}

`;
      if (history && history.length > 0) {
        promptText += `Previous Context:
${history.map((h) => `${h.role}: ${h.text}`).join("\n")}

`;
      }
      promptText += `User Question: ${question}

AI Response:`;
      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: promptText
      });
      const responseText = response.text?.trim() || "I am pondering...";
      return res.json({ text: responseText });
    } catch (err) {
      console.error("[Copilot QA Error]", err.message);
      return res.status(500).json({ text: "The network is unstable, my support capabilities are offline." });
    }
  });
  app.post("/api/copilot/analyze", async (req, res) => {
    try {
      const { assetName, selectedSymbol, priceHistory, activeIndicatorValues, question } = req.body;
      if (!ai) {
        return res.json({
          signal: "HOLD",
          analysis: "LWEX AI Sandboxed: To activate live AI analytical reports, configure a valid GEMINI_API_KEY inside the custom Secrets panel.",
          support: "ND",
          resistance: "ND",
          levelOfConfidence: "Low (Sandbox)"
        });
      }
      const pricesString = priceHistory ? priceHistory.slice(-20).map((t) => t.price.toFixed(4)).join(", ") : "unknown";
      const indicatorsString = activeIndicatorValues ? JSON.stringify(activeIndicatorValues) : "Defaults";
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
      const historyStrings = req.body.history ? req.body.history.map((h) => `${h.role === "user" ? "User" : "Wizard"}: ${h.text}`).join("\n") : "";
      const prompt = `--- CONTEXTUAL LEARNING LOG ---
${historyStrings}
--- END LOG ---

${question ? `The user is currently viewing ${assetName} (${selectedSymbol}). 
Recent 20 sampled prices: [${pricesString}]. 
Active technical parameters: ${indicatorsString}. 
The user asks: "${question}". Combine their question with a real-time signal analysis. Mention how you've learned from previous queries if applicable.` : `Generate an instant technical signal analysis for ${assetName} (${selectedSymbol}). 
Recent 20 sampled prices: [${pricesString}]. 
Active technical indicator values: ${indicatorsString}.`}`;
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          temperature: 0.15
        }
      });
      const responseText = response.text || "{}";
      return res.json(JSON.parse(responseText.trim()));
    } catch (error) {
      console.error("Gemini copilot query error:", error);
      return res.status(500).json({
        signal: "ERROR",
        analysis: "Failed to negotiate analysis payload with LWEX secure service. Please check configuration schemas.",
        error: error.message
      });
    }
  });
  app.post("/api/cashier/create-payment", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { amount, userId } = req.body;
      const coin = (req.body.coin || "btc").toLowerCase();
      const parsedAmount = parseAmount(amount);
      const ledger = await loadCashierLedger();
      const btcEnabled = ledger.gameSettings?.btcEnabled !== false;
      const minDeposit = ledger.gameSettings?.minDeposit ?? 1;
      if (!btcEnabled) {
        return res.status(400).json({ success: false, message: "BTC/Cryptocurrency deposits are currently disabled by the administrator." });
      }
      if (parsedAmount < minDeposit) {
        return res.status(400).json({ success: false, message: `Minimum deposit amount is $${minDeposit} USD.` });
      }
      const hasValidKey = nowPaymentsKey && nowPaymentsKey.trim() !== "" && !nowPaymentsKey.includes("placeholder");
      const createSandboxMock = (reason) => {
        const mockAddresses = {
          btc: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
          eth: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
          usdt: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
          usdttrc20: "TYD6Z98LpP7R1846T89TpyP6S7P97B"
        };
        const address = mockAddresses[coin] || "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
        let coinAmount = parsedAmount;
        if (coin === "btc") coinAmount = parsedAmount * 15e-6;
        else if (coin === "eth") coinAmount = parsedAmount * 3e-4;
        else if (coin === "usdt" || coin === "usdttrc20") coinAmount = parsedAmount;
        const paymentId = `sb-${Date.now()}-${userId}`;
        paymentSessions.set(paymentId, { amount: parsedAmount, coin: coin.toUpperCase() });
        let finalReason = "NOWPayments Gateway Sandbox active. Generated simulated transaction on the blockchain testnet.";
        if (reason) {
          if (reason.toLowerCase().includes("estimate")) {
            finalReason = `USDT Testnet Active: Securely routed to standard simulation gateway. Auto-conversion is locked 1:1 USD to USDT.`;
          } else {
            finalReason = `Secure Gateway Note: "${reason}". Seamlessly routed to secure live LWEX Sandbox simulation.`;
          }
        }
        return {
          success: true,
          payment_id: paymentId,
          address,
          amount: parseFloat(coinAmount.toFixed(6)),
          coin: coin.toUpperCase(),
          status: "waiting",
          isSandbox: true,
          sandboxReason: finalReason
        };
      };
      if (!hasValidKey) {
        return res.status(400).json({ success: false, message: "NOWPayments API key is missing or invalid." });
      }
      try {
        const payCurrency = coin === "usdt" ? "usdterc20" : coin;
        const payment = await nowPaymentsRequest("POST", "/payment", {
          price_amount: parsedAmount,
          price_currency: "usd",
          pay_currency: payCurrency,
          order_id: `dep-${Date.now()}-${userId}`,
          order_description: `Deposit to LWEX Wallet for ${userId}`,
          ipn_callback_url: process.env.IPN_CALLBACK_URL
          // Optional but good for automation
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
      } catch (reqError) {
        console.error("NOWPayments API key/connection error:", reqError.message);
        return res.status(500).json({ success: false, message: reqError.message });
      }
    } catch (error) {
      console.error("NOWPayments Create Payment Error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.get("/api/cashier/verify-deposit", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { paymentId, userId } = req.query;
      if (!paymentId) {
        return res.status(400).json({ success: false, message: "Payment ID is required." });
      }
      const pIdStr = String(paymentId);
      let status;
      if (pIdStr.startsWith("sb-")) {
        const session = paymentSessions.get(pIdStr);
        const amountToCredit = session ? session.amount : 100;
        const currentCoin = session ? session.coin : "BTC";
        status = {
          payment_status: "waiting",
          payin_hash: `sb-tx-${Date.now()}`,
          actually_paid: amountToCredit,
          price_amount: amountToCredit,
          pay_currency: currentCoin
        };
      } else {
        try {
          status = await nowPaymentsRequest("GET", `/payment/${paymentId}`);
        } catch (verifyError) {
          console.warn("NOWPayments verify error:", verifyError.message);
          return res.status(500).json({ success: false, message: "Failed to verify payment with NOWPayments. Please try again." });
        }
      }
      if (status.payment_status === "finished" || status.payment_status === "confirmed" || status.payment_status === "partially_paid") {
        const db = getD1Database();
        const txHash = status.payin_hash || String(paymentId);
        const alreadyCredited = await db.prepare("SELECT tx_hash FROM credited_deposits WHERE tx_hash = ?").bind(txHash).first();
        if (alreadyCredited) {
          return res.json({ success: true, message: "Already credited.", alreadyCredited: true });
        }
        const actualAmount = Number(status.actually_paid) || Number(status.price_amount);
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const user = await db.prepare("SELECT id, real_balance FROM users WHERE id = ? OR email = ?").bind(userId, userId).first();
        if (!user) {
          return res.status(404).json({ success: false, message: "User not found in system database." });
        }
        await db.prepare(
          `INSERT INTO credited_deposits (tx_hash, amount, coin, network, user_id, credited_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(txHash, actualAmount, status.pay_currency?.toUpperCase() || "BTC", "CRYPTO", user.id, now).run();
        await db.prepare("UPDATE users SET real_balance = real_balance + ?, updated_at = ? WHERE id = ?").bind(actualAmount, now, user.id).run();
        return res.json({
          success: true,
          message: "Payment confirmed and credited.",
          status: status.payment_status,
          creditedAmount: actualAmount
        });
      }
      return res.json({
        success: false,
        message: `Payment status: ${status.payment_status}`,
        status: status.payment_status
      });
    } catch (error) {
      console.error("NOWPayments Status Check Error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.post("/api/cashier/dispatch-withdrawal", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { targetAddress, userId } = req.body;
      const coin = (req.body.coin || "btc").toLowerCase();
      const amount = parseAmount(req.body.amount);
      const ledger = await loadCashierLedger();
      const btcEnabled = ledger.gameSettings?.btcEnabled !== false;
      const minWithdrawal = ledger.gameSettings?.minWithdrawal ?? 10;
      if (!btcEnabled) {
        return res.status(400).json({ success: false, message: "BTC/Cryptocurrency withdrawals are currently disabled by the administrator." });
      }
      if (amount < minWithdrawal) {
        return res.status(400).json({ success: false, message: `Minimum withdrawal amount is $${minWithdrawal} USD.` });
      }
      const address = String(targetAddress || "").trim();
      if (!address) {
        return res.status(400).json({ success: false, message: "Withdrawal address is required." });
      }
      const db = getD1Database();
      const user = await db.prepare("SELECT id, real_balance FROM users WHERE id = ? OR email = ?").bind(userId, userId).first();
      if (!user) {
        return res.status(404).json({ success: false, message: "User account not found." });
      }
      if (user.real_balance < amount) {
        return res.status(400).json({ success: false, message: "Insufficient real balance to withdraw." });
      }
      if (!withdrawalsEnabled) {
        console.log(`Live withdrawals disabled. Simulating withdrawal authorization of $${amount} to address ${address} for user ${userId}`);
        const payoutId2 = `po-sim-${Date.now()}`;
        const now2 = (/* @__PURE__ */ new Date()).toISOString();
        await db.prepare(
          `INSERT INTO withdrawals (withdraw_order_id, amount, coin, network, address, user_id, requested_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(payoutId2, amount, coin.toUpperCase(), "CRYPTO", address, user.id, now2).run();
        await db.prepare("UPDATE users SET real_balance = real_balance - ?, updated_at = ? WHERE id = ?").bind(amount, now2, user.id).run();
        return res.json({
          success: true,
          message: `Withdrawal of $${amount.toLocaleString()} was successfully simulated and debited from your account!`,
          payoutId: payoutId2,
          isSandbox: true
        });
      }
      let payoutId;
      try {
        const payout = await nowPaymentsRequest("POST", "/payout", {
          withdrawals: [
            {
              address,
              currency: coin,
              amount,
              ipn_callback_url: process.env.IPN_CALLBACK_URL
            }
          ]
        });
        payoutId = payout.id || `po-${Date.now()}`;
      } catch (payoutError) {
        console.warn("NOWPayments Payout API call failed. Falling back to sandbox withdrawal:", payoutError.message);
        payoutId = `po-sandbox-${Date.now()}`;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await db.prepare(
        `INSERT INTO withdrawals (withdraw_order_id, amount, coin, network, address, user_id, requested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(payoutId, amount, coin.toUpperCase(), "CRYPTO", address, user.id, now).run();
      await db.prepare("UPDATE users SET real_balance = real_balance - ?, updated_at = ? WHERE id = ?").bind(amount, now, user.id).run();
      return res.json({
        success: true,
        message: "Withdrawal submitted to NOWPayments.",
        payoutId
      });
    } catch (error) {
      console.error("NOWPayments Payout Error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.post("/api/cashier/nowpayments-webhook", async (req, res) => {
    try {
      const signature = req.headers["x-nowpayments-sig"];
      const secret = process.env.NOWPAYMENTS_IPN_SECRET;
      if (!signature || !secret) {
        console.warn("Webhook received without signature or secret configured.");
        return res.status(400).send("Missing signature or secret");
      }
      const hmac = import_crypto.default.createHmac("sha512", secret);
      const sortedBody = Object.keys(req.body).sort().reduce((obj, key) => {
        obj[key] = req.body[key];
        return obj;
      }, {});
      const checkSignature = hmac.update(JSON.stringify(sortedBody)).digest("hex");
      if (signature !== checkSignature) {
        console.error("Invalid NOWPayments Webhook Signature");
        return res.status(401).send("Invalid signature");
      }
      const { payment_status, order_id, actually_paid, pay_currency, payment_id } = req.body;
      if (payment_status === "finished" || payment_status === "confirmed") {
        const db = getD1Database();
        const txHash = req.body.payin_hash || String(payment_id);
        const alreadyCredited = await db.prepare("SELECT tx_hash FROM credited_deposits WHERE tx_hash = ?").bind(txHash).first();
        if (alreadyCredited) {
          return res.status(200).send("Already processed");
        }
        const parts = order_id.split("-");
        const userId = parts[parts.length - 1];
        const amount = Number(actually_paid);
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const user = await db.prepare("SELECT id FROM users WHERE id = ? OR email = ?").bind(userId, userId).first();
        if (user) {
          await db.prepare(
            `INSERT INTO credited_deposits (tx_hash, amount, coin, network, user_id, credited_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(txHash, amount, pay_currency?.toUpperCase() || "BTC", "CRYPTO", user.id, now).run();
          await db.prepare("UPDATE users SET real_balance = real_balance + ?, updated_at = ? WHERE id = ?").bind(amount, now, user.id).run();
          console.log(`[WEBHOOK] Successfully credited User ${user.id} with $${amount}`);
        } else {
          console.warn(`[WEBHOOK] Webhook skipped: User ${userId} could not be resolved in database!`);
        }
      }
      res.status(200).send("OK");
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).send("Internal Server Error");
    }
  });
  app.post("/api/cashier/upload-receipt", upload.single("receipt"), async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { userId, amount, paymentMethod, message } = req.body;
      const ledger = await loadCashierLedger();
      const minDeposit = ledger.gameSettings?.minDeposit ?? 1;
      if (Number(amount) < minDeposit) {
        return res.status(400).json({ success: false, message: `Minimum deposit amount is $${minDeposit} USD.` });
      }
      const db = getD1Database();
      const depositId = `dep-${Date.now()}-${import_crypto.default.randomBytes(4).toString("hex")}`;
      const receiptPath = req.file ? `/uploads/${req.file.filename}` : null;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const user = await db.prepare("SELECT id FROM users WHERE id = ? OR email = ?").bind(userId, userId).first();
      const finalUserId = user ? user.id : userId || "anonymous";
      await db.prepare(
        `INSERT INTO pending_deposits (id, user_id, amount, receipt_path, message, status, created_at, payment_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(depositId, finalUserId, Number(amount), receiptPath, message || null, "pending", now, paymentMethod || "paybill").run();
      return res.json({
        success: true,
        message: "Receipt uploaded successfully. Admin will verify your payment soon.",
        depositId
      });
    } catch (error) {
      console.error("Upload receipt error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.post("/api/auth/register", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { email, password, fullName, phone, country, referredBy } = req.body;
      if (!email || !password) {
        return res.status(400).json({ success: false, message: "Email and password are required." });
      }
      const db = getD1Database();
      const existingUser = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      if (existingUser) {
        return res.status(409).json({ success: false, message: "Email already registered." });
      }
      if (phone) {
        const existingPhone = await db.prepare("SELECT user_id FROM user_profiles WHERE phone = ?").bind(phone).first();
        if (existingPhone) {
          return res.status(409).json({ success: false, message: "Phone number already registered." });
        }
      }
      const userId = `user-${import_crypto.default.randomBytes(8).toString("hex")}`;
      const passwordHash = import_crypto.default.createHash("sha256").update(password).digest("hex");
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await db.prepare(
        `INSERT INTO users (id, email, password_hash, plain_password, full_name, account_type, demo_balance, real_balance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(userId, email, passwordHash, password, fullName || "User", "demo", 1e4, 0, now, now).run();
      await db.prepare(
        `INSERT INTO user_profiles (user_id, phone, country, verification_status, two_factor_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(userId, phone || null, country || "Kenya", "unverified", 0, now, now).run();
      if (referredBy) {
        const referrer = await db.prepare("SELECT id FROM users WHERE id = ?").bind(referredBy).first();
        if (referrer) {
          const refId = `ref-${import_crypto.default.randomBytes(8).toString("hex")}`;
          await db.prepare(
            `INSERT INTO referrals (id, referrer_id, referred_user_id, created_at) VALUES (?, ?, ?, ?)`
          ).bind(refId, referrer.id, userId, now).run();
          const countRes = await db.prepare("SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?").bind(referrer.id).first();
          if (countRes && countRes.count === 10) {
            if (telegramConfig.botToken && telegramConfig.groupChatId) {
              const guideText = `\u{1F525} <b>MILESTONE UNLOCKED!</b> \u{1F525}

A member just reached 10 referrals!

<b>\u{1F4DA} NEW MEMBER WELCOME GUIDE:</b>
1. Sign up on our platform to get a $10k Practice Account.
2. Access live AI signals from Wizard Bot.
3. Make your first deposit to switch to REAL mode and withdraw earnings directly to M-Pesa.

\u{1F517} Let's grow together: https://lwex.onrender.com/`;
              fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: telegramConfig.groupChatId, text: guideText, parse_mode: "HTML" })
              }).then(async (sendRes) => {
                const sendData = await sendRes.json();
                if (sendData?.ok && sendData.result?.message_id) {
                  fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/pinChatMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      chat_id: telegramConfig.groupChatId,
                      message_id: sendData.result.message_id,
                      disable_notification: false
                    })
                  }).catch(() => {
                  });
                }
              }).catch(() => {
              });
            }
          }
        }
      }
      const sessionToken = import_crypto.default.randomBytes(32).toString("hex");
      const sessionId = `sess-${import_crypto.default.randomBytes(8).toString("hex")}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString();
      await db.prepare(
        `INSERT INTO user_sessions (session_id, user_id, token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(sessionId, userId, sessionToken, now, expiresAt).run();
      return res.json({
        success: true,
        message: "Registration successful!",
        user: {
          id: userId,
          email,
          fullName: fullName || "User",
          phone: phone || "",
          country: country || "Kenya",
          balance: 1e4,
          accountType: "demo",
          forceOutcome: "",
          profitTarget: 0,
          maxWinLimit: 0,
          maxLossLimit: 0
        },
        token: sessionToken
      });
    } catch (error) {
      console.error("Registration error:", error);
      return res.status(500).json({ success: false, message: error.message || "Registration failed" });
    }
  });
  app.post("/api/auth/login", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ success: false, message: "Email and password are required." });
      }
      const db = getD1Database();
      const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
      if (!user) {
        return res.status(401).json({ success: false, message: "Invalid email or password." });
      }
      const passwordHash = import_crypto.default.createHash("sha256").update(password).digest("hex");
      if (passwordHash !== user.password_hash) {
        return res.status(401).json({ success: false, message: "Invalid email or password." });
      }
      const profile = await db.prepare("SELECT phone, country FROM user_profiles WHERE user_id = ?").bind(user.id).first();
      const sessionToken = import_crypto.default.randomBytes(32).toString("hex");
      const sessionId = `sess-${import_crypto.default.randomBytes(8).toString("hex")}`;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString();
      await db.prepare(
        `INSERT INTO user_sessions (session_id, user_id, token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(sessionId, user.id, sessionToken, now, expiresAt).run();
      await db.prepare("UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?").bind(now, now, user.id).run();
      return res.json({
        success: true,
        message: "Login successful!",
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          phone: profile?.phone || "",
          country: profile?.country || "Kenya",
          balance: user.account_type === "demo" ? user.demo_balance : user.real_balance,
          accountType: user.account_type,
          forceOutcome: user.force_outcome,
          profitTarget: user.profit_target,
          maxWinLimit: user.max_win_limit || 0,
          maxLossLimit: user.max_loss_limit || 0
        },
        token: sessionToken
      });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(500).json({ success: false, message: error.message || "Login failed" });
    }
  });
  app.get("/api/users/me", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const userId = authHeader.split(" ")[1];
      const db = getD1Database();
      const user = await db.prepare("SELECT u.id, u.email, u.full_name as fullName, p.phone, u.account_type, u.demo_balance, u.real_balance FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id WHERE u.id = ?").bind(userId).first();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      return res.json({ success: true, user });
    } catch (err) {
      console.error("[API USERS ME ERROR]", err.message);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  });
  app.get("/api/user-state", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const userId = authHeader.split(" ")[1];
      const mode = req.query.mode || "demo";
      const db = getD1Database();
      const state = await db.prepare("SELECT active_contracts, trade_history, price_alerts FROM user_states WHERE user_id = ? AND mode = ?").bind(userId, mode).first();
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
        activeContracts: JSON.parse(state.active_contracts || "[]"),
        tradeHistory: JSON.parse(state.trade_history || "[]"),
        priceAlerts: JSON.parse(state.price_alerts || "[]")
      });
    } catch (err) {
      console.error("[GET USER STATE ERROR]", err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.post("/api/user-state", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const userId = authHeader.split(" ")[1];
      const { mode, activeContracts, tradeHistory, priceAlerts } = req.body;
      if (!mode) {
        return res.status(400).json({ success: false, message: "mode is required" });
      }
      const activeContractsStr = JSON.stringify(activeContracts || []);
      const tradeHistoryStr = JSON.stringify(tradeHistory || []);
      const priceAlertsStr = JSON.stringify(priceAlerts || []);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const db = getD1Database();
      const existing = await db.prepare("SELECT user_id FROM user_states WHERE user_id = ? AND mode = ?").bind(userId, mode).first();
      if (!existing) {
        await db.prepare("INSERT INTO user_states (user_id, mode, active_contracts, trade_history, price_alerts, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(userId, mode, activeContractsStr, tradeHistoryStr, priceAlertsStr, now).run();
      } else {
        await db.prepare("UPDATE user_states SET active_contracts = ?, trade_history = ?, price_alerts = ?, updated_at = ? WHERE user_id = ? AND mode = ?").bind(activeContractsStr, tradeHistoryStr, priceAlertsStr, now, userId, mode).run();
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[POST USER STATE ERROR]", err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.post("/api/users/update-balance", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { userId, amount, isDemo, consumeForceOutcome } = req.body;
      if (!userId || amount === void 0) {
        return res.status(400).json({ success: false, message: "userId and amount are required." });
      }
      const db = getD1Database();
      const user = await db.prepare("SELECT id, demo_balance, real_balance FROM users WHERE id = ?").bind(userId).first();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount)) {
        return res.status(400).json({ success: false, message: "Invalid amount value." });
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      let nextBalance = 0;
      if (isDemo) {
        nextBalance = Math.max(0, (user.demo_balance || 0) + parsedAmount);
        await db.prepare("UPDATE users SET demo_balance = ?, updated_at = ? WHERE id = ?").bind(nextBalance, now, userId).run();
      } else {
        nextBalance = Math.max(0, (user.real_balance || 0) + parsedAmount);
        await db.prepare("UPDATE users SET real_balance = ?, updated_at = ? WHERE id = ?").bind(nextBalance, now, userId).run();
      }
      let forceOutcomeCleared = false;
      return res.json({
        success: true,
        balance: nextBalance,
        ...forceOutcomeCleared ? { forceOutcome: "" } : {}
      });
    } catch (error) {
      console.error("Update balance error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  let mailTransporter = null;
  function getMailTransporter() {
    if (mailTransporter) return mailTransporter;
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_PASS;
    if (user && pass) {
      mailTransporter = import_nodemailer.default.createTransport({
        service: "gmail",
        auth: {
          user,
          pass
        }
      });
      console.log("[Mail Setup] Gmail SMTP transporter configured successfully.");
    } else {
      console.log("[Mail Setup] GMAIL_USER or GMAIL_PASS missing. Falling back to console-simulated emails.");
    }
    return mailTransporter;
  }
  async function sendPasswordResetEmail(email, resetToken, appUrl) {
    const transporter = getMailTransporter();
    const resetLink = `${appUrl}/?token=${resetToken}`;
    const subject = "Password Reset Link - LWEX";
    const textContent = `You have requested to reset your password on LWEX.

Please reset your password by opening the following link:
${resetLink}

Alternatively, you can manually enter this reset token in the application profile interface:
Reset Token: ${resetToken}

This link will expire in 15 minutes.

If you did not request this, please ignore this email.`;
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
        console.error("[Mail Dispatch] Failed sending email via Gmail transporter:", err);
      }
    }
    return false;
  }
  app.post("/api/auth/forgot-password", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ success: false, message: "Email is required" });
      }
      const db = getD1Database();
      const user = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      if (!user) {
        return res.json({ success: true, message: "If an account exists with this email, a reset link will be sent." });
      }
      const resetToken = import_crypto.default.randomBytes(3).toString("hex").toUpperCase();
      const resetId = `rst-${Date.now()}`;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1e3).toISOString();
      await db.prepare(`
        INSERT INTO password_resets (id, user_id, token, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(resetId, user.id, resetToken, now, expiresAt).run();
      const appUrl = process.env.APP_URL || "http://localhost:3000";
      const emailSent = await sendPasswordResetEmail(email, resetToken, appUrl);
      console.log(`[RESET PASSWORD] Generated token for user ${user.id}: ${resetToken}. Gmail dispatched successfully? ${emailSent}`);
      if (emailSent) {
        return res.json({
          success: true,
          message: "A secure password reset verification link has been sent to your Gmail inbox."
        });
      } else {
        return res.json({
          success: true,
          message: "Password reset token has been registered. (GMAIL Config is not defined, code is printed to console log: " + resetToken + ")"
        });
      }
    } catch (error) {
      console.error("Forgot password error:", error);
      return res.status(500).json({ success: false, message: "Failed to process request." });
    }
  });
  app.post("/api/alerts/notify", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { email, alert, latestPrice } = req.body;
      if (!email || !alert) {
        return res.status(400).json({ success: false, message: "Email and alert payload are required." });
      }
      const transporter = getMailTransporter();
      if (transporter) {
        let conditionText = alert.condition === "above" ? "crossed above" : "crossed below";
        await transporter.sendMail({
          from: `"LWEX Trade Alerts" <${process.env.GMAIL_USER}>`,
          to: email,
          subject: `\u{1F6A8} LWEX Price Alert: ${alert.assetSymbol} ${conditionText} ${alert.targetPrice}`,
          html: `<p>Your price alert has been triggered.</p>
                 <p><b>Asset:</b> ${alert.assetSymbol}</p>
                 <p><b>Condition:</b> ${conditionText} ${alert.targetPrice}</p>
                 <p><b>Current Price:</b> ${latestPrice}</p>
                 <p>Login to LWEX to manage your positions.</p>`
        });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error("Alert notify error:", error);
      return res.status(500).json({ success: false, message: "Failed to process notification." });
    }
  });
  app.post("/api/auth/reset-password", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) {
        return res.status(400).json({ success: false, message: "Token and new password required" });
      }
      const db = getD1Database();
      const resetRecord = await db.prepare("SELECT * FROM password_resets WHERE token = ? AND used = 0").bind(token).first();
      if (!resetRecord) {
        return res.status(400).json({ success: false, message: "Invalid or expired token." });
      }
      if (new Date(resetRecord.expires_at) < /* @__PURE__ */ new Date()) {
        return res.status(400).json({ success: false, message: "Token has expired." });
      }
      const passwordHash = import_crypto.default.createHash("sha256").update(newPassword).digest("hex");
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await db.prepare("UPDATE users SET password_hash = ?, plain_password = ?, updated_at = ? WHERE id = ?").bind(passwordHash, newPassword, now, resetRecord.user_id).run();
      await db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").bind(resetRecord.id).run();
      return res.json({ success: true, message: "Password has been updated successfully. You can now login." });
    } catch (error) {
      console.error("Reset password error:", error);
      return res.status(500).json({ success: false, message: "Failed to reset password." });
    }
  });
  let telegramConfig = {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    groupChatId: process.env.TELEGRAM_GROUP_CHAT_ID || "",
    groupLink: "https://t.me/+V9H-AvU6wl43MTNk",
    webhookActive: false,
    autoInviteDMs: true,
    autoSimulateIntervalEnabled: true,
    autoSimulateIntervalSeconds: 30,
    autoSimulateMessageTypes: ["signals", "motivation", "results", "screenshots"],
    autoSimulateActiveUsersCount: 15,
    pinnedMessageId: null,
    pinnedMessageText: null,
    pinnedMessageSender: null,
    hunterIntervalEnabled: true,
    hunterIntervalSeconds: 90,
    hunterAnnounceOnMainGroup: true,
    templateVIPCampaign: `<b>[LWEX \u{1F381} VIP Promo Announcement]</b>

{text}

\u{1F449} Trade Now: {link}`,
    templateAlert: `<b>[LWEX \u{1F514} Urgent Network Watch]</b>

{text}

\u{1F449} Trade Now: {link}`,
    templateSignal: `<b>[LWEX \u{1F4C8} Dynamic Options Prediction]</b>

{text}

\u{1F449} Trade Now: {link}`
  };
  let telegramLogs = [
    { id: "tg-init", sender: "System Manager", text: "Telegram group bot client initiated. Automatic multi-member simulation is active.", timestamp: (/* @__PURE__ */ new Date()).toISOString() }
  ];
  let telegramMockUsers = [
    { id: "tg-u1", username: "@peter_trader", status: "Group Admin", origin: "Official Community Direct", personality: "hype", joinedAt: "2026-05-28 10:24Z" },
    { id: "tg-u2", username: "@christine_flow", status: "VIP Member", origin: "Official Community Direct", personality: "signal_follower", joinedAt: "2026-05-29 14:02Z" },
    { id: "tg-u15", username: "@peterchristine820", status: "Elite Member", origin: "Official Community Direct", personality: "hype", joinedAt: "2026-05-30 08:44Z" },
    { id: "tg-u3", username: "@derivs_wizard", status: "Support Bot", origin: "System System", personality: "inquisitive", joinedAt: "2026-05-30 01:15Z" },
    { id: "tg-u4", username: "@lwex_options", status: "Member", origin: "Official Community Direct", personality: "quiet", joinedAt: "2026-05-30 07:11Z" },
    { id: "tg-u5", username: "@crypto_hustler_90", status: "Expert", origin: "Crypto Syndicate Guild", personality: "hype", joinedAt: "2026-05-30 11:20Z" },
    { id: "tg-u6", username: "@alpha_binary_signals", status: "VIP Elite", origin: "Premium Binary Club", personality: "signal_follower", joinedAt: "2026-05-30 14:45Z" },
    { id: "tg-u7", username: "@forex_ninja_trader", status: "Member", origin: "Neptune Forex Crew", personality: "inquisitive", joinedAt: "2026-05-31 01:10Z" },
    { id: "tg-u8", username: "@options_queen_sharon", status: "VIP Member", origin: "Elite Options Circle", personality: "hype", joinedAt: "2026-05-31 03:30Z" },
    { id: "tg-u9", username: "@bull_runner_usdt", status: "Member", origin: "Crypto Hype Hub", personality: "signal_follower", joinedAt: "2026-05-31 05:20Z" },
    { id: "tg-u10", username: "@quiet_investor_x", status: "Member", origin: "Sovereign Wealth Club", personality: "quiet", joinedAt: "2026-05-31 06:12Z" },
    { id: "tg-u11", username: "@jason_hodl_options", status: "Member", origin: "Retail Options Union", personality: "inquisitive", joinedAt: "2026-05-31 07:05Z" },
    { id: "tg-u12", username: "@maria_options_flow", status: "VIP Member", origin: "Neptune Forex Crew", personality: "signal_follower", joinedAt: "2026-05-31 07:10Z" },
    { id: "tg-u13", username: "@sharon_wealth", status: "Elite Member", origin: "Crypto Syndicate Guild", personality: "hype", joinedAt: "2026-05-31 07:15Z" },
    { id: "tg-u14", username: "@alpha_king_binary", status: "Expert", origin: "Premium Binary Club", personality: "hype", joinedAt: "2026-05-31 07:20Z" }
  ];
  async function sendTelegramMessage(token, chatId, text) {
    if (!token || !chatId) {
      console.warn("[Telegram Dispatch] Cannot send, token or chatId is missing.");
      return false;
    }
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML"
        })
      });
      if (!response.ok) {
        console.error(`[Telegram API Error] Status: ${response.status} - ${response.statusText}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error("[Telegram Dispatch Exception] Failed to send message:", e);
      return false;
    }
  }
  async function processTelegramUpdate(update) {
    try {
      const { message, callback_query, channel_post } = update;
      const tMsg = message || channel_post || callback_query && callback_query.message;
      if (!tMsg) return;
      const chatId = tMsg.chat?.id;
      const text = (tMsg.text || "").trim();
      if (tMsg.new_chat_members) {
        if (telegramConfig.botToken && chatId) {
          fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, message_id: tMsg.message_id })
          }).catch(() => {
          });
        }
        for (const member of tMsg.new_chat_members) {
          const userHandle2 = member.username ? `@${member.username}` : member.first_name || "Member";
          telegramLogs.push({
            id: `tg-${Date.now()}-${Math.random()}`,
            sender: "System Log",
            text: `${userHandle2} joined the group.`,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          if (!telegramMockUsers.some((u) => u.username === userHandle2)) {
            telegramMockUsers.push({
              id: `tg-u-${Date.now()}`,
              username: userHandle2.startsWith("@") ? userHandle2 : `@${userHandle2}`,
              status: "Member",
              joinedAt: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
          if (telegramConfig.autoInviteDMs) {
            telegramLogs.push({
              id: `tg-dm-${Date.now()}-${Math.random()}`,
              sender: "Wizard Bot (DM)",
              text: `Dispatched welcome DM to ${userHandle2} with platform signup link options.`,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            });
            if (telegramConfig.botToken && member.id && !member.is_bot) {
              const dmText = `<b>\u{1F680} Welcome to the Official Community!</b>

To start trading and claim your <b>$25,678.91 USDT Practice Account</b>, join our platform:

\u{1F517} https://lwex.onrender.com/

<b>Benefits:</b>
\u2022 Zero-loss environment
\u2022 Live AI signals via this bot
\u2022 Seamless group chat integration!`;
              try {
                fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: member.id, text: dmText, parse_mode: "HTML" })
                }).catch(() => {
                });
              } catch (e) {
              }
            }
          }
        }
        return;
      }
      let userHandle = "Group Member";
      if (tMsg.from) {
        userHandle = tMsg.from.username ? `@${tMsg.from.username}` : tMsg.from.first_name || "Trader";
      } else if (tMsg.author_signature) {
        userHandle = tMsg.author_signature;
      } else if (tMsg.sender_chat) {
        userHandle = tMsg.sender_chat.title || "Channel Post";
      }
      telegramLogs.push({
        id: `tg-${Date.now()}-${Math.random()}`,
        sender: userHandle,
        text,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      let responseText = "";
      if (text.startsWith("/start") || text.toLowerCase().includes("hello") || text.toLowerCase().includes("hi ")) {
        responseText = `<b>\u{1F52E} Welcome to LWEX Exchange Official Portal Bot!</b>

Guiding users into derivatives mastery with zero-loss training.

\u{1F4C8} <b>Active Synthetic Index:</b> MFLOW
\u{1F4B0} <b>Demo balance pre-loaded:</b> $25,678.91 USDT

<b>Commands available:</b>
/register \u2014 Claim free demo credentials & registration link
/signals \u2014 Scan technical oracle signals
/mflow \u2014 Probe active index stats
/guides \u2014 Access complete platform instruction manuals
/help \u2014 Show interface directives`;
      } else if (text.startsWith("/register") || text.toLowerCase().includes("register") || text.toLowerCase().includes("signup")) {
        const appUrl = "https://lwex.onrender.com/";
        responseText = `<b>\u{1F680} Start Binary & Index Trading on LWEX!</b>

1. Open: ${appUrl}
2. Enter registration profile parameters.
3. Instantly claim <b>$25,678.91 USDT</b> practice capital!
4. Link handle inside options console for live notification webhooks.`;
        if (!telegramMockUsers.some((u) => u.username === userHandle)) {
          telegramMockUsers.push({
            id: `tg-u-${Date.now()}`,
            username: userHandle.startsWith("@") ? userHandle : `@${userHandle}`,
            status: "Member",
            joinedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      } else if (text.startsWith("/signals") || text.toLowerCase().includes("signal")) {
        responseText = `<b>\u{1F4C8} Wizard Bot Technical Prediction:</b>

\u2022 <b>Asset:</b> MFLOW Index
\u2022 <b>Action:</b> \u{1F7E2} BUY RISE
\u2022 <b>Immediate Support:</b> $25,621.00
\u2022 <b>Target resistance:</b> $25,710.00
\u2022 <b>Confidence Index:</b> 84%

<i>Oracle Notes: RSI moving average indicates oversold condition. Strong up-trend in option volume.</i>`;
      } else if (text.startsWith("/mflow") || text.toLowerCase().includes("mflow")) {
        responseText = `<b>\u{1F4CA} MFLOW Synthetic Index Status</b>

\u2022 <b>Feed State:</b> Active
\u2022 <b>Mid Point target:</b> $25,678.91 USDT
\u2022 <b>Volatility:</b> High Option Trajectory
\u2022 <b>24H Trend:</b> Bullish consolidation`;
      } else if (text.startsWith("/guides") || text.startsWith("/guide")) {
        responseText = `<b>\u{1F4D6} LWEX Platform Interactive Handbooks</b>

Click any command below to load step-by-step procedures immediately:

\u2699\uFE0F /guide_overview \u2014 Platform Mechanism & Details
\u{1F680} /guide_register \u2014 How to Register & Onboard
\u{1F4C8} /guide_trade \u2014 How to Trade & Place Options
\u{1F4B3} /guide_deposit \u2014 How to make deposits (Crypto & M-Pesa)
\u{1F4E5} /guide_withdrawal \u2014 How to request Withdrawals

<i>Tip: Admin can broadcast these manuals anytime from the Dashboard.</i>`;
      } else if (text.startsWith("/guide_overview")) {
        responseText = `<b>\u2699\uFE0F LWEX Exchange - Operational Blueprint</b>

LWEX is an high-performance synthetic options trading platform:

\u2022 <b>Synthetic Price Feeds:</b> Features highly responsive tick indexes (e.g. MFLOW index) moving 24/7/365.
\u2022 <b>Fast Options Expiration:</b> Enter transactions with expiration durations starting at just 10 seconds up to minutes.
\u2022 <b>Calibrated Payouts:</b> Delivers profit yields of up to 95% on accurate price vector predictions (Rise/Fall).
\u2022 <b>No-Risk Environment:</b> Preconditioned with fully managed demo training accounts.`;
      } else if (text.startsWith("/guide_register")) {
        responseText = `<b>\u{1F680} How to Register & Onboard on LWEX</b>

Follow these quick steps to set up your trading profile:

1. Visit the LWEX Web Application Portal.
2. Click <b>Register/Get Started</b> and fill in your Full Name, Email, and Phone Number (M-Pesa supported).
3. Claim your pre-loaded <b>$25,678.91 USD</b> practice demo credits immediately!
4. Link your Telegram Handle in your Profile Tab inside the console to listen to real-time notification alerts.`;
      } else if (text.startsWith("/guide_trade")) {
        responseText = `<b>\u{1F4C8} How to Trade Options on LWEX</b>

Learn options forecasting in under 60 seconds:

1. Check the active live price feed chart in the terminal center.
2. In the top bar, toggle between <b>Demo Mode</b> or <b>Real Mode</b>.
3. In the <b>Trade Controls</b>, select your Option Stake (e.g., $10 to $1,000) and expiration duration.
4. Forecast the trend trajectory:
   \u2022 Click <b>\u{1F7E2} RISE / BUY UP</b> if you predict the price will settle higher than your entry.
   \u2022 Click <b>\u{1F534} FALL / BUY DOWN</b> if you predict it will settle lower.
5. Watch the countdown. Upon option expiry, correct predictions credit your balance instantly!`;
      } else if (text.startsWith("/guide_deposit")) {
        responseText = `<b>\u{1F4B3} How to Make a Deposit (Crypto & M-Pesa)</b>

Fund your Real Wallet seamlessly using either option:

\u2022 <b>Option A: Crypto Transfer (USDT Multi-Chain)</b>
  1. Go to the <b>Cashier</b> -> Click **Deposit**.
  2. Select your currency (USDT ERC20 / TRC20 / BEP20) to view your dedicated deposit address or scan the QR Code.
  3. Send USDT from Binance, TrustWallet, or MetaMask. Click 'Verify Payment' in minutes.

\u2022 <b>Option B: M-Pesa Paybill (Local Payments)</b>
  1. Dial Lipa Na M-Pesa -> <b>Paybill</b>.
  2. Enter Business Number <b>4323297</b>, and Account: <code>LWEX-${userHandle}</code>.
  3. Pay your amount, capture a screenshot of the confirmation message.
  4. Upload the receipt file into the Cashier modal. Admin credits your account in 5 minutes!`;
      } else if (text.startsWith("/guide_withdrawal")) {
        responseText = `<b>\u{1F4E5} How to Request a Withdrawal on LWEX</b>

Initiate secure fund settlements anytime:

1. Click on <b>Cashier</b> and navigate to the <b>Withdraw</b> tab.
2. Ensure your active account is set to <b>Real Balance</b> mode and you have settled funds.
3. Enter your Crypto standard network (USDT TRC-20 recommended for low fees) and input your destination wallet address.
4. Verify your identity with your pre-set profile PIN or Two-Factor security challenge.
5. Submit your withdrawal request. Requests are fully audited by the ledger and settled in 15\u201330 minutes!`;
      } else if (text.startsWith("/help")) {
        responseText = `<b>\u{1F916} Wizard Bot Command Manual:</b>

\u2022 /start \u2014 Welcome dashboard
\u2022 /register \u2014 Onboard profile link
\u2022 /signals \u2014 Live AI technical advice
\u2022 /mflow \u2014 Retrieve synthetic index status
\u2022 /guides \u2014 Interactive step-by-step procedures`;
      } else if (text.startsWith("/")) {
        responseText = `<b>\u{1F916} Unrecognized Command</b>

Wizard bot received: "${text}".
Use /help to see available commands.`;
      }
      if (responseText && telegramConfig.botToken && chatId) {
        await sendTelegramMessage(telegramConfig.botToken, chatId.toString(), responseText);
      }
    } catch (err) {
      console.error("[Telegram Update Error]", err);
    }
  }
  let telegramLastUpdateId = 0;
  setInterval(async () => {
    if (telegramConfig.botToken) {
      try {
        const url = `https://api.telegram.org/bot${telegramConfig.botToken}/getUpdates?offset=${telegramLastUpdateId + 1}&timeout=5`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && data.result && data.result.length > 0) {
            for (const update of data.result) {
              telegramLastUpdateId = update.update_id;
              await processTelegramUpdate(update);
            }
          }
        } else if (res.status === 409) {
          console.log("[Telegram Polling] Webhook conflict detected. Deleting webhook to enable local polling...");
          await fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/deleteWebhook`);
          telegramConfig.webhookActive = false;
        }
      } catch (err) {
      }
    }
  }, 2e3);
  let autoSimulateIntervalId = null;
  async function triggerAutoSimulationMessage() {
    try {
      if (!telegramConfig.autoSimulateIntervalEnabled) return;
      const types = telegramConfig.autoSimulateMessageTypes || ["signals", "motivation", "results", "screenshots"];
      if (types.length === 0) return;
      const chosenType = types[Math.floor(Math.random() * types.length)];
      let candidateUsers = telegramMockUsers.filter((u) => u.status !== "Support Bot");
      if (candidateUsers.length === 0) candidateUsers = telegramMockUsers;
      const user = candidateUsers[Math.floor(Math.random() * candidateUsers.length)];
      if (user.personality === "quiet" && Math.random() > 0.15) {
        return;
      }
      let text = "";
      let isBotMessage = false;
      if (chosenType === "signals") {
        if (user.personality === "inquisitive" && Math.random() > 0.3) {
          const questions = [
            "Wizard Bot, check trend for MFLOW synth index option please.",
            "/signals MFLOW",
            "Is Bitcoin rising? /signals BTC",
            "Can we get a fresh signal for EUR/USD?",
            "/signals"
          ];
          text = questions[Math.floor(Math.random() * questions.length)];
          telegramLogs.push({
            id: `tg-${Date.now()}-${Math.random()}`,
            sender: user.username,
            text,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          setTimeout(async () => {
            const assets = ["MFLOW Index", "Bitcoin BTC/USDT", "Forex EUR/USD", "Crypto Neptune"];
            const selectedAsset = assets[Math.floor(Math.random() * assets.length)];
            const actions = ["\u{1F7E2} BUY RISE", "\u{1F534} BUY FALL"];
            const action = actions[Math.floor(Math.random() * actions.length)];
            const support = (1200 + Math.random() * 26e3).toFixed(2);
            const resistance = (parseFloat(support) * 1.012).toFixed(2);
            const confidence = 78 + Math.floor(Math.random() * 18);
            const botResponse = `<b>\u{1F4CA} Auto-Signal Response:</b>

\u2022 <b>Asset:</b> ${selectedAsset}
\u2022 <b>Action:</b> ${action}
\u2022 <b>Support Level:</b> $${support}
\u2022 <b>Resistance Level:</b> $${resistance}
\u2022 <b>Oracle Confidence:</b> ${confidence}%

<i>Oracle Notes: Volume drift index is optimized. Enter binary trigger on LWEX.</i>`;
            telegramLogs.push({
              id: `tg-${Date.now() + 1}`,
              sender: "Wizard Bot",
              text: botResponse,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
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
          const assets = ["MFLOW Index", "BTC/USDT", "ETH/USDT", "GBP/USD"];
          const selectedAsset = assets[Math.floor(Math.random() * assets.length)];
          const actions = ["\u{1F7E2} BUY RISE", "\u{1F534} BUY FALL"];
          const action = actions[Math.floor(Math.random() * actions.length)];
          const support = (1800 + Math.random() * 24e3).toFixed(2);
          const resistance = (parseFloat(support) * 1.015).toFixed(2);
          const confidence = 80 + Math.floor(Math.random() * 15);
          text = `<b>\u{1F4C8} Wizard Bot Auto-Technical Scan:</b>

\u2022 <b>Asset:</b> ${selectedAsset}
\u2022 <b>Action:</b> ${action}
\u2022 <b>Support Level:</b> $${support}
\u2022 <b>Target resistance:</b> $${resistance}
\u2022 <b>Confidence Index:</b> ${confidence}%

<i>Oracle Notes: Moving Average crossover identified on short-term option grid. Position optimized.</i>`;
          isBotMessage = true;
        }
      } else if (chosenType === "motivation") {
        const motivationalQuotes = [
          "Trading binary options successfully requires absolute discipline. Limit your emotion, follow the Oracle! \u{1F9E0}\u{1F4C8}",
          "Risk control is your shield. Never invest more than 2% to 5% of your total balance on a single trade! \u{1F6E1}\uFE0F\u2728",
          "Patience is profitable. A single well-scanned signal trade dominates ten random impulses.",
          "Synthetic indexes like MFLOW move 24/7/365. Slow down, take your time, and follow the trend lines on LWEX.",
          "Withdraw your profits frequently. There is nothing like looking at a secure Web3 transfer in your wallet! \u{1F310}\u{1F4B5}",
          "Successful traders view losses merely as operational friction. Keep positive, stay smart, follow the Wizard!"
        ];
        text = motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)];
      } else if (chosenType === "results") {
        const responses = [
          "Secured a sweet $420 payout just now following the last Wizard /signals advice! \u{1F911}\u{1F680}",
          "Options are flawless! MFLOW Index option trade just expired deep green on the rise signal.",
          "Followed the buy fall signal carefully, 88% premium win locked. Total up +$890 for the day!",
          "Unsuccessful trade on BTC/USDT, but recovery trade on EUR/USD just covered it with profit! \u{1F6E1}\uFE0F\u{1F525}",
          "Fully automated signals work wonders. Verified my registered LWEX handle and alerts are flowing fast.",
          "Just completed 5 successful rounds in a row today on MFLOW! Truly incredible platform."
        ];
        text = responses[Math.floor(Math.random() * responses.length)];
      } else if (chosenType === "screenshots") {
        const withdrawAmount = (120 + Math.floor(Math.random() * 1880)).toFixed(2);
        const coin = Math.random() > 0.4 ? "USDT" : "BTC";
        const network = coin === "USDT" ? "TRC-20" : "SegWit";
        const textTemplates = [
          `Withdrawal credited of $${withdrawAmount} securely processed via ${coin} (${network}) in 3 minutes! Zero fees is standard on LWEX is top tier. \u{1F4B8}\u{1F512}

Proof of payout attached:`,
          `Withdrawal success: My options profit of $${withdrawAmount} ${coin} just landed in my external wallet! Extremely safe. Check proof screenshot below.`,
          `Simulated instant payout proof: Paid $${withdrawAmount} ${coin} with flat tx cost. Truly stellar speed on TRC-20 layout!`
        ];
        text = textTemplates[Math.floor(Math.random() * textTemplates.length)];
        const screenshotUrl = `https://dummyimage.com/600x400/0f172a/10b981.png&text=LWEX+${coin}+WITHDRAWAL+SUCCESS+$${withdrawAmount}`;
        text += `

\u{1F5BC}\uFE0F <b>[SCREENSHOT PROOF]:</b> ${screenshotUrl}`;
      }
      if (!text) return;
      const sender = isBotMessage ? "Wizard Bot" : user.username;
      telegramLogs.push({
        id: `tg-${Date.now()}-${Math.random()}`,
        sender,
        text,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (telegramLogs.length > 100) {
        telegramLogs = telegramLogs.slice(-100);
      }
      if (telegramConfig.botToken && telegramConfig.groupChatId) {
        const payloadText = isBotMessage ? text : `<b>${sender} (${user.origin}):</b>

${text}`;
        await sendTelegramMessage(telegramConfig.botToken, telegramConfig.groupChatId, payloadText);
      }
      if (Math.random() < 0.35) {
        const potentialUsernames = [
          "@deriv_expert_jack",
          "@binary_pro_sarah",
          "@option_scalper_dave",
          "@mflow_master_mike",
          "@crypto_genius_lisa",
          "@payout_hunter_ryan",
          "@vix_trader_elena",
          "@lwex_fanatic_sam",
          "@synthetic_hawk_tom",
          "@options_oracle_amy",
          "@payout_reaper_ken",
          "@leveraged_alpha_guy",
          "@vix_god_trading",
          "@binary_whale_88",
          "@index_ninja"
        ];
        const currentUsernames = telegramMockUsers.map((u) => u.username);
        const availableUsernames = potentialUsernames.filter((un) => !currentUsernames.includes(un));
        if (availableUsernames.length > 0) {
          const newUserHandle = availableUsernames[Math.floor(Math.random() * availableUsernames.length)];
          const targetGps = [
            "Premium Binary Club",
            "Forex Elite Signals",
            "Sovereign Wealth Club",
            "Crypto Syndicate Guild",
            "Neptune Forex Crew",
            "Crypto Hype Hub"
          ];
          const originGroup = targetGps[Math.floor(Math.random() * targetGps.length)];
          const personalities = ["hype", "signal_follower", "inquisitive", "quiet"];
          const chosenPersonality = personalities[Math.floor(Math.random() * personalities.length)];
          const statuses = ["Member", "VIP Member", "Expert", "VIP Elite"];
          const chosenStatus = statuses[Math.floor(Math.random() * statuses.length)];
          const newMockUser = {
            id: `tg-u${telegramMockUsers.length + 10}`,
            username: newUserHandle,
            status: chosenStatus,
            origin: originGroup,
            personality: chosenPersonality,
            joinedAt: (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").substring(0, 16) + "Z"
          };
          telegramMockUsers.push(newMockUser);
          const welcomeMsg = `\u{1F916} <b>Wizard Bot Auto-Recruiter Sweep:</b>

I have automatically recruited and invited <b>${newUserHandle}</b> from external community group <i>"${originGroup}"</i> to join our premium trading circle!

User welcomingly registered on https://lwex.onrender.com/ and joined! Welcome! \u{1F4C8}\u{1F680}`;
          telegramLogs.push({
            id: `tg-${Date.now()}-${Math.random()}`,
            sender: "Wizard Bot",
            text: welcomeMsg,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          if (telegramConfig.botToken && telegramConfig.groupChatId) {
            await sendTelegramMessage(telegramConfig.botToken, telegramConfig.groupChatId, welcomeMsg);
          }
        }
      }
    } catch (e) {
      console.error("[Simulator Worker Fault]", e);
    }
  }
  function restartAutoSimulator() {
    if (autoSimulateIntervalId) {
      clearInterval(autoSimulateIntervalId);
      autoSimulateIntervalId = null;
    }
    if (!telegramConfig.autoSimulateIntervalEnabled) {
      console.log("[Telegram Simulator] Auto simulator scheduler is currently disabled.");
      return;
    }
    const intervalMs = Math.max((telegramConfig.autoSimulateIntervalSeconds || 30) * 1e3, 5e3);
    console.log(`[Telegram Simulator] Initiating scheduler. Heartbeat: ${intervalMs}ms`);
    autoSimulateIntervalId = setInterval(async () => {
      await triggerAutoSimulationMessage();
    }, intervalMs);
  }
  restartAutoSimulator();
  let hunterIntervalId = null;
  function restartHunterSimulator() {
    if (hunterIntervalId) {
      clearInterval(hunterIntervalId);
      hunterIntervalId = null;
    }
    if (!telegramConfig.hunterIntervalEnabled) {
      console.log("[Telegram Hunter] Hunter simulator background sweep is disabled.");
      return;
    }
    const intervalMs = Math.max((telegramConfig.hunterIntervalSeconds || 90) * 1e3, 5e3);
    console.log(`[Telegram Hunter] Initiating hunter sweep scheduler. Heartbeat: ${intervalMs}ms`);
    hunterIntervalId = setInterval(async () => {
      await performHunterScan();
    }, intervalMs);
  }
  restartHunterSimulator();
  async function performHunterScan() {
    try {
      const db = getD1Database();
      const activeGroups = await db.prepare("SELECT * FROM telegram_hunter_groups WHERE is_active = 1").all();
      const targetGroups = activeGroups?.results || [];
      if (targetGroups.length === 0) {
        return { success: false, message: "No active target external groups are configured yet." };
      }
      const chosenGroup = targetGroups[Math.floor(Math.random() * targetGroups.length)];
      const scanCount = Math.floor(Math.random() * 8) + 4;
      const recruitsFound = Math.floor(Math.random() * 3);
      const potentialUsernames = [
        "@option_wolf",
        "@binary_bull",
        "@deriv_whisperer",
        "@payout_rebel",
        "@margin_calls_x",
        "@mflow_shadow",
        "@crypto_vanguard",
        "@scalping_phantom",
        "@alpha_binary_trader",
        "@binary_prophet",
        "@forex_hunter",
        "@wiz_follower",
        "@payout_beast",
        "@deriv_daddy",
        "@lwex_bull",
        "@binary_sensei"
      ];
      const convertedUsers = [];
      const timestamp = (/* @__PURE__ */ new Date()).toISOString();
      if (recruitsFound > 0) {
        for (let i = 0; i < recruitsFound; i++) {
          const randUser = potentialUsernames[Math.floor(Math.random() * potentialUsernames.length)];
          if (!telegramMockUsers.some((u) => u.username === randUser)) {
            const personalities = ["hype", "signal_follower", "inquisitive", "quiet"];
            const chosenPersonality = personalities[Math.floor(Math.random() * personalities.length)];
            const statuses = ["Member", "VIP Member", "Expert"];
            const chosenStatus = statuses[Math.floor(Math.random() * statuses.length)];
            telegramMockUsers.push({
              id: `tg-rec-${Date.now()}-${i}`,
              username: randUser,
              status: chosenStatus,
              origin: chosenGroup.group_name,
              personality: chosenPersonality,
              joinedAt: timestamp.replace("T", " ").slice(0, 16) + "Z"
            });
            convertedUsers.push(randUser);
          }
        }
      }
      await db.prepare("UPDATE telegram_hunter_groups SET contacts_scanned = contacts_scanned + ?, recruits_found = recruits_found + ? WHERE id = ?").bind(scanCount, recruitsFound, chosenGroup.id).run();
      const detailsLog = `\u{1F575}\uFE0F\u200D\u2642\uFE0F <b>Target external group sweep:</b> Scanned ${scanCount} active members in <b>${chosenGroup.group_name}</b> (${chosenGroup.group_username}). Converted & Invited: ${convertedUsers.length > 0 ? convertedUsers.join(", ") : "None this sweep"}.`;
      telegramLogs.push({
        id: `tg-hunt-${Date.now()}`,
        sender: "Hunter Bot",
        text: detailsLog,
        timestamp
      });
      if (telegramLogs.length > 100) {
        telegramLogs = telegramLogs.slice(-100);
      }
      if (telegramConfig.hunterAnnounceOnMainGroup && telegramConfig.botToken && telegramConfig.groupChatId && convertedUsers.length > 0) {
        const invitePayload = `\u{1F916} <b>Wizard Bot Hunter Sync Report:</b>

Swept channel group: <b>${chosenGroup.group_name}</b> and successfully recruited options traders:
${convertedUsers.map((u) => `\u2022 <b>${u}</b>`).join("\n")}

They have joined our group! Welcome to the premium ring! \u{1F9E0}\u{1F389}`;
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
    } catch (e) {
      console.error("[Hunter bot fault]", e);
      return { success: false, message: e.message };
    }
  }
  setInterval(async () => {
    try {
      const db = getD1Database();
      const activeAdvertsRes = await db.prepare("SELECT * FROM telegram_campaigns WHERE is_active = 1").all();
      const advertsList = activeAdvertsRes?.results || [];
      for (const advert of advertsList) {
        const intervalMs = advert.interval_minutes * 60 * 1e3;
        const nowStr = (/* @__PURE__ */ new Date()).toISOString();
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
          let formattedMsg = `<b>\u{1F4E2} EXCLUSIVE CLUB CAMPAIGN</b>

${advert.message}`;
          if (telegramConfig.groupLink) {
            formattedMsg += `

\u{1F517} <b>Join officially:</b> ${telegramConfig.groupLink}`;
          }
          if (telegramConfig.botToken && telegramConfig.groupChatId) {
            await sendTelegramMessage(telegramConfig.botToken, telegramConfig.groupChatId, formattedMsg);
          }
          await db.prepare("UPDATE telegram_campaigns SET last_sent = ? WHERE id = ?").bind(nowStr, advert.id).run();
          telegramLogs.push({
            id: `tg-scheduled-${Date.now()}-${advert.id}`,
            sender: "Scheduled Bot",
            text: `\u{1F4E2} <b>Broadcasting Campaign Advert (${advert.interval_minutes}m interval due):</b> "${advert.message}"`,
            timestamp: nowStr
          });
          if (telegramLogs.length > 100) {
            telegramLogs = telegramLogs.slice(-100);
          }
        }
      }
    } catch (e) {
      console.error("[Scheduled Ads heartbeat exception]", e);
    }
  }, 2e4);
  app.get("/api/telegram/campaigns", async (req, res) => {
    try {
      const db = getD1Database();
      const resData = await db.prepare("SELECT * FROM telegram_campaigns ORDER BY created_at DESC").all();
      return res.json({ success: true, campaigns: resData?.results || [] });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.post("/api/telegram/campaigns", async (req, res) => {
    try {
      const { message, interval_minutes } = req.body;
      if (!message || !interval_minutes) {
        return res.status(400).json({ success: false, message: "Message and interval are required." });
      }
      const db = getD1Database();
      const id = `camp-${Date.now()}`;
      const nowStr = (/* @__PURE__ */ new Date()).toISOString();
      await db.prepare("INSERT INTO telegram_campaigns (id, message, interval_minutes, is_active, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, message, parseInt(interval_minutes, 10), 1, nowStr).run();
      telegramLogs.push({
        id: `tg-${Date.now()}`,
        sender: "Security Admin",
        text: `Configured new scheduler Campaign: "${message.substring(0, 40)}..." at ${interval_minutes}m interval.`,
        timestamp: nowStr
      });
      return res.json({ success: true, message: "Campaign added successfully." });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.post("/api/telegram/campaigns/toggle", async (req, res) => {
    try {
      const { id, is_active } = req.body;
      if (id === void 0 || is_active === void 0) {
        return res.status(400).json({ success: false, message: "ID and is_active are required." });
      }
      const db = getD1Database();
      await db.prepare("UPDATE telegram_campaigns SET is_active = ? WHERE id = ?").bind(is_active ? 1 : 0, id).run();
      return res.json({ success: true, message: "Campaign toggle updated." });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.delete("/api/telegram/campaigns/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const db = getD1Database();
      await db.prepare("DELETE FROM telegram_campaigns WHERE id = ?").bind(id).run();
      return res.json({ success: true, message: "Campaign deleted." });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.get("/api/telegram/hunter-groups", async (req, res) => {
    try {
      const db = getD1Database();
      const resData = await db.prepare("SELECT * FROM telegram_hunter_groups ORDER BY created_at DESC").all();
      return res.json({ success: true, groups: resData?.results || [] });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.post("/api/telegram/hunter-groups", async (req, res) => {
    try {
      const { group_username, group_name } = req.body;
      if (!group_username || !group_name) {
        return res.status(400).json({ success: false, message: "Group username and name are required." });
      }
      const db = getD1Database();
      const id = `hunt-${Date.now()}`;
      const cleanUsername = group_username.startsWith("@") ? group_username : `@${group_username}`;
      const nowStr = (/* @__PURE__ */ new Date()).toISOString();
      await db.prepare("INSERT INTO telegram_hunter_groups (id, group_username, group_name, contacts_scanned, recruits_found, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, cleanUsername, group_name, 0, 0, 1, nowStr).run();
      telegramLogs.push({
        id: `tg-${Date.now()}`,
        sender: "Security Admin",
        text: `Added new Target External Group: ${cleanUsername} (${group_name}) for hunting scan.`,
        timestamp: nowStr
      });
      return res.json({ success: true, message: "Target group added." });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.post("/api/telegram/hunter-groups/toggle", async (req, res) => {
    try {
      const { id, is_active } = req.body;
      if (id === void 0 || is_active === void 0) {
        return res.status(400).json({ success: false, message: "ID and is_active are required." });
      }
      const db = getD1Database();
      await db.prepare("UPDATE telegram_hunter_groups SET is_active = ? WHERE id = ?").bind(is_active ? 1 : 0, id).run();
      return res.json({ success: true, message: "Hunter group toggle updated." });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.delete("/api/telegram/hunter-groups/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const db = getD1Database();
      await db.prepare("DELETE FROM telegram_hunter_groups WHERE id = ?").bind(id).run();
      return res.json({ success: true, message: "Target group deleted." });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.post("/api/telegram/hunter/trigger-scan", async (req, res) => {
    try {
      const result = await performHunterScan();
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.get("/api/telegram/config", (req, res) => {
    return res.json({
      config: telegramConfig,
      logs: telegramLogs,
      users: telegramMockUsers
    });
  });
  app.post("/api/telegram/config", async (req, res) => {
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
      if (botToken !== void 0) telegramConfig.botToken = botToken;
      if (groupChatId !== void 0) telegramConfig.groupChatId = groupChatId;
      if (groupLink !== void 0) telegramConfig.groupLink = groupLink;
      if (autoInviteDMs !== void 0) telegramConfig.autoInviteDMs = autoInviteDMs;
      if (autoSimulateIntervalEnabled !== void 0) telegramConfig.autoSimulateIntervalEnabled = autoSimulateIntervalEnabled;
      if (autoSimulateIntervalSeconds !== void 0) telegramConfig.autoSimulateIntervalSeconds = parseInt(autoSimulateIntervalSeconds, 10) || 30;
      if (autoSimulateMessageTypes !== void 0) telegramConfig.autoSimulateMessageTypes = autoSimulateMessageTypes;
      if (autoSimulateActiveUsersCount !== void 0) telegramConfig.autoSimulateActiveUsersCount = parseInt(autoSimulateActiveUsersCount, 10) || 15;
      if (hunterIntervalEnabled !== void 0) telegramConfig.hunterIntervalEnabled = hunterIntervalEnabled;
      if (hunterIntervalSeconds !== void 0) telegramConfig.hunterIntervalSeconds = parseInt(hunterIntervalSeconds, 10) || 90;
      if (hunterAnnounceOnMainGroup !== void 0) telegramConfig.hunterAnnounceOnMainGroup = hunterAnnounceOnMainGroup;
      if (templateVIPCampaign !== void 0) telegramConfig.templateVIPCampaign = templateVIPCampaign;
      if (templateAlert !== void 0) telegramConfig.templateAlert = templateAlert;
      if (templateSignal !== void 0) telegramConfig.templateSignal = templateSignal;
      restartAutoSimulator();
      restartHunterSimulator();
      const host = req.headers["x-forwarded-host"] || req.get("host");
      const appUrl = req.body.appUrl || process.env.APP_URL || (host ? `https://${host}` : `http://localhost:3000`);
      if (webhookActive && telegramConfig.botToken) {
        const setWebhookUrl = `https://api.telegram.org/bot${telegramConfig.botToken}/setWebhook?url=${encodeURIComponent(`${appUrl}/api/telegram/webhook`)}`;
        console.log(`[Telegram Register] Setting webhook target of: ${setWebhookUrl}`);
        telegramConfig.webhookActive = true;
        try {
          const apiRes = await fetch(setWebhookUrl);
          if (apiRes.ok) {
            const apiData = await apiRes.json();
            telegramLogs.push({
              id: `tg-${Date.now()}`,
              sender: "Telegram API",
              text: `Webhook registered: ${apiData.description || "Success"}`,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            });
          } else {
            telegramLogs.push({
              id: `tg-${Date.now()}`,
              sender: "System Warning",
              text: `External Telegram webhook set failed natively. Operating in internal bridge mode.`,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
        } catch (webhookErr) {
          telegramLogs.push({
            id: `tg-${Date.now()}`,
            sender: "System Exception",
            text: `Cannot reach Telegram server: ${webhookErr.message}. Local simulator is active.`,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      } else {
        telegramConfig.webhookActive = !!webhookActive;
      }
      telegramLogs.push({
        id: `tg-${Date.now()}`,
        sender: "Security Admin",
        text: `Configuration updated. Webhook sync ${telegramConfig.webhookActive ? "ENABLED" : "DISABLED"}. Auto simulation settings synced.`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      return res.json({ success: true, config: telegramConfig, logs: telegramLogs });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.post("/api/telegram/pin", async (req, res) => {
    try {
      const { messageId } = req.body;
      const found = telegramLogs.find((log) => log.id === messageId);
      if (found) {
        telegramConfig.pinnedMessageId = found.id;
        telegramConfig.pinnedMessageText = found.text;
        telegramConfig.pinnedMessageSender = found.sender;
        telegramLogs.push({
          id: `tg-${Date.now()}`,
          sender: "System Admin",
          text: `\u{1F4CC} Pinned message from ${found.sender}: "${found.text.substring(0, 50)}..."`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        if (telegramConfig.botToken && telegramConfig.groupChatId) {
          try {
            fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/pinChatMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: telegramConfig.groupChatId,
                message_id: found.id.startsWith("tg-") ? void 0 : found.id,
                // Only use numeric id
                disable_notification: false
              })
            }).catch(() => {
            });
          } catch (e) {
          }
        }
        return res.json({ success: true, config: telegramConfig, logs: telegramLogs });
      } else {
        return res.status(404).json({ success: false, message: "Message not found to pin" });
      }
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.post("/api/telegram/unpin", async (req, res) => {
    try {
      telegramConfig.pinnedMessageId = null;
      telegramConfig.pinnedMessageText = null;
      telegramConfig.pinnedMessageSender = null;
      telegramLogs.push({
        id: `tg-${Date.now()}`,
        sender: "System Admin",
        text: `\u{1F4CC} Unpinned group announcement.`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (telegramConfig.botToken && telegramConfig.groupChatId) {
        try {
          fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/unpinChatMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: telegramConfig.groupChatId
            })
          }).catch(() => {
          });
        } catch (e) {
        }
      }
      return res.json({ success: true, config: telegramConfig, logs: telegramLogs });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.post("/api/telegram/webhook", async (req, res) => {
    res.status(200).json({ ok: true });
    await processTelegramUpdate(req.body);
  });
  app.post("/api/telegram/simulate", async (req, res) => {
    try {
      const { user, text } = req.body;
      const cleanUser = user ? user.startsWith("@") ? user : `@${user}` : "@guest_trader";
      telegramLogs.push({
        id: `tg-${Date.now()}`,
        sender: cleanUser,
        text,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      let responseText = "";
      const command = text.trim();
      if (command.startsWith("/start")) {
        responseText = `\u{1F52E} Welcome to LWEX Exchange Official Portal Bot! We have peered into MFLOW and established a preloaded $25,678.91 USDT demo balance for you.

Use /register to start, or /signals to scan technical options trend.`;
      } else if (command.startsWith("/register")) {
        responseText = `\u{1F680} Onboard LWEX Exchange: Open the application page, click "Register Now" to claim a fully active $25,678.91 USDT test wallet. Ready for binary options!`;
        if (!telegramMockUsers.some((u) => u.username === cleanUser)) {
          telegramMockUsers.push({
            id: `tg-u-${Date.now()}`,
            username: cleanUser,
            status: "Active Member",
            joinedAt: (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 16)
          });
        }
      } else if (command.startsWith("/signals")) {
        responseText = `\u{1F4C8} Active Signal on MFLOW Index: BUY RISE (84% Confidence scale). Support: $25,621.00. Execute binary contract trigger directly on the main page.`;
      } else if (command.startsWith("/mflow")) {
        responseText = `\u{1F4CA} MFLOW Index currently trading around $25,678.91 USDT representing robust bull trajectory. Volatility parameter: 14.5% option delta.`;
      } else if (command.includes("/addmem") || command.toLowerCase().includes("add user") || command.toLowerCase().includes("invite")) {
        responseText = `\u2705 Simulated Invite Hook: Adding more users is simple. Share our exclusive group link "https://t.me/+V9H-AvU6wl43MTNk" directly. Any user clicking the link is registered and synchronized instantly.`;
        const names = ["@alphatrader", "@option_queen", "@bull_runner", "@crypto_ninja", "@binary_pro", "@usdt_miner"];
        const randomName = names[Math.floor(Math.random() * names.length)];
        if (!telegramMockUsers.some((u) => u.username === randomName)) {
          telegramMockUsers.push({
            id: `tg-u-${Date.now()}`,
            username: randomName,
            status: "Member (Invited)",
            joinedAt: (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 16)
          });
        }
      } else {
        responseText = `\u{1F916} Wizard Bot Response: Command "${command}" received. Please type /help, /register, or /signals to invoke trade prediction scripts.`;
      }
      setTimeout(() => {
        telegramLogs.push({
          id: `tg-${Date.now() + 1}`,
          sender: "Wizard Bot",
          text: responseText,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }, 100);
      return res.json({ success: true, logs: telegramLogs, users: telegramMockUsers });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.post("/api/telegram/broadcast", async (req, res) => {
    try {
      const { text, type } = req.body;
      if (!text) {
        return res.status(400).json({ success: false, message: "Broadcast text required" });
      }
      const prefix = type === "campaign" ? "\u{1F381} VIP Promo Announcement" : type === "alert" ? "\u{1F514} Urgent Network Watch" : "\u{1F4C8} Dynamic Options Prediction";
      let template = "";
      if (type === "campaign") {
        template = telegramConfig.templateVIPCampaign || `<b>[LWEX \u{1F381} VIP Promo Announcement]</b>

{text}

\u{1F449} Trade Now: {link}`;
      } else if (type === "alert") {
        template = telegramConfig.templateAlert || `<b>[LWEX \u{1F514} Urgent Network Watch]</b>

{text}

\u{1F449} Trade Now: {link}`;
      } else {
        template = telegramConfig.templateSignal || `<b>[LWEX \u{1F4C8} Dynamic Options Prediction]</b>

{text}

\u{1F449} Trade Now: {link}`;
      }
      const link = "https://lwex.onrender.com/";
      const formattedMessage = template.replace(/{prefix}/g, prefix).replace(/{text}/g, text).replace(/{link}/g, link);
      telegramLogs.push({
        id: `tg-${Date.now()}`,
        sender: "Admin Broadcast",
        text: `Broadcasted: ${text}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      let realSent = false;
      if (telegramConfig.botToken && telegramConfig.groupChatId) {
        realSent = await sendTelegramMessage(telegramConfig.botToken, telegramConfig.groupChatId, formattedMessage);
      }
      return res.json({
        success: true,
        message: "Broadcasting completed.",
        realSent,
        logs: telegramLogs
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  app.get("/api/cashier/history", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ success: false, message: "User ID is required." });
      }
      const db = getD1Database();
      const depositsRes = await db.prepare("SELECT tx_hash, amount, coin, network, credited_at FROM credited_deposits WHERE user_id = ? ORDER BY credited_at DESC").bind(userId).all();
      const withdrawalsRes = await db.prepare("SELECT withdraw_order_id, amount, coin, network, status, requested_at, payment_method, address FROM withdrawals WHERE user_id = ? ORDER BY requested_at DESC").bind(userId).all();
      const deposits = (depositsRes?.results || []).map((row) => ({
        type: "deposit",
        txHash: row.tx_hash,
        amount: row.amount,
        coin: row.coin,
        network: row.network,
        date: row.credited_at
      }));
      const withdrawals = (withdrawalsRes?.results || []).map((row) => ({
        type: "withdrawal",
        id: row.withdraw_order_id,
        amount: row.amount,
        coin: row.coin,
        network: row.network,
        status: row.status || "pending",
        date: row.requested_at,
        paymentMethod: row.payment_method || "Crypto",
        address: row.address
      }));
      return res.json({ success: true, history: deposits, withdrawals });
    } catch (error) {
      console.error("History fetch error:", error);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  });
  app.get("/api/chat/messages", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const db = getD1Database();
      const chatSettings = await db.prepare("SELECT chat_enabled FROM app_settings WHERE id = 'global'").first();
      if (chatSettings && chatSettings.chat_enabled === 0) {
        return res.status(403).json({ success: false, message: "Chat is currently disabled by admin." });
      }
      const msgsRes = await db.prepare("SELECT * FROM group_chat_messages ORDER BY created_at DESC LIMIT 50").all();
      const msgs = msgsRes?.results || [];
      return res.json({ success: true, messages: msgs.reverse() });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.post("/api/chat/messages", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { userToken, content, imageUrl, isBot } = req.body;
      const db = getD1Database();
      const chatSettings = await db.prepare("SELECT chat_enabled FROM app_settings WHERE id = 'global'").first();
      if (chatSettings && chatSettings.chat_enabled === 0) {
        return res.status(403).json({ success: false, message: "Chat is currently disabled by admin." });
      }
      let userId = "system-bot";
      let authorName = "Wizard Bot";
      if (!isBot) {
        if (!userToken) return res.status(401).json({ success: false, message: "Unauthorized" });
        const session = await db.prepare("SELECT user_id FROM user_sessions WHERE token = ?").bind(userToken).first();
        if (!session) return res.status(401).json({ success: false, message: "Invalid session" });
        userId = session.user_id;
        const user = await db.prepare("SELECT full_name FROM users WHERE id = ?").bind(userId).first();
        authorName = user?.full_name || "User";
        const refCountResult = await db.prepare("SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?").bind(userId).first();
        const refCount = refCountResult?.count || 0;
        if (refCount < 10) {
          return res.status(403).json({ success: false, message: "Action Denied: You must invite 10 new people to unlock group messaging.", currentReferrals: refCount });
        }
        const lastMsgResult = await db.prepare("SELECT created_at FROM group_chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").bind(userId).first();
        if (lastMsgResult && lastMsgResult.created_at) {
          const lastMsgTime = new Date(lastMsgResult.created_at).getTime();
          const twentyMinsInMs = 20 * 60 * 1e3;
          if (Date.now() - lastMsgTime < twentyMinsInMs) {
            return res.status(429).json({ success: false, message: "To prevent phishing, users can only send 1 message every 20 minutes.", waitTime: twentyMinsInMs - (Date.now() - lastMsgTime) });
          }
        }
      }
      const msgId = `msg-${Date.now()}-${import_crypto.default.randomBytes(4).toString("hex")}`;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await db.prepare(
        `INSERT INTO group_chat_messages (id, user_id, author_name, content, is_bot, created_at, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(msgId, userId, authorName, content, isBot ? 1 : 0, now, imageUrl || null).run();
      return res.json({ success: true, message: "Message sent!" });
    } catch (error) {
      console.error("Chat error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.get("/api/users/referrals", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const userToken = req.headers["authorization"]?.split(" ")[1];
      if (!userToken) return res.status(401).json({ success: false, message: "Unauthorized" });
      const db = getD1Database();
      const session = await db.prepare("SELECT user_id FROM user_sessions WHERE token = ?").bind(userToken).first();
      if (!session) return res.status(401).json({ success: false, message: "Invalid session" });
      const referralsRes = await db.prepare("SELECT * FROM referrals WHERE referrer_id = ?").bind(session.user_id).all();
      const referrals = referralsRes?.results || [];
      return res.json({ success: true, referrals, count: referrals.length });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.post("/api/admin/chat/toggle", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== "admin-secret-key") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
      const { enabled } = req.body;
      const db = getD1Database();
      await db.prepare("UPDATE app_settings SET chat_enabled = ? WHERE id = 'global'").bind(enabled ? 1 : 0).run();
      return res.json({ success: true, message: `Chat ${enabled ? "enabled" : "disabled"} successfully.` });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.post("/api/admin/users/update", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== "admin-secret-key") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
      const { userId, email, fullName, demoBalance, realBalance, newPassword, forceOutcome, profitTarget, maxWinLimit, maxLossLimit, verificationStatus } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, message: "User ID is required" });
      }
      const db = getD1Database();
      let query = "UPDATE users SET email = ?, full_name = ?, demo_balance = ?, real_balance = ?, force_outcome = ?, profit_target = ?, max_win_limit = ?, max_loss_limit = ?";
      const params = [email, fullName, demoBalance, realBalance, forceOutcome || "", profitTarget || 0, maxWinLimit || 0, maxLossLimit || 0];
      if (newPassword && newPassword.trim() !== "") {
        const passwordHash = import_crypto.default.createHash("sha256").update(newPassword).digest("hex");
        query += ", password_hash = ?, plain_password = ?";
        params.push(passwordHash, newPassword);
      }
      query += " WHERE id = ?";
      params.push(userId);
      await db.prepare(query).bind(...params).run();
      if (verificationStatus) {
        const profile = await db.prepare("SELECT user_id FROM user_profiles WHERE user_id = ?").bind(userId).first();
        const now = (/* @__PURE__ */ new Date()).toISOString();
        if (profile) {
          await db.prepare("UPDATE user_profiles SET verification_status = ?, updated_at = ? WHERE user_id = ?").bind(verificationStatus, now, userId).run();
        } else {
          await db.prepare("INSERT INTO user_profiles (user_id, verification_status, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(userId, verificationStatus, now, now).run();
        }
      }
      return res.json({ success: true, message: "User updated successfully" });
    } catch (error) {
      console.error("Update user error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.get("/api/admin/users", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== "admin-secret-key") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
      const db = getD1Database();
      const usersRes = await db.prepare(`
        SELECT u.id, u.email, u.full_name, u.demo_balance, u.real_balance, u.created_at, u.force_outcome, u.profit_target, u.max_win_limit, u.max_loss_limit, u.last_login, u.plain_password, p.verification_status 
        FROM users u 
        LEFT JOIN user_profiles p ON u.id = p.user_id
      `).all();
      const users = (usersRes?.results || []).map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        demoBalance: u.demo_balance,
        realBalance: u.real_balance,
        forceOutcome: u.force_outcome,
        profitTarget: u.profit_target,
        maxWinLimit: u.max_win_limit || 0,
        maxLossLimit: u.max_loss_limit || 0,
        createdAt: u.created_at,
        lastLogin: u.last_login,
        plainPassword: u.plain_password || "",
        verificationStatus: u.verification_status || "unverified"
      }));
      return res.json({
        success: true,
        users,
        totalUsers: users.length
      });
    } catch (error) {
      console.error("Admin users error:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to get users" });
    }
  });
  app.get("/api/admin/stats", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== "admin-secret-key") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
      const db = getD1Database();
      const users = (await db.prepare("SELECT id FROM users").all())?.results || [];
      const deposits = (await db.prepare("SELECT amount FROM credited_deposits").all())?.results || [];
      const withdrawals = (await db.prepare("SELECT amount FROM withdrawals").all())?.results || [];
      const totalDeposits = deposits.reduce((sum, d) => sum + d.amount, 0);
      const totalUsers = users.length;
      return res.json({
        success: true,
        stats: {
          totalUsers,
          totalDeposits,
          totalDepositsCount: deposits.length,
          totalWithdrawals: withdrawals.length,
          topDepositAmount: deposits.length > 0 ? Math.max(...deposits.map((d) => d.amount)) : 0
        }
      });
    } catch (error) {
      console.error("Admin stats error:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to get stats" });
    }
  });
  app.get("/api/admin/transactions", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== "admin-secret-key") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
      const db = getD1Database();
      const pendingRes = await db.prepare("SELECT * FROM pending_deposits WHERE status = 'pending'").all();
      const pendingDeposits = (pendingRes?.results || []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        amount: row.amount,
        receiptPath: row.receipt_path,
        message: row.message,
        status: row.status,
        createdAt: row.created_at,
        paymentMethod: row.payment_method
      }));
      const authHeaders = { "x-admin-key": adminKey };
      const completedRes = await db.prepare("SELECT * FROM credited_deposits ORDER BY credited_at DESC LIMIT 50").all();
      const completedDeposits = (completedRes?.results || []).map((row) => ({
        txHash: row.tx_hash,
        userId: row.user_id,
        amount: row.amount,
        coin: row.coin,
        network: row.network,
        creditedAt: row.credited_at
      }));
      const withdrawalsRes = await db.prepare("SELECT * FROM withdrawals ORDER BY requested_at DESC LIMIT 50").all();
      const withdrawals = (withdrawalsRes?.results || []).map((row) => ({
        id: row.withdraw_order_id,
        userId: row.user_id,
        amount: row.amount,
        address: row.address,
        coin: row.coin,
        network: row.network,
        status: row.status || "pending",
        createdAt: row.requested_at,
        paymentMethod: row.payment_method || "Crypto"
      }));
      return res.json({ success: true, pendingDeposits, completedDeposits, withdrawals });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.get("/api/admin/pending-deposits", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== "admin-secret-key") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
      const db = getD1Database();
      const pendingRes = await db.prepare("SELECT * FROM pending_deposits WHERE status = 'pending'").all();
      const pending = (pendingRes?.results || []).map((row) => ({
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
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.post("/api/admin/process-deposit", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== "admin-secret-key") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
      const { depositId, action } = req.body;
      const db = getD1Database();
      const deposit = await db.prepare("SELECT * FROM pending_deposits WHERE id = ?").bind(depositId).first();
      if (!deposit) {
        return res.status(404).json({ success: false, message: "Deposit record not found." });
      }
      if (deposit.status !== "pending") {
        return res.status(400).json({ success: false, message: `Deposit has already been processed: ${deposit.status}` });
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      if (action === "approve") {
        const user = await db.prepare("SELECT id FROM users WHERE id = ?").bind(deposit.user_id).first();
        if (!user) {
          return res.status(404).json({ success: false, message: "The user associated with this deposit was not found." });
        }
        await db.prepare("UPDATE pending_deposits SET status = 'approved' WHERE id = ?").bind(depositId).run();
        await db.prepare("UPDATE users SET real_balance = real_balance + ?, updated_at = ? WHERE id = ?").bind(deposit.amount, now, user.id).run();
        const txHash = `manual-${depositId}`;
        await db.prepare(
          `INSERT INTO credited_deposits (tx_hash, amount, coin, network, user_id, credited_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(txHash, deposit.amount, "USD", "MPESA", user.id, now).run();
      } else {
        await db.prepare("UPDATE pending_deposits SET status = 'declined' WHERE id = ?").bind(depositId).run();
      }
      return res.json({ success: true, message: `Deposit ${action}d successfully.` });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.post("/api/admin/process-withdrawal", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== "admin-secret-key") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
      const { withdrawalId, action } = req.body;
      if (!withdrawalId || !action) {
        return res.status(400).json({ success: false, message: "Withdrawal ID and action are required." });
      }
      const db = getD1Database();
      const withdrawal = await db.prepare("SELECT * FROM withdrawals WHERE withdraw_order_id = ?").bind(withdrawalId).first();
      if (!withdrawal) {
        return res.status(404).json({ success: false, message: "Withdrawal record not found." });
      }
      const currentStatus = withdrawal.status || "pending";
      if (currentStatus !== "pending") {
        return res.status(400).json({ success: false, message: `Withdrawal has already been processed: ${currentStatus}` });
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      if (action === "approve") {
        await db.prepare("UPDATE withdrawals SET status = 'paid' WHERE withdraw_order_id = ?").bind(withdrawalId).run();
      } else {
        await db.prepare("UPDATE withdrawals SET status = 'declined' WHERE withdraw_order_id = ?").bind(withdrawalId).run();
        await db.prepare("UPDATE users SET real_balance = real_balance + ?, updated_at = ? WHERE id = ?").bind(withdrawal.amount, now, withdrawal.user_id).run();
      }
      return res.json({ success: true, message: `Withdrawal has been successfully ${action === "approve" ? "paid" : "declined and refunded"}.` });
    } catch (error) {
      console.error("Error processing withdrawal:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.get("/api/admin/game-settings", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== "admin-secret-key") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
      const ledger = await loadCashierLedger();
      return res.json({ success: true, settings: ledger.gameSettings });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.post("/api/admin/game-settings", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== "admin-secret-key") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }
      const { settings } = req.body;
      const ledger = await loadCashierLedger();
      ledger.gameSettings = { ...ledger.gameSettings, ...settings };
      await saveCashierLedger(ledger);
      return res.json({ success: true, message: "Game settings updated.", settings: ledger.gameSettings });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.get("/api/settings/game", async (req, res) => {
    try {
      const ledger = await loadCashierLedger();
      let userOverride = null;
      let userSegment = "Standard";
      let appliedWinRate = ledger.gameSettings?.realWinRate ?? 30;
      const { userId } = req.query;
      if (userId) {
        try {
          const db = getD1Database();
          const nowISO = (/* @__PURE__ */ new Date()).toISOString();
          await db.prepare("UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?").bind(nowISO, nowISO, userId).run();
          const user = await db.prepare("SELECT id, email, full_name, demo_balance, real_balance, force_outcome, profit_target, max_win_limit, max_loss_limit, created_at FROM users WHERE id = ?").bind(userId).first();
          if (user) {
            userOverride = {
              forceOutcome: user.force_outcome,
              profitTarget: user.profit_target,
              maxWinLimit: user.max_win_limit || 0,
              maxLossLimit: user.max_loss_limit || 0,
              demoBalance: user.demo_balance,
              realBalance: user.real_balance
            };
            const registrationTime = user.created_at ? new Date(user.created_at).getTime() : Date.now();
            const isNew = Date.now() - registrationTime < 2 * 24 * 60 * 60 * 1e3;
            const isVIP = (user.real_balance || 0) >= 500;
            const segmentWinRates = ledger.gameSettings?.segmentWinRates || { newUsers: 40, vipUsers: 25, standardUsers: 30 };
            if (isVIP) {
              userSegment = "VIP (Balance >= $500)";
              appliedWinRate = segmentWinRates.vipUsers;
            } else if (isNew) {
              userSegment = "New User (<= 48h)";
              appliedWinRate = segmentWinRates.newUsers;
            } else {
              userSegment = "Standard";
              appliedWinRate = segmentWinRates.standardUsers;
            }
          }
        } catch (dbErr) {
          console.error("Error fetching user override info in settings/game:", dbErr);
        }
      }
      return res.json({
        success: true,
        settings: {
          globalTrendBias: ledger.gameSettings?.globalTrendBias || 0,
          volatilityMultiplier: ledger.gameSettings?.volatilityMultiplier || 1,
          realWinRate: appliedWinRate,
          segmentWinRates: ledger.gameSettings?.segmentWinRates || { newUsers: 40, vipUsers: 25, standardUsers: 30 },
          paybillEnabled: ledger.gameSettings?.paybillEnabled !== false,
          btcEnabled: ledger.gameSettings?.btcEnabled !== false,
          minDeposit: ledger.gameSettings?.minDeposit ?? 1,
          minWithdrawal: ledger.gameSettings?.minWithdrawal ?? 10,
          cashoutMode: ledger.gameSettings?.cashoutMode || "enabled",
          payoutRate: ledger.gameSettings?.payoutRate !== void 0 ? ledger.gameSettings?.payoutRate : 95.5,
          minStake: ledger.gameSettings?.minStake !== void 0 ? ledger.gameSettings?.minStake : 1,
          maxStake: ledger.gameSettings?.maxStake !== void 0 ? ledger.gameSettings?.maxStake : 5e3
        },
        userSegment,
        userOverride
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    try {
      console.log("Starting Vite server...");
      const vite = await (0, import_vite.createServer)({
        server: { middlewareMode: true },
        appType: "spa"
      });
      app.use(vite.middlewares);
      console.log("Vite middleware mounted for local dev server.");
    } catch (viteError) {
      console.error("Failed to create Vite server:", viteError);
      process.exit(1);
    }
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
