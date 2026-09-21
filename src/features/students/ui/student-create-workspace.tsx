"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";

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
  FieldError,
  FieldHelp,
  FieldLabel,
  FieldLabelRow,
  FieldRequirement,
  Input,
  Select,
  Textarea,
} from "@/design-system/primitives/form/field";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { studentProfileFieldErrors } from "@/lib/admin/student-profile-requirements";
import { HelpTip, inlineHelpClassName } from "@/design-system/primitives/tooltip/help-tip";
import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
} from "@/lib/admin/dataset-catalog";

import { useStudentCreationController } from "../controller/use-student-creation-controller";
import { useStudentCreatePreparation } from "../controller/use-student-create-preparation";
import { StudentCodePanel } from "./panels/student-code-panel";
import { useSchoolSearch } from "../controller/use-school-search";
import { SchoolSearchField } from "./school-search-field";
import type { SchoolSearchItem } from "../contracts/school-search-contract";
import styles from "./student-directory.module.css";
import detailStyles from "./student-detail.module.css";

export function StudentCreateWorkspace({
  appOrigin,
}: {
  appOrigin: string;
}) {
  const controller = useStudentCreationController(appOrigin);
  const preparation = useStudentCreatePreparation();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const fieldId = useId();
  const [schoolName, setSchoolName] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<SchoolSearchItem | null>(null);
  const [grade, setGrade] = useState("");
  const errors = studentProfileFieldErrors({ displayName, schoolName, gradeLabel: grade });
  const invalid = Object.keys(errors).length > 0;
  const school = useSchoolSearch({ ownerKey: "student-create", value: schoolName,
    onChange: value => { setSchoolName(value); setSelectedSchool(null); setGrade(""); },
    onChoose: setSelectedSchool,
    active: open, locked: preparation.status === "auth-error" });
  const locked = preparation.status === "auth-error" || school.locked;
  const { datasets } = preparation;
  const datasetGroups = useMemo(
    () => groupCataloguedDatasets(datasets),
    [datasets],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preparation.status !== "ready" || locked || invalid) return;
    void controller.actions.submit(event.currentTarget);
  }

  return (
    <>
      <details className={styles.createDisclosure} onToggle={(event) => { setOpen(event.currentTarget.open); preparation.actions.changeOpen(event.currentTarget.open); }}>
        <summary className={buttonRecipe({ variant: "primary" })}>
          {adminStudentsText.createStudent.open}
        </summary>
        <div className={styles.createContent}>
          {preparation.status === "loading" ? <Notice role="status">{adminStudentsText.createStudent.preparationLoading}</Notice> : null}
          {preparation.status === "error" ? <Notice role="alert" tone="danger">
            {adminStudentsText.createStudent.preparationError}
            <Button onClick={preparation.actions.retry} variant="quiet">{adminStudentsText.page.retry}</Button>
          </Notice> : null}
          {locked ? <Notice role="alert" tone="danger">
            {adminStudentsText.createStudent.preparationAuthError}
            <Link href="/admin/login" prefetch={false}>{adminStudentsText.createStudent.preparationLogin}</Link>
          </Notice> : (
          <form
            aria-busy={controller.busy}
            className={styles.formStack}
            onSubmit={submit}
            onReset={() => { setDisplayName(""); setSchoolName(""); setSelectedSchool(null); setGrade(""); school.actions.reset(); }}
          >
            <input type="hidden" name="schoolKey" value={selectedSchool?.id ?? ""} />
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
                <FieldRequirement data-kind="required" className={styles.requiredTag}>
                  {adminStudentsText.createStudent.required}
                </FieldRequirement>
              </FieldLabelRow>
              <Input
                aria-label={adminStudentsText.createStudent.nameLabel}
                maxLength={80}
                name="displayName"
                value={displayName}
                onChange={event => setDisplayName(event.target.value)}
                aria-invalid={!!errors.displayName}
                aria-describedby={errors.displayName ? `${fieldId}-name-error` : undefined}
                placeholder={adminStudentsText.createStudent.namePlaceholder}
                required
              />
              {errors.displayName ? <FieldError id={`${fieldId}-name-error`}>{errors.displayName}</FieldError> : null}
            </Field>
            <div className={styles.formGrid}>
              <SchoolSearchField controller={school} required error={errors.schoolName} />
              <Field as="label">
                <FieldLabelRow>
                  <FieldLabel as="span">
                    {adminStudentsText.createStudent.gradeLabel}
                  </FieldLabel>
                  <FieldRequirement data-kind="required" className={styles.requiredTag}>
                    {adminStudentsText.createStudent.required}
                  </FieldRequirement>
                </FieldLabelRow>
                <Select name="gradeLabel" required disabled={!schoolName.trim()} value={grade}
                  aria-invalid={!!errors.gradeLabel} aria-describedby={`${fieldId}-grade-help${errors.gradeLabel ? ` ${fieldId}-grade-error` : ""}`}
                  onChange={event => setGrade(event.target.value)}>
                  <option value="">학년 선택</option>
                  {(selectedSchool?.level ? [selectedSchool.level] : ["중", "고"]).flatMap(level => [1, 2, 3].map(value =>
                    <option key={`${level}${value}`} value={`${level}${value}`}>{selectedSchool?.level ? `${value}학년` : `${level}${value}`}</option>))}
                </Select>
                {errors.gradeLabel ? <FieldError id={`${fieldId}-grade-error`}>{errors.gradeLabel}</FieldError> : null}
                <FieldHelp id={`${fieldId}-grade-help`}>{selectedSchool?.level ? "학생의 학년을 선택해 주세요." : "학교를 직접 입력했다면 중등·고등과 학년을 함께 골라 주세요."}</FieldHelp>
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
                disabled={preparation.status !== "ready"}
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
              {preparation.status === "ready" && datasets.length === 0 ? (
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
            <Button disabled={controller.busy || preparation.status !== "ready" || invalid} type="submit" variant="primary">
              {controller.busy
                ? adminStudentsText.createStudent.submitting
                : adminStudentsText.createStudent.submit}
            </Button>
          </form>)}
        </div>
      </details>

      {controller.code && !locked ? (
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
