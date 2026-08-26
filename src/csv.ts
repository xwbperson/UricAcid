import type { DB } from "./db";
import { Repository } from "./repository";

function cell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const spreadsheetSafe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(spreadsheetSafe) ? `"${spreadsheetSafe.replaceAll('"', '""')}"` : spreadsheetSafe;
}

function table(headers: string[], rows: unknown[][]) {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

export function urateCsv(db: DB) {
  const rows = db.prepare(`SELECT measured_date, measured_time, value_original, unit_original, value_umol_l, fasting, source_kind, facility, acute_flare, reference_low_original, reference_high_original, reference_unit_original, note FROM urate_measurements WHERE deleted_at IS NULL ORDER BY measured_date, COALESCE(measured_time, '99:99'), created_at`).all();
  return table(
    ["date", "time", "value_original", "unit_original", "value_umol_l", "fasting", "source_kind", "facility", "acute_flare", "reference_low_original", "reference_high_original", "reference_unit_original", "note", "conversion_version"],
    rows.map((row: any) => [row.measured_date, row.measured_time, row.value_original, row.unit_original, row.value_umol_l, row.fasting, row.source_kind, row.facility, row.acute_flare === null ? "" : Boolean(row.acute_flare), row.reference_low_original, row.reference_high_original, row.reference_unit_original, row.note, "59.48-v1"]),
  );
}

export function dailySummaryCsv(repository: Repository, from?: unknown, to?: unknown) {
  const stats = repository.statistics(from, to);
  return table(
    ["date", "purine_low_mg", "purine_high_mg", "coverage", "unknown_count", "beverage_total_ml", "plain_water_ml"],
    stats.daily.map((row: any) => [row.date, row.purineLow, row.purineHigh, row.coverage, row.unknownCount, row.beverageTotalMl, row.plainWaterMl]),
  );
}
