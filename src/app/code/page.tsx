import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "학생 접속",
};

export default function StudentCodePage() {
  redirect("/");
}
