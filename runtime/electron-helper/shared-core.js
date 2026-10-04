var PetShared = (function(exports) {

"use strict";

//#region src/shared/constants.ts
const CANVAS_H = 360;
const FEET_Y = 330;
const HIT_BOX = {
	x0: 200,
	y0: 50,
	x1: 440,
	y1: 335
};
const DRAG_THRESHOLD = 5;
const PET_REF_WIDTH = 462;
const ANIMATION_EXT = ".webm";

//#endregion
//#region src/shared/pickers.ts
const pick = (pool, exclude) => {
	const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
	const src = entries.length ? entries : pool;
	return src[Math.floor(Math.random() * src.length)];
};
const pickSlot = (slot, exclude) => {
	if (typeof slot === "string") return slot;
	const entries = exclude === void 0 ? slot : slot.filter((n) => n !== exclude);
	const src = entries.length ? entries : slot;
	return src[Math.floor(Math.random() * src.length)];
};
const slotIncludes = (slot, anim) => typeof slot === "string" ? slot === anim : slot.includes(anim);
const poolIncludes = (pool, anim) => pool.some((slot) => slotIncludes(slot, anim));
const isEventAnim = (events, anim) => events ? Object.values(events).some((pool) => poolIncludes(pool, anim)) : false;
const nextWorkStatusAnim = (pool, current) => {
	const idx = pool.findIndex((slot$1) => slotIncludes(slot$1, current));
	if (idx === -1) return null;
	const slot = pool[idx];
	if (!Array.isArray(slot) || slot.length <= 1) return null;
	return pickSlot(slot, current);
};
const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min));
const pickWeightedCategory = (categories, facing) => {
	const cats = categories.filter((c) => c.actions.length > 0);
	if (!cats.length) return null;
	const filtered = cats.filter((c) => !(c.noMirror && facing === "right"));
	const eligible = filtered.length ? filtered : cats;
	const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
	let t = Math.random() * totalW;
	for (const c of eligible) {
		t -= c.weight;
		if (t <= 0) return c;
	}
	return eligible[eligible.length - 1];
};
const rollKind = (roll, w) => {
	const topEnd = (w.idle + w.turn + w.move) / 100;
	if (roll < w.idle / 100) return "idle";
	if (roll < (w.idle + w.turn) / 100) return "turn";
	if (roll < topEnd) return "move";
	return "action";
};
const pickCategoryAction = (categories, idlePool, facing, current) => {
	const cat = pickWeightedCategory(categories, facing);
	if (!cat) return {
		id: "FALLBACK",
		name: pick(idlePool, current)
	};
	return {
		id: cat.id,
		name: pick(cat.actions, current)
	};
};

//#endregion
//#region src/shared/displays.ts
const rectRight = (r) => r.x + r.width;
const rectBottom = (r) => r.y + r.height;
const boundingRect = (rects) => {
	if (rects.length === 0) return {
		x: 0,
		y: 0,
		width: 0,
		height: 0
	};
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const r of rects) {
		x0 = Math.min(x0, r.x);
		y0 = Math.min(y0, r.y);
		x1 = Math.max(x1, rectRight(r));
		y1 = Math.max(y1, rectBottom(r));
	}
	return {
		x: x0,
		y: y0,
		width: x1 - x0,
		height: y1 - y0
	};
};
const pointInRect = (r, x, y) => x >= r.x && x < rectRight(r) && y >= r.y && y < rectBottom(r);
const rectAtPoint = (rects, x, y) => {
	for (const r of rects) if (pointInRect(r, x, y)) return r;
	return null;
};
const indexAtPoint = (rects, x, y) => {
	for (let i = 0; i < rects.length; i++) if (pointInRect(rects[i], x, y)) return i;
	return -1;
};
const distToRectSq = (r, x, y) => {
	const dx = Math.max(r.x - x, 0, x - rectRight(r));
	const dy = Math.max(r.y - y, 0, y - rectBottom(r));
	return dx * dx + dy * dy;
};
const nearestIndex = (rects, x, y) => {
	let best = -1;
	let bestD = Infinity;
	for (let i = 0; i < rects.length; i++) {
		const d = distToRectSq(rects[i], x, y);
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
};
const resolveRect = (rects, x, y) => {
	const hit = rectAtPoint(rects, x, y);
	if (hit) return hit;
	const i = nearestIndex(rects, x, y);
	return i < 0 ? null : rects[i];
};
const clampPointInRect = (r, x, y) => ({
	x: Math.min(Math.max(x, r.x), rectRight(r) - 1),
	y: Math.min(Math.max(y, r.y), rectBottom(r) - 1)
});
const clampPointToRegion = (rects, x, y) => {
	if (rectAtPoint(rects, x, y)) return {
		x,
		y
	};
	const i = nearestIndex(rects, x, y);
	return i < 0 ? {
		x,
		y
	} : clampPointInRect(rects[i], x, y);
};
const regionArea = (rects) => rects.reduce((s, r) => s + r.width * r.height, 0);
const regionHoleRatio = (rects) => {
	const hull = boundingRect(rects);
	const hullArea = hull.width * hull.height;
	if (hullArea <= 0) return 0;
	return Math.max(0, 1 - regionArea(rects) / hullArea);
};
const translateRects = (rects, dx, dy) => rects.map((r) => ({
	x: r.x + dx,
	y: r.y + dy,
	width: r.width,
	height: r.height
}));

//#endregion
//#region src/shared/motion.ts
const planMove = (o) => {
	const side = o.sideAllow ?? 0;
	const distance = randomBetween(o.minDist, o.maxDist);
	const target = o.cx + o.dir * distance;
	if (o.areas && o.areas.length > 0) {
		const bodyHalf = o.halfW - side;
		if (!rectAtPoint(o.areas, target - bodyHalf - o.margin, o.cy)) return null;
		if (!rectAtPoint(o.areas, target + bodyHalf + o.margin, o.cy)) return null;
	} else {
		const leftBound = o.margin + o.halfW - side;
		const rightBound = o.W - o.margin - o.halfW + side;
		if (target < leftBound || target > rightBound) return null;
	}
	return {
		startRatio: o.cx / o.W,
		startYRatio: o.cy / o.H,
		targetRatio: target / o.W,
		totalRatio: Math.abs(target - o.cx) / o.W
	};
};
const anchorPixel = (o) => {
	const height = o.size * 9 / 16;
	const a = o.area ?? {
		x: 0,
		y: 0,
		width: o.W,
		height: o.H
	};
	const left = a.x + o.marginX;
	const top = a.y + o.marginY;
	const right = a.x + a.width - o.size - o.marginX;
	const bottom = a.y + a.height - height - o.marginY;
	switch (o.corner) {
		case "top-left": return {
			x: left,
			y: top
		};
		case "top-right": return {
			x: right,
			y: top
		};
		case "bottom-left": return {
			x: left,
			y: bottom
		};
		case "bottom-right": return {
			x: right,
			y: bottom
		};
	}
};

//#endregion
//#region src/shared/balance.ts
const TIMEOUT_MS$2 = 2e4;
const RETRIES$1 = 2;
/** 带超时 + 重试的 GET（host 已内置重试，这里再兜底网络抖动）。
*  浏览器传默认相对路径；桌面模式（Electron，file:// 页面）传绝对 URL。 */
async function getWithRetry$1(url) {
	let last;
	for (let i = 0; i <= RETRIES$1; i++) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS$2) });
			if (res.ok) return res;
			last = new Error("HTTP " + res.status);
		} catch (e) {
			last = e;
		}
		if (i < RETRIES$1) await new Promise((r) => setTimeout(r, 600));
	}
	throw last instanceof Error ? last : new Error(String(last));
}
async function fetchBalanceState(baseUrl = "/dsh-pet-desktop-7340/balance") {
	const res = await getWithRetry$1(baseUrl);
	const raw = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet-desktop: 余额响应非法");
	const provider = String(raw.provider ?? "unknown");
	if (raw.ok !== true) {
		const reason = raw.reason === "unsupported" || raw.reason === "credential-missing" || raw.reason === "fetch-error" ? raw.reason : "fetch-error";
		return {
			provider,
			ok: false,
			reason,
			message: typeof raw.message === "string" ? raw.message : void 0
		};
	}
	if (raw.kind === "opencode") {
		const d = raw.data;
		if (!d || typeof d !== "object") throw new Error("dsh-pet-desktop: opencode 数据非法");
		const rolling = Number(d.rolling);
		const weekly = Number(d.weekly);
		const monthly = Number(d.monthly);
		if (![
			rolling,
			weekly,
			monthly
		].every(Number.isFinite)) throw new Error("dsh-pet-desktop: opencode 百分比非数字");
		return {
			provider,
			kind: "opencode",
			ok: true,
			rolling,
			weekly,
			monthly,
			rollingResetsAt: typeof d.rollingResetsAt === "string" ? d.rollingResetsAt : void 0,
			weeklyResetsAt: typeof d.weeklyResetsAt === "string" ? d.weeklyResetsAt : void 0,
			monthlyResetsAt: typeof d.monthlyResetsAt === "string" ? d.monthlyResetsAt : void 0
		};
	}
	if (raw.kind === "deepseek") {
		const d = raw.data;
		if (!d || typeof d !== "object") throw new Error("dsh-pet-desktop: deepseek 数据非法");
		return {
			provider,
			kind: "deepseek",
			ok: true,
			currency: typeof d.currency === "string" ? d.currency : void 0,
			total: typeof d.total === "string" ? d.total : void 0,
			granted: typeof d.granted === "string" ? d.granted : void 0,
			toppedUp: typeof d.toppedUp === "string" ? d.toppedUp : void 0
		};
	}
	throw new Error("dsh-pet-desktop: 余额 kind 非法");
}
async function fetchTriggerCount(baseUrl = "/dsh-pet-desktop-7340/balance/trigger") {
	const res = await fetch(baseUrl, { cache: "no-store" });
	if (!res.ok) return -1;
	const data = await res.json().catch(() => null);
	return data && typeof data.count === "number" ? data.count : -1;
}
const DEEPSEEK_FULL_BALANCE_CNY = 20;
function balancePercent(v) {
	if (v.kind === "opencode") return Math.max(v.rolling ?? 0, v.weekly ?? 0, v.monthly ?? 0);
	if (v.kind === "deepseek") {
		const total = Number(v.total);
		if (!Number.isFinite(total)) return void 0;
		const remaining$1 = Math.max(0, total) / DEEPSEEK_FULL_BALANCE_CNY * 100;
		return Math.max(0, Math.min(100, 100 - remaining$1));
	}
	return void 0;
}
function balanceEventIndex(p) {
	if (p === 100) return 5;
	const i = Math.floor(p / 20);
	return i < 5 ? i : 4;
}
const OPENCODE_QUOTA_USD = {
	rolling: 12,
	weekly: 30,
	monthly: 60
};
const WINDOW_LABELS = {
	rolling: "5h",
	weekly: "周",
	monthly: "月"
};
function urgentWindow(v) {
	if (v.kind !== "opencode") return void 0;
	const windows = [
		"rolling",
		"weekly",
		"monthly"
	];
	const resets = {
		rolling: v.rollingResetsAt,
		weekly: v.weeklyResetsAt,
		monthly: v.monthlyResetsAt
	};
	let best;
	for (const w of windows) {
		const percent = v[w] ?? 0;
		const quota = OPENCODE_QUOTA_USD[w];
		const remaining$1 = quota * (100 - percent) / 100;
		const cand = {
			label: WINDOW_LABELS[w],
			percent,
			quotaUsd: quota,
			remainingUsd: remaining$1,
			resetsAt: resets[w]
		};
		if (best === void 0 || remaining$1 < best.remainingUsd) best = cand;
	}
	return best;
}
function resetInText(iso) {
	if (!iso) return "";
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return "";
	const delta = t - Date.now();
	if (delta <= 0) return "已重置";
	const hoursF = delta / 36e5;
	if (hoursF >= 96) return (Math.round(hoursF / 24 * 10) / 10).toFixed(1) + " 天";
	return Math.max(.1, Math.round(hoursF * 10) / 10).toFixed(1) + " 小时";
}
function deepseekPricingTier(now = new Date()) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		weekday: "short",
		hour: "2-digit",
		hourCycle: "h23"
	}).formatToParts(now);
	const pick$1 = (type) => parts.find((p) => p.type === type)?.value;
	const weekday = pick$1("weekday");
	const hour = Number(pick$1("hour"));
	if (weekday === "Sat" || weekday === "Sun") return "idle";
	return hour >= 9 && hour < 12 || hour >= 14 && hour < 18 ? "peak" : "idle";
}
/** 不可用状态的气泡行（显式说明原因，绝不伪造数字）：
*  - unsupported：服务商未登记查询接口（配置事实，不是故障）→ 报出 provider id，便于自查"当前到底是谁"
*  - credential-missing：缺凭证 → 次要行放 host 报的凭证名（不含 message 时不留空行）
*  - fetch-error：抓取失败 → 次要行放底层错误
* 次要行为空的会被剔除：空 div 在气泡里会白占一行高度。 */
function unavailableRows(state) {
	const rows = state.reason === "unsupported" ? [{
		role: "error",
		text: "当前服务商暂不支持余额查询"
	}, {
		role: "sub",
		text: "当前服务商：" + state.provider
	}] : state.reason === "credential-missing" ? [{
		role: "error",
		text: "缺少余额查询凭证"
	}, {
		role: "sub",
		text: state.message ?? ""
	}] : [{
		role: "error",
		text: "余额查询失败"
	}, {
		role: "sub",
		text: state.message ?? ""
	}];
	return rows.filter((r) => r.text !== "");
}
function balanceBubbleView(state) {
	if (state.ok) {
		if (state.kind === "opencode") {
			const w = urgentWindow(state);
			if (w) {
				const reset = resetInText(w.resetsAt);
				const rows = [{
					role: "label",
					text: w.label + "额度已用 " + Math.round(w.percent) + "%"
				}, {
					role: "sub",
					text: reset ? reset + "重置" : "已重置"
				}];
				return rows;
			}
			return [{
				role: "label",
				text: "额度数据不可用"
			}];
		}
		const tier = deepseekPricingTier();
		return [
			{
				role: "label",
				text: "余额（"
			},
			{
				role: "tier",
				tier,
				text: tier === "peak" ? "峰" : "谷"
			},
			{
				role: "label",
				text: "）¥" + (state.total ?? "-")
			}
		];
	}
	return unavailableRows(state);
}
function decideBalanceNotice(state, lastKey, explicit) {
	if (state.ok) return {
		show: false,
		key: null
	};
	const key = state.reason + ":" + state.provider;
	return {
		show: explicit || key !== lastKey,
		key
	};
}

//#endregion
//#region src/shared/whisper.ts
const TIMEOUT_MS$1 = 3e4;
const RETRIES = 2;
/** 带超时 + 重试的 GET（host 生成 LLM 调用可能较慢，超时放宽；桌面 file:// 页面需绝对 URL） */
async function getWithRetry(url) {
	let last;
	for (let i = 0; i <= RETRIES; i++) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS$1) });
			if (res.ok) return res;
			last = new Error("HTTP " + res.status);
		} catch (e) {
			last = e;
		}
		if (i < RETRIES) await new Promise((r) => setTimeout(r, 800));
	}
	throw last instanceof Error ? last : new Error(String(last));
}
async function fetchWhisperState(baseUrl = "/dsh-pet-desktop-7340/whisper") {
	const res = await getWithRetry(baseUrl);
	const raw = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet-desktop: 碎碎念响应非法");
	if (raw.ok !== true) return {
		ok: false,
		reason: raw.reason === "provider-missing" ? "provider-missing" : "generate-error",
		message: typeof raw.message === "string" ? raw.message : void 0
	};
	const text = typeof raw.text === "string" ? raw.text.trim() : "";
	const ts = Number(raw.ts);
	if (!text || !Number.isFinite(ts)) throw new Error("dsh-pet-desktop: 碎碎念数据非法");
	const image = typeof raw.image === "string" && raw.image.trim() ? raw.image.trim() : void 0;
	return image ? {
		ok: true,
		text,
		image,
		ts
	} : {
		ok: true,
		text,
		ts
	};
}
function memeImageUrl(name, base = "/dsh-pet-desktop-7340") {
	return base + "/pic/memes/" + encodeURIComponent(name) + ".png";
}
const MEME_IMG_CLASS = "pet-bub-img";
const MEME_BUBBLE_CLASS = "has-img";
const MEME_BUBBLE_CSS = [
	".pet-bub-img{display:block;width:calc(var(--dsh-pet-desktop-size,var(--pet-size,462px))*0.34);height:auto;",
	"border-radius:calc(var(--dsh-pet-desktop-size,var(--pet-size,462px))*0.026);",
	"margin:0 auto calc(var(--dsh-pet-desktop-size,var(--pet-size,462px))*0.017);object-fit:cover;",
	"pointer-events:none;user-select:none}",
	".pet-bubble.has-img,.dsh-pet-desktop-bubble.has-img{min-width:0}"
].join("");
/** 只注入一次（两端共用；页面已有同一标记则跳过） */
let memeCssInjected = false;
function injectMemeBubbleCss() {
	if (memeCssInjected || typeof document === "undefined") return;
	memeCssInjected = true;
	if (document.querySelector("style[data-plugin-css=\"dsh-pet-desktop/meme-bubble\"]") !== null) return;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet-desktop";
	tag.dataset.pluginCss = "dsh-pet-desktop/meme-bubble";
	tag.textContent = MEME_BUBBLE_CSS;
	document.head.appendChild(tag);
}
function createMemeImage(name, base = "/dsh-pet-desktop-7340") {
	const key = String(name ?? "").trim();
	if (!key) return null;
	injectMemeBubbleCss();
	const img = document.createElement("img");
	img.className = MEME_IMG_CLASS;
	img.src = memeImageUrl(key, base);
	img.alt = key;
	return img;
}
function fetchWhisperTrigger(baseUrl = "/dsh-pet-desktop-7340/whisper/trigger") {
	return fetchWhisperState(baseUrl);
}
function whisperBubbleView(state) {
	if (state.ok) return [{
		role: "label",
		text: state.text
	}];
	const msg = state.reason === "provider-missing" ? "当前对话未配置模型，碎碎念不可用" : "碎碎念生成失败" + (state.message ? "：" + state.message : "");
	return [{
		role: "label",
		text: msg
	}];
}

//#endregion
//#region src/shared/config.ts
const PET_DISPLAYS = [
	"web",
	"desktop",
	"both",
	"none"
];
const isWebVisible = (display) => display === "web" || display === "both";
const isDesktopVisible = (display) => display === "desktop" || display === "both";
function flattenConfigPets(merged) {
	const out = [];
	for (const [entry, conf] of Object.entries(merged)) {
		const list = Array.isArray(conf?.pets) ? conf.pets : [];
		for (const p of list) out.push({
			...p,
			animations: conf.animations,
			animationWeights: conf.animationWeights,
			eventsRefreshSec: conf.eventsRefreshSec,
			physics: conf.physics,
			confineToScreen: conf.confineToScreen,
			hideOnFullscreen: conf.hideOnFullscreen,
			workStatusTexts: conf.workStatusTexts,
			assetRoot: entry,
			extra: entry !== "main"
		});
	}
	return out;
}

//#endregion
//#region src/shared/notify.ts
const NOTIFY_ICONS = {
	done: "notify-done",
	error: "notify-error",
	truncated: "notify-truncated",
	approval: "notify-approval",
	question: "notify-question",
	test: "notify-test"
};
const MAX_BODY = 80;
function truncate(text) {
	return text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "…" : text;
}
function frameToToast(frame) {
	switch (frame.type) {
		case "session/event": {
			const ev = frame.event ?? {};
			if (ev.type !== "turn/end") return null;
			const kind = ev.data?.reason?.kind;
			if (kind === "completed") return {
				title: "对话完成",
				body: "",
				icon: NOTIFY_ICONS.done
			};
			if (kind === "error") return {
				title: "生成失败",
				body: ev.data?.reason?.error?.message ?? "",
				icon: NOTIFY_ICONS.error
			};
			if (kind === "max-tokens") return {
				title: "输出被截断",
				body: "已达到输出 token 上限",
				icon: NOTIFY_ICONS.truncated
			};
			return null;
		}
		case "approval/requested": {
			const toolName = typeof frame.toolName === "string" ? frame.toolName : "";
			const reason = typeof frame.reason === "string" && frame.reason ? frame.reason : "";
			return {
				title: "正在申请权限",
				body: (toolName ? "工具「" + toolName + "」" : "") + (reason ? "：" + reason : ""),
				icon: NOTIFY_ICONS.approval
			};
		}
		case "question/requested": {
			const q = Array.isArray(frame.questions) && frame.questions[0]?.question || "";
			return {
				title: "模型在等你回答",
				body: q,
				icon: NOTIFY_ICONS.question
			};
		}
		case "host/agent-error": return {
			title: "生成失败",
			body: typeof frame.message === "string" ? frame.message : "",
			icon: NOTIFY_ICONS.error
		};
		default: return null;
	}
}

//#endregion
//#region src/shared/peek.ts
/** 窥屏要等模型看图+说话，超时放宽到 60s（与对话同级） */
const PEEK_TIMEOUT_MS = 6e4;
async function sendPeek(baseUrl, petId, context, image) {
	const url = baseUrl + (baseUrl.includes("?") ? "&" : "?") + "pet=" + encodeURIComponent(petId);
	const body = { context };
	if (image && image.base64) body.image = {
		base64: image.base64,
		mediaType: image.mediaType || "image/jpeg"
	};
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(PEEK_TIMEOUT_MS)
	});
	const raw = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet-desktop: 窥屏响应非法");
	const o = raw;
	if (o.ok !== true) {
		const reason = o.reason === "provider-missing" || o.reason === "generate-error" || o.reason === "disabled" ? o.reason : "bad-request";
		return {
			ok: false,
			reason,
			message: typeof o.message === "string" ? o.message : void 0
		};
	}
	const text = typeof o.text === "string" ? o.text.trim() : "";
	if (!text) throw new Error("dsh-pet-desktop: 窥屏文本非法");
	const image2 = typeof o.image === "string" && o.image.trim() ? o.image.trim() : void 0;
	return {
		ok: true,
		text,
		...image2 ? { image: image2 } : {},
		ts: Number(o.ts) || 0,
		...o.withImage === true ? { withImage: true } : {},
		...o.imageDropped === true ? { imageDropped: true } : {}
	};
}

//#endregion
//#region src/shared/sfx.ts
const SOUND_MIME = {
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".oga": "audio/ogg",
	".m4a": "audio/mp4",
	".aac": "audio/aac",
	".opus": "audio/ogg",
	".flac": "audio/flac",
	".webm": "audio/webm"
};
const DEFAULT_SFX_FILE = "need-decision.mp3";
const DEFAULT_SFX_VOLUME = .8;
function isSoundFileName(name) {
	if (typeof name !== "string") return false;
	const file = name.trim();
	if (!file || file.length > 128) return false;
	if (file === "." || file === "..") return false;
	if (/[\\/]/.test(file)) return false;
	if (/[\x00-\x1f<>:"|?*]/.test(file)) return false;
	const dot = file.lastIndexOf(".");
	if (dot <= 0) return false;
	return Object.prototype.hasOwnProperty.call(SOUND_MIME, file.slice(dot).toLowerCase());
}
function soundMime(file) {
	const dot = file.lastIndexOf(".");
	return dot > 0 ? SOUND_MIME[file.slice(dot).toLowerCase()] ?? "application/octet-stream" : "application/octet-stream";
}
const SFX_POLL_MS = 1e3;
const SFX_POLL_IDLE_MS = 1e4;
function sfxPollDelayMs(enabled) {
	return enabled ? SFX_POLL_MS : SFX_POLL_IDLE_MS;
}
function sfxCueAction(lastHandledId, state) {
	if (!state || state.ok !== true) return "none";
	if (state.enabled !== true) return "none";
	if (!state.url) return "none";
	const id = state.pending?.id;
	if (!id || id === lastHandledId) return "none";
	return "claim";
}
function clampSfxVolume(value, fallback = .8) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(1, Math.max(0, n));
}
function sfxAssetUrl(base, url) {
	if (!url) return null;
	const path = url.startsWith("/") ? url : "/" + url;
	return (base || "") + path;
}

//#endregion
//#region src/shared/menu.ts
/** 事件名 → 分类标签（无映射时用事件名本身） */
const EVENT_LABELS = {
	balance: "余额档位",
	whisper: "碎碎念",
	workStatus: "工作状态"
};
const leaf = (anim) => ({
	label: anim,
	anim
});
function buildMenuTree(animations) {
	const groups = [];
	const pools = [
		["待机", animations.idle],
		["转向", animations.turn],
		["拖拽", animations.drag],
		["点击回应", animations.clicks],
		["移动", animations.moves.actions.map((m) => m.name)]
	];
	for (const [label, pool] of pools) if (pool.length) groups.push({
		label,
		children: pool.map(leaf)
	});
	const cats = (animations.categories ?? []).filter((c) => c.actions.length > 0);
	for (const c of cats) groups.push({
		label: c.id,
		children: c.actions.map(leaf)
	});
	const events = animations.events ?? {};
	for (const key of Object.keys(events)) {
		const pool = events[key] ?? [];
		const names = [];
		for (const slot of pool) if (typeof slot === "string") names.push(slot);
		else names.push(...slot);
		if (names.length) groups.push({
			label: EVENT_LABELS[key] ?? key,
			children: names.map(leaf)
		});
	}
	if (!groups.length) return [];
	return [
		{
			label: "配置桌宠",
			action: "open-config"
		},
		{
			label: "番茄钟与 Todo",
			action: "open-productivity"
		},
		{
			label: "动作",
			children: groups
		}
	];
}
function isNoMirrorAnimation(categories, anim) {
	return (categories ?? []).some((c) => c.noMirror === true && c.actions.includes(anim));
}
const MENU_CSS = [
	".dsh-pet-menu{position:fixed;left:0;top:0;z-index:2147483000;color:#2b2b2b;font-size:13px;line-height:1.5;",
	"font-family:'Microsoft YaHei UI','Segoe UI','PingFang SC',sans-serif;user-select:none;pointer-events:auto}",
	".dsh-pet-menu,.dsh-pet-menu *{box-sizing:border-box}",
	".dsh-pet-menu-column{position:absolute;min-width:150px;max-width:240px;padding:4px;",
	"background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:8px;",
	"box-shadow:0 8px 28px rgba(0,0,0,.2);max-height:min(62vh,460px);overflow-y:auto;",
	"scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.22) transparent}",
	".dsh-pet-menu-column::-webkit-scrollbar{width:8px;height:8px}",
	".dsh-pet-menu-column::-webkit-scrollbar-track{background:transparent}",
	".dsh-pet-menu-column::-webkit-scrollbar-thumb{background:rgba(0,0,0,.16);border-radius:4px;",
	"border:2px solid transparent;background-clip:content-box}",
	".dsh-pet-menu-column::-webkit-scrollbar-thumb:hover{background:rgba(43,99,255,.4);",
	"border:2px solid transparent;background-clip:content-box}",
	".dsh-pet-menu-column::-webkit-scrollbar-corner{background:transparent}",
	".dsh-pet-menu-item{position:relative;display:flex;align-items:center;justify-content:space-between;",
	"gap:14px;padding:5px 12px;border-radius:6px;white-space:nowrap;cursor:default}",
	".dsh-pet-menu-item:hover{background:rgba(43,99,255,.14)}",
	".dsh-pet-menu-item>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis}",
	".dsh-pet-menu-arrow{color:#9aa0a6;font-size:12px;flex:none}"
].join("");
function isBranchNode(n) {
	return "children" in n && Array.isArray(n.children);
}
function mountContextMenu(opts) {
	const { tree, x, y, onAction, onClose, clamp } = opts;
	const c = clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h) ? clamp : {
		x: 0,
		y: 0,
		w: window.innerWidth,
		h: window.innerHeight
	};
	const root = document.createElement("div");
	root.className = "dsh-pet-menu";
	root.style.left = "0px";
	root.style.top = "0px";
	root.addEventListener("contextmenu", (e) => e.preventDefault());
	let closed = false;
	/** 每个面板当前展开的子面板（无 = 未展开）；hideChain 会沿链清除 */
	const openChild = new Map();
	/** 指针整体离开菜单树的兜底关闭定时器（root mouseover 重新进入即取消） */
	let leaveTimer = null;
	/** 关闭某面板及其后代面板整条链（display:none + 清 openChild 链） */
	const hideChain = (panel) => {
		panel.style.display = "none";
		const child = openChild.get(panel);
		if (child) {
			openChild.delete(panel);
			hideChain(child);
		}
	};
	/** 把面板显示在触发项旁边：右缘展开，贴右/下边缘自动翻转夹取（在 clamp 矩形内） */
	const showPanel = (panel, item) => {
		const rect = item.getBoundingClientRect();
		panel.style.left = "";
		panel.style.top = "";
		panel.style.display = "block";
		let left = rect.right + 4;
		if (left + panel.offsetWidth > c.x + c.w - 4) left = rect.left - panel.offsetWidth - 4;
		left = Math.max(c.x + 4, left);
		let top = rect.top;
		if (top + panel.offsetHeight > c.y + c.h - 4) top = Math.max(c.y + 4, c.y + c.h - 4 - panel.offsetHeight);
		panel.style.left = left + "px";
		panel.style.top = top + "px";
	};
	/** 构建一层面板（nodes 列表）；分支项的子面板**平级**挂到 root 下，不嵌套。
	*  面板自身先入 DOM、子面板随后入 → 层级越深绘制越靠上（子菜单盖在父菜单上层）。 */
	const buildPanel = (nodes) => {
		const panel = document.createElement("div");
		panel.className = "dsh-pet-menu-column";
		panel.style.display = "none";
		if (clamp) panel.style.maxHeight = Math.min(460, Math.max(120, c.h - 16)) + "px";
		root.appendChild(panel);
		for (const node$1 of nodes) {
			const item = document.createElement("div");
			item.className = "dsh-pet-menu-item";
			if (isBranchNode(node$1)) {
				item.classList.add("dsh-pet-menu-branch");
				const label = document.createElement("span");
				label.textContent = node$1.label;
				const arrow = document.createElement("span");
				arrow.className = "dsh-pet-menu-arrow";
				arrow.textContent = "▸";
				item.appendChild(label);
				item.appendChild(arrow);
				const childPanel = buildPanel(node$1.children);
				item.addEventListener("mouseenter", () => {
					const prev = openChild.get(panel);
					if (prev && prev !== childPanel) hideChain(prev);
					openChild.set(panel, childPanel);
					showPanel(childPanel, item);
				});
			} else {
				const label = document.createElement("span");
				label.textContent = node$1.label;
				item.appendChild(label);
				item.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					close();
					onAction(node$1);
				});
			}
			panel.appendChild(item);
		}
		return panel;
	};
	const rootPanel = buildPanel(tree);
	rootPanel.style.display = "block";
	document.body.appendChild(root);
	rootPanel.style.left = "";
	rootPanel.style.top = "";
	const rw = rootPanel.offsetWidth;
	const rh = rootPanel.offsetHeight;
	rootPanel.style.left = Math.max(c.x + 4, Math.min(x, c.x + c.w - rw - 4)) + "px";
	rootPanel.style.top = Math.max(c.y + 4, Math.min(y, c.y + c.h - rh - 4)) + "px";
	root.addEventListener("mouseleave", () => {
		if (leaveTimer !== null) window.clearTimeout(leaveTimer);
		leaveTimer = window.setTimeout(() => {
			leaveTimer = null;
			close();
		}, 200);
	});
	root.addEventListener("mouseover", () => {
		if (leaveTimer !== null) {
			window.clearTimeout(leaveTimer);
			leaveTimer = null;
		}
	});
	const onDocPointerDown = (e) => {
		if (closed) return;
		if (root.contains(e.target)) return;
		close();
	};
	const onDocKeyDown = (e) => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	const close = () => {
		if (closed) return;
		closed = true;
		if (leaveTimer !== null) window.clearTimeout(leaveTimer);
		leaveTimer = null;
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		root.remove();
		if (onClose) onClose();
	};
	return {
		el: root,
		close
	};
}

//#endregion
//#region src/shared/chat.ts
const SEND_TIMEOUT_MS = 6e4;
async function sendChat(baseUrl, text) {
	const res = await fetch(baseUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ text }),
		signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
	});
	const raw = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet-desktop: 对话响应非法");
	const o = raw;
	if (o.ok !== true) return {
		ok: false,
		reason: o.reason === "provider-missing" || o.reason === "generate-error" || o.reason === "config-error" ? o.reason : "bad-request",
		message: typeof o.message === "string" ? o.message : void 0
	};
	const reply = typeof o.reply === "string" ? o.reply.trim() : "";
	if (!reply) throw new Error("dsh-pet-desktop: 对话回复非法");
	const image = typeof o.image === "string" && o.image.trim() ? o.image.trim() : void 0;
	return image ? {
		ok: true,
		reply,
		image,
		ts: Number(o.ts) || 0
	} : {
		ok: true,
		reply,
		ts: Number(o.ts) || 0
	};
}
const CHAT_CSS = [
	".dsh-pet-desktop-chat{position:fixed;z-index:2147483001;width:160px;max-width:80vw;",
	"background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:10px;",
	"box-shadow:0 10px 32px rgba(0,0,0,.22);color:#2b2b2b;font-size:14px;line-height:1.5;",
	"font-family:'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif;",
	"user-select:none}",
	".dsh-pet-desktop-chat *{box-sizing:border-box}",
	".dsh-pet-desktop-chat-input{display:block;width:100%;border:none;outline:none;background:transparent;",
	"padding:8px 11px 9px;font-size:14px;line-height:1.45;color:#2b2b2b;font-family:inherit;",
	"resize:none;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}",
	".dsh-pet-desktop-chat-input::placeholder{color:rgba(43,43,43,.45)}",
	".dsh-pet-desktop-chat-input:disabled{opacity:.55}",
	".dsh-pet-desktop-chat-err{color:#d94f3d;font-size:12px;padding:0 12px 8px;white-space:pre-wrap;overflow-wrap:anywhere}"
].join("");
/** 输入框宽度自适应参数：初始小宽 → 随文本增宽 → 封顶后折行增高 */
const CHAT_MIN_W = 160;
const CHAT_MAX_W = 340;
const CHAT_H_PAD = 22;
let chatCssInjected = false;
function injectChatCss() {
	if (chatCssInjected || typeof document === "undefined") return;
	chatCssInjected = true;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet-desktop";
	tag.dataset.pluginCss = "dsh-pet-desktop/chat";
	tag.textContent = CHAT_CSS;
	document.head.appendChild(tag);
}
function mountChatDialog(opts) {
	injectChatCss();
	const { petId, x, y, onReply, onClose, clamp } = opts;
	const baseUrl = opts.baseUrl ?? "/dsh-pet-desktop-7340/chat";
	const withPet = baseUrl + "?pet=" + encodeURIComponent(petId);
	const c = clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h) ? clamp : {
		x: 0,
		y: 0,
		w: window.innerWidth,
		h: window.innerHeight
	};
	const root = document.createElement("div");
	root.className = "dsh-pet-desktop-chat";
	const input$1 = document.createElement("textarea");
	input$1.className = "dsh-pet-desktop-chat-input";
	input$1.placeholder = "说点什么…";
	input$1.maxLength = 2e3;
	input$1.rows = 1;
	let measureCtx = null;
	const measureText = (text) => {
		const ctx = measureCtx ?? (measureCtx = document.createElement("canvas").getContext("2d"));
		ctx.font = getComputedStyle(input$1).font;
		return ctx.measureText(text).width;
	};
	const resizeInput = () => {
		const textW = measureText(input$1.value || " ");
		const w = Math.max(CHAT_MIN_W, Math.min(Math.ceil(textW + CHAT_H_PAD), CHAT_MAX_W));
		root.style.width = w + "px";
		input$1.style.height = "auto";
		input$1.style.height = Math.max(input$1.scrollHeight, 22) + "px";
	};
	input$1.addEventListener("input", resizeInput);
	resizeInput();
	const err = document.createElement("div");
	err.className = "dsh-pet-desktop-chat-err";
	err.style.display = "none";
	root.appendChild(input$1);
	root.appendChild(err);
	document.body.appendChild(root);
	resizeInput();
	const rr = root.getBoundingClientRect();
	root.style.left = Math.max(c.x + 4, Math.min(x, c.x + c.w - rr.width - 4)) + "px";
	root.style.top = Math.max(c.y + 4, Math.min(y, c.y + c.h - rr.height - 4)) + "px";
	let closed = false;
	let sending = false;
	const close = () => {
		if (closed) return;
		closed = true;
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		root.remove();
		if (onClose) onClose();
	};
	const onDocPointerDown = (e) => {
		if (closed) return;
		if (root.contains(e.target)) return;
		close();
	};
	const onDocKeyDown = (e) => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	const doSend = () => {
		if (closed || sending) return;
		const text = input$1.value.trim();
		if (!text) return;
		sending = true;
		input$1.disabled = true;
		sendChat(withPet, text).then((state) => {
			if (state.ok) {
				close();
				if (onReply) onReply(state.reply, state.image);
			} else {
				err.textContent = "对话失败：" + (state.message ?? state.reason);
				err.style.display = "block";
			}
		}).catch((e) => {
			err.textContent = "对话异常：" + String(e && e.message ? e.message : e);
			err.style.display = "block";
		}).finally(() => {
			sending = false;
			input$1.disabled = false;
			if (!closed) input$1.focus();
		});
	};
	input$1.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			doSend();
		}
	});
	input$1.focus();
	return {
		el: root,
		close
	};
}

//#endregion
//#region src/shared/physics.ts
const SPRING_K = 200;
const SPRING_C = 30;
const TRAIL_KEEP_MS = 200;
const RELEASE_WINDOW_MS = 150;
const RELEASE_STALE_MS = 150;
const MIN_SPAN_MS = 20;
const SEG_MIN_DT_MS = 8;
const DEAD_ZONE_SPEED = 500;
const MAX_THROW_SPEED = 3600;
const PEAK_WEIGHT = .5;
const ACCEL_REF = 8e3;
const ACCEL_GAIN_MAX = .6;
const GRAVITY = 1400;
const RESTITUTION = .78;
const GROUND_FRICTION = 2.5;
const DEFAULT_PHYSICS = {
	gravity: GRAVITY,
	restitution: RESTITUTION,
	groundFriction: GROUND_FRICTION,
	ceilingBounce: true,
	throwPower: 1,
	petCollision: false
};
const DEFAULT_THROW_POWER = 1;
const REST_VY = 40;
const REST_VX = 15;
const MAX_STEP_DT = .05;
const SQ_SQUASH = .55;
const SQ_DURATION_MS = 220;
const SQ_SOFT_SPEED = 300;
const SQ_HARD_SPEED = 1500;
const SQ_MAX_SQUASH = .55;
const landingSquash = (impactSpeed) => {
	const t = Math.min(Math.max((Math.abs(impactSpeed) - SQ_SOFT_SPEED) / (SQ_HARD_SPEED - SQ_SOFT_SPEED), 0), 1);
	return Math.min(.8, 1 - t * (1 - SQ_MAX_SQUASH));
};
const squashScale = (u, squash = SQ_SQUASH) => {
	if (u < .45) {
		const p$1 = u / .45;
		return 1 - (1 - squash) * p$1 * p$1;
	}
	const p = (u - .45) / .55;
	const c1 = 1.70158;
	const c3 = c1 + 1;
	const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
	return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
};
const throwBounds = (o) => {
	const h = o.size * 9 / 16;
	return {
		minX: -o.sideAllow,
		minY: 0,
		maxX: o.W - o.size + o.sideAllow,
		maxY: o.H - h
	};
};
const throwBoundsIn = (area, size, sideAllow) => {
	const h = size * 9 / 16;
	return {
		minX: area.x - sideAllow,
		minY: area.y,
		maxX: rectRight(area) - size + sideAllow,
		maxY: rectBottom(area) - h
	};
};
const throwSpace = (o) => ({
	bounds: o.areas.map((a) => throwBoundsIn(a, o.size, o.sideAllow)),
	areas: o.areas,
	panels: o.panels && o.panels.length === o.areas.length ? o.panels : o.areas,
	size: o.size,
	sideAllow: o.sideAllow
});
const screenOfBox = (space, x, y) => {
	const cx = x + space.size / 2;
	const cy = y + space.size * 9 / 16 / 2;
	const hit = indexAtPoint(space.areas, cx, cy);
	return hit >= 0 ? hit : nearestIndex(space.areas, cx, cy);
};
const trimTrail = (trail, now) => {
	const cutoff = now - TRAIL_KEEP_MS;
	let i = 0;
	while (i < trail.length && trail[i].t < cutoff) i++;
	return i === 0 ? trail : trail.slice(i);
};
const springStep = (v, x, target, dt, power = DEFAULT_THROW_POWER) => v + ((target - x) * SPRING_K - v * SPRING_C) * power * dt;
const softClampSpeed = (speed) => {
	if (speed <= 0) return 0;
	return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
};
const estimateReleaseVelocity = (trail, now, physics = DEFAULT_PHYSICS) => {
	if (trail.length === 0) return null;
	const last = trail[trail.length - 1];
	if (now - last.t > RELEASE_STALE_MS) return null;
	const win = trail.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
	if (win.length < 2) return null;
	const t0 = win[0].t;
	const x0 = win[0].x;
	const y0 = win[0].y;
	const t1 = win[win.length - 1].t;
	const x1 = win[win.length - 1].x;
	const y1 = win[win.length - 1].y;
	const spanMs = t1 - t0;
	if (spanMs < MIN_SPAN_MS) return null;
	const baseVx = (x1 - x0) / spanMs * 1e3;
	const baseVy = (y1 - y0) / spanMs * 1e3;
	const baseSpeed = Math.hypot(baseVx, baseVy);
	if (baseSpeed < 1e-6) return null;
	const segSpeeds = [];
	let px = x0;
	let py = y0;
	let pt = t0;
	for (const s of win.slice(1)) {
		const dt = s.t - pt;
		if (dt >= SEG_MIN_DT_MS) {
			segSpeeds.push({
				speed: Math.hypot(s.x - px, s.y - py) / dt * 1e3,
				tEnd: s.t
			});
			px = s.x;
			py = s.y;
			pt = s.t;
		}
	}
	const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map((v) => v.speed)) : baseSpeed;
	let accel = 0;
	if (segSpeeds.length >= 2) {
		const lastSeg = segSpeeds[segSpeeds.length - 1];
		const firstSeg = segSpeeds[0];
		accel = (lastSeg.speed - firstSeg.speed) / Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1e3, MIN_SPAN_MS / 1e3);
	}
	const speedBeforeClamp = ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) * (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
	const speed = softClampSpeed(speedBeforeClamp) * physics.throwPower;
	if (speed < DEAD_ZONE_SPEED) return null;
	return {
		vx: baseVx / baseSpeed * speed,
		vy: baseVy / baseSpeed * speed
	};
};
const throwStep = (s, dtRaw, b, physics = DEFAULT_PHYSICS) => {
	const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
	let { x, y, vx, vy } = s;
	vy += physics.gravity * dt;
	x += vx * dt;
	y += vy * dt;
	let bounced = false;
	if (x < b.minX) {
		x = b.minX;
		vx = Math.abs(vx) * physics.restitution;
		bounced = true;
	} else if (x > b.maxX) {
		x = b.maxX;
		vx = -Math.abs(vx) * physics.restitution;
		bounced = true;
	}
	if (y < b.minY) {
		if (physics.ceilingBounce) {
			y = b.minY;
			vy = Math.abs(vy) * physics.restitution;
			bounced = true;
		}
	} else if (y >= b.maxY) {
		y = b.maxY;
		vx *= Math.max(0, 1 - physics.groundFriction * dt);
		if (Math.abs(vy) < REST_VY) vy = 0;
		else vy = -Math.abs(vy) * physics.restitution;
		bounced = true;
	}
	const speed = Math.hypot(vx, vy);
	const atRest = y >= b.maxY - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX || bounced && speed < REST_VY && Math.abs(vy) < 1;
	return {
		x,
		y,
		vx,
		vy,
		bounced,
		atRest
	};
};
const throwStepRegion = (s, dtRaw, space, physics = DEFAULT_PHYSICS, lockScreen = -1) => {
	const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
	let { x, y, vx, vy } = s;
	vy += physics.gravity * dt;
	x += vx * dt;
	y += vy * dt;
	if (space.areas.length === 0) return {
		x,
		y,
		vx,
		vy,
		screen: -1,
		bounced: false,
		atRest: false
	};
	const h = space.size * 9 / 16;
	let bounced = false;
	const locked = Number.isInteger(lockScreen) && lockScreen >= 0 && lockScreen < space.areas.length;
	/** 该用哪块屏的 AABB / 工作区 / 面板：锁定时恒为锁定屏，否则取身体中心所在屏 */
	const pick$1 = (i) => locked ? lockScreen : i;
	let cur = screenOfBox(space, x, y);
	let b = space.bounds[pick$1(cur)];
	let a = space.areas[pick$1(cur)];
	const pa = space.panels[pick$1(cur)] || a;
	const cy = y + h / 2;
	if (x < b.minX) {
		if (locked || indexAtPoint(space.panels, pa.x - 1, cy) < 0) {
			x = b.minX;
			vx = Math.abs(vx) * physics.restitution;
			bounced = true;
		}
	} else if (x > b.maxX) {
		if (locked || indexAtPoint(space.panels, rectRight(pa), cy) < 0) {
			x = b.maxX;
			vx = -Math.abs(vx) * physics.restitution;
			bounced = true;
		}
	}
	cur = screenOfBox(space, x, y);
	b = space.bounds[pick$1(cur)];
	a = space.areas[pick$1(cur)];
	const pa2 = space.panels[pick$1(cur)] || a;
	const cx = x + space.size / 2;
	if (y < b.minY) {
		if (physics.ceilingBounce && (locked || indexAtPoint(space.panels, cx, pa2.y - 1) < 0)) {
			y = b.minY;
			vy = Math.abs(vy) * physics.restitution;
			bounced = true;
		}
	} else if (y >= b.maxY) {
		if (locked || indexAtPoint(space.panels, cx, rectBottom(pa2)) < 0) {
			y = b.maxY;
			vx *= Math.max(0, 1 - physics.groundFriction * dt);
			if (Math.abs(vy) < REST_VY) vy = 0;
			else vy = -Math.abs(vy) * physics.restitution;
			bounced = true;
		}
	}
	cur = pick$1(screenOfBox(space, x, y));
	b = space.bounds[cur];
	const speed = Math.hypot(vx, vy);
	const atRest = y >= b.maxY - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX || bounced && speed < REST_VY && Math.abs(vy) < 1;
	return {
		x,
		y,
		vx,
		vy,
		screen: cur,
		bounced,
		atRest
	};
};
const PET_BOUNCE_E = .995;
const bodyPixelBox = (o) => {
	const h = o.size * 9 / 16;
	return {
		left: o.x + HIT_BOX.x0 / 640 * o.size,
		top: o.y + o.bottomPad + HIT_BOX.y0 / 360 * h,
		right: o.x + HIT_BOX.x1 / 640 * o.size,
		bottom: o.y + o.bottomPad + HIT_BOX.y1 / 360 * h
	};
};
const rectsOverlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const collidePet = (fly, hit) => {
	const hf = fly.size * 9 / 16 / 2;
	const hh = hit.size * 9 / 16 / 2;
	const cx = hit.x + hit.size / 2 - (fly.x + fly.size / 2);
	const cy = hit.y + hh - (fly.y + hf);
	const dist = Math.hypot(cx, cy);
	if (dist < 1e-6) return null;
	const nx = cx / dist;
	const ny = cy / dist;
	const vrel = (fly.vx - hit.vx) * nx + (fly.vy - hit.vy) * ny;
	if (vrel <= 0) return null;
	const e = PET_BOUNCE_E;
	const m1 = fly.size * fly.size;
	const m2 = hit.size * hit.size;
	const v1n = fly.vx * nx + fly.vy * ny;
	const v2n = hit.vx * nx + hit.vy * ny;
	const v1n2 = ((m1 - e * m2) * v1n + (1 + e) * m2 * v2n) / (m1 + m2);
	const v2n2 = ((m2 - e * m1) * v2n + (1 + e) * m1 * v1n) / (m1 + m2);
	return {
		fvx: fly.vx - v1n * nx + v1n2 * nx,
		fvy: fly.vy - v1n * ny + v1n2 * ny,
		hvx: hit.vx - v2n * nx + v2n2 * nx,
		hvy: hit.vy - v2n * ny + v2n2 * ny
	};
};

//#endregion
//#region src/shared/score.ts
const SCORE_MIN_SPEED = 400;
/** 每 100 px/s 记 1 分（基准尺寸 462px 下） */
const SCORE_SPEED_PER_POINT = 100;
const clickScore = (speed, size) => {
	if (speed <= 0 || size <= 0) return 0;
	return Math.max(1, Math.round(speed / SCORE_SPEED_PER_POINT * (PET_REF_WIDTH / size)));
};

//#endregion
//#region src/shared/score-popup.ts
const SCORE_POPUP_DURATION_MS = 2200;
const SCORE_POPUP_CSS = [
	".dsh-pet-desktop-score{position:fixed;z-index:2147483002;min-width:120px;text-align:center;",
	"background:rgba(255,255,255,.97);border:1px solid rgba(255,179,0,.35);border-radius:12px;",
	"box-shadow:0 10px 32px rgba(0,0,0,.22);padding:8px 16px 9px;user-select:none;pointer-events:auto;",
	"font-family:'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif;}",
	".dsh-pet-desktop-score.is-in{animation:dshPetScorePop .28s ease}",
	".dsh-pet-desktop-score-val{font-size:22px;line-height:1.25;font-weight:700;color:#ff8f00;font-variant-numeric:tabular-nums}",
	".dsh-pet-desktop-score-sub{font-size:11px;line-height:1.4;color:rgba(43,43,43,.6);margin-top:2px;white-space:nowrap}",
	".dsh-pet-desktop-score-burst{position:fixed;inset:0;pointer-events:none;z-index:2147483002}",
	".dsh-pet-desktop-score-particle{position:absolute;border-radius:50%;pointer-events:none}",
	"@keyframes dshPetScorePop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}"
].join("");
/** 粒子只注入一次（同 CHAT_CSS 的 injectChatCss 模式） */
let scoreCssInjected = false;
function injectScoreCss() {
	if (scoreCssInjected || typeof document === "undefined") return;
	scoreCssInjected = true;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet-desktop";
	tag.dataset.pluginCss = "dsh-pet-desktop/score";
	tag.textContent = SCORE_POPUP_CSS;
	document.head.appendChild(tag);
}
/** 粒子数量 */
const BURST_COUNT = 20;
/** 初速范围（px/s） */
const BURST_SPEED_MIN = 120;
const BURST_SPEED_MAX = 460;
/** 重力（px/s²）：粒子向上喷出后回落 */
const BURST_GRAVITY = 700;
/** 单粒子寿命范围（ms） */
const BURST_LIFE_MIN = 500;
const BURST_LIFE_MAX = 900;
/** 粒子半径范围（px） */
const BURST_RADIUS_MIN = 3;
const BURST_RADIUS_MAX = 7;
/** 暖色盘（积分/庆祝感） */
const BURST_COLORS = [
	"#ffb300",
	"#ff8f00",
	"#ff7043",
	"#f4511e",
	"#ffc400",
	"#ffd54f",
	"#ef5350"
];
function spawnScoreBurst(x, y) {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	injectScoreCss();
	const root = document.createElement("div");
	root.className = "dsh-pet-desktop-score-burst";
	document.body.appendChild(root);
	const parts = [];
	for (let i = 0; i < BURST_COUNT; i++) {
		const angle = Math.random() * Math.PI * 2;
		const speed = BURST_SPEED_MIN + Math.random() * (BURST_SPEED_MAX - BURST_SPEED_MIN);
		const r = BURST_RADIUS_MIN + Math.random() * (BURST_RADIUS_MAX - BURST_RADIUS_MIN);
		const el = document.createElement("div");
		el.className = "dsh-pet-desktop-score-particle";
		el.style.left = x + "px";
		el.style.top = y + "px";
		el.style.width = r * 2 + "px";
		el.style.height = r * 2 + "px";
		el.style.background = BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)];
		root.appendChild(el);
		parts.push({
			el,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed - 80,
			t0: performance.now(),
			life: BURST_LIFE_MIN + Math.random() * (BURST_LIFE_MAX - BURST_LIFE_MIN)
		});
	}
	const step = () => {
		const now = performance.now();
		let alive = false;
		for (const p of parts) {
			const tSec = (now - p.t0) / 1e3;
			const lifeRatio = (now - p.t0) / p.life;
			if (lifeRatio >= 1) continue;
			alive = true;
			p.el.style.transform = "translate(" + p.vx * tSec + "px," + (p.vy * tSec + .5 * BURST_GRAVITY * tSec * tSec) + "px)";
			p.el.style.opacity = String(Math.max(0, 1 - lifeRatio));
		}
		if (alive) requestAnimationFrame(step);
		else root.remove();
	};
	requestAnimationFrame(step);
}
function mountScorePopup(opts) {
	injectScoreCss();
	const x = opts.x;
	const y = opts.y;
	const root = document.createElement("div");
	root.className = "dsh-pet-desktop-score";
	const val = document.createElement("div");
	val.className = "dsh-pet-desktop-score-val";
	val.textContent = "+" + opts.score;
	const sub = document.createElement("div");
	sub.className = "dsh-pet-desktop-score-sub";
	sub.textContent = "速度 " + Math.round(opts.speed) + " · 大小 " + Math.round(opts.size);
	root.appendChild(val);
	root.appendChild(sub);
	document.body.appendChild(root);
	const rr = root.getBoundingClientRect();
	root.style.left = Math.max(4, Math.min(x - rr.width / 2, window.innerWidth - rr.width - 4)) + "px";
	root.style.top = Math.max(4, y - rr.height - 14) + "px";
	root.offsetWidth;
	root.classList.add("is-in");
	let closed = false;
	let timer = null;
	const close = () => {
		if (closed) return;
		closed = true;
		if (timer !== null) window.clearTimeout(timer);
		timer = null;
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		root.remove();
		if (opts.onClose) opts.onClose();
	};
	const mountedAt = performance.now();
	let graceConsumed = false;
	const onDocPointerDown = (e) => {
		if (closed) return;
		if (!graceConsumed) {
			graceConsumed = true;
			if (e.timeStamp - mountedAt < 300) return;
		}
		if (root.contains(e.target)) return;
		close();
	};
	const onDocKeyDown = (e) => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	timer = window.setTimeout(close, SCORE_POPUP_DURATION_MS);
	return {
		el: root,
		close
	};
}

//#endregion
//#region src/shared/work-status.ts
const WORK_STATUS_STATES = [
	"thinking",
	"working",
	"result",
	"waiting",
	"success",
	"error"
];
const WORK_STATUS_INDEX = {
	thinking: 0,
	working: 1,
	result: 2,
	waiting: 3,
	success: 4,
	error: 5
};
const TIMEOUT_MS = 1e4;
async function fetchWorkStatus(baseUrl = "/dsh-pet-desktop-7340/work-status") {
	const res = await fetch(baseUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!res.ok) throw new Error("dsh-pet-desktop: work-status HTTP " + res.status);
	const raw = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet-desktop: work-status 响应非法");
	const state = raw.state === null || WORK_STATUS_STATES.includes(raw.state) ? raw.state : null;
	return {
		state,
		task: typeof raw.task === "string" ? raw.task : null,
		ts: Number(raw.ts) || 0
	};
}

//#endregion
//#region src/shared/pomodoro.ts
const DEFAULT_POMODORO_SETTINGS = {
	focusMinutes: 25,
	shortBreakMinutes: 5,
	longBreakMinutes: 15,
	longBreakEvery: 4,
	showBubble: true,
	notifications: true
};
function durationSeconds(phase, settings = DEFAULT_POMODORO_SETTINGS) {
	const minutes = phase === "focus" ? settings.focusMinutes : phase === "shortBreak" ? settings.shortBreakMinutes : settings.longBreakMinutes;
	return minutes * 60;
}
function createPomodoroState() {
	return {
		phase: "focus",
		remainingSeconds: durationSeconds("focus"),
		running: false,
		endsAt: null,
		todoId: null,
		completedFocusCycles: 0,
		sequence: 0
	};
}
function remaining(state, now) {
	return state.running && state.endsAt !== null ? Math.max(0, Math.ceil((state.endsAt - now) / 1e3)) : state.remainingSeconds;
}
function startTimer(state, todoId, now, settings = DEFAULT_POMODORO_SETTINGS) {
	if (state.running) return state;
	const seconds = state.remainingSeconds > 0 ? state.remainingSeconds : durationSeconds(state.phase, settings);
	return {
		...state,
		todoId,
		remainingSeconds: seconds,
		running: true,
		endsAt: now + seconds * 1e3,
		sequence: state.sequence + 1
	};
}
function pauseTimer(state, now) {
	if (!state.running) return state;
	return {
		...state,
		remainingSeconds: remaining(state, now),
		running: false,
		endsAt: null,
		sequence: state.sequence + 1
	};
}
function resumeTimer(state, now) {
	return startTimer(state, state.todoId, now);
}
function nextPhase(state, settings) {
	const completedFocusTodoId = state.phase === "focus" ? state.todoId : null;
	const completedFocusCycles = state.completedFocusCycles + (state.phase === "focus" ? 1 : 0);
	const phase = state.phase === "focus" ? completedFocusCycles % settings.longBreakEvery === 0 ? "longBreak" : "shortBreak" : "focus";
	return {
		state: {
			...state,
			phase,
			remainingSeconds: durationSeconds(phase, settings),
			running: false,
			endsAt: null,
			todoId: phase === "focus" ? state.todoId : null,
			completedFocusCycles,
			sequence: state.sequence + 1
		},
		completedFocusTodoId
	};
}
function advanceTimer(state, now, settings = DEFAULT_POMODORO_SETTINGS) {
	if (!state.running || state.endsAt === null || state.endsAt > now) return {
		state,
		completedFocusTodoId: null
	};
	return nextPhase(state, settings);
}
function skipTimer(state, _now, settings = DEFAULT_POMODORO_SETTINGS) {
	const transition = nextPhase(state, settings);
	return {
		state: {
			...transition.state,
			completedFocusCycles: state.completedFocusCycles
		},
		completedFocusTodoId: null
	};
}
function resetTimer(state, settings = DEFAULT_POMODORO_SETTINGS) {
	return {
		...state,
		phase: "focus",
		remainingSeconds: durationSeconds("focus", settings),
		running: false,
		endsAt: null,
		todoId: null,
		sequence: state.sequence + 1
	};
}

//#endregion
//#region src/shared/todo.ts
function validateTitle(title) {
	const normalized = title.trim();
	if (!normalized) throw new TypeError("Todo title must not be blank");
	return normalized;
}
function validateEstimate(value) {
	if (!Number.isInteger(value) || value < 0) throw new RangeError("Todo estimate must be a nonnegative integer");
	return value;
}
function createTodo(items, input$1, now) {
	const id = input$1.id?.trim() || globalThis.crypto.randomUUID();
	if (items.some((item$1) => item$1.id === id)) throw new Error(`Todo id already exists: ${id}`);
	const item = {
		id,
		title: validateTitle(input$1.title),
		notes: input$1.notes?.trim() ?? "",
		completed: false,
		estimatedPomodoros: validateEstimate(input$1.estimatedPomodoros ?? 1),
		completedPomodoros: 0,
		order: items.reduce((max, current) => Math.max(max, current.order), -1) + 1,
		createdAt: now,
		updatedAt: now
	};
	return [...items, item];
}
function updateTodo(items, id, patch, now) {
	return items.map((item) => {
		if (item.id !== id) return item;
		const updated = {
			...item,
			updatedAt: now
		};
		if (patch.title !== void 0) updated.title = validateTitle(patch.title);
		if (patch.notes !== void 0) updated.notes = patch.notes.trim();
		if (patch.estimatedPomodoros !== void 0) updated.estimatedPomodoros = validateEstimate(patch.estimatedPomodoros);
		return updated;
	});
}
function setTodoCompleted(items, id, completed, now) {
	return items.map((item) => item.id === id ? {
		...item,
		completed,
		updatedAt: now
	} : item);
}
function deleteTodo(items, id) {
	return items.filter((item) => item.id !== id);
}
function reorderTodos(items, orderedIds, now) {
	const ids = new Set(orderedIds);
	if (ids.size !== orderedIds.length || ids.size !== items.length || items.some((item) => !ids.has(item.id))) throw new Error("Todo reorder ids must contain each task exactly once");
	const byId = new Map(items.map((item) => [item.id, item]));
	return orderedIds.map((id, order) => ({
		...byId.get(id),
		order,
		updatedAt: now
	}));
}
function recordCompletedFocus(items, id, now) {
	if (id === null) return items;
	return items.map((item) => item.id === id ? {
		...item,
		completedPomodoros: item.completedPomodoros + 1,
		updatedAt: now
	} : item);
}

//#endregion
//#region src/shared/productivity.ts
function createProductivitySnapshot() {
	return {
		version: 1,
		todos: [],
		pomodoro: {
			settings: { ...DEFAULT_POMODORO_SETTINGS },
			state: createPomodoroState()
		}
	};
}
function productivityBubbleText(snapshot, now) {
	const { settings, state } = snapshot.pomodoro;
	const configuredDuration = durationSeconds(state.phase, settings);
	if (!settings.showBubble || !state.running && state.remainingSeconds >= configuredDuration) return null;
	const seconds = state.running && state.endsAt !== null ? Math.max(0, Math.ceil((state.endsAt - now) / 1e3)) : state.remainingSeconds;
	const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
	const phase = state.phase === "focus" ? "专注中" : state.phase === "shortBreak" ? "短休息" : "长休息";
	const todo = snapshot.todos.find((item) => item.id === state.todoId);
	return `${phase} ${clock}${todo ? ` · ${todo.title} ${todo.completedPomodoros}/${todo.estimatedPomodoros}` : ""}`;
}
function validateSettings(settings) {
	if (!settings || !Number.isInteger(settings.focusMinutes) || settings.focusMinutes < 1 || settings.focusMinutes > 180 || !Number.isInteger(settings.shortBreakMinutes) || settings.shortBreakMinutes < 1 || settings.shortBreakMinutes > 60 || !Number.isInteger(settings.longBreakMinutes) || settings.longBreakMinutes < 1 || settings.longBreakMinutes > 120 || !Number.isInteger(settings.longBreakEvery) || settings.longBreakEvery < 1 || settings.longBreakEvery > 12 || typeof settings.showBubble !== "boolean" || typeof settings.notifications !== "boolean") throw new RangeError("Invalid Pomodoro settings");
	return { ...settings };
}
function reconcile(snapshot, now) {
	const transition = advanceTimer(snapshot.pomodoro.state, now, snapshot.pomodoro.settings);
	if (transition.state === snapshot.pomodoro.state) return snapshot;
	return {
		...snapshot,
		todos: recordCompletedFocus(snapshot.todos, transition.completedFocusTodoId, now),
		pomodoro: {
			...snapshot.pomodoro,
			state: transition.state
		}
	};
}
function applyProductivityAction(snapshot, action, now) {
	const current = reconcile(snapshot, now);
	const { state, settings } = current.pomodoro;
	switch (action.type) {
		case "reconcile": return current;
		case "start": {
			const todoId = action.todoId === void 0 ? state.todoId : action.todoId;
			if (todoId !== null && !current.todos.some((todo) => todo.id === todoId && !todo.completed)) throw new Error("Selected Todo does not exist or is already complete");
			return {
				...current,
				pomodoro: {
					...current.pomodoro,
					state: startTimer(state, state.phase === "focus" ? todoId : null, now, settings)
				}
			};
		}
		case "pause": return {
			...current,
			pomodoro: {
				...current.pomodoro,
				state: pauseTimer(state, now)
			}
		};
		case "resume": return {
			...current,
			pomodoro: {
				...current.pomodoro,
				state: resumeTimer(state, now)
			}
		};
		case "skip": return {
			...current,
			pomodoro: {
				...current.pomodoro,
				state: skipTimer(state, now, settings).state
			}
		};
		case "reset": return {
			...current,
			pomodoro: {
				...current.pomodoro,
				state: resetTimer(state, settings)
			}
		};
		case "selectTodo": {
			if (action.todoId !== null && !current.todos.some((todo) => todo.id === action.todoId && !todo.completed)) throw new Error("Selected Todo does not exist or is already complete");
			return {
				...current,
				pomodoro: {
					...current.pomodoro,
					state: {
						...state,
						todoId: state.phase === "focus" ? action.todoId : null
					}
				}
			};
		}
		case "settings.update": {
			const nextSettings = validateSettings(action.settings);
			return {
				...current,
				pomodoro: {
					settings: nextSettings,
					state: state.running ? state : {
						...state,
						remainingSeconds: durationSeconds(state.phase, nextSettings)
					}
				}
			};
		}
		case "todo.create": return {
			...current,
			todos: createTodo(current.todos, action.todo, now)
		};
		case "todo.update": return {
			...current,
			todos: updateTodo(current.todos, action.todoId, action.patch, now)
		};
		case "todo.complete": {
			const todos = setTodoCompleted(current.todos, action.todoId, action.completed, now);
			const selected = state.todoId === action.todoId && action.completed ? null : state.todoId;
			return {
				...current,
				todos,
				pomodoro: {
					...current.pomodoro,
					state: selected === state.todoId ? state : {
						...state,
						todoId: selected
					}
				}
			};
		}
		case "todo.delete": {
			const selected = state.todoId === action.todoId ? null : state.todoId;
			return {
				...current,
				todos: deleteTodo(current.todos, action.todoId),
				pomodoro: {
					...current.pomodoro,
					state: selected === state.todoId ? state : {
						...state,
						todoId: selected
					}
				}
			};
		}
		case "todo.reorder": return {
			...current,
			todos: reorderTodos(current.todos, action.orderedIds, now)
		};
	}
}

//#endregion
//#region src/shared/productivity-panel.ts
/** 物理参数合法性：与宿主的 physicsValid 同一套规则（非法宿主会回 400，这里先就地红字） */
function physicsValid(p) {
	return Number.isFinite(p.gravity) && p.gravity >= 0 && Number.isFinite(p.restitution) && p.restitution >= 0 && p.restitution <= 1 && Number.isFinite(p.groundFriction) && p.groundFriction >= 0 && Number.isFinite(p.throwPower) && p.throwPower > 0;
}
const CSS = `
/* 「气泡框」外观（右键菜单 →「配置桌宠」/「番茄钟与 Todo」）：不再压暗全屏，
   整块面板就是浮在桌宠上方的一枚白色圆润气泡（底部小尾巴指向宠物），
   圆角/投影/字体与对话气泡（CHAT_CSS）同一套观感，只是尺寸更大。
   注意：card 不能 overflow:hidden（会把 ::after 尾巴裁掉），因此圆角由 head/content 各自收边。 */
.dshpd-backdrop{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:26px;box-sizing:border-box;background:transparent;pointer-events:auto;font:14px/1.6 'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif;color:#2b2b2b}
.dshpd-backdrop *{box-sizing:border-box}
.dshpd-card{position:relative;width:min(780px,100%);max-height:min(880px,94vh);display:flex;flex-direction:column;border-radius:24px;background:rgba(255,255,255,.97);box-shadow:0 18px 52px rgba(0,0,0,.22),0 2px 6px rgba(0,0,0,.08)}
.dshpd-card::after{content:"";position:absolute;left:50%;bottom:-13px;transform:translateX(-50%);border:13px solid transparent;border-top-color:rgba(255,255,255,.97);border-bottom:none}
.dshpd-head{display:flex;align-items:center;gap:12px;padding:18px 22px 14px;border-radius:24px 24px 0 0;border-bottom:1px solid rgba(43,43,43,.07);background:rgba(246,248,252,.72)}
.dshpd-mark{width:38px;height:38px;display:grid;place-items:center;flex:none;border-radius:12px;background:linear-gradient(145deg,#dbeafe,#ede9fe);font-size:19px}
.dshpd-heading{min-width:0;flex:1}.dshpd-title{margin:0;font-size:18px;line-height:1.3;font-weight:700;letter-spacing:-.01em;color:#1f2a44}.dshpd-subtitle{margin:3px 0 0;color:#78849a;font-size:12px}
.dshpd-close{width:32px;height:32px;border:0;border-radius:10px;background:#f0f2f7;color:#68748a;font-size:19px;line-height:1;cursor:pointer}.dshpd-close:hover{background:#e4e8f0;color:#253149}
.dshpd-content{overflow:auto;padding:18px 22px 22px;border-radius:0 0 24px 24px;scrollbar-width:thin;scrollbar-color:#c8cfdb transparent}
.dshpd-status{min-height:20px;margin:0 0 12px;font-size:12px;color:#64748b}.dshpd-status[data-kind=ok]{color:#17804a}.dshpd-status[data-kind=error]{color:#c13e4b}
.dshpd-card button,.dshpd-card input,.dshpd-card textarea,.dshpd-card select{font:inherit}.dshpd-card button{border:0;cursor:pointer}
.dshpd-field{display:flex;flex-direction:column;gap:5px;min-width:0}.dshpd-field>span,.dshpd-field>label{font-size:12px;font-weight:650;color:#64718a}
.dshpd-field textarea{resize:vertical;line-height:1.55;font-family:inherit}
.dshpd-control{width:100%;min-height:36px;padding:8px 10px;border:1px solid #dce2ed;border-radius:10px;background:#fff;color:#27334b;outline:none}.dshpd-control:focus{border-color:#8b9dff;box-shadow:0 0 0 3px rgba(101,120,255,.13)}
.dshpd-check{display:flex;align-items:center;gap:9px;min-height:32px;color:#44516a;font-size:13px}.dshpd-check input{width:16px;height:16px;accent-color:#6679ef}
.dshpd-primary,.dshpd-secondary,.dshpd-danger,.dshpd-icon{min-height:34px;padding:8px 13px;border-radius:10px;font-weight:650;transition:transform .15s,background .15s}.dshpd-primary{background:#586de8;color:#fff;box-shadow:0 5px 13px rgba(88,109,232,.22)}.dshpd-primary:hover{background:#465cda;transform:translateY(-1px)}.dshpd-secondary{background:#edf0f6;color:#46536d}.dshpd-secondary:hover{background:#e1e6ef}.dshpd-danger{background:#fff0f1;color:#bd4652}.dshpd-danger:hover{background:#ffe2e4}.dshpd-icon{min-width:32px;padding:6px 9px;background:#f0f2f7;color:#65718a}
.dshpd-primary:disabled,.dshpd-secondary:disabled,.dshpd-danger:disabled{opacity:.55;cursor:wait;transform:none}
.dshpd-config-layout{display:grid;grid-template-columns:200px minmax(0,1fr);gap:16px;min-height:340px}.dshpd-pet-sidebar{padding:10px;border:1px solid rgba(43,43,43,.09);border-radius:16px;background:rgba(246,248,252,.85)}.dshpd-pet-sidebar-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;font-size:13px;font-weight:700;color:#485570}.dshpd-pet-list{display:flex;flex-direction:column;gap:5px}.dshpd-pet-choice{display:flex;align-items:center;gap:9px;width:100%;padding:8px 10px;border-radius:10px;background:transparent;text-align:left;color:#4b5870;font-size:13px}.dshpd-pet-choice:hover{background:#edf0f8}.dshpd-pet-choice[data-active=true]{background:#e7ebff;color:#394fc5;font-weight:700}.dshpd-pet-dot{width:26px;height:26px;display:grid;place-items:center;border-radius:8px;background:#fff;font-size:14px}.dshpd-pet-editor{display:flex;flex-direction:column;min-width:0}.dshpd-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.dshpd-check-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px 14px;padding:10px 12px;border:1px solid rgba(43,43,43,.08);border-radius:13px;background:#fff}.dshpd-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(43,43,43,.09)}.dshpd-button-row{display:flex;align-items:center;gap:8px}.dshpd-muted{color:#8590a3;font-size:12px}
/* 分组卡片（配置面板的信息分区：桌宠 / 全局开关 / 物理）与字段说明 */
.dshpd-block{margin-bottom:14px;padding:14px 16px;border:1px solid rgba(43,43,43,.09);border-radius:16px;background:rgba(249,250,253,.9)}.dshpd-block:last-of-type{margin-bottom:0}.dshpd-block-head{display:flex;align-items:baseline;gap:10px;margin:0 0 12px}.dshpd-block-title{margin:0;font-size:14px;font-weight:740;color:#313d57}.dshpd-block-note{margin-left:auto;font-size:11px;line-height:1.5;color:#98a1b2;text-align:right}.dshpd-block-body{display:flex;flex-direction:column;gap:12px}.dshpd-hint{margin:0;font-size:11px;line-height:1.5;color:#8a94a6}
.dshpd-toggle-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px}.dshpd-toggle{display:flex;flex-direction:column;gap:3px;min-width:0;font-size:13px;color:#44516a;cursor:pointer}.dshpd-toggle>span:first-child{display:flex;align-items:center;gap:8px}.dshpd-toggle input{width:16px;height:16px;flex:none;accent-color:#6679ef}.dshpd-toggle-label{font-weight:600;color:#3c4864}.dshpd-toggle-hint{padding-left:24px;font-size:11px;line-height:1.5;color:#8a94a6}
.dshpd-timer{padding:20px;border:1px solid rgba(43,43,43,.09);border-radius:18px;background:radial-gradient(circle at 85% 0%,rgba(214,220,255,.62),transparent 42%),linear-gradient(135deg,#fff,#f4f6ff);text-align:center}.dshpd-phase{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:#e9edff;color:#4e61cc;font-size:12px;font-weight:750}.dshpd-clock{margin:10px 0 4px;font-size:clamp(48px,10vw,72px);font-weight:760;line-height:1;letter-spacing:-.06em;font-variant-numeric:tabular-nums;color:#252f4b}.dshpd-timer-caption{min-height:20px;color:#7d879a;font-size:12px}.dshpd-timer-controls{display:flex;justify-content:center;gap:8px;margin-top:17px}.dshpd-timer-controls button{min-width:82px}.dshpd-task-picker{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:10px;max-width:480px;margin:17px auto 0;text-align:left}.dshpd-task-picker>span{font-size:12px;font-weight:650;color:#69758d}.dshpd-cycle{margin-top:12px;color:#79849a;font-size:12px}
.dshpd-section{margin-top:18px;padding:17px;border:1px solid rgba(43,43,43,.09);border-radius:16px;background:rgba(249,250,253,.9)}.dshpd-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 13px}.dshpd-section-title{margin:0;color:#313d57;font-size:15px;font-weight:740}.dshpd-todo-form{display:grid;grid-template-columns:minmax(0,1fr) 100px auto;gap:8px;margin-bottom:12px}.dshpd-todos{display:flex;flex-direction:column;gap:7px;margin:0;padding:0;list-style:none}.dshpd-todo{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid rgba(43,43,43,.09);border-radius:12px;background:#fff}.dshpd-todo[data-dragging=true]{opacity:.48}.dshpd-todo[data-over=true]{border-color:#8594f4;background:#f5f6ff}.dshpd-todo>input[type=checkbox]{width:17px;height:17px;flex:none;accent-color:#6477e8}.dshpd-todo-main{flex:1;min-width:0}.dshpd-todo-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#35415a;font-weight:650}.dshpd-todo[data-completed=true] .dshpd-todo-title{text-decoration:line-through;color:#99a1af}.dshpd-todo-meta{margin-top:2px;color:#8892a5;font-size:11px}.dshpd-todo-actions{display:flex;gap:4px}.dshpd-todo-edit{display:grid;grid-template-columns:minmax(0,1fr) 72px;gap:7px;width:100%}.dshpd-todo-edit textarea{grid-column:1/-1;min-height:52px;resize:vertical}.dshpd-todo-edit-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:6px}.dshpd-settings{margin-top:15px;border:1px solid rgba(43,43,43,.09);border-radius:14px;background:#fff}.dshpd-settings summary{padding:12px 15px;cursor:pointer;color:#4a5670;font-weight:700}.dshpd-settings-inner{display:flex;flex-direction:column;gap:13px;padding:0 15px 15px}.dshpd-settings-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.dshpd-empty{padding:18px;border:1px dashed #d6dce7;border-radius:12px;text-align:center;color:#8791a4;font-size:13px}
@media(max-width:600px){.dshpd-backdrop{padding:10px}.dshpd-card{max-height:96vh;border-radius:18px}.dshpd-card::after{bottom:-11px;border-width:11px}.dshpd-head{padding:14px 15px;border-radius:18px 18px 0 0}.dshpd-content{padding:14px 15px 16px;border-radius:0 0 18px 18px}.dshpd-config-layout{grid-template-columns:1fr;gap:12px}.dshpd-pet-list{flex-direction:row;flex-wrap:wrap}.dshpd-form-grid{grid-template-columns:1fr 1fr}.dshpd-toggle-grid{grid-template-columns:1fr}.dshpd-todo-form{grid-template-columns:minmax(0,1fr) 80px}.dshpd-todo-form button{grid-column:1/-1}.dshpd-settings-grid{grid-template-columns:1fr 1fr}.dshpd-todo-actions .dshpd-icon{min-width:30px;padding:5px 7px}}
`;
function formatPomodoroTime(seconds) {
	const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
	return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
function productivityActionUrl(baseUrl) {
	return baseUrl.replace(/\/$/, "").replace(/\/productivity$/, "/productivity/action");
}
function node(tag, className, text) {
	const item = document.createElement(tag);
	if (className) item.className = className;
	if (text !== void 0) item.textContent = text;
	return item;
}
function field(label, control) {
	const wrap = node("label", "dshpd-field");
	wrap.append(node("span", void 0, label), control);
	return wrap;
}
function input(type, value, min, max) {
	const control = node("input", "dshpd-control");
	control.type = type;
	control.value = String(value);
	if (min !== void 0) control.min = String(min);
	if (max !== void 0) control.max = String(max);
	return control;
}
function select(options, value) {
	const control = node("select", "dshpd-control");
	for (const [optionValue, label] of options) {
		const option = node("option", void 0, label);
		option.value = optionValue;
		control.append(option);
	}
	control.value = value;
	return control;
}
function button(label, style = "secondary") {
	return node("button", `dshpd-${style}`, label);
}
function checkbox(label, checked) {
	const wrap = node("label", "dshpd-check");
	const control = node("input");
	control.type = "checkbox";
	control.checked = checked;
	wrap.append(control, document.createTextNode(label));
	return wrap;
}
/** 字段说明（一行小灰字，跟在控件下方；值语义/token 代价之类的解释写在这里） */
function hint(text) {
	return node("p", "dshpd-hint", text);
}
/** 分组卡片：标题 + 右侧备注（如「全局，所有桌宠共用」）+ 内容体 */
function block(title, note = "") {
	const root = node("section", "dshpd-block");
	const head = node("div", "dshpd-block-head");
	head.append(node("h3", "dshpd-block-title", title));
	if (note) head.append(node("span", "dshpd-block-note", note));
	const body = node("div", "dshpd-block-body");
	root.append(head, body);
	return {
		root,
		body
	};
}
/** 开关单元（勾选框 + 标题在上、说明在下；整格可点） */
function toggleCell(label, hintText, checked, onChange) {
	const wrap = node("label", "dshpd-toggle");
	const top = node("span");
	const control = node("input");
	control.type = "checkbox";
	control.checked = checked;
	control.onchange = () => onChange(control.checked);
	const text = node("span", "dshpd-toggle-label", label);
	top.append(control, text);
	wrap.append(top, node("span", "dshpd-toggle-hint", hintText));
	return wrap;
}
/** 数字字段（输入即写回调用方状态；说明跟在下面） */
function numberField(label, value, hintText, onInput, opts = {}) {
	const control = input("number", value, opts.min, opts.max);
	if (opts.step !== void 0) control.step = String(opts.step);
	control.oninput = () => onInput(Number(control.value));
	const wrap = field(label, control);
	wrap.append(hint(hintText));
	return wrap;
}
/** 下拉字段（说明跟在下面） */
function selectField(label, options, value, hintText, onChange) {
	const control = select(options, value);
	control.onchange = () => onChange(control.value);
	const wrap = field(label, control);
	wrap.append(hint(hintText));
	return wrap;
}
async function requestJson(url, init) {
	const response = await fetch(url, {
		cache: "no-store",
		...init
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
	return body;
}
function setStatus(target, message, kind = "") {
	target.textContent = message;
	target.dataset.kind = kind;
}
function configUrl(baseUrl) {
	return baseUrl.replace(/\/$/, "").replace(/\/productivity$/, "/config");
}
function mountProductivityPanel(baseUrl, mode = "productivity", options = {}) {
	document.querySelector("[data-dshpd-panel=\"root\"]")?.remove();
	document.querySelector("[data-dshpd-panel=\"style\"]")?.remove();
	const style = node("style");
	style.dataset.dshpdPanel = "style";
	style.textContent = CSS;
	document.head.append(style);
	const backdrop = node("div", "dshpd-backdrop");
	backdrop.dataset.dshpdPanel = "root";
	const card = node("section", "dshpd-card");
	card.setAttribute("role", "dialog");
	card.setAttribute("aria-modal", "true");
	card.setAttribute("aria-labelledby", "dshpd-title");
	const header = node("header", "dshpd-head");
	const mark = node("div", "dshpd-mark", mode === "config" ? "🐟" : "🍅");
	mark.setAttribute("aria-hidden", "true");
	const heading = node("div", "dshpd-heading");
	const title = node("h2", "dshpd-title", mode === "config" ? "桌宠设置" : "专注与待办");
	title.id = "dshpd-title";
	const subtitle = node("p", "dshpd-subtitle", mode === "config" ? "显示与位置 · 互动开关 · 窥屏人设 · 全局配图/通知 · 拖拽抛掷手感" : "把专注时间和手头任务放在一起");
	heading.append(title, subtitle);
	const closeButton = button("×", "close");
	closeButton.setAttribute("aria-label", "关闭");
	header.append(mark, heading, closeButton);
	const content = node("main", "dshpd-content");
	const status = node("p", "dshpd-status");
	status.setAttribute("role", "status");
	content.append(status);
	card.append(header, content);
	backdrop.append(card);
	document.body.append(backdrop);
	let isClosed = false;
	const onKeyDown = (event) => {
		if (event.key === "Escape") close();
	};
	const close = () => {
		if (isClosed) return;
		isClosed = true;
		document.removeEventListener("keydown", onKeyDown);
		backdrop.remove();
		style.remove();
		options.onOpenChange?.(false);
	};
	closeButton.onclick = close;
	backdrop.addEventListener("pointerdown", (event) => {
		if (event.target === backdrop) close();
	});
	document.addEventListener("keydown", onKeyDown);
	options.onOpenChange?.(true);
	if (mode === "config") mountConfigEditor(content, status, baseUrl);
	else mountProductivityEditor(content, status, baseUrl);
	return { close };
}
async function mountConfigEditor(content, status, baseUrl) {
	setStatus(status, "正在读取桌宠配置…");
	let config;
	try {
		config = await requestJson(configUrl(baseUrl));
	} catch (error) {
		setStatus(status, error instanceof Error ? error.message : String(error), "error");
		const retry = button("重新加载");
		retry.onclick = () => void mountConfigEditor(content, status, baseUrl);
		content.append(retry);
		return;
	}
	const main = config.main ?? {};
	let pets = Array.isArray(main.pets) ? main.pets.map((pet) => structuredClone(pet)) : [];
	if (!pets.length) {
		setStatus(status, "当前没有桌宠配置。");
		return;
	}
	let selectedId = pets[0].id;
	const globals = {
		notificationsEnabled: main.notificationsEnabled !== false,
		whisperImageEnabled: main.whisperImageEnabled === true,
		chatImageEnabled: main.chatImageEnabled === true,
		confineToScreen: main.confineToScreen === true,
		hideOnFullscreen: main.hideOnFullscreen === true,
		peekScreenEnabled: main.peekScreenEnabled === true,
		peekPomodoroEnabled: main.peekPomodoroEnabled !== false,
		sfxEnabled: main.sfxEnabled !== false
	};
	let sfxVolume = clampSfxVolume(main.sfxVolume);
	let sfxFile = typeof main.sfxDecision === "string" && main.sfxDecision.trim() ? main.sfxDecision.trim() : DEFAULT_SFX_FILE;
	const physics = {
		...DEFAULT_PHYSICS,
		...main.physics ?? {}
	};
	let peekPrompt = typeof main.peekPrompt === "string" ? main.peekPrompt : "";
	let peekIntervalSec = Number(main.eventsRefreshSec?.peek) || 600;
	content.replaceChildren(status);
	const layout = node("div", "dshpd-config-layout");
	const sidebar = node("aside", "dshpd-pet-sidebar");
	const sidebarHead = node("div", "dshpd-pet-sidebar-head");
	sidebarHead.append(node("span", void 0, "桌宠列表"));
	const addPet = button("+ 添加", "icon");
	addPet.title = "以第一只桌宠为模板新增一只";
	sidebarHead.append(addPet);
	const petList = node("div", "dshpd-pet-list");
	sidebar.append(sidebarHead, petList);
	const editor = node("div", "dshpd-pet-editor");
	layout.append(sidebar, editor);
	content.append(layout);
	const renderEditor = () => {
		petList.replaceChildren();
		for (const item of pets) {
			const choice = button("", "pet-choice");
			choice.dataset.active = String(item.id === selectedId);
			const icon = node("span", "dshpd-pet-dot", "🐟");
			const label = node("span", void 0, item.name?.trim() || item.id);
			choice.append(icon, label);
			choice.onclick = () => {
				selectedId = item.id;
				renderEditor();
			};
			petList.append(choice);
		}
		const pet = pets.find((item) => item.id === selectedId) ?? pets[0];
		if (!pet) {
			editor.replaceChildren(node("div", "dshpd-empty", "没有可编辑的桌宠"));
			return;
		}
		selectedId = pet.id;
		editor.replaceChildren();
		const petBlock = block("这只桌宠", `ID：${pet.id}`);
		const identityGrid = node("div", "dshpd-form-grid");
		const name = input("text", pet.name ?? "");
		name.maxLength = 40;
		name.oninput = () => {
			pet.name = name.value;
		};
		const nameField = field("显示名称", name);
		nameField.append(hint("鼠标悬浮桌宠时的提示名，也会加进 AI 人设（你的名字是 X）。可重复；留空按 ID 处理。"));
		const sizeField = numberField("桌宠大小（宽度 px）", pet.size, "高度自动 = 宽度 × 9/16；桌面与浏览器同一尺寸。", (value) => {
			pet.size = value;
		}, {
			min: 80,
			max: 1200,
			step: 10
		});
		identityGrid.append(nameField, sizeField);
		const placeGrid = node("div", "dshpd-form-grid");
		const displayField = selectField("显示范围", [
			["both", "浏览器与桌面"],
			["web", "仅浏览器"],
			["desktop", "仅桌面"],
			["none", "暂不显示"]
		], pet.display, "决定这只桌宠出现在浏览器 overlay / 桌面（透明小窗）哪一侧。", (value) => {
			pet.display = value;
			renderEditor();
		});
		const cornerField = selectField("初始位置", [
			["top-left", "左上角"],
			["top-right", "右上角"],
			["bottom-left", "左下角"],
			["bottom-right", "右下角"]
		], pet.position.corner, "启动落点，也是右键菜单「回到初始位置」回到的角落。", (value) => {
			pet.position.corner = value;
		});
		const marginXField = numberField("水平偏移（px）", pet.position.marginX, "距所选角落的水平距离，可为负数（负 = 更靠外）。", (value) => {
			pet.position.marginX = value;
		});
		const marginYField = numberField("垂直偏移（px）", pet.position.marginY, "距所选角落的垂直距离，可为负数。", (value) => {
			pet.position.marginY = value;
		});
		placeGrid.append(displayField, cornerField, marginXField, marginYField);
		const toggles = node("div", "dshpd-toggle-grid");
		toggles.append(toggleCell("余额互动", "触发余额动画并显示余额气泡（需服务商凭证，未配置时气泡内显式报错）。", pet.balanceEnabled === true, (value) => {
			pet.balanceEnabled = value;
		}), toggleCell("碎碎念", "按周期用 AI 生成一句话并播碎碎念动画（每次生成都会调用当前模型）。", pet.whisperEnabled !== false, (value) => {
			pet.whisperEnabled = value;
		}), toggleCell("工作状态联动", "跟随 DSH 思考/工作中/等待确认/完成/出错切对应动画并弹气泡（仅监听事件，不调用模型）。", pet.workStatusEnabled !== false, (value) => {
			pet.workStatusEnabled = value;
		}), toggleCell("窥屏吐槽", "按「窥屏周期」偷看一眼前台窗口（可选截图），让模型吐槽一句（每次都会调用模型）。仅桌面模式。", pet.peekEnabled === true, (value) => {
			pet.peekEnabled = value;
		}));
		petBlock.body.append(identityGrid, placeGrid, toggles);
		const globalBlock = block("全局开关", "所有桌宠共用 · 保存后生效");
		const globalGrid = node("div", "dshpd-toggle-grid");
		globalGrid.append(toggleCell("系统通知", "对话完成 / 生成失败 / 权限申请在窗口失焦时弹系统级通知（桌面右下角）。", globals.notificationsEnabled, (value) => {
			globals.notificationsEnabled = value;
		}), toggleCell("碎碎念配图", "碎碎念时从表情包池随机抽一张配图；只把这一张的名称+描述带进同一次请求（约 60 token）。", globals.whisperImageEnabled, (value) => {
			globals.whisperImageEnabled = value;
		}), toggleCell("对话配图", "由模型按当前语境从表情包池挑一张配图；每条消息都会附上整张清单（约 650 token 起）。", globals.chatImageEnabled, (value) => {
			globals.chatImageEnabled = value;
		}), toggleCell("抛掷锁定当前屏幕", "多屏时甩出去的桌宠只在松手那块屏幕内弹（屏缝当墙）；关掉则照常跨屏飞行。仅桌面模式。", globals.confineToScreen, (value) => {
			globals.confineToScreen = value;
		}), toggleCell("全屏时隐藏桌宠", "检测到别的应用全屏（游戏 / 全屏视频 / 演示模式）时，自动隐藏被全屏覆盖那块屏上的桌宠，结束后自动恢复；多屏时另一块屏的桌宠照常活动。仅桌面模式（浏览器端只看 Fullscreen API）。注意：隐藏后右键点不到桌宠，要改这个开关请去 DSH 设置页。", globals.hideOnFullscreen, (value) => {
			globals.hideOnFullscreen = value;
		}), toggleCell("窥屏：允许截图", "除窗口标题外再抓一张屏幕截图交给模型——需要多模态模型（当前模型不支持时自动退回只看窗口标题）。注意截图会随请求发给模型服务商。", globals.peekScreenEnabled, (value) => {
			globals.peekScreenEnabled = value;
		}), toggleCell("窥屏：联动番茄钟", "把番茄钟阶段/剩余时间/关联任务写进情报：专注阶段换成督促语气、发现摸鱼直接点名，休息阶段改为放松调侃。", globals.peekPomodoroEnabled, (value) => {
			globals.peekPomodoroEnabled = value;
		}), toggleCell("决定提醒音", "DSH 需要你拍板时（权限申请 / 模型提问 / 回合阻塞）播一段音频提醒。音频文件名与音量在下面那组里改。", globals.sfxEnabled, (value) => {
			globals.sfxEnabled = value;
		}));
		globalBlock.body.append(globalGrid);
		const peekBlock = block("窥屏吐槽人设", "全局 · 保存后生效");
		const peekArea = node("textarea", "dshpd-control");
		peekArea.value = peekPrompt;
		peekArea.rows = 3;
		peekArea.maxLength = 2e3;
		peekArea.placeholder = "例如：你是主人桌面上的Q版蓝发小女仆，会偷偷瞄一眼屏幕然后小小地吐槽一句……";
		peekArea.oninput = () => {
			peekPrompt = peekArea.value;
		};
		const peekField = field("窥屏人设（提示词）", peekArea);
		peekField.append(hint("只写\"你是谁、怎么说话\"；态度规则（专注督促 / 休息放松 / 摸鱼点名）由程序按番茄钟阶段自动追加。留空 = 用内置默认人设。"));
		const peekGrid = node("div", "dshpd-form-grid");
		peekGrid.append(numberField("窥屏周期（秒）", peekIntervalSec, "每这么久偷看一次并生成一句吐槽（每次都会调用一次模型，建议 ≥ 300 秒）。", (value) => {
			peekIntervalSec = value;
		}, {
			min: 30,
			step: 30
		}));
		peekBlock.body.append(peekField, peekGrid);
		const sfxBlock = block("决定提醒音", "全局 · 保存后生效");
		const sfxGrid = node("div", "dshpd-form-grid");
		sfxGrid.append(numberField("音量（0~1）", sfxVolume, "0 = 静音，1 = 满音量；非法值按 0.8 处理。", (value) => {
			sfxVolume = value;
		}, {
			min: 0,
			max: 1,
			step: .1
		}));
		const sfxName = input("text", sfxFile);
		sfxName.maxLength = 128;
		sfxName.placeholder = DEFAULT_SFX_FILE;
		sfxName.oninput = () => {
			sfxFile = sfxName.value.trim();
		};
		const sfxNameField = field("音频文件名", sfxName);
		sfxNameField.append(hint("把音频放到 ~/.dsh/dsh-pet-desktop/main-sound/（用户目录，优先）或包内 assets/sound/，再在这里填文件名（中文名也行）。支持 mp3 / wav / ogg / m4a / aac / opus / flac / webm；文件不存在时完全安静，不会报错也不会播别的。"));
		sfxBlock.body.append(sfxNameField, sfxGrid);
		const physicsBlock = block("拖拽抛掷手感", "全局 · 保存后桌面端自动重载生效");
		const physicsGrid = node("div", "dshpd-form-grid");
		physicsGrid.append(numberField("重力 gravity", physics.gravity, "px/s²，越大落得越快；0 = 无重力（抛出去匀速直飞）。", (value) => {
			physics.gravity = value;
		}, {
			min: 0,
			step: 50
		}), numberField("弹性 restitution", physics.restitution, "0~1，碰壁/落地保留的速度比例（1 = 完全弹性，0 = 撞上即停）。", (value) => {
			physics.restitution = value;
		}, {
			min: 0,
			max: 1,
			step: .05
		}), numberField("地面摩擦 groundFriction", physics.groundFriction, "/s，落地后水平速度衰减率；0 = 冰面不减速。", (value) => {
			physics.groundFriction = value;
		}, {
			min: 0,
			step: .5
		}), numberField("总力度 throwPower", physics.throwPower, "> 0，弹簧跟手与甩出初速的整体倍率（1 = 默认，越大越跟手、甩得越猛）。", (value) => {
			physics.throwPower = value;
		}, {
			min: 0,
			step: .1
		}));
		const physicsToggles = node("div", "dshpd-toggle-grid");
		physicsToggles.append(toggleCell("顶部反弹 ceilingBounce", "关掉后抛掷可飞出屏幕顶部（重力仍会把它拉回来）。", physics.ceilingBounce, (value) => {
			physics.ceilingBounce = value;
		}), toggleCell("宠物互撞 petCollision", "飞行中的桌宠撞到其它桌宠按动量守恒弹开（质量 ∝ 尺寸²）。", physics.petCollision, (value) => {
			physics.petCollision = value;
		}));
		const physicsActions = node("div", "dshpd-button-row");
		const resetPhysics = button("恢复默认物理参数", "secondary");
		resetPhysics.onclick = () => {
			Object.assign(physics, DEFAULT_PHYSICS);
			renderEditor();
			setStatus(status, "物理参数已恢复为默认值，点击「保存并应用」写入。");
		};
		physicsActions.append(resetPhysics);
		physicsBlock.body.append(physicsGrid, physicsToggles, physicsActions);
		const footer = node("div", "dshpd-footer");
		const footerNote = node("span", "dshpd-muted", "改动只在点「保存并应用」后写入用户配置。");
		const footerButtons = node("div", "dshpd-button-row");
		const removePet = button("删除桌宠", "danger");
		removePet.disabled = pets.length < 2;
		removePet.title = pets.length < 2 ? "至少保留一只桌宠" : "";
		removePet.onclick = () => {
			if (pets.length < 2 || !window.confirm(`删除桌宠「${pet.name || pet.id}」？`)) return;
			pets = pets.filter((item) => item.id !== pet.id);
			selectedId = pets[0].id;
			renderEditor();
		};
		const save = button("保存并应用", "primary");
		save.onclick = () => void saveConfig();
		footerButtons.append(removePet, save);
		footer.append(footerNote, footerButtons);
		editor.append(petBlock.root, globalBlock.root, peekBlock.root, sfxBlock.root, physicsBlock.root, footer);
	};
	addPet.onclick = () => {
		const template = pets[0];
		const id = `pet-${globalThis.crypto.randomUUID().slice(0, 8)}`;
		const pet = {
			...structuredClone(template),
			id,
			name: "新桌宠",
			size: template.size || 240,
			balanceEnabled: false,
			whisperEnabled: false,
			workStatusEnabled: false,
			display: "both",
			position: { ...template.position }
		};
		pets.push(pet);
		selectedId = id;
		renderEditor();
	};
	const saveConfig = async () => {
		if (pets.some((pet) => !pet.id || !Number.isFinite(pet.size) || pet.size <= 0 || !Number.isFinite(pet.position.marginX) || !Number.isFinite(pet.position.marginY))) {
			setStatus(status, "请检查桌宠大小与位置数值。", "error");
			return;
		}
		if (!physicsValid(physics)) {
			setStatus(status, "请检查物理参数：重力 / 地面摩擦 ≥ 0，弹性 0~1，总力度 > 0。", "error");
			return;
		}
		if (!Number.isFinite(peekIntervalSec) || peekIntervalSec <= 0) {
			setStatus(status, "请检查窥屏周期：必须是大于 0 的秒数。", "error");
			return;
		}
		if (!Number.isFinite(sfxVolume) || sfxVolume < 0 || sfxVolume > 1) {
			setStatus(status, "请检查提醒音音量：必须在 0~1 之间。", "error");
			return;
		}
		if (!isSoundFileName(sfxFile)) {
			setStatus(status, "请检查提醒音文件名：只填文件名（不要带路径），扩展名需为 mp3/wav/ogg/m4a/aac/opus/flac/webm。", "error");
			return;
		}
		setStatus(status, "正在保存…");
		try {
			const merged = await requestJson(configUrl(baseUrl), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					pets,
					notificationsEnabled: globals.notificationsEnabled,
					whisperImageEnabled: globals.whisperImageEnabled,
					chatImageEnabled: globals.chatImageEnabled,
					confineToScreen: globals.confineToScreen,
					hideOnFullscreen: globals.hideOnFullscreen,
					peekPrompt,
					peekScreenEnabled: globals.peekScreenEnabled,
					peekPomodoroEnabled: globals.peekPomodoroEnabled,
					sfxEnabled: globals.sfxEnabled,
					sfxVolume,
					sfxDecision: sfxFile,
					eventsRefreshSec: {
						...main.eventsRefreshSec ?? {},
						peek: peekIntervalSec
					},
					physics
				})
			});
			window.dispatchEvent(new CustomEvent("dsh-pet-desktop:config-saved", { detail: merged }));
			setStatus(status, "已保存，桌宠配置已应用（桌面端会自动重载宠物窗口）。", "ok");
		} catch (error) {
			setStatus(status, error instanceof Error ? error.message : String(error), "error");
		}
	};
	setStatus(status, "左侧选桌宠，右侧分区编辑；改完点「保存并应用」。");
	renderEditor();
}
async function mountProductivityEditor(content, status, baseUrl) {
	content.replaceChildren(status);
	setStatus(status, "正在读取计时器与待办…");
	let snapshot;
	try {
		snapshot = await requestJson(baseUrl);
	} catch (error) {
		setStatus(status, error instanceof Error ? error.message : String(error), "error");
		return;
	}
	const timer = node("section", "dshpd-timer");
	const phase = node("div", "dshpd-phase");
	const clock = node("div", "dshpd-clock", "25:00");
	const caption = node("div", "dshpd-timer-caption");
	const controls = node("div", "dshpd-timer-controls");
	const primary = button("开始专注", "primary");
	const skip = button("跳过");
	const reset = button("重置");
	controls.append(primary, skip, reset);
	const taskPicker = node("label", "dshpd-task-picker");
	taskPicker.append(node("span", void 0, "专注任务"));
	const selectedTodo = node("select", "dshpd-control");
	taskPicker.append(selectedTodo);
	const cycle = node("div", "dshpd-cycle");
	timer.append(phase, clock, caption, controls, taskPicker, cycle);
	const todoSection = node("section", "dshpd-section");
	const todoHead = node("div", "dshpd-section-head");
	const todoHeader = node("h3", "dshpd-section-title", "待办清单");
	const todoCount = node("span", "dshpd-muted");
	todoHead.append(todoHeader, todoCount);
	const todoForm = node("form", "dshpd-todo-form");
	const newTitle = input("text", "");
	newTitle.placeholder = "添加一件要完成的事";
	newTitle.maxLength = 160;
	newTitle.required = true;
	const newEstimate = input("number", 1, 0, 99);
	newEstimate.title = "预计番茄数";
	newEstimate.setAttribute("aria-label", "预计番茄数");
	const addTodo = button("添加", "primary");
	todoForm.append(newTitle, newEstimate, addTodo);
	const todoList = node("ul", "dshpd-todos");
	todoSection.append(todoHead, todoForm, todoList);
	const settings = node("details", "dshpd-settings");
	const summary = node("summary", void 0, "番茄钟设置");
	const settingsInner = node("div", "dshpd-settings-inner");
	const settingsGrid = node("div", "dshpd-settings-grid");
	const focusInput = input("number", snapshot.pomodoro.settings.focusMinutes, 1, 180);
	const shortInput = input("number", snapshot.pomodoro.settings.shortBreakMinutes, 1, 60);
	const longInput = input("number", snapshot.pomodoro.settings.longBreakMinutes, 1, 120);
	const intervalInput = input("number", snapshot.pomodoro.settings.longBreakEvery, 1, 12);
	settingsGrid.append(field("专注（分钟）", focusInput), field("短休息（分钟）", shortInput), field("长休息（分钟）", longInput), field("几轮后长休息", intervalInput));
	const settingChecks = node("div", "dshpd-check-grid");
	const bubbleToggle = checkbox("在桌宠显示计时状态", snapshot.pomodoro.settings.showBubble);
	const notificationToggle = checkbox("阶段结束时发送系统通知", snapshot.pomodoro.settings.notifications);
	settingChecks.append(bubbleToggle, notificationToggle);
	const settingsFooter = node("div", "dshpd-footer");
	settingsFooter.append(node("span", "dshpd-muted", "默认 25 / 5 / 15 分钟，每 4 轮长休息。"));
	const saveSettings = button("保存设置", "secondary");
	settingsFooter.append(saveSettings);
	settingsInner.append(settingsGrid, settingChecks, settingsFooter);
	settings.append(summary, settingsInner);
	content.append(timer, todoSection, settings);
	let busy = false;
	let draggedTodoId = null;
	const currentRemaining = () => {
		const state = snapshot.pomodoro.state;
		return state.running && state.endsAt !== null ? Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1e3)) : state.remainingSeconds;
	};
	const notifyPhaseChange = (previous, next) => {
		if (previous.pomodoro.state.sequence === next.pomodoro.state.sequence || !next.pomodoro.settings.notifications) return;
		if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
		const label = next.pomodoro.state.phase === "focus" ? "专注时间" : next.pomodoro.state.phase === "shortBreak" ? "短休息" : "长休息";
		try {
			new Notification(`番茄钟：${label}开始`, { body: "上一阶段已经结束。" });
		} catch {}
	};
	const render = () => {
		const state = snapshot.pomodoro.state;
		const names = {
			focus: "专注中",
			shortBreak: "短休息",
			longBreak: "长休息"
		};
		phase.textContent = `${state.phase === "focus" ? "●" : "☕"} ${names[state.phase]}`;
		clock.textContent = formatPomodoroTime(currentRemaining());
		caption.textContent = state.todoId ? `当前任务：${snapshot.todos.find((todo) => todo.id === state.todoId)?.title ?? "未命名任务"}` : "不关联任务也可以独立计时";
		primary.textContent = state.running ? "暂停" : state.remainingSeconds < (state.phase === "focus" ? snapshot.pomodoro.settings.focusMinutes : state.phase === "shortBreak" ? snapshot.pomodoro.settings.shortBreakMinutes : snapshot.pomodoro.settings.longBreakMinutes) * 60 ? "继续" : "开始";
		primary.disabled = busy;
		skip.disabled = busy;
		reset.disabled = busy;
		cycle.textContent = `已完成 ${state.completedFocusCycles} 个专注周期${snapshot.pomodoro.settings.showBubble ? " · 桌宠状态气泡已开启" : ""}`;
		selectedTodo.replaceChildren();
		const noTask = node("option", void 0, "不关联任务");
		noTask.value = "";
		selectedTodo.append(noTask);
		for (const todo of snapshot.todos.filter((item) => !item.completed)) {
			const option = node("option", void 0, todo.title);
			option.value = todo.id;
			selectedTodo.append(option);
		}
		selectedTodo.value = state.todoId ?? "";
		selectedTodo.disabled = busy || state.phase !== "focus";
		todoCount.textContent = `${snapshot.todos.filter((todo) => !todo.completed).length} 项未完成`;
		todoList.replaceChildren();
		if (!snapshot.todos.length) todoList.append(node("li", "dshpd-empty", "清单还是空的，先添加一件小事吧。"));
		for (const todo of snapshot.todos) todoList.append(renderTodo(todo));
		for (const [control, value] of [
			[focusInput, snapshot.pomodoro.settings.focusMinutes],
			[shortInput, snapshot.pomodoro.settings.shortBreakMinutes],
			[longInput, snapshot.pomodoro.settings.longBreakMinutes],
			[intervalInput, snapshot.pomodoro.settings.longBreakEvery]
		]) if (document.activeElement !== control) control.value = String(value);
		bubbleToggle.querySelector("input").checked = snapshot.pomodoro.settings.showBubble;
		notificationToggle.querySelector("input").checked = snapshot.pomodoro.settings.notifications;
	};
	const runAction = async (action, successText = "已保存") => {
		if (busy) return false;
		busy = true;
		setStatus(status, "正在保存…");
		try {
			const next = await requestJson(productivityActionUrl(baseUrl), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(action)
			});
			const previous = snapshot;
			snapshot = next;
			notifyPhaseChange(previous, next);
			busy = false;
			render();
			setStatus(status, successText, "ok");
			return true;
		} catch (error) {
			setStatus(status, error instanceof Error ? error.message : String(error), "error");
			return false;
		} finally {
			busy = false;
		}
	};
	const renderTodo = (todo) => {
		const row = node("li", "dshpd-todo");
		row.draggable = !busy;
		row.dataset.completed = String(todo.completed);
		row.ondragstart = (event) => {
			draggedTodoId = todo.id;
			row.dataset.dragging = "true";
			event.dataTransfer?.setData("text/plain", todo.id);
			if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
		};
		row.ondragend = () => {
			draggedTodoId = null;
			row.dataset.dragging = "false";
			row.dataset.over = "false";
		};
		row.ondragover = (event) => {
			event.preventDefault();
			row.dataset.over = "true";
		};
		row.ondragleave = () => {
			row.dataset.over = "false";
		};
		row.ondrop = (event) => {
			event.preventDefault();
			row.dataset.over = "false";
			const source = event.dataTransfer?.getData("text/plain") || draggedTodoId;
			if (!source || source === todo.id) return;
			const ids = snapshot.todos.map((item) => item.id);
			const from = ids.indexOf(source);
			const to = ids.indexOf(todo.id);
			if (from < 0 || to < 0) return;
			ids.splice(from, 1);
			ids.splice(to, 0, source);
			runAction({
				type: "todo.reorder",
				orderedIds: ids
			}, "排序已保存");
		};
		const complete = node("input");
		complete.type = "checkbox";
		complete.checked = todo.completed;
		complete.disabled = busy;
		complete.setAttribute("aria-label", `标记「${todo.title}」${todo.completed ? "未完成" : "完成"}`);
		complete.onchange = () => void runAction({
			type: "todo.complete",
			todoId: todo.id,
			completed: complete.checked
		}, "任务状态已更新");
		const main = node("div", "dshpd-todo-main");
		const taskTitle = node("div", "dshpd-todo-title", todo.title);
		const taskMeta = node("div", "dshpd-todo-meta", `番茄 ${todo.completedPomodoros}/${todo.estimatedPomodoros} · 拖动可排序`);
		main.append(taskTitle, taskMeta);
		const actions = node("div", "dshpd-todo-actions");
		const edit = button("编辑", "icon");
		edit.onclick = () => beginEdit();
		const up = button("↑", "icon");
		up.title = "上移";
		up.disabled = busy || snapshot.todos[0]?.id === todo.id;
		up.onclick = () => moveTodo(todo.id, -1);
		const down = button("↓", "icon");
		down.title = "下移";
		down.disabled = busy || snapshot.todos[snapshot.todos.length - 1]?.id === todo.id;
		down.onclick = () => moveTodo(todo.id, 1);
		const remove = button("删除", "icon");
		remove.title = "删除待办";
		remove.onclick = () => {
			if (window.confirm(`删除待办「${todo.title}」？`)) runAction({
				type: "todo.delete",
				todoId: todo.id
			}, "任务已删除");
		};
		actions.append(edit, up, down, remove);
		row.append(complete, main, actions);
		const beginEdit = () => {
			const editor = node("div", "dshpd-todo-edit");
			const titleInput = input("text", todo.title);
			titleInput.maxLength = 160;
			const estimateInput = input("number", todo.estimatedPomodoros, 0, 99);
			const notesInput = node("textarea", "dshpd-control");
			notesInput.value = todo.notes;
			notesInput.placeholder = "備注（可选）";
			const buttons = node("div", "dshpd-todo-edit-actions");
			const cancel = button("取消");
			cancel.onclick = render;
			const save = button("保存", "primary");
			save.onclick = () => {
				const patch = {
					title: titleInput.value,
					notes: notesInput.value,
					estimatedPomodoros: Number(estimateInput.value)
				};
				runAction({
					type: "todo.update",
					todoId: todo.id,
					patch
				}, "待办已更新");
			};
			buttons.append(cancel, save);
			editor.append(titleInput, estimateInput, notesInput, buttons);
			main.replaceChildren(editor);
			titleInput.focus();
		};
		return row;
	};
	const moveTodo = (todoId, direction) => {
		const ids = snapshot.todos.map((item) => item.id);
		const index = ids.indexOf(todoId);
		const next = index + direction;
		if (index < 0 || next < 0 || next >= ids.length) return;
		[ids[index], ids[next]] = [ids[next], ids[index]];
		runAction({
			type: "todo.reorder",
			orderedIds: ids
		}, "排序已保存");
	};
	selectedTodo.onchange = () => void runAction({
		type: "selectTodo",
		todoId: selectedTodo.value || null
	}, "专注任务已更新");
	primary.onclick = () => void runAction(snapshot.pomodoro.state.running ? { type: "pause" } : snapshot.pomodoro.state.remainingSeconds < snapshot.pomodoro.settings.focusMinutes * 60 && snapshot.pomodoro.state.phase === "focus" ? { type: "resume" } : snapshot.pomodoro.state.remainingSeconds < (snapshot.pomodoro.state.phase === "shortBreak" ? snapshot.pomodoro.settings.shortBreakMinutes : snapshot.pomodoro.settings.longBreakMinutes) * 60 && snapshot.pomodoro.state.phase !== "focus" ? { type: "resume" } : { type: "start" }, snapshot.pomodoro.state.running ? "计时已暂停" : "计时已开始");
	skip.onclick = () => void runAction({ type: "skip" }, "已切换到下一阶段");
	reset.onclick = () => void runAction({ type: "reset" }, "计时已重置");
	todoForm.onsubmit = (event) => {
		event.preventDefault();
		const todo = {
			title: newTitle.value,
			estimatedPomodoros: Number(newEstimate.value)
		};
		runAction({
			type: "todo.create",
			todo
		}, "待办已添加").then((saved) => {
			if (saved) {
				newTitle.value = "";
				newEstimate.value = "1";
			}
		});
	};
	saveSettings.onclick = () => {
		const nextSettings = {
			focusMinutes: Number(focusInput.value),
			shortBreakMinutes: Number(shortInput.value),
			longBreakMinutes: Number(longInput.value),
			longBreakEvery: Number(intervalInput.value),
			showBubble: bubbleToggle.querySelector("input").checked,
			notifications: notificationToggle.querySelector("input").checked
		};
		runAction({
			type: "settings.update",
			settings: nextSettings
		}, "番茄钟设置已保存");
	};
	notificationToggle.querySelector("input").onchange = async (event) => {
		if (!event.target.checked || typeof Notification === "undefined" || Notification.permission !== "default") return;
		try {
			const permission = await Notification.requestPermission();
			if (permission !== "granted") setStatus(status, "系统通知权限未开启；阶段提醒仍会显示在面板中。");
		} catch {
			setStatus(status, "当前运行环境不支持系统通知。");
		}
	};
	const poll = async () => {
		if (busy) return;
		try {
			const next = await requestJson(baseUrl);
			const previous = snapshot;
			const changed = JSON.stringify(previous) !== JSON.stringify(next);
			snapshot = next;
			notifyPhaseChange(previous, next);
			if (changed) render();
		} catch (error) {
			setStatus(status, error instanceof Error ? error.message : String(error), "error");
		}
	};
	render();
	setStatus(status, "计时与待办会自动保存在本机，并与桌面及浏览器共享。");
	const displayTimer = window.setInterval(() => {
		clock.textContent = formatPomodoroTime(currentRemaining());
	}, 250);
	const pollTimer = window.setInterval(() => void poll(), 2e3);
	const closeObserver = new MutationObserver(() => {
		if (!content.isConnected) {
			window.clearInterval(displayTimer);
			window.clearInterval(pollTimer);
			closeObserver.disconnect();
		}
	});
	closeObserver.observe(document.body, {
		childList: true,
		subtree: true
	});
}

//#endregion
exports.ACCEL_GAIN_MAX = ACCEL_GAIN_MAX
exports.ACCEL_REF = ACCEL_REF
exports.ANIMATION_EXT = ANIMATION_EXT
exports.CANVAS_H = CANVAS_H
exports.CHAT_CSS = CHAT_CSS
exports.DEAD_ZONE_SPEED = DEAD_ZONE_SPEED
exports.DEEPSEEK_FULL_BALANCE_CNY = DEEPSEEK_FULL_BALANCE_CNY
exports.DEFAULT_PHYSICS = DEFAULT_PHYSICS
exports.DEFAULT_SFX_FILE = DEFAULT_SFX_FILE
exports.DEFAULT_SFX_VOLUME = DEFAULT_SFX_VOLUME
exports.DEFAULT_THROW_POWER = DEFAULT_THROW_POWER
exports.DRAG_THRESHOLD = DRAG_THRESHOLD
exports.FEET_Y = FEET_Y
exports.GRAVITY = GRAVITY
exports.GROUND_FRICTION = GROUND_FRICTION
exports.HIT_BOX = HIT_BOX
exports.MAX_BODY = MAX_BODY
exports.MAX_STEP_DT = MAX_STEP_DT
exports.MAX_THROW_SPEED = MAX_THROW_SPEED
exports.MEME_BUBBLE_CLASS = MEME_BUBBLE_CLASS
exports.MEME_BUBBLE_CSS = MEME_BUBBLE_CSS
exports.MEME_IMG_CLASS = MEME_IMG_CLASS
exports.MENU_CSS = MENU_CSS
exports.MIN_SPAN_MS = MIN_SPAN_MS
exports.NOTIFY_ICONS = NOTIFY_ICONS
exports.OPENCODE_QUOTA_USD = OPENCODE_QUOTA_USD
exports.PEAK_WEIGHT = PEAK_WEIGHT
exports.PET_BOUNCE_E = PET_BOUNCE_E
exports.PET_DISPLAYS = PET_DISPLAYS
exports.PET_REF_WIDTH = PET_REF_WIDTH
exports.RELEASE_STALE_MS = RELEASE_STALE_MS
exports.RELEASE_WINDOW_MS = RELEASE_WINDOW_MS
exports.RESTITUTION = RESTITUTION
exports.REST_VX = REST_VX
exports.REST_VY = REST_VY
exports.SCORE_MIN_SPEED = SCORE_MIN_SPEED
exports.SCORE_POPUP_CSS = SCORE_POPUP_CSS
exports.SCORE_POPUP_DURATION_MS = SCORE_POPUP_DURATION_MS
exports.SEG_MIN_DT_MS = SEG_MIN_DT_MS
exports.SFX_POLL_IDLE_MS = SFX_POLL_IDLE_MS
exports.SFX_POLL_MS = SFX_POLL_MS
exports.SOUND_MIME = SOUND_MIME
exports.SPRING_C = SPRING_C
exports.SPRING_K = SPRING_K
exports.SQ_DURATION_MS = SQ_DURATION_MS
exports.SQ_HARD_SPEED = SQ_HARD_SPEED
exports.SQ_MAX_SQUASH = SQ_MAX_SQUASH
exports.SQ_SOFT_SPEED = SQ_SOFT_SPEED
exports.SQ_SQUASH = SQ_SQUASH
exports.TRAIL_KEEP_MS = TRAIL_KEEP_MS
exports.WINDOW_LABELS = WINDOW_LABELS
exports.WORK_STATUS_INDEX = WORK_STATUS_INDEX
exports.WORK_STATUS_STATES = WORK_STATUS_STATES
exports.anchorPixel = anchorPixel
exports.applyProductivityAction = applyProductivityAction
exports.balanceBubbleView = balanceBubbleView
exports.balanceEventIndex = balanceEventIndex
exports.balancePercent = balancePercent
exports.bodyPixelBox = bodyPixelBox
exports.boundingRect = boundingRect
exports.buildMenuTree = buildMenuTree
exports.clampPointInRect = clampPointInRect
exports.clampPointToRegion = clampPointToRegion
exports.clampSfxVolume = clampSfxVolume
exports.clickScore = clickScore
exports.collidePet = collidePet
exports.createMemeImage = createMemeImage
exports.createProductivitySnapshot = createProductivitySnapshot
exports.decideBalanceNotice = decideBalanceNotice
exports.deepseekPricingTier = deepseekPricingTier
exports.distToRectSq = distToRectSq
exports.estimateReleaseVelocity = estimateReleaseVelocity
exports.fetchBalanceState = fetchBalanceState
exports.fetchTriggerCount = fetchTriggerCount
exports.fetchWhisperState = fetchWhisperState
exports.fetchWhisperTrigger = fetchWhisperTrigger
exports.fetchWorkStatus = fetchWorkStatus
exports.flattenConfigPets = flattenConfigPets
exports.formatPomodoroTime = formatPomodoroTime
exports.frameToToast = frameToToast
exports.indexAtPoint = indexAtPoint
exports.injectMemeBubbleCss = injectMemeBubbleCss
exports.isDesktopVisible = isDesktopVisible
exports.isEventAnim = isEventAnim
exports.isNoMirrorAnimation = isNoMirrorAnimation
exports.isSoundFileName = isSoundFileName
exports.isWebVisible = isWebVisible
exports.landingSquash = landingSquash
exports.memeImageUrl = memeImageUrl
exports.mountChatDialog = mountChatDialog
exports.mountContextMenu = mountContextMenu
exports.mountProductivityPanel = mountProductivityPanel
exports.mountScorePopup = mountScorePopup
exports.nearestIndex = nearestIndex
exports.nextWorkStatusAnim = nextWorkStatusAnim
exports.pick = pick
exports.pickCategoryAction = pickCategoryAction
exports.pickSlot = pickSlot
exports.pickWeightedCategory = pickWeightedCategory
exports.planMove = planMove
exports.pointInRect = pointInRect
exports.poolIncludes = poolIncludes
exports.productivityActionUrl = productivityActionUrl
exports.productivityBubbleText = productivityBubbleText
exports.randomBetween = randomBetween
exports.rectAtPoint = rectAtPoint
exports.rectBottom = rectBottom
exports.rectRight = rectRight
exports.rectsOverlap = rectsOverlap
exports.regionArea = regionArea
exports.regionHoleRatio = regionHoleRatio
exports.resetInText = resetInText
exports.resolveRect = resolveRect
exports.rollKind = rollKind
exports.screenOfBox = screenOfBox
exports.sendChat = sendChat
exports.sendPeek = sendPeek
exports.sfxAssetUrl = sfxAssetUrl
exports.sfxCueAction = sfxCueAction
exports.sfxPollDelayMs = sfxPollDelayMs
exports.slotIncludes = slotIncludes
exports.soundMime = soundMime
exports.spawnScoreBurst = spawnScoreBurst
exports.springStep = springStep
exports.squashScale = squashScale
exports.throwBounds = throwBounds
exports.throwBoundsIn = throwBoundsIn
exports.throwSpace = throwSpace
exports.throwStep = throwStep
exports.throwStepRegion = throwStepRegion
exports.translateRects = translateRects
exports.trimTrail = trimTrail
exports.truncate = truncate
exports.urgentWindow = urgentWindow
exports.whisperBubbleView = whisperBubbleView
return exports;
})({});