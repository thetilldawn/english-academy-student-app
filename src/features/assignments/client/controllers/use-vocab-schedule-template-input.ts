"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { adminLearningText } from "@/content/ko/admin-learning";

export type SaveScheduleTemplate = (name: string) => Promise<
  { ok: true } | { ok: false; message: string }
>;

export function useVocabScheduleTemplateInput({
  saving,
  onSave,
}: {
  saving: boolean;
  onSave: SaveScheduleTemplate;
}) {
  const [name, setName] = useState("");
  const pendingRef = useRef(false);

  async function save() {
    if (saving || pendingRef.current || !name.trim()) return;
    pendingRef.current = true;
    try {
      const result = await onSave(name);
      if (result.ok) {
        setName("");
        toast.success(adminLearningText.timeTemplate.saved);
      } else toast.error(result.message);
    } catch {
      toast.error(adminLearningText.timeTemplate.saveFailed);
    } finally {
      pendingRef.current = false;
    }
  }

  return { name, setName, save };
}
