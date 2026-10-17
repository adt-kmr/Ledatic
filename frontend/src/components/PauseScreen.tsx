import { useEffect, useState } from "react";
import { motion } from "framer-motion";

type Lang = "en" | "hi";

const LANG_KEY = "citadel.pause.lang";

const COPY: Record<Lang, {
  title: string;
  question: string;
  facts: string[];
  riskLabel: string;
  continueLabel: string;
  stopLabel: string;
  helpline: string;
}> = {
  en: {
    title: "Please pause for a moment",
    question: "Is someone on a call or video call telling you to make this payment?",
    facts: [
      "Your bank, the police or any government agency will never ask you to move money to keep your account safe.",
      "\"Digital arrest\" does not exist. A video call that says you are under arrest is a scam.",
      "Do not share your screen, install a remote-access app, or read out an OTP to anyone.",
    ],
    riskLabel: "Why we paused this",
    continueLabel: "No one is guiding me. Continue",
    stopLabel: "Yes, someone is. Stop this",
    helpline: "Report cyber fraud: call 1930 or visit cybercrime.gov.in",
  },
  hi: {
    title: "कृपया एक पल रुकें",
    question: "क्या कोई फ़ोन या वीडियो कॉल पर आपसे यह भुगतान करने के लिए कह रहा है?",
    facts: [
      "आपका बैंक, पुलिस या कोई सरकारी एजेंसी कभी नहीं कहेगी कि खाता सुरक्षित रखने के लिए पैसे ट्रांसफ़र करें।",
      "\"डिजिटल अरेस्ट\" जैसी कोई चीज़ नहीं होती। वीडियो कॉल पर गिरफ़्तारी की बात करना ठगी है।",
      "अपनी स्क्रीन शेयर न करें, रिमोट-एक्सेस ऐप इंस्टॉल न करें, और किसी को OTP न बताएँ।",
    ],
    riskLabel: "हमने इसे क्यों रोका",
    continueLabel: "कोई मुझे गाइड नहीं कर रहा। आगे बढ़ें",
    stopLabel: "हाँ, कोई कह रहा है। रोकें",
    helpline: "साइबर ठगी की शिकायत: 1930 पर कॉल करें या cybercrime.gov.in पर जाएँ",
  },
};

function readLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "hi" ? "hi" : "en";
  } catch {
    return "en";
  }
}

interface PauseScreenProps {
  /** Backend explanation for the step-up, shown under "Why we paused this". */
  reason: string;
  score: number;
  /** Customer chose to continue; the step-up verification proceeds. */
  onContinue: () => void;
  /** Customer says they are being coached; the payment is stopped. */
  onStop: () => void;
}

export default function PauseScreen({ reason, score, onContinue, onStop }: PauseScreenProps) {
  const [lang, setLang] = useState<Lang>(readLang);
  const t = COPY[lang];

  useEffect(() => {
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage unavailable */ }
  }, [lang]);

  return (
    <motion.div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="pause-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(16, 15, 15, 0.82)", backdropFilter: "blur(14px)", padding: 16,
      }}
    >
      <motion.div
        initial={{ scale: 0.94, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        style={{
          background: "#FFFFFF", border: "1px solid #EAE4E1", borderRadius: 24, padding: "32px 32px 26px",
          maxWidth: 480, width: "100%", maxHeight: "92vh", overflowY: "auto",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)", textAlign: "left",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <div role="group" aria-label="Language" style={{ display: "inline-flex", border: "1px solid #D7D2D0", borderRadius: 999, overflow: "hidden" }}>
            {(["en", "hi"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                style={{
                  padding: "5px 14px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
                  background: lang === l ? "#100F0F" : "transparent",
                  color: lang === l ? "#FFFFFF" : "#575452",
                }}
              >
                {l === "en" ? "English" : "हिन्दी"}
              </button>
            ))}
          </div>
        </div>

        <h2
          id="pause-title"
          style={{ margin: "0 0 10px", fontSize: 26, lineHeight: 1.15, fontWeight: 400, color: "#100F0F", fontFamily: "'Newsreader', Georgia, serif" }}
        >
          {t.title}
        </h2>
        <p style={{ margin: "0 0 18px", fontSize: 16, fontWeight: 600, lineHeight: 1.45, color: "#100F0F" }}>{t.question}</p>

        <ul style={{ margin: "0 0 18px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {t.facts.map((f) => (
            <li
              key={f}
              style={{
                fontSize: 13.5, lineHeight: 1.55, color: "#575452", padding: "10px 12px",
                background: "#FBF9F8", borderLeft: "3px solid #B7791F", borderRadius: 6,
              }}
            >
              {f}
            </li>
          ))}
        </ul>

        {reason && (
          <div style={{ margin: "0 0 18px", fontSize: 12, color: "#767270", lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600, color: "#575452" }}>{t.riskLabel}:</span> {reason}
            <span style={{ fontFamily: "'DM Mono', monospace", marginLeft: 6 }}>({score}/1000)</span>
          </div>
        )}

        <button
          onClick={onStop}
          style={{
            width: "100%", padding: "13px 18px", borderRadius: 12, border: "none", cursor: "pointer",
            background: "#B3261E", color: "#FFFFFF", fontSize: 14, fontWeight: 700, marginBottom: 10,
          }}
        >
          {t.stopLabel}
        </button>
        <button
          onClick={onContinue}
          style={{
            width: "100%", padding: "12px 18px", borderRadius: 12, cursor: "pointer",
            border: "1px solid #D7D2D0", background: "transparent", color: "#100F0F", fontSize: 13.5, fontWeight: 600,
          }}
        >
          {t.continueLabel}
        </button>
        <div style={{ marginTop: 14, fontSize: 11.5, color: "#969290", textAlign: "center" }}>{t.helpline}</div>
      </motion.div>
    </motion.div>
  );
}
