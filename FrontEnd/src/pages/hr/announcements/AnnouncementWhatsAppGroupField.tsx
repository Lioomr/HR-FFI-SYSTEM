import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Select } from "antd";
import { useAuthStore } from "../../../auth/authStore";
import { useI18n } from "../../../i18n/useI18n";
import {
  getAnnouncementWhatsAppGroups,
  type AnnouncementWhatsAppGroup,
} from "../../../services/api/announcementApi";

export default function AnnouncementWhatsAppGroupField({
  editing = false,
}: {
  editing?: boolean;
}) {
  const { t } = useI18n();
  const form = Form.useFormInstance();
  const enabled = Form.useWatch("publish_to_whatsapp", {
    form,
    preserve: true,
  });
  const selected = Form.useWatch("whatsapp_group_id", { form, preserve: true });
  const company = useAuthStore((state) => state.user?.active_organization_id);
  const previousCompany = useRef(company);
  const [groups, setGroups] = useState<AnnouncementWhatsAppGroup[]>([]);
  const [state, setState] = useState("loading");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (previousCompany.current !== company) {
      form.setFieldValue("whatsapp_group_id", "");
      previousCompany.current = company;
    }
    if (!enabled) return;
    let cancelled = false;
    setGroups([]);
    setState("loading");
    getAnnouncementWhatsAppGroups()
      .then((result) => {
        if (!cancelled) {
          setGroups(result.groups);
          setState(result.state);
        }
      })
      .catch(() => {
        if (!cancelled) setState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [company, enabled, form, refresh]);
  if (!enabled) return null;
  const unavailableSelection =
    selected && !groups.some((group) => group.id === selected);
  const options = groups.map((group) => ({
    value: group.id,
    label: group.name,
  }));
  if (unavailableSelection)
    options.push({
      value: selected,
      label: t("hr.announcements.groupUnavailableSelection"),
    });
  return (
    <div style={{ marginBottom: 24 }}>
      <Alert
        type="info"
        showIcon
        title={t("hr.announcements.groupSemantics")}
        style={{ marginBottom: 12 }}
      />
      {state !== "loading" &&
        (state !== "connected" || groups.length === 0) && (
          <Alert
            type="warning"
            showIcon
            title={t("hr.announcements.groupUnavailable")}
            style={{ marginBottom: 12 }}
          />
        )}
      <Form.Item
        name="whatsapp_group_id"
        label={t("hr.announcements.groupLabel")}
        extra={
          editing
            ? t("hr.announcements.groupEditHelp")
            : t("hr.announcements.groupCreateHelp")
        }
      >
        <Select
          allowClear
          loading={state === "loading"}
          placeholder={t("hr.announcements.groupNone")}
          options={options}
          onClear={() => form.setFieldValue("whatsapp_group_id", "")}
        />
      </Form.Item>
      <Button
        onClick={() => setRefresh((value) => value + 1)}
        loading={state === "loading"}
      >
        {t("hr.announcements.groupRefresh")}
      </Button>
    </div>
  );
}
