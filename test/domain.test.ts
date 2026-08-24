import test from "node:test";
import assert from "node:assert/strict";
import { calculateContribution, calculateRecipeFromIngredients, median, summarizeKnownEntries, urateToUmol } from "../src/domain";

test("150g food at 20–30mg/100g contributes 30–45mg", () => {
  assert.deepEqual(calculateContribution(150, 100, 20, 30), { low: 30, high: 45, known: true });
});

test("unknown reference values stay unknown and do not become zero", () => {
  const result = calculateContribution(150, 100, null, null);
  assert.deepEqual(result, { low: null, high: null, known: false });
  assert.deepEqual(summarizeKnownEntries([{ low: 30, high: 45 }, { low: null, high: null }]), { low: 30, high: 45, unknownCount: 1, totalCount: 2, coverage: "partial" });
  assert.deepEqual(summarizeKnownEntries([{ low: null, high: null }]), { low: null, high: null, unknownCount: 1, totalCount: 1, coverage: "partial" });
});

test("recipe calculation is consistent across total, per-100g and eaten quantity", () => {
  const recipe = calculateRecipeFromIngredients([{ grams: 100, basisG: 100, low: 20, high: 30 }, { grams: 50, basisG: 100, low: 10, high: 20 }], 300);
  assert.equal(recipe.totalLow, 25);
  assert.equal(recipe.totalHigh, 40);
  assert.equal(recipe.lowPer100g, 8.333);
  assert.equal(recipe.highPer100g, 13.333);
  assert.deepEqual(calculateContribution(150, 100, recipe.lowPer100g, recipe.highPer100g), { low: 12.5, high: 20, known: true });
});

test("urate conversion uses the fixed 59.48 factor", () => {
  assert.equal(urateToUmol(7, "mg/dL"), 416.36);
  assert.equal(urateToUmol(416.36, "umol/L"), 416.36);
});

test("median is stable for odd and even sample sizes", () => {
  assert.equal(median([10, 1, 5]), 5);
  assert.equal(median([10, 1, 5, 7]), 6);
});
