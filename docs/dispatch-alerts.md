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
- `DISPATCH_ALERT_SECRET`: private shared secret sent only by the GitHub scheduler.

The same `DISPATCH_ALERT_SECRET` value must be configured as a Netlify
environment variable. Requests without an `Authorization` header can still
calculate a dispatch plan, but they cannot send Telegram messages. Requests
that attempt to authorize with the wrong secret receive `401 Unauthorized`.

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

## Duplicate suppression

Successful Telegram sends are recorded in the site-scoped Netlify Blobs store
`smart-dispatch-alert-cooldowns`. Each alert candidate has a hashed storage key
and is suppressed for 30 minutes, including across deploys, cold starts, and
different serverless instances. If the cooldown store cannot be read, the
alert fails closed rather than risking a duplicate message.

## Normal-supply threshold

When driver supply is Normal (`driverSupplyPressureMod < 1.10`), Telegram uses
the same Downtown, Uptown, and Other Areas counts shown in the Demand-First
Timeline. It sends one citywide summary only when the combined count is greater
than 9. A combined count of exactly 9 does not alert. Tight and shortage-driven
alert rules continue to use their existing opportunity logic.
