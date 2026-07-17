import { parseByodEventText } from "./byod-events.mjs";

function countBusRecords(rawText) {
  const pattern =
    /Arriving\s*\n\s*\d{1,2}:\d{2}\s*[ap]m[\s\S]*?To\s*\n\s*([^\n]+)/gi;
  let count = 0;
  let match;
  while ((match = pattern.exec(String(rawText || ""))) !== null) {
    const destination = match[1].trim();
    if (/SUNY/i.test(destination)) continue;
    if (/Greyhound Bus Terminal|Trailways Bus Terminal/i.test(destination)) count += 1;
  }
  return count;
}

function countFlightRecords(rawText) {
  const timePattern = /\d{1,2}:\d{2}\s*[ap]m/i;
  let count = 0;
  let block = [];
  for (const line of String(rawText || "").split(/\r?\n/)) {
    block.push(line);
    if (!timePattern.test(line)) continue;
    if (!/\b(cancelled|canceled)\b/i.test(block.join(" "))) count += 1;
    block = [];
  }
  return count;
}

function countWeatherRecords(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return 0;
  if (!/\bTime\b/i.test(text) || !/\bConditions\b/i.test(text)) return 1;
  const times = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d{1,2})\s*:?\s*(\d{2})?\s*(am|pm)\b/i);
    if (match) times.add(`${match[1]}:${match[2] || "00"}${match[3].toLowerCase()}`);
  }
  return times.size;
}

export function countSavedByodRecords(kind, rawText, savedDate = null) {
  if (typeof rawText !== "string" || !rawText.trim()) return 0;
  if (kind === "bus") return countBusRecords(rawText);
  if (kind === "flight") return countFlightRecords(rawText);
  if (kind === "weather") return countWeatherRecords(rawText);
  if (kind === "event") return parseByodEventText(rawText, savedDate).length;
  return 0;
}
