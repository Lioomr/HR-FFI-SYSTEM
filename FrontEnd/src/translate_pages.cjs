const fs = require('fs');

function replaceInFile(filePath, replacements) {
    let content = fs.readFileSync(filePath, 'utf8');
    for (const [search, replace] of replacements) {
        content = content.replace(search, replace);
    }
    fs.writeFileSync(filePath, content);
    console.log('Processed', filePath);
}

replaceInFile('d:/HR-FFI-SYSTEM/FrontEnd/src/pages/hr/leave/LeaveRequestDetailsPage.tsx', [
    [/message: "Send Failed"/g, 'message: t("leave.sendFail")'],
    [/message: "Request sent to CEO"/g, 'message: t("leave.sendSuccess")'],
    [/message: "Error", description: "System error while sending to CEO"/g, 'message: t("common.error"), description: t("leave.sendError")'],
    [/message: "Document Error", description: "Unable to open document."/g, 'message: t("leave.docErrorTitle"), description: t("leave.docErrorDesc")'],
    [/message: "Reason Required", description: "Please provide a reason for rejection."/g, 'message: t("leave.reasonReqTitle"), description: t("leave.reasonReqDesc")']
]);

replaceInFile('d:/HR-FFI-SYSTEM/FrontEnd/src/pages/hr/payroll/CreatePayrollRunPage.tsx', [
    [/import \{ isApiError \} from "\.\.\/\.\.\/\.\.\/services\/api\/apiTypes";/g, 'import { isApiError } from "../../../services/api/apiTypes";\nimport { useI18n } from "../../../i18n/useI18n";'],
    [/const \[form\] = Form\.useForm\(\);/g, 'const [form] = Form.useForm();\n    const { t } = useI18n();'],
    [/message: 'Processing Payroll'/g, 'message: t("payroll.processingTitle")'],
    [/description: 'Calculating salaries and generating payslips for all active employees\.\.\.'/g, 'description: t("payroll.processingDesc")'],
    [/message: "Payroll Run Exists",\s*description: `A run for \$\{values\.month\}\/\$\{values\.year\} already exists\. Opening it\.\.\.`,/g, 'message: t("payroll.runExists"),\n                                    description: t("payroll.runExistsDesc", { month: values.month, year: values.year }),'],
    [/message: "Already Exists",\s*description: "A payroll run for this period already exists\.",/g, 'message: t("payroll.alreadyExists"),\n                        description: t("payroll.alreadyExistsDesc"),'],
    [/message: "Creation Failed",\s*description: response\.message \|\| "Could not create payroll run\.",/g, 'message: t("payroll.creationFail"),\n                    description: response.message || t("payroll.creationFailDesc"),'],
    [/message: "Success",\s*description: "Payroll run created successfully",/g, 'message: t("common.success"),\n                description: t("payroll.creationSuccess"),'],
    [/message: "Payroll Run Exists",\s*description: `Opening existing run for \$\{values\.month\}\/\$\{values\.year\}\.\.\.`,/g, 'message: t("payroll.runExists"),\n                                description: t("payroll.runExistsDesc2", { month: values.month, year: values.year }),'],
    [/message: "Already Exists",\s*description: "A payroll run for this period already exists, but could not be automatically located\.",/g, 'message: t("payroll.alreadyExists"),\n                    description: t("payroll.alreadyExistsDesc2"),'],
    [/message: "Error",\s*description: err\.message \|\| "An unexpected error occurred",/g, 'message: t("common.error"),\n                    description: err.message || t("payroll.unexpectedError"),'],
    [/title="Create Payroll Run"\s*subtitle="Select the period for the new payroll run"/g, 'title={t("payroll.createTitle")}\n                subtitle={t("payroll.createDesc")}'],
    [/label="Year"\s*rules=\{\[\{ required: true, message: "Please select a year" \}\]\}/g, 'label={t("payroll.year")}\n                        rules={[{ required: true, message: t("payroll.yearReq") }]}'],
    [/label="Month"\s*rules=\{\[\{ required: true, message: "Please select a month" \}\]\}/g, 'label={t("payroll.month")}\n                        rules={[{ required: true, message: t("payroll.monthReq") }]}'],
    [/Cancel<\/Button>/g, '{t("common.cancel")}</Button>'],
    [/Create Payroll Run\r?\n\s*<\/Button>/g, '{t("payroll.createTitle")}\n                        </Button>']
]);

replaceInFile('d:/HR-FFI-SYSTEM/FrontEnd/src/pages/manager/CreateTeamAnnouncementPage.tsx', [
    [/import \{ useAuthStore \} from "\.\.\/\.\.\/auth\/authStore";/g, 'import { useAuthStore } from "../../auth/authStore";\nimport { useI18n } from "../../i18n/useI18n";'],
    [/const \[form\] = Form\.useForm\(\);/g, 'const [form] = Form.useForm();\n  const { t } = useI18n();'],
    [/message\.error\("Failed to load team members"\);/g, 'message.error(t("announcements.loadTeamFail"));'],
    [/message\.success\("Announcement sent to team successfully"\);/g, 'message.success(t("announcements.sendSuccess"));'],
    [/message\.error\(e\?\.response\?\.data\?\.message \|\| "Failed to create announcement"\);/g, 'message.error(e?.response?.data?.message || t("announcements.createFail"));'],
    [/\{role === "CEO" \? "CEO Team Announcement" : "Team Announcement"\}/g, '{role === "CEO" ? t("announcements.ceoTitle") : t("announcements.teamTitle")}'],
    [/Cancel<\/Button>/g, '{t("common.cancel")}</Button>'],
    [/label="Title" rules=\{\[\{ required: true, message: "Please enter a title" \}\]\}/g, 'label={t("hr.announcements.titleLabel")} rules={[{ required: true, message: t("hr.announcements.titleRequired") }]}'],
    [/placeholder="Enter announcement title"/g, 'placeholder={t("hr.announcements.titlePlaceholder")}'],
    [/label="Content" rules=\{\[\{ required: true, message: "Please enter content" \}\]\}/g, 'label={t("hr.announcements.contentLabel")} rules={[{ required: true, message: t("hr.announcements.contentRequired") }]}'],
    [/placeholder="Enter announcement content"/g, 'placeholder={t("hr.announcements.contentPlaceholder")}'],
    [/label="Audience"/g, 'label={t("announcements.audience")}'],
    [/>All My Team<\/Radio\.Button>/g, '>{t("announcements.allTeam")}</Radio.Button>'],
    [/>Single Team Member<\/Radio\.Button>/g, '>{t("announcements.singleMember")}</Radio.Button>'],
    [/label="Team Member"/g, 'label={t("announcements.teamMember")}'],
    [/message: "Please select a team member"/g, 'message: t("announcements.memberReq")'],
    [/placeholder="Select team member"/g, 'placeholder={t("announcements.memberPlaceholder")}'],
    [/> Email Notification/g, '> {t("announcements.emailNotif")}'],
    [/> SMS\/WhatsApp Notification/g, '> {t("announcements.smsNotif")}'],
    [/Send to Team\r?\n\s*<\/Button>/g, '{t("announcements.sendToTeam")}\n            </Button>']
]);

replaceInFile('d:/HR-FFI-SYSTEM/FrontEnd/src/pages/manager/ManagerLeaveRequestDetailsPage.tsx', [
    [/import \{ isApiError \} from "\.\.\/\.\.\/services\/api\/apiTypes";/g, 'import { isApiError } from "../../services/api/apiTypes";\nimport { useI18n } from "../../i18n/useI18n";'],
    [/const navigate = useNavigate\(\);/g, 'const navigate = useNavigate();\n    const { t } = useI18n();'],
    [/setError\(e\.message \|\| "Failed to load request details"\);/g, 'setError(e.message || t("leave.loadFail"));'],
    [/title: "Approve Leave Request",\s*content: `Approve leave for \$\{request\.employee\?\.full_name \|\| request\.employee\?\.email\}\?`,/g, 'title: t("leave.approveTitle"),\n            content: t("leave.approveConfirmDesc", { name: request.employee?.full_name || request.employee?.email || "" }),'],
    [/okText: "Approve",\s*cancelText: "Cancel",/g, 'okText: t("common.approve"),\n            cancelText: t("common.cancel"),'],
    [/notification\.error\(\{ message: "Approval Failed", description: res\.message \}\);/g, 'notification.error({ message: t("leave.approveFail"), description: res.message });'],
    [/notification\.success\(\{ message: "Request Approved" \}\);/g, 'notification.success({ message: t("leave.approveSuccess") });'],
    [/notification\.error\(\{ message: "Error", description: "System error during approval" \}\);/g, 'notification.error({ message: t("common.error"), description: t("leave.approveError") });'],
    [/notification\.error\(\{ message: "Reason Required", description: "Please provide a reason for rejection\." \}\);/g, 'notification.error({ message: t("leave.reasonReqTitle"), description: t("leave.reasonReqDesc") });'],
    [/notification\.error\(\{ message: "Rejection Failed", description: res\.message \}\);/g, 'notification.error({ message: t("leave.rejectFail"), description: res.message });'],
    [/notification\.success\(\{ message: "Request Rejected" \}\);/g, 'notification.success({ message: t("leave.rejectSuccess") });'],
    [/notification\.error\(\{ message: "Error", description: "System error during rejection" \}\);/g, 'notification.error({ message: t("common.error"), description: t("leave.rejectError") });'],
    [/notification\.error\(\{ message: "Document Error", description: "Unable to open document\." \}\);/g, 'notification.error({ message: t("leave.docErrorTitle"), description: t("leave.docErrorDesc") });'],
    [/<LoadingState title="Loading request details\.\.\." \/>/g, '<LoadingState title={t("leave.loadingDetails")} />'],
    [/<ErrorState title="Error" description=\{error\} onRetry=\{loadData\} \/>/g, '<ErrorState title={t("common.error")} description={error} onRetry={loadData} />'],
    [/<ErrorState title="Not Found" description="Leave request not found\." \/>/g, '<ErrorState title={t("leave.notFound")} description={t("leave.notFoundDesc")} />'],
    [/Back to Team Requests\r?\n\s*<\/Button>/g, '{t("leave.backToTeamReqs")}\n            </Button>'],
    [/title=\{\`Leave Request #\$\{request\.id\}\`\}/g, 'title={t("leave.requestDetailsTitle", { id: request.id })}'],
    [/title="Details"/g, 'title={t("common.details")}'],
    [/label="Employee"/g, 'label={t("common.employee")}'],
    [/label="Leave Type"/g, 'label={t("leave.type")}'],
    [/label="Period"/g, 'label={t("leave.period")}'],
    [/\{request\.start_date\} to \{request\.end_date\}/g, '{request.start_date} {t("common.to")} {request.end_date}'],
    [/label="Reason"/g, 'label={t("common.reason")}'],
    [/label="Document"/g, 'label={t("common.document")}'],
    [/>Preview\r?\n\s*<\/Button>/g, '>{t("common.preview")}\n                                </Button>'],
    [/>Download\r?\n\s*<\/Button>/g, '>{t("common.download")}\n                                </Button>'],
    [/>Reject\r?\n\s*<\/Button>/g, '>{t("common.reject")}\n                        </Button>'],
    [/>Approve\r?\n\s*<\/Button>/g, '>{t("common.approve")}\n                        </Button>'],
    [/title="Reject Leave Request"/g, 'title={t("leave.rejectTitle")}'],
    [/okText="Reject Request"/g, 'okText={t("leave.rejectBtn")}'],
    [/message="This action is irreversible\. Please provide a reason to the employee\."/g, 'message={t("leave.rejectWarning")}'],
    [/placeholder="Reason for rejection\.\.\."/g, 'placeholder={t("leave.rejectPlaceholder")}']
]);
