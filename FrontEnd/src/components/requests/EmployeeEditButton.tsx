import { Button, Tooltip } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n/useI18n";
import type { WorkflowSnapshot } from "../../types/workflow";

/**
 * Edit entry point. The server's `workflow.can_edit` is the only thing that
 * shows it; the status is never used to guess editability.
 */
export default function EmployeeEditButton({
  request,
  to,
  onEdit,
  iconOnly = true,
}: {
  request: { workflow?: WorkflowSnapshot };
  /** Route to navigate to; ignored when `onEdit` is given (e.g. a modal). */
  to?: string;
  onEdit?: () => void;
  iconOnly?: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  if (request.workflow?.can_edit !== true) return null;
  return (
    <Tooltip title={iconOnly ? t("requests.edit.button") : undefined}>
      <Button
        size={iconOnly ? "small" : "middle"}
        icon={<EditOutlined aria-hidden />}
        aria-label={t("requests.edit.button")}
        onClick={(event) => {
          event.stopPropagation();
          if (onEdit) onEdit();
          else if (to) navigate(to);
        }}
      >
        {iconOnly ? null : t("requests.edit.button")}
      </Button>
    </Tooltip>
  );
}
