import { Button, Card, Typography } from "antd";
import {
  ApartmentOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { useI18n } from "../../i18n/useI18n";
import type { OrganizationNodeDto } from "../../services/api/apiTypes";

const { Title, Paragraph } = Typography;

type Props = {
  organizations: OrganizationNodeDto[];
  switching?: boolean;
  onSelect: (organizationId: string | number) => void;
};

/**
 * Shown in place of a company-owned page while Main Head Office is selected.
 * The backend keeps each company's records to that company, so the page
 * cannot load until the user picks one; a 403 screen would wrongly read as
 * "you are not allowed".
 */
export default function HeadOfficeCompanyPicker({
  organizations,
  switching = false,
  onSelect,
}: Props) {
  const { t, direction } = useI18n();
  const Arrow = direction === "rtl" ? LeftOutlined : RightOutlined;
  const companies = organizations.filter(
    (organization) =>
      organization.node_type === "company" && organization.is_active !== false,
  );

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "32px 0",
      }}
    >
      <Card
        style={{ width: "100%", maxWidth: 520, borderRadius: 18 }}
        styles={{ body: { padding: 28 } }}
      >
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div
            aria-hidden
            style={{
              width: 52,
              height: 52,
              margin: "0 auto 14px",
              borderRadius: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              background: "rgba(99, 102, 241, 0.12)",
              color: "#6366f1",
            }}
          >
            <ApartmentOutlined />
          </div>
          <Title level={4} style={{ marginBottom: 6 }}>
            {t("organization.headOffice.pickCompanyTitle")}
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {companies.length > 0
              ? t("organization.headOffice.pickCompanyDescription")
              : t("organization.headOffice.noCompanyAccess")}
          </Paragraph>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {companies.map((company) => (
            <Button
              key={company.id}
              size="large"
              block
              disabled={switching}
              onClick={() => onSelect(company.id)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                height: 48,
                borderRadius: 12,
              }}
            >
              <span style={{ fontWeight: 600 }}>{company.name}</span>
              <Arrow style={{ fontSize: 12 }} />
            </Button>
          ))}
        </div>
      </Card>
    </div>
  );
}
