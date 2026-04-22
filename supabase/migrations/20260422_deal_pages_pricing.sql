-- Add asking_price and purchase_price to deal_pages for Investorlift-style deal creation
ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS asking_price NUMERIC;
ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS purchase_price NUMERIC;
