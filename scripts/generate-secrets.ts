import { randomBytes } from "node:crypto";

const names = [
  "STUDENT_CODE_PEPPER",
  "STUDENT_SESSION_PEPPER",
  "STUDENT_CODE_ENCRYPTION_KEY",
  "LOGIN_IP_PEPPER",
] as const;

for (const name of names) {
  console.log(`${name}=${randomBytes(32).toString("base64")}`);
}
