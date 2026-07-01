-- ════════════════════════════════════════════════════════════════════════════
-- KETTO SIP — WEEKLY DASHBOARD  ·  MATERIALIZED VIEWS
-- Source table: sip_weekly_or   (successful orders only)
-- Week anchor : Monday 2025-11-03  (week 1 = Nov 3–9, Mon–Sun)
-- donated_amount is already INR-converted for non-INR currencies.
-- utm_type_v3 = categorisation.  "Telecalling" = utm_type_v3 = 'Telecalling / SIP Team'
-- ════════════════════════════════════════════════════════════════════════════
-- HOW TO USE:
--   1. Run this whole script ONCE in the Supabase SQL editor.
--   2. Each week after you upload new rows, run:  SELECT refresh_sip_weekly();
--   3. The dashboard reads the views via the REST API automatically.
-- ════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 0. Helper: a base view that tags every row with its week + derived flags.
--    week_idx 0 = Nov 3 2025.  week_start = the Monday of that week.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS sip_base CASCADE;
CREATE VIEW sip_base AS
SELECT
  "date",
  donated_amount,
  donor_country,
  order_type,
  utm_type_v3,
  utm_source,
  utm_medium,
  device_type,
  page_type,
  donor_type_on_sip_order,
  donor_type_on_overall_order,
  ( ( ("date"::date - DATE '2025-11-03') / 7 ) )::int                       AS week_idx,
  ( DATE '2025-11-03' + ( ( ("date"::date - DATE '2025-11-03') / 7 ) * 7 ) ) AS week_start,
  (utm_type_v3 = 'Telecalling / SIP Team')                                  AS is_tel,
  COALESCE(NULLIF(utm_type_v3, ''), 'Null')                                 AS channel,
  CASE
    WHEN device_type ILIKE 'Desktop%' THEN 'Desktop'
    WHEN device_type ILIKE 'Mobile%'  THEN 'Mobile'
    WHEN device_type = 'App'          THEN 'App'
    ELSE 'Other'
  END                                                                       AS device,
  COALESCE(NULLIF(page_type, ''), 'Blank')                                  AS page,
  (donor_type_on_sip_order   = 'New')                                       AS is_new_sip,
  (donor_type_on_overall_order = 'New')                                     AS is_brand_new
FROM sip_weekly_or
WHERE "date"::date >= DATE '2025-11-03';

-- ---------------------------------------------------------------------------
-- 1. PULSE — per week: tel vs non-tel orders & amount
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_pulse CASCADE;
CREATE MATERIALIZED VIEW mv_sip_pulse AS
SELECT
  week_idx,
  week_start,
  COUNT(*) FILTER (WHERE is_tel)            AS tel_orders,
  COUNT(*) FILTER (WHERE NOT is_tel)        AS nontel_orders,
  COALESCE(SUM(donated_amount) FILTER (WHERE is_tel),0)::numeric(14,2)     AS tel_amount,
  COALESCE(SUM(donated_amount) FILTER (WHERE NOT is_tel),0)::numeric(14,2) AS nontel_amount
FROM sip_base
GROUP BY week_idx, week_start
ORDER BY week_idx;

-- ---------------------------------------------------------------------------
-- 2. CHANNEL × WEEK — non-tel only: orders, amount, new/repeat split
--    (this single MV powers the channel stack, ASV trend, benchmarks)
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_channel_week CASCADE;
CREATE MATERIALIZED VIEW mv_sip_channel_week AS
SELECT
  week_idx,
  week_start,
  channel,
  COUNT(*)                                              AS orders,
  COALESCE(SUM(donated_amount),0)::numeric(14,2)        AS amount,
  COUNT(*) FILTER (WHERE is_new_sip)                    AS new_sip,
  COUNT(*) FILTER (WHERE NOT is_new_sip)                AS repeat_sip,
  COUNT(*) FILTER (WHERE is_brand_new)                  AS brand_new,
  ROUND(COALESCE(SUM(donated_amount),0) / NULLIF(COUNT(*),0))::int AS asv
FROM sip_base
WHERE NOT is_tel
GROUP BY week_idx, week_start, channel
ORDER BY week_idx, channel;

-- ---------------------------------------------------------------------------
-- 3. CHANNEL × WEEK × ORDER_TYPE — for ASV order-type filter (non-tel)
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_channel_ot_week CASCADE;
CREATE MATERIALIZED VIEW mv_sip_channel_ot_week AS
SELECT
  week_idx, week_start, channel,
  COALESCE(NULLIF(order_type,''),'normal_order')        AS order_type,
  COUNT(*)                                              AS orders,
  COALESCE(SUM(donated_amount),0)::numeric(14,2)        AS amount,
  ROUND(COALESCE(SUM(donated_amount),0) / NULLIF(COUNT(*),0))::int AS asv
FROM sip_base
WHERE NOT is_tel
GROUP BY week_idx, week_start, channel, COALESCE(NULLIF(order_type,''),'normal_order')
ORDER BY week_idx, channel;

-- ---------------------------------------------------------------------------
-- 4. PAGE TYPE × WEEK — non-tel orders by page_type
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_page_week CASCADE;
CREATE MATERIALIZED VIEW mv_sip_page_week AS
SELECT week_idx, week_start, page, COUNT(*) AS orders
FROM sip_base
WHERE NOT is_tel
GROUP BY week_idx, week_start, page
ORDER BY week_idx;

-- ---------------------------------------------------------------------------
-- 5. DEVICE × CHANNEL × WEEK — non-tel
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_device_week CASCADE;
CREATE MATERIALIZED VIEW mv_sip_device_week AS
SELECT week_idx, week_start, channel, device, COUNT(*) AS orders
FROM sip_base
WHERE NOT is_tel
GROUP BY week_idx, week_start, channel, device
ORDER BY week_idx;

-- ---------------------------------------------------------------------------
-- 6. COUNTRY × CHANNEL × WEEK — non-tel (amount already INR-converted)
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_country_week CASCADE;
CREATE MATERIALIZED VIEW mv_sip_country_week AS
SELECT
  week_idx, week_start,
  COALESCE(NULLIF(donor_country,''),'Unknown') AS country,
  channel,
  COUNT(*)                                       AS orders,
  COALESCE(SUM(donated_amount),0)::numeric(14,2) AS amount,
  COUNT(*) FILTER (WHERE is_new_sip)             AS new_sip,
  COUNT(*) FILTER (WHERE NOT is_new_sip)         AS repeat_sip
FROM sip_base
WHERE NOT is_tel
GROUP BY week_idx, week_start, COALESCE(NULLIF(donor_country,''),'Unknown'), channel
ORDER BY week_idx;

-- ---------------------------------------------------------------------------
-- 7. SOURCE/MEDIUM × CHANNEL × WEEK — non-tel deep dive
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_source_week CASCADE;
CREATE MATERIALIZED VIEW mv_sip_source_week AS
SELECT
  week_idx, week_start, channel,
  COALESCE(NULLIF(utm_source,''),'(not set)') AS utm_source,
  COALESCE(NULLIF(utm_medium,''),'(not set)') AS utm_medium,
  COUNT(*)                                       AS orders,
  COALESCE(SUM(donated_amount),0)::numeric(14,2) AS amount,
  COUNT(*) FILTER (WHERE is_new_sip)             AS new_sip,
  COUNT(*) FILTER (WHERE NOT is_new_sip)         AS repeat_sip
FROM sip_base
WHERE NOT is_tel
GROUP BY week_idx, week_start, channel,
         COALESCE(NULLIF(utm_source,''),'(not set)'),
         COALESCE(NULLIF(utm_medium,''),'(not set)')
ORDER BY week_idx;

-- ---------------------------------------------------------------------------
-- 8. REFRESH FUNCTION — run this weekly after uploading new rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_sip_weekly() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_sip_pulse;
  REFRESH MATERIALIZED VIEW mv_sip_channel_week;
  REFRESH MATERIALIZED VIEW mv_sip_channel_ot_week;
  REFRESH MATERIALIZED VIEW mv_sip_page_week;
  REFRESH MATERIALIZED VIEW mv_sip_device_week;
  REFRESH MATERIALIZED VIEW mv_sip_country_week;
  REFRESH MATERIALIZED VIEW mv_sip_source_week;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 9. EXPOSE TO anon ROLE (so the dashboard's anon key can read them)
-- ---------------------------------------------------------------------------
GRANT SELECT ON mv_sip_pulse,
               mv_sip_channel_week,
               mv_sip_channel_ot_week,
               mv_sip_page_week,
               mv_sip_device_week,
               mv_sip_country_week,
               mv_sip_source_week
        TO anon, authenticated;

-- Done. Now run:  SELECT refresh_sip_weekly();
