import { useState } from "react";
import { CitadelMark as Mark } from "../components/cc/CitadelMark";
import { useNavigate } from "react-router-dom";
import { isAdminLoggedIn, clearAdminSession } from "./adminAuth";
import AdminLogin from "./AdminLogin";
import CommandCenterLayout from "./layouts/CommandCenterLayout";

/** The Citadel mark — the crenellated keep from /favicon.svg, inlined. */
export function CitadelMark({ size = 24 }: { size?: number }) {
  return <Mark size={size} />;
}

// ── Entry ─────────────────────────────────────────────────────────────────────
export default function AdminApp() {
  const [authed, setAuthed] = useState(isAdminLoggedIn());
  const navigate = useNavigate();

  if (!authed) {
    return <AdminLogin onLogin={() => setAuthed(true)} />;
  }

  return (
    <CommandCenterLayout
      onLogout={() => {
        clearAdminSession();
        setAuthed(false);
        navigate("/admin");
      }}
    />
  );
}
