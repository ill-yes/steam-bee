import type { Account } from "../../api";
import type { Messages } from "../../i18n";
import { statusLabel, statusTone } from "../../lib/status";
import { hubCopy } from "./detail/hubCopy";

export type ActivityTone = ReturnType<typeof statusTone>;

/** While Steam runs games, the reported mode decides the wording, not the raw "boosting" status. */
export function accountActivityStatus(
  account: Pick<Account, "runtimeStatus" | "activityMode">,
  messages: Messages,
): { label: string; tone: ActivityTone } {
  if (account.runtimeStatus !== "boosting") {
    return {
      label: statusLabel(account.runtimeStatus, messages),
      tone: statusTone(account.runtimeStatus),
    };
  }
  const copy = hubCopy(messages);
  if (account.activityMode === "farming") {
    return { label: copy.activityFarming, tone: "info" };
  }
  if (account.activityMode === "idle") {
    return { label: copy.activityOnline, tone: "good" };
  }
  return { label: copy.activityBoosting, tone: "good" };
}
