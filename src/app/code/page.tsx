import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { studentAppText } from "@/content/ko/student-app";

export const metadata: Metadata = {
  title: studentAppText.login.metadataTitle,
};

export default function StudentCodePage() {
  redirect("/");
}
