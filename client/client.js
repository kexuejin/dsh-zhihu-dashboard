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
		//#region src/client/ZhihuLauncher.tsx
		/**
		* Zhihu dashboard launcher: an official-sidebar foot button
		* (sidebar.footer.action) that opens a full-screen shell.overlay embedding
		* the /zhihu-dashboard page. Global (root scope) — no better-sidebar or
		* conversation-view dependency; the panel is shared across sessions.
		*/
		const PANEL_PATH = "/zhihu-dashboard";
		/** Foot button rendered in the official left sidebar (wide row or rail icon). */
		function ZhihuFootButton({ wide }) {
			const [open, setOpen] = (0, react.useState)(false);
			return (0, react.createElement)("div", { style: { display: "contents" } }, [(0, react.createElement)("button", {
				key: "btn",
				type: "button",
				title: "知乎面板",
				"aria-label": "知乎面板",
				"aria-expanded": open,
				onClick: () => setOpen((v) => !v),
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
			}, [(0, react.createElement)("span", {
				key: "icon",
				style: {
					fontSize: 15,
					lineHeight: 1
				}
			}, "知"), wide ? (0, react.createElement)("span", { key: "label" }, "知乎面板") : null]), open ? (0, react.createElement)(ZhihuOverlay, {
				key: "overlay",
				onClose: () => setOpen(false)
			}) : null]);
		}
		/** Right-side drawer overlay embedding the dashboard page. The shell's
		*  overlayLayer covers the viewport but passes events through, so the drawer
		*  sits on the right while the DSH UI stays visible and interactive behind it. */
		function ZhihuOverlay({ onClose }) {
			(0, react.useEffect)(() => {
				const onKey = (e) => {
					if (e.key === "Escape") onClose();
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);
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
				zIndex: 21
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
		* Register the sidebar foot button and the overlay it opens.
		* @param ctx - client root context with slots and locale available.
		*/
		function registerZhihuLauncher(ctx) {
			ctx.locale.bind(NS);
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "zhihu-dashboard",
				order: 10
			}, ZhihuFootButton));
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