import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const vendorGroups = loadTs("src/lib/vendor-groups.ts");
const conditions = loadTs("src/lib/conditions.ts");
const sku = loadTs("src/lib/sku.ts");
const dashboard = loadTs("src/lib/dashboard.ts");
const roles = loadTs("src/lib/roles.ts");
const navConfig = loadTs("src/components/nav-config.ts");
const projectMeta = loadTs("src/lib/project-meta.ts");
const timelines = loadTs("src/lib/timelines.ts");

describe("vendor-groups", () => {
  it("maps Travel Agency to HOTELS and never misclassifies it as IT/AV", () => {
    assert.equal(vendorGroups.vendorGroupForCategory("Travel Agency"), "HOTELS");
    assert.equal(vendorGroups.vendorGroupForCategory("  travel agency "), "HOTELS");
    assert.equal(vendorGroups.vendorGroupForCategory("Courier Services"), "HOTELS");
    assert.equal(vendorGroups.vendorGroupForCategory("Corporate Travel"), "HOTELS");
  });

  it("maps IT Services, IT, Photography, and AV categories to IT", () => {
    assert.equal(vendorGroups.vendorGroupForCategory("IT"), "IT");
    assert.equal(vendorGroups.vendorGroupForCategory("IT Services"), "IT");
    assert.equal(vendorGroups.vendorGroupForCategory("Photography"), "IT");
    assert.equal(vendorGroups.vendorGroupForCategory("Audio Visual"), "IT");
    assert.equal(vendorGroups.vendorGroupForCategory("AV Equipment"), "IT");
  });

  it("maps catering, printing, facilities, and fallback utilities accurately", () => {
    assert.equal(vendorGroups.vendorGroupForCategory("Caterers"), "CATERING");
    assert.equal(vendorGroups.vendorGroupForCategory("Local Bakery"), "CATERING");
    assert.equal(vendorGroups.vendorGroupForCategory("Stationery"), "PRINTING");
    assert.equal(vendorGroups.vendorGroupForCategory("Facilities Mgmt"), "FACILITIES");
    assert.equal(vendorGroups.vendorGroupForCategory("Automotive Repairs"), "FACILITIES");
    assert.equal(vendorGroups.vendorGroupForCategory("Utilities"), "UTILITIES");
    assert.equal(vendorGroups.vendorGroupForCategory(null), "UTILITIES");
    assert.equal(vendorGroups.vendorGroupForCategory("   "), "UTILITIES");
  });

  it("validates and normalizes external http/https URLs safely", () => {
    assert.deepEqual(vendorGroups.parseSafeHttpUrl(""), { url: null });
    assert.deepEqual(vendorGroups.parseSafeHttpUrl(null), { url: null });
    assert.deepEqual(vendorGroups.parseSafeHttpUrl("www.example.com/path"), {
      url: "https://www.example.com/path",
    });
    assert.deepEqual(vendorGroups.parseSafeHttpUrl("https://iica.int"), {
      url: "https://iica.int/",
    });
    assert.ok(vendorGroups.parseSafeHttpUrl("javascript:alert(1)").error);
    assert.ok(vendorGroups.parseSafeHttpUrl("ftp://files.example.com").error);
    assert.ok(vendorGroups.parseSafeHttpUrl("not a valid url").error);
  });

  it("advances billing due dates and clamps month-end days", () => {
    assert.equal(vendorGroups.suggestNextDueDate("2026-01-31", "MONTHLY"), "2026-02-28");
    assert.equal(vendorGroups.suggestNextDueDate("2024-01-31", "MONTHLY"), "2024-02-29");
    assert.equal(vendorGroups.suggestNextDueDate("2026-01-15", "QUARTERLY"), "2026-04-15");
    assert.equal(vendorGroups.suggestNextDueDate("2024-02-29", "ANNUAL"), "2025-02-28");
    assert.equal(vendorGroups.suggestNextDueDate("2026-05-01", "ON_DEMAND"), null);
    assert.equal(vendorGroups.suggestNextDueDate("bad-date", "MONTHLY"), null);
  });
});

describe("conditions", () => {
  it("parses canonical values, lowercase/spaced variants, and UI labels", () => {
    assert.equal(conditions.parseConditionInput("IN_SERVICE"), "IN_SERVICE");
    assert.equal(conditions.parseConditionInput("needs repair"), "NEEDS_REPAIR");
    assert.equal(conditions.parseConditionInput("For decommissioning"), "FOR_DECOMMISSION");
    assert.equal(conditions.parseConditionInput("for decommission"), "FOR_DECOMMISSION");
    assert.equal(conditions.parseConditionInput("decommissioned"), "DECOMMISSIONED");
    assert.equal(conditions.parseConditionInput("DISPOSED"), "DISPOSED");
    assert.equal(conditions.parseConditionInput("unknown"), null);
    assert.equal(conditions.parseConditionInput(42), null);
  });

  it("tracks retired and flagged subsets consistently", () => {
    assert.deepEqual(conditions.RETIRED_CONDITIONS, ["DECOMMISSIONED", "DISPOSED"]);
    assert.deepEqual(conditions.FLAGGED_CONDITIONS, [
      "NEEDS_REPAIR",
      "FOR_DECOMMISSION",
      "DECOMMISSIONED",
    ]);
    assert.equal(conditions.isRetiredCondition("DECOMMISSIONED"), true);
    assert.equal(conditions.isRetiredCondition("IN_SERVICE"), false);
  });
});

describe("sku", () => {
  it("hides placeholder SKUs as Unknown while preserving real SKUs", () => {
    assert.equal(sku.isPlaceholderSku("INV-UNKNOWN"), true);
    assert.equal(sku.isPlaceholderSku("inv-unknown-123"), true);
    assert.equal(sku.isPlaceholderSku("IICA-LAP-01"), false);
    assert.equal(sku.displaySku("INV-UNKNOWN-7"), "Unknown");
    assert.equal(sku.displaySku(null), "Unknown");
    assert.equal(sku.displaySku("IICA-LAP-01"), "IICA-LAP-01");
  });

  it("normalizes user-supplied SKUs to trimmed uppercase or null", () => {
    assert.equal(sku.normalizeSku("  iica-001 "), "IICA-001");
    assert.equal(sku.normalizeSku("   "), null);
    assert.equal(sku.normalizeSku(undefined), null);
  });
});

describe("dashboard", () => {
  it("parses stored layouts safely, dropping unknown ids and appending missing panels", () => {
    assert.deepEqual(dashboard.parseLayout(null), dashboard.DEFAULT_LAYOUT);
    assert.deepEqual(dashboard.parseLayout("{bad-json"), dashboard.DEFAULT_LAYOUT);

    const parsed = dashboard.parseLayout(
      JSON.stringify({
        order: ["topValue", "nonexistent", "topValue", "stats"],
        hidden: ["admin", "bogus", "admin"],
      }),
    );

    assert.equal(parsed.order[0], "topValue");
    assert.equal(parsed.order[1], "stats");
    assert.equal(parsed.order.length, dashboard.DEFAULT_ORDER.length);
    assert.equal(parsed.order.includes("nonexistent"), false);
    assert.deepEqual(parsed.hidden, ["admin"]);
  });
});

describe("roles & nav-config", () => {
  it("includes projects, calendar, and timelines permissions and locks ADMIN users.manage", () => {
    assert.ok(roles.PERMISSIONS.includes("projects.view"));
    assert.ok(roles.PERMISSIONS.includes("projects.manage"));
    assert.ok(roles.PERMISSIONS.includes("calendar.manage"));
    assert.ok(roles.PERMISSIONS.includes("timelines.manage"));

    assert.equal(roles.isLocked("ADMIN", "users.manage"), true);
    assert.equal(roles.isLocked("MANAGER", "users.manage"), false);
    assert.equal(roles.canWith(roles.DEFAULT_ROLE_PERMISSIONS, "STAFF", "movement.record"), true);
    assert.equal(roles.canWith(roles.DEFAULT_ROLE_PERMISSIONS, "VIEWER", "projects.manage"), false);
    assert.equal(roles.canWith(roles.DEFAULT_ROLE_PERMISSIONS, null, "inventory.view"), false);
  });

  it("allows taxonomy nav item via either taxonomy.manage or stakeholders.manage", () => {
    const taxonomyItem = navConfig.NAV_SECTIONS.flatMap((s) => s.items).find(
      (item) => item.href === "/taxonomy",
    );
    assert.ok(taxonomyItem);

    const customMatrix = {
      ...roles.DEFAULT_ROLE_PERMISSIONS,
      STAFF: ["stakeholders.manage"],
      VIEWER: [],
    };
    assert.equal(navConfig.canViewNavItem(customMatrix, "STAFF", taxonomyItem), true);
    assert.equal(navConfig.canViewNavItem(customMatrix, "VIEWER", taxonomyItem), false);
  });
});

describe("project-meta & timelines", () => {
  it("validates ISO calendar dates strictly (rejecting impossible days and out-of-range years)", () => {
    assert.equal(projectMeta.isIsoDate("2024-02-29"), true);
    assert.equal(projectMeta.isIsoDate("2026-02-29"), false);
    assert.equal(projectMeta.isIsoDate("2026-02-30"), false);
    assert.equal(projectMeta.isIsoDate("1899-12-31"), false);
    assert.equal(timelines.isValidIsoDate("2026-04-31"), false);
    assert.equal(timelines.isValidIsoDate("2026-04-30"), true);
  });

  it("keeps task status and progress mutually consistent", () => {
    assert.deepEqual(timelines.syncStatusAndProgress("COMPLETE", 20), {
      status: "COMPLETE",
      progress: 100,
    });
    assert.deepEqual(timelines.syncStatusAndProgress("ONGOING", 100), {
      status: "COMPLETE",
      progress: 100,
    });
    assert.deepEqual(timelines.syncStatusAndProgress("NOT_STARTED", 40), {
      status: "NOT_STARTED",
      progress: 0,
    });
    assert.deepEqual(timelines.syncStatusAndProgress("NOT_STARTED", null), {
      status: "NOT_STARTED",
      progress: null,
    });
  });

  it("formats currency, dates, enums, and status tones cleanly", () => {
    assert.equal(projectMeta.formatMoney(null, "TTD"), "-");
    assert.equal(projectMeta.formatMoney(Number.POSITIVE_INFINITY, "TTD"), "-");
    assert.equal(projectMeta.formatMoney(1250.5, "ttd"), "TTD 1,250.5");
    assert.equal(projectMeta.formatDay("bad-date"), "-");
    assert.equal(projectMeta.formatDay("2026-05-01"), "1 May 2026");
    assert.equal(projectMeta.isApprovalState("FINAL"), true);
    assert.equal(projectMeta.isApprovalState("PUBLISHED"), false);
    assert.equal(projectMeta.isReferenceKind("programmeArea"), true);
    assert.equal(projectMeta.isReferenceKind("bogus"), false);
    assert.match(projectMeta.statusTone(5, true, "Cancelled"), /ink\/55/);
    assert.match(projectMeta.statusTone(5, true, "Completed"), /emerald/);
  });
});
