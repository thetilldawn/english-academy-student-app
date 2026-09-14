"use client";
import Link from "next/link";
import { useId } from "react";
import { RoutedDetailDialog } from "@/components/routed-detail-dialog";
import { useRouteExitGuard } from "@/components/use-route-exit-guard";
import type { ScheduleEditorInitial } from "../../contracts/school-schedule-edit";
import { useSchoolScheduleEditor } from "../use-school-schedule-editor";
import { ScheduleRetry } from "./schedule-retry";
import { schoolDisplayPeriod } from "../../domain/school-schedule";
import styles from "../../ui/school-schedule-editor.module.css";

export function SchoolScheduleEditor({ initial, presentation }: { initial: ScheduleEditorInitial; presentation: "dialog" | "page" }) {
  const editor = useSchoolScheduleEditor(initial);
  const titleId = useId();
  const guard = useRouteExitGuard({ busy: !editor.locked && (editor.busy || editor.unresolved), dirty: !editor.locked && editor.dirty,
    confirmMessage: "저장하지 않은 일정 변경사항이 있습니다.", idPrefix: "school-schedule" });
  const disabled = editor.busy || editor.unresolved || !editor.snapshot;
  const groups = initial.overview.groups;
  const selectedIndex = groups.findIndex(group => group.summary.schoolKey === editor.scope?.schoolKey && Number(group.summary.gradeLabel?.replace(/\D/g,"")) === editor.grade);
  const period = schoolDisplayPeriod(initial.overview.today);
  const content = editor.locked ? <p role="alert">관리자 로그인이 필요합니다. <Link href="/admin/login">관리자 로그인</Link></p> : initial.overview.status === "error" ? <>
    <p role="alert">학교 목록을 불러오지 못했습니다. 다시 시도해 주세요.</p><ScheduleRetry />
  </> : <>
    <div className={styles.selection}>
      <label>학교·학년 <select aria-label="학교·학년" value={selectedIndex < 0 ? "" : String(selectedIndex)} disabled={editor.busy || editor.unresolved} onChange={async event => {
        const group = groups[Number(event.target.value)];
        if (!group?.summary.schoolKey || !await guard.canExit()) return;
        await editor.load({ schoolKey: group.summary.schoolKey, academicYear: period.academicYear, semester: editor.scope?.semester ?? period.semester }, Number(group.summary.gradeLabel?.replace(/\D/g,"") || 1));
      }}>
        <option value="" disabled>학교를 선택해 주세요</option>
        {groups.map((group,index) => <option key={index} value={index} disabled={!group.summary.schoolKey || !/^(중|고)[123](학년)?$/.test((group.summary.gradeLabel ?? "").replace(/\s/g,""))}>
          {group.summary.schoolName || "학교 미등록"} / {group.summary.gradeLabel || "학년 미등록"} / {group.studentCount}명{group.summary.schoolKey ? "" : " / 학교 연결 필요"}
        </option>)}
      </select></label>
      <label>{period.academicYear}학년도 <select aria-label="학기" value={editor.scope?.semester ?? period.semester} disabled={editor.busy || editor.unresolved || !editor.scope} onChange={async event => {
        const semester = Number(event.target.value);
        if (editor.scope && await guard.canExit()) await editor.load({ ...editor.scope, semester });
      }}><option value={1}>1학기</option><option value={2}>2학기</option></select></label>
    </div>
    {groups.some(group => !group.summary.schoolKey) ? <p className={styles.help}>학교가 연결되지 않은 학생은 <Link href="/admin/students">학생 정보</Link>에서 학교를 먼저 선택해 주세요.</p> : null}
    {editor.snapshot ? <>
      <label className={styles.eventSelect}>일정 <select aria-label="일정 선택" value={editor.draft.id} disabled={editor.busy || editor.unresolved} onChange={async event => {
        const id = event.target.value; if (await guard.canExit()) editor.selectEvent(id);
      }}><option value="">새 일정 입력</option>{editor.snapshot.events.filter(event => event.grade === editor.grade).map(event => <option key={event.id} value={event.id}>
        {event.kind === "written" ? "지필" : "수행"} / {event.subject ? event.subject + " / " : ""}{event.title} / {event.kind === "written" ? event.subjectDate ?? "영어 시험일 확인 필요" : event.startDate ?? (event.dateText || "날짜 확인 필요")}
      </option>)}</select></label>
      {editor.sourceChanged ? <p role="status" className={styles.notice}>새 학교 자료가 있습니다. 수동 입력 내용을 확인해 주세요.</p> : null}
      <form onSubmit={event => { event.preventDefault(); void editor.save(); }} className={styles.form}>
        <fieldset disabled={disabled}><legend>평가 정보</legend>
          <div className={styles.kindOptions}>
            <label data-kind="performance"><input type="radio" name={titleId + "-kind"} checked={editor.draft.kind === "performance"} onChange={() => editor.change({ kind: "performance", subjectDate: "", startDate: "", endDate: "", dateText: "", precision: "unknown" })} />수행평가</label>
            <label data-kind="written"><input type="radio" name={titleId + "-kind"} checked={editor.draft.kind === "written"} onChange={() => editor.change({ kind: "written", subjectDate: "", startDate: "", endDate: "", dateText: "", precision: "unknown" })} />지필평가</label>
          </div>
          <label>일정 이름 <span className={styles.required}>필수</span><input aria-label="일정 이름" required maxLength={240} value={editor.draft.title} onChange={event => editor.change({ title: event.target.value })} /></label>
          <div className={styles.columns}>
            <label>과목<input aria-label="과목" maxLength={80} value={editor.draft.subject} placeholder="예: 영어Ⅱ" onChange={event => editor.change({ subject: event.target.value })} /></label>
            {editor.draft.kind === "written" ? <label>시험 차수<select aria-label="시험 차수" value={editor.draft.round} onChange={event => editor.change({ round: event.target.value })}><option value="1">1차</option><option value="2">2차</option></select></label> :
              <label>만점<input aria-label="만점" type="number" min="0" max="1000" value={editor.draft.maxPoints} onChange={event => editor.change({ maxPoints: event.target.value })} /></label>}
          </div>
          <label>대상<select aria-label="평가 대상" value={editor.draft.applicability} onChange={event => editor.change({ applicability: event.target.value as "grade" | "enrollment-unconfirmed" })}>
            <option value="grade">학년 공통·학교 지정 과목</option><option value="enrollment-unconfirmed">학생 선택 과목</option></select></label>
        </fieldset>
        {editor.draft.kind === "written" ? <fieldset disabled={disabled || editor.draft.precision === "none"}><legend>영어 시험일</legend>
          <label>영어 시험일<input aria-label="영어 시험일" type="date" value={editor.draft.subjectDate} onChange={event => editor.change({ subjectDate: event.target.value })} /></label>
          <p className={styles.help}>날짜가 정해졌을 때 입력하세요. 비워 두면 날짜 확인 필요로 표시합니다.</p>
        </fieldset> : null}
        <fieldset disabled={disabled}><legend>{editor.draft.kind === "written" ? "학교 시험기간 · 보조 정보" : "날짜"}</legend>
          <label>{editor.draft.kind === "written" ? "학교 시험기간 입력 방식" : "날짜 입력 방식"}<select aria-label={editor.draft.kind === "written" ? "학교 시험기간 입력 방식" : "날짜 입력 방식"} value={editor.draft.precision} onChange={event => editor.change({ precision: event.target.value as typeof editor.draft.precision, ...(event.target.value === "none" ? { subjectDate: "" } : {}) })}>
            <option value="day">하루</option><option value="range">시작일 ~ 종료일</option><option value="week">주차 예정</option><option value="month">월 예정</option><option value="unknown">날짜 확인 필요</option><option value="none">미실시</option>
          </select></label>
          {["day","range"].includes(editor.draft.precision) ? <div className={styles.columns}>
            <label>{editor.draft.precision === "range" ? "시작일" : "시행일"}<input aria-label="시작일" type="date" required value={editor.draft.startDate} onChange={event => editor.change({ startDate: event.target.value })} /></label>
            {editor.draft.precision === "range" ? <label>종료일<input aria-label="종료일" type="date" required min={editor.draft.startDate} value={editor.draft.endDate} onChange={event => editor.change({ endDate: event.target.value })} /></label> : null}
          </div> : ["week","month"].includes(editor.draft.precision) ? <label>예정 시기<input aria-label="예정 시기" required maxLength={300} placeholder="예: 10월 4주" value={editor.draft.dateText} onChange={event => editor.change({ dateText: event.target.value })} /></label> : null}
          {!["unknown","none"].includes(editor.draft.precision) ? <label>{editor.draft.kind === "written" ? "학교 시험기간 확인 상태" : "확인 상태"}<select aria-label={editor.draft.kind === "written" ? "학교 시험기간 확인 상태" : "확인 상태"} value={editor.draft.status} onChange={event => editor.change({ status: event.target.value as "confirmed" | "planned" })}><option value="confirmed">확인됨</option><option value="planned">예정</option></select></label> : null}
        </fieldset>
        <p className={styles.help}>수동으로 저장한 정보는 학교 자료를 갱신해도 유지됩니다.</p>
        {editor.message ? <p role={editor.problem ? "alert" : "status"} className={styles.notice}>{editor.message}</p> : null}
        <div className={styles.actions}>
          <button type="submit" className={styles.save} disabled={disabled || (!editor.dirty && !!editor.draft.id) || editor.problem === "conflict"}>{editor.busy ? "처리 중…" : "변경사항 저장"}</button>
          {editor.problem === "conflict" || editor.problem === "load" ? <button type="button" disabled={editor.busy} onClick={() => void editor.load(editor.scope, editor.grade, true)}>최신 기준 불러오기</button> : null}
          {editor.unresolved ? <><button type="button" disabled={editor.busy} onClick={() => void editor.recover()}>저장 결과 확인</button><button type="button" disabled={editor.busy} onClick={() => void editor.save(true)}>같은 요청 다시 저장</button></> : null}
        </div>
      </form>
    </> : <><p role={editor.problem ? "alert" : "status"}>{editor.message || "학생의 학교·학년을 선택하면 일정을 입력할 수 있습니다."}</p>
      {editor.scope ? <button type="button" disabled={editor.busy} onClick={() => void editor.load()}>다시 시도</button> : null}</>}
  </>;
  const heading = <h2 id={titleId}>{editor.locked ? "로그인 확인" : "학교 일정 수동입력"}</h2>;
  return presentation === "dialog" ? <RoutedDetailDialog heading={heading} titleId={titleId} closeLabel="닫기" size="wide" fullScreenMobile
    closeDisabled={!editor.locked && (editor.busy || editor.unresolved)} routeCloseGuard={guard.requestExit}><div className={styles.editor}>{content}</div></RoutedDetailDialog> :
    <section className={styles.page}>{heading}<Link href="/admin">개요로 돌아가기</Link><div className={styles.editor}>{content}</div></section>;
}
