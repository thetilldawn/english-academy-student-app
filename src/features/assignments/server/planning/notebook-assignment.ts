import 'server-only';
import {z} from 'zod';
import {buildPracticePlan,practiceSourceSchema} from '@/features/quiz-player/public-server';
import {compareAssignmentGrades} from '../../domain/assignment-grade-review';
import type {NotebookAssignmentInput} from '../../contracts/notebook-assignment';
import {notebookAssignmentRpc} from '../persistence/notebook-assignment';

const sourceSchema=practiceSourceSchema.extend({student:z.object({id:z.uuid(),displayName:z.string(),gradeLabel:z.string(),schoolName:z.string()}),datasets:z.array(z.object({id:z.uuid(),label:z.string(),gradeCode:z.string().nullable(),available:z.boolean()}))});
export async function prepareNotebookStudent(adminId:string,studentId:string,input:NotebookAssignmentInput){
 const raw=sourceSchema.parse(await notebookAssignmentRpc('prepare_notebook_assignment_source_v1',{p_admin_id:adminId,p_student_id:studentId,p_selection:{mode:'filtered',filters:input.filters}}));
 const available=new Set(raw.datasets.filter(d=>d.available).map(d=>d.id)),seen=new Set<number>();
 const omitted:{key:string;headword:string;reason:string}[]=[];
 const words=raw.words.filter(w=>{
  const reason=!available.has(String(w.latestDatasetId))?'현재 배정할 수 없는 단어장입니다.':seen.has(w.latestVocabEntryId)?'같은 원단어의 중복 기록입니다.':null;
  if(reason){omitted.push({key:w.key,headword:w.headword,reason});return false;}
  seen.add(w.latestVocabEntryId);return true;
 });
 const source={...raw,words,candidates:raw.candidates.filter(c=>available.has(c.datasetId))};
 const {questionCount,englishToKoreanRatio,timingMode,timeLimitSeconds,questionTimeLimitSeconds}=input.settings;
 const plan=buildPracticePlan(source,{questionCount,englishToKoreanRatio,timingMode,timeLimitSeconds,questionTimeLimitSeconds},`${input.requestKey}:${studentId}`);
 const usedBooks=new Set(plan.selected.map(w=>String(w.raw?.latestDatasetId))),sources=raw.datasets.filter(d=>usedBooks.has(d.id)).map(({id,label,gradeCode})=>({id,label,gradeCode}));
 const mismatchingSources=input.audienceMode==='single'?[]:sources.filter(d=>compareAssignmentGrades(d.gradeCode,[raw.student]).mismatchedStudentIds.length>0);
 const excluded=[...omitted,...plan.excluded];
 return{source,plan,preview:{studentId,displayName:raw.student.displayName,totalCount:raw.words.length,availableCount:plan.availableCount,
  words:plan.selected.map(w=>({key:w.key!,headword:w.headword,primaryMeaning:w.primaryMeaning})),excludedCount:excluded.length,excluded:excluded.slice(0,20),sources,mismatchingSources,error:plan.error}};
}
