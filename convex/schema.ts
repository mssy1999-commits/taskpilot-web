import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  threads: defineTable({
    title: v.string(),
    status: v.union(v.literal("idle"), v.literal("running"), v.literal("waiting")),
    stopRequested: v.boolean(),
    currentUrl: v.optional(v.string()),
    screenshot: v.optional(v.string()), // latest page screenshot, data URL
    storageState: v.optional(v.string()), // cookies so sign-ins survive between messages
    updatedAt: v.number(),
    // "Your turn" mode: the user drives the live browser by tapping the screenshot
    handoff: v.optional(v.boolean()),
    handoffUntil: v.optional(v.number()),
    handoffMessage: v.optional(v.string()),
    controlRequested: v.optional(v.boolean()),
  }).index("by_updated", ["updatedAt"]),

  messages: defineTable({
    threadId: v.id("threads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
  }).index("by_thread", ["threadId"]),

  steps: defineTable({
    threadId: v.id("threads"),
    thought: v.string(),
    action: v.string(),
    url: v.optional(v.string()),
    ok: v.boolean(),
  }).index("by_thread", ["threadId"]),

  inputs: defineTable({
    threadId: v.id("threads"),
    kind: v.union(
      v.literal("tap"),
      v.literal("type"),
      v.literal("key"),
      v.literal("scroll"),
      v.literal("done"),
    ),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    text: v.optional(v.string()),
  }).index("by_thread", ["threadId"]),
})
