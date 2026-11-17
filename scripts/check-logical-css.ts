/**
 * CLAUDE.md rule 8: layout must use logical properties (ms-/me-/ps-/pe-/start/end),
 * never physical left/right, so Arabic (RTL) and English (LTR) both work.
 * Usage: pnpm lint:rtl
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const patterns: { re: RegExp; hint: string }[] = [
  { re: /(?<![\w-])-?(ml|mr|pl|pr)-[\w[\].\/-]+/g, hint: "use ms-/me-/ps-/pe-" },
  { re: /(?<![\w-])-?(left|right)-[\w[\].\/-]+/g, hint: "use start-/end-" },
  { re: /(?<![\w-])(text-left|text-right|float-left|float-right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)(?![\w])/g, hint: "use the -s/-e or -start/-end form" },
  { re: /(margin|padding|border)-(left|right)\s*:/g, hint: "use margin-inline-start / padding-inline-end" },
  { re: /(?<![\w-])(left|right)\s*:\s*[\d-]/g, hint: "use inset-inline-start / inset-inline-end" },
  { re: /text-align\s*:\s*(left|right)/g, hint: "use text-align: start / end" },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(p) ? [p] : [];
  });
}

let problems = 0;
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("rtl-ok")) return;
    for (const { re, hint } of patterns) {
      for (const m of line.matchAll(re)) {
        problems++;
        console.error(`${file}:${i + 1}  "${m[0]}"  → ${hint}`);
      }
    }
  });
}

if (problems) {
  console.error(`\n${problems} physical left/right usage(s) found. See CLAUDE.md rule 8.`);
  process.exit(1);
}
console.log("RTL check passed: no physical left/right layout found.");
