import { describe, expect, it } from "vitest";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import { ROLES, SECTIONS } from "@/lib/roles";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === "string" ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) };
  }, {});
}

const arFlat = flatten(ar as Tree);
const enFlat = flatten(en as Tree);

describe("Arabic and English messages", () => {
  it("have exactly the same keys", () => {
    expect(Object.keys(arFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it("have no empty strings", () => {
    for (const [k, v] of Object.entries({ ...arFlat, ...enFlat })) expect(v.trim(), k).not.toBe("");
  });

  it("cover every role and nav section", () => {
    for (const r of ROLES) expect(enFlat[`roles.${r}`]).toBeTruthy();
    for (const s of SECTIONS) {
      expect(enFlat[`nav.${s}`]).toBeTruthy();
      expect(enFlat[`sections.${s}`]).toBeTruthy();
    }
  });

  it("use the glossary terms from spec §19", () => {
    expect(arFlat["nav.home"]).toBe("الرئيسية");
    expect(arFlat["nav.inbox"]).toBe("الوارد");
    expect(arFlat["status.verified"]).toBe("مُعتمد");
    expect(arFlat["status.notSubmitted"]).toBe("لم يُرسل");
    expect(arFlat["app.demoData"]).toBe("بيانات تجريبية");
    expect(arFlat["roles.branch_manager"]).toBe("مدير الفرع");
  });

  it("Arabic strings are actually Arabic", () => {
    const arabic = /[؀-ۿ]/;
    const exempt = new Set(["common.english", "more.digitsLatin"]);
    for (const [k, v] of Object.entries(arFlat)) if (!exempt.has(k)) expect(arabic.test(v), k).toBe(true);
  });
});
