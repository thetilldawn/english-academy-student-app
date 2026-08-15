begin;

drop function if exists public.resume_quiz_after_feedback_v1(
  uuid,
  uuid,
  uuid,
  text
);

drop function if exists public.answer_quiz_question_v3(
  uuid,
  uuid,
  uuid,
  text,
  smallint,
  boolean
);

notify pgrst, 'reload schema';

commit;
