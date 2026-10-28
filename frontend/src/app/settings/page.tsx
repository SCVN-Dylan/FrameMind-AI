import type { Metadata } from "next";

import SettingsView from "@/components/views/SettingsView";

export const metadata: Metadata = { title: "Settings · FrameMind AI" };

export default function SettingsPage() {
  return <SettingsView />;
}
