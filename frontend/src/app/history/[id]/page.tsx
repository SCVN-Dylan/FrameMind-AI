import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AnalysisDetailView from "@/components/views/AnalysisDetailView";
import { DEMO_ANALYSIS_IDS, getDemoAnalysis } from "@/lib/mock-data";

export function generateStaticParams() {
  return DEMO_ANALYSIS_IDS.map((id) => ({ id }));
}

export async function generateMetadata(props: PageProps<"/history/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `${getDemoAnalysis(id)?.title ?? "Analysis"} · FrameMind AI` };
}

export default async function AnalysisDetailPage(props: PageProps<"/history/[id]">) {
  const { id } = await props.params;
  if (!DEMO_ANALYSIS_IDS.includes(id)) notFound();
  return <AnalysisDetailView id={id} />;
}
