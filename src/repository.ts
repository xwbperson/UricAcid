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
const TREATMENT_EVENT_TYPES = new Set(["flare", "hospital_check", "oral_medication", "topical_medication", "symptom_change", "follow_up", "other"]);
const TREATMENT_EVENT_LABELS: Record<string, string> = {
  flare: "痛风发作",
  hospital_check: "医院检查",
  oral_medication: "口服药",
  topical_medication: "外用药",
  symptom_change: "症状变化",
  follow_up: "复诊计划",
  other: "其他",
};
const TREATMENT_TEXT_FIELDS: Array<[string, string]> = [
  ["title", "title"],
  ["notes", "notes"],
  ["symptomSite", "symptom_site"],
  ["symptomState", "symptom_state"],
  ["symptomDescription", "symptom_description"],
  ["medicineName", "medicine_name"],
  ["dosage", "dosage"],
  ["dosageUnit", "dosage_unit"],
  ["frequency", "frequency"],
  ["applicationSite", "application_site"],
  ["instructions", "instructions"],
  ["facility", "facility"],
  ["department", "department"],
  ["clinician", "clinician"],
  ["testName", "test_name"],
  ["reportConclusion", "report_conclusion"],
  ["planItem", "plan_item"],
  ["otherName", "other_name"],
  ["otherDescription", "other_description"],
];

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

function optionalText(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function optionalDate(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const date = String(value);
  if (!isValidIsoDate(date)) throw new Error(`${label}格式必须为 YYYY-MM-DD`);
  return date;
}

function optionalTime(value: unknown) {
  const time = optionalText(value);
  if (time === null) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("事件时间格式必须为 HH:mm");
  return time;
}

function optionalSeverity(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const severity = Number(value);
  if (!Number.isFinite(severity) || severity < 0 || severity > 10) throw new Error("严重程度必须在 0 到 10 之间");
  return Math.round(severity * 10) / 10;
}

function optionalFinite(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) throw new Error(`${label}必须是有效数字`);
  return numberValue;
}

function requireTreatmentType(value: unknown) {
  const eventType = String(value || "");
  if (!TREATMENT_EVENT_TYPES.has(eventType)) throw new Error("治疗记录类型无效");
  return eventType;
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
    const treatmentEvents = this.listTreatmentEvents(date, date);
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
      treatmentEvents,
      treatmentEventCount: treatmentEvents.length,
      latestMeasurement: latestMeasurement ? this.measurementPublic(latestMeasurement) : null,
      guidance: this.guidanceForDay(dietRows, beverage, latestMeasurement ? this.measurementPublic(latestMeasurement) : null),
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

  guidanceForDay(dietRows: any[], beverage: { totalMl: number; plainWaterMl: number; otherMl: number }, latestMeasurement: any) {
    const settings = this.settings();
    const vegetableGrams = round3(dietRows.reduce((sum, row) => sum + (row.kind === "food" && row.group_name_snapshot === "蔬菜" ? row.quantity_g : 0), 0));
    const vegetableReferenceG = 500;
    const waterMinimumMl = 2000;
    const waterReferenceMl = settings.waterGoalMl || waterMinimumMl;
    const vegetableNearG = Math.round(vegetableReferenceG * 0.8);
    const waterNearMl = Math.round(waterReferenceMl * 0.8);
    const alerts: Array<{ kind: string; level: string; message: string }> = [];
    if (vegetableGrams >= vegetableNearG && vegetableGrams < vegetableReferenceG) {
      alerts.push({ kind: "vegetable", level: "near", message: `已直接记录约 ${vegetableGrams}g 蔬菜，接近一般参考量 ${vegetableReferenceG}g/日。` });
    }
    if (beverage.totalMl >= waterNearMl && beverage.totalMl < waterReferenceMl) {
      alerts.push({ kind: "water", level: "near", message: `今日饮品总量 ${beverage.totalMl}mL，接近${settings.waterGoalMl ? "你设置的" : "一般资料中的"} ${waterReferenceMl}mL/日参考线，还差 ${round3(waterReferenceMl - beverage.totalMl)}mL。` });
    }
    if (latestMeasurement && latestMeasurement.valueUmolL >= 420) {
      alerts.push({ kind: "urate", level: "review", message: `最近一次血尿酸实测为 ${latestMeasurement.valueUmolL}μmol/L，建议结合检验报告和专业人员复核。` });
    }
    return {
      sources: ["source-wst-560-2017", "source-nhc-2024-food-guide", "source-acr-2020-gout-guideline"],
      latestMeasurement,
      urate: {
        maleUpperUmolL: 420,
        femaleUpperUmolL: 360,
        goutTreatmentTargetUmolL: 360,
        note: "WS/T 560 的定义要求通常饮食状态下非同日两次空腹测量；单次实测不能单独完成诊断，也不能替代医生确定治疗目标。",
      },
      dietary: {
        vegetable: {
          loggedG: vegetableGrams,
          referenceG: vegetableReferenceG,
          nearG: vegetableNearG,
          status: vegetableGrams >= vegetableReferenceG ? "met" : vegetableGrams >= vegetableNearG ? "near" : vegetableGrams ? "in_progress" : "empty",
        },
        water: {
          loggedMl: beverage.totalMl,
          referenceMl: waterReferenceMl,
          generalMinimumMl: waterMinimumMl,
          nearMl: waterNearMl,
          isCustom: Boolean(settings.waterGoalMl),
          status: beverage.totalMl >= waterReferenceMl ? "met" : beverage.totalMl >= waterNearMl ? "near" : beverage.totalMl ? "in_progress" : "empty",
        },
        note: "蔬菜与饮水是来源性一般食养参考，不是个人医疗目标；心肾功能异常或需要限液时按医生/营养专业人员意见。",
      },
      alerts,
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

  treatmentResultPublic(row: any) {
    return {
      id: row.id,
      testName: row.test_name,
      resultText: row.result_text,
      numericValue: row.numeric_value,
      unit: row.unit,
      referenceRange: row.reference_range,
      note: row.note,
      sortOrder: row.sort_order,
    };
  }

  treatmentEventPublic(row: any, results: any[] = []) {
    return {
      id: row.id,
      clientId: row.client_id,
      eventDate: row.event_date,
      eventTime: row.event_time,
      eventType: row.event_type,
      eventTypeLabel: TREATMENT_EVENT_LABELS[row.event_type] || row.event_type,
      title: row.title || TREATMENT_EVENT_LABELS[row.event_type] || row.event_type,
      notes: row.notes,
      symptomSite: row.symptom_site,
      severity: row.severity,
      symptomState: row.symptom_state,
      symptomDescription: row.symptom_description,
      medicineName: row.medicine_name,
      dosage: row.dosage,
      dosageUnit: row.dosage_unit,
      frequency: row.frequency,
      startDate: row.start_date,
      endDate: row.end_date,
      applicationSite: row.application_site,
      instructions: row.instructions,
      facility: row.facility,
      department: row.department,
      clinician: row.clinician,
      testName: row.test_name,
      reportConclusion: row.report_conclusion,
      followUpDate: row.follow_up_date,
      planItem: row.plan_item,
      otherName: row.other_name,
      otherDescription: row.other_description,
      results,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listTreatmentEvents(fromInput: unknown = null, toInput: unknown = null, typeInput: unknown = null, queryInput: unknown = null) {
    const clauses = ["e.deleted_at IS NULL"];
    const params: any[] = [];
    const from = fromInput ? requireDate(fromInput) : null;
    const to = toInput ? requireDate(toInput) : null;
    if (from && to && from > to) throw new Error("治疗记录起始日期不能晚于结束日期");
    if (from) { clauses.push("e.event_date >= ?"); params.push(from); }
    if (to) { clauses.push("e.event_date <= ?"); params.push(to); }
    const eventType = typeInput ? requireTreatmentType(typeInput) : null;
    if (eventType) { clauses.push("e.event_type = ?"); params.push(eventType); }
    const query = optionalText(queryInput);
    if (query) {
      const pattern = `%${query}%`;
      clauses.push(`(
        COALESCE(e.title, '') LIKE ? OR COALESCE(e.notes, '') LIKE ? OR COALESCE(e.symptom_site, '') LIKE ? OR
        COALESCE(e.symptom_state, '') LIKE ? OR COALESCE(e.symptom_description, '') LIKE ? OR COALESCE(e.medicine_name, '') LIKE ? OR
        COALESCE(e.dosage, '') LIKE ? OR COALESCE(e.dosage_unit, '') LIKE ? OR COALESCE(e.frequency, '') LIKE ? OR
        COALESCE(e.application_site, '') LIKE ? OR COALESCE(e.instructions, '') LIKE ? OR COALESCE(e.facility, '') LIKE ? OR
        COALESCE(e.department, '') LIKE ? OR COALESCE(e.clinician, '') LIKE ? OR COALESCE(e.test_name, '') LIKE ? OR
        COALESCE(e.report_conclusion, '') LIKE ? OR COALESCE(e.follow_up_date, '') LIKE ? OR COALESCE(e.plan_item, '') LIKE ? OR
        COALESCE(e.other_name, '') LIKE ? OR COALESCE(e.other_description, '') LIKE ? OR
        EXISTS (SELECT 1 FROM treatment_event_results tr WHERE tr.event_id = e.id AND (COALESCE(tr.test_name, '') LIKE ? OR COALESCE(tr.result_text, '') LIKE ? OR COALESCE(tr.note, '') LIKE ?))
      )`);
      params.push(...Array.from({ length: 23 }, () => pattern));
    }
    const rows = this.db.prepare(`
      SELECT e.* FROM treatment_events e
      WHERE ${clauses.join(" AND ")}
      ORDER BY e.event_date DESC, CASE WHEN e.event_time IS NULL OR e.event_time = '' THEN 1 ELSE 0 END ASC, e.event_time DESC, e.created_at DESC
    `).all(...params);
    const resultRows = this.db.prepare("SELECT * FROM treatment_event_results WHERE event_id = ? ORDER BY sort_order, created_at");
    return rows.map((row: any) => this.treatmentEventPublic(row, resultRows.all(row.id).map((result: any) => this.treatmentResultPublic(result))));
  }

  getTreatmentEvent(id: string, includeDeleted = false) {
    const row = this.db.prepare(`SELECT * FROM treatment_events WHERE id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`).get(id);
    if (!row) return null;
    const results = this.db.prepare("SELECT * FROM treatment_event_results WHERE event_id = ? ORDER BY sort_order, created_at").all(id).map((result: any) => this.treatmentResultPublic(result));
    return this.treatmentEventPublic(row, results);
  }

  normalizeTreatmentResults(value: unknown) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error("检查结果格式无效");
    return value.map((row: any, index: number) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("检查结果格式无效");
      const resultText = optionalText(row.resultText);
      const testName = optionalText(row.testName);
      const numericValue = optionalFinite(row.numericValue, "检查结果数值");
      const unit = optionalText(row.unit);
      const referenceRange = optionalText(row.referenceRange);
      const note = optionalText(row.note);
      if (!testName && !resultText && numericValue === null && !unit && !referenceRange && !note) return null;
      return { testName, resultText, numericValue, unit, referenceRange, note, sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index };
    }).filter(Boolean);
  }

  treatmentFields(payload: any, current: any = null) {
    const textValue = (key: string, dbKey: string) => payload[key] === undefined ? (current?.[dbKey] ?? null) : optionalText(payload[key]);
    const dateValue = (key: string, dbKey: string, label: string) => payload[key] === undefined ? (current?.[dbKey] ?? null) : optionalDate(payload[key], label);
    const eventType = payload.eventType === undefined ? current?.event_type : requireTreatmentType(payload.eventType);
    if (!eventType) throw new Error("治疗记录类型不能为空");
    const eventDate = payload.eventDate === undefined ? current?.event_date : requireDate(payload.eventDate);
    if (!eventDate) throw new Error("治疗记录日期不能为空");
    const eventTime = payload.eventTime === undefined ? (current?.event_time ?? null) : optionalTime(payload.eventTime);
    const severity = payload.severity === undefined ? (current?.severity ?? null) : optionalSeverity(payload.severity);
    const fields: Record<string, any> = { eventDate, eventTime, eventType, severity };
    for (const [key, dbKey] of TREATMENT_TEXT_FIELDS) fields[dbKey] = textValue(key, dbKey);
    fields.start_date = dateValue("startDate", "start_date", "开始日期");
    fields.end_date = dateValue("endDate", "end_date", "结束日期");
    fields.follow_up_date = dateValue("followUpDate", "follow_up_date", "复诊日期");
    if (fields.start_date && fields.end_date && fields.start_date > fields.end_date) throw new Error("开始日期不能晚于结束日期");
    if (current && current.event_type !== eventType) {
      const allowed = new Set(["title", "notes"]);
      const allow = (types: string[], keys: string[]) => { if (types.includes(eventType)) keys.forEach((key) => allowed.add(key)); };
      allow(["flare"], ["symptom_site"]);
      allow(["flare", "symptom_change"], ["symptom_state", "symptom_description"]);
      allow(["oral_medication", "topical_medication"], ["medicine_name", "dosage", "dosage_unit", "frequency", "instructions", "start_date", "end_date"]);
      allow(["topical_medication"], ["application_site"]);
      allow(["hospital_check", "follow_up"], ["facility", "department"]);
      allow(["hospital_check"], ["clinician", "test_name", "report_conclusion", "follow_up_date"]);
      allow(["follow_up"], ["plan_item", "follow_up_date"]);
      allow(["other"], ["other_name", "other_description"]);
      if (!["flare", "symptom_change"].includes(eventType)) fields.severity = null;
      for (const [, dbKey] of TREATMENT_TEXT_FIELDS) if (!allowed.has(dbKey)) fields[dbKey] = null;
      if (!["oral_medication", "topical_medication"].includes(eventType)) {
        fields.start_date = null;
        fields.end_date = null;
      }
      if (!["hospital_check", "follow_up"].includes(eventType)) fields.follow_up_date = null;
    }
    return fields;
  }

  saveTreatmentResults(eventId: string, results: any[], at: string) {
    this.db.prepare("DELETE FROM treatment_event_results WHERE event_id = ?").run(eventId);
    const insert = this.db.prepare("INSERT INTO treatment_event_results (id, event_id, test_name, result_text, numeric_value, unit, reference_range, note, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    results.forEach((result: any, index: number) => insert.run(uuid(), eventId, result.testName, result.resultText, result.numericValue, result.unit, result.referenceRange, result.note, result.sortOrder ?? index, at, at));
  }

  createTreatmentEvent(payload: any) {
    const clientId = String(payload.clientId || uuid());
    const existing = this.db.prepare("SELECT * FROM treatment_events WHERE client_id = ?").get(clientId);
    if (existing) return this.getTreatmentEvent(existing.id, true);
    const fields = this.treatmentFields(payload);
    const settings = this.settings();
    if (fields.eventDate > todayInTimezone(settings.timezone) && fields.eventType !== "follow_up" && payload.allowFuture !== true) throw new Error("不能无提示地保存未来治疗记录；确认它确实是计划外记录后再保存");
    const results = this.normalizeTreatmentResults(payload.results);
    if (results.length && fields.eventType !== "hospital_check") throw new Error("只有医院检查记录可以填写检查结果");
    const id = uuid();
    const at = timestamp();
    const values = [id, clientId, fields.eventDate, fields.eventTime, fields.eventType, ...Object.keys(fields).filter((key) => !["eventDate", "eventTime", "eventType"].includes(key)).map((key) => fields[key]), at, at];
    const dbColumns = ["id", "client_id", "event_date", "event_time", "event_type", ...Object.keys(fields).filter((key) => !["eventDate", "eventTime", "eventType"].includes(key)), "created_at", "updated_at"];
    const run = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO treatment_events (${dbColumns.join(", ")}) VALUES (${dbColumns.map(() => "?").join(", ")})`).run(...values);
      this.saveTreatmentResults(id, results, at);
    });
    run();
    return this.getTreatmentEvent(id);
  }

  updateTreatmentEvent(id: string, payload: any) {
    const current = this.db.prepare("SELECT * FROM treatment_events WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!current) throw new Error("治疗记录不存在");
    const fields = this.treatmentFields(payload, current);
    const settings = this.settings();
    if (fields.eventDate > todayInTimezone(settings.timezone) && fields.eventType !== "follow_up" && payload.allowFuture !== true) throw new Error("不能无提示地保存未来治疗记录；确认它确实是计划外记录后再保存");
    const typeChanged = current.event_type !== fields.eventType;
    const results = payload.results === undefined && !typeChanged
      ? this.db.prepare("SELECT test_name AS testName, result_text AS resultText, numeric_value AS numericValue, unit, reference_range AS referenceRange, note, sort_order AS sortOrder FROM treatment_event_results WHERE event_id = ? ORDER BY sort_order, created_at").all(id)
      : this.normalizeTreatmentResults(payload.results);
    if (results.length && fields.eventType !== "hospital_check") throw new Error("只有医院检查记录可以填写检查结果");
    const at = timestamp();
    const dbFields = { ...fields };
    delete dbFields.eventDate; delete dbFields.eventTime; delete dbFields.eventType;
    const assignments = ["event_date = ?", "event_time = ?", "event_type = ?", ...Object.keys(dbFields).map((key) => `${key} = ?`), "updated_at = ?"];
    const values = [fields.eventDate, fields.eventTime, fields.eventType, ...Object.keys(dbFields).map((key) => dbFields[key]), at, id];
    const run = this.db.transaction(() => {
      this.db.prepare(`UPDATE treatment_events SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
      this.saveTreatmentResults(id, results, at);
    });
    run();
    return this.getTreatmentEvent(id);
  }

  deleteTreatmentEvent(id: string) {
    const result = this.db.prepare("UPDATE treatment_events SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(timestamp(), timestamp(), id);
    if (!result.changes) throw new Error("治疗记录不存在");
  }

  history(fromInput: unknown, toInput: unknown) {
    const from = requireDate(fromInput || addDays(todayInTimezone(this.settings().timezone), -29));
    const to = requireDate(toInput || todayInTimezone(this.settings().timezone));
    const dates = this.db.prepare(`SELECT entry_date AS date FROM diet_entries WHERE entry_date BETWEEN ? AND ? AND deleted_at IS NULL UNION SELECT entry_date FROM beverage_entries WHERE entry_date BETWEEN ? AND ? AND deleted_at IS NULL UNION SELECT measured_date FROM urate_measurements WHERE measured_date BETWEEN ? AND ? AND deleted_at IS NULL UNION SELECT event_date FROM treatment_events WHERE event_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date DESC`).all(from, to, from, to, from, to, from, to);
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

  archiveFood(id: string) {
    const current = this.db.prepare("SELECT id, archived_at FROM foods WHERE id = ?").get(id);
    if (!current || current.archived_at) throw new Error("食物不存在或已归档");
    const at = timestamp();
    this.db.prepare("UPDATE foods SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL").run(at, at, id);
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

  archiveRecipe(id: string) {
    const current = this.db.prepare("SELECT id, archived_at FROM recipes WHERE id = ?").get(id);
    if (!current || current.archived_at) throw new Error("菜谱不存在或已归档");
    const at = timestamp();
    this.db.prepare("UPDATE recipes SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL").run(at, at, id);
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

  archiveBeverage(id: string) {
    const current = this.db.prepare("SELECT id, system, archived_at FROM beverages WHERE id = ?").get(id);
    if (!current || current.archived_at) throw new Error("饮品不存在或已归档");
    if (current.system) throw new Error("系统预置饮品不能删除");
    const at = timestamp();
    this.db.prepare("UPDATE beverages SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL").run(at, at, id);
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
    if (current.system) throw new Error("系统预置分组不能修改");
    this.db.prepare(`UPDATE ${table} SET name = ?, sort_order = ?, updated_at = ? WHERE id = ?`).run(String(payload.name ?? current.name), Number(payload.sortOrder ?? current.sort_order), timestamp(), id);
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  }

  deleteGroup(kind: string, id: string) {
    const table = kind === "recipe" ? "recipe_groups" : kind === "beverage" ? "beverage_groups" : "food_groups";
    const current = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!current) throw new Error("分组不存在");
    if (current.system) throw new Error("系统预置分组不能删除");
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
    let counts = { dietEntries: 0, beverageEntries: 0, measurements: 0, treatmentEvents: 0, treatmentResults: 0 };
    const run = this.db.transaction(() => {
      counts.dietEntries = this.db.prepare("DELETE FROM diet_entries").run().changes;
      counts.beverageEntries = this.db.prepare("DELETE FROM beverage_entries").run().changes;
      counts.measurements = this.db.prepare("DELETE FROM urate_measurements").run().changes;
      counts.treatmentResults = this.db.prepare("DELETE FROM treatment_event_results").run().changes;
      counts.treatmentEvents = this.db.prepare("DELETE FROM treatment_events").run().changes;
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
