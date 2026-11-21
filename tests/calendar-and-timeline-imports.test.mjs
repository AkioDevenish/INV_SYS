import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { loadTs } from "./helpers/load-ts.mjs";

const cal = loadTs("src/lib/calendar-import.ts");
const timelineImport = loadTs("src/lib/timeline-import.ts");

describe("calendar-import.ts AST date & text parsers", () => {
  it("validates calendar dates and constructs Trinidad AST (UTC-4) timestamps", () => {
    assert.equal(cal.isValidCalendarDate(2024, 2, 29), true);
    assert.equal(cal.isValidCalendarDate(2026, 2, 29), false);
    assert.equal(cal.isValidCalendarDate(2026, 4, 31), false);
    assert.equal(cal.isValidCalendarDate(1969, 12, 31), false);

    // 2026-05-01 09:00 AST == 2026-05-01 13:00:00Z
    assert.equal(cal.makeTrinidadDate(2026, 5, 1, 9, 0).toISOString(), "2026-05-01T13:00:00.000Z");
    // 2026-05-01 21:00 AST == 2026-05-02 01:00:00Z
    assert.equal(cal.makeTrinidadDate(2026, 5, 1, 21, 0).toISOString(), "2026-05-02T01:00:00.000Z");
  });

  it("parses time ranges, single times, all-day prefixes, and defaults cleanly", () => {
    assert.deepEqual(cal.extractTimingFromText("10:00am-12:00PM: Team Sync"), {
      startHour: 10,
      startMinute: 0,
      endHour: 12,
      endMinute: 0,
      allDay: false,
      cleanedText: "Team Sync",
    });

    assert.deepEqual(cal.extractTimingFromText("9:00-2:00PM: Workshop"), {
      startHour: 9,
      startMinute: 0,
      endHour: 14,
      endMinute: 0,
      allDay: false,
      cleanedText: "Workshop",
    });

    assert.deepEqual(cal.extractTimingFromText("12 noon: Briefing"), {
      startHour: 12,
      startMinute: 0,
      endHour: 13,
      endMinute: 0,
      allDay: false,
      cleanedText: "Briefing",
    });

    assert.deepEqual(cal.extractTimingFromText("ALL DAY: Staff Retreat"), {
      startHour: 9,
      startMinute: 0,
      endHour: 17,
      endMinute: 0,
      allDay: true,
      cleanedText: "Staff Retreat",
    });

    const plain = cal.extractTimingFromText("Annual Board Review");
    assert.equal(plain.allDay, true);
    assert.equal(plain.startHour, 9);
    assert.equal(plain.endHour, 17);
  });

  it("classifies event types accurately with precedence and false-positive guards", () => {
    assert.equal(cal.classifyEventType("Corpus Christi Holiday"), "HOLIDAY");
    assert.equal(cal.classifyEventType("Corpus Christi College Visit"), "MEETING");
    assert.equal(cal.classifyEventType("VACATION: DEF"), "LEAVE");
    assert.equal(cal.classifyEventType("Staff Meeting (WFH option)"), "MEETING");
    assert.equal(cal.classifyEventType("Q2 Report Deadline"), "DEADLINE");
    assert.equal(cal.classifyEventType("Moruga Farmers' Field Visit"), "MISSION");
    assert.equal(cal.classifyEventType("Any Title", "Field Visit"), "MISSION");
  });

  it("expands staff initials in staff context without corrupting URLs or acronyms", () => {
    const out = cal.expandStaffInitialsInText(
      "DF: AD-HOC review\nParticipants: DEF, LH\nhttps://example.com/DF/AD",
    );
    assert.match(out, /^Diana Francis: AD-HOC review/);
    assert.match(out, /Participants: Diana Francis, Lisa Harrynanan/);
    assert.match(out, /https:\/\/example\.com\/DF\/AD$/);
  });

  it("parses calendar cells, multi-day spans, and filters out non-event banners", () => {
    assert.equal(cal.isNonEventBanner("Notes for BOP"), true);
    assert.equal(cal.isNonEventBanner("January 2026"), true);
    assert.equal(cal.isNonEventBanner("15"), true);

    const parsed = cal.buildParsedCalendarCell(
      "May 11-13: 9AM-4:00PM: Regional Climate Workshop [DF, LH] https://zoom.us/j/123",
      2026,
      5,
      11,
    );
    assert.ok(parsed);
    assert.equal(parsed.title, "Regional Climate Workshop");
    assert.equal(parsed.eventType, "MISSION");
    assert.equal(parsed.allDay, false);
    assert.equal(parsed.location, "Zoom / Virtual");
    assert.equal(parsed.leadInitials, "DF");
    assert.equal(parsed.start.toISOString(), "2026-05-11T13:00:00.000Z");
    assert.equal(parsed.end.toISOString(), "2026-05-13T20:00:00.000Z");
  });

  it("parses tabular and monthly-grid XLSX workbooks and encodes Graph sharing tokens", async () => {
    const token = cal.encodeGraphSharingToken("https://iicaint-my.sharepoint.com/doc.xlsx");
    assert.ok(token.startsWith("u!"));
    assert.equal(token.includes("="), false);
    assert.equal(token.includes("+"), false);
    assert.equal(token.includes("/"), false);

    // Tabular XLSX
    const tabularWb = new ExcelJS.Workbook();
    const sheet = tabularWb.addWorksheet("Schedule");
    sheet.addRow(["Title", "Start", "End", "Location", "Type"]);
    sheet.addRow(["Staff Sync", "2026-06-10T10:00", "2026-06-10T11:30", "Boardroom", "MEETING"]);
    sheet.addRow(["Divali", "2026-11-08", "2026-11-08", "", "HOLIDAY"]);
    const tabBuf = await tabularWb.xlsx.writeBuffer();
    const tabRes = await cal.parseXlsxBuffer(tabBuf);
    assert.equal(tabRes.format, "tabular-xlsx");
    assert.equal(tabRes.events.length, 2);
    assert.equal(tabRes.events[0].start.toISOString(), "2026-06-10T14:00:00.000Z");
    assert.equal(tabRes.events[1].allDay, true);
    assert.equal(tabRes.events[1].eventType, "HOLIDAY");

    // Monthly-grid XLSX (Jan26)
    const gridWb = new ExcelJS.Workbook();
    const jan = gridWb.addWorksheet("Jan26");
    jan.addRow(["JANUARY 2026"]);
    jan.addRow(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    // Jan 1, 2026 is Thursday (col 4)
    jan.addRow(["", "", "", 1, 2, 3, 4]);
    jan.addRow(["", "", "", "New Year's Day", "10:00AM-11:00AM: Team Kickoff", "", ""]);
    const gridBuf = await gridWb.xlsx.writeBuffer();
    const gridRes = await cal.parseXlsxBuffer(gridBuf);
    assert.equal(gridRes.format, "iica-grid");
    assert.deepEqual(gridRes.sheetMonths, ["2026-01"]);
    assert.equal(gridRes.events.length, 2);
    assert.equal(gridRes.events[0].eventType, "HOLIDAY");
    assert.equal(gridRes.events[1].start.toISOString(), "2026-01-02T14:00:00.000Z");

    // Unrecognized layout throws
    const badWb = new ExcelJS.Workbook();
    badWb.addWorksheet("Misc").addRow(["Foo", "Bar"]);
    await assert.rejects(() => cal.parseXlsxBuffer(badWb.xlsx.writeBuffer()), /Could not recognise/);
  });
});

describe("timeline-import.ts sheet classification & parsing", () => {
  it("classifies activity, monthly, and personal sheets accurately without false monthly hits", async () => {
    const wb = new ExcelJS.Workbook();

    // 1. Personal sheet
    const personal = wb.addWorksheet("AD");
    personal.addRow(["Personal Tasks"]);
    personal.addRow(["#", "Task", "Origin", "Due date", "Progress", "Comments"]);
    personal.addRow([1, "Audit spreadsheets", "Internal", "2026-06-15", "75%", "In progress"]);
    personal.addRow([2, "Finalize archive", "Internal", "2026-06-30", 0, "Pending"]);

    // 2. Monthly recurring sheet (>=2 exact month headers)
    const monthly = wb.addWorksheet("ADMIN");
    monthly.addRow(["Admin Recurring"]);
    monthly.addRow(["#", "Action", "Lead", "Origin", "Priority", "Sep", "Oct", "Nov", "Dec", "Time", "Comments"]);
    monthly.addRow([1, "Payroll prep", "LH", "Finance", "H", "15", "15", "15", "15", "Morning", "Monthly run"]);

    // 3. Activity sheet (has Month/Start/End + D/NS/O/C; words like "Decision" must NOT trigger monthly)
    const activity = wb.addWorksheet("TC");
    activity.addRow(["Technical Cooperation"]);
    activity.addRow(["#", "Action", "Lead", "Origin", "Priority", "Month", "Start", "End", "Time", "D", "NS", "O", "C", "Comments"]);
    activity.addRow([1, "Regional Workshop", "DEF", "IICA", "H", "May", "11-13", "11-13", "9AM-4PM", "No", "No", "X", "No", "Active"]);
    activity.addRow([2, "Report Signoff", "GH", "IICA", "M", "May", "20", "20", "", "", "", "", "X", "Done"]);

    // 4. Unrecognized sheet
    const noise = wb.addWorksheet("Notes");
    noise.addRow(["Random Header", "Decision", "Market"]);

    const buf = await wb.xlsx.writeBuffer();
    const report = await timelineImport.parseTimelineWorkbook(buf, 2026);

    assert.deepEqual(
      report.sheets.map((s) => ({ name: s.name, shape: s.shape, rows: s.rows })),
      [
        { name: "AD", shape: "personal", rows: 2 },
        { name: "ADMIN", shape: "monthly", rows: 1 },
        { name: "TC", shape: "activity", rows: 2 },
      ],
    );
    assert.ok(report.skipped.some((s) => s.row === "Notes" && /Unrecognised/i.test(s.reason)));

    const [p1, p2, m1, a1, a2] = report.tasks;
    assert.equal(p1.progress, 75);
    assert.equal(p1.status, "ONGOING");
    assert.equal(p1.endsOn, "2026-06-15");
    assert.equal(p2.progress, 0);
    assert.equal(p2.status, "NOT_STARTED");

    assert.equal(m1.status, "ONGOING");
    assert.match(m1.scheduleNote ?? "", /Sep 15.*Oct 15.*Morning/);

    assert.equal(a1.startsOn, "2026-05-11");
    assert.equal(a1.endsOn, "2026-05-13");
    assert.equal(a1.status, "ONGOING");

    assert.equal(a2.status, "COMPLETE");
    assert.equal(a2.progress, 100);
  });
});
