import "server-only";

import { getServiceSupabaseClient } from "@/lib/supabase/service";
import {
  answerQuizQuestionWithCompatibleRpc,
  resumeQuizAfterFeedbackWithCompatibleRpc,
  startQuizRetryWithCompatibleRpc,
} from "../quiz-rpc-compatibility";
import { materializeReadyVocabAssignmentQueue } from "../vocab-assignment-queue-service";

export async function expireStudentAttempt(
  studentId: string,
  attemptId: string,
): Promise<void> {
  const supabase = getServiceSupabaseClient();
  const { error } = await supabase.rpc("expire_quiz_attempt", {
    p_student_id: studentId,
    p_attempt_id: attemptId,
  });

  if (error) {
    throw new Error("시험 종료상태를 저장하지 못했습니다.");
  }
}

export async function startStudentRetry(
  studentId: string,
  attemptId: string,
) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await startQuizRetryWithCompatibleRpc(
    (functionName, parameters) => supabase.rpc(functionName, parameters),
    {
      p_student_id: studentId,
      p_attempt_id: attemptId,
    },
  );

  if (error || !data) {
    throw new Error("재시험을 시작하지 못했습니다.");
  }

  return data as {
    phase: "retry";
    nextQuestionId: string;
    deadlineAt: string;
  };
}

export async function answerStudentQuestion(input: {
  studentId: string;
  attemptId: string;
  questionId: string;
  phase: "initial" | "retry";
  choiceIndex: number;
}) {
  const supabase = getServiceSupabaseClient();
  const { data, error, feedbackProtocol } =
    await answerQuizQuestionWithCompatibleRpc(
      (functionName, parameters) => supabase.rpc(functionName, parameters),
      {
        p_student_id: input.studentId,
        p_attempt_id: input.attemptId,
        p_question_id: input.questionId,
        p_phase: input.phase,
        p_choice_index: input.choiceIndex,
        p_force_timeout: false,
      },
    );

  if (error || !data) {
    throw new Error("답안을 저장하지 못했습니다.");
  }

  if ((data as Record<string, unknown>).completed === true) {
    await materializeReadyVocabAssignmentQueue(input.studentId);
  }

  return {
    ...(data as Record<string, unknown>),
    feedbackProtocol,
  } as {
    correct?: boolean;
    correctChoiceIndex?: number;
    completed?: boolean;
    needsRetry?: boolean;
    expired?: boolean;
    nextQuestionId?: string | null;
    nextPhase?: "initial" | "retry" | null;
    initialAnsweredCount?: number;
    initialQuestionCount?: number;
    retryAnsweredCount?: number;
    retryQuestionCount?: number;
    timedOut?: boolean;
    questionDeadlineAt?: string | null;
    feedbackProtocol: "legacy" | "variable";
  };
}

export async function timeoutStudentQuestion(input: {
  studentId: string;
  attemptId: string;
  questionId: string;
  phase: "initial" | "retry";
}) {
  const supabase = getServiceSupabaseClient();
  const { data, error, feedbackProtocol } =
    await answerQuizQuestionWithCompatibleRpc(
      (functionName, parameters) => supabase.rpc(functionName, parameters),
      {
        p_student_id: input.studentId,
        p_attempt_id: input.attemptId,
        p_question_id: input.questionId,
        p_phase: input.phase,
        p_choice_index: 0,
        p_force_timeout: true,
      },
    );
  if (error || !data) {
    throw new Error("시간 초과 상태를 저장하지 못했습니다.");
  }
  if ((data as Record<string, unknown>).completed === true) {
    await materializeReadyVocabAssignmentQueue(input.studentId);
  }
  return {
    ...(data as Record<string, unknown>),
    feedbackProtocol,
  } as {
    correct?: boolean;
    correctChoiceIndex?: number;
    completed?: boolean;
    needsRetry?: boolean;
    expired?: boolean;
    nextQuestionId?: string | null;
    nextPhase?: "initial" | "retry" | null;
    timedOut?: boolean;
    questionDeadlineAt?: string | null;
    feedbackProtocol: "legacy" | "variable";
  };
}

export async function resumeStudentQuizAfterFeedback(input: {
  studentId: string;
  attemptId: string;
  nextQuestionId: string;
  nextPhase: "initial" | "retry";
  transitionRemainingMilliseconds: number;
}) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await resumeQuizAfterFeedbackWithCompatibleRpc(
    (functionName, parameters) => supabase.rpc(functionName, parameters),
    {
      p_student_id: input.studentId,
      p_attempt_id: input.attemptId,
      p_next_question_id: input.nextQuestionId,
      p_next_phase: input.nextPhase,
      p_transition_remaining_milliseconds:
        input.transitionRemainingMilliseconds,
    },
  );
  if (error || !data) {
    throw new Error("다음 문제 시간을 시작하지 못했습니다.");
  }
  return data as {
    questionDeadlineAt: string;
    questionStartsAt: string;
  };
}

