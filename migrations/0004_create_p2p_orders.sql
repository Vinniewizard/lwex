CREATE TABLE IF NOT EXISTS p2p_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'buy' or 'sell'
  coin TEXT NOT NULL,
  amount REAL NOT NULL,
  price REAL NOT NULL,
  status TEXT DEFAULT 'open', -- 'open', 'escrow', 'completed', 'cancelled'
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
