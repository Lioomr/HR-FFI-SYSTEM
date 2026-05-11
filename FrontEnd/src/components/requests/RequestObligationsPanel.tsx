import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  List,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from "antd";

import { useI18n } from "../../i18n/useI18n";
import { requestAssetReturn } from "../../services/api/assetsApi";
import {
  listDelegationCandidates,
  type DelegationCandidate,
} from "../../services/api/employeesApi";
import { isApiError } from "../../services/api/apiTypes";
import {
  setLeaveRequestDelegate,
  type LeaveRequest,
} from "../../services/api/leaveApi";
import {
  getRequestObligations,
  type RequestObligation,
  type RequestObligationSummary,
} from "../../services/api/requestObligationsApi";

type Props = {
  parentType: "leave_request";
  parentId: number | string;
  leaveRequest?: LeaveRequest | null;
  showEmployeeActions?: boolean;
  onChanged?: () => void;
};

const statusColor: Record<string, string> = {
  open: "volcano",
  resolved: "green",
  waived: "gold",
};

export default function RequestObligationsPanel({
  parentType,
  parentId,
  leaveRequest,
  showEmployeeActions = false,
  onChanged,
}: Props) {
  const { t } = useI18n();
  const [apiMessage, contextHolder] = message.useMessage();
  const [items, setItems] = useState<RequestObligation[]>([]);
  const [summary, setSummary] = useState<RequestObligationSummary | null>(
    leaveRequest?.obligations_summary || null,
  );
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<DelegationCandidate[]>([]);
  const [delegateId, setDelegateId] = useState<number | undefined>();
  const [delegationNote, setDelegationNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getRequestObligations({
        parent_type: parentType,
        parent_id: parentId,
      });
      if (isApiError(response)) {
        await apiMessage.error(
          response.message ||
            t("obligations.loadFailed", "Unable to load obligations."),
        );
        return;
      }
      setItems(response.data.items || []);
      setSummary(response.data.summary);
    } finally {
      setLoading(false);
    }
  }, [apiMessage, parentId, parentType, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!showEmployeeActions) return;
    listDelegationCandidates({ scope: "all" })
      .then((response) => {
        if (!isApiError(response)) setCandidates(response.data || []);
      })
      .catch(() => undefined);
  }, [showEmployeeActions]);

  const candidateOptions = useMemo(
    () =>
      candidates.map((candidate) => ({
        value:
          candidate.id ?? `employee-profile-${candidate.employee_profile_id}`,
        label: `${candidate.full_name_en || candidate.full_name || candidate.employee_id} (${candidate.employee_id})${candidate.company_name ? ` - ${candidate.company_name}` : ""}${candidate.disabled_reason ? ` - ${candidate.disabled_reason}` : ""}`,
        disabled: !candidate.can_delegate,
      })),
    [candidates],
  );

  const handleAssetReturn = async (item: RequestObligation) => {
    const assetId = Number(item.metadata?.asset_id || item.target?.id);
    if (!assetId) return;
    setActionId(item.id);
    try {
      const response = await requestAssetReturn(assetId, {
        note: t(
          "obligations.assetReturnNote",
          "Required for Business Trip approval.",
        ),
      });
      if (isApiError(response)) {
        await apiMessage.error(
          response.message || t("obligations.actionFailed", "Action failed."),
        );
        return;
      }
      await apiMessage.success(
        t("obligations.returnRequested", "Asset return request submitted."),
      );
      await load();
      onChanged?.();
    } finally {
      setActionId(null);
    }
  };

  const handleSetDelegate = async () => {
    if (!leaveRequest || !delegateId) {
      await apiMessage.error(
        t("obligations.chooseDelegate", "Choose a delegate."),
      );
      return;
    }
    setActionId(-1);
    try {
      const response = await setLeaveRequestDelegate(leaveRequest.id, {
        delegated_to: delegateId,
        delegation_note: delegationNote,
      });
      if (isApiError(response)) {
        await apiMessage.error(
          response.message || t("obligations.actionFailed", "Action failed."),
        );
        return;
      }
      await apiMessage.success(
        t("obligations.delegateSaved", "Delegation saved."),
      );
      await load();
      onChanged?.();
    } finally {
      setActionId(null);
    }
  };

  const openCount = summary?.blocking_open || 0;

  return (
    <Card
      title={t("obligations.title", "Request Obligations")}
      loading={loading}
      style={{ borderRadius: 16, border: "1px solid #e5e7eb" }}
    >
      {contextHolder}
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert
          type={openCount > 0 ? "warning" : "success"}
          showIcon
          message={
            openCount > 0
              ? t(
                  "obligations.blockingSummary",
                  { count: openCount },
                  "{count} blocking item(s) must be resolved or waived.",
                )
              : t("obligations.clearSummary", "No blocking obligations remain.")
          }
        />

        <List
          dataSource={items}
          locale={{
            emptyText: t(
              "obligations.empty",
              "No obligations for this request.",
            ),
          }}
          renderItem={(item) => (
            <List.Item
              actions={[
                showEmployeeActions &&
                item.status === "open" &&
                item.type === "asset_return" ? (
                  <Button
                    key="return"
                    size="small"
                    loading={actionId === item.id}
                    onClick={() => handleAssetReturn(item)}
                  >
                    {t("obligations.requestReturn", "Request return")}
                  </Button>
                ) : null,
              ].filter(Boolean)}
            >
              <List.Item.Meta
                title={
                  <Space wrap>
                    <Typography.Text strong>{item.title}</Typography.Text>
                    <Tag color={statusColor[item.status] || "default"}>
                      {item.status_display || item.status}
                    </Tag>
                    {item.severity === "blocking" ? (
                      <Tag color="red">
                        {t("obligations.blocking", "Blocking")}
                      </Tag>
                    ) : null}
                  </Space>
                }
                description={
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary">
                      {item.description || "-"}
                    </Typography.Text>
                    {item.waiver_reason ? (
                      <Typography.Text type="secondary">
                        {t("obligations.waiverReason", "Waiver reason")}:{" "}
                        {item.waiver_reason}
                      </Typography.Text>
                    ) : null}
                  </Space>
                }
              />
            </List.Item>
          )}
        />

        {showEmployeeActions &&
        items.some(
          (item) => item.status === "open" && item.type === "pending_approvals",
        ) ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Text strong>
              {t("obligations.delegateApprovals", "Delegate pending approvals")}
            </Typography.Text>
            <Select
              showSearch
              allowClear
              optionFilterProp="label"
              options={candidateOptions}
              value={delegateId}
              onChange={(value) =>
                setDelegateId(typeof value === "number" ? value : undefined)
              }
              placeholder={t("leave.delegatedTo")}
              style={{ width: "100%" }}
            />
            <Input.TextArea
              rows={2}
              value={delegationNote}
              onChange={(event) => setDelegationNote(event.target.value)}
              placeholder={t("leave.delegationNote")}
            />
            <Button
              type="primary"
              loading={actionId === -1}
              onClick={handleSetDelegate}
            >
              {t("obligations.saveDelegate", "Save delegate")}
            </Button>
          </Space>
        ) : null}
      </Space>
    </Card>
  );
}
