import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./app/AuthContext";
import { RequireAuth } from "./app/RequireAuth";
import { RequireRole } from "./app/RequireRole";
import { Layout } from "./components/Layout";
import { LoginPage } from "./features/auth/LoginPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { StudentsListPage } from "./features/students/StudentsListPage";
import { InvoicesListPage } from "./features/invoices/InvoicesListPage";
import { CreateInvoicePage } from "./features/invoices/CreateInvoicePage";
import { RecordPaymentPage } from "./features/payments/RecordPaymentPage";
import { PaymentsListPage } from "./features/payments/PaymentsListPage";
import { ReceiptsListPage } from "./features/receipts/ReceiptsListPage";
import { ParentPortalPage } from "./features/parents/ParentPortalPage";
import { SettingsPage } from "./features/settings/SettingsPage";

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
                <RequireRole allowed={["director", "accountant"]}>
                  <DashboardPage />
                </RequireRole>
              }
            />

            <Route
              path="/students"
              element={
                <RequireRole allowed={["director", "accountant", "admin_staff"]}>
                  <StudentsListPage />
                </RequireRole>
              }
            />

            <Route
              path="/invoices"
              element={
                <RequireRole allowed={["director", "accountant"]}>
                  <InvoicesListPage />
                </RequireRole>
              }
            />
            <Route
              path="/invoices/new"
              element={
                <RequireRole allowed={["director", "accountant"]}>
                  <CreateInvoicePage />
                </RequireRole>
              }
            />

            <Route
              path="/payments"
              element={
                <RequireRole allowed={["director", "accountant"]}>
                  <PaymentsListPage />
                </RequireRole>
              }
            />
            <Route
              path="/payments/new"
              element={
                <RequireRole allowed={["director", "accountant"]}>
                  <RecordPaymentPage />
                </RequireRole>
              }
            />

            <Route
              path="/receipts"
              element={
                <RequireRole allowed={["director", "accountant"]}>
                  <ReceiptsListPage />
                </RequireRole>
              }
            />

            <Route
              path="/settings"
              element={
                <RequireRole allowed={["director"]}>
                  <SettingsPage />
                </RequireRole>
              }
            />

            <Route
              path="/parent"
              element={
                <RequireRole allowed={["parent"]}>
                  <ParentPortalPage />
                </RequireRole>
              }
            />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
