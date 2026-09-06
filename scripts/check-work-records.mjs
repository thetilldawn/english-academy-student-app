import { collectChangedImpact } from "./feature-map/change-impact.mjs";
import { createContext, loadRecords } from "./work-records/context.mjs";
import { captureFingerprint } from "./work-records/evidence.mjs";
import { TRACKING_FROM } from "./work-records/schema.mjs";
import { validateChangedCoverage, validateRecord } from "./work-records/validation.mjs";

function argumentsFor(args) {
  const options = { phase: "format", changed: false, work: null };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (seen.has(arg)) throw new Error("중복 옵션: " + arg);
    seen.add(arg);
    if (arg === "--changed") options.changed = true;
    else if (["--phase", "--work"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("옵션 값 누락: " + arg);
      options[arg.slice(2)] = value;
    } else throw new Error("알 수 없는 옵션: " + arg);
  }
  if (!["format", "design", "complete", "fingerprint"].includes(options.phase)) throw new Error("알 수 없는 검사 단계");
  if (["complete", "fingerprint"].includes(options.phase) && !options.work) throw new Error("완료/지문 확인에는 --work 작업번호가 필요합니다.");
  if (options.changed && options.phase !== "design") throw new Error("Git 변경 검사는 --phase design에서만 실행합니다.");
  if (options.changed && options.work) throw new Error("변경 검사는 모든 작업 기록을 함께 확인합니다. --work를 빼세요.");
  return options;
}

try {
  const options = argumentsFor(process.argv.slice(2));
  const context = createContext(process.cwd());
  const records = loadRecords(context.root);
  const formatErrors = records.flatMap((record) => validateRecord(record, context).map((error) => record.id + ": " + error));
  if (new Set(records.map((record) => record.id)).size !== records.length) formatErrors.push("작업 번호 중복");
  if (formatErrors.length) throw new Error(formatErrors.join("\n"));
  const selected = options.work ? records.filter((record) => record.id === options.work) : records;
  if (!selected.length) throw new Error("작업 기록 없음: " + options.work);
  const phase = options.phase === "fingerprint" ? "design" : options.phase;
  // Changed mode validates records that cover changes; old records remain historical evidence.
  const errors = options.changed ? validateChangedCoverage(collectChangedImpact(context.registry, TRACKING_FROM), records, context)
    : selected.flatMap((record) => validateRecord(record, context, phase).map((error) => record.id + ": " + error));
  if (errors.length) throw new Error(errors.join("\n"));
  if (options.phase === "fingerprint") console.log(JSON.stringify(captureFingerprint(selected[0], context), null, 2));
  else console.log(`작업 기록 ${options.phase}${options.changed ? " + 변경 연결" : ""} 검사 통과 (${selected.length}건). 자동검사는 누락·불일치만 확인합니다.`);
} catch (error) {
  console.error("작업 기록 검사 실패\n" + error.message);
  process.exitCode = 1;
}
