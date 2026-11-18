import { describe, expect, it } from "vitest";
import { addMonths, ageInMonths, bandForAge, childAlerts, findDuplicates, fitsBand, normalizeName, normalizePhone, occupancy } from "@/lib/children";
import { checkImportRows, columnForHeader, parseDate, type ImportContext } from "@/lib/child-import";

const bands = [
  { id: "babies", minAgeMonths: 3, maxAgeMonths: 12 },
  { id: "toddlers", minAgeMonths: 12, maxAgeMonths: 24 },
  { id: "juniors", minAgeMonths: 24, maxAgeMonths: 36 },
  { id: "seniors", minAgeMonths: 36, maxAgeMonths: 54 },
];

describe("ages and age bands (spec §2.1)", () => {
  it("counts whole months like PostgreSQL age()", () => {
    expect(ageInMonths("2024-01-31", "2024-02-29")).toBe(0);
    expect(ageInMonths("2024-01-31", "2024-03-01")).toBe(1);
    expect(ageInMonths("2023-05-14", "2026-11-14")).toBe(42);
    expect(ageInMonths("2023-05-14", "2026-11-13")).toBe(41);
  });

  it("adds months and clamps the day", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2025-11-15", 54)).toBe("2030-05-15");
  });

  it("places a child in the band for their age; none under 3 months or from 4½ years", () => {
    expect(bandForAge(2, bands)).toBeNull();
    expect(bandForAge(3, bands)?.id).toBe("babies");
    expect(bandForAge(12, bands)?.id).toBe("toddlers");
    expect(bandForAge(53, bands)?.id).toBe("seniors");
    expect(bandForAge(54, bands)).toBeNull();
    expect(fitsBand("2025-01-10", "2026-01-10", bands[1])).toBe(true);
    expect(fitsBand("2025-01-10", "2026-01-09", bands[1])).toBe(false);
  });

  it("warns when a child moves up within 30 days or turns 4½ within 60 (spec §9.2)", () => {
    // Turns 24 months on 2026-12-10: in 22 days.
    expect(childAlerts("2024-12-10", bands[1], "2026-11-18")).toEqual({ movingUpOn: "2026-12-10", leavingOn: null });
    // Turns 24 months in 40 days: not yet.
    expect(childAlerts("2025-01-20", bands[1], "2026-11-18").movingUpOn).toBeNull();
    // Turns 54 months on 2027-01-05: in 48 days. Seniors is the last band, so no "moving up".
    expect(childAlerts("2022-07-05", bands[3], "2026-11-18")).toEqual({ movingUpOn: null, leavingOn: "2027-01-05" });
  });

  it("works out occupancy against the licence", () => {
    expect(occupancy(92, 100)).toEqual({ active: 92, licensed: 100, percent: 92, atCap: false });
    expect(occupancy(100, 100).atCap).toBe(true);
  });
});

describe("phone numbers and names", () => {
  it("accepts Egyptian mobiles written many ways", () => {
    expect(normalizePhone("010 1234 5678")).toBe("01012345678");
    expect(normalizePhone("+20 101 234 5678")).toBe("01012345678");
    expect(normalizePhone("00201012345678")).toBe("01012345678");
    expect(normalizePhone("٠١٠١٢٣٤٥٦٧٨")).toBe("01012345678");
    expect(normalizePhone("1012345678")).toBe("01012345678"); // Excel dropped the 0
    expect(normalizePhone("0221234567")).toBeNull(); // landline
    expect(normalizePhone("0131234567")).toBeNull();
  });

  it("matches Arabic names across spelling variants", () => {
    expect(normalizeName("فاطمة  أحمد")).toBe(normalizeName("فاطمه احمد"));
    expect(normalizeName("مُنى")).toBe(normalizeName("منى"));
    expect(normalizeName("Laila  HASSAN ")).toBe("laila hassan");
  });

  it("finds possible duplicates by name + birth date or parent phone (spec §8.1)", () => {
    const existing = [
      { id: "a", fullNameAr: "ليلى حسن", fullNameEn: "Laila Hassan", dateOfBirth: "2024-05-14", phones: ["01012345678"] },
      { id: "b", fullNameAr: "عمر علي", fullNameEn: "Omar Ali", dateOfBirth: "2023-02-01", phones: ["01198765432"] },
    ];
    expect(findDuplicates({ fullNameAr: "ليلي حسن", fullNameEn: "Leila H", dateOfBirth: "2024-05-14", phones: [] }, existing)).toEqual([{ id: "a", reason: "nameAndBirth" }]);
    expect(findDuplicates({ fullNameAr: "سارة", fullNameEn: "Sara", dateOfBirth: "2025-01-01", phones: ["+201198765432"] }, existing)).toEqual([{ id: "b", reason: "phone" }]);
    expect(findDuplicates({ fullNameAr: "ليلى حسن", fullNameEn: "Laila Hassan", dateOfBirth: "2024-05-15", phones: [] }, existing)).toEqual([]);
  });
});

describe("child import rows (spec §8.11)", () => {
  const ctx: ImportContext = {
    rooms: [
      { id: "r-tod", nameAr: "الدارجون ١", nameEn: "Toddlers 1", minAgeMonths: 12, maxAgeMonths: 24 },
      { id: "r-sen", nameAr: "الكبار ١", nameEn: "Seniors 1", minAgeMonths: 36, maxAgeMonths: 54 },
    ],
    today: "2026-11-18",
    existing: [{ fullNameAr: "عمر علي", fullNameEn: "Omar Ali", dateOfBirth: "2023-02-01" }],
    activeCount: 10,
    licensedCapacity: 100,
  };
  const good = {
    familyRef: "1",
    fullNameAr: "ليلى حسن",
    fullNameEn: "Laila Hassan",
    dateOfBirth: "2025-05-14",
    gender: "أنثى",
    room: "toddlers 1",
    startDate: "2025-09-01",
    guardian1Name: "Mona Ali",
    guardian1Relationship: "أم",
    guardian1Phone: "1012345678",
  };

  it("reads headers in Arabic or English", () => {
    expect(columnForHeader("Child name (English)")).toBe("fullNameEn");
    expect(columnForHeader("تاريخ الميلاد")).toBe("dateOfBirth");
    expect(columnForHeader("Shoe size")).toBeNull();
  });

  it("reads dates written the Egyptian way", () => {
    expect(parseDate("1/9/2025")).toBe("2025-09-01");
    expect(parseDate("2025-09-01")).toBe("2025-09-01");
    expect(parseDate("٢٠٢٥-٠٩-٠١")).toBe("2025-09-01");
    expect(parseDate("31/2/2025")).toBeNull();
    expect(parseDate(new Date(Date.UTC(2025, 8, 1)))).toBe("2025-09-01");
  });

  it("accepts a good row, normalizing words and phone numbers", () => {
    const { children, errors } = checkImportRows([good], ctx);
    expect(errors).toEqual([]);
    expect(children[0]).toMatchObject({ gender: "female", roomId: "r-tod", bandOverride: false, guardians: [{ relationship: "mother", phone: "01012345678" }] });
  });

  it("flags a room for another age band instead of refusing it", () => {
    const { children } = checkImportRows([{ ...good, room: "Seniors 1" }], ctx);
    expect(children[0].bandOverride).toBe(true);
  });

  it("lists every problem by row and column, and imports nothing", () => {
    const rows = [
      good,
      { ...good, fullNameAr: "", gender: "x", guardian1Phone: "123", __row: 5 },
      { ...good, fullNameAr: "عمر علي", fullNameEn: "Omar Ali", dateOfBirth: "2023-02-01", __row: 6 },
      { ...good, room: "Kitchen", dateOfBirth: "2021-01-01", __row: 7 },
      { ...good, __row: 8 },
    ];
    const { children, errors } = checkImportRows(rows, ctx);
    expect(children).toEqual([]);
    expect(errors).toEqual(
      expect.arrayContaining([
        { row: 5, column: "fullNameAr", code: "required" },
        { row: 5, column: "gender", code: "badGender" },
        { row: 5, column: "guardian1Phone", code: "badPhone" },
        { row: 6, column: "fullNameAr", code: "alreadyEnrolled" },
        { row: 7, column: "room", code: "unknownRoom" },
        { row: 7, column: "dateOfBirth", code: "tooOld" },
        { row: 8, column: "fullNameAr", code: "duplicateInFile" },
      ]),
    );
  });

  it("catches brothers and sisters given the same family number by mistake", () => {
    const sibling = { ...good, fullNameAr: "سارة", fullNameEn: "Sara", dateOfBirth: "2024-01-01", guardian1Phone: "01199999999" };
    expect(checkImportRows([good, sibling], ctx).errors).toEqual([{ row: 3, column: "familyRef", code: "familyMismatch" }]);
  });

  it("refuses to import past the licence limit (spec D11)", () => {
    const rows = [good, { ...good, fullNameAr: "سارة", fullNameEn: "Sara", dateOfBirth: "2024-01-01" }];
    const { errors } = checkImportRows(rows, { ...ctx, activeCount: 99 });
    expect(errors).toEqual([{ row: 3, column: null, code: "overCapacity" }]);
  });
});
