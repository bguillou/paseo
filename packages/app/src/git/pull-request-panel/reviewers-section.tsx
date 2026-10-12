import React, { useCallback, useMemo, useState } from "react";
import { Image, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { CircleCheck, CircleX, Clock, MessageSquare, RotateCw } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import type { PrReviewer, ReviewerState } from "./data";
import {
  dangerColorMapping,
  foregroundMutedColorMapping,
  Section,
  sectionKitStyles,
  SummaryPill,
  successColorMapping,
  warningColorMapping,
} from "./section-kit";

const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedCircleX = withUnistyles(CircleX);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedClock = withUnistyles(Clock);

const APPROVED_ICON = <ThemedCircleCheck size={12} uniProps={successColorMapping} />;
const CHANGES_REQUESTED_ICON = <ThemedCircleX size={12} uniProps={dangerColorMapping} />;
const WAITING_ICON = <ThemedClock size={12} uniProps={warningColorMapping} />;
const COMMENTED_ICON = <ThemedMessageSquare size={12} uniProps={foregroundMutedColorMapping} />;

const AVATAR_SIZE = 20;

export interface ReviewersSectionProps {
  reviewers: PrReviewer[];
  open: boolean;
  onToggle: () => void;
  /** True when the daemon can re-request reviews; hides the per-row button otherwise. */
  canRequestReview: boolean;
  /** Re-requests a review from the reviewer. Resolves when the request settles. */
  onRequestReview: (reviewer: PrReviewer) => Promise<void>;
}

export function ReviewersSection({
  reviewers,
  open,
  onToggle,
  canRequestReview,
  onRequestReview,
}: ReviewersSectionProps) {
  const { t } = useTranslation();
  const [requesting, setRequesting] = useState<ReadonlySet<string>>(() => new Set());

  const counts = useMemo(() => countReviewerStates(reviewers), [reviewers]);

  const handleRequest = useCallback(
    async (reviewer: PrReviewer) => {
      setRequesting((prev) => new Set(prev).add(reviewer.login));
      try {
        await onRequestReview(reviewer);
      } finally {
        setRequesting((prev) => {
          const next = new Set(prev);
          next.delete(reviewer.login);
          return next;
        });
      }
    },
    [onRequestReview],
  );

  return (
    <Section
      title={t("workspace.git.pr.sections.reviewers")}
      open={open}
      onToggle={onToggle}
      summary={
        <>
          <SummaryPill count={counts.approved} icon={APPROVED_ICON} variant="success" />
          <SummaryPill
            count={counts.changes_requested}
            icon={CHANGES_REQUESTED_ICON}
            variant="danger"
          />
          <SummaryPill count={counts.pending} icon={WAITING_ICON} variant="warning" />
          <SummaryPill count={counts.commented} icon={COMMENTED_ICON} variant="muted" />
        </>
      }
    >
      {reviewers.length === 0 ? (
        <Text style={sectionKitStyles.emptyText}>{t("workspace.git.pr.reviewers.empty")}</Text>
      ) : (
        reviewers.map((reviewer) => (
          <ReviewerRow
            key={`${reviewer.isTeam ? "team" : "user"}:${reviewer.login}`}
            reviewer={reviewer}
            canRequestReview={canRequestReview}
            requesting={requesting.has(reviewer.login)}
            onRequestReview={handleRequest}
          />
        ))
      )}
    </Section>
  );
}

function ReviewerRow({
  reviewer,
  canRequestReview,
  requesting,
  onRequestReview,
}: {
  reviewer: PrReviewer;
  canRequestReview: boolean;
  requesting: boolean;
  onRequestReview: (reviewer: PrReviewer) => Promise<void>;
}) {
  const { t } = useTranslation();
  // A team is always "awaiting" and can't be individually re-requested here, and a
  // reviewer already waiting has nothing to re-request.
  const canRequest = canRequestReview && !reviewer.isTeam && reviewer.state !== "pending";

  const handlePress = useCallback(() => {
    void onRequestReview(reviewer);
  }, [onRequestReview, reviewer]);

  return (
    <View style={sectionKitStyles.checkRow}>
      <ReviewerAvatar reviewer={reviewer} />
      <Text style={sectionKitStyles.checkName} numberOfLines={1}>
        {reviewer.login}
      </Text>
      <View style={sectionKitStyles.checkTrailing}>
        <StatusBadge
          label={t(reviewerStatusLabelKey(reviewer.state))}
          variant={reviewerStatusVariant(reviewer.state)}
          size="xs"
        />
        {canRequest ? (
          <Button
            size="xs"
            variant="ghost"
            leftIcon={RotateCw}
            loading={requesting}
            disabled={requesting}
            onPress={handlePress}
            accessibilityLabel={t("workspace.git.pr.reviewers.requestReviewA11y", {
              login: reviewer.login,
            })}
          />
        ) : null}
      </View>
    </View>
  );
}

function ReviewerAvatar({ reviewer }: { reviewer: PrReviewer }) {
  const imageSource = useMemo(
    () => (reviewer.avatarUrl ? { uri: reviewer.avatarUrl } : null),
    [reviewer.avatarUrl],
  );
  const frameStyle = useMemo(
    () => [styles.avatar, { backgroundColor: reviewer.avatarColor }],
    [reviewer.avatarColor],
  );
  if (imageSource) {
    return <Image source={imageSource} style={styles.avatarImage} />;
  }
  return (
    <View style={frameStyle}>
      <Text style={styles.avatarText}>{reviewer.login.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function countReviewerStates(reviewers: PrReviewer[]): Record<ReviewerState, number> {
  const counts: Record<ReviewerState, number> = {
    approved: 0,
    changes_requested: 0,
    commented: 0,
    pending: 0,
  };
  for (const reviewer of reviewers) {
    counts[reviewer.state] += 1;
  }
  return counts;
}

function reviewerStatusVariant(state: ReviewerState): StatusBadgeVariant {
  if (state === "approved") return "success";
  if (state === "changes_requested") return "error";
  if (state === "pending") return "warning";
  return "muted";
}

function reviewerStatusLabelKey(state: ReviewerState): string {
  if (state === "approved") return "workspace.git.pr.reviewers.status.approved";
  if (state === "changes_requested") return "workspace.git.pr.reviewers.status.changesRequested";
  if (state === "pending") return "workspace.git.pr.reviewers.status.waiting";
  return "workspace.git.pr.reviewers.status.commented";
}

const styles = StyleSheet.create((theme) => ({
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarText: {
    fontSize: 10,
    fontWeight: theme.fontWeight.normal,
    color: "#fff",
  },
}));
