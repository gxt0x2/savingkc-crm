-- ARI CRM - Financial Tracking Schema
-- Night 6: DSH-06, DSH-07, DSH-08
-- Revenue and expense tracking for dashboard

-- Financial Summary Table
CREATE TABLE IF NOT EXISTS financial_summary (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  revenue_to_date DECIMAL(12, 2) DEFAULT 0 NOT NULL,
  expenses_to_date DECIMAL(12, 2) DEFAULT 0 NOT NULL,
  last_updated TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_by TEXT,
  -- Only one row - enforce with unique constraint on a constant
  singleton_guard BOOLEAN DEFAULT TRUE UNIQUE CHECK (singleton_guard = TRUE)
);

-- Expense Transactions Table
CREATE TABLE IF NOT EXISTS expense_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('operations', 'marketing', 'travel', 'general', 'payroll', 'software')),
  description TEXT NOT NULL,
  merchant TEXT,
  source TEXT DEFAULT 'manual', -- 'manual', 'mercury', 'import'
  external_id TEXT, -- For Mercury API or other integrations
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expense_transactions_date ON expense_transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_expense_transactions_category ON expense_transactions(category);
CREATE INDEX IF NOT EXISTS idx_expense_transactions_source ON expense_transactions(source);

-- Revenue Transactions Table (Closings)
CREATE TABLE IF NOT EXISTS revenue_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  deal_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  property_address TEXT,
  description TEXT,
  source TEXT DEFAULT 'manual', -- 'manual', 'closing', 'import'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revenue_transactions_date ON revenue_transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_transactions_deal ON revenue_transactions(deal_id) WHERE deal_id IS NOT NULL;

-- Historical Data Import Table (for Google Sheets import)
CREATE TABLE IF NOT EXISTS historical_data_imports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  import_date TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  data_type TEXT NOT NULL, -- 'closings', 'contracts', 'call_metrics', 'expenses'
  source TEXT NOT NULL, -- 'google_sheets', 'csv', 'manual'
  record_count INTEGER NOT NULL,
  imported_by TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Initialize financial summary with zeros
INSERT INTO financial_summary (revenue_to_date, expenses_to_date, updated_by)
VALUES (0, 0, 'system_init')
ON CONFLICT (singleton_guard) DO NOTHING;

-- Seed initial expenses (DSH-07)
INSERT INTO expense_transactions (date, amount, category, description, merchant, source)
VALUES
  ('2026-03-01', 975.00, 'operations', 'Office expenses and meals', 'Various', 'seed'),
  ('2026-03-01', 800.00, 'travel', 'Car and travel expenses', 'Various', 'seed')
ON CONFLICT DO NOTHING;

-- Update financial summary with seeded expenses
UPDATE financial_summary
SET expenses_to_date = 1775.00,
    last_updated = NOW(),
    updated_by = 'seed_data'
WHERE singleton_guard = TRUE;

-- RPC Functions for financial updates

-- Increment revenue (called when closing is added)
CREATE OR REPLACE FUNCTION increment_revenue(amount DECIMAL)
RETURNS VOID AS $$
BEGIN
  UPDATE financial_summary
  SET revenue_to_date = revenue_to_date + amount,
      last_updated = NOW()
  WHERE singleton_guard = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Increment expenses (called when expense is added)
CREATE OR REPLACE FUNCTION increment_expenses(amount DECIMAL)
RETURNS VOID AS $$
BEGIN
  UPDATE financial_summary
  SET expenses_to_date = expenses_to_date + amount,
      last_updated = NOW()
  WHERE singleton_guard = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Recalculate financial summary from transactions (for data corrections)
CREATE OR REPLACE FUNCTION recalculate_financial_summary()
RETURNS VOID AS $$
DECLARE
  total_revenue DECIMAL;
  total_expenses DECIMAL;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO total_revenue FROM revenue_transactions;
  SELECT COALESCE(SUM(amount), 0) INTO total_expenses FROM expense_transactions;

  UPDATE financial_summary
  SET revenue_to_date = total_revenue,
      expenses_to_date = total_expenses,
      last_updated = NOW(),
      updated_by = 'recalculation'
  WHERE singleton_guard = TRUE;
END;
$$ LANGUAGE plpgsql;
