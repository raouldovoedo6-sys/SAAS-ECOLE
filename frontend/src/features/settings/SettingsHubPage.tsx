import { Link } from "react-router-dom";

export function SettingsHubPage() {
  return (
    <div>
      <h1>Paramètres</h1>
      <ul className="list">
        <li>
          <Link to="/settings/school-years">Années scolaires</Link>
        </li>
        <li>
          <Link to="/settings/payment-methods">Moyens de paiement officiels</Link>
        </li>
        <li>
          <Link to="/settings/notifications">Notifications (canaux et rappels)</Link>
        </li>
        <li>
          <Link to="/settings/users">Utilisateurs et rôles</Link>
        </li>
        <li>
          <Link to="/settings/audit">Journal d'audit</Link>
        </li>
        <li>
          <Link to="/fees/categories">Catégories de frais</Link>
        </li>
        <li>
          <Link to="/fees/schedules">Tarifs</Link>
        </li>
        <li>
          <Link to="/classes">Classes</Link>
        </li>
      </ul>
    </div>
  );
}
