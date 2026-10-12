import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Check, MessageSquarePlus, Reply } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { getInlineReviewThreadViewportStyle } from "@/review";
import type { Theme } from "@/styles/theme";
import {
  PR_INLINE_COMMENT_HEIGHT,
  PR_INLINE_EDITOR_HEIGHT,
  PR_INLINE_REPLY_BUTTON_HEIGHT,
  type PrInlineActions,
  type PrInlineComment,
  type PrInlineThreadData,
} from "./pr-inline";

function getWebTextInputElement(input: EditingTextInputHandle | null): HTMLElement | null {
  if (!isWeb || typeof HTMLElement === "undefined" || !input) {
    return null;
  }
  const element = input.getNativeRef();
  return element instanceof HTMLElement ? element : null;
}

/**
 * Read-only forge PR comment threads anchored to a diff line, with an inline reply
 * composer. Heights are fixed (see pr-inline.ts) because the canvas reserves space
 * by computed height; bodies truncate to fit, full text lives in the PR panel list.
 */
export function PrInlineThread({
  threads,
  actions,
  height,
  viewportWidth,
  pinToViewport,
}: {
  threads: readonly PrInlineThreadData[];
  actions: PrInlineActions;
  height: number;
  viewportWidth: number;
  pinToViewport: boolean;
}) {
  return (
    <View
      style={[
        styles.container,
        getInlineReviewThreadViewportStyle({ viewportWidth, pinToViewport }),
        { height },
      ]}
    >
      {threads.map((thread) => (
        <PrInlineThreadBlock key={thread.key} thread={thread} actions={actions} />
      ))}
    </View>
  );
}

function PrInlineThreadBlock({
  thread,
  actions,
}: {
  thread: PrInlineThreadData;
  actions: PrInlineActions;
}) {
  const { t } = useTranslation();
  const open = actions.openComposerKeys.has(thread.key);
  const handleOpen = useCallback(
    () => actions.onToggleComposer(thread.key, true),
    [actions, thread.key],
  );
  const handleClose = useCallback(
    () => actions.onToggleComposer(thread.key, false),
    [actions, thread.key],
  );
  const handleReply = useCallback(
    (body: string) => actions.onReply(thread, body),
    [actions, thread],
  );
  const { onAddThreadToChat, onResolveThread } = actions;
  const handleAddToChat = useCallback(
    () => onAddThreadToChat?.(thread.key),
    [onAddThreadToChat, thread.key],
  );
  const handleResolve = useCallback(
    () => onResolveThread?.({ threadKey: thread.key, resolved: !thread.isResolved }),
    [onResolveThread, thread.key, thread.isResolved],
  );

  return (
    <View style={styles.block}>
      {thread.isResolved || thread.isOutdated ? (
        <View style={styles.badgeRow}>
          {thread.isResolved ? (
            <StatusBadge label={t("workspace.git.pr.thread.resolved")} variant="success" />
          ) : null}
          {thread.isOutdated ? <StatusBadge label={t("workspace.git.pr.thread.outdated")} /> : null}
        </View>
      ) : null}
      {thread.comments.map((comment) => (
        <PrInlineCommentCard key={comment.id} comment={comment} />
      ))}
      {open ? (
        <PrInlineComposer onCancel={handleClose} onReply={handleReply} />
      ) : (
        <View style={styles.actionRow}>
          <Button
            variant="ghost"
            size="xs"
            leftIcon={Reply}
            onPress={handleOpen}
            testID={`pr-inline-reply-${thread.key}`}
          >
            {t("workspace.git.pr.actions.reply")}
          </Button>
          {onAddThreadToChat ? (
            <Button
              variant="ghost"
              size="xs"
              leftIcon={MessageSquarePlus}
              onPress={handleAddToChat}
              testID={`pr-inline-add-to-chat-${thread.key}`}
            >
              {t("workspace.git.pr.actions.addToChat")}
            </Button>
          ) : null}
          {onResolveThread ? (
            <Button
              variant="ghost"
              size="xs"
              leftIcon={Check}
              onPress={handleResolve}
              testID={`pr-inline-resolve-${thread.key}`}
            >
              {t(
                thread.isResolved
                  ? "workspace.git.pr.actions.unresolve"
                  : "workspace.git.pr.actions.resolve",
              )}
            </Button>
          ) : null}
        </View>
      )}
    </View>
  );
}

function PrInlineCommentCard({ comment }: { comment: PrInlineComment }) {
  const avatarSource = useMemo(
    () => (comment.avatarUrl ? { uri: comment.avatarUrl } : null),
    [comment.avatarUrl],
  );
  const avatarPlaceholderStyle = useMemo(
    () => [styles.avatar, { backgroundColor: comment.avatarColor }],
    [comment.avatarColor],
  );
  return (
    <View style={styles.commentCard}>
      <View style={styles.commentHeader}>
        {avatarSource ? (
          <Image source={avatarSource} style={styles.avatar} />
        ) : (
          <View style={avatarPlaceholderStyle} />
        )}
        <Text style={styles.author} numberOfLines={1}>
          {comment.author}
        </Text>
        <Text style={styles.age}>{comment.age}</Text>
      </View>
      <Text style={styles.body} numberOfLines={2}>
        {comment.body}
      </Text>
    </View>
  );
}

function PrInlineComposer({
  onCancel,
  onReply,
}: {
  onCancel: () => void;
  onReply: (body: string) => Promise<{ ok: boolean; error: string | null }>;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<EditingTextInputHandle | null>(null);
  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && !pending;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (trimmed.length === 0 || pending) {
      return;
    }
    setPending(true);
    setError(null);
    const result = await onReply(trimmed);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
    }
    // On success the timeline refetch removes the composer with the stale thread.
  }, [onReply, pending, trimmed]);

  useEffect(() => {
    const element = getWebTextInputElement(inputRef.current);
    if (!element) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Enter" || event.shiftKey || (!event.metaKey && !event.ctrlKey)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void handleSubmit();
    };
    element.addEventListener("keydown", handleKeyDown);
    return () => element.removeEventListener("keydown", handleKeyDown);
  }, [handleSubmit, onCancel]);

  return (
    <View style={styles.composer}>
      <TextInput
        ref={inputRef}
        accessibilityLabel={t("workspace.git.pr.actions.reply")}
        placeholder={t("review.comment.placeholder")}
        placeholderTextColor={styles.placeholder.color}
        multiline
        initialValue={body}
        onChangeText={setBody}
        editable={!pending}
        style={styles.input}
      />
      {error ? (
        <Text style={styles.error} numberOfLines={1}>
          {error}
        </Text>
      ) : null}
      <View style={styles.composerActions}>
        <Button variant="ghost" size="xs" onPress={onCancel} disabled={pending}>
          {t("review.comment.cancel")}
        </Button>
        <Button variant="default" size="xs" disabled={!canSubmit} onPress={handleSubmit}>
          {pending
            ? t("workspace.git.pr.actions.sendingReply")
            : t("workspace.git.pr.actions.reply")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    backgroundColor: theme.colors.surface2,
  },
  block: {
    gap: theme.spacing[1],
  },
  badgeRow: {
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  commentCard: {
    height: PR_INLINE_COMMENT_HEIGHT,
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  avatar: {
    width: 16,
    height: 16,
    borderRadius: theme.borderRadius.full,
  },
  author: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  age: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  body: {
    fontSize: 12,
    color: theme.colors.foreground,
  },
  actionRow: {
    height: PR_INLINE_REPLY_BUTTON_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  composer: {
    height: PR_INLINE_EDITOR_HEIGHT,
    gap: theme.spacing[1],
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    fontSize: 12,
  },
  placeholder: {
    color: theme.colors.foregroundMuted,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: 11,
  },
  composerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
