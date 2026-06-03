import { aixChatGenerateContent_DMessage_FromConversation, AixChatGenerateContent_DMessageGuts } from '~/modules/aix/client/aix.client';
import { autoChatFollowUps } from '~/modules/aifn/auto-chat-follow-ups/autoChatFollowUps';
import { autoConversationTitle } from '~/modules/aifn/autotitle/autoTitle';

import { DConversationId, splitSystemMessageFromHistory } from '~/common/stores/chat/chat.conversation';
import type { DLLMId } from '~/common/stores/llms/llms.types';
import { AudioGenerator } from '~/common/util/audio/AudioGenerator';
import { ConversationsManager } from '~/common/chat-overlay/ConversationsManager';
import { DMessage, MESSAGE_FLAG_NOTIFY_COMPLETE, messageWasInterruptedAtStart } from '~/common/stores/chat/chat.message';
import { isContentFragment } from '~/common/stores/chat/chat.fragments';
import { getLabsHighPerformance } from '~/common/stores/store-ux-labs';

import { PersonaChatMessageSpeak } from './persona/PersonaChatMessageSpeak';
import { getEnabledRapidMlxTools, executeRapidMlxTool } from './rapid-mlx-tools';
import { getChatAutoAI, getChatThinkingPolicy, getIsNotificationEnabledForModel } from '../store-app-chat';
import { getInstantAppChatPanesCount } from '../components/panes/store-panes-manager';


// configuration
export const CHATGENERATE_RESPONSE_PLACEHOLDER = '...'; // 💫 ..., 🖊️ ...

// rapid-mlx fork: cap the agent loop so a misbehaving model can't burn
// through tokens forever calling tools. Five rounds is enough for any
// realistic multi-step query (the built-in tools — calculator, now —
// don't compose in long chains).
const RAPID_MLX_MAX_TOOL_ROUNDS = 5;


export interface PersonaProcessorInterface {
  handleMessage(accumulatedMessage: AixChatGenerateContent_DMessageGuts, messageComplete: boolean): void;
}


/**
 * The main "chat" function.
 * @returns `true` if the operation was successful, `false` otherwise.
 *
 * rapid-mlx fork: this used to be a single aix call. Now it's a loop
 * that re-calls aix whenever the model emits a tool_invocation,
 * executing the tool client-side (see `./rapid-mlx-tools.ts`) and
 * appending the tool_response back to the assistant message so the
 * next inference round sees it. Capped at RAPID_MLX_MAX_TOOL_ROUNDS.
 */
export async function runPersonaOnConversationHead(
  assistantLlmId: DLLMId,
  conversationId: DConversationId,
): Promise<boolean> {

  const cHandler = ConversationsManager.getHandler(conversationId);

  const _initialHistory = cHandler.historyViewHeadOrThrow('runPersonaOnConversationHead') as Readonly<DMessage[]>;
  if (_initialHistory.length === 0)
    return false;

  let { chatSystemInstruction, chatHistory } = splitSystemMessageFromHistory(_initialHistory);

  const isNotifyEnabled = getIsNotificationEnabledForModel(assistantLlmId);

  // initial assistant placeholder; reassigned on each tool round so the
  // model's next pass writes into a fresh message.
  let { assistantMessageId } = cHandler.messageAppendAssistantPlaceholder(
    CHATGENERATE_RESPONSE_PLACEHOLDER,
    {
      purposeId: chatSystemInstruction?.purposeId,
      generator: { mgt: 'named', name: assistantLlmId },
      ...(isNotifyEnabled ? { userFlags: [MESSAGE_FLAG_NOTIFY_COMPLETE] } : {}),
    },
  );

  const parallelViewCount = getLabsHighPerformance() ? 0 : getInstantAppChatPanesCount();

  // ai follow-up operations (fire/forget) — read once, applied after the
  // whole tool loop finishes.
  const { autoSpeak, autoSuggestDiagrams, autoSuggestHTMLUI, autoSuggestQuestions, autoTitleChat } = getChatAutoAI();
  const autoSpeaker: PersonaProcessorInterface | null = autoSpeak !== 'off' ? new PersonaChatMessageSpeak(autoSpeak) : null;

  // one abort controller across all tool rounds — Ctrl-C kills the chain.
  const abortController = new AbortController();
  cHandler.setAbortController(abortController, 'chat-persona');

  // track the *most recent* aix result; the auto-follow-up + abort logic
  // below references it after the loop exits.
  let messageStatus!: Awaited<ReturnType<typeof aixChatGenerateContent_DMessage_FromConversation>>;

  let toolRound = 0;
  while (true) {

    // capture the current id so the streaming callback closes over the
    // correct message even after we rotate to the next round.
    const writeTargetId = assistantMessageId;

    // Re-read the tools-config each round so the user can flip toggles
    // mid-conversation. Only enabled tools are advertised.
    const enabledTools = getEnabledRapidMlxTools();

    messageStatus = await aixChatGenerateContent_DMessage_FromConversation(
      assistantLlmId,
      chatSystemInstruction,
      chatHistory,
      'conversation',
      conversationId,
      { abortSignal: abortController.signal, throttleParallelThreads: parallelViewCount },
      (messageOverwrite: AixChatGenerateContent_DMessageGuts, messageComplete: boolean) => {
        const { fragments, ...rest } = messageOverwrite;
        const includeFragments = !!fragments?.length || messageComplete || !messageOverwrite.pendingIncomplete;
        cHandler.messageEdit(writeTargetId, { ...(includeFragments && { fragments }), ...rest }, messageComplete, false);
        autoSpeaker?.handleMessage(messageOverwrite, messageComplete);
      },
      enabledTools,
    );

    // detect tool invocations in the just-completed assistant turn.
    const toolInvocations: { id: string; name: string; args: string }[] = [];
    for (const f of messageStatus.lastDMessage.fragments) {
      if (isContentFragment(f) && f.part.pt === 'tool_invocation' && f.part.invocation.type === 'function_call') {
        toolInvocations.push({
          id: f.part.id,
          name: f.part.invocation.name,
          args: f.part.invocation.args ?? '',
        });
      }
    }

    // failure / abort / no tool calls => exit the loop and let the
    // tail logic (notify, autoTitle, autoFollowUp) run as before.
    if (
      messageStatus.outcome !== 'completed'
      || abortController.signal.aborted
      || toolInvocations.length === 0
    )
      break;

    if (++toolRound > RAPID_MLX_MAX_TOOL_ROUNDS) {
      console.warn(`[rapid-mlx] tool loop hit RAPID_MLX_MAX_TOOL_ROUNDS (${RAPID_MLX_MAX_TOOL_ROUNDS}); stopping.`);
      break;
    }

    // execute each tool locally and append the response fragment to
    // the *same* assistant message that holds the matching invocation.
    // The server adapter (openai.chatCompletions.ts) splits tool_response
    // out into its own role: 'tool' wire message keyed by invocation id.
    // Tool execution may be async (e.g. weather fetches the relay) so
    // we await each in sequence — order matters for the model's view
    // of the conversation.
    for (const inv of toolInvocations) {
      const responseFragment = await executeRapidMlxTool(inv.id, inv.name, inv.args);
      cHandler.messageFragmentAppend(writeTargetId, responseFragment, true, false);
    }

    // refresh history so the next aix call sees the tool responses we
    // just appended, then create a fresh assistant placeholder for the
    // model's continuation pass.
    const _nextHistory = cHandler.historyViewHeadOrThrow('runPersonaOnConversationHead') as Readonly<DMessage[]>;
    const split = splitSystemMessageFromHistory(_nextHistory);
    chatSystemInstruction = split.chatSystemInstruction;
    chatHistory = split.chatHistory;

    ({ assistantMessageId } = cHandler.messageAppendAssistantPlaceholder(
      CHATGENERATE_RESPONSE_PLACEHOLDER,
      {
        purposeId: chatSystemInstruction?.purposeId,
        generator: { mgt: 'named', name: assistantLlmId },
        ...(isNotifyEnabled ? { userFlags: [MESSAGE_FLAG_NOTIFY_COMPLETE] } : {}),
      },
    ));
  }

  // final message update (needed only in case of error on the last
  // round). assistantMessageId points at the most recently written turn.
  const lastDMessage = messageStatus.lastDMessage;
  if (messageStatus.outcome === 'failed')
    cHandler.messageEdit(assistantMessageId, lastDMessage, true, false);

  // special case: if the last message was aborted and had no content, delete it
  if (messageWasInterruptedAtStart(lastDMessage)) {
    cHandler.messagesDelete([assistantMessageId]);
    return false;
  }

  // notify when complete, if set
  if (cHandler.messageHasUserFlag(assistantMessageId, MESSAGE_FLAG_NOTIFY_COMPLETE)) {
    cHandler.messageSetUserFlag(assistantMessageId, MESSAGE_FLAG_NOTIFY_COMPLETE, false, false);
    AudioGenerator.chatNotifyResponse();
  }

  const hasBeenAborted = abortController.signal.aborted;

  // clear to send, again
  // FIXME: race condition? (for sure!)
  cHandler.clearAbortController('chat-persona');

  if (autoTitleChat) {
    void autoConversationTitle(conversationId, false);
  }

  if (!hasBeenAborted && (autoSuggestDiagrams || autoSuggestHTMLUI || autoSuggestQuestions))
    void autoChatFollowUps(conversationId, assistantMessageId, autoSuggestDiagrams, autoSuggestHTMLUI, autoSuggestQuestions);

  const chatThinkingPolicy = getChatThinkingPolicy();
  if (chatThinkingPolicy === 'last-only')
    cHandler.historyStripThinking(1);
  else if (chatThinkingPolicy === 'discard-all')
    cHandler.historyStripThinking(0);

  return messageStatus.outcome === 'completed';
}
