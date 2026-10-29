import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { useSettings } from "../settings";
import type { Settings } from "../settings";
import { sounds } from "../sound";

const OPTIONS: { key: keyof Settings; label: string; hint: string }[] = [
  { key: "sound", label: "Sound", hint: "Sonar ping on accept, soft thud on a miss, bubble pops" },
  { key: "reducedMotion", label: "Reduced motion", hint: "Calmer animations (defaults to your system setting)" },
  { key: "particles", label: "Particles", hint: "Bubbles and marine snow" },
];

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, update } = useSettings();

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
            <p className="hint">
              <kbd>Esc</kbd> to close
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
