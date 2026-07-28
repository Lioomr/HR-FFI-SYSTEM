/**
 * Deliberately narrow projections of the wide server serializers. Compensation and
 * identity-document numbers are not mapped into the mobile profile type at all, so they
 * cannot reach a screen, a snapshot, or a log through this feature.
 */
export interface EmployeeProfileSummary {
  id: number | string | null;
  fullName: string | null;
  employeeNumber: string | null;
  email: string | null;
  mobile: string | null;
  department: string | null;
  position: string | null;
  managerName: string | null;
  hireDate: string | null;
  contractExpiry: string | null;
  employmentStatus: string | null;
  companyName: string | null;
  nationality: string | null;
}

export interface PayslipSummary {
  id: number | string | null;
  year: number | null;
  month: number | null;
  netSalary: number | null;
  paymentMode: string | null;
  status: string | null;
}

export interface PayslipDetail extends PayslipSummary {
  basicSalary: number | null;
  transportationAllowance: number | null;
  accommodationAllowance: number | null;
  telephoneAllowance: number | null;
  petrolAllowance: number | null;
  otherAllowance: number | null;
  totalSalary: number | null;
  totalDeductions: number | null;
}

export interface EmployeeDocumentSummary {
  id: number | string | null;
  documentType: string | null;
  displayName: string | null;
  originalFilename: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}
