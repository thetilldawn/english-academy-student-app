'use client';
import {useState} from 'react';
import {Button,ButtonLink} from '@/design-system/primitives/button/button';
import {DialogBody,DialogFooter,DialogFrame,DialogHeader} from '@/design-system/primitives/dialog/dialog';
import {NumericInput} from '@/design-system/primitives/form/numeric-input';
import {useNotebookAssignment} from '../controller/use-notebook-assignment';
import {ExamConditionFields} from './exam-condition-fields';
import styles from './notebook-assignment.module.css';

export function NotebookAssignmentDialog({students,audienceMode,onClose,onSuccess,interactionAllowed=true}:{students:{id:string;displayName:string}[];audienceMode:'single'|'bulk';onClose:()=>void;onSuccess:(count:number)=>void;interactionAllowed?:boolean}){
 const c=useNotebookAssignment(students.map(s=>s.id),audienceMode,onSuccess,interactionAllowed),[visible,setVisible]=useState(10);
 const locked=c.busy||!!c.sent||!interactionAllowed,settings=c.settings,filters=c.filters;
 return <DialogFrame aria-labelledby="notebook-assignment-title" onRequestClose={onClose} closeDisabled={!c.denied&&locked} size="wide" layout="body-footer" fullScreenMobile>
  <DialogHeader closeLabel="닫기"><h2 id="notebook-assignment-title">개인 오답 배정</h2></DialogHeader>
  <DialogBody><div className={styles.content}>
   {!c.denied&&interactionAllowed?<>
    <div className={styles.summary}><strong>{c.ids.length}명</strong><span>포인트 제외</span>{c.ids.length!==students.length?<Button disabled={locked} onClick={c.restore} size="small">제외한 학생 복원</Button>:null}</div>
    <fieldset disabled={locked} className={styles.fields}>
     <label>틀린 횟수(이상)<NumericInput min={1} value={filters.minWrongCount??null} onValueChange={value=>c.changeFilters({...filters,minWrongCount:value??undefined})}/></label>
     <label>틀린 횟수(이하)<NumericInput min={1} value={filters.maxWrongCount??null} onValueChange={value=>c.changeFilters({...filters,maxWrongCount:value??undefined})}/></label>
     <label>검색<input value={filters.query} maxLength={200} onChange={e=>c.changeFilters({...filters,query:e.target.value})}/></label>
     <label>학생당 문항 수<NumericInput min={1} max={500} required value={settings.questionCount} onValueChange={value=>c.changeSettings({...settings,questionCount:value??Number.NaN})}/></label>
    </fieldset>
    <fieldset disabled={locked} className={styles.conditions}>
     <ExamConditionFields idPrefix="notebook-assignment" exam={{directionRatio:settings.englishToKoreanRatio,passingScore:settings.passingScore,retryEnabled:settings.retryEnabled,retryPassingScore:settings.retryPassingScore??undefined}}
      onDirectionChange={value=>c.changeSettings({...settings,englishToKoreanRatio:value})} onPassingScoreChange={value=>c.changeSettings({...settings,passingScore:value})}
      onRetryEnabledChange={value=>c.changeSettings({...settings,retryEnabled:value,retryPassingScore:value?settings.passingScore:null})} onRetryPassingScoreChange={value=>c.changeSettings({...settings,retryPassingScore:value})}/>
     <div className={styles.fields}>
      <label>시간<select value={settings.timingMode} onChange={e=>{const mode=e.target.value as typeof settings.timingMode;c.changeSettings({...settings,timingMode:mode,timeLimitSeconds:mode==='total'?240:null,questionTimeLimitSeconds:mode==='per_question'?10:null});}}><option value="none">제한 없음</option><option value="total">전체 시간</option><option value="per_question">문제당 시간</option></select></label>
      {settings.timingMode==='total'?<label>전체 시간(분)<NumericInput decimal min={0.5} max={180} step={0.5} value={settings.timeLimitSeconds===null?null:settings.timeLimitSeconds/60} onValueChange={value=>c.changeSettings({...settings,timeLimitSeconds:value===null?Number.NaN:value*60})}/></label>:null}
      {settings.timingMode==='per_question'?<label>문제당 시간(초)<NumericInput min={5} max={600} value={settings.questionTimeLimitSeconds} onValueChange={value=>c.changeSettings({...settings,questionTimeLimitSeconds:value??Number.NaN})}/></label>:null}
     </div>
    </fieldset>
    <section aria-label="학생별 오답 미리보기" className={styles.students}>
     {(c.preview?.students??c.ids.map(studentId=>({studentId,displayName:students.find(s=>s.id===studentId)?.displayName??'',error:null}))).slice(0,visible).map(row=><article key={row.studentId} className={styles.student}>
      <div className={styles.summary}><strong>{row.displayName||students.find(s=>s.id===row.studentId)?.displayName}</strong><Button disabled={locked} size="small" variant="quiet" onClick={()=>c.exclude(row.studentId)}>제외</Button></div>
      {'availableCount'in row?<>
       <p>{row.words.length}문항 · 출제 가능 {row.availableCount}개 / 전체 {row.totalCount}개</p>
       {row.error?<p role="alert">{row.error}</p>:null}
       {row.mismatchingSources.length?<label className={styles.grade}><input type="checkbox" disabled={locked} checked={c.confirmed.includes(row.studentId)} onChange={e=>c.confirm(row.studentId,e.target.checked)}/><span>학년이 다른 단어장 포함: {row.mismatchingSources.map(d=>d.label).join(' · ')}</span></label>:null}
       {row.words.length?<details><summary>출제 단어 {row.words.length}개</summary><ul className={styles.words}>{row.words.map(word=><li key={word.key}><span lang="en">{word.headword}</span><span>{word.primaryMeaning}</span></li>)}</ul></details>:null}
       {row.excludedCount?<details><summary>출제 불가 {row.excludedCount}개</summary><ul>{row.excluded.map(word=><li key={word.key}>{word.headword} · {word.reason}</li>)}</ul>{row.excludedCount>row.excluded.length?<p>앞 {row.excluded.length}개 표시</p>:null}</details>:null}
      </>:null}
     </article>)}
     {c.ids.length>visible?<Button onClick={()=>setVisible(n=>n+10)}>10명 더보기</Button>:null}
    </section>
   </>:c.denied?<ButtonLink href="/">처음으로</ButtonLink>:<p role="status">접속을 확인하고 있습니다.</p>}
   {interactionAllowed&&c.busy?<p role="status">{c.sent?'배정 중입니다.':'학생별 단어를 확인하고 있습니다.'}</p>:null}{interactionAllowed&&c.error?<p role="alert">{c.error}</p>:null}
  </div></DialogBody>
  <DialogFooter>{!c.denied&&interactionAllowed?<>{c.sent?<><Button disabled={c.busy} onClick={()=>void c.save()}>배정 결과 확인</Button>{!c.busy?<ButtonLink href="/admin/history" target="_blank" rel="noopener noreferrer">배정 내역 보기</ButtonLink>:null}</>:<><Button disabled={c.busy||!c.ids.length} onClick={()=>void c.check()}>출제 단어 확인</Button><Button variant="primary" disabled={c.busy||!c.preview?.confirmation||c.preview.students.some(s=>s.mismatchingSources.length&&!c.confirmed.includes(s.studentId))} onClick={()=>void c.save()}>배정</Button></>}</>:null}</DialogFooter>
 </DialogFrame>;
}
