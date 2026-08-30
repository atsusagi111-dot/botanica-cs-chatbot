export const CATEGORY_LIST = ["在庫", "配送", "返品", "商品", "その他"] as const;

/** 営業時間（JST、平日のみ）。時間外は AI のみ対応 + 翌営業日キュー */
export const BUSINESS_HOURS = {
  timezone: "Asia/Tokyo",
  startHour: 9,
  endHour: 18,
} as const;

export const ESCALATION_REASONS = [
  "no_faq_match",
  "complaint_detected",
  "after_hours",
  "manual",
] as const;

export const CONVERSATION_STATUSES = [
  "ai_handling",
  "waiting_operator",
  "operator_handling",
  "closed",
] as const;

export const STATUS_LABELS: Record<string, string> = {
  ai_handling: "AI対応中",
  waiting_operator: "オペレーター待ち",
  operator_handling: "オペレーター対応中",
  closed: "完了",
};

export const ESCALATION_REASON_LABELS: Record<string, string> = {
  no_faq_match: "該当FAQなし",
  complaint_detected: "クレーム検知",
  after_hours: "営業時間外",
  manual: "手動エスカレーション",
};
