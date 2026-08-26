export type EnrichmentRawData = {
  garageSize?: unknown
  outOfState?: unknown
  lotSizeSqft?: unknown
  lotSize?: unknown
  basementDesc?: unknown
  roofType?: unknown
  hvac?: unknown
  [key: string]: unknown
}

export type JacksonCountyData = {
  paridFormatted?: string
  ownerName?: string
  mailingAddress?: string
  mailingState?: string
  propertyType?: string
  appraisedValue?: number
  assessedValue?: number
  landValue?: number
  improvementValue?: number
  yearBuilt?: number
  sqft?: number
  bedrooms?: number
  bathrooms?: number
  halfBaths?: number
  condition?: string
  exterior?: string
  roofType?: string
  style?: string
  basement?: string
  fireplaces?: number
  physicalCondition?: string
}

export type JacksonCountyTaxData = {
  taxOwed?: number
  taxStatus: string
  yearsDelinquent?: number
  lastPaymentDate?: string
  lastPaymentAmount?: number
  delinquentBills?: Array<{
    taxYear: number
    billNumber: string
    totalCharges: number
    totalPaid: number
    principal: number
    penalty: number
    interest: number
    status: string
  }>
  isBankruptcy?: boolean
  error?: string
}

export type CountyApiRecord = {
  situs?: string
  prop_id?: string
  parcel_id?: string
  parcelid?: string
  owner_street?: string
  owner_city?: string
  owner_state?: string
  owner_zip?: string
  current_owner?: string
  owner_name?: string
  use_code?: string
  appraised_val?: string
  assessed_val?: string
  land_val?: string
  imprv_val?: string
  actual_year_built?: string
  total_area?: string
  bedrooms?: string
  bathrooms?: string
  val_yr?: string
}

export type PlatteDwelling = {
  grossLivingArea?: string
  yearBuilt?: string
  bedrooms?: string
  bathrooms?: string
  basementArea?: string
  style?: string
  basement?: string
  [key: string]: string | undefined
}

export type PlatteValuation = {
  improvements?: number
  land?: number
  total?: number
  assessed?: number
}
