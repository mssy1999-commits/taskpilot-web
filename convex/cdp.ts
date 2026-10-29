"use node"

// Minimal Chrome DevTools Protocol client for a remote cloud browser (e.g. Browserless).
import WebSocket from "ws"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Tab: { code: "Tab", vk: 9 },
  Escape: { code: "Escape", vk: 27 },
  Backspace: { code: "Backspace", vk: 8 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  Space: { code: "Space", vk: 32, text: " " },
}

export class RemoteBrowser {
  private ws!: WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private sessionId = ""
  closed = false
  viewport = { width: 1280, height: 800, mobile: false }

  static async connect(endpoint: string): Promise<RemoteBrowser> {
    const b = new RemoteBrowser()
    await b.open(endpoint)
    return b
  }

  private open(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint, { handshakeTimeout: 30_000, maxPayload: 64 * 1024 * 1024 })
      this.ws = ws
      const t = setTimeout(() => reject(new Error("Cloud browser connection timed out")), 35_000)
      ws.on("open", () => {
        clearTimeout(t)
        resolve()
      })
      ws.on("error", (e) => {
        clearTimeout(t)
        reject(new Error(`Cloud browser connection failed: ${e.message}`))
      })
      ws.on("unexpected-response", (_req, res) => {
        clearTimeout(t)
        reject(new Error(`Cloud browser refused the connection (HTTP ${res.statusCode}) — check the token`))
      })
      ws.on("message", (raw) => {
        let msg: any
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          return
        }
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message))
          else p.resolve(msg.result)
        }
      })
      ws.on("close", () => {
        this.closed = true
        for (const p of this.pending.values()) p.reject(new Error("Cloud browser disconnected"))
        this.pending.clear()
      })
    })
  }

  send(method: string, params: any = {}, session = true, timeoutMs = 30_000): Promise<any> {
    if (this.closed) return Promise.reject(new Error("Cloud browser disconnected"))
    const id = this.nextId++
    const payload: any = { id, method, params }
    if (session && this.sessionId) payload.sessionId = this.sessionId
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(t)
          reject(e)
        },
      })
      this.ws.send(JSON.stringify(payload))
    })
  }

  async newPage(cookies?: any[]) {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" }, false)
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true }, false)
    this.sessionId = sessionId
    await this.send("Page.enable")
    await this.send("Network.enable")
    await this.setViewport("desktop")
    // Keep everything in one tab: popups and new windows open in the current page.
    await this.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.open = function(u){ if(u) location.href = u; return window; };`,
    })
    if (cookies?.length) {
      try {
        await this.send("Network.setCookies", { cookies })
      } catch {}
    }
  }

  /** Desktop layout for the agent; phone-sized layout while the user is in control. */
  async setViewport(mode: "desktop" | "phone") {
    this.viewport =
      mode === "phone"
        ? { width: 400, height: 760, mobile: true }
        : { width: 1280, height: 800, mobile: false }
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: this.viewport.width,
      height: this.viewport.height,
      deviceScaleFactor: 1,
      mobile: this.viewport.mobile,
    })
    try {
      await this.send("Emulation.setTouchEmulationEnabled", { enabled: this.viewport.mobile })
    } catch {}
  }

  /** Click at a fraction (0–1) of the visible viewport — used for the user's taps. */
  async clickAt(nx: number, ny: number) {
    const x = Math.round(Math.min(Math.max(nx, 0), 1) * this.viewport.width)
    const y = Math.round(Math.min(Math.max(ny, 0), 1) * this.viewport.height)
    await this.mouseClick(x, y)
  }

  private async mouseClick(x: number, y: number) {
    const base = { x, y, button: "left", clickCount: 1 }
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base })
    await sleep(50)
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base })
  }

  async insertText(text: string) {
    await this.send("Input.insertText", { text })
  }

  async eval<T = any>(expression: string, timeoutMs = 15_000): Promise<T> {
    const r = await this.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      true,
      timeoutMs,
    )
    if (r?.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? "Script error")
    return r?.result?.value as T
  }

  async settle(maxMs = 8000) {
    await sleep(450)
    const start = Date.now()
    while (Date.now() - start < maxMs) {
      try {
        const s = await this.eval<string>("document.readyState", 3000)
        if (s === "complete") break
        if (s === "interactive" && Date.now() - start > 1500) break
      } catch {}
      await sleep(250)
    }
    await sleep(200)
  }

  async goto(url: string) {
    const r = await this.send("Page.navigate", { url }, true, 30_000)
    if (r?.errorText) throw new Error(`Could not open page: ${r.errorText}`)
    await this.settle(12_000)
  }

  async back() {
    const h = await this.send("Page.getNavigationHistory")
    if (h.currentIndex > 0) {
      await this.send("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex - 1].id })
      await this.settle()
    }
  }

  async clickTp(id: number) {
    const pos = await this.eval<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector('[data-tp="${id}"]');
      if (!el) return null;
      const a = el.closest('a'); if (a) a.removeAttribute('target');
      el.scrollIntoView({block:'center', inline:'center'});
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2 };
    })()`)
    if (!pos) throw new Error(`Element [${id}] not found on the page anymore`)
    await sleep(80)
    await this.mouseClick(pos.x, pos.y)
    await this.settle()
  }

  async typeTp(id: number, text: string) {
    const ok = await this.eval<boolean>(`(() => {
      const el = document.querySelector('[data-tp="${id}"]');
      if (!el) return false;
      el.scrollIntoView({block:'center'});
      el.focus();
      if ('value' in el) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter ? setter.call(el, '') : (el.value = '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (el.isContentEditable) {
        document.execCommand('selectAll', false); document.execCommand('delete', false);
      }
      return true;
    })()`)
    if (!ok) throw new Error(`Element [${id}] not found on the page anymore`)
    await this.send("Input.insertText", { text })
    await this.eval(
      `(() => { const el = document.querySelector('[data-tp="${id}"]'); el && el.dispatchEvent(new Event('change', { bubbles: true })); })()`,
    )
    await sleep(120)
  }

  /**
   * Choose an option in a dropdown in ONE move: native <select> elements are set
   * directly; custom dropdowns (Instagram, Google, React UIs) are opened and the
   * option with the matching text is clicked.
   */
  async selectTp(id: number, label: string) {
    const want = JSON.stringify(label.trim().toLowerCase())
    const native = await this.eval<string>(`(() => {
      const el = document.querySelector('[data-tp="${id}"]');
      if (!el) return 'missing';
      if (el.tagName !== 'SELECT') return 'custom';
      const want = ${want};
      const norm = s => s.trim().toLowerCase();
      const num = s => (/^\\d+$/.test(s.trim()) ? String(parseInt(s, 10)) : null);
      const opts = Array.from(el.options);
      const opt = opts.find(o => norm(o.text) === want || norm(o.value) === want) ||
                  (num(want) && opts.find(o => num(o.text) === num(want) || num(o.value) === num(want))) ||
                  opts.find(o => norm(o.text).startsWith(want)) ||
                  opts.find(o => norm(o.text).includes(want));
      if (!opt) return 'nomatch';
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter ? setter.call(el, opt.value) : (el.value = opt.value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`)
    if (native === "ok") {
      await sleep(200)
      return
    }
    if (native === "missing") throw new Error(`Element [${id}] not found on the page anymore`)
    if (native === "nomatch") throw new Error(`No option "${label}" in [${id}]`)

    // Custom dropdown: open it, then click the option whose text matches.
    await this.clickTp(id)
    const findOption = `(() => {
      const want = ${want};
      const trigger = document.querySelector('[data-tp="${id}"]');
      const norm = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const num = s => (/^\\d+$/.test(s) ? String(parseInt(s, 10)) : null);
      const cands = [];
      for (const el of document.querySelectorAll('[role=option],[role=menuitem],[role=menuitemradio],li,option,div,span,a,button')) {
        if (trigger && (trigger === el || trigger.contains(el))) continue;
        if (el.children.length > 3) continue;
        const t = norm(el.innerText);
        if (!t || t.length > 40) continue;
        const exact = t === want || (num(want) && num(t) === num(want));
        const starts = !exact && t.startsWith(want);
        if (!exact && !starts) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none') continue;
        const role = el.getAttribute('role') || '';
        cands.push({ el, score: (exact ? 0 : 1000) + (/option|menuitem/.test(role) ? 0 : 100) + Math.min(r.width * r.height, 99999) / 1000 });
      }
      cands.sort((a, b) => a.score - b.score);
      const best = cands[0] && cands[0].el;
      if (!best) return null;
      best.scrollIntoView({ block: 'center' });
      const r = best.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`
    let pos = await this.eval<{ x: number; y: number } | null>(findOption)
    if (!pos) {
      // Some dropdowns filter as you type.
      await this.send("Input.insertText", { text: label })
      await sleep(400)
      pos = await this.eval<{ x: number; y: number } | null>(findOption)
    }
    if (!pos) throw new Error(`Opened [${id}] but couldn't find "${label}" in the list`)
    await sleep(120)
    await this.mouseClick(pos.x, pos.y)
    await sleep(350)
  }

  async press(key: string) {
    const k = KEYS[key] ?? {
      code: key,
      vk: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
      text: key.length === 1 ? key : undefined,
    }
    const common = {
      key: key === "Space" ? " " : key,
      code: k.code,
      windowsVirtualKeyCode: k.vk,
      nativeVirtualKeyCode: k.vk,
    }
    await this.send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...common, text: k.text })
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...common })
    await this.settle()
  }

  async scroll(dy: number) {
    await this.eval(`window.scrollBy(0, ${dy})`)
    await sleep(350)
  }

  async screenshot(): Promise<string | undefined> {
    try {
      // Downscaled screenshot of the visible area: faster to capture, upload and analyse.
      const vp = await this.eval<{ x: number; y: number }>("({ x: scrollX, y: scrollY })", 3000).catch(
        () => ({ x: 0, y: 0 }),
      )
      const { width, height, mobile } = this.viewport
      const r = await this.send(
        "Page.captureScreenshot",
        { format: "jpeg", quality: 50, clip: { x: vp.x, y: vp.y, width, height, scale: mobile ? 1 : 0.6 } },
        true,
        15_000,
      )
      return r?.data
    } catch {
      return undefined
    }
  }

  async cookies(): Promise<any[]> {
    try {
      const r = await this.send("Network.getAllCookies")
      return r?.cookies ?? []
    } catch {
      return []
    }
  }

  close() {
    try {
      this.ws.close()
    } catch {}
  }
}
