// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WordbookLibrary } from "./wordbook-library";
import { EMPTY_LIBRARY_FILTERS, type LibraryCatalog, type LibraryCommand, type LibraryTemplate } from "../contracts/library";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function data(): LibraryCatalog {
  return { viewerId: id(99), scopes: [2024, 2025, 2026].map((year, i) => ({ id: id(i + 1), version: "a".repeat(64), name: `${year}년 주제 [23번]`, sourceTitle: `가짜 ${year}년 9월 원고`, availability: "available",
    source: { datasetId: id(10 + i), unitId: id(20 + i), kind: "exam_use", releaseId: id(30 + i), releaseVersion: "b".repeat(64), fileHash: "c".repeat(64), locator: "fake" },
    classification: { kind: "mock", sourceGrade: "g12", exam: { executionYear: year, examMonth: 9, examKind: "mock", academicYear: null, agency: "가짜", typeCode: "topic", typeLabel: "주제", questionNumbers: [23], sharedPassage: false },
      lesson: null, day: null, publisher: null, school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
    occurrences: [{ key: String(i + 1).repeat(64), sourceRow: 1, sourceEntryId: i + 1, rowHash: "d".repeat(64), state: "included" }],
  })), templates: [] };
}
const metadata = { title: "가짜 기말 템플릿", tags: ["직전 대비"], school: "가짜고", targetGrade: "g11", schoolYear: 2026, semester: 2 as const, assessment: "기말", purpose: "시험 준비" };
function existing(): LibraryTemplate {
  return { id: id(50), revision: 2, metadata, versions: [{ id: id(52), number: 2, contentHash: "e".repeat(64),
    recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: [{ id: id(2), version: "a".repeat(64) }], excludedOccurrenceKeys: [], scopeStatus: "confirmed" },
    includedKeys: ["2".repeat(64)], sourceCount: 1, sourceVersionId: id(51), datasetId: null, createdAt: "2026-09-20T01:00:00Z" },
  { id: id(51), number: 1, contentHash: "f".repeat(64), recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: [], excludedOccurrenceKeys: [], scopeStatus: "unconfirmed" },
    includedKeys: [], sourceCount: 0, sourceVersionId: null, datasetId: null, createdAt: "2026-09-20T00:00:00Z" }] };
}
let catalog: LibraryCatalog, postFailure = 0, getFailure = 0;
const requests: LibraryCommand[] = [];
beforeEach(() => {
  catalog = data(); postFailure = 0; getFailure = 0; requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    if (init?.method === "POST") {
      const c = JSON.parse(init.body) as LibraryCommand; requests.push(c);
      if (postFailure) { const status = postFailure; postFailure = 0; return new Response("{}", { status }); }
      const base = existing();
      if (c.action === "create") {
        base.metadata = c.metadata; base.revision = 1; base.versions = [{ ...base.versions[0]!, number: 1, recipe: c.recipe, sourceVersionId: null,
          includedKeys: c.recipe.scopes.flatMap(s => catalog.scopes.find(x => x.id === s.id)!.occurrences.filter(r => r.state === "included").map(r => r.key)), sourceCount: c.recipe.scopes.length }];
      } else if (c.action === "metadata") { base.metadata = c.metadata; base.revision = c.expectedRevision + 1; }
      else if (c.action === "copy") { base.id = id(60); base.metadata = c.metadata; base.revision = 1; base.versions = [{ ...base.versions.find(v => v.id === c.sourceVersionId)!, id: id(61), number: 1, sourceVersionId: c.sourceVersionId }]; }
      else if (c.action === "version") { base.revision = c.expectedRevision + 1; base.versions = [{ ...base.versions[0]!, id: id(70), number: 3, recipe: c.recipe }, ...base.versions]; }
      else if (c.action === "materialize") {
        base.versions[0]!.datasetId = id(80);
        return Response.json({ template: base, createdBook: { versionId: c.versionId, contentHash: c.contentHash, dataset: {
          id: id(80), title: metadata.title, displayName: metadata.title, edition: null, catalogGroup: "high", materialKind: "wordbook", gradeCode: "g11", publisher: null, seriesTitle: null,
          academicYear: 2026, curriculumRevision: null, editionLabel: null, isAssignable: true, catalogSortIndex: 0, schoolName: "가짜고", schoolClassification: "school", purpose: "exam_prep", semester: 2,
          isActive: true, rowCount: 4, status: "ready", questionBankKind: "vocabulary_composition_v1", availableQuestionModes: ["book_meaning_choice", "canonical_definition_to_headword"],
        } } });
      }
      return Response.json({ template: base });
    }
    if (getFailure) return new Response("{}", { status: getFailure });
    return Response.json(catalog);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function start() {
  render(<WordbookLibrary onBack={vi.fn()} />); await screen.findByText("이 조건에 맞는 자료가 없습니다.");
  fireEvent.click(screen.getByRole("button", { name: "범위로 새로 만들기" }));
  fireEvent.change(screen.getByLabelText("템플릿 이름"), { target: { value: "나의 템플릿" } });
}
describe("library real controls", () => {
  const prepared = (): LibraryCommand => ({ action: "create", requestId: id(90), metadata,
    recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: [catalog.scopes[2]!, catalog.scopes[0]!].map(s => ({ id: s.id, version: s.version })), excludedOccurrenceKeys: [], scopeStatus: "confirmed" } });
  const choosePrepared = (value: unknown, size = 100) => {
    const file = { size, text: vi.fn(async () => JSON.stringify(value)) };
    fireEvent.change(screen.getByLabelText("준비한 구성 불러오기"), { target: { files: [file] } });
    return file;
  };
  it("previews a prepared composition in its exact order without saving until requested", async () => {
    await start(); const command = prepared(); choosePrepared(command);
    await screen.findByText("준비한 구성을 불러왔습니다. 이름과 담은 범위를 확인한 뒤 저장해 주세요.");
    expect(screen.getByLabelText("템플릿 이름")).toHaveValue(metadata.title);
    expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" }));
    await screen.findByText("템플릿을 저장했습니다.");
    expect(requests).toEqual([command]);
  });
  it("keeps the prepared request id when a save response is uncertain", async () => {
    await start(); const command = prepared(); choosePrepared(command);
    await screen.findByText("준비한 구성을 불러왔습니다. 이름과 담은 범위를 확인한 뒤 저장해 주세요.");
    postFailure = 503; fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" }));
    fireEvent.click(await screen.findByRole("button", { name: "같은 내용으로 저장 확인" }));
    await screen.findByText("템플릿을 저장했습니다."); expect(requests).toEqual([command, command]);
  });
  it("preserves the prepared request when tags lose focus without any change", async () => {
    await start(); const command = prepared(); choosePrepared(command);
    await screen.findByText("준비한 구성을 불러왔습니다. 이름과 담은 범위를 확인한 뒤 저장해 주세요.");
    fireEvent.focus(screen.getByLabelText("찾기 태그 (쉼표로 구분)"));
    fireEvent.blur(screen.getByLabelText("찾기 태그 (쉼표로 구분)"));
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" })); await screen.findByText("템플릿을 저장했습니다.");
    expect(requests).toEqual([command]);
  });
  it("preserves the prepared request when an already selected filter is clicked again", async () => {
    await start(); const command = prepared(); choosePrepared(command);
    await screen.findByText("준비한 구성을 불러왔습니다. 이름과 담은 범위를 확인한 뒤 저장해 주세요.");
    fireEvent.click(screen.getAllByRole("button", { name: "전체" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" })); await screen.findByText("템플릿을 저장했습니다.");
    expect(requests).toEqual([command]);
  });
  it("locks edits and saving while a prepared file is still being read", async () => {
    await start(); const command = prepared(); let finish!: (text: string) => void;
    fireEvent.change(screen.getByLabelText("준비한 구성 불러오기"), { target: { files: [{ size: 100, text: () => new Promise<string>(resolve => { finish = resolve; }) }] } });
    await screen.findByText("준비한 구성을 읽는 중…");
    expect(screen.getByLabelText("템플릿 이름")).toBeDisabled(); expect(screen.getByRole("button", { name: "템플릿 저장" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" })); expect(requests).toHaveLength(0);
    await act(async () => { finish(JSON.stringify(command)); });
    await screen.findByText("준비한 구성을 불러왔습니다. 이름과 담은 범위를 확인한 뒤 저장해 주세요.");
    expect(screen.getByRole("button", { name: "템플릿 저장" })).toBeEnabled();
  });
  it.each(["unmount", "new-reader"])("discards late file contents after %s", async kind => {
    const onBack = vi.fn(); const view = render(<WordbookLibrary onBack={onBack} />);
    await screen.findByText("이 조건에 맞는 자료가 없습니다."); fireEvent.click(screen.getByRole("button", { name: "범위로 새로 만들기" }));
    fireEvent.change(screen.getByLabelText("템플릿 이름"), { target: { value: "남겨 둔 입력" } });
    let finish!: (text: string) => void; const command = prepared();
    fireEvent.change(screen.getByLabelText("준비한 구성 불러오기"), { target: { files: [{ size: 100, text: () => new Promise<string>(resolve => { finish = resolve; }) }] } });
    await screen.findByText("준비한 구성을 읽는 중…");
    if (kind === "unmount") view.unmount();
    else { view.rerender(<WordbookLibrary onBack={onBack} captureAuthenticationFailure={() => () => undefined} />); await act(async () => undefined); }
    await act(async () => { finish(JSON.stringify(command)); });
    expect(screen.queryByText("준비한 구성을 불러왔습니다. 이름과 담은 범위를 확인한 뒤 저장해 주세요.")).not.toBeInTheDocument();
    if (kind === "new-reader") expect(screen.getByLabelText("템플릿 이름")).toHaveValue("남겨 둔 입력");
    expect(requests).toHaveLength(0);
  });
  it("uses edited contents and a new request id after changing an imported draft", async () => {
    await start(); choosePrepared(prepared());
    await screen.findByText("준비한 구성을 불러왔습니다. 이름과 담은 범위를 확인한 뒤 저장해 주세요.");
    fireEvent.change(screen.getByLabelText("템플릿 이름"), { target: { value: "수정한 준비본" } });
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" })); await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]!.requestId).not.toBe(id(90));
    expect(requests[0]!.action === "create" && requests[0]!.metadata.title).toBe("수정한 준비본");
  });
  it.each(["wrong-environment", "changed-version", "unavailable", "not-create", "too-large"])("rejects %s and preserves the previous draft", async kind => {
    if (kind === "unavailable") catalog.scopes[2]!.availability = "changed";
    await start(); const command = prepared();
    if (command.action !== "create") throw new Error("fixture");
    if (kind === "wrong-environment") command.recipe.scopes[0]!.id = id(999);
    if (kind === "changed-version") command.recipe.scopes[0]!.version = "0".repeat(64);
    const value = kind === "not-create" ? { action: "copy", requestId: id(90), sourceVersionId: id(1), metadata } : command;
    const file = choosePrepared(value, kind === "too-large" ? 3 * 1024 * 1024 : 100);
    await screen.findByText("준비한 구성을 읽지 못했습니다. 현재 자료에 맞는 파일인지 확인해 주세요.");
    expect(screen.getByLabelText("템플릿 이름")).toHaveValue("나의 템플릿"); expect(requests).toHaveLength(0);
    if (kind === "too-large") expect(file.text).not.toHaveBeenCalled();
  });
  it("can load an unconfirmed empty template while keeping assignment unavailable", async () => {
    await start(); const command = prepared(); if (command.action !== "create") throw new Error("fixture");
    command.recipe.scopes = []; command.recipe.scopeStatus = "unconfirmed"; choosePrepared(command);
    await screen.findByText("준비한 구성을 불러왔습니다. 이름과 담은 범위를 확인한 뒤 저장해 주세요.");
    expect(screen.getByLabelText("아직 시험 범위를 정하지 않은 틀로 저장")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" })); await screen.findByText("템플릿을 저장했습니다.");
    expect(requests).toEqual([command]); expect(requests.some(r => r.action === "materialize")).toBe(false);
  });
  it("retries only the connection to exam settings after a confirmed save callback fails", async () => {
    catalog.templates = [existing()]; const onSaved = vi.fn().mockRejectedValueOnce(new Error("local callback")).mockResolvedValue(undefined);
    render(<WordbookLibrary onBack={vi.fn()} onSaved={onSaved} />); await screen.findByRole("heading", { name: metadata.title });
    fireEvent.click(screen.getByRole("button", { name: "이 범위로 단어장 만들기" }));
    await screen.findByText("단어장은 저장됐습니다. 다시 눌러 시험 설정에 연결해 주세요.");
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ dataset: expect.objectContaining({ gradeCode: "g11", schoolName: "가짜고", availableQuestionModes: ["book_meaning_choice", "canonical_definition_to_headword"] }) }));
    fireEvent.click(screen.getByRole("button", { name: "같은 내용으로 저장 확인" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(requests).toHaveLength(1); expect(requests[0]!.action).toBe("materialize");
    await waitFor(() => expect(screen.queryByText("단어장은 저장됐습니다. 다시 눌러 시험 설정에 연결해 주세요.")).not.toBeInTheDocument());
  });
  it("stores individual exclusions without promoting held source words", async () => {
    catalog.scopes[0]!.occurrences[0]!.headword = "sample"; catalog.scopes[0]!.occurrences[0]!.meaning = "가짜 뜻";
    catalog.scopes[0]!.occurrences.push({ ...catalog.scopes[0]!.occurrences[0]!, key: "a".repeat(64), sourceRow: 2, headword: "heldword", state: "held" });
    await start(); fireEvent.click(screen.getByLabelText(/2024년 주제/)); fireEvent.click(screen.getByText("단어별 포함·제외"));
    expect(screen.getByLabelText(/heldword/)).toBeDisabled(); fireEvent.click(screen.getByLabelText(/sample/));
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" })); await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ recipe: { excludedOccurrenceKeys: ["1".repeat(64)] } });
  });
  it("keeps independently selected ranges when the year interval changes and stores multiple tags", async () => {
    await start();
    fireEvent.change(screen.getByLabelText("시행연도 구간 시작"), { target: { value: "2024" } });
    fireEvent.change(screen.getByLabelText("시행연도 구간 끝"), { target: { value: "2025" } });
    fireEvent.click(screen.getByRole("button", { name: "현재 조건 범위 담기" }));
    expect(screen.getByText(/담은 범위 2개.*포함 2개/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("시행연도 구간 시작"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("시행연도 구간 끝"), { target: { value: "2026" } });
    expect(screen.getByText("현재 조건에서 보이지 않는 선택도 함께 보존됩니다.")).toBeVisible();
    const tags = screen.getByLabelText("찾기 태그 (쉼표로 구분)"); fireEvent.change(tags, { target: { value: "주제, 3개년" } }); fireEvent.blur(tags);
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" }));
    await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toMatchObject({ action: "create", metadata: { tags: ["주제", "3개년"] }, recipe: { scopes: [{ id: id(1) }, { id: id(2) }] } });
  });
  it("locks input on an unknown result and confirms the identical request without duplicating a template", async () => {
    await start(); fireEvent.click(screen.getByLabelText(/2024년 주제/)); postFailure = 503;
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" }));
    await screen.findByRole("button", { name: "같은 내용으로 저장 확인" });
    expect(screen.getByLabelText("템플릿 이름")).toBeDisabled(); expect(screen.getByRole("button", { name: "단어장 찾기로 돌아가기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "같은 내용으로 저장 확인" })); await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toEqual(requests[1]); expect(screen.getAllByText("나의 템플릿")).toHaveLength(1);
  });
  it("edits only metadata and copies a chosen old version while leaving its blank scope unassignable", async () => {
    catalog.templates = [existing()]; const use = vi.fn(); render(<WordbookLibrary onBack={vi.fn()} onSaved={use} />);
    await screen.findByRole("heading", { name: "가짜 기말 템플릿" });
    fireEvent.click(screen.getByRole("button", { name: "이름·태그 수정" }));
    fireEvent.change(screen.getByLabelText("템플릿 이름"), { target: { value: "가짜 이름 변경" } });
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" })); await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toMatchObject({ action: "metadata", expectedRevision: 2 }); expect(requests[0]).not.toHaveProperty("recipe");
    fireEvent.change(screen.getByLabelText("가짜 이름 변경 저장 버전"), { target: { value: id(51) } });
    expect(screen.getByRole("button", { name: "이 범위로 단어장 만들기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "복사" }));
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" }));
    await waitFor(() => expect(requests).toHaveLength(2)); expect(requests[1]).toMatchObject({ action: "copy", sourceVersionId: id(51) });
    expect(use).not.toHaveBeenCalled();
  });
  it("shows explicit row changes before saving a new version and preserves older versions", async () => {
    catalog.templates = [existing()]; render(<WordbookLibrary onBack={vi.fn()} />); await screen.findByRole("heading", { name: "가짜 기말 템플릿" });
    fireEvent.click(screen.getByRole("button", { name: "범위 바꾸기" }));
    fireEvent.click(screen.getByLabelText(/2024년 주제/));
    expect(screen.getByText("이전 버전과 비교: 추가 1개 · 빠짐 0개")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "새 버전 저장" })); await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toMatchObject({ action: "version", expectedRevision: 2, expectedContentHash: "e".repeat(64) });
    expect(within(screen.getByLabelText("가짜 기말 템플릿 저장 버전")).getAllByRole("option")).toHaveLength(3);
  });
  it("keeps load failures separate from empty results and hides all former metadata after auth failure", async () => {
    getFailure = 503; render(<WordbookLibrary onBack={vi.fn()} />);
    await screen.findByText("자료를 불러오지 못했습니다. 다시 시도해 주세요.");
    expect(screen.queryByText("이 조건에 맞는 자료가 없습니다.")).not.toBeInTheDocument();
    getFailure = 401; fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await screen.findByText("관리자 로그인이 필요합니다."); expect(screen.queryByLabelText("템플릿 검색")).not.toBeInTheDocument();
  });
  it("retains the draft across tabs and clears both displayed and saved tags only for an explicit fresh start", async () => {
    await start(); fireEvent.click(screen.getByLabelText(/2024년 주제/));
    fireEvent.click(screen.getByRole("button", { name: "2024년" }));
    const tags = screen.getByLabelText("찾기 태그 (쉼표로 구분)"); fireEvent.change(tags, { target: { value: "옛 태그" } }); fireEvent.blur(tags);
    fireEvent.click(screen.getByRole("button", { name: "저장한 템플릿 찾기" })); fireEvent.click(screen.getByRole("button", { name: "범위로 새로 만들기" }));
    expect(screen.getByLabelText("템플릿 이름")).toHaveValue("나의 템플릿"); expect(screen.getByLabelText("찾기 태그 (쉼표로 구분)")).toHaveValue("옛 태그");
    expect(screen.getByText(/담은 범위 1개.*포함 1개/)).toBeVisible(); expect(screen.getByRole("button", { name: "2024년" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "빈 틀로 새로 시작" }));
    expect(screen.getByLabelText("템플릿 이름")).toHaveValue(""); expect(screen.getByLabelText("찾기 태그 (쉼표로 구분)")).toHaveValue("");
  });
  it("preserves edits on conflict and uses the new revision only after showing the latest saved template", async () => {
    catalog.templates = [existing()]; render(<WordbookLibrary onBack={vi.fn()} />); await screen.findByRole("heading", { name: "가짜 기말 템플릿" });
    fireEvent.click(screen.getByRole("button", { name: "이름·태그 수정" })); fireEvent.change(screen.getByLabelText("템플릿 이름"), { target: { value: "보존할 입력" } });
    postFailure = 409; fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" }));
    await screen.findByText("자료가 변경되었습니다. 변경 내용을 다시 확인해 주세요.");
    catalog.templates[0]!.revision = 3; catalog.templates[0]!.metadata = { ...metadata, title: "다른 곳의 수정" };
    fireEvent.click(screen.getByRole("button", { name: "최신 자료 다시 확인" })); await screen.findByText("최신 수정: 다른 곳의 수정");
    expect(screen.getByLabelText("템플릿 이름")).toHaveValue("보존할 입력");
    fireEvent.click(screen.getByRole("button", { name: "현재 입력을 최신 버전에 이어서 검토" })); fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" }));
    await screen.findByText("템플릿을 저장했습니다.");
    expect(requests.map(r => "expectedRevision" in r ? r.expectedRevision : null)).toEqual([2, 3]);
  });
  it("reconfirms the same uncertain request after reauthentication and refuses to replay it under another administrator", async () => {
    await start(); fireEvent.click(screen.getByLabelText(/2024년 주제/)); postFailure = 503;
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" })); await screen.findByRole("button", { name: "같은 내용으로 저장 확인" });
    postFailure = 401; fireEvent.click(screen.getByRole("button", { name: "같은 내용으로 저장 확인" })); await screen.findByText("관리자 로그인이 필요합니다.");
    expect(screen.queryByLabelText("템플릿 이름")).not.toBeInTheDocument();
    catalog.viewerId = id(98); fireEvent.click(screen.getByRole("button", { name: "로그인 후 다시 확인" }));
    await screen.findByText("처음 저장한 관리자 계정으로 로그인한 뒤 결과를 확인해 주세요."); expect(requests).toHaveLength(2);
    catalog.viewerId = id(99); fireEvent.click(screen.getByRole("button", { name: "로그인 후 다시 확인" }));
    await screen.findByRole("button", { name: "같은 내용으로 저장 확인" });
    fireEvent.click(screen.getByRole("button", { name: "같은 내용으로 저장 확인" })); await screen.findByText("템플릿을 저장했습니다.");
    expect(requests).toHaveLength(3); expect(requests[0]).toEqual(requests[1]); expect(requests[1]).toEqual(requests[2]);
  });
  it("ignores an older delayed successful read after a write reports lost authorization", async () => {
    catalog.templates = [existing()]; const capture1 = () => vi.fn();
    const { rerender } = render(<WordbookLibrary onBack={vi.fn()} captureAuthenticationFailure={capture1} />);
    await screen.findByRole("heading", { name: "가짜 기말 템플릿" }); fireEvent.click(screen.getByRole("button", { name: "이름·태그 수정" }));
    const originalFetch = globalThis.fetch; let finish: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn((url, init) => init?.method === "POST" ? originalFetch(url, init) : new Promise<Response>(resolve => { finish = resolve; })));
    const capture2 = () => vi.fn(); rerender(<WordbookLibrary onBack={vi.fn()} captureAuthenticationFailure={capture2} />);
    postFailure = 401; fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" })); await screen.findByText("관리자 로그인이 필요합니다.");
    await act(async () => { finish(Response.json(catalog)); });
    expect(screen.getByText("관리자 로그인이 필요합니다.")).toBeVisible(); expect(screen.queryByLabelText("템플릿 이름")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그인 후 다시 확인" })).toBeEnabled();
  });
});
