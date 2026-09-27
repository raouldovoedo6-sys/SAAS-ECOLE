import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./app/AuthContext";
import { RequireAuth } from "./app/RequireAuth";
import { RequireRole } from "./app/RequireRole";
import { RequireSuperAdmin } from "./app/RequireSuperAdmin";
import { Layout } from "./components/Layout";
import { LoginPage } from "./features/auth/LoginPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { StudentsListPage } from "./features/students/StudentsListPage";
import { StudentFormPage } from "./features/students/StudentFormPage";
import { StudentDetailPage } from "./features/students/StudentDetailPage";
import { ClassesPage } from "./features/classes/ClassesPage";
import { GuardiansListPage } from "./features/guardians/GuardiansListPage";
import { GuardianFormPage } from "./features/guardians/GuardianFormPage";
import { FeeCategoriesPage } from "./features/fees/FeeCategoriesPage";
import { FeeSchedulesPage } from "./features/fees/FeeSchedulesPage";
import { FeeScheduleFormPage } from "./features/fees/FeeScheduleFormPage";
import { InvoicesListPage } from "./features/invoices/InvoicesListPage";
import { CreateInvoicePage } from "./features/invoices/CreateInvoicePage";
import { InvoiceDetailPage } from "./features/invoices/InvoiceDetailPage";
import { UnpaidListPage } from "./features/unpaid/UnpaidListPage";
import { RecordPaymentPage } from "./features/payments/RecordPaymentPage";
import { PaymentsListPage } from "./features/payments/PaymentsListPage";
import { RefundsPage } from "./features/refunds/RefundsPage";
import { ReceiptsListPage } from "./features/receipts/ReceiptsListPage";
import { NotificationsHistoryPage } from "./features/notifications/NotificationsHistoryPage";
import { ReportsPage } from "./features/reports/ReportsPage";
import { AuditLogPage } from "./features/audit/AuditLogPage";
import { SettingsHubPage } from "./features/settings/SettingsHubPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { SchoolYearsPage } from "./features/school-years/SchoolYearsPage";
import { PaymentMethodsPage } from "./features/payment-methods/PaymentMethodsPage";
import { UsersRolesPage } from "./features/users/UsersRolesPage";
import { ProfilePage } from "./features/profile/ProfilePage";
import { SuperAdminSchoolsPage } from "./features/super-admin/SuperAdminSchoolsPage";

const STAFF_ROLES = ["director", "accountant"] as const;

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            <Route
              path="/dashboard"
              element={
                <RequireRole allowed={[...STAFF_ROLES]}>
                  <DashboardPage />
                </RequireRole>
              }
            />

            {/* Élèves */}
            <Route
              path="/students"
              element={
                <RequireRole allowed={["director", "accountant", "admin_staff"]}>
                  <StudentsListPage />
                </RequireRole>
              }
            />
            <Route
              path="/students/new"
              element={
                <RequireRole allowed={["director", "admin_staff"]}>
                  <StudentFormPage />
                </RequireRole>
              }
            />
            <Route
              path="/students/:id"
              element={
                <RequireRole allowed={["director", "accountant", "admin_staff"]}>
                  <StudentDetailPage />
                </RequireRole>
              }
            />

            {/* Classes */}
            <Route
              path="/classes"
              element={
                <RequireRole allowed={["director", "admin_staff"]}>
                  <ClassesPage />
                </RequireRole>
              }
            />

            {/* Responsables */}
            <Route
              path="/guardians"
              element={
                <RequireRole allowed={["director", "accountant", "admin_staff"]}>
                  <GuardiansListPage />
                </RequireRole>
              }
            />
            <Route
              path="/guardians/new"
              element={
                <RequireRole allowed={["director", "admin_staff"]}>
                  <GuardianFormPage />
                </RequireRole>
              }
            />

            {/* Frais */}
            <Route
              path="/fees/categories"
              element={
                <RequireRole allowed={["director"]}>
                  <FeeCategoriesPage />
                </RequireRole>
              }
            />
            <Route
              path="/fees/schedules"
              element={
                <RequireRole allowed={["director", "accountant"]}>
                  <FeeSchedulesPage />
                </RequireRole>
              }
            />
            <Route
              path="/fees/schedules/new"
              element={
                <RequireRole allowed={["director"]}>
                  <FeeScheduleFormPage />
                </RequireRole>
              }
            />

            {/* Factures */}
            <Route
              path="/invoices"
              element={
                <RequireRole allowed={[...STAFF_ROLES]}>
                  <InvoicesListPage />
                </RequireRole>
              }
            />
            <Route
              path="/invoices/new"
              element={
                <RequireRole allowed={[...STAFF_ROLES]}>
                  <CreateInvoicePage />
                </RequireRole>
              }
            />
            <Route
              path="/invoices/:id"
              element={
                <RequireRole allowed={[...STAFF_ROLES]}>
                  <InvoiceDetailPage />
                </RequireRole>
              }
            />
            <Route
              path="/unpaid"
              element={
                <RequireRole allowed={[...STAFF_ROLES]}>
                  <UnpaidListPage />
                </RequireRole>
              }
            />

            {/* Paiements */}
            <Route
              path="/payments"
              element={
                <RequireRole allowed={[...STAFF_ROLES]}>
                  <PaymentsListPage />
                </RequireRole>
              }
            />
            <Route
              path="/payments/new"
              element={
                <RequireRole allowed={[...STAFF_ROLES]}>
                  <RecordPaymentPage />
                </RequireRole>
              }
            />
            <Route
              path="/refunds"
              element={
                <RequireRole allowed={[...STAFF_ROLES]}>
                  <RefundsPage />
                </RequireRole>
              }
            />

            {/* Reçus */}
            <Route
              path="/receipts"
              element={
                <RequireRole allowed={[...STAFF_ROLES]}>
                  <ReceiptsListPage />
                </RequireRole>
              }
            />

            {/* Notifications & rapports */}
            <Route
              path="/notifications-history"
              element={
                <RequireRole allowed={[...STAFF_ROLES]}>
                  <NotificationsHistoryPage />
                </RequireRole>
              }
            />
            <Route
              path="/reports"
              element={
                <RequireRole allowed={["director"]}>
                  <ReportsPage />
                </RequireRole>
              }
            />

            {/* Paramètres */}
            <Route
              path="/settings"
              element={
                <RequireRole allowed={["director"]}>
                  <SettingsHubPage />
                </RequireRole>
              }
            />
            <Route
              path="/settings/notifications"
              element={
                <RequireRole allowed={["director"]}>
                  <SettingsPage />
                </RequireRole>
              }
            />
            <Route
              path="/settings/school-years"
              element={
                <RequireRole allowed={["director"]}>
                  <SchoolYearsPage />
                </RequireRole>
              }
            />
            <Route
              path="/settings/payment-methods"
              element={
                <RequireRole allowed={["director"]}>
                  <PaymentMethodsPage />
                </RequireRole>
              }
            />
            <Route
              path="/settings/users"
              element={
                <RequireRole allowed={["director"]}>
                  <UsersRolesPage />
                </RequireRole>
              }
            />
            <Route
              path="/settings/audit"
              element={
                <RequireRole allowed={["director"]}>
                  <AuditLogPage />
                </RequireRole>
              }
            />

            <Route path="/profile" element={<ProfilePage />} />

            {/* Plateforme (super admin uniquement) */}
            <Route
              path="/admin/schools"
              element={
                <RequireSuperAdmin>
                  <SuperAdminSchoolsPage />
                </RequireSuperAdmin>
              }
            />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
