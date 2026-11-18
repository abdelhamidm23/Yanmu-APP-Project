import { describe, expect, it } from "vitest";
import { checkPunchRows, deriveDays, guessMapping, mappingProblems, normalizeEmployeeNo, parsePunchTime } from "@/lib/staff-import";
import { parseCsv } from "@/lib/csv";

describe("fingerprint file columns (spec §8.3, F7)", () => {
  it("guesses Hikvision English and Arabic headers", () => {
    expect(guessMapping(["Person ID", "Name", "Department", "Time", "Attendance Status", "Device Name"])).toEqual({
      employeeNo: "Person ID",
      name: "Name",
      dateTime: "Time",
      device: "Device Name",
    });
    expect(guessMapping(["رقم الموظف", "الاسم", "التاريخ", "الوقت"])).toEqual({ employeeNo: "رقم الموظف", name: "الاسم", date: "التاريخ", time: "الوقت" });
    // "Time" next to a separate "Date" column holds only the time.
    expect(guessMapping(["Employee ID", "Date", "Time"])).toEqual({ employeeNo: "Employee ID", date: "Date", time: "Time" });
  });

  it("explains what is missing from a mapping", () => {
    expect(mappingProblems({ name: "Name" }, ["Name"])).toEqual(["employeeNo", "when"]);
    expect(mappingProblems({ employeeNo: "ID", date: "Date" }, ["ID", "Date"])).toEqual(["when"]);
    expect(mappingProblems({ employeeNo: "ID", dateTime: "Gone" }, ["ID"])).toEqual(["unknownColumn"]);
    expect(mappingProblems({ employeeNo: "ID", dateTime: "Time" }, ["ID", "Time"])).toEqual([]);
  });
});

describe("punch times are Cairo wall clock (rule 11)", () => {
  const cairo8 = "2026-11-18T06:00:00.000Z";
  it("reads the formats machines and Excel produce", () => {
    expect(parsePunchTime("2026-11-18 08:00:00")?.toISOString()).toBe(cairo8);
    expect(parsePunchTime("2026/11/18 08:00")?.toISOString()).toBe(cairo8);
    expect(parsePunchTime("18/11/2026 8:00 AM")?.toISOString()).toBe(cairo8);
    expect(parsePunchTime("١٨/١١/٢٠٢٦ ٠٨:٠٠ ص")?.toISOString()).toBe(cairo8);
    expect(parsePunchTime("18/11/2026 4:30 PM")?.toISOString()).toBe("2026-11-18T14:30:00.000Z");
    expect(parsePunchTime("18/11/2026 12:15 AM")?.toISOString()).toBe("2026-11-17T22:15:00.000Z");
    // ExcelJS hands Excel dates over as if they were UTC wall clock.
    expect(parsePunchTime(new Date(Date.UTC(2026, 10, 18, 8, 0)))?.toISOString()).toBe(cairo8);
    expect(parsePunchTime(46344 + 8 / 24)?.toISOString()).toBe(cairo8);
    expect(parsePunchTime(undefined, "18/11/2026", "08:00")?.toISOString()).toBe(cairo8);
  });

  it("refuses impossible dates", () => {
    expect(parsePunchTime("2026-02-30 08:00")).toBeNull();
    expect(parsePunchTime("31/13/2026 08:00")).toBeNull();
    expect(parsePunchTime("yesterday")).toBeNull();
    expect(parsePunchTime("")).toBeNull();
  });

  it("matches device numbers without leading zeros", () => {
    expect(normalizeEmployeeNo("0007")).toBe("7");
    expect(normalizeEmployeeNo("٠١٢")).toBe("12");
    expect(normalizeEmployeeNo("A-12")).toBe("A-12");
  });
});

describe("checking the rows (rule 13: preview with row errors)", () => {
  const mapping = { employeeNo: "ID", name: "Name", dateTime: "Time" };
  const now = new Date("2026-11-18T12:00:00Z");
  const rows = [
    { row: 2, cells: { ID: "101", Name: "Hala", Time: "2026-11-17 07:50:12" } },
    { row: 3, cells: { ID: "101", Name: "Hala", Time: "2026-11-17 07:50:40" } },
    { row: 4, cells: { ID: "0102", Name: "Aya", Time: "2026-11-18 08:20:00" } },
    { row: 5, cells: { ID: "", Name: "Nobody", Time: "2026-11-18 08:00:00" } },
    { row: 6, cells: { ID: "103", Name: "Basma", Time: "not a time" } },
    { row: 7, cells: { ID: "999", Name: "Visitor", Time: "2026-11-18 10:00:00" } },
    { row: 8, cells: { ID: "101", Name: "Hala", Time: "2026-11-19 08:00:00" } },
  ];

  it("keeps good rows, lists errors, skips repeats within the minute and finds unlinked numbers", () => {
    const r = checkPunchRows(rows, mapping, new Set(["101", "102", "103"]), now);
    expect(r.punches.map((p) => [p.row, p.employeeNo, p.at.toISOString()])).toEqual([
      [2, "101", "2026-11-17T05:50:00.000Z"],
      [4, "102", "2026-11-18T06:20:00.000Z"],
      [7, "999", "2026-11-18T08:00:00.000Z"],
    ]);
    expect(r.duplicates).toBe(1);
    expect(r.errors).toEqual([
      { row: 5, code: "noEmployeeNo" },
      { row: 6, code: "badTime" },
      { row: 8, code: "future" },
    ]);
    expect(r.unknown).toEqual([{ employeeNo: "999", name: "Visitor", count: 1 }]);
    expect([r.from, r.to]).toEqual(["2026-11-17", "2026-11-18"]);
  });

  it("reads CSV exports with commas, semicolons or tabs", () => {
    expect(parseCsv("ID;Time\n101;2026-11-18 08:00")).toEqual([
      ["ID", "Time"],
      ["101", "2026-11-18 08:00"],
    ]);
    expect(parseCsv('ID,Name\n7,"Hala, Ezzat"')[1]).toEqual(["7", "Hala, Ezzat"]);
  });
});

describe("working out each day (spec §8.3)", () => {
  const staff = [
    { id: "hala", shiftStart: "08:00", status: "active", startDate: "2025-09-01", endDate: null },
    { id: "aya", shiftStart: "08:00", status: "active", startDate: "2025-09-01", endDate: null },
    { id: "new", shiftStart: "08:00", status: "active", startDate: "2026-11-18", endDate: null },
    { id: "gone", shiftStart: "08:00", status: "left", startDate: "2025-09-01", endDate: "2026-10-31" },
  ];
  const at = (iso: string) => new Date(iso);
  const base = {
    staff,
    from: "2026-11-17",
    to: "2026-11-18",
    today: "2026-11-18",
    isWorkingDay: () => true,
    graceMinutes: 10,
  };

  it("first in, last out, late after shift start plus grace, absent without punches", () => {
    const days = deriveDays({
      ...base,
      punches: [
        { staffId: "hala", at: at("2026-11-17T05:55:00Z") }, // 07:55
        { staffId: "hala", at: at("2026-11-17T14:10:00Z") }, // 16:10
        { staffId: "aya", at: at("2026-11-17T06:11:00Z") }, //  08:11, one minute past grace
        { staffId: "hala", at: at("2026-11-18T06:10:00Z") }, // 08:10, exactly at grace
      ],
      nowMinutes: 9 * 60,
    });
    const get = (id: string, d: string) => days.find((x) => x.staffId === id && x.date === d);
    expect(get("hala", "2026-11-17")).toMatchObject({ status: "present", lastOut: at("2026-11-17T14:10:00Z") });
    expect(get("aya", "2026-11-17")).toMatchObject({ status: "late", lastOut: null });
    expect(get("hala", "2026-11-18")?.status).toBe("present");
    expect(get("aya", "2026-11-18")?.status).toBe("absent");
    // Not employed yet / already left: no absence recorded.
    expect(get("new", "2026-11-17")).toBeUndefined();
    expect(get("gone", "2026-11-17")).toBeUndefined();
  });

  it("does not mark anyone absent today before their shift and grace have passed, nor on days off or leave", () => {
    const early = deriveDays({ ...base, from: "2026-11-18", punches: [], nowMinutes: 8 * 60 + 5 });
    expect(early).toEqual([]);
    const off = deriveDays({ ...base, punches: [], isWorkingDay: (d) => d !== "2026-11-17", nowMinutes: 12 * 60 });
    expect(off.filter((d) => d.date === "2026-11-17")).toEqual([]);
    const leave = deriveDays({ ...base, from: "2026-11-18", punches: [], leave: new Set(["aya|2026-11-18"]), nowMinutes: 12 * 60 });
    expect(leave.find((d) => d.staffId === "aya")?.status).toBe("leave");
  });
});
