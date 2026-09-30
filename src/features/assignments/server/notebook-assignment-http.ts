import 'server-only';
import {getAdminContext} from '@/lib/auth/admin';
import {withAuthenticationFailureResponse} from '@/lib/auth/route-authentication';
import {isSameOriginRequest,parseJson} from '@/lib/http';
import {notebookAssignmentInputSchema,notebookAssignmentSaveSchema} from '../contracts/notebook-assignment';
import {NotebookAssignmentError} from './persistence/notebook-assignment';
import {previewNotebookAssignment,saveNotebookAssignment} from './use-cases/notebook-assignment';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export function notebookAssignmentHandler(action:'preview'|'save'){
 return withAuthenticationFailureResponse(async(request:Request)=>{
  if(!isSameOriginRequest(request))return json({error:'허용되지 않은 요청입니다.'},403);
  const admin=await getAdminContext();if(!admin)return json({error:'관리자 로그인이 필요합니다.'},401);
  try{
   if(action==='preview'){
    const input=await parseJson(request,notebookAssignmentInputSchema);
    return input?json(await previewNotebookAssignment(admin.userId,input)):json({error:'배정 조건을 확인해 주세요.'},400);
   }
   const input=await parseJson(request,notebookAssignmentSaveSchema);
   return input?json(await saveNotebookAssignment(admin.userId,input),201):json({error:'배정 조건을 확인해 주세요.'},400);
  }catch(error){return error instanceof NotebookAssignmentError?json({error:error.message,code:error.code},error.status):json({error:'배정 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.'},503);}
 });
}
