/**
 * Every literal message key used in a screen exists in the message files.
 * Catches typos like t("form.svae") that would otherwise show a raw key to the user.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";

type Tree = { [k: string]: string | Tree };

function has(tree: Tree, key: string): boolean {
  let node: string | Tree = tree;
  for (const part of key.split(".")) {
    if (typeof node === "string" || !(part in node)) return false;
    node = node[part];
  }
  // A key must name a message, not a group of messages (next-intl: INSUFFICIENT_PATH).
  return typeof node === "string";
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("message keys used in code", () => {
  const root = path.resolve(import.meta.dirname, "../../src");
  const sources = [...files(path.join(root, "app")), ...files(path.join(root, "components"))];

  it.each(sources.map((f) => [path.relative(root, f), f]))("%s", (_name, file) => {
    const src = readFileSync(file, "utf8");
    const namespaces = new Map<string, string>();
    for (const m of src.matchAll(/const (\w+) = (?:await )?(?:getTranslations|useTranslations)\((?:"([^"]*)"|\{([^}]*)\})?\)/g)) {
      namespaces.set(m[1], m[2] ?? /namespace: "([^"]+)"/.exec(m[3] ?? "")?.[1] ?? "");
    }
    const missing: string[] = [];
    for (const [name, ns] of namespaces) {
      for (const m of src.matchAll(new RegExp(`(?<![\\w.])${name}\\("([A-Za-z0-9_.-]+)"`, "g"))) {
        const key = ns ? `${ns}.${m[1]}` : m[1];
        if (!has(en as Tree, key)) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });
});
