import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { loadTs } from "./helpers/load-ts.mjs";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const exportMod = loadTs("src/lib/export.ts");
const inventoryImport = loadTs("src/lib/inventory-import.ts");
const { Pagination } = loadTs("src/components/pagination.tsx");

describe("export.ts", () => {
  it("neutralizes spreadsheet formula prefixes in CSV cells while preserving negative numbers", async () => {
    const res = await exportMod.buildExport({
      format: "csv",
      filename: "inventory/report",
      sheetName: "Items",
      header: ["Name", "Formula", "SignedNum", "Notes"],
      rows: [
        ["=CMD|'/C calc'!A0", "+1+1", -42, 'Quote "hi", comma'],
        ["-2+3", "@SUM(A1:A2)", 0, "line1\nline2"],
        ["\tleadingTab", "\rleadingCr", 12.5, "plain"],
      ],
    });

    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(res.headers.get("Content-Type") ?? "", /^text\/csv; charset=utf-8/i);
    assert.match(res.headers.get("Content-Disposition") ?? "", /^attachment; filename="inventory-report-\d{4}-\d{2}-\d{2}\.csv"/);

    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(
      [...buf.subarray(0, 3)],
      [0xef, 0xbb, 0xbf],
      "CSV output must start with UTF-8 BOM bytes (EF BB BF)",
    );
    const raw = buf.subarray(3).toString("utf8");
    assert.ok(raw.includes("\r\n"), "CSV output must use CRLF line endings");

    const lines = raw.split("\r\n");
    assert.equal(lines[0], "Name,Formula,SignedNum,Notes");
    assert.equal(lines[1], "'=CMD|'/C calc'!A0,'+1+1,-42,\"Quote \"\"hi\"\", comma\"");
    assert.equal(lines[2], "'-2+3,'@SUM(A1:A2),0,\"line1\nline2\"");
    // Tab does not trigger CSV quoting, whereas CR triggers RFC-4180 quoting; both get ' prefix
    assert.equal(lines[3], "'\tleadingTab,\"'\rleadingCr\",12.5,plain");
  });

  it("stacks multi-table CSV exports with table headings", async () => {
    const res = await exportMod.buildMultiExport({
      format: "csv",
      filename: "bundle",
      tables: [
        { name: "First", header: ["A"], rows: [["1"]] },
        { name: "Second", header: ["B"], rows: [["2"]] },
      ],
    });
    const text = (await res.text()).replace(/^\uFEFF/, "");
    assert.equal(text, "# First\r\nA\r\n1\r\n\r\n# Second\r\nB\r\n2");
  });

  it("builds valid JSON for single-table (array) and multi-table (object) exports", async () => {
    const single = await exportMod.buildExport({
      format: "json",
      filename: "single",
      sheetName: "Items",
      header: ["Name", "Name", "Count", "When"],
      rows: [["Chair", "Duplicate", Number.NaN, new Date("2026-05-01T14:00:00.000Z")]],
    });
    const singleJson = JSON.parse(await single.text());
    assert.deepEqual(singleJson, [
      {
        Name: "Chair",
        "Name (2)": "Duplicate",
        Count: null,
        When: "2026-05-01T14:00:00.000Z",
      },
    ]);

    const multi = await exportMod.buildMultiExport({
      format: "json",
      filename: "multi",
      tables: [
        { name: "One", header: ["Id"], rows: [[1]] },
        { name: "Two", header: ["Id"], rows: [[2]] },
      ],
    });
    assert.deepEqual(JSON.parse(await multi.text()), {
      One: [{ Id: 1 }],
      Two: [{ Id: 2 }],
    });
  });

  it("streams valid XLSX workbooks with sanitized unique sheet names, formula neutralization, and AST dates", async () => {
    const longPrefix = "Very Long Sheet Name Exceeding 31";
    const res = await exportMod.buildMultiExport({
      format: "xlsx",
      filename: "workbook",
      tables: [
        {
          name: `'${longPrefix}:[1]*`,
          header: ["Text", "Amount", "Updated"],
          rows: [["=HYPERLINK(\"http://evil\")", 1250.75, new Date("2026-05-01T14:00:00.000Z")]],
          columnFormats: [undefined, { numFmt: "#,##0.00", align: "right" }, { numFmt: "yyyy-mm-dd hh:mm" }],
        },
        {
          name: `'${longPrefix}:[1]*`,
          header: ["Other"],
          rows: [["ok"]],
        },
      ],
    });

    const buf = await res.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    assert.equal(wb.worksheets.length, 2);
    assert.ok(wb.worksheets[0].name.length <= 31);
    assert.ok(wb.worksheets[1].name.length <= 31);
    assert.notEqual(wb.worksheets[0].name.toLowerCase(), wb.worksheets[1].name.toLowerCase());

    const row2 = wb.worksheets[0].getRow(2);
    assert.equal(row2.getCell(1).value, "'=HYPERLINK(\"http://evil\")");
    assert.equal(row2.getCell(2).value, 1250.75);
    assert.ok(row2.getCell(3).value instanceof Date);
    // 14:00Z in Trinidad (UTC-4) is shifted by -4h to 10:00 wall-clock
    assert.equal(row2.getCell(3).value.toISOString(), "2026-05-01T10:00:00.000Z");
  });

  it("validates export query parameters strictly", () => {
    assert.deepEqual(exportMod.parsePositiveIntParam(null), {});
    assert.deepEqual(exportMod.parsePositiveIntParam(" 42 "), { value: 42 });
    assert.ok(exportMod.parsePositiveIntParam("0").error);
    assert.ok(exportMod.parsePositiveIntParam("-3").error);
    assert.ok(exportMod.parsePositiveIntParam("999999999999").error);
    assert.ok(exportMod.parsePositiveIntParam("abc").error);

    const badItem = exportMod.parseItemExportFilters(new URLSearchParams("stock=bogus"));
    assert.ok(badItem.error);

    const goodItem = exportMod.parseItemExportFilters(
      new URLSearchParams("category=5&stock=attention&condition=flagged&locationGroup=iica&sort=value&q=desk"),
    );
    assert.deepEqual(goodItem.filters, {
      search: "desk",
      categoryId: 5,
      locationId: undefined,
      stock: "attention",
      condition: "flagged",
      locationGroup: "iica",
      sort: "value",
    });

    const badStake = exportMod.parseStakeholderExportFilters(new URLSearchParams("has=fax"));
    assert.ok(badStake.error);

    const ungroupedStake = exportMod.parseStakeholderExportFilters(new URLSearchParams("group=ungrouped&has=email"));
    assert.deepEqual(ungroupedStake.filters, {
      search: undefined,
      group: "ungrouped",
      groupId: undefined,
      has: "email",
      sort: "name",
    });

    const badGroupStake = exportMod.parseStakeholderExportFilters(new URLSearchParams("group=not-a-number"));
    assert.ok(badGroupStake.error);
  });
});

describe("inventory-import.ts input guards", () => {
  it("rejects empty workbooks and uploads exceeding MAX_INVENTORY_IMPORT_BYTES before DB writes", async () => {
    assert.equal(inventoryImport.MAX_INVENTORY_IMPORT_BYTES, 10 * 1024 * 1024);
    await assert.rejects(
      () => inventoryImport.importInventoryWorkbook(new ArrayBuffer(0), null),
      /Choose a spreadsheet/,
    );
    await assert.rejects(
      () => inventoryImport.importInventoryWorkbook(new ArrayBuffer(inventoryImport.MAX_INVENTORY_IMPORT_BYTES + 1), null),
      /10 MB maximum/,
    );
  });
});

describe("Pagination clamping & query preservation", () => {
  it("clamps pages above pageCount, below 1, non-integer, or non-finite", () => {
    const overHtml = renderToStaticMarkup(
      React.createElement(Pagination, {
        page: 999,
        perPage: 20,
        total: 45,
        basePath: "/inventory",
        params: { q: "chair", page: "999" },
      }),
    );
    assert.match(overHtml, /Showing 41-45 of 45/);
    assert.match(overHtml, /aria-current="page"[^>]*>3</);

    const underHtml = renderToStaticMarkup(
      React.createElement(Pagination, {
        page: -5,
        perPage: 20,
        total: 45,
        basePath: "/inventory",
        params: {},
      }),
    );
    assert.match(underHtml, /Showing 1-20 of 45/);
    assert.match(underHtml, /aria-current="page"[^>]*>1</);

    const floatHtml = renderToStaticMarkup(
      React.createElement(Pagination, {
        page: 2.9,
        perPage: 20,
        total: 45,
        basePath: "/inventory",
        params: {},
      }),
    );
    assert.match(floatHtml, /Showing 21-40 of 45/);
    assert.match(floatHtml, /aria-current="page"[^>]*>2</);

    const nanHtml = renderToStaticMarkup(
      React.createElement(Pagination, {
        page: Number.NaN,
        perPage: 20,
        total: 45,
        basePath: "/inventory",
        params: {},
      }),
    );
    assert.match(nanHtml, /Showing 1-20 of 45/);
  });

  it("preserves string[] query params without comma coercion and hides single-page nav", () => {
    const multiParamHtml = renderToStaticMarkup(
      React.createElement(Pagination, {
        page: 1,
        perPage: 10,
        total: 25,
        basePath: "/stakeholders",
        params: { tag: ["alpha", "beta"] },
      }),
    );
    assert.match(multiParamHtml, /href="\/stakeholders\?tag=alpha&amp;tag=beta&amp;page=2"/);

    assert.equal(
      renderToStaticMarkup(
        React.createElement(Pagination, {
          page: 1,
          perPage: 0,
          total: 0,
          basePath: "/inventory",
          params: {},
        }),
      ),
      "",
    );
  });
});
