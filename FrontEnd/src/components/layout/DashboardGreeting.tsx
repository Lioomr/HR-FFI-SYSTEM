import { useEffect, useState } from "react";
import { useAuthStore } from "../../auth/authStore";
import { useI18n } from "../../i18n/useI18n";
import { getMe } from "../../services/api/usersApi";
import { isApiError } from "../../services/api/apiTypes";
import { getActiveOrganization } from "../../utils/organizationContext";

type Names = { en: string | null; ar: string | null };

/**
 * "Welcome, {name} 👋" plus today's summary line, shown in the header on the
 * HR dashboard. The name follows the app language: the Arabic view uses the
 * Arabic name when the employee profile has one, the English view the
 * English name, each falling back to the other.
 */
export default function DashboardGreeting({
  isMobile = false,
}: {
  isMobile?: boolean;
}) {
  const { t, language } = useI18n();
  const user = useAuthStore((state) => state.user);
  const organization = getActiveOrganization(user);
  const [names, setNames] = useState<Names | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((response) => {
        if (cancelled || isApiError(response)) return;
        setNames({
          en: response.data.full_name_en || response.data.full_name || null,
          ar: response.data.full_name_ar || null,
        });
      })
      .catch(() => {
        // The greeting still reads naturally with the fallback name.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fallback = user?.email?.split("@")[0] ?? "";
  const name =
    (language === "ar" ? (names?.ar ?? names?.en) : (names?.en ?? names?.ar)) ||
    fallback;

  return (
    <div style={{ minWidth: 0, lineHeight: 1.25 }}>
      <h1
        style={{
          margin: 0,
          fontSize: isMobile ? 15 : 19,
          fontWeight: 700,
          color: "#0f172a",
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {t("hr.dashboard.welcome", { name })}{" "}
        <span role="img" aria-hidden>
          👋
        </span>
      </h1>
      {!isMobile && (
        <p
          style={{
            margin: "2px 0 0",
            fontSize: 13,
            color: "#64748b",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {organization?.name
            ? t("hr.dashboard.todaySummary", {
                organization: organization.name,
              })
            : t("hr.dashboard.todaySummaryNoOrg")}
        </p>
      )}
    </div>
  );
}
