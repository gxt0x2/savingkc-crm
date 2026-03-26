-- LED-09: Housing Fields Schema - Add 18 property detail fields to leads table
-- Night 4 Phase 1: Complete Property Dossier

-- Add housing detail fields
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS beds INTEGER,
  ADD COLUMN IF NOT EXISTS baths_full DECIMAL(3,1),
  ADD COLUMN IF NOT EXISTS baths_half INTEGER,
  ADD COLUMN IF NOT EXISTS sqft INTEGER,
  ADD COLUMN IF NOT EXISTS lot_size DECIMAL(10,2), -- in square feet
  ADD COLUMN IF NOT EXISTS year_built INTEGER,
  ADD COLUMN IF NOT EXISTS basement_type VARCHAR(100), -- 'None', 'Full', 'Partial', 'Finished', 'Unfinished', 'Walkout'
  ADD COLUMN IF NOT EXISTS stories DECIMAL(2,1),
  ADD COLUMN IF NOT EXISTS garage_spaces INTEGER,
  ADD COLUMN IF NOT EXISTS roof_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS heating VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cooling VARCHAR(100),
  ADD COLUMN IF NOT EXISTS property_type VARCHAR(100), -- 'Single Family', 'Condo', 'Townhouse', 'Multi-Family', etc.
  ADD COLUMN IF NOT EXISTS zoning VARCHAR(50),
  ADD COLUMN IF NOT EXISTS hoa_amount DECIMAL(10,2), -- Monthly HOA fee, NULL if none
  ADD COLUMN IF NOT EXISTS tax_assessment DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS last_sale_date DATE,
  ADD COLUMN IF NOT EXISTS last_sale_price DECIMAL(12,2);

-- Add metadata fields for data enrichment tracking and favorites
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS data_source VARCHAR(50), -- 'County', 'Zillow', 'USFirstCheck', 'Manual'
  ADD COLUMN IF NOT EXISTS data_enriched_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS county VARCHAR(50); -- Jackson, Clay, Platte, Wyandotte, Johnson

-- Create index on favorite field for quick filtering
CREATE INDEX IF NOT EXISTS idx_leads_favorite ON leads(is_favorite) WHERE is_favorite = TRUE;

-- Create index on county for data enrichment queries
CREATE INDEX IF NOT EXISTS idx_leads_county ON leads(county);
