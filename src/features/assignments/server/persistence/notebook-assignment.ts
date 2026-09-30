import 'server-only';
import {getServiceSupabaseClient} from '@/lib/supabase/service';

export class NotebookAssignmentError extends Error{
 constructor(public readonly status:number,message:string,public readonly code?:string){super(message);}
}
export async function notebookAssignmentRpc(name:string,args:Record<string,unknown>){
 const {data,error}=await getServiceSupabaseClient().rpc(name,args);
 if(!error)return data;
 const code=error.message?.split(/[\s:]/)[0];
 if(error.code==='42501')throw new NotebookAssignmentError(403,'관리자 권한을 확인해 주세요.');
 if(['notebook_source_changed','practice_source_changed'].includes(code))throw new NotebookAssignmentError(409,'학생이나 단어 정보가 달라졌습니다. 다시 확인해 주세요.','source_changed');
 if(code==='notebook_student_profile_required')throw new NotebookAssignmentError(422,'학생의 학교와 학년을 먼저 입력해 주세요.');
 if(code==='notebook_student_unavailable')throw new NotebookAssignmentError(422,'현재 배정할 수 없는 학생입니다.');
 if(code==='practice_range_too_large')throw new NotebookAssignmentError(422,'단어장이나 틀린 횟수로 범위를 좁혀 주세요.');
 if(code==='notebook_grade_review_required')throw new NotebookAssignmentError(409,'학년이 다른 단어장을 포함할지 확인해 주세요.','source_changed');
 if(code==='notebook_request_conflict')throw new NotebookAssignmentError(409,'이미 사용한 요청입니다. 배정 내역을 확인해 주세요.','request_conflict');
 throw new NotebookAssignmentError(503,'배정 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.');
}
