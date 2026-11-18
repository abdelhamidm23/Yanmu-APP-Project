import ExcelJS from "exceljs";
import { z } from "zod";
import { withUserDb } from "@/db/rls";
import { branchRooms } from "@/db/children";
import { getCurrentUser } from "@/lib/session";
import { canImportChildren, canImportPunches } from "@/lib/permissions";
import { IMPORT_COLUMNS } from "@/lib/child-import";
import { RELATIONSHIPS } from "@/lib/children";
import { xlsxResponse } from "@/lib/excel";
import { isDemoMode } from "@/lib/demo";
import { samplePunchFile } from "./staff-punches";

const notFound = () => new Response("Not found", { status: 404 });

/** Empty children template with a second sheet explaining each column and listing the branch's rooms. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const kind = (await params).kind;
  const url = new URL(req.url);
  if (kind === "staff-punches") {
    const branch = z.uuid().safeParse(url.searchParams.get("branch"));
    const who = await getCurrentUser();
    if (!isDemoMode() || !who || who.mustSetUpMfa || !branch.success || !canImportPunches(who, branch.data)) return notFound();
    return samplePunchFile(who, branch.data);
  }
  if (kind !== "children") return notFound();
  const ar = url.searchParams.get("locale") !== "en";
  const branchId = z.uuid().safeParse(url.searchParams.get("branch"));
  const user = await getCurrentUser();
  if (!user || user.mustSetUpMfa || !canImportChildren(user) || !branchId.success) return notFound();
  const rooms = await withUserDb(user.id, (tx) => branchRooms(tx, branchId.data));
  if (rooms.length === 0) return notFound();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(ar ? "الأطفال" : "Children", { views: [{ rightToLeft: ar, state: "frozen", ySplit: 1 }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: ar ? c.ar : c.en, width: 24 }));
  ws.getRow(1).font = { bold: true };
  // Dates and phones as text so Excel keeps "2025-09-01" and the leading 0 of "010…".
  IMPORT_COLUMNS.forEach((_, i) => (ws.getColumn(i + 1).numFmt = "@"));

  const help = wb.addWorksheet(ar ? "طريقة الملء" : "How to fill", { views: [{ rightToLeft: ar }] });
  help.columns = [{ width: 32 }, { width: 70 }, { width: 28 }];
  help.addRow(ar ? ["العمود", "ماذا تكتب", "مثال"] : ["Column", "What to write", "Example"]).font = { bold: true };
  const explain: Record<string, [string, string]> = {
    familyRef: ["Same number for brothers and sisters, e.g. 1, 2, 3", "نفس الرقم للإخوة، مثل ١ أو ٢ أو ٣"],
    fullNameAr: ["Child's full name in Arabic", "اسم الطفل كاملًا بالعربية"],
    fullNameEn: ["Child's full name in English", "اسم الطفل كاملًا بالإنجليزية"],
    dateOfBirth: ["Year-month-day, or day/month/year", "سنة-شهر-يوم أو يوم/شهر/سنة"],
    gender: ["female or male (أنثى / ذكر)", "أنثى أو ذكر"],
    room: [`One of: ${rooms.map((r) => r.nameEn).join(", ")}`, `واحد من: ${rooms.map((r) => r.nameAr).join("، ")}`],
    startDate: ["First day at the nursery", "أول يوم في الحضانة"],
    guardian1Name: ["Main parent or guardian", "ولي الأمر الأساسي"],
    guardian1Relationship: [RELATIONSHIPS.join(", "), "أم، أب، جد، أخ، قريب، مربية، أخرى"],
    guardian1Phone: ["Mobile, 11 digits starting 01", "رقم محمول من ١١ رقمًا يبدأ بـ ٠١"],
    guardian2Name: ["Optional", "اختياري"],
    guardian2Relationship: ["Optional", "اختياري"],
    guardian2Phone: ["Optional", "اختياري"],
    recordsConsentOn: ["Date the parent signed the records consent form, if signed", "تاريخ توقيع ولي الأمر على موافقة السجلات إن وُجد"],
  };
  for (const c of IMPORT_COLUMNS) help.addRow([ar ? c.ar : c.en, explain[c.key][ar ? 1 : 0], c.example]);
  return xlsxResponse(Buffer.from(await wb.xlsx.writeBuffer()), ar ? "children-template-ar.xlsx" : "children-template.xlsx");
}
