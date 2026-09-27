// DTO applicatifs (pas les types générés Supabase complets — à générer plus
// tard via `supabase gen types typescript`). Ces types reflètent le schéma
// de docs/ARCHITECTURE.md et supabase/migrations/*.

export type SchoolRole = "director" | "accountant" | "admin_staff" | "parent";

export interface School {
  id: string;
  name: string;
  slug: string;
  currency: string;
  status: "trial" | "active" | "suspended" | "archived";
}

export interface SchoolMembership {
  schoolId: string;
  school: School;
  role: SchoolRole;
  permissions: Record<string, boolean>;
}

export interface Student {
  id: string;
  schoolId: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  status: "active" | "transferred" | "graduated" | "withdrawn";
}

export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "cancelled";

export interface Invoice {
  id: string;
  schoolId: string;
  studentId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  totalAmount: number;
  paidAmount: number;
  currency: string;
}

export type PaymentStatus = "pending" | "confirmed" | "rejected" | "cancelled";

export interface Payment {
  id: string;
  schoolId: string;
  studentId: string;
  paymentNumber: string;
  amount: number;
  currency: string;
  paymentMethod: "cash" | "mobile_money" | "bank_transfer" | "cheque" | "other";
  reference: string | null;
  paymentDate: string;
  status: PaymentStatus;
}

export interface Receipt {
  id: string;
  paymentId: string;
  receiptNumber: string;
  issuedAt: string;
}

export interface FeeInstallment {
  id: string;
  feeScheduleId: string;
  label: string;
  sequence: number;
  amount: number;
  dueDate: string;
}
