import { ArrowLeftOutlined, ArrowRightOutlined } from "@ant-design/icons";
import { Button, type ButtonProps } from "antd";
import { useI18n } from "../../i18n/useI18n";

export default function BackButton(
  props: Omit<ButtonProps, "icon" | "iconPlacement" | "iconPosition">,
) {
  const { language } = useI18n();
  return (
    <Button
      {...props}
      iconPlacement="end"
      icon={
        language === "ar" ? (
          <ArrowLeftOutlined aria-hidden />
        ) : (
          <ArrowRightOutlined aria-hidden />
        )
      }
    />
  );
}
