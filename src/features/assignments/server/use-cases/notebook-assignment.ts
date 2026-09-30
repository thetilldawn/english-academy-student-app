import 'server-only';
import {freezePracticeQuestions,practiceHash} from '@/features/quiz-player/public-server';
import {notebookAssignmentInputSchema,notebookAssignmentSaveSchema,notebookAssignmentResultSchema,type NotebookAssignmentInput,type NotebookAssignmentSave,type NotebookAssignmentPreview} from '../../contracts/notebook-assignment';
import {prepareNotebookStudent} from '../planning/notebook-assignment';
import {NotebookAssignmentError,notebookAssignmentRpc} from '../persistence/notebook-assignment';

async function prepare(adminId:string,input:NotebookAssignmentInput){
 const prepared:Awaited<ReturnType<typeof prepareNotebookStudent>>[]=[],students:NotebookAssignmentPreview['students']=[];
 // Bound fan-out; do not make 210 simultaneous private-data/voice requests.
 for(let start=0;start<input.studentIds.length;start+=4){
  const page=await Promise.all(input.studentIds.slice(start,start+4).map(async studentId=>{
   try{return await prepareNotebookStudent(adminId,studentId,input);}
   catch(error){if(error instanceof NotebookAssignmentError&&error.status===422)return{preview:{studentId,displayName:'',totalCount:0,availableCount:0,words:[],excludedCount:0,excluded:[],sources:[],mismatchingSources:[],error:error.message}};throw error;}
  }));
  for(const row of page){students.push(row.preview);if('source' in row)prepared.push(row);}
 }
 const confirmation=students.some(s=>s.error)?null:practiceHash({adminId,input,plans:prepared.map(p=>({sourceHash:p.source.sourceHash,questions:p.plan.questions}))});
 return{prepared,preview:{confirmation,students}};
}
export async function previewNotebookAssignment(adminId:string,value:NotebookAssignmentInput){return(await prepare(adminId,notebookAssignmentInputSchema.parse(value))).preview;}
export async function saveNotebookAssignment(adminId:string,value:NotebookAssignmentSave){
 const parsed=notebookAssignmentSaveSchema.parse(value),{confirmation,gradeConfirmedStudentIds,...input}=parsed;
 if(new Set(gradeConfirmedStudentIds).size!==gradeConfirmedStudentIds.length||gradeConfirmedStudentIds.some(id=>!input.studentIds.includes(id)))throw new NotebookAssignmentError(422,'학년 확인 대상을 다시 확인해 주세요.');
 const requestHash=practiceHash(parsed);
 const previous=await notebookAssignmentRpc('get_notebook_assignment_result_v1',{p_admin_id:adminId,p_request_key:input.requestKey,p_request_hash:requestHash});
 if(previous!==null)return notebookAssignmentResultSchema.parse(previous);
 const current=await prepare(adminId,input);
 if(!current.preview.confirmation||current.preview.confirmation!==confirmation)throw new NotebookAssignmentError(409,'학생이나 단어 정보가 달라졌습니다. 다시 확인해 주세요.','source_changed');
 if(current.preview.students.some(s=>s.mismatchingSources.length&&!gradeConfirmedStudentIds.includes(s.studentId)))throw new NotebookAssignmentError(422,'학년이 다른 단어장을 포함할지 확인해 주세요.');
 const batches=[];
 for(const item of current.prepared){
  batches.push({studentId:item.preview.studentId,selection:{mode:'filtered',filters:input.filters},settings:input.settings,sourceHash:item.source.sourceHash,
   questions:await freezePracticeQuestions(item,true),audienceMode:input.audienceMode,gradeConfirmed:gradeConfirmedStudentIds.includes(item.preview.studentId)});
 }
 return notebookAssignmentResultSchema.parse(await notebookAssignmentRpc('create_notebook_assignments_v1',{p_admin_id:adminId,p_request_key:input.requestKey,p_request_hash:requestHash,p_batches:batches}));
}
