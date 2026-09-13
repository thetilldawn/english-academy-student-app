import fs from "node:fs";
import { createHash } from "node:crypto";
import { convertSchoolSchedule } from "../src/features/school-schedules/contracts/school-schedule-import";
const [sourcePath, expectedHash, schoolLevel, outputPath] = process.argv.slice(2);
if (!sourcePath || !expectedHash || !["중", "고"].includes(schoolLevel) || !outputPath) throw new Error("원본 경로, 확인된 SHA-256, 중/고, 출력 경로를 지정해 주세요.");
const bytes = fs.readFileSync(sourcePath);
const actual = createHash("sha256").update(bytes).digest("hex");
if (actual !== expectedHash) throw new Error("검토한 원본의 확인값과 다릅니다.");
const bundle = convertSchoolSchedule(JSON.parse(bytes.toString("utf8")), actual, schoolLevel as "중" | "고");
// Prepare only. Registration is a separate operation after validation in an isolated database.
fs.writeFileSync(outputPath, JSON.stringify(bundle, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ events: bundle.events.length, unknownDates: bundle.events.filter(event => event.status === "unknown").length,
  notHeld: bundle.events.filter(event => event.status === "not-held").length, sourceHash: actual }));
