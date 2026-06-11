# Dispatch Alert Scheduler

GitHub Actions runs `.github/workflows/dispatch-alerts.yml` every 15 minutes.
The script at `scripts/dispatch-cron.mjs` decides whether that tick should call
the deployed dispatch API.

## Cadence

- Every 4 hours for broad planning.
- Every 30 minutes during normal driving windows.
- Every 15 minutes during late-night or train-heavy windows.
- Manual GitHub workflow runs force a dispatch check by default.

## Required GitHub Secret

- `DISPATCH_ENDPOINT`: deployed endpoint, for example `https://your-site.netlify.app/api/dispatch`.

## Optional GitHub Secrets

- `DISPATCH_LATITUDE`: default `42.686`.
- `DISPATCH_LONGITUDE`: default `-73.843`.
- `DISPATCH_HOURS`: default `4`.
- `DISPATCH_TIMEZONE_OFFSET_MINUTES`: normally auto-detected for New York.
- `DISPATCH_ROUTING_STRATEGY`: default `profitability`.
- `DISPATCH_COST_PER_MILE`: default `0.65`.
- `DISPATCH_ENABLE_RIDESHARE`: default `true`.
- `DISPATCH_ENABLE_FOOD`: default `true`.
- `DISPATCH_ENABLE_GROCERY`: default `false`.
- `DISPATCH_INCLUDE_AIRPORT`: default `true`.
- `DISPATCH_INCLUDE_AMTRAK`: default `true`.

Telegram secrets stay in Netlify environment variables:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
