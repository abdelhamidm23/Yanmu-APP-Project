import { execSync } from "node:child_process";

/** Fresh test accounts (MFA off) before every run, so the MFA enrolment test is repeatable. */
export default function globalSetup() {
  execSync("pnpm -s seed:dev-users --reset", { stdio: "inherit" });
}
