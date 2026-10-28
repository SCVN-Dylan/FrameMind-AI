import type { Metadata } from "next";

import NewAnalysisView from "@/components/views/NewAnalysisView";

export const metadata: Metadata = { title: "New Analysis · FrameMind AI" };

export default function NewAnalysisPage() {
  return <NewAnalysisView />;
}
