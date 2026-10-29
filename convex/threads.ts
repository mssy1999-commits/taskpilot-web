import { v } from "convex/values"
import { mutation, query, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"

// Optional passcode: set APP_PASSCODE in the Convex dashboard so only you can use the app.
function allowed(pass?: string) {
  const p = process.env.APP_PASSCODE
  return !p || pass === p
}
const pass = v.optional(v.string())

const inputKind = v.union(
  v.literal("tap"),
  v.literal("type"),
  v.literal("key"),
  v.literal("scroll"),
  v.literal("done"),
)

export const access = query({
  args: { pass },
  handler: async (_ctx, a) => ({
    required: !!process.env.APP_PASSCODE,
    ok: allowed(a.pass),
  }),
})

export const list = query({
  args: { pass },
  handler: async (ctx, a) => {
    if (!allowed(a.pass)) return []
    const threads = await ctx.db.query("threads").withIndex("by_updated").order("desc").take(30)
    return threads.map((t) => ({
      _id: t._id,
      title: t.title,
      status: t.status,
      updatedAt: t.updatedAt,
    }))
  },
})

export const get = query({
  args: { threadId: v.id("threads"), pass },
  handler: async (ctx, { threadId, pass }) => {
    if (!allowed(pass)) return null
    const thread = await ctx.db.get(threadId)
    if (!thread) return null
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect()
    const steps = await ctx.db
      .query("steps")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .take(60)
    return {
      _id: thread._id,
      title: thread.title,
      status: thread.status,
      currentUrl: thread.currentUrl,
      screenshot: thread.screenshot,
      handoff: !!thread.handoff,
      handoffUntil: thread.handoffUntil,
      handoffMessage: thread.handoffMessage,
      controlRequested: !!thread.controlRequested,
      messages,
      steps: steps.reverse(),
    }
  },
})

export const send = mutation({
  args: { threadId: v.optional(v.id("threads")), text: v.string(), pass },
  handler: async (ctx, { threadId, text, pass }) => {
    if (!allowed(pass)) return { ok: false as const, error: "Wrong passcode" }
    const clean = text.trim().slice(0, 4000)
    if (!clean) return { ok: false as const, error: "Empty message" }
    let id = threadId
    if (id) {
      const t = await ctx.db.get(id)
      if (!t) return { ok: false as const, error: "Chat not found" }
      if (t.status === "running") return { ok: false as const, error: "Still working — stop it first" }
      await ctx.db.patch(id, { status: "running", stopRequested: false, updatedAt: Date.now() })
    } else {
      id = await ctx.db.insert("threads", {
        title: clean.slice(0, 60),
        status: "running",
        stopRequested: false,
        updatedAt: Date.now(),
      })
    }
    await ctx.db.insert("messages", { threadId: id, role: "user", text: clean })
    await ctx.scheduler.runAfter(0, internal.agent.run, { threadId: id })
    return { ok: true as const, threadId: id }
  },
})

export const stop = mutation({
  args: { threadId: v.id("threads"), pass },
  handler: async (ctx, { threadId, pass }) => {
    if (!allowed(pass)) return
    const t = await ctx.db.get(threadId)
    if (t && t.status === "running") await ctx.db.patch(threadId, { stopRequested: true })
  },
})

export const remove = mutation({
  args: { threadId: v.id("threads"), pass },
  handler: async (ctx, { threadId, pass }) => {
    if (!allowed(pass)) return
    const t = await ctx.db.get(threadId)
    if (!t || t.status === "running") return
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect()
    for (const r of msgs) await ctx.db.delete(r._id)
    const steps = await ctx.db
      .query("steps")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect()
    for (const r of steps) await ctx.db.delete(r._id)
    const inputs = await ctx.db
      .query("inputs")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect()
    for (const r of inputs) await ctx.db.delete(r._id)
    await ctx.db.delete(threadId)
  },
})

// ---- Take control: the user drives the live browser ----

export const requestControl = mutation({
  args: { threadId: v.id("threads"), pass },
  handler: async (ctx, { threadId, pass }) => {
    if (!allowed(pass)) return
    const t = await ctx.db.get(threadId)
    if (!t || t.status !== "running" || t.handoff) return
    await ctx.db.patch(threadId, { controlRequested: true })
  },
})

export const sendInput = mutation({
  args: {
    threadId: v.id("threads"),
    kind: inputKind,
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    text: v.optional(v.string()),
    pass,
  },
  handler: async (ctx, { threadId, kind, x, y, text, pass }) => {
    if (!allowed(pass)) return { ok: false as const }
    const t = await ctx.db.get(threadId)
    if (!t || !t.handoff) return { ok: false as const }
    const clamp = (n?: number) => (n === undefined ? undefined : Math.min(Math.max(n, 0), 1))
    await ctx.db.insert("inputs", { threadId, kind, x: clamp(x), y: clamp(y), text: text?.slice(0, 500) })
    return { ok: true as const }
  },
})

// ---- internal helpers used by the agent action ----

export const context = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId)
    if (!thread) return null
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect()
    return {
      currentUrl: thread.currentUrl,
      storageState: thread.storageState,
      messages: messages.slice(-20).map((m) => ({ role: m.role, text: m.text })),
    }
  },
})

export const flags = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const t = await ctx.db.get(threadId)
    return { stop: !t || t.stopRequested, control: !!t?.controlRequested }
  },
})

export const takeInputs = internalMutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const rows = await ctx.db
      .query("inputs")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .take(20)
    for (const r of rows) await ctx.db.delete(r._id)
    const t = await ctx.db.get(threadId)
    return {
      inputs: rows.map((r) => ({ kind: r.kind, x: r.x, y: r.y, text: r.text })),
      stop: !t || t.stopRequested,
    }
  },
})

export const setHandoff = internalMutation({
  args: {
    threadId: v.id("threads"),
    on: v.boolean(),
    until: v.optional(v.number()),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { threadId, on, until, message }) => {
    await ctx.db.patch(threadId, {
      handoff: on,
      handoffUntil: on ? until : undefined,
      handoffMessage: on ? message : undefined,
      controlRequested: false,
      updatedAt: Date.now(),
    })
    if (!on) {
      const rows = await ctx.db
        .query("inputs")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .collect()
      for (const r of rows) await ctx.db.delete(r._id)
    }
  },
})

export const setScreenshot = internalMutation({
  args: { threadId: v.id("threads"), screenshot: v.string(), url: v.optional(v.string()) },
  handler: async (ctx, { threadId, screenshot, url }) => {
    await ctx.db.patch(threadId, url ? { screenshot, currentUrl: url } : { screenshot })
  },
})

export const addStep = internalMutation({
  args: {
    threadId: v.id("threads"),
    thought: v.string(),
    action: v.string(),
    url: v.optional(v.string()),
    ok: v.boolean(),
    screenshot: v.optional(v.string()),
  },
  handler: async (ctx, { screenshot, ...step }) => {
    await ctx.db.insert("steps", step)
    await ctx.db.patch(step.threadId, {
      updatedAt: Date.now(),
      ...(step.url ? { currentUrl: step.url } : {}),
      ...(screenshot ? { screenshot } : {}),
    })
  },
})

export const finish = internalMutation({
  args: {
    threadId: v.id("threads"),
    text: v.string(),
    waiting: v.boolean(),
    currentUrl: v.optional(v.string()),
    storageState: v.optional(v.string()),
    screenshot: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("messages", { threadId: a.threadId, role: "assistant", text: a.text })
    await ctx.db.patch(a.threadId, {
      status: a.waiting ? "waiting" : "idle",
      stopRequested: false,
      handoff: false,
      handoffUntil: undefined,
      handoffMessage: undefined,
      controlRequested: false,
      updatedAt: Date.now(),
      ...(a.currentUrl ? { currentUrl: a.currentUrl } : {}),
      ...(a.storageState !== undefined ? { storageState: a.storageState } : {}),
      ...(a.screenshot ? { screenshot: a.screenshot } : {}),
    })
  },
})
