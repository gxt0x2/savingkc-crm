-- Wholesale Market Watch month snapshots.
-- Analyst zip intelligence only. Do not enroll these rows as leads,
-- prospects, opportunities, or dialer queue members.

CREATE TABLE IF NOT EXISTS public.wholesale_market_snapshots (
  month_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wholesale_market_snapshots_month_key_check
    CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT wholesale_market_snapshots_payload_month_check
    CHECK ((payload #>> '{meta,month_key}') = month_key),
  CONSTRAINT wholesale_market_snapshots_fit_count_check
    CHECK (
      jsonb_typeof(payload -> 'zips') = 'array'
      AND jsonb_array_length(payload -> 'zips') = (payload #>> '{summary,fit_zip_count}')::integer
    )
);

COMMENT ON TABLE public.wholesale_market_snapshots IS
  'Monthly Heartland Matrix wholesale-fit zip snapshots for Market Watch. Analyst targeting only — not CRM leads, contacts, opportunities, or dialer rows.';

ALTER TABLE public.wholesale_market_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wholesale_market_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.wholesale_market_snapshots TO authenticated;
GRANT ALL ON TABLE public.wholesale_market_snapshots TO service_role;

DROP POLICY IF EXISTS "Authenticated read wholesale market snapshots" ON public.wholesale_market_snapshots;
CREATE POLICY "Authenticated read wholesale market snapshots"
  ON public.wholesale_market_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.wholesale_market_snapshots (month_key, payload, uploaded_by)
VALUES (
  '2026-08',
  $wholesale_market_snapshot${
  "meta": {
    "title": "Saving KC Wholesale Market Watch \u2014 August 2026",
    "subtitle": "Heartland MLS Matrix \u00b7 five counties \u00b7 assignment band $200k\u2013$400k",
    "month": "August 2026",
    "month_key": "2026-08",
    "as_of": "2026-09-27 15:14 -0500 (America/Chicago requested; current local date is CDT)",
    "source_badge": "Licensed Matrix Wholesale Filter exports (not FastStats)",
    "generated_at": "2026-09-27 15:27 CT",
    "status_text": "August 2026 Heartland MLS Matrix wholesale zip pull\nAs-of: 2026-09-27 15:14 -0500 (America/Chicago requested; current local date is CDT)\nSource: licensed Matrix UI exports (Wholesale Filter) from hmls.mlsmatrix.com. No July numbers reused.\nSolds search: Residential, Sold, close date 2026-08-01 through 2026-08-31; counties Clay MO, Jackson MO, Johnson KS, Platte MO, Wyandotte KS. Exported 2315 records.\nActives search: Residential, Active current; same five counties. Exported 5187 records.\nFastStats: no FastStats zip report was exposed in this Matrix session; used licensed on-screen Results -> Export -> Wholesale Filter as alternate. Results/screenshots retained.\nCompleteness: sold and active exports were full result counts shown by Matrix (not truncated). Wholesale Filter CSV fields did not include county; county column in outputs is ZIP-to-county classification for the requested counties; rank candidates are mapped.\nRank rule: median close $200,000-$400,000, solds >=20; exclude 64125-64129, exclude Park 64131, and exclude 64130 because its median is below band. Rank order = sold volume descending, then MOI ascending.\nCaveat: a few MLS rows had malformed/nonstandard postal ZIP values (e.g., KS/MO or 61014); they are retained in raw exports but omitted from ZIP rank where not valid five-county postal ZIPs.\nMetro totals: solds=2315; actives=5187; sold median close=$375,000; sold median DOM=10.0; fit zips=28.\nFiles: solds_by_zip.csv, actives_by_zip.csv, combined_rank.csv/json, raw source exports, screenshots.",
    "primary_target_rule": "Tight OR (Balanced AND solds \u2265 35)",
    "flags_rules": {
      "Tight": "MOI < 1.5",
      "Balanced": "1.5 \u2264 MOI < 3",
      "Soft": "MOI \u2265 3",
      "Near ceiling": "median close \u2265 $380,000",
      "Near floor": "median close \u2264 $240,000",
      "Fast": "median DOM \u2264 7"
    },
    "methodology": [
      "MOI = actives / prior-month solds (August solds in this pull).",
      "Wholesale fit: median close $200,000\u2013$400,000 and solds \u2265 20.",
      "Hard avoid 64125\u201364129; park 64131; 64130 out on median (below band).",
      "Expired/withdrawn listings are not in this pull.",
      "12% of median is a spread hint only, not a fee forecast.",
      "Do not dump these zips as CRM leads \u2014 analyst targeting only.",
      "County on Matrix rows is ZIP-to-county classification (Wholesale Filter CSV lacked county).",
      "KCRAR columns are all-residential retail county LMU stats \u2014 not wholesale-band Matrix."
    ],
    "data_gaps": [
      "Expired/withdrawn not included in this Matrix pull.",
      "No FastStats zip report in this Matrix session; used Wholesale Filter exports.",
      "A few malformed postal ZIPs omitted from rank (retained in raw exports)."
    ]
  },
  "summary": {
    "sold_records": 2315,
    "active_records": 5187,
    "sold_median_close": 375000.0,
    "sold_median_dom": 10.0,
    "fit_zip_count": 28,
    "metro_moi": 2.24,
    "primary_target_count": 17
  },
  "insights": [
    {
      "kind": "Top volume",
      "zip": "64118",
      "metric": "57 solds",
      "detail": "64118 (57) \u00b7 66212 (52) \u00b7 66030 (52) \u00b7 64119 (49) \u00b7 64015 (49)"
    },
    {
      "kind": "Tightest inventory",
      "zip": "66202",
      "metric": "MOI 0.61",
      "detail": "Johnson KS \u00b7 19 actives / 31 solds"
    },
    {
      "kind": "Softest inventory",
      "zip": "64133",
      "metric": "MOI 4.04",
      "detail": "Jackson MO \u00b7 seller leverage / slower retail \u00b7 3 soft zip(s)"
    },
    {
      "kind": "Fastest DOM",
      "zip": "64114",
      "metric": "DOM 2",
      "detail": "Jackson MO \u00b7 median close $340,000"
    },
    {
      "kind": "Near ceiling",
      "zip": "64079",
      "metric": "$397,500",
      "detail": "watch assignment spread \u00b7 6 zip(s) \u2265 $380k"
    }
  ],
  "counties": [
    {
      "county": "Clay MO",
      "fit_zips": 5,
      "sum_solds": 189,
      "sum_actives": 273,
      "median_of_medians": 300000.0,
      "median_of_medians_label": "simple median of zip medians",
      "avg_moi": 1.51,
      "kcrar": {
        "closed_sales": 359,
        "median_sales_price": 350000,
        "dom": 34,
        "supply_moi": 2.0,
        "inventory": 685
      }
    },
    {
      "county": "Jackson MO",
      "fit_zips": 10,
      "sum_solds": 320,
      "sum_actives": 717,
      "median_of_medians": 335000.0,
      "median_of_medians_label": "simple median of zip medians",
      "avg_moi": 2.35,
      "kcrar": {
        "closed_sales": 776,
        "median_sales_price": 295000,
        "dom": 36,
        "supply_moi": 2.8,
        "inventory": 2291
      }
    },
    {
      "county": "Platte MO",
      "fit_zips": 3,
      "sum_solds": 73,
      "sum_actives": 185,
      "median_of_medians": 387500.0,
      "median_of_medians_label": "simple median of zip medians",
      "avg_moi": 2.63,
      "kcrar": {
        "closed_sales": 148,
        "median_sales_price": 400000,
        "dom": 35,
        "supply_moi": 2.5,
        "inventory": 358
      }
    },
    {
      "county": "Wyandotte KS",
      "fit_zips": 3,
      "sum_solds": 79,
      "sum_actives": 192,
      "median_of_medians": 226000.0,
      "median_of_medians_label": "simple median of zip medians",
      "avg_moi": 2.4,
      "kcrar": {
        "closed_sales": 126,
        "median_sales_price": 239500,
        "dom": 33,
        "supply_moi": 2.9,
        "inventory": 393
      }
    },
    {
      "county": "Johnson KS",
      "fit_zips": 7,
      "sum_solds": 261,
      "sum_actives": 332,
      "median_of_medians": 375000.0,
      "median_of_medians_label": "simple median of zip medians",
      "avg_moi": 1.23,
      "kcrar": {
        "closed_sales": 882,
        "median_sales_price": 465173,
        "dom": 35,
        "supply_moi": 2.0,
        "inventory": 1610
      }
    }
  ],
  "kcrar_meta": {
    "as_of": "2026-09-08",
    "source": "https://kcrar.stats.showingtime.com/",
    "label": "KCRAR county (all residential retail)"
  },
  "zips": [
    {
      "zip": "64118",
      "county": "Clay MO",
      "solds": 57,
      "median_close": 288000.0,
      "actives": 55,
      "moi": 0.9649122807017544,
      "median_dom": 7.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 1,
      "flags": [
        "Tight",
        "Fast"
      ],
      "primary_target": true,
      "moi_rounded": 0.96
    },
    {
      "zip": "66212",
      "county": "Johnson KS",
      "solds": 52,
      "median_close": 360000.0,
      "actives": 39,
      "moi": 0.75,
      "median_dom": 5.5,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 2,
      "flags": [
        "Tight",
        "Fast"
      ],
      "primary_target": true,
      "moi_rounded": 0.75
    },
    {
      "zip": "66030",
      "county": "Johnson KS",
      "solds": 52,
      "median_close": 379802.5,
      "actives": 76,
      "moi": 1.4615384615384615,
      "median_dom": 6.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 3,
      "flags": [
        "Tight",
        "Fast"
      ],
      "primary_target": true,
      "moi_rounded": 1.46
    },
    {
      "zip": "64119",
      "county": "Clay MO",
      "solds": 49,
      "median_close": 300000.0,
      "actives": 68,
      "moi": 1.3877551020408163,
      "median_dom": 7.5,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 4,
      "flags": [
        "Tight"
      ],
      "primary_target": true,
      "moi_rounded": 1.39
    },
    {
      "zip": "64015",
      "county": "Jackson MO",
      "solds": 49,
      "median_close": 330000.0,
      "actives": 72,
      "moi": 1.469387755102041,
      "median_dom": 11.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 5,
      "flags": [
        "Tight"
      ],
      "primary_target": true,
      "moi_rounded": 1.47
    },
    {
      "zip": "64055",
      "county": "Jackson MO",
      "solds": 47,
      "median_close": 232500.0,
      "actives": 80,
      "moi": 1.702127659574468,
      "median_dom": 13.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 6,
      "flags": [
        "Balanced",
        "Near floor"
      ],
      "primary_target": true,
      "moi_rounded": 1.7
    },
    {
      "zip": "66083",
      "county": "Johnson KS",
      "solds": 44,
      "median_close": 390137.0,
      "actives": 112,
      "moi": 2.5454545454545454,
      "median_dom": 32.5,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 7,
      "flags": [
        "Balanced",
        "Near ceiling"
      ],
      "primary_target": true,
      "moi_rounded": 2.55
    },
    {
      "zip": "64068",
      "county": "Clay MO",
      "solds": 41,
      "median_close": 362000.0,
      "actives": 84,
      "moi": 2.048780487804878,
      "median_dom": 6.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 8,
      "flags": [
        "Balanced",
        "Fast"
      ],
      "primary_target": true,
      "moi_rounded": 2.05
    },
    {
      "zip": "64014",
      "county": "Jackson MO",
      "solds": 38,
      "median_close": 350000.0,
      "actives": 81,
      "moi": 2.1315789473684212,
      "median_dom": 16.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 9,
      "flags": [
        "Balanced"
      ],
      "primary_target": true,
      "moi_rounded": 2.13
    },
    {
      "zip": "64086",
      "county": "Jackson MO",
      "solds": 37,
      "median_close": 368000.0,
      "actives": 89,
      "moi": 2.4054054054054053,
      "median_dom": 9.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 10,
      "flags": [
        "Balanced"
      ],
      "primary_target": true,
      "moi_rounded": 2.41
    },
    {
      "zip": "64114",
      "county": "Jackson MO",
      "solds": 35,
      "median_close": 340000.0,
      "actives": 77,
      "moi": 2.2,
      "median_dom": 2.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 11,
      "flags": [
        "Balanced",
        "Fast"
      ],
      "primary_target": true,
      "moi_rounded": 2.2
    },
    {
      "zip": "66216",
      "county": "Johnson KS",
      "solds": 33,
      "median_close": 375000.0,
      "actives": 29,
      "moi": 0.8787878787878788,
      "median_dom": 5.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 12,
      "flags": [
        "Tight",
        "Fast"
      ],
      "primary_target": true,
      "moi_rounded": 0.88
    },
    {
      "zip": "66202",
      "county": "Johnson KS",
      "solds": 31,
      "median_close": 340500.0,
      "actives": 19,
      "moi": 0.6129032258064516,
      "median_dom": 3.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 13,
      "flags": [
        "Tight",
        "Fast"
      ],
      "primary_target": true,
      "moi_rounded": 0.61
    },
    {
      "zip": "66109",
      "county": "Wyandotte KS",
      "solds": 31,
      "median_close": 390000.0,
      "actives": 75,
      "moi": 2.4193548387096775,
      "median_dom": 40.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 14,
      "flags": [
        "Balanced",
        "Near ceiling"
      ],
      "primary_target": false,
      "moi_rounded": 2.42
    },
    {
      "zip": "64151",
      "county": "Platte MO",
      "solds": 30,
      "median_close": 387500.0,
      "actives": 58,
      "moi": 1.9333333333333333,
      "median_dom": 14.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 15,
      "flags": [
        "Balanced",
        "Near ceiling"
      ],
      "primary_target": false,
      "moi_rounded": 1.93
    },
    {
      "zip": "64133",
      "county": "Jackson MO",
      "solds": 27,
      "median_close": 230000.0,
      "actives": 109,
      "moi": 4.037037037037037,
      "median_dom": 9.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 16,
      "flags": [
        "Soft",
        "Near floor"
      ],
      "primary_target": false,
      "moi_rounded": 4.04
    },
    {
      "zip": "66204",
      "county": "Johnson KS",
      "solds": 25,
      "median_close": 325000.0,
      "actives": 26,
      "moi": 1.04,
      "median_dom": 2.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 17,
      "flags": [
        "Tight",
        "Fast"
      ],
      "primary_target": true,
      "moi_rounded": 1.04
    },
    {
      "zip": "64138",
      "county": "Jackson MO",
      "solds": 25,
      "median_close": 225000.0,
      "actives": 73,
      "moi": 2.92,
      "median_dom": 12.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 18,
      "flags": [
        "Balanced",
        "Near floor"
      ],
      "primary_target": false,
      "moi_rounded": 2.92
    },
    {
      "zip": "66104",
      "county": "Wyandotte KS",
      "solds": 25,
      "median_close": 225000.0,
      "actives": 87,
      "moi": 3.48,
      "median_dom": 24.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 19,
      "flags": [
        "Soft",
        "Near floor"
      ],
      "primary_target": false,
      "moi_rounded": 3.48
    },
    {
      "zip": "66215",
      "county": "Johnson KS",
      "solds": 24,
      "median_close": 387500.0,
      "actives": 31,
      "moi": 1.2916666666666667,
      "median_dom": 3.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 20,
      "flags": [
        "Tight",
        "Near ceiling",
        "Fast"
      ],
      "primary_target": true,
      "moi_rounded": 1.29
    },
    {
      "zip": "66106",
      "county": "Wyandotte KS",
      "solds": 23,
      "median_close": 226000.0,
      "actives": 30,
      "moi": 1.3043478260869565,
      "median_dom": 17.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 21,
      "flags": [
        "Tight",
        "Near floor"
      ],
      "primary_target": true,
      "moi_rounded": 1.3
    },
    {
      "zip": "64154",
      "county": "Platte MO",
      "solds": 23,
      "median_close": 360000.0,
      "actives": 61,
      "moi": 2.652173913043478,
      "median_dom": 38.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 22,
      "flags": [
        "Balanced"
      ],
      "primary_target": false,
      "moi_rounded": 2.65
    },
    {
      "zip": "64117",
      "county": "Clay MO",
      "solds": 21,
      "median_close": 235000.0,
      "actives": 18,
      "moi": 0.8571428571428571,
      "median_dom": 18.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 23,
      "flags": [
        "Tight",
        "Near floor"
      ],
      "primary_target": true,
      "moi_rounded": 0.86
    },
    {
      "zip": "64063",
      "county": "Jackson MO",
      "solds": 21,
      "median_close": 345000.0,
      "actives": 41,
      "moi": 1.9523809523809523,
      "median_dom": 3.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 24,
      "flags": [
        "Balanced",
        "Fast"
      ],
      "primary_target": false,
      "moi_rounded": 1.95
    },
    {
      "zip": "64029",
      "county": "Jackson MO",
      "solds": 21,
      "median_close": 340000.0,
      "actives": 47,
      "moi": 2.238095238095238,
      "median_dom": 15.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 25,
      "flags": [
        "Balanced"
      ],
      "primary_target": false,
      "moi_rounded": 2.24
    },
    {
      "zip": "64089",
      "county": "Clay MO",
      "solds": 21,
      "median_close": 381500.0,
      "actives": 48,
      "moi": 2.2857142857142856,
      "median_dom": 6.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 26,
      "flags": [
        "Balanced",
        "Near ceiling",
        "Fast"
      ],
      "primary_target": false,
      "moi_rounded": 2.29
    },
    {
      "zip": "64030",
      "county": "Jackson MO",
      "solds": 20,
      "median_close": 245450.0,
      "actives": 48,
      "moi": 2.4,
      "median_dom": 15.5,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 27,
      "flags": [
        "Balanced"
      ],
      "primary_target": false,
      "moi_rounded": 2.4
    },
    {
      "zip": "64079",
      "county": "Platte MO",
      "solds": 20,
      "median_close": 397500.0,
      "actives": 66,
      "moi": 3.3,
      "median_dom": 32.0,
      "median_band_200_400": true,
      "solds_ge_20": true,
      "hard_rule": "",
      "wholesale_fit": true,
      "rank": 28,
      "flags": [
        "Soft",
        "Near ceiling"
      ],
      "primary_target": false,
      "moi_rounded": 3.3
    }
  ]
}
$wholesale_market_snapshot$::jsonb,
  'seed'
)
ON CONFLICT (month_key) DO NOTHING;
