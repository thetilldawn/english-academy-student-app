import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { notebookFiltersSchema,notebookWordToken } from '../contracts/notebook-study';
import { decodeNotebookCursor,decodeNotebookWordToken,encodeNotebookCursor } from './notebook-cursor';
const filters=notebookFiltersSchema.parse({});
const value={studentId:'00000000-0000-4000-8000-000000000001',filters,eventUpperId:'123',wrongCount:4,lastWrongAt:'2026-09-30T00:00:00.123456Z',key:'dictionary:단어'};
describe('내 단어장 커서',()=>{
  it('정렬조건·학생·사건상한·마이크로초·횟수에 고정한다',()=>{
    const cursor=encodeNotebookCursor(value);expect(decodeNotebookCursor(cursor,value.studentId,filters)).toMatchObject({...value,filters:expect.any(String)});
    expect(()=>decodeNotebookCursor(cursor,'00000000-0000-4000-8000-000000000002',filters)).toThrow();
    expect(()=>decodeNotebookCursor(cursor,value.studentId,{...filters,sort:'recent'})).toThrow();
    expect(()=>decodeNotebookCursor(cursor,value.studentId,{...filters,minWrongCount:4})).toThrow();
  });
  it('큰 사건번호·잘못된 인코딩·너무긴키를 거절한다',()=>{
    expect(()=>encodeNotebookCursor({...value,eventUpperId:'9223372036854775808'})).toThrow();
    expect(()=>decodeNotebookCursor('malformed',value.studentId,filters)).toThrow();
    expect(decodeNotebookWordToken('a'.repeat(5401))).toBeNull();
    expect(decodeNotebookWordToken(notebookWordToken(value.key))).toBe(value.key);
    expect(decodeNotebookWordToken('../x')).toBeNull();
  });
});
