"use client";

import { useMemo, type FormEvent } from "react";

import { adminStudentsText } from "@/content/ko/admin-students";
import { commonText } from "@/content/ko/common";
import { Button, buttonRecipe } from "@/design-system/primitives/button/button";
import {
  DialogBody,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";
import {
  Field,
  FieldHelp,
  FieldLabel,
  FieldLabelRow,
  FieldRequirement,
  Input,
  Select,
  Textarea,
} from "@/design-system/primitives/form/field";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { HelpTip, inlineHelpClassName } from "@/design-system/primitives/tooltip/help-tip";
import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
  type CataloguedDataset,
} from "@/lib/admin/dataset-catalog";

import { useStudentCreationController } from "../controller/use-student-creation-controller";
import { StudentCodePanel } from "./panels/student-code-panel";
import styles from "./student-directory.module.css";
import detailStyles from "./student-detail.module.css";

export function StudentCreateWorkspace({
  appOrigin,
  datasets,
}: {
  appOrigin: string;
  datasets: readonly CataloguedDataset[];
}) {
  const controller = useStudentCreationController(appOrigin);
  const datasetGroups = useMemo(
    () => groupCataloguedDatasets(datasets),
    [datasets],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void controller.actions.submit(event.currentTarget);
  }

  return (
    <>
      <details className={styles.createDisclosure}>
        <summary className={buttonRecipe({ variant: "primary" })}>
          {adminStudentsText.createStudent.open}
        </summary>
        <div className={styles.createContent}>
          <form
            aria-busy={controller.busy}
            className={styles.formStack}
            onSubmit={submit}
          >
            <Field>
              <FieldLabelRow>
                <FieldLabel as="span" className={inlineHelpClassName}>
                  <HelpTip
                    label={adminStudentsText.createStudent.nameHelpAria}
                    trigger={adminStudentsText.createStudent.nameLabel}
                  >
                    {adminStudentsText.createStudent.nameHelp}
                  </HelpTip>
                </FieldLabel>
                <FieldRequirement data-kind="required">
                  {adminStudentsText.createStudent.required}
                </FieldRequirement>
              </FieldLabelRow>
              <Input
                aria-label={adminStudentsText.createStudent.nameLabel}
                maxLength={80}
                name="displayName"
                placeholder={adminStudentsText.createStudent.namePlaceholder}
                required
              />
            </Field>
            <div className={styles.formGrid}>
              <Field as="label">
                <FieldLabelRow>
                  <FieldLabel as="span">
                    {adminStudentsText.createStudent.schoolLabel}
                  </FieldLabel>
                  <FieldRequirement>
                    {adminStudentsText.createStudent.optional}
                  </FieldRequirement>
                </FieldLabelRow>
                <Input
                  maxLength={120}
                  name="schoolName"
                  placeholder={adminStudentsText.createStudent.schoolPlaceholder}
                />
              </Field>
              <Field as="label">
                <FieldLabelRow>
                  <FieldLabel as="span">
                    {adminStudentsText.createStudent.gradeLabel}
                  </FieldLabel>
                  <FieldRequirement>
                    {adminStudentsText.createStudent.optional}
                  </FieldRequirement>
                </FieldLabelRow>
                <Input
                  maxLength={40}
                  name="gradeLabel"
                  placeholder={adminStudentsText.createStudent.gradePlaceholder}
                />
              </Field>
            </div>
            <Field>
              <FieldLabelRow>
                <FieldLabel as="span" className={inlineHelpClassName}>
                  <HelpTip
                    label={adminStudentsText.createStudent.startingWordbookHelpAria}
                    trigger={adminStudentsText.createStudent.startingWordbookLabel}
                  >
                    {adminStudentsText.createStudent.startingWordbookHelp}
                  </HelpTip>
                </FieldLabel>
                <FieldRequirement>
                  {adminStudentsText.createStudent.optional}
                </FieldRequirement>
              </FieldLabelRow>
              <Select
                defaultValue=""
                name="currentVocabDatasetId"
              >
                <option value="">
                  {adminStudentsText.createStudent.chooseLater}
                </option>
                {datasetGroups.map((group) => (
                  <optgroup key={group.group} label={group.label}>
                    {group.datasets.map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {cataloguedDatasetDisplayLabel(dataset)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              {datasets.length === 0 ? (
                <FieldHelp>
                  {adminStudentsText.createStudent.noWordbookNotice}
                </FieldHelp>
              ) : null}
            </Field>
            <Field as="label">
              <FieldLabelRow>
                <FieldLabel as="span">
                  {adminStudentsText.createStudent.memoLabel}
                </FieldLabel>
                <FieldRequirement>
                  {adminStudentsText.createStudent.optional}
                </FieldRequirement>
              </FieldLabelRow>
              <Textarea
                maxLength={2000}
                name="note"
                placeholder={adminStudentsText.createStudent.memoPlaceholder}
              />
            </Field>
            {controller.error ? (
              <Notice role="alert" tone="danger">{controller.error}</Notice>
            ) : null}
            <Button disabled={controller.busy} type="submit" variant="primary">
              {controller.busy
                ? adminStudentsText.createStudent.submitting
                : adminStudentsText.createStudent.submit}
            </Button>
          </form>
        </div>
      </details>

      {controller.code ? (
        <DialogFrame
          aria-labelledby="new-student-code-title"
          height="auto"
          onRequestClose={controller.actions.closeCode}
          size="compact"
        >
          <DialogHeader closeLabel={commonText.modal.close}>
            <h2 id="new-student-code-title">{controller.code.label}</h2>
          </DialogHeader>
          <DialogBody className={detailStyles.codeBody}>
            <StudentCodePanel
              code={controller.code.code}
              onCopy={controller.actions.copyCode}
              onShare={controller.actions.shareCode}
            />
          </DialogBody>
        </DialogFrame>
      ) : null}
    </>
  );
}
