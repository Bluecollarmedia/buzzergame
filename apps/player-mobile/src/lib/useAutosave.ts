import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Debounced saving of pending changes. `save` receives the set of dirty keys
 * and must throw on failure; failed keys stay dirty and are retried.
 *
 * Pending changes are also saved the moment the app goes to the background
 * (swipe up, lock, switch apps) and when the editor is left, so nothing waits
 * on the timer. Same behaviour as the website editor.
 */
export function useAutosave(save: (keys: Set<string>) => Promise<void>, delay = 700) {
  const dirty = useRef(new Set<string>());
  const unsaved = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const saveRef = useRef(save);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) await running.current;
    if (dirty.current.size === 0) return true;
    const keys = new Set(dirty.current);
    dirty.current.clear();
    setStatus("saving");
    let ok = true;
    running.current = (async () => {
      try {
        await saveRef.current(keys);
        for (const k of keys) if (!dirty.current.has(k)) unsaved.current.delete(k);
        setError(null);
        setStatus(dirty.current.size ? "saving" : "saved");
      } catch (e) {
        ok = false;
        for (const k of keys) dirty.current.add(k);
        setError(e instanceof Error ? e.message : "Couldn't save");
        setStatus("error");
        if (retry.current) clearTimeout(retry.current);
        retry.current = setTimeout(() => void flushRef.current(), 5000);
      }
    })();
    await running.current;
    running.current = null;
    if (ok && dirty.current.size) return flushRef.current();
    return ok;
  }, []);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const markDirty = useCallback(
    (key: string) => {
      dirty.current.add(key);
      unsaved.current.add(key);
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  const unsavedKeys = useCallback(() => new Set(unsaved.current), []);

  useEffect(() => {
    const saveNow = () => {
      if (dirty.current.size) void flushRef.current();
    };
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") saveNow();
    });
    return () => {
      sub.remove();
      if (retry.current) clearTimeout(retry.current);
      saveNow();
    };
  }, []);

  return { status, error, markDirty, flush, hasPending: () => dirty.current.size > 0, unsavedKeys };
}
