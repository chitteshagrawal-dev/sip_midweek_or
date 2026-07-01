# Ketto SIP — Weekly + Monthly Dashboards

Two sibling dashboards on the same project, sharing the same Supabase data
(`sip_weekly_or` table). Each lives at its own URL:

- `/` — Weekly Report (existing)
- `/monthly.html` — Monthly Report (new)

A small "Monthly →" / "← Weekly" link in each header lets you flip between
them in the same tab, or you can keep both open in separate browser tabs.

## One-time Supabase setup

1. Open the Supabase SQL editor.
2. Paste and run `sip_weekly_mvs.sql` (creates the 7 weekly MVs + refresh fn).
3. Paste and run `sip_monthly_mvs.sql` (creates the 7 monthly MVs + refresh fn).
4. Both grant SELECT to the `anon` role so the dashboards can read them.

## Weekly workflow

After uploading new rows to `sip_weekly_or`, run BOTH refresh functions in
the SQL editor so both dashboards pick up the new data:

```sql
SELECT refresh_sip_weekly();
SELECT refresh_sip_monthly();
```

## Run locally

```bash
npm install
npm run dev
```

- Weekly at  http://localhost:5173/
- Monthly at http://localhost:5173/monthly.html

## Build & deploy

```bash
npm run build
```

Vite builds both pages in one go (multi-page input config). Deploy `dist/`
to Vercel as usual — both URLs work automatically.

## Comparison windows

- **Weekly**:  WoW · 12-week avg · 24-week avg
- **Monthly**: MoM · 3-month avg · 6-month avg · All-time avg
