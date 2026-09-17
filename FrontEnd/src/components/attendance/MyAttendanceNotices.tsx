import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, Card, Empty, Flex, Skeleton, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import AttendanceNoticesTable, {
  NoticeProblemView,
} from "./AttendanceNoticesTable";
import { useI18n } from "../../i18n/useI18n";
import { getAttendanceNotices } from "../../services/api/attendanceApi";
import { isApiError } from "../../services/api/apiTypes";
import type { AttendanceLateNotice } from "../../types/attendancePolicy";
import {
  noticeListProblem,
  type NoticeListProblem,
} from "../../utils/attendancePolicy";

const PAGE_SIZE = 10;

/**
 * The signed-in employee's late-attendance notices. The server limits the list
 * to the caller in the active company. Notices are issued and delivered
 * automatically, so this section only lists them and downloads the PDF.
 */
export default function MyAttendanceNotices() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AttendanceLateNotice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<NoticeListProblem | null>(null);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    const isCurrent = () => request === latestRequest.current;
    setLoading(true);
    try {
      const response = await getAttendanceNotices({
        mine: true,
        page,
        page_size: PAGE_SIZE,
      });
      if (!isCurrent()) return;
      if (isApiError(response)) {
        setItems([]);
        setTotal(0);
        setProblem({ kind: "error", message: response.message });
      } else {
        setItems(response.data.items ?? []);
        setTotal(response.data.count ?? 0);
        setProblem(null);
      }
    } catch (error) {
      if (!isCurrent()) return;
      setItems([]);
      setTotal(0);
      setProblem(noticeListProblem(error));
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const title = t("attendancePolicy.notices.title");
  let body: ReactNode;
  if (!loaded) {
    body = <Skeleton active paragraph={{ rows: 2 }} />;
  } else if (problem) {
    body = <NoticeProblemView problem={problem} />;
  } else {
    body = (
      <AttendanceNoticesTable
        items={items}
        loading={loading}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={(nextPage) => setPage(nextPage)}
        emptyText={
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("attendancePolicy.notices.empty")}
          />
        }
      />
    );
  }

  return (
    <Card
      title={title}
      extra={
        <Button
          type="text"
          icon={<ReloadOutlined />}
          aria-label={`${t("common.refresh")}: ${title}`}
          loading={loading}
          onClick={() => void load()}
        />
      }
      style={{ marginTop: 16, borderRadius: 12 }}
    >
      <Flex vertical gap={12}>
        <Typography.Text type="secondary">
          {t("attendancePolicy.notices.hint")}
        </Typography.Text>
        {body}
      </Flex>
    </Card>
  );
}
