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
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
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
      else if (c.action === "version") { if (c.metadata) base.metadata = c.metadata; base.revision = c.expectedRevision + 1; base.versions = [{ ...base.versions[0]!, id: id(70), number: 3, recipe: c.recipe }, ...base.versions]; }
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

async function start(addMock = true) {
  render(<WordbookLibrary onBack={vi.fn()} />); await screen.findByText("이 조건에 맞는 자료가 없습니다.");
  fireEvent.click(screen.getByRole("button", { name: "범위로 새로 만들기" }));
  fireEvent.change(screen.getByLabelText("템플릿 이름"), { target: { value: "나의 템플릿" } });
  if (addMock) fireEvent.click(screen.getByRole("button", { name: "모의고사 추가" }));
}
function addGist() {
  const s = structuredClone(catalog.scopes[0]!); s.id=id(4); s.name="2024년 요지 [22번]";
  s.classification.exam = { ...s.classification.exam!, typeCode:"gist",typeLabel:"요지",questionNumbers:[22] };
  s.occurrences = [{ ...s.occurrences[0]!,key:"4".repeat(64),sourceEntryId:4 }]; catalog.scopes.push(s);
}
function addTextbook() {
  const s = structuredClone(catalog.scopes[0]!); s.id=id(5); s.name="가짜 교과서 1과"; s.source.datasetId=id(15); s.sourceTitle="가짜 교과서";
  s.classification = { ...s.classification, kind:"textbook",exam:null,lesson:1 };
  s.occurrences = [{ ...s.occurrences[0]!,key:"5".repeat(64),sourceEntryId:5 }]; catalog.scopes.push(s);
}
describe("library source editor controls", () => {
  it("keeps a correlated manual selection on an already selected All click", async () => {
    addGist(); const extra=structuredClone(catalog.scopes.at(-1)!);extra.id=id(6);extra.classification.exam!.executionYear=2026;catalog.scopes.push(extra);
    const t=existing();t.versions[0]!.recipe.scopes=[catalog.scopes[0]!,extra].map(s=>({id:s.id,version:s.version}));catalog.templates=[t];
    const dirty=vi.fn();render(<WordbookLibrary onBack={vi.fn()} onDirtyChange={dirty} />);await screen.findByRole("heading",{name:metadata.title});
    fireEvent.click(screen.getByRole("button",{name:"범위 바꾸기"}));expect(screen.getByText(/개별 선택 범위입니다/)).toBeVisible();
    fireEvent.click(within(screen.getByRole("group",{name:"유형"})).getByRole("button",{name:"전체"}));
    expect(screen.getByText(/담은 범위 2개/)).toBeVisible();expect(dirty).not.toHaveBeenCalledWith(true);expect(requests).toHaveLength(0);
  });
  it("treats whitespace-only optional target fields as empty and preserves legacy tag search", async () => {
    catalog.templates=[{...existing(),metadata:{...metadata,tags:["꼭 외우기"]}}];render(<WordbookLibrary onBack={vi.fn()} />);await screen.findByRole("heading",{name:metadata.title});
    fireEvent.change(screen.getByLabelText("템플릿 검색"),{target:{value:"꼭 외우기"}});expect(screen.getByRole("heading",{name:metadata.title})).toBeVisible();
    fireEvent.change(screen.getByLabelText("템플릿 검색"),{target:{value:"꼭 외우기 2025 주제"}});expect(screen.getByRole("heading",{name:metadata.title})).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"이름·대상 수정"}));fireEvent.change(screen.getByLabelText("학교"),{target:{value:"   "}});
    expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeEnabled();fireEvent.click(screen.getByRole("button",{name:"템플릿 저장"}));await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toMatchObject({metadata:{school:null,tags:expect.arrayContaining(["꼭 외우기"])}});
  });
  it("blocks an empty confirmed template and shows field-specific errors with no POST", async () => {
    await start(false); fireEvent.change(screen.getByLabelText("템플릿 이름"), { target:{value:""} });
    expect(screen.getByLabelText("템플릿 이름")).toHaveAttribute("aria-invalid","true");
    expect(screen.getByText("템플릿 이름을 입력해 주세요.")).toBeVisible();
    expect(screen.getByText("자료 종류와 범위를 선택해 주세요.")).toBeVisible();
    expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"템플릿 저장"})); expect(requests).toHaveLength(0);
    expect(screen.queryByLabelText("준비한 구성 불러오기")).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"빈 틀로 새로 시작"})).not.toBeInTheDocument();
  });
  it("selects matching ranges immediately and changes the actual saved year range", async () => {
    await start(); expect(screen.getByText(/담은 범위 3개.*포함 3개/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("시행연도 구간 시작"),{target:{value:"2024"}});
    fireEvent.change(screen.getByLabelText("시행연도 구간 끝"),{target:{value:"2025"}});
    expect(screen.getByText(/담은 범위 2개.*포함 2개/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("시행연도 구간 시작"),{target:{value:"2026"}});
    expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeDisabled();
    expect(screen.getByText(/담은 범위 2개.*포함 2개/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("시행연도 구간 끝"),{target:{value:"2026"}});
    expect(screen.getByText(/담은 범위 1개.*포함 1개/)).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"템플릿 저장"})); await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toMatchObject({action:"create",recipe:{scopes:[{id:id(3)}]},metadata:{tags:expect.arrayContaining(["2026년 모고","주제"])}});
  });
  it("changes one group from topic to gist without retaining Q23 or removing a textbook", async () => {
    addGist(); addTextbook(); catalog.templates=[existing()];
    catalog.templates[0]!.versions[0]!.recipe.scopes=[{id:id(1),version:"a".repeat(64)}];
    render(<WordbookLibrary onBack={vi.fn()} />); await screen.findByRole("heading",{name:metadata.title});
    fireEvent.click(screen.getByRole("button",{name:"범위 바꾸기"}));
    fireEvent.click(screen.getByRole("button",{name:"교과서 추가"})); fireEvent.change(screen.getByLabelText("자료 선택"),{target:{value:id(15)}});
    expect(screen.queryByLabelText("시행연도 구간 시작")).not.toBeInTheDocument();
    expect(screen.getByRole("group",{name:"교과서 과"})).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"1. 모의고사 · 1개 범위"}));
    expect(screen.queryByRole("group",{name:"교과서 과"})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"요지"})); fireEvent.click(screen.getByRole("button",{name:"주제"}));
    expect(screen.getByText(/담은 범위 2개.*포함 2개/)).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"새 버전 저장"})); await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toMatchObject({action:"version",metadata:{tags:expect.arrayContaining(["요지","교과서"])},recipe:{scopes:[{id:id(4)},{id:id(5)}]}});
  });
  it("shows CSAT academic years and registered types without November or irrelevant DAY fields", async () => {
    const s=structuredClone(catalog.scopes[0]!); s.id=id(6);s.name="2025년 11월 장문";s.classification.kind="csat";
    s.classification.exam={...s.classification.exam!,executionYear:2025,academicYear:2026,examMonth:11,examKind:"csat",typeCode:"long_reading",typeLabel:"장문독해",questionNumbers:[41,42],sharedPassage:true};
    catalog.scopes.push(s); await start(false);fireEvent.click(screen.getByRole("button",{name:"수능 추가"}));
    expect(screen.getByRole("button",{name:"2025년 시행 · 2026학년도"})).toBeVisible();
    expect(screen.getByRole("button",{name:"주제 · 미등록"})).toBeDisabled();
    expect(screen.queryByRole("button",{name:"11월"})).not.toBeInTheDocument();
    expect(screen.queryByLabelText("DAY 구간 시작")).not.toBeInTheDocument();
    expect(screen.getByText(/현재 등록된 수능 유형: 장문독해/)).toBeVisible();
    expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeEnabled();
  });
  it("distinguishes a zero result and all-excluded words from a range-pending draft", async () => {
    await start();fireEvent.change(screen.getByLabelText("시행연도 구간 시작"),{target:{value:"2099"}});
    expect(screen.getByText(/이 조건에 맞는 등록 자료가 없습니다/)).toBeVisible();
    expect(screen.getByText(/담은 범위 0개/)).toBeVisible();expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeDisabled();
    fireEvent.click(screen.getByLabelText("범위를 나중에 정할 예정입니다"));fireEvent.click(screen.getByRole("button",{name:"템플릿 저장"}));
    await screen.findByText("템플릿을 저장했습니다.");expect(requests[0]).toMatchObject({recipe:{scopeStatus:"unconfirmed",scopes:[]}});
    expect(screen.getByRole("button",{name:"이 범위로 단어장 만들기"})).toBeDisabled();
  });
  it("blocks saving when every included word is excluded without promoting held words", async () => {
    catalog.scopes=catalog.scopes.slice(0,1);catalog.scopes[0]!.occurrences[0]!.headword="sample";
    catalog.scopes[0]!.occurrences.push({...catalog.scopes[0]!.occurrences[0]!,key:"a".repeat(64),sourceRow:2,headword:"heldword",state:"held"});
    await start();fireEvent.click(screen.getByText("단어별 포함·제외"));
    expect(screen.getByLabelText(/heldword/)).toBeDisabled();fireEvent.click(screen.getByLabelText(/sample/));
    expect(screen.getByText("포함할 단어가 없습니다. 범위 또는 단어별 제외를 확인해 주세요.")).toBeVisible();
    expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeDisabled();expect(requests).toHaveLength(0);
  });
  it("repairs an existing confirmed-empty template from its saved conditions without silently editing it on open", async () => {
    const t=existing();t.versions[0]!.recipe={filters:{...EMPTY_LIBRARY_FILTERS,kinds:["mock"],years:[2024]},scopes:[],excludedOccurrenceKeys:[],scopeStatus:"confirmed"};
    t.versions[0]!.includedKeys=[];catalog.templates=[t];render(<WordbookLibrary onBack={vi.fn()} />);await screen.findByRole("heading",{name:metadata.title});
    expect(screen.getByRole("button",{name:"이 범위로 단어장 만들기"})).toBeDisabled();fireEvent.click(screen.getByRole("button",{name:"범위 바꾸기"}));
    expect(screen.getByRole("button",{name:"새 버전 저장"})).toBeDisabled();expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole("button",{name:"저장된 조건으로 범위 채우기"}));
    expect(screen.getByText(/담은 범위 1개.*포함 1개/)).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"새 버전 저장"}));await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toMatchObject({action:"version",recipe:{scopes:[{id:id(1)}]}});
  });
  it("suggests a name but preserves a user's name through later changes", async () => {
    render(<WordbookLibrary onBack={vi.fn()} />);await screen.findByText("이 조건에 맞는 자료가 없습니다.");
    fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));fireEvent.click(screen.getByRole("button",{name:"모의고사 추가"}));
    expect((screen.getByLabelText("템플릿 이름") as HTMLInputElement).value).toContain("2024~2026년 모고");
    fireEvent.change(screen.getByLabelText("템플릿 이름"),{target:{value:"우리 반 주제"}});fireEvent.click(screen.getByRole("button",{name:"2024년"}));
    expect(screen.getByLabelText("템플릿 이름")).toHaveValue("우리 반 주제");expect(screen.getByLabelText("자동 태그")).toHaveTextContent("2024년 모고");
  });
  it("protects drafts across tabs and starts a genuinely new composition after discard", async () => {
    await start();fireEvent.click(screen.getByRole("button",{name:"저장한 템플릿 찾기"}));fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));
    expect(screen.getByRole("alertdialog")).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"계속 작성"}));
    fireEvent.click(screen.getByRole("button",{name:"작성 중인 구성 이어가기"}));expect(screen.getByLabelText("템플릿 이름")).toHaveValue("나의 템플릿");
    fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));fireEvent.click(screen.getByRole("button",{name:"변경 내용을 버리고 이동"}));
    expect(screen.getByLabelText("템플릿 이름")).toHaveValue("");expect(screen.getByText(/담은 범위 0개/)).toBeVisible();
  });
  it("resets the old edit mode when creating after a successful save", async () => {
    await start();fireEvent.click(screen.getByRole("button",{name:"템플릿 저장"}));await screen.findByText("템플릿을 저장했습니다.");
    fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));expect(screen.getByRole("heading",{name:"새 템플릿"})).toBeVisible();
    expect(screen.getByLabelText("템플릿 이름")).toHaveValue("");expect(screen.getByRole("button",{name:"모의고사 추가"})).toBeEnabled();
  });
  it("does not let an unsaved draft hijack another card's generation request", async () => {
    catalog.templates=[existing()];render(<WordbookLibrary onBack={vi.fn()} />);await screen.findByRole("heading",{name:metadata.title});
    fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));fireEvent.click(screen.getByRole("button",{name:"모의고사 추가"}));
    fireEvent.click(screen.getByRole("button",{name:"저장한 템플릿 찾기"}));fireEvent.click(screen.getByRole("button",{name:"이 범위로 단어장 만들기"}));
    expect(requests).toHaveLength(0);fireEvent.click(screen.getByRole("button",{name:"변경 내용을 버리고 이동"}));
    await waitFor(()=>expect(requests).toHaveLength(1));expect(requests[0]!.action).toBe("materialize");
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
  it("locks input on an unknown result and confirms the identical request without duplicating a template", async () => {
    await start(); postFailure = 503;
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" }));
    await screen.findByRole("button", { name: "같은 내용으로 저장 확인" });
    expect(screen.getByLabelText("템플릿 이름")).toBeDisabled(); expect(screen.getByRole("button", { name: "단어장 찾기로 돌아가기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "같은 내용으로 저장 확인" })); await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toEqual(requests[1]); expect(screen.getAllByText("나의 템플릿")).toHaveLength(1);
  });
  it("edits only metadata and copies a chosen old version while leaving its blank scope unassignable", async () => {
    catalog.templates = [existing()]; const use = vi.fn(); render(<WordbookLibrary onBack={vi.fn()} onSaved={use} />);
    await screen.findByRole("heading", { name: "가짜 기말 템플릿" });
    fireEvent.click(screen.getByRole("button", { name: "이름·대상 수정" }));
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
  it("keeps load failures separate from empty results and hides all former metadata after auth failure", async () => {
    getFailure = 503; render(<WordbookLibrary onBack={vi.fn()} />);
    await screen.findByText("자료를 불러오지 못했습니다. 다시 시도해 주세요.");
    expect(screen.queryByText("이 조건에 맞는 자료가 없습니다.")).not.toBeInTheDocument();
    getFailure = 401; fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await screen.findByText("관리자 로그인이 필요합니다."); expect(screen.queryByLabelText("템플릿 검색")).not.toBeInTheDocument();
  });
  it("preserves edits on conflict and uses the new revision only after showing the latest saved template", async () => {
    catalog.templates = [existing()]; render(<WordbookLibrary onBack={vi.fn()} />); await screen.findByRole("heading", { name: "가짜 기말 템플릿" });
    fireEvent.click(screen.getByRole("button", { name: "이름·대상 수정" })); fireEvent.change(screen.getByLabelText("템플릿 이름"), { target: { value: "보존할 입력" } });
    postFailure = 409; fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" }));
    await screen.findByText("자료가 변경되었습니다. 변경 내용을 다시 확인해 주세요.");
    catalog.templates[0]!.revision = 3; catalog.templates[0]!.metadata = { ...metadata, title: "다른 곳의 수정" };
    fireEvent.click(screen.getByRole("button", { name: "최신 자료 다시 확인" })); await screen.findByText("다른 곳의 수정");
    expect(screen.getByLabelText("템플릿 이름")).toHaveValue("보존할 입력");
    fireEvent.click(screen.getByRole("button", { name: "현재 입력을 최신 버전에 이어서 검토" })); fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" }));
    await screen.findByText("템플릿을 저장했습니다.");
    expect(requests.map(r => "expectedRevision" in r ? r.expectedRevision : null)).toEqual([2, 3]);
  });
  it("reconfirms the same uncertain request after reauthentication and refuses to replay it under another administrator", async () => {
    await start(); postFailure = 503;
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
    await screen.findByRole("heading", { name: "가짜 기말 템플릿" }); fireEvent.click(screen.getByRole("button", { name: "이름·대상 수정" }));
    const originalFetch = globalThis.fetch; let finish: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn((url, init) => init?.method === "POST" ? originalFetch(url, init) : new Promise<Response>(resolve => { finish = resolve; })));
    const capture2 = () => vi.fn(); rerender(<WordbookLibrary onBack={vi.fn()} captureAuthenticationFailure={capture2} />);
    postFailure = 401; fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" })); await screen.findByText("관리자 로그인이 필요합니다.");
    await act(async () => { finish(Response.json(catalog)); });
    expect(screen.getByText("관리자 로그인이 필요합니다.")).toBeVisible(); expect(screen.queryByLabelText("템플릿 이름")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그인 후 다시 확인" })).toBeEnabled();
  });
  it("can reconfirm an uncertain write after a delayed non-authentication read failure", async () => {
    catalog.templates=[existing()];const capture1=()=>vi.fn();
    const {rerender}=render(<WordbookLibrary onBack={vi.fn()} captureAuthenticationFailure={capture1} />);
    await screen.findByRole("heading",{name:metadata.title});fireEvent.click(screen.getByRole("button",{name:"이름·대상 수정"}));
    const originalFetch=globalThis.fetch;let finish:(response:Response)=>void=()=>undefined;
    vi.stubGlobal("fetch",vi.fn((url,init)=>init?.method==="POST"?originalFetch(url,init):new Promise<Response>(resolve=>{finish=resolve;})));
    rerender(<WordbookLibrary onBack={vi.fn()} captureAuthenticationFailure={()=>vi.fn()} />);
    postFailure=503;fireEvent.click(screen.getByRole("button",{name:"템플릿 저장"}));await screen.findByRole("button",{name:"같은 내용으로 저장 확인"});
    await act(async()=>{finish(new Response("{}",{status:503}));});
    expect(screen.getByRole("button",{name:"다시 불러오기"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"같은 내용으로 저장 확인"}));await screen.findByText("템플릿을 저장했습니다.");
    expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);
  });
});
