import type { Metadata } from "next";

import HistoryView from "@/components/views/HistoryView";

export const metadata: Metadata = { title: "Analysis History · FrameMind AI" };

export default function HistoryPage() {
  return <HistoryView />;
}
