-- ════════════════════════════════════════════════════════════════════════════
-- KETTO SIP — MONTHLY DASHBOARD  ·  MATERIALIZED VIEWS
-- Source table: sip_weekly_or   (successful orders only)
-- Month grain : date_trunc('month', date)
-- month_idx   : 0-based from Jan 2025 (so May 2025 = 4, May 2026 = 16)
-- donated_amount is already INR-converted for non-INR currencies.
-- utm_type_v3 = categorisation.  "Telecalling" = utm_type_v3 = 'Telecalling / SIP Team'
-- ════════════════════════════════════════════════════════════════════════════
-- HOW TO USE:
--   1. Run this whole script ONCE in the Supabase SQL editor.
--   2. Each time you upload new rows, run:  SELECT refresh_sip_monthly();
--   3. The dashboard reads the views via the REST API automatically.
-- ════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 0. Helper: a base view that tags every row with its month + derived flags.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS sip_month_base CASCADE;
CREATE VIEW sip_month_base AS
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
  ((EXTRACT(YEAR FROM "date")::int - 2025) * 12 + EXTRACT(MONTH FROM "date")::int - 1) AS month_idx,
  date_trunc('month', "date")::date                                              AS month_start,
  (utm_type_v3 = 'Telecalling / SIP Team')                                        AS is_tel,
  COALESCE(NULLIF(utm_type_v3, ''), 'Null')                                       AS channel,
  CASE
    WHEN device_type ILIKE 'Desktop%' THEN 'Desktop'
    WHEN device_type ILIKE 'Mobile%'  THEN 'Mobile'
    WHEN device_type = 'App'          THEN 'App'
    ELSE 'Other'
  END                                                                             AS device,
  COALESCE(NULLIF(page_type, ''), 'Blank')                                        AS page,
  (donor_type_on_sip_order   = 'New')                                             AS is_new_sip,
  (donor_type_on_overall_order = 'New')                                           AS is_brand_new
FROM sip_weekly_or
WHERE "date"::date >= DATE '2025-01-01';

-- ---------------------------------------------------------------------------
-- 1. PULSE — per month: tel vs non-tel orders & amount
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_pulse_month CASCADE;
CREATE MATERIALIZED VIEW mv_sip_pulse_month AS
SELECT
  month_idx,
  month_start,
  COUNT(*) FILTER (WHERE is_tel)            AS tel_orders,
  COUNT(*) FILTER (WHERE NOT is_tel)        AS nontel_orders,
  COALESCE(SUM(donated_amount) FILTER (WHERE is_tel),0)::numeric(14,2)     AS tel_amount,
  COALESCE(SUM(donated_amount) FILTER (WHERE NOT is_tel),0)::numeric(14,2) AS nontel_amount
FROM sip_month_base
GROUP BY month_idx, month_start
ORDER BY month_idx;

-- ---------------------------------------------------------------------------
-- 2. CHANNEL × MONTH — non-tel only
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_channel_month CASCADE;
CREATE MATERIALIZED VIEW mv_sip_channel_month AS
SELECT
  month_idx,
  month_start,
  channel,
  COUNT(*)                                              AS orders,
  COALESCE(SUM(donated_amount),0)::numeric(14,2)        AS amount,
  COUNT(*) FILTER (WHERE is_new_sip)                    AS new_sip,
  COUNT(*) FILTER (WHERE NOT is_new_sip)                AS repeat_sip,
  COUNT(*) FILTER (WHERE is_brand_new)                  AS brand_new,
  ROUND(COALESCE(SUM(donated_amount),0) / NULLIF(COUNT(*),0))::int AS asv
FROM sip_month_base
WHERE NOT is_tel
GROUP BY month_idx, month_start, channel
ORDER BY month_idx, channel;

-- ---------------------------------------------------------------------------
-- 3. CHANNEL × MONTH × ORDER_TYPE
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_channel_ot_month CASCADE;
CREATE MATERIALIZED VIEW mv_sip_channel_ot_month AS
SELECT
  month_idx, month_start, channel,
  COALESCE(NULLIF(order_type,''),'normal_order')        AS order_type,
  COUNT(*)                                              AS orders,
  COALESCE(SUM(donated_amount),0)::numeric(14,2)        AS amount,
  ROUND(COALESCE(SUM(donated_amount),0) / NULLIF(COUNT(*),0))::int AS asv
FROM sip_month_base
WHERE NOT is_tel
GROUP BY month_idx, month_start, channel, COALESCE(NULLIF(order_type,''),'normal_order')
ORDER BY month_idx, channel;

-- ---------------------------------------------------------------------------
-- 4. PAGE TYPE × MONTH — non-tel
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_page_month CASCADE;
CREATE MATERIALIZED VIEW mv_sip_page_month AS
SELECT month_idx, month_start, page, COUNT(*) AS orders
FROM sip_month_base
WHERE NOT is_tel
GROUP BY month_idx, month_start, page
ORDER BY month_idx;

-- ---------------------------------------------------------------------------
-- 5. DEVICE × CHANNEL × MONTH — non-tel
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_device_month CASCADE;
CREATE MATERIALIZED VIEW mv_sip_device_month AS
SELECT month_idx, month_start, channel, device, COUNT(*) AS orders
FROM sip_month_base
WHERE NOT is_tel
GROUP BY month_idx, month_start, channel, device
ORDER BY month_idx;

-- ---------------------------------------------------------------------------
-- 6. COUNTRY × CHANNEL × MONTH — non-tel
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_country_month CASCADE;
CREATE MATERIALIZED VIEW mv_sip_country_month AS
SELECT
  month_idx, month_start,
  COALESCE(NULLIF(donor_country,''),'Unknown') AS country,
  channel,
  COUNT(*)                                       AS orders,
  COALESCE(SUM(donated_amount),0)::numeric(14,2) AS amount,
  COUNT(*) FILTER (WHERE is_new_sip)             AS new_sip,
  COUNT(*) FILTER (WHERE NOT is_new_sip)         AS repeat_sip
FROM sip_month_base
WHERE NOT is_tel
GROUP BY month_idx, month_start, COALESCE(NULLIF(donor_country,''),'Unknown'), channel
ORDER BY month_idx;

-- ---------------------------------------------------------------------------
-- 7. SOURCE/MEDIUM × CHANNEL × MONTH — non-tel deep dive
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_sip_source_month CASCADE;
CREATE MATERIALIZED VIEW mv_sip_source_month AS
SELECT
  month_idx, month_start, channel,
  COALESCE(NULLIF(utm_source,''),'(not set)') AS utm_source,
  COALESCE(NULLIF(utm_medium,''),'(not set)') AS utm_medium,
  COUNT(*)                                       AS orders,
  COALESCE(SUM(donated_amount),0)::numeric(14,2) AS amount,
  COUNT(*) FILTER (WHERE is_new_sip)             AS new_sip,
  COUNT(*) FILTER (WHERE NOT is_new_sip)         AS repeat_sip
FROM sip_month_base
WHERE NOT is_tel
GROUP BY month_idx, month_start, channel,
         COALESCE(NULLIF(utm_source,''),'(not set)'),
         COALESCE(NULLIF(utm_medium,''),'(not set)')
ORDER BY month_idx;

-- ---------------------------------------------------------------------------
-- 8. REFRESH FUNCTION — run each time you upload new rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_sip_monthly() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_sip_pulse_month;
  REFRESH MATERIALIZED VIEW mv_sip_channel_month;
  REFRESH MATERIALIZED VIEW mv_sip_channel_ot_month;
  REFRESH MATERIALIZED VIEW mv_sip_page_month;
  REFRESH MATERIALIZED VIEW mv_sip_device_month;
  REFRESH MATERIALIZED VIEW mv_sip_country_month;
  REFRESH MATERIALIZED VIEW mv_sip_source_month;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 9. EXPOSE TO anon ROLE
-- ---------------------------------------------------------------------------
GRANT SELECT ON mv_sip_pulse_month,
               mv_sip_channel_month,
               mv_sip_channel_ot_month,
               mv_sip_page_month,
               mv_sip_device_month,
               mv_sip_country_month,
               mv_sip_source_month
        TO anon, authenticated;

-- Done. Now run:  SELECT refresh_sip_monthly();
