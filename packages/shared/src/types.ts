/**
 * apps/widget, apps/admin, supabase/functions/chat すべてで共有する型定義。
 * DBスキーマ（supabase/migrations/0001_init_schema.sql）と1対1で対応させること。
 */

export type ConversationStatus =
  | "ai_handling"
  | "waiting_operator"
  | "operator_handling"
  | "closed";

export type Category = "在庫" | "配送" | "返品" | "商品" | "その他";

export type SenderType = "customer" | "ai" | "operator";

export type EscalationReason =
  | "no_faq_match"
  | "complaint_detected"
  | "after_hours"
  | "manual";

export interface Conversation {
  id: string;
  customer_session_id: string;
  status: ConversationStatus;
  assigned_operator_id: string | null;
  category: Category | null;
  escalation_reason: EscalationReason | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id: string | null;
  content: string;
  matched_faq_ids: string[] | null;
  created_at: string;
}

export interface Faq {
  id: string;
  category: string;
  question: string;
  answer: string;
  created_at: string;
}

export interface Profile {
  id: string;
  display_name: string;
  created_at: string;
}

/** POST /functions/v1/chat のリクエストボディ */
export interface ChatRequestBody {
  sessionId: string;
  conversationId?: string;
  message: string;
}

/** POST /functions/v1/chat のレスポンスボディ */
export interface ChatResponseBody {
  conversationId: string;
  messages: Message[];
  status: ConversationStatus;
}
