import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { nicknameProblem } from "@fathom/shared";
import { api } from "../api";
import { getNickname, saveNickname } from "../nickname";
import { useSettings } from "../settings";
import type { Settings } from "../settings";
import { sounds } from "../sound";

const OPTIONS: { key: keyof Settings; label: string; hint: string }[] = [
  { key: "sound", label: "Sound", hint: "Sonar ping on accept, soft thud on a miss, bubble pops" },
  { key: "reducedMotion", label: "Reduced motion", hint: "Calmer animations (defaults to your system setting)" },
  { key: "particles", label: "Particles", hint: "Bubbles and marine snow" },
];

export function SettingsPanel({
  open,
  onClose,
  onHome,
  onSuggest,
}: {
  open: boolean;
  onClose: () => void;
  onHome?: () => void;
  onSuggest: () => void;
}) {
  const { settings, update } = useSettings();
  const [name, setName] = useState(getNickname() ?? "");
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(getNickname() ?? "");
      setNameMsg(null);
    }
  }, [open]);

  const saveName = async () => {
    const problem = nicknameProblem(name);
    if (problem) return setNameMsg(problem);
    try {
      await api.setNickname(name.trim());
      saveNickname(name.trim());
      setNameMsg("Saved! Leaderboards update within a couple of minutes.");
    } catch (e) {
      setNameMsg((e as Error).message);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className="card modal"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Settings</h3>
            <form
              className="settings-name"
              onSubmit={(e) => {
                e.preventDefault();
                void saveName();
              }}
            >
              <label className="toggle-label" htmlFor="settings-name">
                Your name
              </label>
              <div className="join-row">
                <input
                  id="settings-name"
                  className="code-input code-input--wide"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={16}
                  placeholder="Nickname"
                />
                <button className="btn" type="submit" disabled={!name.trim() || name.trim() === (getNickname() ?? "")}>
                  Save
                </button>
              </div>
              {nameMsg && <span className="muted small">{nameMsg}</span>}
            </form>
            {OPTIONS.map((o) => (
              <label key={o.key} className="toggle-row">
                <span>
                  <span className="toggle-label">{o.label}</span>
                  <span className="muted small">{o.hint}</span>
                </span>
                <input
                  type="checkbox"
                  className="toggle"
                  checked={settings[o.key]}
                  onChange={(e) => {
                    update({ [o.key]: e.target.checked });
                    if (o.key === "sound" && e.target.checked) sounds.ping();
                  }}
                />
              </label>
            ))}
            <button className="btn" onClick={onClose} autoFocus>
              Done
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => {
                onClose();
                onSuggest();
              }}
            >
              💬 Suggest a fix or idea
            </button>
            {onHome && (
              <button className="btn btn--ghost settings-home" onClick={onHome}>
                🏠 Return to home
              </button>
            )}
            <p className="hint">
              <kbd>Esc</kbd> to close
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
