"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useEffect } from "react";
import { AssistantChat } from "./assistant-chat";
import { useAssistantChat } from "./chat-provider";

/** The Ask Lotline page: the shared conversation, kept in the URL (?c=) so it can be reopened. */
export function AssistantClient() {
  const chat = useAssistantChat();
  const [c, setC] = useQueryState("c", parseAsString);
  const [q, setQ] = useQueryState("q", parseAsString);

  // Arriving with ?c= opens that conversation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the URL changes
  useEffect(() => {
    if (c && c !== chat.conversationId) chat.open(c);
  }, [c]);
  // The conversation in view goes into the URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the conversation changes
  useEffect(() => {
    if (chat.conversationId !== c)
      void setC(chat.conversationId, { history: "replace" });
  }, [chat.conversationId]);
  // ?q= starts a question, ready to send.
  useEffect(() => {
    if (q) {
      chat.setDraft(q);
      void setQ(null);
    }
  }, [q, setQ, chat.setDraft]);
  // The page is open: no need for the floating panel too.
  useEffect(() => chat.setPanelOpen(false), [chat.setPanelOpen]);

  return <AssistantChat variant="page" />;
}
