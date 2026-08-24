export type NullableNumber = number | null;

export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function finitePositive(value: unknown, field = "数值"): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${field}必须是有限正数`);
  }
  return numberValue;
}

export function optionalNonNegative(value: unknown, field = "数值"): NullableNumber {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new Error(`${field}必须是非负数或留空`);
  }
  return numberValue;
}

export function calculateContribution(
  quantityG: number,
  basisG: number,
  low: NullableNumber,
  high: NullableNumber,
) {
  finitePositive(quantityG, "克数");
  finitePositive(basisG, "计量基准");
  if (low === null || high === null || low === undefined || high === undefined) {
    return { low: null, high: null, known: false };
  }
  return {
    low: round3((quantityG / basisG) * low),
    high: round3((quantityG / basisG) * high),
    known: true,
  };
}

export function calculateRecipeFromIngredients(
  ingredients: Array<{ grams: number; basisG: number; low: NullableNumber; high: NullableNumber }>,
  finalYieldG: number | null,
) {
  if (!ingredients.length) throw new Error("菜谱至少需要一项配料");
  const total = ingredients.reduce(
    (result, ingredient) => {
      const grams = finitePositive(ingredient.grams, "配料克数");
      const contribution = calculateContribution(grams, ingredient.basisG, ingredient.low, ingredient.high);
      if (contribution.known) {
        result.low = round3(result.low + (contribution.low || 0));
        result.high = round3(result.high + (contribution.high || 0));
      } else {
        result.unknownCount += 1;
      }
      return result;
    },
    { low: 0, high: 0, unknownCount: 0 },
  );
  const normalizedYield = finalYieldG ? finitePositive(finalYieldG, "成品重量") : null;
  return {
    totalLow: total.unknownCount === ingredients.length ? null : round3(total.low),
    totalHigh: total.unknownCount === ingredients.length ? null : round3(total.high),
    lowPer100g: normalizedYield ? (total.unknownCount === ingredients.length ? null : round3((total.low / normalizedYield) * 100)) : null,
    highPer100g: normalizedYield ? (total.unknownCount === ingredients.length ? null : round3((total.high / normalizedYield) * 100)) : null,
    unknownCount: total.unknownCount,
  };
}

export function formatAmountRange(low: NullableNumber, high: NullableNumber, unit = "mg") {
  if (low === null || high === null || low === undefined || high === undefined) return "暂无估算";
  const left = trimNumber(low);
  const right = trimNumber(high);
  return low === high ? `约 ${left}${unit}` : `${left}–${right}${unit}`;
}

export function trimNumber(value: number) {
  return round3(value).toLocaleString("zh-CN", { maximumFractionDigits: 3 });
}

export function urateToUmol(value: number, unit: "umol/L" | "mg/dL") {
  finitePositive(value, "尿酸值");
  return unit === "mg/dL" ? round3(value * 59.48) : round3(value);
}

export function umolToUnit(value: number, unit: "umol/L" | "mg/dL") {
  finitePositive(value, "尿酸值");
  return unit === "mg/dL" ? round3(value / 59.48) : round3(value);
}

export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const center = Math.floor(sorted.length / 2);
  return round3(sorted.length % 2 ? sorted[center] : (sorted[center - 1] + sorted[center]) / 2);
}

export function summarizeKnownEntries(entries: Array<{ low: NullableNumber; high: NullableNumber }>) {
  const known = entries.filter((entry) => entry.low !== null && entry.high !== null);
  const unknownCount = entries.length - known.length;
  return {
    low: known.length ? round3(known.reduce((sum, entry) => sum + (entry.low || 0), 0)) : null,
    high: known.length ? round3(known.reduce((sum, entry) => sum + (entry.high || 0), 0)) : null,
    unknownCount,
    totalCount: entries.length,
    coverage: unknownCount ? "partial" : "complete",
  };
}

export function isValidIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function todayInTimezone(timeZone = "Asia/Shanghai") {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

export function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
