window.__ModuleLoader__.load({
	id: "dsh-zhihu-dashboard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/locales.ts
		const NS = "zhihu-dashboard";
		const zh = { "tab.label": "知乎" };
		const en = { "tab.label": "Zhihu" };
		//#endregion
		//#region src/client/track-checker.ts
		/**
		* Background track checker running in the DSH top window (not the panel
		* iframe), so tracking reminders work whenever the user is using DSH —
		* regardless of whether the panel drawer is open.
		*
		* State lives in localStorage (shared same-origin with the panel iframe):
		* - zhihu.tracks    : the track list with per-track `seen` ContentID sets
		* - zhihu.secret    : Access Secret (sent as x-zhihu-secret header)
		* - zhihu.trackInterval : minutes between checks (0 = off)
		* - zhihu.trackNotify   : whether to fire system notifications
		* - zhihu.autoBrief     : whether to auto-distill briefs (zhida)
		* - zhihu.unread    : running unread counter for the sidebar badge
		* - zhihu.blockKeywords / blockAuthors / blockRegex: browser-local filters honored before NEW notifications
		*/
		const KEYS = {
			tracks: "zhihu.tracks",
			secret: "zhihu.secret",
			trackInterval: "zhihu.trackInterval",
			trackNotify: "zhihu.trackNotify",
			autoBrief: "zhihu.autoBrief",
			unread: "zhihu.unread",
			unreadItems: "zhihu.unreadItems",
			blockKeywords: "zhihu.blockKeywords",
			blockAuthors: "zhihu.blockAuthors",
			blockRegex: "zhihu.blockRegex"
		};
		function lsGet(key) {
			try {
				return localStorage.getItem(key);
			} catch {
				return null;
			}
		}
		function lsSet(key, value) {
			try {
				localStorage.setItem(key, value);
			} catch {}
		}
		function linesOf(value) {
			return String(value ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
		}
		function filterTextOf(item) {
			return [
				item.title,
				item.summary,
				item.author,
				item.trackQuery
			].filter(Boolean).join("\n");
		}
		function isFiltered(item) {
			const text = filterTextOf(item);
			const lower = text.toLowerCase();
			for (const author of linesOf(lsGet(KEYS.blockAuthors))) if (item.author && String(item.author).trim() === author) return true;
			for (const keyword of linesOf(lsGet(KEYS.blockKeywords))) if (lower.includes(keyword.toLowerCase())) return true;
			for (const pattern of linesOf(lsGet(KEYS.blockRegex))) try {
				if (new RegExp(pattern, "i").test(text)) return true;
			} catch {}
			return false;
		}
		function readTracks() {
			try {
				const raw = lsGet(KEYS.tracks);
				const list = raw === null ? [] : JSON.parse(raw);
				return Array.isArray(list) ? list : [];
			} catch {
				return [];
			}
		}
		function writeTracks(list) {
			lsSet(KEYS.tracks, JSON.stringify(list));
		}
		/** Read the unread feed (newest first). */
		function readUnreadItems() {
			try {
				const raw = lsGet(KEYS.unreadItems);
				const list = raw === null ? [] : JSON.parse(raw);
				return Array.isArray(list) ? list : [];
			} catch {
				return [];
			}
		}
		/** Queue new items into the unread feed, deduped by cid, capped at 100. */
		function appendUnreadItems(track, fresh) {
			const existing = readUnreadItems();
			const seen = new Set(existing.map((i) => i.cid));
			const now = Date.now();
			for (const it of fresh) {
				if (it.cid === "" || seen.has(it.cid)) continue;
				seen.add(it.cid);
				existing.push({
					trackQuery: track.query,
					title: it.title,
					url: it.url,
					author: it.author,
					summary: it.summary,
					cid: it.cid,
					foundAt: now
				});
			}
			existing.sort((a, b) => b.foundAt - a.foundAt);
			lsSet(KEYS.unreadItems, JSON.stringify(existing.slice(0, 100)));
		}
		/** One check round: search every tracked query, diff ContentIDs, persist. */
		async function checkAllTracks() {
			const tracks = readTracks();
			if (tracks.length === 0) return {
				totalNew: 0,
				perTrack: []
			};
			const secret = lsGet(KEYS.secret) ?? "";
			if (!secret) return {
				totalNew: 0,
				perTrack: []
			};
			const autoBrief = lsGet(KEYS.autoBrief) === "1";
			const perTrack = [];
			let totalNew = 0;
			for (const track of tracks) {
				const newCount = await checkOne(track, secret, autoBrief);
				if (newCount > 0) perTrack.push({
					query: track.query,
					count: newCount
				});
				totalNew += newCount;
			}
			return {
				totalNew,
				perTrack
			};
		}
		async function checkOne(track, secret, autoBrief) {
			const before = new Set(Object.keys(track.seen ?? {}));
			const isFirstCheck = before.size === 0;
			let payload;
			try {
				const headers = { "x-zhihu-secret": secret };
				if (track.questionId && track.query) payload = await fetch(`/zhihu-dashboard/api/answers?q=${encodeURIComponent(track.questionId)}&title=${encodeURIComponent(track.query)}&count=10`, {
					headers,
					cache: "no-store"
				}).then((r) => r.json());
				else payload = await fetch(`/zhihu-dashboard/api/learn?q=${encodeURIComponent(track.query)}&count=10`, {
					headers,
					cache: "no-store"
				}).then((r) => r.json());
			} catch {
				return 0;
			}
			if (payload?.ok !== true || !Array.isArray(payload.Data?.Items)) return 0;
			let items = payload.Data.Items;
			if (track.type === "person") {
				const name = String(track.query ?? "").trim();
				items = items.filter((it) => String(it.AuthorName ?? "").trim() === name);
			}
			const normalizedItems = items.map((it) => ({
				title: it.Title ?? "",
				url: it.Url ?? "",
				author: it.AuthorName ?? "",
				summary: it.ContentText ?? "",
				cid: String(it.ContentID ?? ""),
				isNew: !isFirstCheck && !before.has(String(it.ContentID ?? ""))
			}));
			const lastItems = normalizedItems.filter((it) => !isFiltered(it));
			const seenNow = {};
			for (const it of normalizedItems) {
				const cid = String(it.cid ?? "");
				if (cid) seenNow[cid] = true;
			}
			let newCount = lastItems.filter((it) => it.isNew).length;
			if (isFirstCheck) newCount = 0;
			const list = readTracks();
			const cur = list.find((t) => t.id === track.id);
			if (cur) {
				cur.seen = {
					...cur.seen ?? {},
					...seenNow
				};
				cur.checkedAt = Date.now();
				cur.lastNew = newCount;
				cur.lastItems = lastItems;
				writeTracks(list);
				if (!isFirstCheck && newCount > 0) appendUnreadItems(track, lastItems.filter((it) => it.isNew));
			}
			if (newCount > 0 && autoBrief && cur?.lastItems) {
				const fresh = cur.lastItems.filter((it) => it.isNew).slice(0, 5);
				if (fresh.length > 0) {
					const brief = await distillBrief(track, fresh, secret);
					const again = readTracks().find((t) => t.id === track.id);
					if (again) {
						const now = Date.now();
						again.brief = brief;
						again.briefAt = now;
						again.briefs = [...again.briefs ?? [], {
							text: brief,
							at: now
						}].slice(-10);
						writeTracks(readTracks());
					}
				}
			}
			return newCount;
		}
		async function distillBrief(track, items, secret) {
			const subjects = items.map((it) => `- ${it.title}（${it.author || "匿名"}）\n  ${String(it.summary ?? "").slice(0, 200)}`).join("\n");
			const prompt = `追踪主题「${track.query}」发现了这些新内容：\n${subjects}\n\n请生成一份"创意简报"：\n1. 新增内容概览（谁在聊什么）\n2. 其中有价值的想法/创意点\n3. 可以产品化/做成的应用方向\n简明扼要，用中文。`;
			try {
				const payload = await fetch(`/zhihu-dashboard/api/analyze?q=${encodeURIComponent(prompt)}&model=thinking`, {
					headers: { "x-zhihu-secret": secret },
					cache: "no-store"
				}).then((r) => r.json());
				if (payload?.ok !== true) return `（自动简报失败：${payload?.error ?? "直答不可用"}）`;
				return payload?.choices?.[0]?.message?.content ?? payload?.content ?? payload?.Answer ?? "（直答未返回内容）";
			} catch (error) {
				return `（自动简报失败：${error?.message ?? error}）`;
			}
		}
		/** Fire a system notification and bump the unread counter. */
		function notifyNew(total, perTrack) {
			const prev = Number(lsGet(KEYS.unread) ?? "0") || 0;
			lsSet(KEYS.unread, String(prev + total));
			if (lsGet(KEYS.trackNotify) !== "1") return;
			const body = `${perTrack.slice(0, 3).map((t) => `${t.query}: ${t.count} 条`).join("\n")}${perTrack.length > 3 ? `\n…共 ${total} 条` : ""}`;
			try {
				if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("知乎追踪有新内容", {
					body,
					tag: "zhihu-track"
				});
				else if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
			} catch {}
		}
		/** Run one background check round; returns the new-count summary. */
		async function runTrackCheck() {
			const { totalNew, perTrack } = await checkAllTracks();
			if (totalNew > 0) notifyNew(totalNew, perTrack);
			return { totalNew };
		}
		/** Start (or restart) the interval timer from zhihu.trackInterval. */
		function startTrackTimer() {
			const minutes = Number(lsGet(KEYS.trackInterval) ?? "0") || 0;
			if (minutes <= 0) return () => {};
			const id = setInterval(() => {
				runTrackCheck();
			}, minutes * 60 * 1e3);
			return () => clearInterval(id);
		}
		//#endregion
		//#region src/client/ZhihuLauncher.tsx
		/**
		* Zhihu dashboard launcher: an official-sidebar foot button
		* (sidebar.footer.action) that opens a right-hand drawer registered as its
		* own shell.overlay entry. The two slots are separate registrations —
		* embedding the overlay inside the button component would render it inside
		* the sidebar footer's DOM (zero-size). A tiny module store coordinates
		* open/close between them.
		*/
		const PANEL_PATH = "/zhihu-dashboard";
		const UNREAD_KEY = "zhihu.unread";
		let panelOpen = false;
		const listeners = /* @__PURE__ */ new Set();
		function setPanelOpen(v) {
			panelOpen = v;
			for (const fn of listeners) fn();
		}
		function subscribePanelOpen(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		}
		function usePanelOpen() {
			const [open, setOpen] = (0, react.useState)(panelOpen);
			(0, react.useEffect)(() => subscribePanelOpen(() => setOpen(panelOpen)), []);
			return open;
		}
		/** Foot button rendered in the official left sidebar (wide row or rail icon). */
		function ZhihuFootButton({ wide }) {
			const open = usePanelOpen();
			const [unread, setUnread] = (0, react.useState)(() => {
				try {
					return Math.max(Number(localStorage.getItem(UNREAD_KEY) || "0"), 0);
				} catch {
					return 0;
				}
			});
			(0, react.useEffect)(() => {
				const onStorage = (e) => {
					if (e.key === UNREAD_KEY) setUnread(Math.max(Number(e.newValue || "0"), 0));
				};
				window.addEventListener("storage", onStorage);
				return () => window.removeEventListener("storage", onStorage);
			}, []);
			const toggle = () => setPanelOpen(!panelOpen);
			return (0, react.createElement)("button", {
				type: "button",
				title: unread > 0 ? `知乎面板（${unread} 条新内容）` : "知乎面板",
				"aria-label": "知乎面板",
				"aria-expanded": open,
				onClick: toggle,
				style: {
					width: "100%",
					height: 36,
					border: "none",
					borderRadius: 8,
					background: "transparent",
					color: "var(--dsw-alias-label-secondary, #8b98a5)",
					cursor: "pointer",
					display: "flex",
					alignItems: "center",
					justifyContent: wide ? "flex-start" : "center",
					gap: 8,
					padding: wide ? "0 12px" : 0,
					fontSize: 13
				}
			}, [
				(0, react.createElement)("span", {
					key: "icon",
					style: {
						fontSize: 15,
						lineHeight: 1
					}
				}, "知"),
				wide ? (0, react.createElement)("span", { key: "label" }, "知乎面板") : null,
				unread > 0 ? (0, react.createElement)("span", {
					key: "badge",
					style: {
						marginLeft: "auto",
						background: "#00ba7c",
						color: "#06281c",
						borderRadius: 999,
						fontSize: 11,
						fontWeight: 700,
						padding: "1px 8px"
					}
				}, unread > 99 ? "99+" : String(unread)) : null
			]);
		}
		/** Right-side drawer overlay registered as its own shell.overlay entry, so it
		*  renders in the shell's overlay layer (full-viewport) rather than inside the
		*  sidebar footer. Always mounted; `open` toggles visibility/transform only,
		*  so the iframe page survives open/close cycles. */
		function ZhihuOverlay() {
			const open = usePanelOpen();
			const onClose = () => setPanelOpen(false);
			(0, react.useEffect)(() => {
				const onKey = (e) => {
					if (e.key === "Escape" && open) setPanelOpen(false);
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [open]);
			return (0, react.createElement)("div", { style: {
				position: "absolute",
				top: 0,
				right: 0,
				bottom: 0,
				width: "min(960px, 92vw)",
				background: "var(--dsw-alias-bg-base, #0f1419)",
				borderLeft: "1px solid var(--dsw-alias-border-l2, #2f3a45)",
				boxShadow: "-12px 0 32px rgba(0,0,0,.35)",
				display: "flex",
				flexDirection: "column",
				zIndex: 21,
				visibility: open ? "visible" : "hidden",
				transform: open ? "translateX(0)" : "translateX(100%)",
				transition: "transform .18s ease, visibility .18s",
				pointerEvents: open ? "auto" : "none"
			} }, [(0, react.createElement)("div", {
				key: "bar",
				style: {
					display: "flex",
					alignItems: "center",
					gap: 12,
					padding: "8px 16px",
					borderBottom: "1px solid var(--dsw-alias-border-l2, #2f3a45)",
					background: "var(--dsw-alias-bg-layer-1, #171e26)"
				}
			}, [
				(0, react.createElement)("strong", {
					key: "title",
					style: { fontSize: 14 }
				}, "知乎面板"),
				(0, react.createElement)("span", {
					key: "hint",
					style: {
						fontSize: 12,
						color: "var(--dsw-alias-label-secondary, #8b98a5)"
					}
				}, "热榜 · 关注动态 · 帖子追踪"),
				(0, react.createElement)("span", {
					key: "spacer",
					style: { flex: 1 }
				}),
				(0, react.createElement)("button", {
					key: "close",
					type: "button",
					onClick: onClose,
					style: {
						padding: "6px 12px",
						borderRadius: 8,
						border: "1px solid var(--dsw-alias-border-l2, #2f3a45)",
						background: "var(--dsw-alias-bg-layer-2, #1c2530)",
						color: "var(--dsw-alias-label-primary, #e7e9ea)",
						fontSize: 13,
						cursor: "pointer"
					}
				}, "关闭 (Esc)")
			]), (0, react.createElement)("iframe", {
				key: "frame",
				src: PANEL_PATH,
				style: {
					flex: 1,
					width: "100%",
					border: "none",
					background: "var(--dsw-alias-bg-base, #0f1419)"
				},
				title: "Zhihu dashboard"
			})]);
		}
		/**
		* Register the sidebar foot button, the overlay drawer (separate shell.overlay
		* entry), and the background track checker.
		* @param ctx - client root context with slots and locale available.
		*/
		function registerZhihuLauncher(ctx) {
			ctx.locale.bind(NS);
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "zhihu-dashboard",
				order: 10
			}, ZhihuFootButton));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "zhihu-dashboard-drawer",
				order: 10
			}, ZhihuOverlay));
			ctx.effect(() => startTrackTimer(), "zhihu-dashboard: track checker");
		}
		//#endregion
		//#region src/client/index.ts
		const name = "zhihu-dashboard";
		/** Required services: the slot registry and the locale service. */
		const inject = ["slots", "locale"];
		/**
		* Client plugin body: register the sidebar launcher.
		* @param ctx - client root context with slots and locale available.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "zhihu-dashboard: dictionaries");
			registerZhihuLauncher(ctx);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map