import { ConfigProvider, theme } from "antd";
import type { ReactNode } from "react";
import arEG from "antd/locale/ar_EG";
import enUS from "antd/locale/en_US";
import { useI18n } from "../i18n/useI18n";
import I18nBootstrap from "../i18n/I18nBootstrap";

/** Orange & Silver brand theme */
const modernTheme = {
  token: {
    colorPrimary: "#f97316",
    colorInfo: "#94a3b8",
    colorSuccess: "#10b981",
    colorWarning: "#f59e0b",
    colorError: "#ef4444",
    colorBgBase: "#ffffff",
    colorBgLayout: "#f8f9fb",
    colorBgContainer: "#ffffff",
    colorTextBase: "#0f172a",
    borderRadius: 10,
    borderRadiusLG: 14,
    borderRadiusSM: 6,
    fontFamily: "'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    fontSize: 14,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
    boxShadowSecondary: "0 4px 16px rgba(0,0,0,0.08)",
  },
  components: {
    Layout: {
      siderBg: "#1a1a1a",
    },
    Card: {
      borderRadiusLG: 16,
    },
    Button: {
      borderRadius: 10,
      controlHeight: 40,
      fontWeight: 600,
    },
    Input: {
      borderRadius: 10,
      controlHeight: 40,
      activeShadow: "0 0 0 3px rgba(249,115,22,0.15)",
    },
    Select: {
      borderRadius: 10,
      controlHeight: 40,
    },
    Table: {
      headerBg: "#f1f5f9",
      headerColor: "#64748b",
      rowHoverBg: "#fff7ed",
    },
    Tag: {
      borderRadiusSM: 20,
    },
    Tabs: {
      inkBarColor: "#f97316",
      itemActiveColor: "#f97316",
      itemSelectedColor: "#f97316",
    },
    Menu: {
      darkItemSelectedBg: "rgba(249,115,22,0.18)",
      darkItemSelectedColor: "#fb923c",
    },
  },
  algorithm: theme.defaultAlgorithm,
};

export default function Providers({ children }: { children: ReactNode }) {
  const { language, direction } = useI18n();

  return (
    <ConfigProvider
      direction={direction}
      locale={language === "ar" ? arEG : enUS}
      theme={modernTheme}
    >
      <I18nBootstrap />
      {children}
    </ConfigProvider>
  );
}
