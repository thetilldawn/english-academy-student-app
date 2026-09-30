/** @vitest-environment jsdom */
import {renderHook,act,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({refresh:vi.fn()}));vi.mock('next/navigation',()=>({useRouter:()=>mock}));
import {useStudentHistoryRefresh} from './use-student-history-refresh';
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('내단어장 상세 닫기와 앞뒤 이동에서는 목록을 새로 읽지 않는다',()=>{
  const view=renderHook(({path})=>useStudentHistoryRefresh(path),{initialProps:{path:'/student/wordbook/key'}});
  act(()=>{window.history.replaceState({},'','/student/wordbook');window.dispatchEvent(new PopStateEvent('popstate'));});view.rerender({path:'/student/wordbook'});expect(mock.refresh).not.toHaveBeenCalled();
  act(()=>{window.history.replaceState({},'','/student/wordbook/key');window.dispatchEvent(new PopStateEvent('popstate'));});view.rerender({path:'/student/wordbook/key'});expect(mock.refresh).not.toHaveBeenCalled();
});
it('실제 메인 복귀의 기존 갱신은 유지한다',()=>{
  const view=renderHook(({path})=>useStudentHistoryRefresh(path),{initialProps:{path:'/student/wordbook'}});
  act(()=>{window.history.replaceState({},'','/student');window.dispatchEvent(new PopStateEvent('popstate'));});view.rerender({path:'/student'});expect(mock.refresh).toHaveBeenCalledOnce();
});
