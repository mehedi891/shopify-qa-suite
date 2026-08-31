# Coverage — What the Tool Can Reach

Written to answer one question: *is anything in our app untestable?*

**Short answer: no.** Everything the app renders or does in a browser is
reachable. Some categories need specific plumbing rather than a plain click, and
this document names each one and the mechanism for it, so nothing is discovered
late.

---

## 1. The governing principle

Playwright drives a real Chromium over the DevTools Protocol. It is not script
injected into the page, so it is not confined by the page's own boundaries. That
means:

- **Every frame** in the tab is addressable — the admin host frame, our app's
  iframe, and any iframe nested inside those, cross-origin or not.
- **Every browser-level event** is interceptable — dialogs, downloads, uploads,
  popups, permissions, network.
- **Open shadow DOM is pierced automatically** by CSS and role locators, which
  matters because App Bridge ships web components.

There is no category of "the automation can't see this" in a browser context.
What varies is how much plumbing a given interaction needs.

## 2. Shopify admin UI

| Thing | Renders in | How it's tested |
|---|---|---|
| Our app's own UI (Polaris, React) | app iframe | `appLocator()` — normal locators |
| Polaris `<Modal>`, `<Toast>` in our tree | app iframe | `appLocator()` |
| App Bridge `ui-modal` (inline content) | chrome in host, content projected from app | `hostLocator()` for the chrome and action buttons, `appLocator()` for the body |
| App Bridge `ui-modal src="/route"` | **nested iframe** | `hostLocator().frameLocator(...)` — chains one level deeper |
| App Bridge `ui-save-bar` / contextual save bar | host | `hostLocator()` |
| App Bridge `ui-nav-menu` | host (app nav) | `hostLocator()` |
| `shopify.toast.show()` | host | `hostLocator()` |
| Resource picker (`shopify.resourcePicker`) | host overlay / nested frame | `hostLocator()`, picker items by role+text |
| Admin chrome (store switcher, top bar) | host | `hostLocator()` — rarely needed; we test our app |

**How the engine decides.** The step author writes `click "Save"` and says nothing
about frames. The resolver tries the app frame, then the host frame, then any
nested frames, and caches which one won alongside the locator. After the first
run it goes straight to the right frame — no searching, no ambiguity.

For anything genuinely awkward, there is a direct escape hatch:

```
click "Save" in host
expect modal "Confirm deletion" in host
```

## 3. Browser-level interactions

All supported; each is a step verb rather than something to work around.

| Interaction | Mechanism | Step syntax |
|---|---|---|
| `alert` / `confirm` / `prompt` | `page.on('dialog')` | `accept the dialog` / `dismiss the dialog` |
| File upload | `setInputFiles` (works on hidden inputs) | `upload "fixtures/logo.png" to "Logo"` |
| File download (CSV export) | `page.waitForEvent('download')` | `download and expect the file to contain "SKU"` |
| New tab / popup (OAuth, billing) | `context.on('page')` | `switch to the new tab` |
| Clipboard | context permissions `clipboard-read/write` | `expect the clipboard to contain "..."` |
| Drag and drop (reordering blocks) | `dragTo()` / manual mouse steps | `drag "Block A" to "Block B"` |
| Keyboard-only flows, focus order | `page.keyboard` | `press "Tab"` / `press "Enter"` |
| Hover-revealed UI, tooltips | `hover()` | `hover "Info icon"` |
| Scroll / lazy-loaded content | auto-scroll on interaction | handled implicitly |
| Fullscreen, viewport size | context options | `set viewport to mobile` |

## 4. State and environment control

Testing "everything" includes states that are hard to reach by clicking. These
are first-class, not afterthoughts:

| Need | Mechanism |
|---|---|
| **Error states** (API 500, timeout) | `page.route()` — intercept the app's own API calls and force a failure. Lets us test the error UI without breaking the backend. |
| **Empty / loading states** | Same route interception: delay or return empty payloads. |
| **Time-dependent behaviour** (trials, expiry) | `page.clock` — mock the browser clock forward. |
| **Locale / currency / timezone** | Context options per test case. |
| **Slow network** | CDP network throttling. |
| **A specific merchant plan tier** | Fixture setup + route interception of the billing check. |

This is the answer to "some states are impossible to reach by clicking through the
UI" — we don't click to them, we put the browser in them.

## 5. Storefront

| Thing | How |
|---|---|
| Theme app extension block rendering | Located by block wrapper / extension root id, not theme CSS |
| Widget behaviour (JS interactions) | Normal locators + assertions |
| Multiple themes | Same case run against each configured theme |
| Mobile viewport | Context viewport per case |
| Cart / checkout entry | Real navigation; use a Bogus Gateway on the dev store for test orders |
| Storefront password page | Bypassed once per context |

## 6. Categories that need extra infrastructure

Being honest: these are all achievable, but they are not free. Each is a small
project of its own, so they are staged rather than assumed.

| Category | What it needs | Stage |
|---|---|---|
| **Email flows** (verification, notification emails) | A test-mailbox API (Mailosaur / MailSlurp) polled as an assertion step: `expect an email to "x" containing "y"`. Needs an account and a step verb. | Phase 5+ |
| **Checkout completion** | Bogus Gateway on the dev store. Shopify actively resists automated checkout; expect this to be the flakiest area and budget for it. | Phase 5+ |
| **Billing / subscription approval** | Shopify billing test mode; the approval screen is a Shopify-hosted popup — reachable via `context.on('page')`. | Phase 5+ |
| **Webhook delivery** | A receiver endpoint the suite can poll (ngrok/local server), asserted as a step rather than through the UI. | Phase 5+ |
| **Visual/pixel correctness** | Screenshot diffing (`toHaveScreenshot`). Deliberately out of v1 — it is a different discipline with its own flake profile, not a gap in reachability. | Post-v1 |
| **Canvas / WebGL content** | Not assertable as DOM; needs pixel diffing or a JS state hook. Only relevant if we render one. | If needed |
| **Native mobile app (Shopify Mobile)** | Genuinely out of reach for a browser tool. Would need Appium. | Out of scope |

## 7. The two real constraints

Everything above is solvable. These two are worth stating plainly because they
are properties of the environment, not of the tool:

1. **Closed shadow DOM.** Playwright pierces *open* shadow roots automatically.
   If a third-party web component uses a *closed* root, its internals are not
   queryable — by anything, by design. Workaround: assert via the component's own
   JS API through `page.evaluate` instead of its DOM. *Needs verifying against
   App Bridge's components in Phase 1; expected to be open, but confirm rather
   than assume.*

2. **Bot protection.** Shopify may challenge automated traffic on login and
   checkout. Mitigated by a dedicated dev store, a real reused session rather
   than repeated logins, and Bogus Gateway. This is the most likely source of
   irreducible flake and the reason checkout tests are staged separately.

## 8. What this means for Phase 1

The Phase 1 spike now has an explicit checklist. Ten minutes with a headed
browser and devtools on the real store answers all of it:

- [ ] Confirm the app iframe `src` pattern
- [ ] Open an App Bridge `ui-modal` — note which frame the chrome and body land in
- [ ] Trigger `shopify.toast.show()` — confirm it is reachable from `hostLocator()`
- [ ] Open a `ui-save-bar` — confirm reachable
- [ ] Inspect an App Bridge web component for open vs closed shadow root
- [ ] Open the resource picker — confirm items are addressable

Any surprise here is a one-file change in `AdminSurface`, not a design change.
