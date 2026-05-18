import { useEffect, useState } from "react";
import { Input, Modal } from "antd";
import { useI18n } from "../../i18n/useI18n";

const { TextArea } = Input;

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: (notes: string) => Promise<void> | void;
  loading?: boolean;
  title?: string;
};

export default function AttendanceCorrectionRejectModal({
  open,
  onCancel,
  onConfirm,
  loading,
  title,
}: Props) {
  const { t } = useI18n();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNotes("");
      setError(null);
    }
  }, [open]);

  const handleOk = async () => {
    const trimmed = notes.trim();
    if (!trimmed) {
      setError(t("attendanceCorrections.errors.rejectNoteRequired", "Rejection note is required"));
      return;
    }
    await onConfirm(trimmed);
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      title={title || t("attendanceCorrections.actions.rejectTitle", "Reject correction request")}
      okText={t("common.reject", "Reject")}
      okButtonProps={{ danger: true }}
      cancelText={t("common.cancel", "Cancel")}
      destroyOnClose
    >
      <p style={{ marginTop: 0, color: "#475569" }}>
        {t("attendanceCorrections.actions.rejectPrompt", "Provide a reason for the rejection. The employee will see this note.")}
      </p>
      <TextArea
        rows={4}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          if (error && e.target.value.trim()) setError(null);
        }}
        placeholder={t("attendanceCorrections.actions.rejectPlaceholder", "e.g. The requested time does not match our records.")}
        maxLength={1000}
        showCount
      />
      {error ? (
        <div style={{ color: "#dc2626", marginTop: 6, fontSize: 12 }}>{error}</div>
      ) : null}
    </Modal>
  );
}
