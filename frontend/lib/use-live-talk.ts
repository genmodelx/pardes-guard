// One spoken conversation at a time, for the assistant and interview practice. The screen shows
// `lines` while the person talks; when the talk ends (they stop, or Google closes the session),
// `onFinish` gets everything that was said so the screen can keep it with the typed conversation.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolSpec } from "@/lib/ai";
import { linksIn, type ToolDeps, type ToolLink } from "@/lib/assistant-tools";
import { addToTranscript, type TranscriptLine } from "@/lib/interview";
import { startLive, type LiveFailure, type LiveHandle } from "@/lib/live";

export type TalkState = "off" | "connecting" | "on";

export interface Talked {
  lines: TranscriptLine[];
  /** The app's functions the model used for a line, by the line's place in `lines`. */
  tools: Record<number, string[]>;
  /** The links those functions answered with, by line, to show under it. */
  links: Record<number, ToolLink[]>;
  /** True when the session closed by itself rather than by the person's Stop. */
  endedByService: boolean;
}

export function useLiveTalk(onFinish: (talked: Talked) => void) {
  const [state, setState] = useState<TalkState>("off");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [tools, setTools] = useState<Record<number, string[]>>({});
  const [links, setLinks] = useState<Record<number, ToolLink[]>>({});
  const handle = useRef<LiveHandle | null>(null);
  const said = useRef<TranscriptLine[]>([]);
  const used = useRef<Record<number, string[]>>({});
  const linked = useRef<Record<number, ToolLink[]>>({});
  // Each start gets a number; callbacks from an older session are ignored.
  const session = useRef(0);
  const finished = useRef(onFinish);
  useEffect(() => {
    finished.current = onFinish;
  });

  const finish = useCallback(async (endedByService: boolean): Promise<Talked> => {
    session.current += 1;
    const h = handle.current;
    handle.current = null;
    const talked: Talked = { lines: said.current, tools: used.current, links: linked.current, endedByService };
    said.current = [];
    used.current = {};
    linked.current = {};
    setState("off");
    setLines([]);
    setTools({});
    setLinks({});
    await h?.stop();
    if (talked.lines.length || endedByService) finished.current(talked);
    return talked;
  }, []);

  const start = useCallback(async (opts: { system: string; tools?: ToolSpec[]; toolDeps?: ToolDeps }): Promise<LiveFailure | null> => {
    if (handle.current) return null;
    const id = ++session.current;
    const mine = () => session.current === id;
    said.current = [];
    used.current = {};
    linked.current = {};
    setLines([]);
    setTools({});
    setLinks({});
    setState("connecting");
    let pending: string[] = [];
    let pendingLinks: ToolLink[] = [];
    let endedEarly = false;
    const out = await startLive({
      ...opts,
      onPiece: (who, piece) => {
        if (!mine()) return;
        said.current = addToTranscript(said.current, who, piece);
        setLines(said.current);
      },
      onTool: (name, response) => {
        if (!mine()) return;
        pending.push(name);
        pendingLinks.push(...linksIn(response));
      },
      onTurnEnd: () => {
        if (!mine() || !pending.length) return;
        const last = said.current.map((l) => l.who).lastIndexOf("coach");
        if (last < 0) return;
        used.current = { ...used.current, [last]: [...(used.current[last] ?? []), ...pending] };
        const lineLinks = [...(linked.current[last] ?? [])];
        for (const l of pendingLinks) if (!lineLinks.some((m) => m.url === l.url)) lineLinks.push(l);
        linked.current = { ...linked.current, [last]: lineLinks };
        pending = [];
        pendingLinks = [];
        setTools(used.current);
        setLinks(linked.current);
      },
      onEnd: () => {
        if (!mine()) return;
        if (handle.current) void finish(true);
        else endedEarly = true;
      },
    });
    if (!mine()) {
      // The screen closed while connecting.
      if (out.ok) await out.handle.stop();
      return null;
    }
    if (!out.ok) {
      session.current += 1;
      setState("off");
      return out.reason;
    }
    handle.current = out.handle;
    setState("on");
    if (endedEarly) void finish(true);
    return null;
  }, [finish]);

  /** Stop talking. Resolves with what was said, after `onFinish` has had it. */
  const stop = useCallback(() => finish(false), [finish]);

  useEffect(
    () => () => {
      session.current += 1;
      void handle.current?.stop();
      handle.current = null;
    },
    [],
  );

  return { state, lines, tools, links, start, stop };
}
