import fs from "node:fs";
import path from "node:path";
import { test, expect } from "../fixtures/preview-run";
import { assignCanonicalRange, assignSingleRange } from "../support/vocab-journey";

for (const example of [false, true]) {
  test(`@authenticated 전환 호환 ${example ? "예문" : "뜻"} 학습·준비 읽기`, async ({ previewRun }) => {
    const student = await previewRun.createStudent(example ? "transition-example" : "transition-meaning");
    const expectedCount = example ? 5 : 4;
    const assignment = example
      ? await assignCanonicalRange(previewRun.adminPage, student, { datasetId: "d5b0a7e9-ea28-47de-94cf-c06b640ae995", questionMode: "canonical_example_to_headword", perQuestionSeconds: 8, questionCount: expectedCount })
      : ((await assignSingleRange(previewRun.adminPage, student, { datasetId: "b6100000-0000-4000-8000-000000000004", questionCount: 4, rangeMode: "all", scheduleEnabled: false, timeLimit: "none" })) as {
        assignments: Array<{ student_id: string; assignment_id: string; status: string }>;
      }).assignments.find(row => row.student_id === student.id && row.status === "assigned")!.assignment_id;
    expect(assignment).toMatch(/^[0-9a-f-]{36}$/);
    const page = await previewRun.openStudent(student);
    await page.goto(`/student/assignments/${assignment}/words`);
    await expect(page.getByRole("main").locator("h3[lang=en]")).toHaveCount(expectedCount);
    if (example) await expect(page.getByRole("main").locator("li p[lang=en]")).toHaveCount(expectedCount);
    const words = await page.getByRole("main").locator("h3[lang=en]").allTextContents();
    const response = await page.request.post(`/api/student/assignments/${assignment}/attempts`, { headers: { "x-quiz-preparation": "1" } });
    expect(response.status()).toBe(201);
    const { attemptId: preparation } = await response.json() as { attemptId: string };
    expect(preparation).toMatch(/^[0-9a-f-]{36}$/);
    // Read the actual server-rendered preparation without mounting its automatic ready command.
    const preparedPage = await page.request.get(`/student/attempt/${preparation}`);
    expect(preparedPage.status()).toBe(200);
    const html = await preparedPage.text();
    expect(html).toContain('id="quiz-prompt"');
    expect(html).not.toContain('data-dgst=');
    expect(words.some(word => html.includes(word))).toBe(true);
    const notStarted = await page.request.get(`/api/student/attempts/${preparation}`);
    expect(notStarted.status()).toBe(404);
    const folder = path.join(process.cwd(), "test-results", "transition-read");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${example ? "example" : "meaning"}.json`), JSON.stringify({ studentId: student.id, assignmentId: assignment, preparationId: preparation, wordCount: words.length, studyRendered: true, preparationRendered: true, attemptStatus: notStarted.status(), actualQuizStarted: false }, null, 2) + "\n");
  });
}
