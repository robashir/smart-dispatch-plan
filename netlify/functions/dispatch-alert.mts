import EVENT_CONFIG_SEED from "../../event-config.json" with { type: "json" };
import { formatDispatchAlertEligibility } from "../../scripts/dispatch-alert-log.mjs";
import { buildScheduledDispatchBody } from "./_shared/dispatch-alert-request.mjs";

export default async (_request: Request, context: any) => {
  const alertSecret = Netlify.env.get("DISPATCH_ALERT_SECRET")?.trim();
  if (!alertSecret) {
    throw new Error("DISPATCH_ALERT_SECRET is required for scheduled dispatch alerts.");
  }

  const endpoint = new URL("/api/dispatch", context.site.url).toString();
  const body = buildScheduledDispatchBody({
    readEnv: (name: string) => Netlify.env.get(name),
    eventConfig: EVENT_CONFIG_SEED,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${alertSecret}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Dispatch failed ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text);
  const alert = data.telegramAlert || {};
  console.log(
    `[netlify-dispatch] itinerary=${Array.isArray(data.itinerary) ? data.itinerary.length : 0} alert=${alert.reason || "unknown"} sent=${alert.sent === true} title=${alert.title || ""}`
  );
  console.log(formatDispatchAlertEligibility(alert.evaluation));

  return new Response(null, { status: 204 });
};

export const config = {
  schedule: "*/5 * * * *",
};
