// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { libraryQuerySchema, type LibraryCriteria } from "../contracts/library-query";
import type { LibraryCommandV2 as LibraryCommand } from "../contracts/library-command-v2";
import { queryFixture, versionSummary } from "./library-query.fixture";
import { WordbookLibrary } from "./wordbook-library";
import { EMPTY_LIBRARY_FILTERS, type LibraryCatalog, type LibraryTemplate } from "../contracts/library";

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
const requests: LibraryCommand[] = [], queries: string[] = [], savedCriteria = new Map<string, LibraryCriteria>();
const summary = (t: LibraryTemplate) => ({ id:t.id, revision:t.revision, metadata:t.metadata, latestVersion:versionSummary(t.versions[0]!,savedCriteria.has(t.versions[0]!.id)) });
function useCriteria(years: number[] = []) {
  return { groups:[{ id:"mock",kind:"mock" as const,datasetId:null,mode:"filter" as const,filters:{...EMPTY_LIBRARY_FILTERS,kinds:["mock" as const],years},scopes:[],excludedScopeKeys:[] }],excludedOccurrenceKeys:[],scopeStatus:"confirmed" as const };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  catalog=data();postFailure=0;getFailure=0;requests.length=0;queries.length=0;savedCriteria.clear();
  vi.stubGlobal("fetch",vi.fn(async (url,init) => {
    if(String(url).endsWith("/query")) {
      const q=libraryQuerySchema.parse(JSON.parse(init.body)); queries.push(q.kind);
      if(getFailure) return new Response("{}",{status:getFailure});
      try { return Response.json(queryFixture(q,catalog,savedCriteria)); } catch { return new Response("{}",{status:409}); }
    }
    const c=JSON.parse(init.body) as LibraryCommand;requests.push(c);
    if(postFailure) { const status=postFailure;postFailure=0;return new Response("{}",{status}); }
    if(c.action==="delete") { catalog.templates=catalog.templates.filter(t=>t.id!==c.templateId);return Response.json({deleted:{templateId:c.templateId,revision:c.expectedRevision+1}}); }
    const base=structuredClone("templateId" in c ? catalog.templates.find(t=>t.id===c.templateId) ?? existing() : existing());
    if(c.action==="create" || c.action==="version") {
      base.metadata=c.metadata;base.revision=c.action==="create"?1:c.expectedRevision+1;
      const v={...base.versions[0]!,id:c.action==="create"?id(52):id(70),number:c.action==="create"?1:3,recipe:c.recipe,contentHash:c.previewHash,sourceVersionId:c.action==="create"?null:base.versions[0]!.id,
        includedKeys:c.recipe.scopes.flatMap(s=>catalog.scopes.find(x=>x.id===s.id)!.occurrences.filter(r=>r.state==="included"&&!c.recipe.excludedOccurrenceKeys.includes(r.key)).map(r=>r.key)),sourceCount:c.recipe.scopes.length};
      base.versions=c.action==="create"?[v]:[v,...base.versions];if(c.criteria)savedCriteria.set(v.id,c.criteria);
    } else if(c.action==="metadata") { base.metadata=c.metadata;base.revision=c.expectedRevision+1; }
    else if(c.action==="copy") { const source=catalog.templates.flatMap(t=>t.versions).find(v=>v.id===c.sourceVersionId)!;base.id=id(60);base.metadata=c.metadata;base.revision=1;base.versions=[{...source,id:id(61),number:1,sourceVersionId:source.id}]; }
    catalog.templates=[base,...catalog.templates.filter(t=>t.id!==base.id)];
    if(c.action==="materialize") return Response.json({template:summary(base),createdBook:{versionId:c.versionId,contentHash:c.contentHash,dataset:{
      id:id(80),title:base.metadata.title,displayName:base.metadata.title,edition:null,catalogGroup:"high",materialKind:"wordbook",gradeCode:"g11",publisher:null,seriesTitle:null,
      academicYear:2026,curriculumRevision:null,editionLabel:null,isAssignable:true,catalogSortIndex:0,schoolName:"가짜고",schoolClassification:"school",purpose:"exam_prep",semester:2,
      isActive:true,rowCount:4,status:"ready",questionBankKind:"vocabulary_composition_v1",availableQuestionModes:["book_meaning_choice","canonical_definition_to_headword"],
    }}});
    return Response.json({template:summary(base)});
  }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function start(addMock=true) {
  render(<WordbookLibrary onBack={vi.fn()} />);await screen.findByText("이 조건에 맞는 템플릿이 없습니다.");
  fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));
  fireEvent.change(screen.getByLabelText("템플릿 이름"),{target:{value:"나의 템플릿"}});
  if(addMock) {fireEvent.click(screen.getByRole("button",{name:"모의고사 추가"}));await screen.findByLabelText("시행연도 구간 시작");await waitFor(()=>expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeEnabled());}
}
async function openExisting(mode="이름·대상 수정",onSaved?:()=>void) {
  render(<WordbookLibrary onBack={vi.fn()} onSaved={onSaved} />);await screen.findByRole("heading",{name:catalog.templates[0]!.metadata.title});
  fireEvent.click(screen.getByRole("button",{name:mode}));await screen.findByLabelText("템플릿 이름");
}
async function clickSave(name="템플릿 저장") { await waitFor(()=>expect(screen.getByRole("button",{name})).toBeEnabled());fireEvent.click(screen.getByRole("button",{name})); }
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
describe("library editor with on-demand query boundaries", () => {
  it("fetches another template page only on demand and resets to a new search", async () => {
    catalog.templates=Array.from({length:25},(_,i)=>({...existing(),id:id(100+i),metadata:{...metadata,title:`가짜 목록 ${String(i+1).padStart(2,"0")}`}}));
    render(<WordbookLibrary onBack={vi.fn()} />);await screen.findByRole("heading",{name:"가짜 목록 20"});expect(screen.queryByRole("heading",{name:"가짜 목록 21"})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"템플릿 20개 더 보기"}));await screen.findByRole("heading",{name:"가짜 목록 25"});expect(queries).toEqual(["templates","templates"]);
    fireEvent.change(screen.getByLabelText("템플릿 검색"),{target:{value:"가짜 목록 25"}});await waitFor(()=>expect(screen.queryByRole("heading",{name:"가짜 목록 01"})).not.toBeInTheDocument());await screen.findByRole("heading",{name:"가짜 목록 25"});
    expect(screen.queryByRole("button",{name:"템플릿 20개 더 보기"})).not.toBeInTheDocument();
  });
  it("loads the next fifty words only when requested", async () => {
    const source=catalog.scopes[0]!.occurrences[0]!;catalog.scopes[0]!.occurrences=Array.from({length:55},(_,i)=>({...source,key:(100+i).toString(16).padStart(64,"0"),sourceRow:i+1,headword:`word${i+1}`,meaning:`뜻 ${i+1}`}));
    await start();expect(queries).not.toContain("words");fireEvent.click(screen.getByText("단어별 포함·제외"));await screen.findByText("57개 중 50개 표시");expect(screen.queryByText("word55")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"단어 50개 더 보기"}));await screen.findByText("57개 중 57개 표시");expect(screen.getByText("word55")).toBeVisible();expect(queries.filter(q=>q==="words")).toHaveLength(2);
  });
  it("requests only template summaries initially and reads versions and details on opening", async () => {
    catalog.templates=[existing()];render(<WordbookLibrary onBack={vi.fn()} />);await screen.findByRole("heading",{name:metadata.title});
    expect(queries).toEqual(["templates"]);fireEvent.click(screen.getByText("이전 저장 버전 보기"));await screen.findByLabelText(`${metadata.title} 저장 버전`);
    expect(queries).toEqual(["templates","versions"]);fireEvent.click(screen.getByRole("button",{name:"이름·대상 수정"}));await screen.findByLabelText("템플릿 이름");
    expect(queries).toContain("detail");expect(queries).not.toContain("words");expect(queries).not.toContain("scopes");
  });
  it("preserves manual student targets and ranges when the initial student context changes", async () => {
    const onBack=vi.fn(),target={school:"가상고",targetGrade:"g11",semester:2 as const,schoolYear:2026};
    const {rerender}=render(<WordbookLibrary onBack={onBack} initialTarget={target} />);await screen.findByText("이 조건에 맞는 템플릿이 없습니다.");
    fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));fireEvent.click(screen.getByRole("button",{name:"모의고사 추가"}));
    fireEvent.change(screen.getByLabelText("학교"),{target:{value:"수동 학교"}});rerender(<WordbookLibrary onBack={onBack} initialTarget={{...target,school:"전학고",targetGrade:"g12",semester:1}} />);
    expect(screen.getByLabelText("학교")).toHaveValue("수동 학교");expect(screen.getByLabelText("사용 대상 학년")).toHaveValue("g12");expect(screen.getByLabelText("학기")).toHaveValue("1");
    await screen.findByText(/담은 범위 3개/);expect(requests).toHaveLength(0);
  });
  it("keeps a saved template target even if another student's defaults arrive", async () => {
    catalog.templates=[existing()];const onBack=vi.fn();const {rerender}=render(<WordbookLibrary onBack={onBack} initialTarget={{school:"다른고",targetGrade:"g12",semester:1,schoolYear:2027}} />);
    await screen.findByRole("heading",{name:metadata.title});fireEvent.click(screen.getByRole("button",{name:"이름·대상 수정"}));await screen.findByLabelText("학교");
    rerender(<WordbookLibrary onBack={onBack} initialTarget={{school:"새 학교",targetGrade:"g10",semester:1,schoolYear:2028}} />);
    expect(screen.getByLabelText("학교")).toHaveValue(metadata.school);expect(screen.getByLabelText("사용 대상 학년")).toHaveValue(metadata.targetGrade);expect(requests).toHaveLength(0);
  });
  it("keeps exact correlated legacy references without inferring filters or dirtying the draft", async () => {
    addGist();const t=existing();t.versions[0]!.recipe.scopes=[catalog.scopes[0]!,catalog.scopes[3]!].map(s=>({id:s.id,version:s.version}));catalog.templates=[t];
    const dirty=vi.fn();render(<WordbookLibrary onBack={vi.fn()} onDirtyChange={dirty} />);await screen.findByRole("heading",{name:metadata.title});fireEvent.click(screen.getByRole("button",{name:"범위 바꾸기"}));
    await screen.findByText(/직접 선택해 저장한 범위와 순서를 유지/);await screen.findByText(/담은 범위 2개/);expect(screen.queryByRole("group",{name:"유형"})).not.toBeInTheDocument();expect(dirty).not.toHaveBeenCalledWith(true);expect(requests).toHaveLength(0);
  });
  it("normalizes whitespace for preview and save while retaining legacy tags", async () => {
    catalog.templates=[{...existing(),metadata:{...metadata,tags:["꼭 외우기"]}}];await openExisting();
    fireEvent.change(screen.getByLabelText("학교"),{target:{value:"   "}});await clickSave();await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toMatchObject({metadata:{school:null,tags:expect.arrayContaining(["꼭 외우기"])}});
    fireEvent.change(screen.getByLabelText("템플릿 검색"),{target:{value:"꼭 외우기 2학기"}});await screen.findByRole("heading",{name:metadata.title});
    fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));fireEvent.click(screen.getByRole("button",{name:"모의고사 추가"}));fireEvent.change(screen.getByLabelText("용도 (선택)"),{target:{value:"   "}});
    await screen.findByText(/담은 범위 3개/);await waitFor(()=>expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeEnabled());
  });
  it("blocks empty confirmed scopes and displays required errors beside inputs", async () => {
    await start(false);fireEvent.change(screen.getByLabelText("템플릿 이름"),{target:{value:""}});
    expect(screen.getByLabelText("템플릿 이름")).toHaveAttribute("aria-invalid","true");expect(screen.getByText("자료 종류와 범위를 선택해 주세요.")).toBeVisible();
    expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeDisabled();expect(requests).toHaveLength(0);expect(screen.queryByLabelText("준비한 구성 불러오기")).not.toBeInTheDocument();
  });
  it("recalculates inclusive year ranges and preserves the prior selection during invalid input", async () => {
    await start();fireEvent.change(screen.getByLabelText("시행연도 구간 시작"),{target:{value:"2024"}});fireEvent.change(screen.getByLabelText("시행연도 구간 끝"),{target:{value:"2025"}});
    await screen.findByText(/담은 범위 2개.*포함 2개/);fireEvent.change(screen.getByLabelText("시행연도 구간 시작"),{target:{value:"2026"}});
    expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeDisabled();expect(screen.getByText(/담은 범위 2개/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("시행연도 구간 끝"),{target:{value:"2026"}});await screen.findByText(/담은 범위 1개.*포함 1개/);await clickSave();await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toMatchObject({action:"create",criteria:{groups:[{mode:"filter",filters:{yearFrom:2026,yearTo:2026}}]},recipe:{scopes:[{id:id(3)}]}});
  });
  it("clears obsolete question constraints when switching type and preserves another textbook group", async () => {
    addGist();addTextbook();await start();fireEvent.click(screen.getByRole("button",{name:"주제"}));fireEvent.click(screen.getByText("문제번호로 더 좁히기"));fireEvent.click(screen.getByRole("button",{name:"23번"}));
    fireEvent.click(screen.getByRole("button",{name:"교과서 추가"}));await screen.findByLabelText("자료 선택");fireEvent.change(screen.getByLabelText("자료 선택"),{target:{value:id(15)}});await screen.findByRole("group",{name:"교과서 과"});
    expect(screen.queryByLabelText("시행연도 구간 시작")).not.toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:/1. 모의고사/}));await screen.findByRole("button",{name:"요지"});
    fireEvent.click(screen.getByRole("button",{name:"요지"}));fireEvent.click(screen.getByRole("button",{name:"주제"}));await screen.findByText(/담은 범위 2개.*포함 2개/);await clickSave();await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toMatchObject({recipe:{scopes:[{id:id(4)},{id:id(5)}]},criteria:{groups:[{filters:{types:["gist"],questions:[]}},{kind:"textbook"}]}});
  });
  it("shows CSAT academic years and registered long reading without November or DAY inputs", async () => {
    const s=structuredClone(catalog.scopes[0]!);s.id=id(6);s.classification.kind="csat";s.classification.exam={...s.classification.exam!,executionYear:2025,academicYear:2026,examMonth:11,examKind:"csat",typeCode:"long_reading",typeLabel:"장문독해",questionNumbers:[41,42],sharedPassage:true};catalog.scopes.push(s);
    await start(false);fireEvent.click(screen.getByRole("button",{name:"수능 추가"}));await screen.findByRole("button",{name:"2025년 시행 · 2026학년도"});
    expect(screen.getByRole("button",{name:"주제 · 미등록"})).toBeDisabled();expect(screen.queryByRole("button",{name:"11월"})).not.toBeInTheDocument();expect(screen.queryByLabelText("DAY 구간 시작")).not.toBeInTheDocument();await waitFor(()=>expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeEnabled());
  });
  it("separates empty results from a deliberately unconfirmed template", async () => {
    await start();fireEvent.change(screen.getByLabelText("시행연도 구간 시작"),{target:{value:"2099"}});await screen.findByText(/담은 범위 0개/);expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeDisabled();
    fireEvent.click(screen.getByLabelText("범위를 나중에 정할 예정입니다"));await clickSave();await screen.findByText("템플릿을 저장했습니다.");await screen.findByRole("heading",{name:"나의 템플릿"});
    expect(requests[0]).toMatchObject({recipe:{scopeStatus:"unconfirmed",scopes:[]}});expect(screen.getByRole("button",{name:"이 범위로 단어장 만들기"})).toBeDisabled();
  });
  it("loads words only after expansion and blocks all exclusions without promoting held words", async () => {
    catalog.scopes[0]!.occurrences[0]!.headword="sample";catalog.scopes[0]!.occurrences.push({...catalog.scopes[0]!.occurrences[0]!,key:"a".repeat(64),sourceRow:2,headword:"heldword",state:"held"});
    await start();fireEvent.click(screen.getByRole("button",{name:"2024년"}));await screen.findByText(/담은 범위 1개/);expect(queries).not.toContain("words");
    fireEvent.click(screen.getByText("단어별 포함·제외"));await screen.findByLabelText(/heldword/);expect(screen.getByLabelText(/heldword/)).toBeDisabled();fireEvent.click(screen.getByLabelText(/sample/));
    await screen.findByText("포함할 단어가 없습니다. 범위 또는 단어별 제외를 확인해 주세요.");expect(screen.getByRole("button",{name:"템플릿 저장"})).toBeDisabled();
  });
  it("opens old empty snapshots unchanged and requires an explicit new group to repair them", async () => {
    const t=existing();t.versions[0]!.recipe.scopes=[];t.versions[0]!.includedKeys=[];catalog.templates=[t];await openExisting("범위 바꾸기");
    expect(screen.getByRole("button",{name:"새 버전 저장"})).toBeDisabled();expect(requests).toHaveLength(0);fireEvent.click(screen.getByRole("button",{name:"모의고사 추가"}));await screen.findByRole("button",{name:"2024년"});fireEvent.click(screen.getByRole("button",{name:"2024년"}));await screen.findByText(/담은 범위 1개/);await clickSave("새 버전 저장");await screen.findByText("템플릿을 저장했습니다.");
    expect(requests[0]).toMatchObject({recipe:{scopes:[{id:id(1)}]}});
  });
  it("suggests automatic tags and keeps a manually edited title through filter changes", async () => {
    await start();fireEvent.click(screen.getByRole("button",{name:"범위에 맞는 이름 다시 제안"}));await waitFor(()=>expect((screen.getByLabelText("템플릿 이름") as HTMLInputElement).value).toContain("2024~2026년 모고"));
    fireEvent.change(screen.getByLabelText("템플릿 이름"),{target:{value:"우리 반 주제"}});fireEvent.click(screen.getByRole("button",{name:"2024년"}));await waitFor(()=>expect(screen.getByLabelText("자동 태그")).toHaveTextContent("2024년 모고"));expect(screen.getByLabelText("템플릿 이름")).toHaveValue("우리 반 주제");
  });
  it("protects drafts across tabs and resets after explicit discard", async () => {
    await start();fireEvent.click(screen.getByRole("button",{name:"저장한 템플릿 찾기"}));fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));expect(screen.getByRole("alertdialog")).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"계속 작성"}));
    fireEvent.click(screen.getByRole("button",{name:"작성 중인 구성 이어가기"}));expect(screen.getByLabelText("템플릿 이름")).toHaveValue("나의 템플릿");fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));fireEvent.click(screen.getByRole("button",{name:"변경 내용을 버리고 이동"}));await screen.findByText(/담은 범위 0개/);expect(screen.getByLabelText("템플릿 이름")).toHaveValue("");
  });
  it("starts a fresh create mode after saving", async () => {
    await start();await clickSave();await screen.findByText("템플릿을 저장했습니다.");fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));expect(screen.getByRole("heading",{name:"새 템플릿"})).toBeVisible();expect(screen.getByLabelText("템플릿 이름")).toHaveValue("");
  });
  it("requires range-change confirmation when a filter template now includes more sources", async () => {
    catalog.templates=[existing()];savedCriteria.set(id(52),useCriteria());await openExisting("이 범위로 단어장 만들기");await screen.findByLabelText(/조건에 맞는 자료가 달라졌습니다/);
    expect(screen.getByRole("button",{name:"확인한 범위로 단어장 만들기"})).toBeDisabled();expect(screen.getByLabelText("범위를 나중에 정할 예정입니다")).toBeDisabled();fireEvent.click(screen.getByLabelText(/조건에 맞는 자료가 달라졌습니다/));await clickSave("확인한 범위로 단어장 만들기");
    await waitFor(()=>expect(requests.map(r=>r.action)).toEqual(["version","materialize"]));expect(requests[0]).toMatchObject({recipe:{scopes:expect.arrayContaining([{id:id(1),version:"a".repeat(64)}])}});
  });
  it("discards another draft before opening a saved template and waits for a deliberate creation click", async () => {
    catalog.templates=[existing()];render(<WordbookLibrary onBack={vi.fn()} />);await screen.findByRole("heading",{name:metadata.title});fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));fireEvent.click(screen.getByRole("button",{name:"모의고사 추가"}));fireEvent.click(screen.getByRole("button",{name:"저장한 템플릿 찾기"}));fireEvent.click(screen.getByRole("button",{name:"이 범위로 단어장 만들기"}));
    expect(requests).toHaveLength(0);fireEvent.click(screen.getByRole("button",{name:"변경 내용을 버리고 이동"}));await screen.findByLabelText("템플릿 이름");await screen.findByText(/담은 범위 1개/);expect(requests).toHaveLength(0);await clickSave("확인한 범위로 단어장 만들기");await waitFor(()=>expect(requests.at(-1)?.action).toBe("materialize"));
    expect(requests.find(r=>r.action==="version")).toMatchObject({recipe:{scopes:[{id:id(2)}]}});
  });
  it("retries only the local assignment connection after a confirmed book callback fails", async () => {
    catalog.templates=[existing()];const onSaved=vi.fn().mockRejectedValueOnce(new Error("local callback")).mockResolvedValue(undefined);await openExisting("이 범위로 단어장 만들기",onSaved);await clickSave("확인한 범위로 단어장 만들기");await screen.findByText("단어장은 저장됐습니다. 다시 눌러 시험 설정에 연결해 주세요.");
    const sent=requests.length;fireEvent.click(screen.getByRole("button",{name:"같은 내용으로 저장 확인"}));await waitFor(()=>expect(onSaved).toHaveBeenCalledTimes(2));expect(requests).toHaveLength(sent);
  });
  it("explains a saved book that has too few eligible questions instead of prompting assignment", async () => {
    const original=fetch;vi.stubGlobal("fetch",vi.fn(async(url,init)=>{const response=await original(url,init);if(String(url).endsWith("/commands")&&JSON.parse(init.body).action==="materialize") {const data=await response.json();data.createdBook.dataset.isAssignable=false;data.createdBook.dataset.availableQuestionModes=[];return Response.json(data);}return response;}));
    catalog.templates=[existing()];const onSaved=vi.fn();await openExisting("이 범위로 단어장 만들기",onSaved);await clickSave("확인한 범위로 단어장 만들기");await screen.findByText(/현재 출제 가능한 문제가 부족해 배정할 수 없습니다/);expect(onSaved).not.toHaveBeenCalled();
  });
  it("locks an uncertain write and retries precisely the same request", async () => {
    await start();postFailure=503;await clickSave();await screen.findByRole("button",{name:"같은 내용으로 저장 확인"});expect(screen.getByLabelText("템플릿 이름")).toBeDisabled();expect(screen.getByRole("button",{name:"단어장 찾기로 돌아가기"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"같은 내용으로 저장 확인"}));await screen.findByText("템플릿을 저장했습니다.");expect(requests[0]).toEqual(requests[1]);
  });
  it("edits metadata without a range command then copies an old unconfirmed version", async () => {
    catalog.templates=[existing()];await openExisting();fireEvent.change(screen.getByLabelText("템플릿 이름"),{target:{value:"가짜 이름 변경"}});await clickSave();await screen.findByText("템플릿을 저장했습니다.");await screen.findByRole("heading",{name:"가짜 이름 변경"});expect(requests[0]).toMatchObject({action:"metadata",expectedRevision:2});expect(requests[0]).not.toHaveProperty("recipe");
    fireEvent.click(screen.getByText("이전 저장 버전 보기"));await screen.findByLabelText("가짜 이름 변경 저장 버전");fireEvent.change(screen.getByLabelText("가짜 이름 변경 저장 버전"),{target:{value:id(51)}});fireEvent.click(screen.getByText("이전 저장 버전 보기"));await waitFor(()=>expect(screen.queryByLabelText("가짜 이름 변경 저장 버전")).not.toBeInTheDocument());expect(screen.getByRole("button",{name:"이 범위로 단어장 만들기"})).toBeDisabled();fireEvent.click(screen.getByRole("button",{name:"복사"}));await screen.findByLabelText("템플릿 이름");await clickSave();await waitFor(()=>expect(requests[1]).toMatchObject({action:"copy",sourceVersionId:id(51)}));
  });
  it("distinguishes query failures from empty data and hides private fields after authorization failure", async () => {
    getFailure=503;render(<WordbookLibrary onBack={vi.fn()} />);await screen.findByText("자료를 불러오지 못했습니다. 다시 시도해 주세요.");expect(screen.queryByText("이 조건에 맞는 템플릿이 없습니다.")).not.toBeInTheDocument();getFailure=401;fireEvent.click(screen.getByRole("button",{name:"다시 불러오기"}));await screen.findByText(/처음 저장한 관리자 계정으로 로그인한 뒤 확인/);expect(screen.queryByLabelText("템플릿 검색")).not.toBeInTheDocument();
  });
  it("preserves edits through a conflict and explicitly rebases the saved revision", async () => {
    catalog.templates=[existing()];await openExisting();fireEvent.change(screen.getByLabelText("템플릿 이름"),{target:{value:"보존할 입력"}});postFailure=409;await clickSave();await screen.findByText("자료가 변경되었습니다. 변경 내용을 다시 확인해 주세요.");catalog.templates[0]!.revision=3;catalog.templates[0]!.metadata.title="다른 곳의 수정";
    fireEvent.click(screen.getByRole("button",{name:"최신 자료 다시 확인"}));await screen.findByText("다른 곳의 수정");expect(screen.getByLabelText("템플릿 이름")).toHaveValue("보존할 입력");fireEvent.click(screen.getByRole("button",{name:"현재 입력을 최신 버전에 이어서 검토"}));await clickSave();await screen.findByText("템플릿을 저장했습니다.");expect(requests.map(r=>"expectedRevision" in r?r.expectedRevision:null)).toEqual([2,3]);
  });
  it("recovers the same uncertain request only under the original administrator", async () => {
    await start();postFailure=503;await clickSave();await screen.findByRole("button",{name:"같은 내용으로 저장 확인"});postFailure=401;fireEvent.click(screen.getByRole("button",{name:"같은 내용으로 저장 확인"}));await screen.findByRole("button",{name:"로그인 후 다시 확인"});
    catalog.viewerId=id(98);fireEvent.click(screen.getByRole("button",{name:"로그인 후 다시 확인"}));await waitFor(()=>expect(screen.getByRole("button",{name:"로그인 후 다시 확인"})).toBeEnabled());expect(requests).toHaveLength(2);
    catalog.viewerId=id(99);fireEvent.click(screen.getByRole("button",{name:"로그인 후 다시 확인"}));await screen.findByRole("button",{name:"같은 내용으로 저장 확인"});fireEvent.click(screen.getByRole("button",{name:"같은 내용으로 저장 확인"}));await screen.findByText("템플릿을 저장했습니다.");expect(requests[0]).toEqual(requests[2]);
  });
  it("discards a late conflict detail after switching to a new template", async () => {
    catalog.templates=[existing()];await openExisting();fireEvent.change(screen.getByLabelText("템플릿 이름"),{target:{value:"수정 중"}});postFailure=409;await clickSave();await screen.findByText("자료가 변경되었습니다. 변경 내용을 다시 확인해 주세요.");
    const original=fetch;let finish:(r:Response)=>void=()=>undefined;let signal:AbortSignal|undefined;
    vi.stubGlobal("fetch",vi.fn((url,init)=> {
      if(String(url).endsWith("/query")&&JSON.parse(init.body).kind==="detail") { signal=init.signal;return new Promise<Response>(resolve=>{finish=resolve;}); }
      return original(url,init);
    }));
    fireEvent.click(screen.getByRole("button",{name:"최신 자료 다시 확인"}));await waitFor(()=>expect(signal).toBeDefined());
    fireEvent.click(screen.getByRole("button",{name:"범위로 새로 만들기"}));fireEvent.click(screen.getByRole("button",{name:"변경 내용을 버리고 이동"}));expect(signal?.aborted).toBe(true);
    catalog.templates[0]!.revision=3;await act(async()=>finish(Response.json(queryFixture({kind:"detail",templateId:id(50)},catalog,savedCriteria))));
    expect(screen.getByRole("heading",{name:"새 템플릿"})).toBeVisible();expect(screen.queryByRole("button",{name:"현재 입력을 최신 버전에 이어서 검토"})).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("템플릿 이름"),{target:{value:"새 구성"}});fireEvent.click(screen.getByRole("button",{name:"모의고사 추가"}));await clickSave();await screen.findByText("템플릿을 저장했습니다.");expect(requests.at(-1)?.action).toBe("create");
  });
  it("does not let a delayed list success reopen an authentication failure", async () => {
    catalog.templates=[existing()];const capture1=()=>vi.fn();const {rerender}=render(<WordbookLibrary onBack={vi.fn()} captureAuthenticationFailure={capture1} />);await screen.findByRole("heading",{name:metadata.title});fireEvent.click(screen.getByRole("button",{name:"이름·대상 수정"}));await screen.findByLabelText("템플릿 이름");
    const original=fetch;let finish:(r:Response)=>void=()=>undefined;vi.stubGlobal("fetch",vi.fn((url,init)=>String(url).endsWith("/query")?new Promise<Response>(resolve=>{finish=resolve;}):original(url,init)));rerender(<WordbookLibrary onBack={vi.fn()} captureAuthenticationFailure={()=>vi.fn()} />);
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,300));});postFailure=401;await clickSave();await screen.findByRole("button",{name:"로그인 후 다시 확인"});await act(async()=>finish(Response.json(queryFixture(libraryQuerySchema.parse({kind:"templates",search:""}),catalog,savedCriteria))));expect(screen.queryByLabelText("템플릿 이름")).not.toBeInTheDocument();
  });
  it("can retry an uncertain write despite a delayed list failure", async () => {
    catalog.templates=[existing()];const capture1=()=>vi.fn();const {rerender}=render(<WordbookLibrary onBack={vi.fn()} captureAuthenticationFailure={capture1} />);await screen.findByRole("heading",{name:metadata.title});fireEvent.click(screen.getByRole("button",{name:"이름·대상 수정"}));await screen.findByLabelText("템플릿 이름");
    const original=fetch;let finish:(r:Response)=>void=()=>undefined;vi.stubGlobal("fetch",vi.fn((url,init)=>String(url).endsWith("/query")?new Promise<Response>(resolve=>{finish=resolve;}):original(url,init)));rerender(<WordbookLibrary onBack={vi.fn()} captureAuthenticationFailure={()=>vi.fn()} />);await act(async()=>{await new Promise(resolve=>setTimeout(resolve,300));});
    postFailure=503;await clickSave();await screen.findByRole("button",{name:"같은 내용으로 저장 확인"});await act(async()=>finish(new Response("{}",{status:503})));fireEvent.click(screen.getByRole("button",{name:"같은 내용으로 저장 확인"}));await screen.findByText("템플릿을 저장했습니다.");expect(requests[0]).toEqual(requests[1]);
  });
  it("deletes only after explicit confirmation and keeps the preservation notice", async () => {
    catalog.templates=[existing()];render(<WordbookLibrary onBack={vi.fn()} />);await screen.findByRole("heading",{name:metadata.title});fireEvent.click(screen.getByRole("button",{name:"템플릿 삭제"}));expect(requests).toHaveLength(0);expect(screen.getByText("템플릿을 삭제해도 이미 만든 단어장과 학생 시험은 유지됩니다.")).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"취소"}));expect(requests).toHaveLength(0);fireEvent.click(screen.getByRole("button",{name:"템플릿 삭제"}));fireEvent.click(screen.getByRole("button",{name:"이 템플릿 삭제"}));await screen.findByText("템플릿을 삭제했습니다. 기존 단어장과 학생 시험은 그대로 유지됩니다.");expect(requests[0]).toMatchObject({action:"delete",templateId:id(50),expectedRevision:2});
  });
});
