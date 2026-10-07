import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, type TextStyle, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Reply } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

function getWebTextInputElement(input: EditingTextInputHandle | null): HTMLElement | null {
  if (!isWeb || typeof HTMLElement === "undefined" || !input) {
    return null;
  }
  const element = input.getNativeRef();
  return element instanceof HTMLElement ? element : null;
}

/**
 * Collapsed "Reply" affordance that expands into a small composer. Shared by the
 * PR activity list and the inline diff thread so both post through the same hook.
 * Cmd/Ctrl+Enter submits and Escape collapses on web.
 */
export function PrReplyComposer({
  onSubmit,
  testID,
}: {
  onSubmit: (body: string) => Promise<{ ok: boolean; error: string | null }>;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<EditingTextInputHandle | null>(null);
  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && !pending;

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleCancel = useCallback(() => {
    setOpen(false);
    setBody("");
    setError(null);
  }, []);
  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);

  const handleSubmit = useCallback(async () => {
    if (trimmed.length === 0 || pending) {
      return;
    }
    setPending(true);
    setError(null);
    const result = await onSubmit(trimmed);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      setBody("");
      return;
    }
    setError(result.error);
  }, [onSubmit, pending, trimmed]);

  useEffect(() => {
    const element = getWebTextInputElement(inputRef.current);
    if (!element || !open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleCancel();
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
  }, [handleCancel, handleSubmit, open]);

  const inputStyle = useMemo<TextStyle[]>(
    () => [styles.input, ...(isFocused ? [styles.inputFocused] : [])],
    [isFocused],
  );

  if (!open) {
    return (
      <View style={styles.triggerRow}>
        <Button
          variant="ghost"
          size="xs"
          leftIcon={Reply}
          onPress={handleOpen}
          testID={testID ? `${testID}-open` : undefined}
        >
          {t("workspace.git.pr.actions.reply")}
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.block} testID={testID}>
      <TextInput
        ref={inputRef}
        accessibilityLabel={t("workspace.git.pr.actions.reply")}
        testID={testID ? `${testID}-input` : undefined}
        placeholder={t("review.comment.placeholder")}
        placeholderTextColor={styles.placeholder.color}
        multiline
        initialValue={body}
        onChangeText={setBody}
        onFocus={handleFocus}
        onBlur={handleBlur}
        editable={!pending}
        style={inputStyle}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <Button variant="ghost" size="xs" onPress={handleCancel} disabled={pending}>
          {t("review.comment.cancel")}
        </Button>
        <Button
          variant="default"
          size="xs"
          disabled={!canSubmit}
          onPress={handleSubmit}
          testID={testID ? `${testID}-submit` : undefined}
        >
          {pending
            ? t("workspace.git.pr.actions.sendingReply")
            : t("workspace.git.pr.actions.reply")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  triggerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  block: {
    gap: theme.spacing[2],
  },
  input: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    fontSize: 13,
  },
  inputFocused: {
    borderColor: theme.colors.accent,
  },
  placeholder: {
    color: theme.colors.foregroundMuted,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: 12,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
