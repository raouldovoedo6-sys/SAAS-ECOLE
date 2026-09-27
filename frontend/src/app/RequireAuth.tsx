import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function RequireAuth() {
  const { loading, session } = useAuth();

  if (loading) return <p className="page-loading">Chargement…</p>;
  if (!session) return <Navigate to="/login" replace />;

  return <Outlet />;
}
