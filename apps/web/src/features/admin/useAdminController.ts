import { useCallback, useState } from "react";
import {
  api,
  apiErrorMessage,
  type AdminOverview,
  type AdminSession,
} from "../../api";
import type { Messages } from "../../i18n";

export function useAdminData(messages: Messages) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAdmin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextSessions] = await Promise.all([
        api<AdminOverview>("/api/admin/overview"),
        api<AdminSession[]>("/api/admin/sessions"),
      ]);
      setOverview({ ...nextOverview, sessions: nextSessions });
      setSessions(nextSessions);
    } catch (loadError) {
      setError(apiErrorMessage(loadError, messages));
    } finally {
      setLoading(false);
    }
  }, [messages]);

  return {
    overview,
    sessions,
    loading,
    error,
    setError,
    loadAdmin,
  };
}
