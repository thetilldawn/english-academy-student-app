// Local synthetic data only. This module is never imported by application code.
export const LOCAL_SCHOOL_KEY = 'T00:0000001';
export function localSchoolSchedulePayload(students, ids = null) {
  const selected = students.filter(student => ids === null || ids.includes(student.id));
  const event = (id, grade, kind, title, startDate, endDate) => ({ id, grade, kind, round: kind === 'written' ? 1 : null,
    title, subject: kind === 'written' ? null : '영어', startDate, endDate, precision: startDate ? 'range' : 'unknown',
    status: startDate ? 'confirmed' : 'unknown', dateText: '', maxPoints: kind === 'written' ? null : 25,
    applicability: kind === 'written' ? 'grade' : 'enrollment-unconfirmed', sourceUrl: 'https://school.example.invalid/notice' });
  return { students: selected.map(student => ({ id: student.id, schoolKey: student.schoolKey === undefined ? LOCAL_SCHOOL_KEY : student.schoolKey, schoolName: student.schoolName, gradeLabel: student.gradeLabel })),
    bundles: [{ schoolKey: LOCAL_SCHOOL_KEY, schoolName: '검사 학교', schoolLevel: '고', academicYear: 2026, semester: 2,
      versionId: 'local-fake-2026-2', sourceHash: 'a'.repeat(64), checkedOn: '2026-09-13',
      events: [event('fake-written',1,'written','2학기 1차 시험','2026-10-12','2026-10-16'),event('fake-performance',1,'performance','가상 글쓰기 평가',null,null)] }] };
}
