import { useState } from "react";
import type { ReactNode } from "react";
import { Alert, Button, Empty, Flex, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { FilePdfOutlined } from "@ant-design/icons";
import ResponsiveTable from "../ui/ResponsiveTable";
import { useI18n } from "../../i18n/useI18n";
import { downloadAttendanceNotice } from "../../services/api/attendanceApi";
import type {
  AttendanceLateNotice,
  NoticeDeliveryStatus,
  NoticeLevel,
} from "../../types/attendancePolicy";
import { formatDateOnly } from "../../utils/dateTime";
import {
  NOTICE_DELIVERY_COLORS,
  NOTICE_LEVEL_COLORS,
  hasNoticeDocument,
  noticeDeliveryHint,
  noticeDeliveryLabel,
  noticeDownloadErrorKey,
  noticeLevelLabel,
  noticeLevelMeaning,
  type NoticeListProblem,
} from "../../utils/attendancePolicy";

const { Text } = Typography;

/**
 * Severity tag, occurrence, and the level's policy result. Level 1 reads as a
 * warning only with no payroll deduction.
 */
export function NoticeLevelTag({
  notice,
}: {
  notice: Pick<AttendanceLateNotice, "notice_level" | "occurrence_number">;
}) {
  const { t } = useI18n();
  const policy = noticeLevelMeaning(t, notice.notice_level);
  return (
    <Flex vertical gap={2} style={{ maxWidth: 260 }}>
      <Tag
        color={NOTICE_LEVEL_COLORS[notice.notice_level as NoticeLevel] ?? "red"}
        style={{ marginInlineEnd: 0, width: "fit-content" }}
      >
        {noticeLevelLabel(t, notice.notice_level)}
      </Tag>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t("attendancePolicy.notices.occurrence", {
          number: notice.occurrence_number,
        })}
      </Text>
      {policy ? <Text style={{ fontSize: 12 }}>{policy}</Text> : null}
    </Flex>
  );
}

/**
 * Delivery wording in the UI language, derived from `delivery_status` alone.
 * The server's `delivery_message` is English-only, so it is not shown.
 */
function NoticeDelivery({
  notice,
}: {
  notice: Pick<AttendanceLateNotice, "delivery_status">;
}) {
  const { t } = useI18n();
  const hint = noticeDeliveryHint(t, notice.delivery_status);
  return (
    <Flex vertical gap={2} style={{ maxWidth: 260 }}>
      <Tag
        color={
          NOTICE_DELIVERY_COLORS[
            notice.delivery_status as NoticeDeliveryStatus
          ] ?? "default"
        }
        style={{ marginInlineEnd: 0, width: "fit-content" }}
      >
        {noticeDeliveryLabel(t, notice.delivery_status)}
      </Tag>
      {hint ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {hint}
        </Text>
      ) : null}
    </Flex>
  );
}

function NoticeDownloadButton({
  notice,
  onError,
}: {
  notice: AttendanceLateNotice;
  onError: (text: string) => void;
}) {
  const { t } = useI18n();
  const [downloading, setDownloading] = useState(false);
  return (
    <Button
      size="small"
      icon={<FilePdfOutlined />}
      loading={downloading}
      aria-label={t("attendancePolicy.notices.downloadAria", {
        reference: notice.reference_number,
      })}
      onClick={async (event) => {
        event.stopPropagation();
        setDownloading(true);
        try {
          await downloadAttendanceNotice(notice);
        } catch (error) {
          onError(t(noticeDownloadErrorKey(error)));
        } finally {
          setDownloading(false);
        }
      }}
    >
      {t("attendancePolicy.notices.download")}
    </Button>
  );
}

/** The 403, 404 and failure states shared by the employee and HR lists. */
export function NoticeProblemView({ problem }: { problem: NoticeListProblem }) {
  const { t } = useI18n();
  switch (problem.kind) {
    case "forbidden":
      return (
        <Alert
          type="warning"
          showIcon
          title={t("attendancePolicy.notices.forbidden")}
          description={t("attendancePolicy.companyRequiredHint")}
        />
      );
    case "notFound":
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("attendancePolicy.notices.notFound")}
        />
      );
    case "error":
      return (
        <Alert
          type="error"
          showIcon
          title={t("attendancePolicy.notices.loadFailed")}
          description={problem.message}
        />
      );
  }
}

type Props = {
  items: AttendanceLateNotice[];
  loading: boolean;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number, pageSize: number) => void;
  /** HR view: adds the employee column and heads each phone card by employee. */
  showEmployee?: boolean;
  emptyText?: ReactNode;
};

export default function AttendanceNoticesTable({
  items,
  loading,
  page,
  pageSize,
  total,
  onPageChange,
  showEmployee = false,
  emptyText,
}: Props) {
  const { t } = useI18n();
  const [messageApi, contextHolder] = message.useMessage();

  const columns: ColumnsType<AttendanceLateNotice> = [
    {
      title: t("attendancePolicy.notices.violationDate"),
      dataIndex: "violation_date",
      key: "violation_date",
      width: 130,
      render: (value: string) => formatDateOnly(value),
    },
    ...(showEmployee
      ? [
          {
            title: t("common.employee"),
            key: "employee",
            render: (_: unknown, record: AttendanceLateNotice) => (
              <Flex vertical gap={0}>
                <Text strong>
                  <bdi>{record.employee_name}</bdi>
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <bdi>{record.employee_code}</bdi>
                </Text>
              </Flex>
            ),
          },
        ]
      : []),
    {
      title: t("attendancePolicy.notices.level"),
      key: "level",
      render: (_: unknown, record: AttendanceLateNotice) => (
        <NoticeLevelTag notice={record} />
      ),
    },
    {
      title: t("attendancePolicy.notices.reference"),
      key: "reference",
      render: (_: unknown, record: AttendanceLateNotice) => (
        <bdi style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>
          {record.reference_number}
        </bdi>
      ),
    },
    {
      title: t("attendancePolicy.notices.delivery"),
      key: "delivery",
      render: (_: unknown, record: AttendanceLateNotice) => (
        <NoticeDelivery notice={record} />
      ),
    },
    {
      title: t("common.actions"),
      key: "actions",
      // Without a stored document the private download would only 404.
      render: (_: unknown, record: AttendanceLateNotice) =>
        hasNoticeDocument(record) ? (
          <NoticeDownloadButton
            notice={record}
            onError={(text) => void messageApi.error(text)}
          />
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("attendancePolicy.notices.pdfUnavailable")}
          </Text>
        ),
    },
  ];

  return (
    <>
      {contextHolder}
      <ResponsiveTable<AttendanceLateNotice>
        mobileCard={{
          titleKey: showEmployee ? "employee" : "violation_date",
          actionsKey: "actions",
        }}
        rowKey="id"
        dataSource={items}
        columns={columns}
        loading={loading}
        size="small"
        scroll={{ x: "max-content" }}
        locale={emptyText ? { emptyText } : undefined}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: onPageChange,
        }}
      />
    </>
  );
}
