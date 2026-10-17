// Citadel — DOM HoneyTrap
// ===========================
// An invisible form field a human never sees or focuses. Automated bots and
// naive form-fillers enumerate every input in the DOM and populate this one —
// which is a high-confidence intrusion signal. On fill we report to the backend
// (which blacklists the IP + broadcasts to the FIU panel) and notify the parent
// so it can hard-block the session.
//
// Accessibility: aria-hidden + tabIndex=-1 keep it out of the tab order and off
// screen readers, so assistive tech never trips it.

import React from "react";
import { reportHoneypot } from "../lib/securityApi";

interface HoneyTrapProps {
  sessionId: string | null;
  /** Called after a trap fires (backend already blacklisted the IP). */
  onTrapTriggered?: (trapName: string) => void;
}

const HIDDEN_STYLE: React.CSSProperties = {
  display: "none",
  visibility: "hidden",
  position: "absolute",
  left: "-9999px",
  height: 0,
  width: 0,
  overflow: "hidden",
  opacity: 0,
};

export const HoneyTrap: React.FC<HoneyTrapProps> = ({ sessionId, onTrapTriggered }) => {
  const firedRef = React.useRef(false);

  const handleFill = (value: string, trapName: string) => {
    if (firedRef.current || value.length === 0) return;
    firedRef.current = true;
    void reportHoneypot(sessionId, trapName, value.length);
    onTrapTriggered?.(trapName);
  };

  // Password-manager extensions (LastPass, 1Password, Bitwarden, Dashlane) run
  // their own DOM-scanning heuristics that don't always respect display:none,
  // and specifically target inputs that look like login/email fields — so a
  // real user's autofill can trip this trap and get their IP blacklisted for
  // 24h. type="text" (not "email") plus each vendor's documented ignore
  // attribute opts every major password manager out, while a naive bot that
  // blindly fills every input in the DOM (the actual threat model) still
  // fills these and still gets caught.
  return (
    <div style={HIDDEN_STYLE} aria-hidden="true">
      {/* Enticing names a bot's heuristics will want to fill. */}
      <label htmlFor="account_pin_confirm">Confirm PIN</label>
      <input
        type="text"
        name="account_pin_confirm"
        id="account_pin_confirm"
        tabIndex={-1}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
        onChange={(e) => handleFill(e.target.value, "DOM_HONEYPOT_PIN_FILLED")}
      />
      <input
        type="text"
        name="backup_email"
        id="backup_email"
        tabIndex={-1}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
        onChange={(e) => handleFill(e.target.value, "DOM_HONEYPOT_EMAIL_FILLED")}
      />
    </div>
  );
};

export default HoneyTrap;
