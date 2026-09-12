import { expect, it } from "vitest";
import { catalogMetadata, type DatasetCatalogRow } from "@/lib/services/dataset-catalog-service";
import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import { assignmentDatasetDirectorySchema } from "../contracts/assignment-dataset-directory-schema";
import { EMPTY_DATASET_FILTERS } from "../domain/assignment-dataset-picker";
import { datasetPickerFilterButtons, datasetPickerKind, datasetPickerMetadata, datasetPickerTitle, filterDatasetPickerOptions } from "./assignment-dataset-picker-view";
const catalog: DatasetCatalogRow = { dataset_id: "fake", display_name: "공용 단어", catalog_group: "high", material_kind: "wordbook", grade_code: "g10", publisher: null,
  series_title: null, academic_year: null, curriculum_revision: null, edition_label: null, is_assignable: true, sort_index: 0 };
const book = (id: string, metadata: unknown, grade = "g10") => ({ dataset: { ...cataloguedDatasetFromMetadata({ id, title: "심석고 제목만" }, catalogMetadata({ ...catalog, grade_code: grade, metadata })), rowCount: 100, isActive: true, status: "ready" as const } });
it("공식 태그에서 학교/공통만 투영하고 원문 경로나 임의 메타를 노출하지 않는다", () => {
  const dataset = book("school", { school: " 심석고등학교 ", sourcePath: "private-path", secret: "do-not-send" }).dataset;
  expect(dataset).toMatchObject({ schoolName: "심석고등학교", schoolClassification: "school" });
  expect(JSON.stringify(dataset)).not.toMatch(/private-path|secret|metadata/);
  expect(book("unknown", {}).dataset.schoolClassification).toBe("unclassified");
  expect(book("common", { audience: "common" }).dataset.schoolClassification).toBe("common");
  expect(book("bad", { audience: "common", school: {} }).dataset.schoolClassification).toBe("unclassified");
  for (const school of [false, 0, " ", [], "x".repeat(121)]) expect(book("bad", { audience: "common", school }).dataset.schoolClassification).toBe("unclassified");
  expect(assignmentDatasetDirectorySchema.parse({ datasets: [dataset] }).datasets[0]).toMatchObject({ schoolName: "심석고등학교", schoolClassification: "school" });
});
it("선택 학교와 명시 공통만 함께 찾고 학년·종류·검색어를 교차 적용한다", () => {
  const options = [book("school", { school: "심석고등학교" }), book("common", { audience: "common" }), book("unknown", {}), book("other", { school: "다른고" }), book("g11", { school: "심석고등학교" }, "g11")];
  const filters = { ...EMPTY_DATASET_FILTERS, school: "school:심석고등학교", grade: "g10" };
  expect(filterDatasetPickerOptions(options, filters).map(item => item.dataset.id).sort()).toEqual(["common", "school"]);
  expect(datasetPickerFilterButtons(options, filters).school.find(option => option.value === filters.school)?.count).toBe(2);
  expect(filterDatasetPickerOptions(options, { ...filters, query: "심석고등학교" }).map(item => item.dataset.id)).toEqual(["school"]);
  expect(filterDatasetPickerOptions(options, { ...filters, kind: "textbook" })).toEqual([]);
});
it("교과서 제목의 실제 과목/저자/과와 출판사만 연결하고 반복하지 않는다", () => {
  const source = { ...book("fake", {}).dataset, displayName: "[공통영어 II] 오선영 1과 단어", materialKind: "textbook" as const, publisher: "NE능률" };
  expect(datasetPickerTitle(source)).toBe("[공통영어 2] NE능률 오선영 1과 단어");
  expect(source.displayName).toBe("[공통영어 II] 오선영 1과 단어");
  expect(datasetPickerTitle({ ...source, displayName: "[공통영어 II] NE능률 오선영 1과 단어" })).toBe("[공통영어 2] NE능률 오선영 1과 단어");
  expect(datasetPickerTitle({ ...source, displayName: "제목 미확인" })).toBe("제목 미확인 (NE능률)");
  expect(filterDatasetPickerOptions([{ dataset: source }], { ...EMPTY_DATASET_FILTERS, query: datasetPickerTitle(source) })).toHaveLength(1);
});
it("허용된 직전대비 용도와 숫자 학기만 공개 목록 계약을 통과한다", () => {
  const dataset = book("school", { school: "심석고등학교", purpose: "exam_prep", semester: 2, sourcePath: "private-source", answer: "hidden-answer" }).dataset;
  const parsed = assignmentDatasetDirectorySchema.parse({ datasets: [dataset] }).datasets[0]!;
  expect(parsed).toMatchObject({ purpose: "exam_prep", semester: 2, materialKind: "wordbook" });
  expect(JSON.stringify(parsed)).not.toMatch(/private-source|hidden-answer|sourcePath/);
  const transported = { ...dataset, ...parsed };
  expect(datasetPickerKind(transported)).toBe("exam_prep");
  expect(datasetPickerMetadata(transported)).toContain("직전대비");
  expect(datasetPickerMetadata(transported)).toContain("2학기");
  for (const semester of ["2", 0, 3, {}, null]) expect(book("invalid", { semester }).dataset.semester).toBeNull();
  for (const purpose of ["school_handout", "wordbook", {}, true]) expect(book("invalid", { purpose }).dataset.purpose).toBeNull();
  expect(assignmentDatasetDirectorySchema.safeParse({ datasets: [{ ...dataset, semester: 3 }] }).success).toBe(false);
});
it("고2·학교·직전대비·2학기에서 해당 세 자료만 표시하고 교과서 버튼을 만들지 않는다", () => {
  const school = { school: "심석고등학교", purpose: "exam_prep", semester: 2 };
  const options = [
    ...["lesson1", "lesson2", "mock"].map(id => ({ dataset: { ...book(id, school, "g11").dataset, materialKind: id === "mock" ? "exam_prep" as const : "textbook" as const } })),
    book("adjectives500", school), book("firstSemester", { ...school, semester: 1 }, "g11"),
    book("otherSchool", { ...school, school: "다른고등학교" }, "g11"),
    book("commonExam", { audience: "common", purpose: "exam_prep", semester: 2 }, "g11"),
    book("general", { school: "심석고등학교", semester: 2 }, "g11"),
    book("unknownSemester", { school: "심석고등학교", purpose: "exam_prep" }, "g11"),
  ];
  const filters = { ...EMPTY_DATASET_FILTERS, stage: "high" as const, kind: "exam_prep" as const, grade: "g11", school: "school:심석고등학교", semester: "2" as const };
  expect(filterDatasetPickerOptions(options, filters).map(({ dataset }) => dataset.id).sort()).toEqual(["lesson1", "lesson2", "mock"]);
  const buttons = datasetPickerFilterButtons(options, filters);
  expect(buttons.kind.map(button => button.value)).not.toContain("textbook");
  expect(buttons.kind.map(button => button.label)).not.toContain("교과서");
  expect(buttons.semester.find(button => button.value === "2")?.count).toBe(3);
  expect(filterDatasetPickerOptions(options, { ...filters, grade: "g10" }).map(({ dataset }) => dataset.id)).toEqual(["adjectives500"]);
  expect(filterDatasetPickerOptions(options, { ...filters, kind: "wordbook" }).map(({ dataset }) => dataset.id)).toEqual(["general"]);
  expect(filterDatasetPickerOptions(options, { ...filters, semester: "unclassified" }).map(({ dataset }) => dataset.id)).toEqual(["unknownSemester"]);
});
