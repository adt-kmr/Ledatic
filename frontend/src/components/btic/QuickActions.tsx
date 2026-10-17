import { memo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Map,
  Shield,
  AlertTriangle,
  Users,
  BarChart3,
} from "lucide-react";

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  description: string;
  route: string;
  color: string;
}

const ACTIONS: QuickAction[] = [
  {
    icon: <Search size={16} />,
    label: "Investigate",
    description: "Search by hash or session",
    route: "/admin/investigate",
    color: "var(--color-primary)",
  },
  {
    icon: <Map size={16} />,
    label: "Threat Map",
    description: "View spatial intelligence",
    route: "/admin/threats",
    color: "#2C7A91",
  },
  {
    icon: <Shield size={16} />,
    label: "Block Threat",
    description: "Manually block an entity",
    route: "/admin/settings",
    color: "#B3261E",
  },
  {
    icon: <AlertTriangle size={16} />,
    label: "Active Alerts",
    description: "Review critical incidents",
    route: "/admin/threats",
    color: "#B7791F",
  },
  {
    icon: <Users size={16} />,
    label: "Campaign Intel",
    description: "Explore fraud campaigns",
    route: "/admin/campaigns",
    color: "#8E5BA8",
  },
  {
    icon: <BarChart3 size={16} />,
    label: "Analytics",
    description: "Threat trends & metrics",
    route: "/admin/analytics",
    color: "#3D8B5A",
  },
];

export const QuickActions = memo(function QuickActions() {
  const navigate = useNavigate();

  return (
    <div className="glass-card" style={{ padding: "18px 22px" }}>
      <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 14 }}>
          Quick actions
        </div>
      <div
        className="grid grid-cols-2 sm:grid-cols-3"
        style={{ gap: 8 }}
      >
        {ACTIONS.map((action) => (
          <button
            key={action.label}
            onClick={() => navigate(action.route)}
            className="magnetic-hover"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              padding: "14px 8px",
              borderRadius: 10,
              border: "1px solid #EAE4E1",
              background: "#FFFFFF",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: `${action.color}15`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: action.color,
              }}
            >
              {action.icon}
            </div>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "#100F0F",
                fontFamily: "'Inter', sans-serif",
              }}
            >
              {action.label}
            </span>
            <span
              style={{
                fontSize: 11,
                color: "#969290",
                textAlign: "center",
                lineHeight: 1.3,
              }}
            >
              {action.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
});
