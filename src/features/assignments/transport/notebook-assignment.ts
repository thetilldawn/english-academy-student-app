import {createRequestDeadline,awaitWithAbortSignal} from '@/lib/network/request-policy';
import {notebookAssignmentPreviewSchema,notebookAssignmentResultSchema,type NotebookAssignmentInput,type NotebookAssignmentSave} from '../contracts/notebook-assignment';
import {browserAssignmentTransport,assignmentTransportError} from './assignment-transport';
export class NotebookRequestError extends Error{constructor(public readonly status:number,message:string,public readonly code?:string){super(message);}}
async function request(action:'preview'|'save',input:NotebookAssignmentInput|NotebookAssignmentSave,signal:AbortSignal){
 const deadline=createRequestDeadline(280000,signal);
 try{
  const response=await awaitWithAbortSignal(browserAssignmentTransport({url:`/api/admin/notebook-assignments${action==='preview'?'/preview':''}`,method:'POST',body:input,signal:deadline.signal}),deadline.signal);
  if(!response.ok){const data=response.data;throw new NotebookRequestError(response.status,assignmentTransportError(data,'응답을 확인하지 못했습니다. 다시 시도해 주세요.'),typeof data==='object'&&data!==null&&'code'in data&&typeof data.code==='string'?data.code:undefined);}
  return response.data;
 }finally{deadline.dispose();}
}
export async function previewNotebook(input:NotebookAssignmentInput,signal:AbortSignal){return notebookAssignmentPreviewSchema.parse(await request('preview',input,signal));}
export async function saveNotebook(input:NotebookAssignmentSave,signal:AbortSignal){return notebookAssignmentResultSchema.parse(await request('save',input,signal));}
