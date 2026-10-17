import {
  ThresholdSettings,
  SystemHealth,
  RoleManagement,
} from "../../components/btic/settings";

export default function SettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 20, alignItems: "start" }}>
        <ThresholdSettings />
        <SystemHealth />
      </div>
      <RoleManagement />
    </div>
  );
}
