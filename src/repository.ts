import {
  addDays,
  calculateContribution,
  calculateRecipeFromIngredients,
  finitePositive,
  isValidIsoDate,
  median,
  optionalNonNegative,
  round3,
  summarizeKnownEntries,
  todayInTimezone,
  umolToUnit,
  urateToUmol,
} from "./domain";
import { cloneData, type DB, replaceData, uuid } from "./db";

const CALCULATION_VERSION = "purine-range-v1";

function timestamp() {
  return new Date().toISOString();
}

function asNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function requireDate(value: unknown) {
  const date = String(value || "");
  if (!isValidIsoDate(date)) throw new Error("日期格式必须为 YYYY-MM-DD");
  return date;
}

function assertNotFuture(date: string, timeZone: string) {
  if (date > todayInTimezone(timeZone)) throw new Error("不能无提示地记录未来日期");
}

function rowWithSnapshot(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    date: row.entry_date,
    kind: row.kind,
    foodVersionId: row.food_version_id,
    recipeVersionId: row.recipe_version_id,
    name: row.item_name_snapshot,
    groupName: row.group_name_snapshot,
    quantityG: row.quantity_g,
    contributionLow: row.contribution_low,
    contributionHigh: row.contribution_high,
    referenceLow: row.reference_low_snapshot,
    referenceHigh: row.reference_high_snapshot,
    referenceBasisG: row.reference_basis_g_snapshot,
    snapshot: {
      name: row.item_name_snapshot,
      groupName: row.group_name_snapshot,
      referenceLow: row.reference_low_snapshot,
      referenceHigh: row.reference_high_snapshot,
      referenceBasisG: row.reference_basis_g_snapshot,
      calculationVersion: row.calculation_version,
    },
    createdAt: row.created_at,
  };
}

export class Repository {
  constructor(public db: DB) {}

  settings() {
    const row = this.db.prepare("SELECT * FROM app_settings WHERE id = 1").get();
    return {
      timezone: row.timezone,
      defaultUrateUnit: row.default_urate_unit,
      waterGoalMl: row.water_goal_ml,
    };
  }

  bootstrap(search = "") {
    const pattern = `%${search.trim()}%`;
    const foods = this.db.prepare(`
      SELECT f.id, f.name, f.aliases, f.group_id, fg.name AS group_name, f.state,
             fv.id AS version_id, fv.version_no, fv.basis_g, fv.purine_low, fv.purine_mean,
             fv.purine_high, fv.range_type, fv.verification_status, fv.source_id, fv.notes
      FROM foods f
      LEFT JOIN food_groups fg ON fg.id = f.group_id
      JOIN food_versions fv ON fv.food_id = f.id AND fv.version_no = (SELECT MAX(version_no) FROM food_versions WHERE food_id = f.id)
      WHERE f.archived_at IS NULL AND (f.name LIKE ? OR f.aliases LIKE ? OR COALESCE(fg.name, '') LIKE ?)
      ORDER BY COALESCE(fg.sort_order, 999), f.name
    `).all(pattern, pattern, pattern).map((row: any) => this.foodPublic(row));
    const recipes = this.db.prepare(`
      SELECT r.id, r.name, r.aliases, r.group_id, rg.name AS group_name,
             rv.id AS version_id, rv.version_no, rv.mode, rv.final_yield_g, rv.total_low, rv.total_high,
             rv.purine_low, rv.purine_high, rv.verification_status, rv.source_id, rv.notes
      FROM recipes r
      LEFT JOIN recipe_groups rg ON rg.id = r.group_id
      JOIN recipe_versions rv ON rv.recipe_id = r.id AND rv.version_no = (SELECT MAX(version_no) FROM recipe_versions WHERE recipe_id = r.id)
      WHERE r.archived_at IS NULL AND (r.name LIKE ? OR r.aliases LIKE ? OR COALESCE(rg.name, '') LIKE ?)
      ORDER BY COALESCE(rg.sort_order, 999), r.name
    `).all(pattern, pattern, pattern).map((row: any) => this.recipePublic(row));
    const beverages = this.db.prepare(`
      SELECT b.*, bg.name AS group_name FROM beverages b LEFT JOIN beverage_groups bg ON bg.id = b.group_id
      WHERE b.archived_at IS NULL AND (b.name LIKE ? OR b.aliases LIKE ? OR COALESCE(bg.name, '') LIKE ?)
      ORDER BY b.system DESC, b.name
    `).all(pattern, pattern, pattern).map((row: any) => this.beveragePublic(row));
    return {
      settings: this.settings(),
      groups: {
        foods: this.db.prepare("SELECT * FROM food_groups ORDER BY sort_order, name").all(),
        recipes: this.db.prepare("SELECT * FROM recipe_groups ORDER BY sort_order, name").all(),
        beverages: this.db.prepare("SELECT * FROM beverage_groups ORDER BY sort_order, name").all(),
      },
      foods,
      recipes,
      beverages,
      portions: this.db.prepare("SELECT * FROM portion_presets ORDER BY kind, sort_order, value").all(),
      sources: this.db.prepare("SELECT * FROM reference_sources ORDER BY created_at DESC").all(),
      counts: {
        foods: this.db.prepare("SELECT COUNT(*) AS count FROM foods WHERE archived_at IS NULL").get().count,
        recipes: this.db.prepare("SELECT COUNT(*) AS count FROM recipes WHERE archived_at IS NULL").get().count,
        beverages: this.db.prepare("SELECT COUNT(*) AS count FROM beverages WHERE archived_at IS NULL").get().count,
      },
      latestBackup: this.db.prepare("SELECT id, created_at, status, sha256, replica_status, verified_at FROM backup_records WHERE backup_type = 'sqlite_snapshot' ORDER BY created_at DESC LIMIT 1").get() || null,
      backupAlert: this.db.prepare("SELECT id, created_at, status, note FROM backup_records WHERE status IN ('REPLICA_FAILED', 'FAILED') OR replica_status = 'FAILED' ORDER BY created_at DESC LIMIT 1").get() || null,
    };
  }

  foodPublic(row: any) {
    return {
      id: row.id,
      name: row.name,
      aliases: row.aliases,
      groupId: row.group_id,
      groupName: row.group_name,
      state: row.state,
      versionId: row.version_id,
      versionNo: row.version_no,
      basisG: row.basis_g,
      purineLow: row.purine_low,
      purineMean: row.purine_mean,
      purineHigh: row.purine_high,
      rangeType: row.range_type,
      verificationStatus: row.verification_status,
      sourceId: row.source_id,
      notes: row.notes,
    };
  }

  recipePublic(row: any) {
    const ingredients = this.db.prepare("SELECT food_version_id AS foodVersionId, grams FROM recipe_ingredients WHERE recipe_version_id = ?").all(row.version_id);
    return {
      id: row.id,
      name: row.name,
      aliases: row.aliases,
      groupId: row.group_id,
      groupName: row.group_name,
      versionId: row.version_id,
      versionNo: row.version_no,
      mode: row.mode,
      finalYieldG: row.final_yield_g,
      totalLow: row.total_low,
      totalHigh: row.total_high,
      purineLow: row.purine_low,
      purineHigh: row.purine_high,
      verificationStatus: row.verification_status,
      sourceId: row.source_id,
      notes: row.notes,
      ingredients,
    };
  }

  beveragePublic(row: any) {
    return {
      id: row.id,
      name: row.name,
      aliases: row.aliases,
      groupId: row.group_id,
      groupName: row.group_name,
      isPlainWater: Boolean(row.is_plain_water),
      containsSugar: Boolean(row.contains_sugar),
      system: Boolean(row.system),
      notes: row.notes,
    };
  }

  getDay(dateInput: unknown) {
    const date = requireDate(dateInput);
    const dietRows = this.db.prepare("SELECT * FROM diet_entries WHERE entry_date = ? AND deleted_at IS NULL ORDER BY created_at DESC").all(date);
    const beverageRows = this.db.prepare("SELECT * FROM beverage_entries WHERE entry_date = ? AND deleted_at IS NULL ORDER BY created_at DESC").all(date);
    const measurementRows = this.db.prepare("SELECT * FROM urate_measurements WHERE measured_date = ? AND deleted_at IS NULL ORDER BY COALESCE(measured_time, '99:99') DESC, created_at DESC").all(date);
    const summary = summarizeKnownEntries(dietRows.map((row: any) => ({ low: row.contribution_low, high: row.contribution_high })));
    const beverage = {
      totalMl: round3(beverageRows.reduce((sum: number, row: any) => sum + row.amount_ml, 0)),
      plainWaterMl: round3(beverageRows.filter((row: any) => row.is_plain_water_snapshot).reduce((sum: number, row: any) => sum + row.amount_ml, 0)),
      otherMl: round3(beverageRows.filter((row: any) => !row.is_plain_water_snapshot).reduce((sum: number, row: any) => sum + row.amount_ml, 0)),
    };
    const latestMeasurement = this.db.prepare("SELECT * FROM urate_measurements WHERE deleted_at IS NULL ORDER BY measured_date DESC, COALESCE(measured_time, '99:99') DESC, created_at DESC LIMIT 1").get();
    return {
      date,
      summary,
      beverage,
      dietEntries: dietRows.map(rowWithSnapshot),
      beverageEntries: beverageRows.map((row: any) => ({ id: row.id, clientId: row.client_id, date: row.entry_date, beverageId: row.beverage_id, name: row.beverage_name_snapshot, amountMl: row.amount_ml, quantity: row.quantity, isPlainWater: Boolean(row.is_plain_water_snapshot), createdAt: row.created_at })),
      measurements: measurementRows.map((row: any) => this.measurementPublic(row)),
      latestMeasurement: latestMeasurement ? this.measurementPublic(latestMeasurement) : null,
    };
  }

  measurementPublic(row: any) {
    return {
      id: row.id,
      clientId: row.client_id,
      date: row.measured_date,
      time: row.measured_time,
      valueOriginal: row.value_original,
      unitOriginal: row.unit_original,
      valueUmolL: row.value_umol_l,
      fasting: row.fasting,
      sourceKind: row.source_kind,
      facility: row.facility,
      acuteFlare: row.acute_flare === null ? null : Boolean(row.acute_flare),
      referenceLowOriginal: row.reference_low_original,
      referenceHighOriginal: row.reference_high_original,
      referenceUnitOriginal: row.reference_unit_original,
      note: row.note,
      createdAt: row.created_at,
    };
  }

  createDiet(payload: any) {
    const date = requireDate(payload.date);
    const kind = payload.kind === "recipe" ? "recipe" : "food";
    const quantityG = finitePositive(payload.quantityG, "克数");
    const clientId = String(payload.clientId || uuid());
    const existing = this.db.prepare("SELECT * FROM diet_entries WHERE client_id = ?").get(clientId);
    if (existing) return rowWithSnapshot(existing);
    let source: any;
    let groupName: string | null = null;
    let referenceLow: number | null;
    let referenceHigh: number | null;
    let referenceBasis = 100;
    let itemName: string;
    let foodVersionId: string | null = null;
    let recipeVersionId: string | null = null;
    if (kind === "food") {
      source = this.db.prepare(`SELECT f.*, fg.name AS group_name, fv.* FROM foods f LEFT JOIN food_groups fg ON fg.id = f.group_id JOIN food_versions fv ON fv.id = ? AND fv.food_id = f.id`).get(String(payload.versionId));
      if (!source || source.archived_at) throw new Error("食物不存在或已归档");
      itemName = source.name;
      groupName = source.group_name || null;
      referenceLow = asNullableNumber(source.purine_low);
      referenceHigh = asNullableNumber(source.purine_high);
      referenceBasis = source.basis_g;
      foodVersionId = source.id;
    } else {
      source = this.db.prepare(`SELECT r.*, rg.name AS group_name, rv.* FROM recipes r LEFT JOIN recipe_groups rg ON rg.id = r.group_id JOIN recipe_versions rv ON rv.id = ? AND rv.recipe_id = r.id`).get(String(payload.versionId));
      if (!source || source.archived_at) throw new Error("菜谱不存在或已归档");
      itemName = source.name;
      groupName = source.group_name || null;
      referenceLow = asNullableNumber(source.purine_low);
      referenceHigh = asNullableNumber(source.purine_high);
      referenceBasis = 100;
      recipeVersionId = source.id;
      if (referenceLow === null || referenceHigh === null) throw new Error("菜谱尚未完成成品重量或参考范围，不能进入正式记录");
    }
    const contribution = calculateContribution(quantityG, referenceBasis, referenceLow, referenceHigh);
    const createdAt = timestamp();
    const id = uuid();
    this.db.prepare(`
      INSERT INTO diet_entries (id, client_id, entry_date, kind, food_version_id, recipe_version_id, quantity_g, item_name_snapshot, group_name_snapshot, reference_low_snapshot, reference_high_snapshot, reference_basis_g_snapshot, calculation_version, contribution_low, contribution_high, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, clientId, date, kind, foodVersionId, recipeVersionId, quantityG, itemName, groupName, referenceLow, referenceHigh, referenceBasis, CALCULATION_VERSION, contribution.low, contribution.high, createdAt, createdAt);
    return rowWithSnapshot(this.db.prepare("SELECT * FROM diet_entries WHERE id = ?").get(id));
  }

  updateDiet(id: string, payload: any) {
    const existing = this.db.prepare("SELECT * FROM diet_entries WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!existing) throw new Error("饮食记录不存在");
    const date = requireDate(payload.date || existing.entry_date);
    const kind = payload.kind === "recipe" || (payload.kind === undefined && existing.kind === "recipe") ? "recipe" : "food";
    const quantityG = finitePositive(payload.quantityG ?? existing.quantity_g, "克数");
    const source = kind === "food"
      ? this.db.prepare(`SELECT f.*, fg.name AS group_name, fv.* FROM foods f LEFT JOIN food_groups fg ON fg.id = f.group_id JOIN food_versions fv ON fv.id = ? AND fv.food_id = f.id`).get(String(payload.versionId || existing.food_version_id))
      : this.db.prepare(`SELECT r.*, rg.name AS group_name, rv.* FROM recipes r LEFT JOIN recipe_groups rg ON rg.id = r.group_id JOIN recipe_versions rv ON rv.id = ? AND rv.recipe_id = r.id`).get(String(payload.versionId || existing.recipe_version_id));
    if (!source) throw new Error("选择的资料不存在");
    if (kind === "recipe" && (source.archived_at || asNullableNumber(source.purine_low) === null || asNullableNumber(source.purine_high) === null)) throw new Error("菜谱尚未完成成品重量或参考范围，不能进入正式记录");
    const low = asNullableNumber(kind === "food" ? source.purine_low : source.purine_low);
    const high = asNullableNumber(kind === "food" ? source.purine_high : source.purine_high);
    const basis = kind === "food" ? source.basis_g : 100;
    const contribution = calculateContribution(quantityG, basis, low, high);
    this.db.prepare(`
      UPDATE diet_entries SET entry_date = ?, kind = ?, food_version_id = ?, recipe_version_id = ?, quantity_g = ?, item_name_snapshot = ?, group_name_snapshot = ?, reference_low_snapshot = ?, reference_high_snapshot = ?, reference_basis_g_snapshot = ?, contribution_low = ?, contribution_high = ?, updated_at = ? WHERE id = ?
    `).run(date, kind, kind === "food" ? source.id : null, kind === "recipe" ? source.id : null, quantityG, source.name, source.group_name || null, low, high, basis, contribution.low, contribution.high, timestamp(), id);
    return rowWithSnapshot(this.db.prepare("SELECT * FROM diet_entries WHERE id = ?").get(id));
  }

  deleteDiet(id: string) {
    const result = this.db.prepare("UPDATE diet_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(timestamp(), timestamp(), id);
    if (!result.changes) throw new Error("饮食记录不存在");
  }

  createBeverageEntry(payload: any) {
    const date = requireDate(payload.date);
    const beverage = this.db.prepare("SELECT * FROM beverages WHERE id = ? AND archived_at IS NULL").get(String(payload.beverageId));
    if (!beverage) throw new Error("饮品不存在或已归档");
    const servingMl = finitePositive(payload.amountMl, "毫升数");
    const quantity = Math.max(1, Math.floor(Number(payload.quantity || 1)));
    const clientId = String(payload.clientId || uuid());
    const existing = this.db.prepare("SELECT * FROM beverage_entries WHERE client_id = ?").get(clientId);
    if (existing) return this.beverageEntryPublic(existing);
    const id = uuid();
    const createdAt = timestamp();
    this.db.prepare("INSERT INTO beverage_entries (id, client_id, entry_date, beverage_id, beverage_name_snapshot, is_plain_water_snapshot, amount_ml, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, clientId, date, beverage.id, beverage.name, beverage.is_plain_water, round3(servingMl * quantity), quantity, createdAt, createdAt);
    return this.beverageEntryPublic(this.db.prepare("SELECT * FROM beverage_entries WHERE id = ?").get(id));
  }

  beverageEntryPublic(row: any) {
    return { id: row.id, clientId: row.client_id, date: row.entry_date, beverageId: row.beverage_id, name: row.beverage_name_snapshot, amountMl: row.amount_ml, quantity: row.quantity, isPlainWater: Boolean(row.is_plain_water_snapshot), createdAt: row.created_at };
  }

  updateBeverageEntry(id: string, payload: any) {
    const current = this.db.prepare("SELECT * FROM beverage_entries WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!current) throw new Error("饮品记录不存在");
    const beverage = this.db.prepare("SELECT * FROM beverages WHERE id = ?").get(String(payload.beverageId || current.beverage_id));
    if (!beverage) throw new Error("饮品不存在");
    const date = requireDate(payload.date || current.entry_date);
    const servingMl = finitePositive(payload.amountMl ?? current.amount_ml, "毫升数");
    const quantity = Math.max(1, Math.floor(Number(payload.quantity || 1)));
    this.db.prepare("UPDATE beverage_entries SET entry_date = ?, beverage_id = ?, beverage_name_snapshot = ?, is_plain_water_snapshot = ?, amount_ml = ?, quantity = ?, updated_at = ? WHERE id = ?").run(date, beverage.id, beverage.name, beverage.is_plain_water, round3(servingMl * quantity), quantity, timestamp(), id);
    return this.beverageEntryPublic(this.db.prepare("SELECT * FROM beverage_entries WHERE id = ?").get(id));
  }

  deleteBeverageEntry(id: string) {
    const result = this.db.prepare("UPDATE beverage_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(timestamp(), timestamp(), id);
    if (!result.changes) throw new Error("饮品记录不存在");
  }

  createMeasurement(payload: any) {
    const date = requireDate(payload.date);
    const settings = this.settings();
    assertNotFuture(date, settings.timezone);
    const valueOriginal = finitePositive(payload.valueOriginal, "尿酸值");
    const unitOriginal = payload.unitOriginal === "mg/dL" ? "mg/dL" : "umol/L";
    const clientId = String(payload.clientId || uuid());
    const existing = this.db.prepare("SELECT * FROM urate_measurements WHERE client_id = ?").get(clientId);
    if (existing) return this.measurementPublic(existing);
    const refLow = optionalNonNegative(payload.referenceLowOriginal, "参考下限");
    const refHigh = optionalNonNegative(payload.referenceHighOriginal, "参考上限");
    if (refLow !== null && refHigh !== null && refLow > refHigh) throw new Error("参考下限不能大于参考上限");
    const id = uuid();
    const createdAt = timestamp();
    this.db.prepare(`INSERT INTO urate_measurements (id, client_id, measured_date, measured_time, value_original, unit_original, value_umol_l, fasting, source_kind, facility, acute_flare, reference_low_original, reference_high_original, reference_unit_original, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, clientId, date, payload.time || null, valueOriginal, unitOriginal, urateToUmol(valueOriginal, unitOriginal), payload.fasting || "unknown", payload.sourceKind || null, payload.facility || null, payload.acuteFlare === null || payload.acuteFlare === undefined ? null : payload.acuteFlare ? 1 : 0, refLow, refHigh, payload.referenceUnitOriginal || (refLow !== null || refHigh !== null ? unitOriginal : null), payload.note || null, createdAt, createdAt);
    return this.measurementPublic(this.db.prepare("SELECT * FROM urate_measurements WHERE id = ?").get(id));
  }

  updateMeasurement(id: string, payload: any) {
    const current = this.db.prepare("SELECT * FROM urate_measurements WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!current) throw new Error("血尿酸记录不存在");
    const date = requireDate(payload.date || current.measured_date);
    const settings = this.settings();
    assertNotFuture(date, settings.timezone);
    const valueOriginal = finitePositive(payload.valueOriginal ?? current.value_original, "尿酸值");
    const unitOriginal = payload.unitOriginal === "mg/dL" || (payload.unitOriginal === undefined && current.unit_original === "mg/dL") ? "mg/dL" : "umol/L";
    const refLow = optionalNonNegative(payload.referenceLowOriginal ?? current.reference_low_original, "参考下限");
    const refHigh = optionalNonNegative(payload.referenceHighOriginal ?? current.reference_high_original, "参考上限");
    if (refLow !== null && refHigh !== null && refLow > refHigh) throw new Error("参考下限不能大于参考上限");
    this.db.prepare(`UPDATE urate_measurements SET measured_date = ?, measured_time = ?, value_original = ?, unit_original = ?, value_umol_l = ?, fasting = ?, source_kind = ?, facility = ?, acute_flare = ?, reference_low_original = ?, reference_high_original = ?, reference_unit_original = ?, note = ?, updated_at = ? WHERE id = ?`).run(date, payload.time ?? current.measured_time ?? null, valueOriginal, unitOriginal, urateToUmol(valueOriginal, unitOriginal), payload.fasting ?? current.fasting, payload.sourceKind ?? current.source_kind, payload.facility ?? current.facility, payload.acuteFlare === undefined ? current.acute_flare : payload.acuteFlare === null ? null : payload.acuteFlare ? 1 : 0, refLow, refHigh, payload.referenceUnitOriginal ?? current.reference_unit_original ?? null, payload.note ?? current.note, timestamp(), id);
    return this.measurementPublic(this.db.prepare("SELECT * FROM urate_measurements WHERE id = ?").get(id));
  }

  deleteMeasurement(id: string) {
    const result = this.db.prepare("UPDATE urate_measurements SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(timestamp(), timestamp(), id);
    if (!result.changes) throw new Error("血尿酸记录不存在");
  }

  history(fromInput: unknown, toInput: unknown) {
    const from = requireDate(fromInput || addDays(todayInTimezone(this.settings().timezone), -29));
    const to = requireDate(toInput || todayInTimezone(this.settings().timezone));
    const dates = this.db.prepare(`SELECT entry_date AS date FROM diet_entries WHERE entry_date BETWEEN ? AND ? AND deleted_at IS NULL UNION SELECT entry_date FROM beverage_entries WHERE entry_date BETWEEN ? AND ? AND deleted_at IS NULL UNION SELECT measured_date FROM urate_measurements WHERE measured_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date DESC`).all(from, to, from, to, from, to);
    return dates.map((row: any) => this.getDay(row.date));
  }

  statistics(fromInput: unknown, toInput: unknown) {
    const from = requireDate(fromInput || addDays(todayInTimezone(this.settings().timezone), -29));
    const to = requireDate(toInput || todayInTimezone(this.settings().timezone));
    const measurements = this.db.prepare("SELECT * FROM urate_measurements WHERE measured_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY measured_date, COALESCE(measured_time, '99:99'), created_at").all(from, to).map((row: any) => this.measurementPublic(row));
    const values = measurements.map((row: any) => row.valueUmolL);
    const dietRows = this.db.prepare("SELECT entry_date, contribution_low, contribution_high FROM diet_entries WHERE entry_date BETWEEN ? AND ? AND deleted_at IS NULL").all(from, to);
    const beverageRows = this.db.prepare("SELECT entry_date, amount_ml, is_plain_water_snapshot FROM beverage_entries WHERE entry_date BETWEEN ? AND ? AND deleted_at IS NULL").all(from, to);
    const dailyMap = new Map<string, any>();
    for (const row of dietRows) {
      const day = dailyMap.get(row.entry_date) || { date: row.entry_date, dietEntries: 0, purineLow: null, purineHigh: null, unknownCount: 0, beverageTotalMl: 0, plainWaterMl: 0 };
      day.dietEntries += 1;
      if (row.contribution_low === null || row.contribution_high === null) day.unknownCount += 1;
      else { day.purineLow = round3((day.purineLow || 0) + row.contribution_low); day.purineHigh = round3((day.purineHigh || 0) + row.contribution_high); }
      dailyMap.set(row.entry_date, day);
    }
    for (const row of beverageRows) {
      const day = dailyMap.get(row.entry_date) || { date: row.entry_date, dietEntries: 0, purineLow: null, purineHigh: null, unknownCount: 0, beverageTotalMl: 0, plainWaterMl: 0 };
      day.beverageTotalMl = round3(day.beverageTotalMl + row.amount_ml);
      if (row.is_plain_water_snapshot) day.plainWaterMl = round3(day.plainWaterMl + row.amount_ml);
      dailyMap.set(row.entry_date, day);
    }
    const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)).map((row) => ({ ...row, coverage: row.unknownCount ? "partial" : "complete" }));
    const comparisons = measurements.map((measurement: any) => ({
      measurement,
      windows: [1, 3, 7].map((days) => ({ days, ...this.windowSummary(addDays(measurement.date, -days), addDays(measurement.date, -1)) })),
    }));
    return {
      from,
      to,
      settings: this.settings(),
      measurements,
      urateStats: { count: values.length, min: values.length ? Math.min(...values) : null, median: median(values), max: values.length ? Math.max(...values) : null, latest: measurements.at(-1) || null, previous: measurements.at(-2) || null },
      daily,
      recordedDays: daily.filter((row) => row.dietEntries > 0 || row.beverageTotalMl > 0).length,
      totalDays: Math.max(1, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1),
      comparisons,
    };
  }

  windowSummary(from: string, to: string) {
    const rows = this.db.prepare("SELECT contribution_low, contribution_high FROM diet_entries WHERE entry_date BETWEEN ? AND ? AND deleted_at IS NULL").all(from, to);
    const beverages = this.db.prepare("SELECT amount_ml, is_plain_water_snapshot FROM beverage_entries WHERE entry_date BETWEEN ? AND ? AND deleted_at IS NULL").all(from, to);
    const summary = summarizeKnownEntries(rows.map((row: any) => ({ low: row.contribution_low, high: row.contribution_high })));
    return { ...summary, beverageTotalMl: round3(beverages.reduce((sum: number, row: any) => sum + row.amount_ml, 0)), plainWaterMl: round3(beverages.filter((row: any) => row.is_plain_water_snapshot).reduce((sum: number, row: any) => sum + row.amount_ml, 0)), recordedDays: new Set([...rows.map((row: any) => row.entry_date), ...beverages.map((row: any) => row.entry_date)]).size };
  }

  createFood(payload: any) {
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("食物名称不能为空");
    const low = asNullableNumber(payload.purineLow);
    const high = asNullableNumber(payload.purineHigh);
    const mean = asNullableNumber(payload.purineMean);
    if (low !== null && high !== null && low > high) throw new Error("嘌呤下限不能大于上限");
    if (mean !== null && ((low !== null && mean < low) || (high !== null && mean > high))) throw new Error("嘌呤均值必须位于范围内");
    const id = uuid();
    const versionId = uuid();
    const at = timestamp();
    const transaction = this.db.transaction(() => {
      this.db.prepare("INSERT INTO foods (id, name, aliases, group_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, name, String(payload.aliases || ""), payload.groupId || null, String(payload.state || "可食部"), at, at);
      this.db.prepare("INSERT INTO food_versions (id, food_id, version_no, basis_g, purine_low, purine_mean, purine_high, range_type, source_id, verification_status, sample_note, notes, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(versionId, id, Number(payload.basisG || 100), low, mean, high, payload.rangeType || (low === high && low !== null ? "single_point" : "user_estimate"), payload.sourceId || (low !== null || high !== null ? "source-user-estimate" : null), payload.verificationStatus || "PREPARED", payload.sampleNote || null, payload.notes || null, at);
    });
    transaction();
    return this.bootstrap(String(name)).foods.find((food: any) => food.id === id);
  }

  updateFood(id: string, payload: any) {
    const current = this.db.prepare("SELECT * FROM foods WHERE id = ?").get(id);
    if (!current) throw new Error("食物不存在");
    const latest = this.db.prepare("SELECT * FROM food_versions WHERE food_id = ? ORDER BY version_no DESC LIMIT 1").get(id);
    const low = payload.purineLow === undefined ? latest.purine_low : asNullableNumber(payload.purineLow);
    const high = payload.purineHigh === undefined ? latest.purine_high : asNullableNumber(payload.purineHigh);
    const mean = payload.purineMean === undefined ? latest.purine_mean : asNullableNumber(payload.purineMean);
    if (low !== null && high !== null && low > high) throw new Error("嘌呤下限不能大于上限");
    const at = timestamp();
    const versionNo = latest.version_no + 1;
    const versionId = uuid();
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE foods SET name = ?, aliases = ?, group_id = ?, state = ?, archived_at = ?, updated_at = ? WHERE id = ?").run(String(payload.name ?? current.name), String(payload.aliases ?? current.aliases), payload.groupId === undefined ? current.group_id : payload.groupId || null, String(payload.state ?? current.state), payload.archived ? at : null, at, id);
      this.db.prepare("INSERT INTO food_versions (id, food_id, version_no, basis_g, purine_low, purine_mean, purine_high, range_type, source_id, verification_status, sample_note, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(versionId, id, versionNo, Number(payload.basisG ?? latest.basis_g), low, mean, high, payload.rangeType || latest.range_type, payload.sourceId ?? latest.source_id ?? ((low !== null || high !== null) ? "source-user-estimate" : null), payload.verificationStatus || "PREPARED", payload.sampleNote ?? latest.sample_note, payload.notes ?? latest.notes, at);
    });
    transaction();
    return this.bootstrap(String(payload.name ?? current.name)).foods.find((food: any) => food.id === id);
  }

  createRecipe(payload: any) {
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("菜谱名称不能为空");
    const mode = payload.mode === "manual" ? "manual" : "ingredients";
    const ingredients = Array.isArray(payload.ingredients) ? payload.ingredients : [];
    let calculation: any = null;
    if (mode === "ingredients") {
      const resolved = ingredients.map((item) => {
        const food = this.db.prepare("SELECT fv.*, f.name FROM food_versions fv JOIN foods f ON f.id = fv.food_id WHERE fv.id = ?").get(String(item.foodVersionId));
        if (!food) throw new Error("菜谱包含不存在的食物版本");
        return { grams: item.grams, basisG: food.basis_g, low: food.purine_low, high: food.purine_high };
      });
      calculation = calculateRecipeFromIngredients(resolved, payload.finalYieldG ? Number(payload.finalYieldG) : null);
    } else {
      const low = asNullableNumber(payload.purineLow);
      const high = asNullableNumber(payload.purineHigh);
      if (low === null || high === null || low > high) throw new Error("手工范围需要有效的下限和上限");
      calculation = { totalLow: payload.finalYieldG ? round3((low / 100) * Number(payload.finalYieldG)) : null, totalHigh: payload.finalYieldG ? round3((high / 100) * Number(payload.finalYieldG)) : null, lowPer100g: low, highPer100g: high, unknownCount: 0 };
    }
    const id = uuid();
    const versionId = uuid();
    const at = timestamp();
    const transaction = this.db.transaction(() => {
      this.db.prepare("INSERT INTO recipes (id, name, aliases, group_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, name, String(payload.aliases || ""), payload.groupId || null, at, at);
      this.db.prepare("INSERT INTO recipe_versions (id, recipe_id, version_no, mode, final_yield_g, total_low, total_high, purine_low, purine_high, source_id, verification_status, notes, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(versionId, id, mode, payload.finalYieldG ? Number(payload.finalYieldG) : null, calculation.totalLow, calculation.totalHigh, calculation.lowPer100g, calculation.highPer100g, payload.sourceId || "source-user-estimate", payload.verificationStatus || "PREPARED", payload.notes || (mode === "manual" ? "手工估计；不与配料计算结果混淆。" : null), at);
      const insertIngredient = this.db.prepare("INSERT INTO recipe_ingredients (id, recipe_version_id, food_version_id, grams) VALUES (?, ?, ?, ?)");
      if (mode === "ingredients") for (const item of ingredients) insertIngredient.run(uuid(), versionId, String(item.foodVersionId), finitePositive(item.grams, "配料克数"));
    });
    transaction();
    return this.bootstrap(name).recipes.find((recipe: any) => recipe.id === id);
  }

  updateRecipe(id: string, payload: any) {
    const current = this.db.prepare("SELECT * FROM recipes WHERE id = ?").get(id);
    if (!current) throw new Error("菜谱不存在");
    const latest = this.db.prepare("SELECT * FROM recipe_versions WHERE recipe_id = ? ORDER BY version_no DESC LIMIT 1").get(id);
    const merged = { ...payload, name: payload.name ?? current.name, groupId: payload.groupId === undefined ? current.group_id : payload.groupId, mode: payload.mode ?? latest.mode, finalYieldG: payload.finalYieldG ?? latest.final_yield_g, purineLow: payload.purineLow ?? latest.purine_low, purineHigh: payload.purineHigh ?? latest.purine_high, ingredients: payload.ingredients ?? this.db.prepare("SELECT food_version_id AS foodVersionId, grams FROM recipe_ingredients WHERE recipe_version_id = ?").all(latest.id) };
    const mode = merged.mode === "manual" ? "manual" : "ingredients";
    let calculation: any;
    if (mode === "ingredients") {
      const resolved = merged.ingredients.map((item) => {
        const food = this.db.prepare("SELECT fv.* FROM food_versions fv WHERE fv.id = ?").get(String(item.foodVersionId));
        if (!food) throw new Error("菜谱包含不存在的食物版本");
        return { grams: item.grams, basisG: food.basis_g, low: food.purine_low, high: food.purine_high };
      });
      calculation = calculateRecipeFromIngredients(resolved, merged.finalYieldG ? Number(merged.finalYieldG) : null);
    } else {
      const low = asNullableNumber(merged.purineLow); const high = asNullableNumber(merged.purineHigh);
      if (low === null || high === null || low > high) throw new Error("手工范围需要有效的下限和上限");
      calculation = { totalLow: merged.finalYieldG ? round3((low / 100) * Number(merged.finalYieldG)) : null, totalHigh: merged.finalYieldG ? round3((high / 100) * Number(merged.finalYieldG)) : null, lowPer100g: low, highPer100g: high, unknownCount: 0 };
    }
    const versionId = uuid(); const at = timestamp(); const versionNo = latest.version_no + 1;
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE recipes SET name = ?, aliases = ?, group_id = ?, archived_at = ?, updated_at = ? WHERE id = ?").run(merged.name, String(merged.aliases ?? current.aliases), merged.groupId || null, merged.archived ? at : null, at, id);
      this.db.prepare("INSERT INTO recipe_versions (id, recipe_id, version_no, mode, final_yield_g, total_low, total_high, purine_low, purine_high, source_id, verification_status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(versionId, id, versionNo, mode, merged.finalYieldG ? Number(merged.finalYieldG) : null, calculation.totalLow, calculation.totalHigh, calculation.lowPer100g, calculation.highPer100g, merged.sourceId ?? latest.source_id ?? "source-user-estimate", merged.verificationStatus || "PREPARED", merged.notes ?? latest.notes, at);
      const insertIngredient = this.db.prepare("INSERT INTO recipe_ingredients (id, recipe_version_id, food_version_id, grams) VALUES (?, ?, ?, ?)");
      if (mode === "ingredients") for (const item of merged.ingredients) insertIngredient.run(uuid(), versionId, String(item.foodVersionId), finitePositive(item.grams, "配料克数"));
    });
    transaction();
    return this.bootstrap(String(merged.name)).recipes.find((recipe: any) => recipe.id === id);
  }

  createBeverage(payload: any) {
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("饮品名称不能为空");
    const id = uuid(); const at = timestamp();
    this.db.prepare("INSERT INTO beverages (id, name, aliases, group_id, is_plain_water, contains_sugar, system, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)").run(id, name, String(payload.aliases || ""), payload.groupId || null, payload.isPlainWater ? 1 : 0, payload.containsSugar ? 1 : 0, payload.notes || null, at, at);
    return this.bootstrap(name).beverages.find((beverage: any) => beverage.id === id);
  }

  updateBeverage(id: string, payload: any) {
    const current = this.db.prepare("SELECT * FROM beverages WHERE id = ?").get(id);
    if (!current) throw new Error("饮品不存在");
    const at = timestamp();
    this.db.prepare("UPDATE beverages SET name = ?, aliases = ?, group_id = ?, is_plain_water = ?, contains_sugar = ?, archived_at = ?, notes = ?, updated_at = ? WHERE id = ?").run(String(payload.name ?? current.name), String(payload.aliases ?? current.aliases), payload.groupId === undefined ? current.group_id : payload.groupId || null, payload.isPlainWater === undefined ? current.is_plain_water : payload.isPlainWater ? 1 : 0, payload.containsSugar === undefined ? current.contains_sugar : payload.containsSugar ? 1 : 0, payload.archived ? at : null, payload.notes ?? current.notes, at, id);
    return this.bootstrap(String(payload.name ?? current.name)).beverages.find((beverage: any) => beverage.id === id);
  }

  createGroup(kind: string, payload: any) {
    const table = kind === "recipe" ? "recipe_groups" : kind === "beverage" ? "beverage_groups" : "food_groups";
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("分组名称不能为空");
    const at = timestamp(); const id = uuid();
    this.db.prepare(`INSERT INTO ${table} (id, name, sort_order, system, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`).run(id, name, Number(payload.sortOrder || 99), at, at);
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  }

  renameGroup(kind: string, id: string, payload: any) {
    const table = kind === "recipe" ? "recipe_groups" : kind === "beverage" ? "beverage_groups" : "food_groups";
    const current = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!current) throw new Error("分组不存在");
    this.db.prepare(`UPDATE ${table} SET name = ?, sort_order = ?, updated_at = ? WHERE id = ?`).run(String(payload.name ?? current.name), Number(payload.sortOrder ?? current.sort_order), timestamp(), id);
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  }

  deleteGroup(kind: string, id: string) {
    const table = kind === "recipe" ? "recipe_groups" : kind === "beverage" ? "beverage_groups" : "food_groups";
    const current = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!current) throw new Error("分组不存在");
    const childTable = kind === "recipe" ? "recipes" : kind === "beverage" ? "beverages" : "foods";
    this.db.transaction(() => {
      this.db.prepare(`UPDATE ${childTable} SET group_id = NULL, updated_at = ? WHERE group_id = ?`).run(timestamp(), id);
      this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    })();
  }

  updatePortions(payload: any) {
    if (!Array.isArray(payload.portions)) throw new Error("份量模板格式不正确");
    const at = timestamp();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM portion_presets").run();
      const insert = this.db.prepare("INSERT INTO portion_presets (id, kind, value, unit, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
      payload.portions.forEach((item, index) => {
        const kind = ["food", "recipe", "beverage"].includes(item.kind) ? item.kind : "food";
        const unit = kind === "beverage" ? "mL" : "g";
        insert.run(uuid(), kind, finitePositive(item.value, "模板数值"), unit, index, at, at);
      });
    })();
    return this.db.prepare("SELECT * FROM portion_presets ORDER BY kind, sort_order").all();
  }

  updateSettings(payload: any) {
    const current = this.settings();
    const unit = payload.defaultUrateUnit === "mg/dL" ? "mg/dL" : payload.defaultUrateUnit === "umol/L" ? "umol/L" : current.defaultUrateUnit;
    const goal = payload.waterGoalMl === null || payload.waterGoalMl === "" ? null : Math.round(finitePositive(payload.waterGoalMl, "饮水目标"));
    this.db.prepare("UPDATE app_settings SET default_urate_unit = ?, water_goal_ml = ?, updated_at = ? WHERE id = 1").run(unit, goal, timestamp());
    return this.settings();
  }

  deletePersonalData() {
    const deletedAt = timestamp();
    let counts = { dietEntries: 0, beverageEntries: 0, measurements: 0 };
    const run = this.db.transaction(() => {
      counts.dietEntries = this.db.prepare("DELETE FROM diet_entries").run().changes;
      counts.beverageEntries = this.db.prepare("DELETE FROM beverage_entries").run().changes;
      counts.measurements = this.db.prepare("DELETE FROM urate_measurements").run().changes;
    });
    run();
    return { deletedAt, counts };
  }

  exportData() {
    return {
      format: "uric-acid-export",
      formatVersion: "1",
      appVersion: "0.1.0",
      schemaVersion: this.db.prepare("SELECT version FROM schema_meta LIMIT 1").get().version,
      exportedAt: timestamp(),
      timezone: this.settings().timezone,
      data: cloneData(this.db),
    };
  }

  restoreData(payload: any) {
    const data = payload.data;
    replaceData(this.db, data);
    const settings = data.app_settings?.[0];
    if (settings) this.db.prepare("UPDATE app_settings SET timezone = ?, default_urate_unit = ?, water_goal_ml = ?, updated_at = ? WHERE id = 1").run(settings.timezone || "Asia/Shanghai", settings.default_urate_unit || "umol/L", settings.water_goal_ml ?? null, timestamp());
    this.db.prepare("DELETE FROM trusted_device_sessions").run();
    this.db.prepare("UPDATE app_settings SET session_generation = session_generation + 1, updated_at = ? WHERE id = 1").run(timestamp());
  }
}
