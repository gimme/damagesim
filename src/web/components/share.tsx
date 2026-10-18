// The header's Share: the scenario's code, which is what people share, to copy; a field to paste one
// into and load it; a link to the scenario; and, for agents, its JSON for the CLI and the MCP server.

import { useEffect, useId, useRef, useState } from "react";
import type { Scenario } from "../../engine/sim.ts";
import { DATA } from "../data.ts";
import { decodeState, type UIState } from "../state.ts";

/**
 * Copies text, and says whether it did: by the Clipboard API, or where there's none (it needs a secure
 * context, which a page served over plain http to another machine isn't) or it refuses, by selecting
 * the text and the browser's copy command.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (a frame's permissions, a page not focused): the copy command may still work.
  }
  const focused = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  // Read-only, so selecting it brings up no keyboard; fixed, so it doesn't scroll the page.
  area.readOnly = true;
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  return copied;
}

export function Share({ code, scenario, embedded, onLoad }: { code: string; scenario: Scenario; embedded: boolean; onLoad: (s: UIState) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  // It drops down over the page; a click outside it closes it, as Escape does (back to Share).
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div
      className="share"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button ref={button} className="btn small" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        Share
      </button>
      {open && <SharePanel id={id} code={code} scenario={scenario} embedded={embedded} onLoad={onLoad} />}
    </div>
  );
}

function SharePanel({
  id,
  code,
  scenario,
  embedded,
  onLoad,
}: {
  id: string;
  code: string;
  scenario: Scenario;
  embedded: boolean;
  onLoad: (s: UIState) => void;
}) {
  const [status, setStatus] = useState("");
  const [pasted, setPasted] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (text: string) => {
    setStatus(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(""), 2500);
  };
  const copy = async (text: string, what: string) => {
    if (await copyText(text)) return say(`Copied the ${what}`);
    say("Couldn't copy: the browser didn't let the page");
    // The code is there to copy by hand.
    if (what === "code") {
      field.current?.focus();
      field.current?.select();
    }
  };
  const paste = (text: string) => {
    const s = decodeState(DATA, text);
    if (!s) return setPasted(text);
    onLoad(s);
    setPasted("");
    say("Loaded the code");
  };
  const bad = pasted.trim() !== "";
  return (
    <div className="share-panel" id={id} role="group" aria-label="Share">
      <div className="small secondary">Share this scenario's code, or paste one to load it.</div>
      <div className="row code-row">
        <input ref={field} type="text" readOnly className="code" aria-label="Scenario code" value={code} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn small primary" autoFocus onClick={() => copy(code, "code")}>
          Copy code
        </button>
      </div>
      <input
        type="text"
        className="code"
        aria-label="Paste a code"
        placeholder="Paste a code (or a link) to load it"
        value={pasted}
        aria-invalid={bad}
        aria-describedby={bad ? `${id}-bad` : undefined}
        onChange={(e) => paste(e.target.value)}
      />
      {bad && (
        <div id={`${id}-bad`} className="small bad">
          Not a scenario code
        </div>
      )}
      <div className="row">
        {!embedded && (
          <button className="btn small" onClick={() => copy(location.href.replace(/#.*$/, "") + "#" + code, "link")}>
            Copy link
          </button>
        )}
        <span role="status" className="small secondary">
          {status}
        </span>
      </div>
      <div className="small muted share-agents">
        For agents:{" "}
        <button
          className="btn inline"
          title="Scenario JSON for the CLI (--scenario) or the MCP simulate tool"
          onClick={() => copy(JSON.stringify(scenario, null, 2), "scenario JSON")}
        >
          copy the scenario JSON
        </button>{" "}
        for the CLI or MCP
      </div>
    </div>
  );
}
