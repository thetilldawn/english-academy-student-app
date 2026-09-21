import "server-only";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { libraryCommandSchema, libraryCommandResultSchema } from "../../contracts/library";
import { compositionQuestionInputSchema, compositionStepSchema, compositionProgressSchema } from "../../contracts/library-materialization";
import { planCompositionQuestions } from "../use-cases/composition-question-plan";
import { LibraryCommandError } from "./library-command";
import { libraryCommandV2ResultSchema } from "../../contracts/library-command-v2";

export async function materializeLibraryComposition(input: unknown, admin?: AdminContext, compact = false) {
  if (!admin) await requireAdmin();
  const parsed = libraryCommandSchema.safeParse(input);
  if (!parsed.success || parsed.data.action !== "materialize") throw new LibraryCommandError(422);
  const command = parsed.data;
  const client = await createServerSupabaseClient();
  let datasetId: string | undefined;
  let progressConfirmed = false;
  const checkedStep = (response: { data: unknown; error: { code?: string } | null }) => {
    if (response.error) throw new LibraryCommandError(response.error.code === "42501" ? 403 : response.error.code === "P0002" ? 404 : response.error.code === "40001" ? 409 : response.error.code === "22023" ? 422 : 503, progressConfirmed);
    const result = compositionStepSchema.safeParse(response.data);
    if (!result.success || result.data.versionId !== command.versionId || result.data.contentHash !== command.contentHash ||
      (datasetId && result.data.datasetId !== datasetId)) throw new LibraryCommandError(503);
    datasetId = result.data.datasetId;
    progressConfirmed = true;
    return result.data;
  };
  // Reauthorize every request; only confirmed progress can prompt another step.
  let step = checkedStep(await client.rpc("advance_vocabulary_template_book_v1", { p_request: command }));
  let remainingSteps = 3;
  while (step.state !== "ready" && remainingSteps > 0) {
    remainingSteps--;
    if (step.stage === "entries" || step.stage === "reviewed") {
      step = checkedStep(await client.rpc("advance_vocabulary_template_book_v1", { p_request: command }));
      continue;
    }
    let questions: ReturnType<typeof planCompositionQuestions> | null = null;
    if (step.needsQuestions) {
      const response = await client.rpc("prepare_vocabulary_template_question_input_v1", { p_request: command });
      if (response.error) throw new LibraryCommandError(response.error.code === "42501" ? 403 : response.error.code === "40001" ? 409 : 503, progressConfirmed);
      const prepared = compositionQuestionInputSchema.safeParse(response.data);
      if (!prepared.success || prepared.data.versionId !== command.versionId || prepared.data.datasetId !== datasetId ||
        prepared.data.contentHash !== command.contentHash) throw new LibraryCommandError(503);
      if (prepared.data.state === "ready") {
        step = { ...step, state: "ready", stage: "complete", needsQuestions: false };
        break;
      }
      questions = planCompositionQuestions(prepared.data);
    }
    const response = await getServiceSupabaseClient().rpc("advance_vocabulary_composition_questions_v1", {
      p_version_id: command.versionId, p_content_sha256: command.contentHash, p_questions: questions,
    });
    if (questions !== null && response.error?.code === "40001" && response.error.message === "composition_question_plan_changed") {
      // Another administrator fixed the first valid plan. Reuse it on the next
      // bounded step; source/version conflicts still fail without retrying.
      step = { ...step, needsQuestions: false };
      continue;
    }
    step = checkedStep(response);
  }
  if (step.state !== "ready") return compositionProgressSchema.parse({ ...step, kind: "materializing", requestId: command.requestId, templateId: command.templateId });
  const response = await client.rpc(compact ? "get_vocabulary_composition_summary_v2" : "get_vocabulary_composition_summary_v1", { p_version_id: command.versionId });
  const result = (compact ? libraryCommandV2ResultSchema : libraryCommandResultSchema).safeParse(response.data);
  if (response.error || !result.success || !("template" in result.data) || result.data.template.id !== command.templateId || result.data.createdBook?.versionId !== command.versionId || result.data.createdBook.contentHash !== command.contentHash || result.data.createdBook.dataset.id !== datasetId) throw new LibraryCommandError(503);
  return result.data;
}
