import { ConfigProvider, theme } from "antd";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import "./payroll.css";

/** Local overrides inherit the app theme; no global palette or theme mode. */
export default function PayrollTheme({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    const strip = node?.querySelector<HTMLElement>(".payroll-status-strip");
    if (!node || !strip) return;
    const measure = () => {
      const height = strip.getBoundingClientRect().height;
      if (height)
        node.style.setProperty("--payroll-strip-height", `${height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);
  const style = {
    "--payroll-surface": token.colorBgContainer,
    "--payroll-muted": token.colorTextSecondary,
    "--payroll-border": token.colorBorderSecondary,
    "--payroll-hover": token.colorFillQuaternary,
    "--payroll-focus": token.colorText,
    "--payroll-accent": token.orange8,
    "--payroll-accent-active": token.orange9,
    "--payroll-on-accent": token.colorBgContainer,
    "--payroll-error-text": token.colorErrorTextActive,
    "--payroll-error": token.colorErrorText,
    "--payroll-warning": token.colorWarningText,
    "--payroll-success": token.colorSuccessText,
    "--payroll-radius": `${token.borderRadiusSM}px`,
  } as CSSProperties;
  return (
    <ConfigProvider
      theme={{
        token: {
          colorLink: token.orange8,
          colorLinkHover: token.orange9,
          colorLinkActive: token.orange9,
        },
        components: {
          Table: {
            headerBg: token.colorFillQuaternary,
            headerColor: token.colorTextSecondary,
            rowHoverBg: token.colorFillQuaternary,
            cellPaddingBlockSM: 8,
            cellPaddingInlineSM: 8,
          },
          Card: { borderRadiusLG: token.borderRadiusSM },
        },
      }}
    >
      <div ref={root} className="payroll-workspace" style={style}>
        {children}
      </div>
    </ConfigProvider>
  );
}
