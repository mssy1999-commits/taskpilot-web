"use node"

import { v } from "convex/values"
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
import { RemoteBrowser } from "./cdp"

const MAX_STEPS = 25
const DEADLINE_MS = 8 * 60 * 1000
const MAX_STATE_BYTES = 300_000
const HANDOFF_MAX_MS = 100_000

type AgentAction = {
  thought?: string
  actions?: AgentAction[]
  action?: string
  id?: number
  text?: string
  submit?: boolean
  url?: string
  query?: string
  key?: string
  direction?: string
  message?: string
}

const SYSTEM_PROMPT = `You are TaskPilot, an assistant that completes tasks for the user by operating a real web browser. Work FAST: finish in as few turns as possible.

Each turn you receive: the conversation, your previous steps in this task, and (if a page is open) the page URL, a numbered list of interactive elements, the visible page text, and a screenshot.

Reply with ONE JSON object only, in one of these two shapes:
{"thought": "short reasoning", "action": "<action>", ...fields}
{"thought": "short reasoning", "actions": [ {"action": ...}, {"action": ...} ]}

Use the "actions" list (up to 8) whenever the next actions don't depend on seeing the result first — e.g. fill EVERY field of a form in one turn (type email, type password, select month, select day, select year, type name...), then click the submit button as the last item. The list stops early by itself if the page changes. Keep thought under 20 words.

Actions:
- {"action":"goto","url":"https://..."}                    open a URL
- {"action":"search","query":"..."}                        web search
- {"action":"click","id":N}                                 click element [N]
- {"action":"type","id":N,"text":"...","submit":false}      fill input [N] ("submit":true presses Enter after)
- {"action":"select","id":N,"text":"option label"}          choose an option in ANY dropdown (native or custom) in one move: [N] is the dropdown itself, text is the option, e.g. "January", "15", "1995". Never click a dropdown open and then click the option yourself.
- {"action":"press","key":"Enter"}                          press a key (Enter, Tab, Escape, ArrowDown...)
- {"action":"scroll","direction":"down"|"up"}
- {"action":"back"}
- {"action":"wait"}                                          wait for the page to load
- {"action":"handoff","message":"..."}                       let the user control the live page themselves (they tap the screen), then you continue
- {"action":"ask_user","message":"..."}                      stop and ask the user something
- {"action":"done","message":"..."}                          finished; message is your final answer

Rules:
- If the request needs no browsing (a greeting, a general question you can answer well), reply with "done" right away.
- Only use element ids from the CURRENT element list. If what you need isn't listed, scroll or navigate.
- Never invent the user's personal details (name, email, phone, address, passwords, birthdays). If a form needs something the user hasn't given you, use ask_user.
- Use passwords only if the user typed them in this chat.
- Before any step that spends money, places an order, sends a message or email, publishes a post, deletes something, or accepts terms on the user's behalf, use ask_user to confirm unless the user already explicitly confirmed that exact step.
- If you hit a CAPTCHA, reCAPTCHA, "I'm not a robot" box, puzzle, or any "verify you are human" check, use handoff with a short message like "Please tick the reCAPTCHA box and solve the pictures, then tap Done". Never try to solve those yourself.
- After a handoff, look at the page again: if the check is passed, carry on with the task; if not, hand off once more or explain with ask_user.
- For an SMS/email verification code, use ask_user (the user replies with the code), unless the user typed it in this chat already.
- If stuck after a few attempts, say so with ask_user instead of looping.
- If a site shows an error after you submit (e.g. "Sorry, we could not create your account", "Something went wrong", "unusual activity", "try again later"), do NOT start the whole process again. Use ask_user and tell the user exactly what the page says and what they can do (e.g. do it themselves on their phone, or try later). Never repeat the same multi-page flow more than once.
- In "done" and "ask_user" messages, be concise and concrete: what you did, what you found (key facts, links), and anything the user must do next. Reply in the user's language.`

const OBSERVE_JS = `(() => {
  document.querySelectorAll('[data-tp]').forEach(e => e.removeAttribute('data-tp'));
  const sel = 'a[href],button,input,textarea,select,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=combobox],[contenteditable=true],summary';
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  const out = []; let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.top > window.innerHeight * 2.5) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    if (el.type === 'hidden') continue;
    i++; el.setAttribute('data-tp', String(i));
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    let label = clean(el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('alt') || '');
    if (!label && el.id) { const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); label = clean(lab && lab.innerText); }
    let line = '[' + i + '] ' + tag + (type ? '(' + type + ')' : '');
    if (label) line += ' "' + label.slice(0, 80) + '"';
    const ph = el.getAttribute('placeholder'); if (ph) line += ' placeholder="' + clean(ph).slice(0, 50) + '"';
    const name = el.getAttribute('name');
    if (name && /^(input|textarea|select)$/.test(tag)) line += ' name="' + name.slice(0, 40) + '"';
    if (/^(input|textarea)$/.test(tag) && type !== 'password' && el.value) line += ' value="' + clean(el.value).slice(0, 40) + '"';
    if (type === 'password' && el.value) line += ' (filled)';
    if (type === 'checkbox' || type === 'radio') line += el.checked ? ' [checked]' : ' [unchecked]';
    if (tag === 'select') line += ' options: ' + Array.from(el.options).slice(0, 12).map(o => clean(o.text)).join(' | ');
    if (tag === 'a') { const h = el.getAttribute('href') || ''; if (h && !h.startsWith('javascript')) line += ' -> ' + h.slice(0, 70); }
    out.push(line);
    if (i >= 160) break;
  }
  return { elements: out.join('\\n'), text: clean(document.body ? document.body.innerText : '').slice(0, 3500), title: document.title, url: location.href };
})()`

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const run = internalAction({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const started = Date.now()
    const ctxData = await ctx.runQuery(internal.threads.context, { threadId })
    if (!ctxData) return

    const geminiKey = process.env.GEMINI_API_KEY
    if (!geminiKey) {
      await ctx.runMutation(internal.threads.finish, {
        threadId,
        waiting: false,
        text: "Setup needed: add a free Gemini API key (from aistudio.google.com) as the GEMINI_API_KEY environment variable in your Convex dashboard, then send your message again.",
      })
      return
    }

    let browser: RemoteBrowser | null = null
    const history: string[] = []
    const visits = new Map<string, number>()
    let lastUrl = ctxData.currentUrl
    let lastShot: string | undefined
    let pendingWrite: Promise<unknown> = Promise.resolve()

    // Free Browserless sessions are capped at 2 minutes, so long tasks hop to a
    // fresh session (same cookies, same page) before the cap is hit.
    const custom = process.env.BROWSER_WS_URL
    const SESSION_MS = Number(process.env.BROWSER_SESSION_MS || (custom ? 0 : 120_000))
    let openedAt = 0
    let cookieCache: any[] | undefined
    if (ctxData.storageState) {
      try {
        cookieCache = JSON.parse(ctxData.storageState)
      } catch {}
    }
    const token = process.env.BROWSERLESS_TOKEN
    const region = process.env.BROWSERLESS_REGION || "production-lon"
    const endpoint =
      custom || (token ? `wss://${region}.browserless.io?token=${token}&timeout=${SESSION_MS || 120000}` : undefined)

    let opening: Promise<RemoteBrowser> | null = null
    const openBrowser = (restoreUrl?: string): Promise<RemoteBrowser> => {
      const cur = browser as RemoteBrowser | null
      if (cur && !cur.closed) return Promise.resolve(cur)
      if (!endpoint) return Promise.reject(new Error("NO_BROWSER_KEY"))
      if (!opening) {
        opening = (async () => {
          const b = await RemoteBrowser.connect(endpoint)
          await b.newPage(cookieCache)
          openedAt = Date.now()
          browser = b
          if (restoreUrl && restoreUrl !== "about:blank") {
            try {
              await b.goto(restoreUrl)
            } catch {}
          }
          return b
        })().finally(() => {
          opening = null
        })
      }
      return opening
    }

    // Warm up the cloud browser while the AI decides the first step.
    if (endpoint) openBrowser().catch(() => {})

    const recycle = async () => {
      const live = browser as RemoteBrowser | null
      if (live) {
        if (!live.closed) {
          try {
            cookieCache = await live.cookies()
          } catch {}
        }
        live.close()
      }
      browser = null
      await openBrowser(lastUrl)
      history.push(
        "(The free browser session was refreshed and the page reloaded, so any form fields may be empty again — re-check and refill them all in one turn.)",
      )
    }

    const sessionExpiring = () =>
      !!browser && SESSION_MS > 0 && Date.now() - openedAt > SESSION_MS - 35_000

    const end = async (text: string, waiting: boolean) => {
      await pendingWrite.catch(() => {})
      if (opening) await (opening as Promise<RemoteBrowser>).catch(() => {})
      let storageState: string | undefined
      const live = browser as RemoteBrowser | null
      if (live && !live.closed) {
        try {
          cookieCache = await live.cookies()
        } catch {}
        live.close()
      }
      if (cookieCache) {
        const s = JSON.stringify(cookieCache)
        if (s.length <= MAX_STATE_BYTES) storageState = s
      }
      await ctx.runMutation(internal.threads.finish, {
        threadId,
        text,
        waiting,
        currentUrl: lastUrl,
        storageState,
        screenshot: lastShot,
      })
    }

    // ---- "Your turn": the user drives the live browser by tapping the screenshot ----
    const handOff = async (message: string): Promise<string> => {
      let b: RemoteBrowser
      try {
        b = await openBrowser(lastUrl)
      } catch {
        return "the browser could not be opened for the user"
      }
      if (SESSION_MS > 0 && SESSION_MS - (Date.now() - openedAt) < 60_000) {
        await recycle()
        b = browser as unknown as RemoteBrowser
      }
      try {
        await b.setViewport("phone")
        await sleepMs(500)
      } catch {}
      const remaining = SESSION_MS > 0 ? SESSION_MS - (Date.now() - openedAt) - 8_000 : HANDOFF_MAX_MS
      const until = Date.now() + Math.max(15_000, Math.min(HANDOFF_MAX_MS, remaining))
      await pendingWrite.catch(() => {})

      const pushShot = async () => {
        const s = await b.screenshot()
        if (!s) return
        lastShot = `data:image/jpeg;base64,${s}`
        let url: string | undefined
        try {
          url = await b.eval<string>("location.href", 3000)
        } catch {}
        const real = url && url !== "about:blank" ? url : undefined
        if (real) lastUrl = real
        await ctx.runMutation(internal.threads.setScreenshot, { threadId, screenshot: lastShot, url: real })
      }

      await pushShot()
      await ctx.runMutation(internal.threads.setHandoff, { threadId, on: true, until, message })
      let result = "time ran out before the user tapped Done"
      let lastPush = Date.now()
      while (Date.now() < until && !b.closed) {
        const { inputs, stop } = await ctx.runMutation(internal.threads.takeInputs, { threadId })
        if (stop) {
          result = "the user stopped the task"
          break
        }
        let done = false
        for (const i of inputs) {
          try {
            if (i.kind === "tap" && i.x !== undefined && i.y !== undefined) await b.clickAt(i.x, i.y)
            else if (i.kind === "type" && i.text) await b.insertText(i.text)
            else if (i.kind === "key" && i.text) await b.press(i.text)
            else if (i.kind === "scroll") await b.scroll(i.text === "up" ? -420 : 420)
            else if (i.kind === "done") done = true
          } catch {}
        }
        if (done) {
          result = "the user finished and tapped Done"
          break
        }
        if (inputs.length) {
          await sleepMs(650)
          await pushShot()
          lastPush = Date.now()
        } else if (Date.now() - lastPush > 2500) {
          await pushShot()
          lastPush = Date.now()
        } else {
          await sleepMs(450)
        }
      }
      try {
        if (!b.closed) {
          await b.setViewport("desktop")
          await sleepMs(400)
        }
      } catch {}
      await ctx.runMutation(internal.threads.setHandoff, { threadId, on: false })
      return result
    }

    try {
      for (let step = 1; step <= MAX_STEPS; step++) {
        if (Date.now() - started > DEADLINE_MS) {
          await end(
            `I ran out of time on this run after ${step - 1} steps. I'm on ${lastUrl ?? "no page"}. Say "continue" and I'll pick up from here.`,
            true,
          )
          return
        }
        const flags = await ctx.runQuery(internal.threads.flags, { threadId })
        if (flags.stop) {
          await end("Stopped. Tell me what to do next.", false)
          return
        }
        if (flags.control) {
          const outcome = await handOff("You're in control. Tap the page to click, then tap Done.")
          history.push(`${step}. User took control of the browser (${outcome})`)
          pendingWrite = ctx.runMutation(internal.threads.addStep, {
            threadId,
            thought: "",
            action: `You took control — ${outcome.replace(/^the user /, "")}`,
            url: lastUrl,
            ok: !outcome.startsWith("time"),
            screenshot: lastShot,
          })
          continue
        }

        // ---- observe ----
        if (browser && ((browser as RemoteBrowser).closed || sessionExpiring())) {
          await recycle()
        }
        let observation: string
        let shotB64: string | undefined
        const live = browser as RemoteBrowser | null
        if (live) {
          const fallback = { elements: "", text: "", title: "", url: lastUrl ?? "" }
          const [obsRes, shot] = await Promise.all([
            live.eval<typeof fallback>(OBSERVE_JS).catch(() => fallback),
            live.screenshot(),
            pendingWrite.catch(() => {}),
          ])
          const obs = obsRes || fallback
          const blank = !obs.url || obs.url === "about:blank"
          if (blank) {
            observation = lastUrl
              ? `A blank browser tab is open. The last page used in this chat was ${lastUrl} (use goto to reopen it; sign-in cookies are kept).`
              : "A blank browser tab is open."
          } else {
            lastUrl = obs.url
            shotB64 = shot
            if (shotB64) lastShot = `data:image/jpeg;base64,${shotB64}`
            observation = `CURRENT PAGE: ${obs.title} — ${lastUrl}\n\nINTERACTIVE ELEMENTS:\n${obs.elements || "(none found)"}\n\nVISIBLE TEXT:\n${obs.text}`
          }
        } else {
          observation = lastUrl
            ? `No browser page is open yet. The last page used in this chat was ${lastUrl} (use goto to reopen it; sign-in cookies are kept).`
            : "No browser page is open yet."
        }

        const convo = ctxData.messages
          .map((m) => `${m.role === "user" ? "USER" : "TASKPILOT"}: ${m.text}`)
          .join("\n")
        const prompt = `CONVERSATION:\n${convo}\n\nYOUR STEPS SO FAR IN THIS TASK:\n${history.length ? history.join("\n") : "(none)"}\n\n${observation}\n\nStep ${step} of ${MAX_STEPS}. Reply with the next JSON action.`

        // ---- decide ----
        const raw = await callGemini(geminiKey, prompt, shotB64)
        const thought = (raw.thought ?? "").slice(0, 400)
        let batch: AgentAction[] = Array.isArray(raw.actions) && raw.actions.length ? raw.actions.slice(0, 8) : [raw]
        const isTerminal = (a: AgentAction) => ["done", "ask_user", "handoff"].includes((a.action ?? "").toLowerCase())
        // A terminal action only counts when it comes first; later ones wait for a fresh look.
        const cut = batch.findIndex((a, i) => i > 0 && isTerminal(a))
        if (cut > 0) batch = batch.slice(0, cut)
        const decision = batch[0] ?? raw
        const action = (decision.action ?? "").toLowerCase()

        if (action === "handoff") {
          const msg = decision.message?.trim() || "Please complete this step on the page, then tap Done."
          pendingWrite = ctx.runMutation(internal.threads.addStep, {
            threadId,
            thought,
            action: "Handed control to you",
            url: lastUrl,
            ok: true,
            screenshot: lastShot,
          })
          const outcome = await handOff(msg)
          history.push(`${step}. Asked the user to take over: "${msg}" → ${outcome}`)
          continue
        }

        if (action === "done" || action === "ask_user") {
          const msg = decision.message?.trim() || (action === "done" ? "Done." : "I need more information to continue.")
          await end(msg, action === "ask_user")
          return
        }

        // ---- act (possibly several actions in a row) ----
        const descs: string[] = []
        let desc = ""
        let ok = true
        try {
          const b = await openBrowser()
          let startUrl: string | undefined
          try {
            startUrl = await b.eval<string>("location.href", 3000)
          } catch {}
          for (let i = 0; i < batch.length; i++) {
            const a = batch[i]
            let d = describe(a)
            try {
              loopGuard(visits, a)
              await act(b, a)
            } catch (e: any) {
              if (b.closed) throw e
              ok = false
              d += ` → failed: ${String(e?.message ?? e).split("\n")[0].slice(0, 140)}`
              descs.push(d)
              break
            }
            descs.push(d)
            let nowUrl: string | undefined
            try {
              nowUrl = await b.eval<string>("location.href", 3000)
            } catch {}
            if (nowUrl) lastUrl = nowUrl
            if (i < batch.length - 1 && startUrl && nowUrl && nowUrl !== startUrl && nowUrl !== "about:blank") {
              descs.push("(page changed — looking again)")
              break
            }
          }
          desc = descs.join(" · ")
        } catch (e: any) {
          desc = descs.join(" · ") || describe(decision)
          if (e?.message === "NO_BROWSER_KEY") {
            await end(
              "Setup needed: to browse websites I need a cloud browser. Create a free account at browserless.io, copy your API token, and add it as the BROWSERLESS_TOKEN environment variable in your Convex dashboard. Then send your message again.",
              false,
            )
            return
          }
          if (!browser) throw e
          if ((browser as RemoteBrowser).closed) {
            try {
              await recycle()
            } catch {}
          }
          ok = false
          desc += ` → failed: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}`
        }
        history.push(`${step}. ${desc}`)
        pendingWrite = ctx.runMutation(internal.threads.addStep, {
          threadId,
          thought,
          action: desc,
          url: lastUrl,
          ok,
          screenshot: lastShot,
        })
      }
      await end(
        `I used all ${MAX_STEPS} steps without finishing. I'm on ${lastUrl ?? "no page"}. Say "continue", or give me more specific directions.`,
        true,
      )
    } catch (e: any) {
      await end(`Something went wrong: ${String(e?.message ?? e).split("\n")[0].slice(0, 300)}`, false)
    }
  },
})

function describe(a: AgentAction): string {
  switch ((a.action ?? "").toLowerCase()) {
    case "goto":
      return `Open ${a.url}`
    case "search":
      return `Search “${a.query}”`
    case "click":
      return `Click [${a.id}]`
    case "type":
      return `Type into [${a.id}]: ${looksSecret(a.text) ? "••••••" : `“${(a.text ?? "").slice(0, 60)}”`}`
    case "select":
      return `Choose “${a.text}” in [${a.id}]`
    case "press":
      return `Press ${a.key}`
    case "scroll":
      return `Scroll ${a.direction ?? "down"}`
    case "back":
      return "Go back"
    case "wait":
      return "Wait for page"
    default:
      return `Unknown action: ${a.action}`
  }
}

function looksSecret(t?: string) {
  return !!t && /^\S{6,}$/.test(t) && /\d/.test(t) && /[^a-zA-Z0-9@.]/.test(t)
}

/** Same page opened 3+ times in one task = the agent is going in circles. */
function loopGuard(counts: Map<string, number>, a: AgentAction) {
  const kind = (a.action ?? "").toLowerCase()
  if (kind !== "goto" && kind !== "search") return
  let key = kind === "search" ? `search:${(a.query ?? "").toLowerCase()}` : (a.url ?? "")
  try {
    if (kind === "goto") {
      const u = new URL(/^https?:\/\//i.test(key) ? key : `https://${key}`)
      key = u.hostname + u.pathname
    }
  } catch {}
  const n = (counts.get(key) ?? 0) + 1
  counts.set(key, n)
  if (n >= 3)
    throw new Error(
      "Blocked: this page was already started twice in this task. Do not restart again — use ask_user to tell the user what the site said and suggest what to do.",
    )
}

async function act(b: RemoteBrowser, a: AgentAction) {
  const id = Number(a.id)
  switch ((a.action ?? "").toLowerCase()) {
    case "goto": {
      let url = (a.url ?? "").trim()
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`
      await b.goto(url)
      break
    }
    case "search":
      await b.goto(`https://duckduckgo.com/html/?q=${encodeURIComponent(a.query ?? "")}`)
      break
    case "click":
      await b.clickTp(id)
      break
    case "type":
      await b.typeTp(id, a.text ?? "")
      if (a.submit) await b.press("Enter")
      break
    case "select":
      await b.selectTp(id, a.text ?? "")
      break
    case "press":
      await b.press(a.key || "Enter")
      break
    case "scroll":
      await b.scroll(a.direction === "up" ? -700 : 700)
      break
    case "back":
      await b.back()
      break
    case "wait":
      await b.settle(6000)
      break
    default:
      throw new Error(`Unknown action "${a.action}"`)
  }
}

// Each free Gemini model has its own daily quota, so we cascade through several
// fast models. Models that run out are skipped for the rest of this run.
const MODEL_CHAIN = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
  "gemini-flash-latest",
]
const exhausted = new Set<string>()

async function callGemini(key: string, prompt: string, imageB64?: string): Promise<AgentAction> {
  const chain = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL, ...MODEL_CHAIN] : MODEL_CHAIN
  const parts: any[] = [{ text: prompt }]
  if (imageB64) parts.push({ inline_data: { mime_type: "image/jpeg", data: imageB64 } })
  const makeBody = (thinking: boolean) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
        ...(thinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
      },
    })
  // Two passes over the chain, with a short pause between them for per-minute limits.
  const attempts: [string, number][] = [
    ...chain.map((m): [string, number] => [m, 0]),
    ["__wait__", 8000],
    ...chain.map((m): [string, number] => [m, 0]),
  ]
  let lastErr = ""
  for (const [model, w] of attempts) {
    if (model === "__wait__") {
      await sleepMs(w)
      continue
    }
    if (exhausted.has(model)) continue
    const res = await geminiRequest(key, model, makeBody(true))
    if (!res) {
      lastErr = "Gemini took too long"
      continue
    }
    let json: any = null
    try {
      json = await res.json()
    } catch {}
    if (res.status === 429) {
      const daily = JSON.stringify(json ?? "").includes("PerDay")
      if (daily) exhausted.add(model)
      lastErr = daily ? "Today's free Gemini quota is used up" : "Gemini is busy (429)"
      continue
    }
    if (res.status === 404 || res.status >= 500) {
      if (res.status === 404) exhausted.add(model)
      lastErr = `Gemini is busy (${res.status})`
      continue
    }
    if (res.status === 400 && /thinking/i.test(JSON.stringify(json ?? ""))) {
      // Model doesn't accept thinking settings; retry it once without them.
      const r2 = await geminiRequest(key, model, makeBody(false))
      if (!r2 || !r2.ok) continue
      json = await r2.json()
    } else if (!res.ok) {
      throw new Error(`Gemini error: ${json?.error?.message ?? res.status}`)
    }
    const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? ""
    try {
      const parsed = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim())
      return Array.isArray(parsed) ? parsed[0] : parsed
    } catch {
      return { action: "done", message: text || "I couldn't work out the next step." }
    }
  }
  throw new Error(`${lastErr} — try again in a minute, or tomorrow if the daily free quota ran out.`)
}

async function geminiRequest(key: string, model: string, body: string): Promise<Response | null> {
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    return null
  }
}
