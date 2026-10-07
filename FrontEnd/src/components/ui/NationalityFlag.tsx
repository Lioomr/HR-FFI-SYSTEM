import { GlobalOutlined } from "@ant-design/icons";
import { getCountryCode } from "../../utils/countries";

/**
 * Flag for a nationality. Windows browsers draw flag emoji as plain letters
 * ("IN"), so use the same flag-icons images as the employee list instead.
 */
export default function NationalityFlag({
  nationality,
}: {
  nationality?: string | null;
}) {
  const code = getCountryCode(nationality ?? undefined);
  if (!code) return <GlobalOutlined aria-hidden="true" />;
  return (
    <span
      className={`fi fi-${code.toLowerCase()}`}
      aria-label={`${code} flag`}
      title={code}
      style={{
        width: 20,
        height: 15,
        borderRadius: 2,
        display: "inline-flex",
        verticalAlign: "middle",
        backgroundSize: "cover",
        backgroundPosition: "center",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
      }}
    />
  );
}
