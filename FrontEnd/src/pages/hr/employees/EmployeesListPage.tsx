import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Modal,
  Segmented,
  Select,
  Tag,
  Dropdown,
  Typography,
  Tooltip,
  Popover,
  Form,
  Spin,
  message,
} from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType, SorterResult } from "antd/es/table/interface";
import {
  PlusOutlined,
  SearchOutlined,
  DownloadOutlined,
  EllipsisOutlined,
  SettingOutlined,
  TeamOutlined,
  IdcardOutlined,
  FileProtectOutlined,
  UndoOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { getCountryCode } from "../../../utils/countries";
import { useI18n } from "../../../i18n/useI18n";
import { useAuthStore } from "../../../auth/authStore";
import { isHeadOfficeOrganization } from "../../../utils/organizationContext";
import "./EmployeesListPage.css";

/**
 * Custom debounce hook
 */
function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<number | undefined>(undefined);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay],
  );
}

import LoadingState from "../../../components/ui/LoadingState";
import ResponsiveTable from "../../../components/ui/ResponsiveTable";
import ErrorState from "../../../components/ui/ErrorState";
import Unauthorized403Page from "../../Unauthorized403Page";

import { useHrEmployeeListStore } from "../../../stores/hrEmployeeListStore";
import type {
  Employee,
  EmployeeArchiveReason,
} from "../../../services/api/employeesApi";
import {
  exportEmployees,
  listEmployees,
  listEmployeeArchiveRequests,
  requestEmployeeArchive,
  restoreEmployee,
} from "../../../services/api/employeesApi";
import { listDepartments } from "../../../services/api/departmentsApi";
import { isApiError } from "../../../services/api/apiTypes";
import { triggerBlobDownload } from "../../../services/api/downloads";
import { isForbidden } from "../../../services/api/httpErrors";
import { getFirstApiErrorMessage } from "../../../utils/formErrors";
import {
  getUserPreference,
  saveUserPreference,
} from "../../../services/api/preferencesApi";

const { Option } = Select;
const { Text } = Typography;

type ExpiringKind = "iqama" | "contract";
const EXPIRING_DAY_OPTIONS = [30, 60, 90];
const DEFAULT_EXPIRING_DAYS = 30;
/** Column that shows the date each quick view is about. */
const EXPIRY_COLUMN_BY_KIND: Record<ExpiringKind, string> = {
  iqama: "id_expiry",
  contract: "contract_expiry",
};

const AVATAR_BG_COLORS = [
  "#f56a00",
  "#1677ff",
  "#389e0d",
  "#722ed1",
  "#d46b08",
  "#08979c",
];
const PREFERENCE_SCOPE = "tables";
const PREFERENCE_KEY = "hr-employees-list";
const DEFAULT_VISIBLE_COLUMNS = [
  "full_name",
  "nationality",
  "position",
  "department",
  "manager",
  "hire_date",
  "employment_status",
  "action",
];

/** Only these roles may list archived employees or restore them (mirrors the backend check). */
const ARCHIVE_MANAGER_ROLES: ReadonlyArray<string> = [
  "SystemAdmin",
  "HRManager",
];

const ARCHIVE_REASON_VALUES: EmployeeArchiveReason[] = [
  "FIRED",
  "RESIGNED",
  "RETIRED",
  "END_OF_CONTRACT",
  "DECEASED",
  "OTHER",
];

function getInitials(name?: string) {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
}

function getAvatarColor(name?: string) {
  const source = name || "";
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = source.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_BG_COLORS.length;
  return AVATAR_BG_COLORS[index];
}

function FlagBadge({ nationality }: { nationality?: string }) {
  const code = getCountryCode(nationality);

  if (!code) {
    return (
      <GlobalOutlined
        aria-hidden="true"
        style={{ width: 24, fontSize: 16, color: "#94a3b8" }}
      />
    );
  }

  return (
    <span
      className={`fi fi-${code.toLowerCase()}`}
      aria-label={`${code} flag`}
      title={code}
      style={{
        width: 24,
        height: 18,
        borderRadius: 3,
        display: "inline-flex",
        backgroundSize: "cover",
        backgroundPosition: "center",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
      }}
    />
  );
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "positive",
  ON_LEAVE: "warning",
  TERMINATED: "critical",
  SUSPENDED: "critical",
};

const STATUS_LABEL_KEY: Record<string, string> = {
  ACTIVE: "status.active",
  ON_LEAVE: "status.onLeave",
  TERMINATED: "status.terminated",
  SUSPENDED: "status.suspended",
};

const StatusBadge = ({
  status,
  t,
}: {
  status?: string;
  t: (k: string, f?: string) => string;
}) => (
  <span
    className={`employees-pill employees-pill--${STATUS_TONE[status || ""] || "neutral"}`}
  >
    {status && STATUS_LABEL_KEY[status]
      ? t(STATUS_LABEL_KEY[status])
      : status || t("status.unknown")}
  </span>
);

/** Expiry date with how far away (or overdue) it is. */
function ExpiryCell({
  date,
  t,
}: {
  date?: string | null;
  t: (k: string, p?: Record<string, unknown>) => string;
}) {
  if (!date) return <Text type="secondary">-</Text>;
  const days = dayjs(date).startOf("day").diff(dayjs().startOf("day"), "day");
  const tone = days < 0 ? "critical" : days <= 30 ? "warning" : "neutral";
  const label =
    days < 0
      ? t("employees.list.expiry.overdue", { days: Math.abs(days) })
      : days === 0
        ? t("employees.list.expiry.today")
        : t("employees.list.expiry.inDays", { days });
  return (
    <div className="employees-expiry">
      <span>{dayjs(date).format("MMM DD, YYYY")}</span>
      <span className={`employees-pill employees-pill--${tone}`}>{label}</span>
    </div>
  );
}

export default function EmployeesListPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const activeOrganizationId = useAuthStore(
    (state) =>
      state.user?.active_organization_id ??
      state.user?.default_organization_id ??
      null,
  );
  const isHeadOffice = isHeadOfficeOrganization(user);
  const previousOrganizationIdRef = useRef<string | number | null>(null);

  // State from Zustand store (persisted)
  const {
    search,
    filters,
    page,
    pageSize,
    setSearch,
    setFilters,
    setPage,
    setPageSize,
    hydrate,
  } = useHrEmployeeListStore();

  // Local state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(
    DEFAULT_VISIBLE_COLUMNS,
  );
  const [searchInput, setSearchInput] = useState("");

  // Filter options state
  const [departments, setDepartments] = useState<
    { code: string; name: string }[]
  >([]);
  const [nationalities, setNationalities] = useState<string[]>([]);
  const [expiringCounts, setExpiringCounts] = useState<
    Partial<Record<ExpiringKind, number>>
  >({});
  const [savingPreference, setSavingPreference] = useState(false);
  const preferenceLoadedRef = useRef(false);

  // Employee removal flow
  const [pendingDeletionIds, setPendingDeletionIds] = useState<Set<number>>(
    new Set(),
  );
  const [deletionTarget, setDeletionTarget] = useState<Employee | null>(null);
  const [deletionReason, setDeletionReason] = useState("");
  const [archiveReason, setArchiveReason] = useState<
    EmployeeArchiveReason | undefined
  >(undefined);
  const [archiveReasonError, setArchiveReasonError] = useState<string | null>(
    null,
  );
  const [deletionSubmitting, setDeletionSubmitting] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [deletionReasonError, setDeletionReasonError] = useState<string | null>(
    null,
  );

  // Employee restore flow
  const [restoreTarget, setRestoreTarget] = useState<Employee | null>(null);
  const [restoreSubmitting, setRestoreSubmitting] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const canManageArchive = ARCHIVE_MANAGER_ROLES.includes(user?.role ?? "");
  // Annotated so the literal type survives into the request params object.
  const archiveState: "active" | "archived" =
    canManageArchive && filters.archiveState === "archived"
      ? "archived"
      : "active";
  const viewingArchived = archiveState === "archived";
  // Expiry quick views only apply to active employees.
  const expiring: ExpiringKind | undefined = viewingArchived
    ? undefined
    : filters.expiring;
  const expiringDays = EXPIRING_DAY_OPTIONS.includes(
    filters.expiringDays ?? DEFAULT_EXPIRING_DAYS,
  )
    ? (filters.expiringDays ?? DEFAULT_EXPIRING_DAYS)
    : DEFAULT_EXPIRING_DAYS;

  /**
   * Fetch filter options
   */
  const loadFilterOptions = useCallback(async () => {
    try {
      const [deptRes, employeeRes] = await Promise.all([
        listDepartments(),
        listEmployees({ page: 1, page_size: 1000 }),
      ]);

      if (!isApiError(deptRes) && Array.isArray(deptRes.data)) {
        setDepartments(
          deptRes.data.map((d: any) => ({ code: d.code, name: d.name })),
        );
      }
      if (!isApiError(employeeRes)) {
        // One entry per nationality regardless of case ("pakistan" and
        // "Pakistan"); the backend matches case-insensitively. Prefer the
        // capitalised spelling for display.
        const byKey = new Map<string, string>();
        (employeeRes.data.results || [])
          .map(
            (employee) =>
              employee.nationality ||
              employee.nationality_en ||
              employee.nationality_ar,
          )
          .filter((value): value is string => Boolean(value?.trim()))
          .forEach((value) => {
            const name = value.trim();
            const key = name.toLocaleLowerCase();
            const current = byKey.get(key);
            if (
              !current ||
              (current[0] !== current[0].toLocaleUpperCase() &&
                name[0] === name[0].toLocaleUpperCase())
            ) {
              byKey.set(key, name);
            }
          });
        const uniqueNationalities = Array.from(byKey.values()).sort((a, b) =>
          a.localeCompare(b),
        );
        setNationalities(uniqueNationalities);
      }
    } catch (err) {
      console.error("Failed to load filter options:", err);
    }
  }, []);

  /**
   * Fetch employees list
   */
  const loadEmployees = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const params = {
        page,
        page_size: pageSize,
        search: search || undefined,
        department: filters.department || undefined,
        position: filters.position || undefined,
        status: filters.status || undefined,
        nationality: filters.nationality || undefined,
        join_date_order: filters.joinDateOrder || undefined,
        archive_state: archiveState,
        expiring,
        expiring_days: expiring ? expiringDays : undefined,
      };

      const response = await listEmployees(params);

      if (isApiError(response)) {
        if (
          (response.message || "").toLowerCase().includes("invalid page") &&
          page > 1
        ) {
          setPage(1);
          return;
        }
        setError(response.message || t("error.generic"));
        setLoading(false);
        return;
      }

      setEmployees(response.data.results || []);
      setTotal(response.data.count || 0);
      setLoading(false);
    } catch (err: any) {
      if (isForbidden(err)) {
        setForbidden(true);
        setLoading(false);
        return;
      }

      if (
        (err?.message || "").toLowerCase().includes("invalid page") &&
        page > 1
      ) {
        setPage(1);
        setLoading(false);
        return;
      }

      setError(err.message || t("error.generic"));
      setLoading(false);
    }
  }, [page, pageSize, search, filters, archiveState, expiring, expiringDays]);

  // Chip counts for the expiry quick views (active employees, current window).
  useEffect(() => {
    if (viewingArchived) return;
    let active = true;
    const kinds: ExpiringKind[] = ["iqama", "contract"];
    Promise.all(
      kinds.map((kind) =>
        listEmployees({
          page: 1,
          page_size: 1,
          archive_state: "active",
          expiring: kind,
          expiring_days: expiringDays,
        })
          .then((response) =>
            isApiError(response) ? undefined : response.data.count || 0,
          )
          .catch(() => undefined),
      ),
    ).then(([iqama, contract]) => {
      if (active) setExpiringCounts({ iqama, contract });
    });
    return () => {
      active = false;
    };
  }, [expiringDays, viewingArchived, activeOrganizationId]);

  useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

  const loadPendingDeletions = useCallback(async () => {
    try {
      const ids = new Set<number>();
      let nextPage = 1;
      let totalPages = 1;

      while (nextPage <= totalPages) {
        const response = await listEmployeeArchiveRequests({
          status: "PENDING_CEO",
          page: nextPage,
          page_size: 200,
        });
        if (isApiError(response)) return;

        const items = response.data.items || [];
        items.forEach((item) => {
          if (typeof item.employee_profile_id === "number") {
            ids.add(item.employee_profile_id);
          }
        });

        totalPages = Math.max(response.data.total_pages || 1, 1);
        nextPage += 1;
      }

      setPendingDeletionIds(ids);
    } catch {
      // Non-fatal: list still works without the pending overlay.
    }
  }, []);

  useEffect(() => {
    loadPendingDeletions();
  }, [loadPendingDeletions]);

  useEffect(() => {
    let active = true;

    async function loadPreference() {
      try {
        const response = await getUserPreference(
          PREFERENCE_SCOPE,
          PREFERENCE_KEY,
        );
        if (!active || isApiError(response)) {
          preferenceLoadedRef.current = true;
          return;
        }

        const value = response.data.value || {};
        const nextVisibleColumns = Array.isArray(value.visibleColumns)
          ? value.visibleColumns.filter(
              (item): item is string =>
                typeof item === "string" && item.length > 0,
            )
          : DEFAULT_VISIBLE_COLUMNS;

        hydrate({
          search: typeof value.search === "string" ? value.search : undefined,
          filters:
            typeof value.filters === "object" && value.filters
              ? (value.filters as any)
              : undefined,
          pageSize:
            typeof value.pageSize === "number" ? value.pageSize : undefined,
        });
        setVisibleColumnKeys(
          nextVisibleColumns.length > 0
            ? nextVisibleColumns
            : DEFAULT_VISIBLE_COLUMNS,
        );
      } catch {
        // Local state remains usable even if the preference request fails.
      } finally {
        if (active) {
          preferenceLoadedRef.current = true;
        }
      }
    }

    loadPreference();
    return () => {
      active = false;
    };
  }, [hydrate]);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    if (previousOrganizationIdRef.current === null) {
      previousOrganizationIdRef.current = activeOrganizationId;
      return;
    }

    if (previousOrganizationIdRef.current !== activeOrganizationId) {
      previousOrganizationIdRef.current = activeOrganizationId;
      setPage(1);
    }
  }, [activeOrganizationId, setPage]);

  const debouncedSearch = useDebounce((value: string) => {
    setSearch(value);
  }, 300);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const persistPreference = useCallback(
    async (payload: Record<string, unknown>) => {
      setSavingPreference(true);
      try {
        await saveUserPreference(PREFERENCE_SCOPE, PREFERENCE_KEY, payload);
      } catch {
        // Keep the page functional if preference sync fails.
      } finally {
        setSavingPreference(false);
      }
    },
    [],
  );

  const debouncedSavePreference = useDebounce(persistPreference, 500);

  useEffect(() => {
    if (!preferenceLoadedRef.current) return;
    debouncedSavePreference({
      search,
      filters,
      pageSize,
      visibleColumns: visibleColumnKeys,
    });
  }, [search, filters, pageSize, visibleColumnKeys, debouncedSavePreference]);

  const handleRowClick = (record: Employee) => {
    navigate(`/hr/employees/${record.id}`);
  };

  const openDeletionModal = (record: Employee) => {
    if (isHeadOffice) {
      message.warning(t("organization.headOffice.switchToRemoveEmployees"));
      return;
    }
    setDeletionTarget(record);
    setDeletionReason("");
    setArchiveReason(undefined);
    setDeletionError(null);
    setDeletionReasonError(null);
    setArchiveReasonError(null);
  };

  const closeDeletionModal = () => {
    if (deletionSubmitting) return;
    setDeletionTarget(null);
    setDeletionReason("");
    setArchiveReason(undefined);
    setDeletionError(null);
    setDeletionReasonError(null);
    setArchiveReasonError(null);
  };

  const submitDeletionRequest = async () => {
    if (!deletionTarget) return;
    const trimmed = deletionReason.trim();
    let invalid = false;
    if (!archiveReason) {
      setArchiveReasonError(t("employees.removal.archiveReasonRequired"));
      invalid = true;
    } else {
      setArchiveReasonError(null);
    }
    if (!trimmed) {
      setDeletionReasonError(t("employees.removal.reasonRequired"));
      invalid = true;
    } else {
      setDeletionReasonError(null);
    }
    if (invalid || !archiveReason) return;
    setDeletionError(null);
    setDeletionSubmitting(true);
    try {
      const response = await requestEmployeeArchive({
        employee_profile_id: deletionTarget.id,
        archive_reason: archiveReason,
        reason: trimmed,
      });
      if (isApiError(response)) {
        const friendly =
          response.message || t("employees.removal.errorGeneric");
        setDeletionError(friendly);
        setDeletionSubmitting(false);
        return;
      }
      setPendingDeletionIds((prev) => {
        const next = new Set(prev);
        next.add(deletionTarget.id);
        return next;
      });
      message.success(t("employees.removal.successSubmitted"));
      setDeletionTarget(null);
      setDeletionReason("");
      setArchiveReason(undefined);
      setDeletionSubmitting(false);
    } catch (err: any) {
      const httpStatus = err?.response?.status;
      if (httpStatus === 403 || isForbidden(err)) {
        setDeletionError(t("employees.removal.errorForbidden"));
      } else if (httpStatus === 422) {
        const apiMessage = getFirstApiErrorMessage(err);
        setDeletionError(
          apiMessage || t("employees.removal.errorAlreadyPending"),
        );
      } else if (httpStatus === 409) {
        setDeletionError(t("employees.removal.errorConflict"));
      } else {
        const apiMessage = getFirstApiErrorMessage(err);
        setDeletionError(apiMessage || t("employees.removal.errorGeneric"));
      }
      setDeletionSubmitting(false);
    }
  };

  const openRestoreModal = (record: Employee) => {
    setRestoreTarget(record);
    setRestoreError(null);
  };

  const closeRestoreModal = () => {
    if (restoreSubmitting) return;
    setRestoreTarget(null);
    setRestoreError(null);
  };

  const submitRestore = async () => {
    if (!restoreTarget) return;
    setRestoreError(null);
    setRestoreSubmitting(true);
    try {
      const response = await restoreEmployee(restoreTarget.id);
      if (isApiError(response)) {
        setRestoreError(
          response.message || t("employees.restore.errorGeneric"),
        );
        setRestoreSubmitting(false);
        return;
      }
      message.success(t("employees.restore.success"));
      setRestoreTarget(null);
      setRestoreSubmitting(false);
      // The employee moved between the active and archived views, so refetch.
      loadEmployees();
    } catch (err: any) {
      const httpStatus = err?.response?.status;
      if (httpStatus === 403 || isForbidden(err)) {
        setRestoreError(t("employees.restore.errorForbidden"));
      } else if (httpStatus === 422) {
        const apiMessage = getFirstApiErrorMessage(err);
        setRestoreError(apiMessage || t("employees.restore.errorNotArchived"));
      } else {
        const apiMessage = getFirstApiErrorMessage(err);
        setRestoreError(apiMessage || t("employees.restore.errorGeneric"));
      }
      setRestoreSubmitting(false);
    }
  };

  const getActionItems = (record: Employee): MenuProps["items"] => {
    const isPending = pendingDeletionIds.has(record.id);
    const removalDisabled = isPending || isHeadOffice;

    if (record.is_archived) {
      const archivedItems: MenuProps["items"] = [
        {
          key: "view",
          label: t("employees.list.actionView"),
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            navigate(`/hr/employees/${record.id}`);
          },
        },
      ];
      if (canManageArchive) {
        archivedItems.push({
          key: "restore",
          label: t("employees.restore.action"),
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            openRestoreModal(record);
          },
        });
      }
      return archivedItems;
    }

    return [
      {
        key: "view",
        label: t("employees.list.actionView"),
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation();
          navigate(`/hr/employees/${record.id}`);
        },
      },
      {
        key: "edit",
        label: t("employees.list.actionEdit"),
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation();
          navigate(`/hr/employees/${record.id}/edit`);
        },
      },
      {
        key: "request-removal",
        label: removalDisabled ? (
          <span
            title={
              isHeadOffice
                ? t("organization.headOffice.switchToRemoveEmployees")
                : undefined
            }
          >
            {isPending
              ? t("employees.removal.actionPending")
              : t("employees.removal.action")}
          </span>
        ) : isPending ? (
          t("employees.removal.actionPending")
        ) : (
          t("employees.removal.action")
        ),
        disabled: removalDisabled,
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation();
          if (removalDisabled) return;
          openDeletionModal(record);
        },
      },
    ];
  };

  const hasFilters = Boolean(
    search ||
    filters.department ||
    filters.status ||
    filters.nationality ||
    filters.joinDateOrder ||
    expiring,
  );

  const resetFilters = () => {
    setSearchInput("");
    setSearch("");
    setFilters({
      department: undefined,
      status: undefined,
      nationality: undefined,
      joinDateOrder: undefined,
      expiring: undefined,
    });
  };

  const selectQuickView = (kind?: ExpiringKind) =>
    setFilters({ expiring: filters.expiring === kind ? undefined : kind });

  const quickViews: Array<{
    key: string;
    kind?: ExpiringKind;
    label: string;
    icon: ReactNode;
    tone: string;
    count?: number;
  }> = [
    {
      key: "all",
      label: t("employees.list.quick.all"),
      icon: <TeamOutlined />,
      tone: "neutral",
    },
    {
      key: "iqama",
      kind: "iqama",
      label: t("employees.list.quick.iqama"),
      icon: <IdcardOutlined />,
      tone: "warning",
      count: expiringCounts.iqama,
    },
    {
      key: "contract",
      kind: "contract",
      label: t("employees.list.quick.contract"),
      icon: <FileProtectOutlined />,
      tone: "critical",
      count: expiringCounts.contract,
    },
  ];

  const allColumns: ColumnsType<Employee> = [
    {
      title: t("employees.list.colName"),
      key: "full_name",
      width: 250,
      render: (_, record) => (
        <div className="employees-person">
          <span
            className="employees-avatar"
            style={{ backgroundColor: getAvatarColor(record.full_name) }}
            aria-hidden="true"
          >
            {getInitials(record.full_name)}
          </span>
          <div className="employees-person__text">
            <div className="employees-person__name">
              <Text strong>{record.full_name}</Text>
              {record.is_archived && (
                <Tag color="default" className="employees-tag">
                  {t("employees.archive.archivedTag")}
                </Tag>
              )}
              {!record.is_archived && pendingDeletionIds.has(record.id) && (
                <Tag color="warning" className="employees-tag">
                  {t("employees.removal.pendingTag")}
                </Tag>
              )}
            </div>
            {record.email && (
              <Text type="secondary" className="employees-person__email">
                {record.email}
              </Text>
            )}
          </div>
        </div>
      ),
    },
    {
      title: t("employees.list.colNationality"),
      key: "nationality",
      width: 150,
      render: (_, record) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FlagBadge nationality={record.nationality} />
          <Text>{record.nationality || "-"}</Text>
        </div>
      ),
    },
    {
      title: t("common.company", "Company"),
      dataIndex: "company_name",
      key: "company",
      width: 170,
      render: (text) => <Text strong>{text || "-"}</Text>,
    },
    {
      title: t("employees.list.colPosition"),
      dataIndex: "position",
      key: "position",
      width: 180,
      render: (text) => <Text strong>{text || "-"}</Text>,
    },
    {
      title: t("employees.list.colDepartment"),
      dataIndex: "department",
      key: "department",
      width: 160,
      render: (text) => <Text>{text || "-"}</Text>,
    },
    {
      title: t("employees.list.colManager"),
      key: "manager",
      width: 220,
      render: (_, record) => (
        <Text>{record.manager_profile_name || record.manager_name || "-"}</Text>
      ),
    },
    {
      title: t("employees.list.colJoiningDate"),
      key: "hire_date",
      width: 140,
      sorter: true,
      sortOrder:
        filters.joinDateOrder === "asc"
          ? "ascend"
          : filters.joinDateOrder === "desc"
            ? "descend"
            : null,
      render: (_, record) => {
        const joiningDate = record.hire_date;
        return joiningDate ? dayjs(joiningDate).format("MMM DD, YYYY") : "-";
      },
    },
    {
      title: t("employees.list.colIqamaExpiry"),
      key: "id_expiry",
      width: 170,
      render: (_, record) => (
        <ExpiryCell date={record.is_saudi ? null : record.id_expiry} t={t} />
      ),
    },
    {
      title: t("employees.list.colContractExpiry"),
      key: "contract_expiry",
      width: 170,
      render: (_, record) => <ExpiryCell date={record.contract_expiry} t={t} />,
    },
    {
      title: t("employees.list.colStatus"),
      dataIndex: "employment_status",
      key: "employment_status",
      width: 120,
      render: (status) => <StatusBadge status={status} t={t} />,
    },
    {
      title: t("employees.archive.colArchiveReason"),
      key: "archive_reason",
      width: 160,
      render: (_, record) => (
        <Text>
          {record.archive_reason
            ? t(`employees.removal.archiveReason.${record.archive_reason}`)
            : "-"}
        </Text>
      ),
    },
    {
      title: t("employees.archive.colArchivedBy"),
      key: "archived_by_name",
      width: 180,
      render: (_, record) => (
        <Text>{record.archived_by_name?.trim() || "-"}</Text>
      ),
    },
    {
      title: t("employees.list.colAction"),
      key: "action",
      width: 80,
      align: "center",
      render: (_, record) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Dropdown
            menu={{ items: getActionItems(record) }}
            trigger={["click"]}
          >
            <Button
              type="text"
              aria-label={t("employees.list.colAction")}
              className="employees-row-action"
              icon={<EllipsisOutlined />}
            />
          </Dropdown>
        </div>
      ),
    },
  ];

  const columns = useMemo(() => {
    let keys = visibleColumnKeys;
    if (isHeadOffice && !keys.includes("company")) {
      keys = ["company", ...keys];
    }
    // Archive metadata only carries meaning in the archived view, so surface it there.
    const archiveColumns = ["archive_reason", "archived_by_name"];
    if (viewingArchived) {
      keys = [...keys, ...archiveColumns.filter((key) => !keys.includes(key))];
    } else {
      keys = keys.filter((key) => !archiveColumns.includes(key));
    }
    // A quick view always shows the date it filters on (defined next to the
    // status column, so column order needs no extra handling).
    if (expiring && !keys.includes(EXPIRY_COLUMN_BY_KIND[expiring])) {
      keys = [...keys, EXPIRY_COLUMN_BY_KIND[expiring]];
    }
    return allColumns.filter((column) => keys.includes(String(column.key)));
  }, [allColumns, visibleColumnKeys, isHeadOffice, viewingArchived, expiring]);

  const columnOptions = [
    { label: t("employees.list.colName"), value: "full_name" },
    { label: t("common.company", "Company"), value: "company" },
    { label: t("employees.list.colNationality"), value: "nationality" },
    { label: t("employees.list.colPosition"), value: "position" },
    { label: t("employees.list.colDepartment"), value: "department" },
    { label: t("employees.list.colManager"), value: "manager" },
    { label: t("employees.list.colJoiningDate"), value: "hire_date" },
    { label: t("employees.list.colIqamaExpiry"), value: "id_expiry" },
    { label: t("employees.list.colContractExpiry"), value: "contract_expiry" },
    { label: t("employees.list.colStatus"), value: "employment_status" },
    ...(viewingArchived
      ? [
          {
            label: t("employees.archive.colArchiveReason"),
            value: "archive_reason",
          },
          {
            label: t("employees.archive.colArchivedBy"),
            value: "archived_by_name",
          },
        ]
      : []),
    { label: t("employees.list.colAction"), value: "action" },
  ];

  async function handleExport() {
    try {
      const blob = await exportEmployees({
        search: search || undefined,
        department: filters.department || undefined,
        position: filters.position || undefined,
        status: filters.status || undefined,
        nationality: filters.nationality || undefined,
        join_date_order: filters.joinDateOrder || undefined,
        archive_state: archiveState,
        expiring,
        expiring_days: expiring ? expiringDays : undefined,
      });
      triggerBlobDownload(
        blob,
        `employees_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      message.success(t("common.success"));
    } catch (err: any) {
      if (isForbidden(err)) {
        setForbidden(true);
        return;
      }
      message.error(t("common.error"));
    }
  }

  const columnsPopoverContent = (
    <div
      style={{ width: 240, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <Text strong>{t("common.columns", "Columns")}</Text>
      <Checkbox.Group
        options={columnOptions}
        value={visibleColumnKeys}
        onChange={(values) => {
          const selected = values.map(String);
          if (selected.length > 0) {
            setVisibleColumnKeys(selected);
          }
        }}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        {savingPreference
          ? t("common.saving", "Saving...")
          : t("common.savedAutomatically")}
      </Text>
    </div>
  );

  if (forbidden) return <Unauthorized403Page />;

  return (
    <div className="employees-page">
      <header className="employees-header">
        <div>
          <h1 className="employees-header__title">
            {t("employees.list.title")}
          </h1>
          <Text type="secondary">{t("employees.list.subtitle")}</Text>
        </div>
        <Button
          type="primary"
          size="large"
          icon={<PlusOutlined />}
          onClick={() => navigate("/hr/employees/create")}
          disabled={isHeadOffice}
          title={
            isHeadOffice
              ? t("organization.headOffice.switchToCreateEmployees")
              : undefined
          }
          className="employees-header__create"
        >
          {t("employees.list.createEmployee")}
        </Button>
      </header>

      <div className="employees-views">
        {!viewingArchived && (
          <div
            className="employees-quick"
            role="group"
            aria-label={t("employees.list.quick.label")}
          >
            {quickViews.map((view) => (
              <button
                key={view.key}
                type="button"
                className={`employees-chip employees-chip--${view.tone}`}
                aria-pressed={view.kind ? expiring === view.kind : !expiring}
                onClick={() => selectQuickView(view.kind)}
              >
                <span className="employees-chip__icon" aria-hidden="true">
                  {view.icon}
                </span>
                {view.label}
                {view.count !== undefined && (
                  <span className="employees-chip__count">{view.count}</span>
                )}
              </button>
            ))}
            <Select
              aria-label={t("employees.list.expiringWithin", {
                days: expiringDays,
              })}
              value={expiringDays}
              onChange={(value) => setFilters({ expiringDays: value })}
              options={EXPIRING_DAY_OPTIONS.map((days) => ({
                value: days,
                label: t("employees.list.expiringWithin", { days }),
              }))}
              className="employees-quick__window"
              popupMatchSelectWidth={false}
            />
            {expiring && (
              <Text type="secondary" className="employees-quick__hint">
                {t("employees.list.expiringHint")}
              </Text>
            )}
          </div>
        )}

        {canManageArchive && (
          <Segmented
            aria-label={t("employees.archive.stateFilterLabel")}
            value={archiveState}
            onChange={(value) =>
              setFilters({ archiveState: value as "active" | "archived" })
            }
            options={[
              {
                label: t("employees.archive.stateActive"),
                value: "active",
              },
              {
                label: t("employees.archive.stateArchived"),
                value: "archived",
              },
            ]}
            className="employees-views__archive"
          />
        )}
      </div>

      <section className="employees-workspace">
        <div className="employees-toolbar">
          <Input
            allowClear
            placeholder={t("employees.list.searchPlaceholder")}
            prefix={<SearchOutlined className="employees-muted-icon" />}
            value={searchInput}
            onChange={(e) => {
              const value = e.target.value;
              setSearchInput(value);
              debouncedSearch(value);
            }}
            className="employees-toolbar__search"
          />

          <Select
            placeholder={t("employees.list.departmentPlaceholder")}
            aria-label={t("employees.list.departmentPlaceholder")}
            value={filters.department || undefined}
            onChange={(value) => setFilters({ department: value })}
            allowClear
            showSearch
            optionFilterProp="children"
            className="employees-toolbar__select"
          >
            {departments.map((dept) => (
              <Option key={dept.code} value={dept.code}>
                {dept.name}
              </Option>
            ))}
          </Select>

          <Select
            placeholder={t("employees.list.statusPlaceholder")}
            aria-label={t("employees.list.statusPlaceholder")}
            value={filters.status || undefined}
            onChange={(value) => setFilters({ status: value })}
            allowClear
            className="employees-toolbar__select"
          >
            <Option value="ACTIVE">{t("status.active")}</Option>
            <Option value="ON_LEAVE">{t("status.onLeave")}</Option>
            <Option value="SUSPENDED">{t("status.suspended")}</Option>
            <Option value="TERMINATED">{t("status.terminated")}</Option>
          </Select>

          <Select
            placeholder={t(
              "employees.list.nationalityPlaceholder",
              "Nationality",
            )}
            aria-label={t(
              "employees.list.nationalityPlaceholder",
              "Nationality",
            )}
            value={filters.nationality || undefined}
            onChange={(value) => setFilters({ nationality: value })}
            allowClear
            showSearch
            optionFilterProp="label"
            options={nationalities.map((nationality) => ({
              value: nationality,
              label: nationality,
            }))}
            optionRender={(option) => (
              <span className="employees-nationality">
                <FlagBadge nationality={String(option.value)} />
                {option.label}
              </span>
            )}
            labelRender={(option) => (
              <span className="employees-nationality">
                <FlagBadge nationality={String(option.value)} />
                {option.label}
              </span>
            )}
            className="employees-toolbar__select"
          />

          <Button
            type="text"
            icon={<UndoOutlined aria-hidden="true" />}
            onClick={resetFilters}
            disabled={!hasFilters}
            className="employees-toolbar__reset"
          >
            {t("common.reset")}
          </Button>

          <div className="employees-toolbar__tools">
            <Popover
              content={columnsPopoverContent}
              trigger="click"
              placement="bottomRight"
            >
              <Tooltip title={t("common.columns", "Columns")}>
                <Button
                  icon={<SettingOutlined />}
                  aria-label={t("common.columns", "Columns")}
                />
              </Tooltip>
            </Popover>
            <Tooltip title={t("common.export")}>
              <Button
                icon={<DownloadOutlined />}
                aria-label={t("common.export")}
                onClick={handleExport}
              />
            </Tooltip>
          </div>
        </div>

        <div className="employees-results__heading">
          <span>
            {viewingArchived
              ? t("employees.archive.stateArchived")
              : expiring
                ? quickViews.find((view) => view.kind === expiring)?.label
                : t("employees.list.quick.all")}
          </span>
          <span className="employees-results__count">
            {loading && employees.length > 0 && <Spin size="small" />}
            {t("employees.list.count", { count: total })}
          </span>
        </div>

        {loading && employees.length === 0 ? (
          <div className="employees-results__state">
            <LoadingState />
          </div>
        ) : error ? (
          <div className="employees-results__state">
            <ErrorState
              title={t("common.error")}
              description={error}
              onRetry={loadEmployees}
            />
          </div>
        ) : (
          <div className="employees-table">
            <ResponsiveTable
              mobileCard={{
                titleKey: "full_name",
                extraKey: "employment_status",
                actionsKey: "action",
              }}
              dataSource={employees}
              columns={columns}
              rowKey="id"
              loading={loading && employees.length > 0}
              pagination={{
                current: page,
                pageSize: pageSize,
                total: total,
                onChange: (newPage, newPageSize) => {
                  if (newPageSize !== pageSize) {
                    setPageSize(newPageSize);
                  } else {
                    setPage(newPage);
                  }
                },
                showTotal: (total, range) =>
                  `${t("common.showing")} ${range[0]} ${t("common.to")} ${range[1]} ${t("common.of")} ${total} ${t("common.entries")}`,
              }}
              onChange={(_pagination, _filters, sorter, extra) => {
                if (extra?.action !== "sort") return;
                const { columnKey, order } = sorter as SorterResult<Employee>;
                if (columnKey !== "hire_date") return;
                setFilters({
                  joinDateOrder:
                    order === "ascend"
                      ? "asc"
                      : order === "descend"
                        ? "desc"
                        : undefined,
                });
              }}
              onRow={(record) => ({
                onClick: () => handleRowClick(record),
                style: { cursor: "pointer" },
              })}
              scroll={{ x: "max-content" }}
            />
          </div>
        )}
      </section>

      <Modal
        open={deletionTarget !== null}
        title={t("employees.removal.modalTitle")}
        okText={t("employees.removal.confirmButton")}
        okButtonProps={{ loading: deletionSubmitting }}
        cancelText={t("common.cancel")}
        cancelButtonProps={{ disabled: deletionSubmitting }}
        onOk={submitDeletionRequest}
        onCancel={closeDeletionModal}
        closable={!deletionSubmitting}
        maskClosable={!deletionSubmitting}
        destroyOnClose
        width="min(520px, 96vw)"
        style={{ top: 16 }}
      >
        {deletionTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Text>
              {t("employees.removal.modalIntro", {
                name: deletionTarget.full_name || deletionTarget.email,
              })}
            </Text>
            <Alert
              type="info"
              showIcon
              message={t("employees.removal.preservationTitle")}
              description={t("employees.removal.modalNote")}
            />
            <Form layout="vertical">
              <Form.Item
                label={t("employees.removal.archiveReasonLabel")}
                required
                validateStatus={archiveReasonError ? "error" : undefined}
                help={archiveReasonError || undefined}
              >
                <Select
                  aria-label={t("employees.removal.archiveReasonLabel")}
                  placeholder={t("employees.removal.archiveReasonPlaceholder")}
                  value={archiveReason}
                  onChange={(value) => {
                    setArchiveReason(value as EmployeeArchiveReason);
                    if (archiveReasonError) setArchiveReasonError(null);
                  }}
                  disabled={deletionSubmitting}
                  options={ARCHIVE_REASON_VALUES.map((value) => ({
                    value,
                    label: t(`employees.removal.archiveReason.${value}`),
                  }))}
                />
              </Form.Item>
              <Form.Item
                label={t("employees.removal.reasonLabel")}
                required
                validateStatus={deletionReasonError ? "error" : undefined}
                help={deletionReasonError || undefined}
              >
                <Input.TextArea
                  rows={4}
                  value={deletionReason}
                  placeholder={t("employees.removal.reasonPlaceholder")}
                  onChange={(e) => {
                    setDeletionReason(e.target.value);
                    if (deletionReasonError) setDeletionReasonError(null);
                  }}
                  maxLength={500}
                  disabled={deletionSubmitting}
                  showCount
                />
              </Form.Item>
            </Form>
            {deletionError && (
              <div
                role="alert"
                style={{
                  background: "rgba(255, 77, 79, 0.08)",
                  border: "1px solid rgba(255, 77, 79, 0.24)",
                  color: "#cf1322",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                {deletionError}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={restoreTarget !== null}
        title={t("employees.restore.modalTitle")}
        okText={t("employees.restore.confirmButton")}
        okButtonProps={{ loading: restoreSubmitting }}
        cancelText={t("common.cancel")}
        cancelButtonProps={{ disabled: restoreSubmitting }}
        onOk={submitRestore}
        onCancel={closeRestoreModal}
        closable={!restoreSubmitting}
        maskClosable={!restoreSubmitting}
        destroyOnClose
        width="min(480px, 96vw)"
        style={{ top: 16 }}
      >
        {restoreTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Text>
              {t("employees.restore.modalIntro", {
                name: restoreTarget.full_name || restoreTarget.email,
              })}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("employees.restore.modalNote")}
            </Text>
            {restoreTarget.archive_reason && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("employees.archive.colArchiveReason")}:{" "}
                {t(
                  `employees.removal.archiveReason.${restoreTarget.archive_reason}`,
                )}
              </Text>
            )}
            {restoreTarget.archived_by_name?.trim() && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("employees.archive.archivedBy")}:{" "}
                {restoreTarget.archived_by_name}
              </Text>
            )}
            {restoreError && (
              <div
                role="alert"
                style={{
                  background: "rgba(255, 77, 79, 0.08)",
                  border: "1px solid rgba(255, 77, 79, 0.24)",
                  color: "#cf1322",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                {restoreError}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
