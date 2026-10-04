import { Tag } from "antd";
import { useI18n } from "../../../i18n/useI18n";

const colors: Record<string, string> = {
  work_time: "geekblue",
  work_organization: "cyan",
  worker_conduct: "magenta",
};

export default function PenaltyCategoryTag({ category }: { category: string }) {
  const { t } = useI18n();
  return (
    <Tag color={colors[category]} bordered={false}>
      {t(`penalties.category.${category}`, undefined, category)}
    </Tag>
  );
}
