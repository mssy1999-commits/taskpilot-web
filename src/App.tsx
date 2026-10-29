import { useEffect, useRef, useState } from "react"
import type { FormEvent, KeyboardEvent, MouseEvent } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "../convex/_generated/api"
import type { Id } from "../convex/_generated/dataModel"
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Globe,
  Hand,
  KeyRound,
  Loader2,
  Lock,
  Menu,
  MessageSquarePlus,
  Newspaper,
  Search,
  Sparkles,
  Square,
  Store,
  Trash2,
  X,
} from "lucide-react"

const SUGGESTIONS = [
  { icon: Store, title: "Find suppliers", text: "Find rolling paper wholesalers in Dubai with contact pages" },
  {
    icon: Search,
    title: "Research a place",
    text: "Search for the best-rated shisha lounges in Beirut and list 5 with addresses",
  },
  { icon: Newspaper, title: "Catch up on news", text: "Open news.ycombinator.com and tell me the top 5 stories" },
  { icon: Globe, title: "Summarize a site", text: "Go to wikipedia.org and summarize today’s featured article" },
]

const THREAD_KEY = "taskpilot.thread"
const PASS_KEY = "taskpilot.pass"

function load(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function save(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {}
}

function useSystemTheme() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => document.documentElement.classList.toggle("dark", mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])
}

export default function App() {
  useSystemTheme()
  const [pass, setPass] = useState<string | undefined>(() => load(PASS_KEY) ?? undefined)
  const access = useQuery(api.threads.access, { pass })

  if (access === undefined)
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand" />
      </div>
    )
  if (access.required && !access.ok)
    return (
      <PassScreen
        wrong={!!pass}
        onSubmit={(p) => {
          save(PASS_KEY, p)
          setPass(p)
        }}
      />
    )
  return <Main pass={pass} />
}

function PassScreen({ wrong, onSubmit }: { wrong: boolean; onSubmit: (p: string) => void }) {
  const [value, setValue] = useState("")
  return (
    <div className="tp-glow flex h-full flex-col items-center justify-center bg-canvas px-6">
      <div className="tp-rise tp-float">
        <Logo size="lg" />
      </div>
      <h1 className="tp-rise mt-6 text-2xl font-semibold tracking-tight">TaskPilot is locked</h1>
      <p className="tp-rise mt-1 text-sm text-muted-foreground">Enter your passcode to continue.</p>
      <form
        className="tp-rise mt-6 flex w-full max-w-xs gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) onSubmit(value.trim())
        }}
      >
        <div className="flex flex-1 items-center gap-2 rounded-2xl border border-hairline bg-panel px-3">
          <KeyRound className="size-4 text-muted-foreground" />
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Passcode"
            className="min-w-0 flex-1 bg-transparent py-3 text-[16px] outline-none"
            autoFocus
          />
        </div>
        <button className="tp-press rounded-2xl bg-brand px-4 font-medium text-brand-foreground">Open</button>
      </form>
      {wrong && <p className="tp-rise mt-3 text-sm text-destructive">That passcode didn’t work.</p>}
    </div>
  )
}

function Main({ pass }: { pass?: string }) {
  const [threadId, setThreadId] = useState<Id<"threads"> | null>(() => load(THREAD_KEY) as Id<"threads"> | null)
  const [drawer, setDrawer] = useState(false)

  const selectThread = (id: Id<"threads"> | null) => {
    setThreadId(id)
    setDrawer(false)
    save(THREAD_KEY, id)
  }

  return (
    <div className="tp-glow flex h-dvh flex-col bg-canvas text-foreground">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-hairline/70 bg-canvas/75 px-3 py-2.5 backdrop-blur-xl">
        <button aria-label="Chats" onClick={() => setDrawer(true)} className="tp-press rounded-xl p-2 hover:bg-foreground/5">
          <Menu className="size-5" />
        </button>
        <div className="flex flex-1 items-center gap-2.5">
          <Logo size="sm" />
          <span className="font-semibold tracking-tight">TaskPilot</span>
        </div>
        <button aria-label="New chat" onClick={() => selectThread(null)} className="tp-press rounded-xl p-2 hover:bg-foreground/5">
          <MessageSquarePlus className="size-5" />
        </button>
      </header>

      <ChatView key={threadId ?? "new"} threadId={threadId} pass={pass} onSelect={selectThread} />

      {drawer && <ThreadDrawer current={threadId} pass={pass} onClose={() => setDrawer(false)} onSelect={selectThread} />}
    </div>
  )
}

function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  const box = size === "lg" ? "size-16 rounded-[1.4rem]" : "size-8 rounded-[0.7rem]"
  const icon = size === "lg" ? "size-7" : "size-4"
  return (
    <div className={`relative ${box} shrink-0 overflow-hidden shadow-lg shadow-brand/25`}>
      <div className="tp-orb absolute -inset-1/2" />
      <div className="absolute inset-0 flex items-center justify-center text-brand-foreground">
        <Sparkles className={icon} />
      </div>
    </div>
  )
}

function ThreadDrawer({
  current,
  pass,
  onClose,
  onSelect,
}: {
  current: Id<"threads"> | null
  pass?: string
  onClose: () => void
  onSelect: (id: Id<"threads"> | null) => void
}) {
  const threads = useQuery(api.threads.list, { pass })
  const remove = useMutation(api.threads.remove)
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="tp-slide-in flex w-[84%] max-w-sm flex-col border-r border-hairline bg-panel shadow-2xl">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-lg font-semibold tracking-tight">Chats</span>
          <button onClick={onClose} aria-label="Close" className="tp-press rounded-xl p-1.5 hover:bg-foreground/5">
            <X className="size-5" />
          </button>
        </div>
        <button
          onClick={() => onSelect(null)}
          className="tp-press mx-3 my-2 flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3 text-sm font-medium text-brand-foreground shadow-md shadow-brand/25"
        >
          <MessageSquarePlus className="size-4" /> New chat
        </button>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {threads === undefined && (
            <div className="space-y-2 p-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-xl bg-foreground/5" />
              ))}
            </div>
          )}
          {threads?.length === 0 && <div className="p-4 text-sm text-muted-foreground">No chats yet.</div>}
          {threads?.map((t, i) => (
            <div
              key={t._id}
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
              className={`tp-rise flex items-center rounded-xl transition-colors ${
                t._id === current ? "bg-brand/10" : "hover:bg-foreground/5"
              }`}
            >
              <button onClick={() => onSelect(t._id)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm">
                {t.status === "running" ? (
                  <span className="tp-pulse size-2 shrink-0 rounded-full bg-brand" />
                ) : t.status === "waiting" ? (
                  <span className="size-2 shrink-0 rounded-full bg-brand-2" />
                ) : null}
                <span className="truncate">{t.title}</span>
              </button>
              {t.status !== "running" && (
                <button
                  aria-label="Delete chat"
                  onClick={() => {
                    if (t._id === current) onSelect(null)
                    void remove({ threadId: t._id, pass })
                  }}
                  className="p-2.5 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <button aria-label="Close" className="tp-fade flex-1 bg-foreground/30 backdrop-blur-[2px]" onClick={onClose} />
    </div>
  )
}

function ChatView({
  threadId,
  pass,
  onSelect,
}: {
  threadId: Id<"threads"> | null
  pass?: string
  onSelect: (id: Id<"threads"> | null) => void
}) {
  const data = useQuery(api.threads.get, threadId ? { threadId, pass } : "skip")
  const send = useMutation(api.threads.send)
  const stop = useMutation(api.threads.stop)
  const requestControl = useMutation(api.threads.requestControl)
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [zoom, setZoom] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const running = data?.status === "running"
  const handoff = !!data?.handoff
  const msgCount = data?.messages.length ?? 0
  const stepCount = data?.steps.length ?? 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [msgCount, stepCount, running, handoff])

  useEffect(() => {
    if (threadId && data === null) onSelect(null)
  }, [threadId, data, onSelect])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const submit = async (value: string) => {
    const v = value.trim()
    if (!v || sending || running) return
    setSending(true)
    setError(null)
    setText("")
    const res = await send({ threadId: threadId ?? undefined, text: v, pass })
    setSending(false)
    if (!res.ok) {
      setText(v)
      setError(res.error)
      return
    }
    if (!threadId) onSelect(res.threadId)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit(text)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault()
      void submit(text)
    }
  }

  const messages = data?.messages ?? []
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user")
  const lastUserTime = lastUserIdx >= 0 ? messages[lastUserIdx]._creationTime : 0
  const liveSteps = (data?.steps ?? []).filter((s) => s._creationTime > lastUserTime)
  const showBrowser = !handoff && !!data?.screenshot && (running || data.status === "waiting")

  return (
    <>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-5">
          {!threadId && !sending && <Hero onPick={(s) => void submit(s)} />}

          {threadId && data === undefined && (
            <div className="space-y-3 pt-4">
              <div className="ml-auto h-10 w-2/3 animate-pulse rounded-3xl bg-foreground/5" />
              <div className="h-16 w-5/6 animate-pulse rounded-3xl bg-foreground/5" />
            </div>
          )}

          {messages.map((m, i) => (
            <div key={m._id} className="flex flex-col gap-3">
              <Bubble role={m.role} text={m.text} />
              {i === lastUserIdx && liveSteps.length > 0 && <StepsTimeline steps={liveSteps} running={running} />}
            </div>
          ))}

          {(running || sending) && !handoff && <WorkingIndicator since={lastUserTime} stepCount={liveSteps.length} />}

          {handoff && threadId && data?.screenshot && (
            <ControlPanel
              threadId={threadId}
              pass={pass}
              screenshot={data.screenshot}
              url={data.currentUrl}
              message={data.handoffMessage}
              until={data.handoffUntil}
            />
          )}

          {showBrowser && data?.screenshot && (
            <button
              onClick={() => setZoom(true)}
              className="tp-rise tp-press overflow-hidden rounded-3xl border border-hairline bg-panel text-left shadow-xl shadow-foreground/5"
            >
              <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
                {running ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-brand/12 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-brand">
                    <span className="tp-pulse size-1.5 rounded-full bg-brand" /> LIVE
                  </span>
                ) : (
                  <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
                    PAUSED
                  </span>
                )}
                <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-foreground/5 px-2.5 py-1 text-xs text-muted-foreground">
                  <Lock className="size-3 shrink-0" />
                  <span className="truncate">{prettyUrl(data.currentUrl)}</span>
                </div>
                {running && threadId && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      void requestControl({ threadId, pass })
                    }}
                    className="tp-press flex shrink-0 items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-brand-foreground"
                  >
                    {data.controlRequested ? <Loader2 className="size-3 animate-spin" /> : <Hand className="size-3" />}
                    {data.controlRequested ? "Handing over" : "Take control"}
                  </span>
                )}
              </div>
              <div className="relative">
                <img key={data.screenshot.length} src={data.screenshot} alt="Current page" className="tp-fade w-full" />
                {running && (
                  <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-brand/15">
                    <div className="tp-shimmer relative h-full" />
                  </div>
                )}
              </div>
            </button>
          )}

          <div ref={bottomRef} className="h-1" />
        </div>
      </main>

      {zoom && data?.screenshot && (
        <button
          className="tp-fade fixed inset-0 z-50 flex items-center justify-center bg-foreground/85 p-3 backdrop-blur-sm"
          onClick={() => setZoom(false)}
          aria-label="Close screenshot"
        >
          <img src={data.screenshot} alt="Current page" className="tp-rise max-h-full max-w-full rounded-2xl" />
        </button>
      )}

      <form
        onSubmit={onSubmit}
        className="bg-gradient-to-t from-canvas via-canvas to-canvas/0 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {error && (
          <div className="tp-rise mx-auto mb-2 max-w-2xl rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}
        <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-[1.6rem] border border-hairline bg-panel py-2 pr-2 pl-4 shadow-lg shadow-foreground/5 transition-shadow focus-within:border-brand/50 focus-within:shadow-brand/15">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder={
              running ? "Working… tap stop to interrupt" : data?.status === "waiting" ? "Reply to continue…" : "Tell me what to do…"
            }
            className="max-h-40 min-h-[2.4rem] flex-1 resize-none bg-transparent py-2 text-[16px] leading-6 outline-none placeholder:text-muted-foreground"
            disabled={running}
          />
          {running ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={() => threadId && void stop({ threadId, pass })}
              className="tp-press tp-rise flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!text.trim() || sending}
              className="tp-press flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-md shadow-brand/30 disabled:bg-foreground/10 disabled:text-muted-foreground disabled:shadow-none"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-[18px]" />}
            </button>
          )}
        </div>
      </form>
    </>
  )
}

function Hero({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col pt-8">
      <div className="tp-rise tp-float self-start">
        <Logo size="lg" />
      </div>
      <h1 className="tp-rise mt-6 text-[1.9rem] leading-tight font-semibold tracking-tight" style={{ animationDelay: "60ms" }}>
        What should I do
        <br />
        <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">for you today?</span>
      </h1>
      <p className="tp-rise mt-2 text-sm text-muted-foreground" style={{ animationDelay: "120ms" }}>
        I open websites, search, click and fill forms, then report back. I’ll always ask before anything that sends, buys
        or posts.
      </p>
      <div className="mt-7 grid grid-cols-2 gap-2.5">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={s.title}
            onClick={() => onPick(s.text)}
            style={{ animationDelay: `${180 + i * 60}ms` }}
            className="tp-rise tp-press flex flex-col gap-2 rounded-2xl border border-hairline bg-panel p-3.5 text-left shadow-sm hover:border-brand/40"
          >
            <span className="flex size-8 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <s.icon className="size-4" />
            </span>
            <span className="text-sm font-medium">{s.title}</span>
            <span className="line-clamp-2 text-xs text-muted-foreground">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ControlPanel({
  threadId,
  pass,
  screenshot,
  url,
  message,
  until,
}: {
  threadId: Id<"threads">
  pass?: string
  screenshot: string
  url?: string
  message?: string
  until?: number
}) {
  const sendInput = useMutation(api.threads.sendInput)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  const left = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0

  const input = (kind: "tap" | "type" | "key" | "scroll" | "done", extra: { x?: number; y?: number; text?: string } = {}) =>
    sendInput({ threadId, kind, pass, ...extra })

  const tap = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    const id = Date.now() + Math.random()
    setRipples((rs) => [...rs, { id, x, y }])
    setTimeout(() => setRipples((rs) => rs.filter((p) => p.id !== id)), 650)
    try {
      navigator.vibrate?.(12)
    } catch {}
    setBusy(true)
    void input("tap", { x, y }).finally(() => setTimeout(() => setBusy(false), 900))
  }

  const sendText = () => {
    if (!typed) return
    const t = typed
    setTyped("")
    void input("type", { text: t })
  }

  return (
    <div className="tp-rise tp-border-glow overflow-hidden rounded-3xl bg-panel">
      <div className="flex items-start gap-3 bg-gradient-to-r from-brand to-brand-2 px-4 py-3 text-brand-foreground">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-foreground/20">
          <Hand className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Your turn</span>
            <span className="rounded-full bg-brand-foreground/20 px-2 py-0.5 text-[11px] font-semibold tabular-nums">{left}s</span>
          </div>
          <p className="mt-0.5 text-xs leading-snug opacity-90">{message || "Tap the page below to click, then tap Done."}</p>
        </div>
      </div>
      <div className="h-1 bg-brand/15">
        <div className="h-full bg-brand transition-[width] duration-500 ease-linear" style={{ width: `${Math.min(100, left)}%` }} />
      </div>

      <div className="flex items-center gap-1.5 border-b border-hairline px-3 py-2 text-xs text-muted-foreground">
        <Lock className="size-3 shrink-0" />
        <span className="truncate">{prettyUrl(url)}</span>
        {busy && <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin text-brand" />}
      </div>

      <div onClick={tap} className="relative cursor-crosshair touch-manipulation select-none">
        <img src={screenshot} alt="Live page — tap to click" draggable={false} className="block w-full" />
        {ripples.map((p) => (
          <span key={p.id} className="tp-ripple" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />
        ))}
      </div>

      <div className="space-y-2 border-t border-hairline p-3">
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Scroll up"
            onClick={() => void input("scroll", { text: "up" })}
            className="tp-press flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/5"
          >
            <ChevronUp className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Scroll down"
            onClick={() => void input("scroll", { text: "down" })}
            className="tp-press flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/5"
          >
            <ChevronDown className="size-5" />
          </button>
          <div className="flex min-w-0 flex-1 items-center rounded-xl bg-foreground/5 pr-1 pl-3">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  sendText()
                }
              }}
              placeholder="Type into the page…"
              className="min-w-0 flex-1 bg-transparent py-2 text-[16px] outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              aria-label="Send text"
              disabled={!typed}
              onClick={sendText}
              className="tp-press flex size-8 items-center justify-center rounded-lg text-brand disabled:opacity-30"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
          <button
            type="button"
            aria-label="Press Enter"
            onClick={() => void input("key", { text: "Enter" })}
            className="tp-press flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/5"
          >
            <CornerDownLeft className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => void input("done")}
          className="tp-press flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3 text-sm font-semibold text-brand-foreground shadow-md shadow-brand/30"
        >
          <Check className="size-4" strokeWidth={3} /> Done — continue
        </button>
      </div>
    </div>
  )
}

function WorkingIndicator({ since, stepCount }: { since: number; stepCount: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = since ? Math.max(0, Math.round((now - since) / 1000)) : 0
  return (
    <div className="tp-rise flex items-center gap-3 self-start rounded-full border border-hairline bg-panel py-2 pr-4 pl-3 shadow-sm">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="tp-dot size-1.5 rounded-full bg-brand" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </span>
      <span className="text-xs text-muted-foreground">
        {stepCount === 0 ? "Thinking" : `Step ${stepCount + 1}`} · {secs}s
      </span>
    </div>
  )
}

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  if (role === "user")
    return (
      <div className="tp-rise ml-auto max-w-[85%] rounded-3xl rounded-br-lg bg-gradient-to-br from-brand to-brand-2 px-4 py-2.5 text-[15px] whitespace-pre-wrap text-brand-foreground shadow-md shadow-brand/20">
        {text}
      </div>
    )
  return (
    <div className="tp-rise flex max-w-[94%] gap-2.5">
      <div className="mt-0.5 shrink-0">
        <Logo size="sm" />
      </div>
      <div className="min-w-0 rounded-3xl rounded-tl-lg border border-hairline bg-panel px-4 py-3 text-[15px] leading-relaxed break-words whitespace-pre-wrap shadow-sm">
        <RichText text={text} />
      </div>
    </div>
  )
}

function RichText({ text }: { text: string }) {
  const cleaned = text.replace(/^(\s*)[-*] /gm, "$1• ").replace(/^#{1,4} /gm, "")
  const parts = cleaned.split(/(https?:\/\/[^\s)\]]+|\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-brand underline underline-offset-2">
            {p}
          </a>
        ) : /^\*\*[^*]+\*\*$/.test(p) ? (
          <strong key={i} className="font-semibold">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

function StepsTimeline({
  steps,
  running,
}: {
  steps: { _id: string; thought: string; action: string; ok: boolean }[]
  running: boolean
}) {
  const [open, setOpen] = useState(false)
  const shown = open ? steps : steps.slice(-4)
  const hidden = steps.length - shown.length
  return (
    <div className="tp-rise ml-10 rounded-2xl border border-hairline bg-panel/70 px-3.5 py-3 backdrop-blur">
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold tracking-wide text-muted-foreground">
        <span>
          {running ? "WORKING" : "WHAT I DID"} · {steps.length} STEPS
        </span>
        {steps.length > 4 && (
          <button onClick={() => setOpen(!open)} className="text-brand">
            {open ? "Show less" : `+${hidden} more`}
          </button>
        )}
      </div>
      <ol className="relative">
        {shown.map((s, i) => {
          const last = i === shown.length - 1
          return (
            <li key={s._id} className="tp-rise relative flex gap-2.5 pb-2.5 last:pb-0">
              {!last && <span className="absolute top-5 bottom-0 left-[9px] w-px bg-hairline" />}
              <span
                className={`relative z-10 mt-0.5 flex size-[19px] shrink-0 items-center justify-center rounded-full ${
                  s.ok ? "bg-brand/15 text-brand" : "bg-destructive/15 text-destructive"
                }`}
              >
                {s.ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
              </span>
              <div className="min-w-0 text-xs">
                <div className="font-medium break-words">{s.action}</div>
                {s.thought && <div className="mt-0.5 break-words text-muted-foreground">{s.thought}</div>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function prettyUrl(u?: string) {
  if (!u) return ""
  try {
    const url = new URL(u)
    return url.hostname.replace(/^www\./, "") + (url.pathname !== "/" ? url.pathname : "")
  } catch {
    return u
  }
}
