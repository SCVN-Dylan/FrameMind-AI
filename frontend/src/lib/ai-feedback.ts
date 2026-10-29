// Maps backend AI feedback to the FeedbackItem shape the existing feedback cards and timeline use.

import { apiUrl, type ApiFeedback } from "./api";
import type { FeedbackItem } from "./types";

export function toFeedbackItem(feedback: ApiFeedback): FeedbackItem {
  return {
    id: feedback.id,
    category: feedback.category,
    severity: feedback.severity,
    title: feedback.title,
    summary: feedback.observation,
    referenceMs: feedback.reference_timestamp_ms,
    currentMs: feedback.current_timestamp_ms,
    unityFix: [feedback.unity_recommendation],
    impact: feedback.impact,
    suggestedFix: feedback.suggested_fix,
    confidence: feedback.confidence,
    evidence: feedback.evidence.map((frame) => ({
      label: frame.label,
      slot: frame.role,
      ms: frame.timestamp_ms,
      imageUrl: frame.url ? apiUrl(frame.url) : null,
    })),
  };
}
