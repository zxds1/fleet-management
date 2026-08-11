// packages/mobile/src/design/components/OfflineBanner.tsx
import React from "react";
import { Text } from "react-native";
import { Banner } from "./Banner";
import { theme } from "../theme";
import { t } from "@/core/i18n";
import type { OutboxCounts } from "@/core/offlineQueue";

interface OfflineBannerProps {
  online: boolean;
  counts?: OutboxCounts;
  onOpenOutbox?: () => void;
}

/**
 * Bottom-persistent banner (offline + pending/needs-review counts). Drives to the Outbox so the
 * driver can resolve stuck writes (D-7): duplicates are discarded, hard errors go to FAILED_REVIEW.
 */
export function OfflineBanner({ online, counts, onOpenOutbox }: OfflineBannerProps) {
  if (online && !counts) return null;

  if (!online) {
    const pending = counts?.pending ?? 0;
    const failed = counts?.failedReview ?? 0;
    const message =
      pending > 0
        ? t("offlineBanner.pending", { count: pending })
        : failed > 0
          ? t("offlineBanner.failed", { count: failed })
          : t("offlineBanner.offline");
    return (
      <Banner
        testID="offline-banner"
        tone={failed > 0 ? "danger" : "warning"}
        message={message}
        actionLabel={t("offlineBanner.openOutbox")}
        onAction={onOpenOutbox}
      />
    );
  }

  // Online but something needs review.
  if (counts && counts.failedReview > 0) {
    return (
      <Banner
        testID="offline-banner"
        tone="danger"
        message={t("offlineBanner.failed", { count: counts.failedReview })}
        actionLabel={t("offlineBanner.openOutbox")}
        onAction={onOpenOutbox}
      />
    );
  }
  return null;
}
