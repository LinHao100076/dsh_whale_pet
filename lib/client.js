(function() {

"use strict";

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
const pointInRect = (r, x, y) => x >= r.x && x < rectRight(r) && y >= r.y && y < rectBottom(r);
const rectAtPoint = (rects, x, y) => {
	for (const r of rects) if (pointInRect(r, x, y)) return r;
	return null;
};

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

//#endregion
//#region src/shared/config.ts
const PET_DISPLAYS = [
	"web",
	"desktop",
	"both",
	"none"
];
const isWebVisible = (display) => display === "web" || display === "both";
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
//#region src/client/bubble.ts
/** 气泡内联样式：白色半透明圆润泡 + 底部小尾巴指向宠物；字体用上首软糖体（本地打包，稳定）。
* 所有尺寸基于 `--dsh-pet-desktop-size`（宠物宽度 px）等比缩放——宠物放大/缩小，气泡跟随。
* 系数按默认 462px 设计：21px 字号 → ×0.0455、120px 最小宽 → 0.26、230px 最大宽 → 0.5 等。 */
const bubbleCss = [
	"@font-face{font-family:\"ShangshouSoftCandy\";src:url(\"/dsh-pet-desktop-7340/font/上首软糖体.ttf\") format(\"truetype\");font-display:swap;font-weight:400}",
	".dsh-pet-desktop-bubble{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(100% - var(--dsh-pet-desktop-size)*0.108);min-width:calc(var(--dsh-pet-desktop-size)*0.26);max-width:calc(var(--dsh-pet-desktop-size)*0.5);padding:calc(var(--dsh-pet-desktop-size)*0.022) calc(var(--dsh-pet-desktop-size)*0.030);border-radius:calc(var(--dsh-pet-desktop-size)*0.035);background:rgba(255,255,255,.92);color:#2b2b2b;font-family:\"ShangshouSoftCandy\",\"Yuanti SC\",\"YouYuan\",\"幼圆\",\"Comic Sans MS\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif;font-size:calc(var(--dsh-pet-desktop-size)*0.0455);line-height:1.6;z-index:3;pointer-events:none;box-shadow:0 calc(var(--dsh-pet-desktop-size)*0.009) calc(var(--dsh-pet-desktop-size)*0.035) rgba(0,0,0,.14),0 1px 3px rgba(0,0,0,.08);backdrop-filter:blur(6px);opacity:0;transition:opacity .25s ease;white-space:nowrap}",
	".dsh-pet-desktop-bubble::after{content:\"\";position:absolute;left:50%;bottom:calc(var(--dsh-pet-desktop-size)*-0.017);transform:translateX(-50%);border:calc(var(--dsh-pet-desktop-size)*0.017) solid transparent;border-top-color:rgba(255,255,255,.92);border-bottom:none}",
	".dsh-pet-desktop-bubble.is-on{opacity:1}",
	".dsh-pet-desktop-bubble.dsh-pet-desktop-whisper{font-size:calc(var(--dsh-pet-desktop-size)*0.034);min-width:calc(var(--dsh-pet-desktop-size)*0.10);max-width:calc(var(--dsh-pet-desktop-size)*0.5);white-space:normal;overflow-wrap:anywhere}",
	".dsh-pet-desktop-bubble .pet-bub-title{font-size:calc(var(--dsh-pet-desktop-size)*0.035);color:rgba(43,43,43,.6);margin-bottom:calc(var(--dsh-pet-desktop-size)*0.009)}",
	".dsh-pet-desktop-bubble .pet-bub-row{display:flex;justify-content:space-between;gap:calc(var(--dsh-pet-desktop-size)*0.030)}",
	".dsh-pet-desktop-bubble .pet-bub-sub{font-size:calc(var(--dsh-pet-desktop-size)*0.035);color:rgba(43,43,43,.6)}",
	".dsh-pet-desktop-bubble .pet-bub-val{font-variant-numeric:tabular-nums;font-weight:650;color:#1f1f1f}",
	".dsh-pet-desktop-bubble .pet-bub-err{color:#d94f3d;font-size:calc(var(--dsh-pet-desktop-size)*0.035)}",
	".dsh-pet-desktop-bubble .pet-bub-tag{margin-left:calc(var(--dsh-pet-desktop-size)*0.013);font-size:calc(var(--dsh-pet-desktop-size)*0.022);color:rgba(43,43,43,.55);border:1px solid rgba(43,43,43,.25);border-radius:calc(var(--dsh-pet-desktop-size)*0.013);padding:0 calc(var(--dsh-pet-desktop-size)*0.009);vertical-align:1px}",
	".dsh-pet-desktop-bubble .pet-bub-tier{font-weight:700}",
	".dsh-pet-desktop-bubble .pet-bub-tier-peak{color:#e53935}",
	".dsh-pet-desktop-bubble .pet-bub-tier-idle{color:#2e9e4f}"
].join("\n");
/** 只注入一次 */
function injectBubbleCss() {
	if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-pet-desktop/bubble\"]") === null) {
		const tag = document.createElement("style");
		tag.dataset.plugin = "dsh-pet-desktop";
		tag.dataset.pluginCss = "dsh-pet-desktop/bubble";
		tag.textContent = bubbleCss;
		document.head.appendChild(tag);
	}
}
/** 行数据 → React 节点（shared 视图的薄壳） */
function rowsToNodes(h, rows) {
	if (rows.some((r) => r.role === "tier")) return h("div", {
		className: "pet-bub-row",
		children: rows.map((r, i) => {
			if (r.role === "tier") return h("span", {
				key: i,
				className: "pet-bub-tier pet-bub-tier-" + r.tier,
				children: r.text
			});
			return h("span", {
				key: i,
				children: r.text
			});
		})
	});
	return rows.map((r, i) => {
		if (r.role === "error") return h("div", {
			key: i,
			className: "pet-bub-err",
			children: r.text
		});
		if (r.role === "sub") return h("div", {
			key: i,
			className: "pet-bub-row pet-bub-sub",
			children: r.text
		});
		return h("div", {
			key: i,
			className: "pet-bub-row",
			children: r.text
		});
	});
}
function makeBalanceBubble(rt) {
	const { h } = rt;
	injectBubbleCss();
	return function BalanceBubble({ state, on }) {
		const rows = balanceBubbleView(state);
		const wrap = state.ok ? "" : " dsh-pet-desktop-whisper";
		return h("div", {
			className: "dsh-pet-desktop-bubble" + wrap + (on ? " is-on" : ""),
			children: rowsToNodes(h, rows)
		});
	};
}
function makeWhisperBubble(rt) {
	const { h } = rt;
	injectBubbleCss();
	injectMemeBubbleCss();
	return function WhisperBubble({ text, image, on }) {
		const rows = whisperBubbleView({
			ok: true,
			text,
			ts: 0
		});
		const key = String(image ?? "").trim();
		return h("div", {
			className: "dsh-pet-desktop-bubble dsh-pet-desktop-whisper" + (key ? " " + MEME_BUBBLE_CLASS : "") + (on ? " is-on" : ""),
			children: key ? [h("img", {
				key: "img",
				className: MEME_IMG_CLASS,
				src: memeImageUrl(key),
				alt: key
			}), rowsToNodes(h, rows)] : rowsToNodes(h, rows)
		});
	};
}

//#endregion
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
//#region src/shared/notify.ts
const NOTIFY_ICONS$1 = {
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
				icon: NOTIFY_ICONS$1.done
			};
			if (kind === "error") return {
				title: "生成失败",
				body: ev.data?.reason?.error?.message ?? "",
				icon: NOTIFY_ICONS$1.error
			};
			if (kind === "max-tokens") return {
				title: "输出被截断",
				body: "已达到输出 token 上限",
				icon: NOTIFY_ICONS$1.truncated
			};
			return null;
		}
		case "approval/requested": {
			const toolName = typeof frame.toolName === "string" ? frame.toolName : "";
			const reason = typeof frame.reason === "string" && frame.reason ? frame.reason : "";
			return {
				title: "正在申请权限",
				body: (toolName ? "工具「" + toolName + "」" : "") + (reason ? "：" + reason : ""),
				icon: NOTIFY_ICONS$1.approval
			};
		}
		case "question/requested": {
			const q = Array.isArray(frame.questions) && frame.questions[0]?.question || "";
			return {
				title: "模型在等你回答",
				body: q,
				icon: NOTIFY_ICONS$1.question
			};
		}
		case "host/agent-error": return {
			title: "生成失败",
			body: typeof frame.message === "string" ? frame.message : "",
			icon: NOTIFY_ICONS$1.error
		};
		default: return null;
	}
}

//#endregion
//#region src/client/notify.ts
let pageVisible = typeof document !== "undefined" && !document.hidden;
let pageFocused = typeof document !== "undefined" && document.hasFocus();
function refreshVisible() {
	pageVisible = !document.hidden;
}
function refreshFocused() {
	pageFocused = document.hasFocus();
}
/** 注册聚焦/可见性监听，返回解绑函数 */
function initFocusTracking() {
	if (typeof document === "undefined") return () => {};
	document.addEventListener("visibilitychange", refreshVisible);
	window.addEventListener("focus", refreshFocused);
	window.addEventListener("blur", refreshFocused);
	return () => {
		document.removeEventListener("visibilitychange", refreshVisible);
		window.removeEventListener("focus", refreshFocused);
		window.removeEventListener("blur", refreshFocused);
	};
}
/** 用户是否在看本页（页面可见且持有焦点）——是则跳过通知 */
function isPageActive() {
	return pageVisible && pageFocused;
}
/** 图标 URL（pic 路由由宿主提供：assets/pic → /dsh-pet-desktop-7340/pic/<file>） */
const PIC = (name) => "/dsh-pet-desktop-7340/pic/" + name + ".png";
const NOTIFY_ICONS = {
	done: PIC(NOTIFY_ICONS$1.done),
	error: PIC(NOTIFY_ICONS$1.error),
	truncated: PIC(NOTIFY_ICONS$1.truncated),
	approval: PIC(NOTIFY_ICONS$1.approval),
	question: PIC(NOTIFY_ICONS$1.question),
	test: PIC(NOTIFY_ICONS$1.test)
};
/** 当前生效的总开关（运行中可被 reloadNotifications 更新——设置页保存后即时生效，无需刷新） */
let notifyEnabled = true;
/** 发一条系统通知；总开关关闭 / 环境不支持 / 未授权 / 聚焦本页 时静默跳过。
* 日志（【弹窗】类型：内容）在门之后记录——只有真正发出通知时才记，被门拦下的触发不产生日志。 */
function toast(title, body, icon) {
	if (!notifyEnabled) return;
	if (isPageActive()) return;
	if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
	console.log("【弹窗】" + title + (body ? "：" + body : ""));
	try {
		const opts = {};
		if (body) opts.body = truncate(body);
		if (icon) opts.icon = icon;
		const n = new Notification(title, opts);
		n.onclick = () => {
			window.focus();
			n.close();
		};
	} catch {}
}
/** 帧 → toast 并发出（映射来自 shared；未知帧静默跳过） */
function toastFrame(frame) {
	const t = frameToToast(frame);
	if (!t) return;
	toast(t.title, t.body, PIC(t.icon));
}
async function requestNotificationPermission() {
	if (typeof Notification === "undefined") return {
		ok: false,
		reason: "unsupported"
	};
	if (Notification.permission === "granted") return { ok: true };
	if (Notification.permission === "denied") return {
		ok: false,
		reason: "denied"
	};
	try {
		const p = await Notification.requestPermission();
		if (p === "granted") return { ok: true };
		if (p === "denied") return {
			ok: false,
			reason: "rejected"
		};
		return {
			ok: false,
			reason: "error",
			message: "权限未授予（" + p + "）"
		};
	} catch (e) {
		return {
			ok: false,
			reason: "error",
			message: e instanceof Error ? e.message : String(e)
		};
	}
}
/** 读取系统通知总开关：读成品聚合 main 条目（用户层优先、缺省回落默认，host 已合并好）；
* 拉取/解析失败时不阻塞（默认开启）。 */
async function readNotificationsEnabled() {
	try {
		const r = await fetch("/dsh-pet-desktop-7340/config");
		if (!r.ok) return true;
		const d = await r.json().catch(() => null);
		return typeof d?.main?.notificationsEnabled === "boolean" ? d.main.notificationsEnabled : true;
	} catch {
		return true;
	}
}
async function reloadNotifications() {
	notifyEnabled = await readNotificationsEnabled();
}
/** 拉一轮 /notify（since=已消费 seq）；失败返回 null（静默，下轮再试）。 */
async function fetchNotify(seq) {
	try {
		const r = await fetch("/dsh-pet-desktop-7340/notify?since=" + seq);
		if (!r.ok) return null;
		const d = await r.json().catch(() => null);
		if (typeof d?.seq !== "number") return null;
		return {
			seq: d.seq,
			frames: Array.isArray(d.frames) ? d.frames : []
		};
	} catch {
		return null;
	}
}
/** 等一拍（1s），支持中途取消 */
function sleep(ms, signal) {
	return new Promise((resolve) => {
		const timer = window.setTimeout(resolve, ms);
		signal.addEventListener("abort", () => {
			window.clearTimeout(timer);
			resolve();
		}, { once: true });
	});
}
async function startNotify(signal) {
	notifyEnabled = await readNotificationsEnabled();
	if (typeof Notification !== "undefined" && notifyEnabled && Notification.permission === "default") requestNotificationPermission();
	const disposeFocus = initFocusTracking();
	let seq = 0;
	try {
		const baseline = await fetchNotify(0);
		if (baseline) seq = baseline.seq;
		while (!signal.aborted) {
			await sleep(1e3, signal);
			if (signal.aborted) break;
			const batch = await fetchNotify(seq);
			if (!batch || batch.seq <= seq) continue;
			for (const frame of batch.frames) toastFrame(frame);
			seq = batch.seq;
		}
	} finally {
		disposeFocus();
	}
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
//#region src/client/settings.ts
const petBridge = {
	current: [],
	reload: () => {},
	template: void 0
};
const NS = "pet.config";
const zh = {
	"productivity.nav": "番茄钟与 Todo",
	nav: "桌宠配置",
	intro: "管理多个桌宠：每个宠物可独立设置大小与位置（保存后即时生效）。",
	petsLabel: "宠物列表",
	add: "添加宠物",
	remove: "删除",
	confirmRemove: "确定删除宠物「{id}」吗？",
	confirmTitle: "确认操作",
	cancel: "取消",
	atLeastOne: "至少保留一个宠物。",
	emptyPets: "暂无宠物，点击「添加宠物」创建。",
	sizeLabel: "大小（宽度 px）",
	sizeHint: "高度自动 = 宽度 × 9/16。",
	nameLabel: "名字",
	nameHint: "显示名：鼠标悬浮宠物时弹出，也会加进 AI 人设（你的名字是 X）。可重复，留空按宠物 id 处理。",
	balanceEnabled: "余额功能",
	balanceEnabledHint: "启用后该宠物触发余额动画并显示余额气泡。",
	whisperEnabled: "碎碎念",
	whisperEnabledHint: "启用后该宠物按周期用 AI 生成一句话并播碎碎念动画（人设与周期在配置文件顶层）。",
	workStatusEnabled: "工作状态联动",
	workStatusEnabledHint: "启用后该宠物跟随 DSH 工作状态：思考/工作中/等待确认/完成/出错时自动切对应动画并弹气泡（动画池在配置顶层，仅监听不调用模型）。",
	displayLabel: "显示位置",
	displayHint: "web=仅浏览器 / desktop=仅桌面 / both=两者都显示 / none=都不显示",
	"display.web": "仅浏览器",
	"display.desktop": "仅桌面",
	"display.both": "两者都显示",
	"display.none": "都不显示",
	cornerLabel: "位置",
	"corner.top-left": "左上角",
	"corner.top-right": "右上角",
	"corner.bottom-left": "左下角",
	"corner.bottom-right": "右下角",
	marginX: "水平偏移",
	marginY: "垂直偏移",
	save: "保存",
	sync: "同步",
	confirmSync: "确定同步吗？将用项目内置的默认配置（完整字段 + 注释）覆盖用户配置，当前的自定义内容会丢失。",
	corruptTitle: "用户配置已损坏，未保存",
	corruptConfirm: "强行保存",
	corruptBody: "用户配置文件解析不了（内容已损坏，不是合法 JSON/JSONC）：{path}。继续保存会按白名单重建这个文件——它里面现有的内容（animations / physics / memes 等自定义字段）会全部丢失。取消 = 不动文件（先去把配置改回合法再保存）；确认 = 强行保存（丢弃文件里现有的内容）。",
	syncHint: "「同步」会把项目内置的默认配置（含注释与全部高级字段）写入用户配置文件，覆盖当前自定义内容；之后可直接编辑该文件。注意两点：① 文件一旦生成即为显式覆盖层——插件升级后内置默认的变化不会自动生效（除非再次同步或删除该文件）；② 在本页点「保存」会按白名单重写该文件（字段值保留，但注释会被去掉）。",
	configMeta: "高级配置（文件）",
	configMetaHint: "用户配置可覆盖宠物列表 / 动画池 / 播放权重，修改后刷新或重启生效：浏览器端刷新页面，桌面端右键宠物 →「重载配置」（重载全部桌面宠物窗口）；默认配置为完整参考。",
	defaultConfig: "默认配置（只读，完整参考）",
	userConfig: "用户配置（自定义覆盖）",
	animationDir: "动画素材目录（可自定义/扩充动画）",
	saved: "已保存，桌宠即时生效。",
	loadError: "加载配置失败",
	invalid: "请检查输入：大小需为正数，边距可为任意数字。",
	busy: "保存中…",
	extraPetsHint: "另 {n} 只额外宠物由 pet/ 目录文件定义（<名>-config.json + <名>-animation/），它们不在此列表——改文件后浏览器刷新页面、桌面端右键「重载配置」即可生效。",
	notifyToggle: "系统通知",
	notifyToggleHint: "对话完成 / 生成失败 / 权限申请 / 用户选择，在窗口失焦时弹出系统级通知（桌面右下角）。",
	whisperImageToggle: "碎碎念配图",
	whisperImageToggleHint: "碎碎念时从表情包池随机抽一张，连同那句话一起显示（图片映射在配置文件顶层 memes）。token：碎碎念本来就每次生成都要调一次模型，配图只是把抽中那张的名称+描述（约 100 字符 / ≈60 token）加进同一次请求，增量可忽略。",
	chatImageToggle: "对话配图",
	chatImageToggleHint: "对话时由 AI 按当前语境从表情包池挑一张配图（可不挑；图片映射在配置文件顶层 memes）。token：每条消息都要把整张清单附进请求，当前约 1.1k 字符（≈650 token，约碎碎念配图的 11 倍），并随图片数量线性增长；关掉则一个字符都不附。",
	confineToggle: "抛掷锁定在当前屏幕",
	confineToggleHint: "多屏用户：甩出去的宠物只在松手时所在那块屏幕内弹（屏缝当墙，不飞到隔壁屏）；关掉则照常跨屏飞行。只影响桌面模式——浏览器 overlay 本来就只在视口内弹。",
	hideFullscreenToggle: "全屏时隐藏桌宠",
	hideFullscreenToggleHint: "检测到别的应用全屏（游戏 / 全屏视频 / 演示模式）时，自动隐藏被全屏覆盖那块屏幕上的桌宠，全屏结束自动恢复；多屏时另一块屏的桌宠照常活动。判定用 Windows 自身的全屏状态，最大化窗口不会误触发。代价：开启后桌面端每 800ms 查一次系统状态（单次约 1ms，需要 koffi 依赖），关闭则零开销。只影响桌面模式——浏览器端只看 Fullscreen API（浏览器自身的 F11 全屏检测不到）。注意：桌宠被自动隐藏后右键点不到它，要关本开关请就在这一页操作。",
	peekTitle: "窥屏吐槽",
	peekHint: "宠物按周期偷看一眼你的屏幕，然后吐槽一句（走碎碎念那条显示链路：说话动画 + 白色气泡）。情报 = 前台窗口标题 + 进程名 + 空闲时长，**画面默认不出本机**；只有打开「允许截图」且当前模型是多模态时，截图才会随请求发给模型服务商。仅桌面模式生效（浏览器拿不到\"别的应用在干嘛\"）。每只宠物是否窥屏，由上面「宠物列表」里那只宠物自己的开关决定。",
	peekPromptLabel: "窥屏人设（提示词）",
	peekPromptHint: "只写\"你是谁、怎么说话\"（例如：你是主人桌面上的Q版蓝发小女仆，会偷偷瞄一眼屏幕然后小小地吐槽一句……20 字以内）。态度规则由程序按番茄钟阶段自动追加：专注阶段督促、发现摸鱼点名，休息阶段放松调侃。留空 = 用内置默认人设。",
	peekIntervalLabel: "窥屏周期（秒）",
	peekIntervalHint: "每这么久偷看一次并生成一句吐槽；每次都会调用一次模型，建议不小于 300 秒（默认 600 = 10 分钟）。",
	peekScreenToggle: "窥屏：允许截图",
	peekScreenToggleHint: "开启后除了窗口标题还会抓一张屏幕截图交给模型——需要多模态模型：模型声明支持图片输入才会真的发（显式不支持则自动跳过；元数据未知则先试一次，失败自动退回纯情报）。注意截图会随请求发给模型服务商，介意隐私请保持关闭。",
	peekPomodoroToggle: "窥屏：联动番茄钟",
	peekPomodoroToggleHint: "把番茄钟阶段 / 剩余时间 / 关联任务一并写进情报，让宠物在专注阶段用督促语气、发现你在看社交/视频/游戏类应用时直接点名吐槽，休息阶段改为放松调侃。",
	peekEnabled: "窥屏吐槽",
	peekEnabledHint: "这只宠物是否按周期偷看你的屏幕并吐槽一句（每次生成都会调用当前模型）。仅桌面模式。",
	invalidPeek: "请检查窥屏周期：必须是大于 0 的秒数。",
	sfxTitle: "「需要你做决定」提醒音",
	sfxHint: "DSH 出现需要你拍板的事时播一段音频提醒你：权限申请、模型用提问工具等你回答、回合被阻塞等确认。多只桌宠 + 浏览器页面同时在线时只会响一次（宿主放一条全局提醒，各端认领先到先得）。音频文件不存在时完全安静——不报错，也不会改播别的。",
	sfxToggle: "提醒音",
	sfxToggleHint: "总开关。关掉后不再播放，也不再每秒查询状态。",
	sfxVolumeLabel: "音量（0~1）",
	sfxVolumeHint: "0 = 静音，1 = 满音量；非法值按 0.8 处理。",
	sfxFileLabel: "音频文件名",
	sfxFileHint: "把音频放到 ~/.dsh/dsh-pet-desktop/main-sound/（用户目录，优先）或包内 assets/sound/，然后在这里填文件名（中文名也行，不要填路径）。支持 mp3 / wav / ogg / oga / m4a / aac / opus / flac / webm。",
	invalidSfx: "请检查提醒音：音量需在 0~1，文件名只能是单个文件名且扩展名在支持列表内。",
	physicsTitle: "物理（拖拽抛掷手感）",
	physicsHint: "全局，所有宠物共用；随「保存」写入用户配置（不做即时写入）。浏览器保存后即时生效，桌面端由保存重载宠物窗口后生效。",
	"physics.gravity": "重力 gravity",
	"physics.gravityHint": "px/s²，越大落得越快；0 = 无重力（抛出去匀速直线飞）",
	"physics.restitution": "弹性 restitution",
	"physics.restitutionHint": "0~1，碰壁 / 落地反弹保留的速度比例（1 = 完全弹性，0 = 撞上即停）",
	"physics.groundFriction": "地面摩擦 groundFriction",
	"physics.groundFrictionHint": "/s，落地后水平速度的衰减率；0 = 冰面不减速",
	"physics.throwPower": "总力度 throwPower",
	"physics.throwPowerHint": "> 0，弹簧跟手与甩出初速的整体倍率（1 = 默认；越大越跟手、甩得越猛）",
	physicsCeilingBounce: "顶部反弹 ceilingBounce",
	physicsCeilingBounceHint: "关掉后抛掷可飞出屏幕顶部（重力仍会把它拉回来）",
	physicsPetCollision: "宠物互撞 petCollision",
	physicsPetCollisionHint: "飞行中的宠物撞到别的宠物按动量守恒弹开（质量 ∝ 尺寸²）",
	invalidPhysics: "请检查物理参数：重力 / 地面摩擦 ≥ 0，弹性 0~1，总力度 > 0。",
	notifyGetPermission: "获取权限",
	notifyPermissionOk: "已获得通知权限，右下角出现测试通知。",
	notifyDenyUnsupported: "当前环境不支持系统通知（浏览器无 Notification API）。",
	notifyDenyBlocked: "通知权限已被浏览器标记为「阻止」。",
	notifyDenyRejected: "你在权限询问弹窗中选择了「阻止」。",
	notifyDenyError: "申请权限时出错",
	notifyGuide: "引导：点击地址栏左侧 🔒/ⓘ →「网站设置」→「通知」→ 改为「允许」，刷新页面后重试。",
	storageTitle: "卸载与存储",
	storageHint: "插件在本机落下的全部位置。删缓存不影响使用（会自动重下/重建）；删「插件用户数据」会丢配置与对话记忆。",
	"storage.userData": "插件用户数据：自定义配置 main-config.jsonc、对话记忆 memory.json、自定义动画素材 main-animation/、文件宠物 pet/",
	"storage.electron": "桌面宠物用的 Electron 运行时（体积较大；删除后下次启用桌面模式会自动重新下载）",
	"storage.desktopCache": "桌面宠物窗口的缓存与主屏缩放缓存（可删，会自动重建）",
	"storage.electronCache": "Electron 安装包下载缓存（可删，需要时会重新下载）",
	"storage.package": "插件本体（由 DSH 管理，用下面的卸载命令移除，不要手删）",
	storageMissing: "（尚未创建）",
	uninstallTitle: "卸载方法",
	uninstallStep1: "1. 先退出 DSH（桌面宠物随之退出）；不要在桌宠运行时删除上面的文件。",
	uninstallStep2: "2. 卸载插件本体（终端执行，会同时从 profile 的 bundle 层移除）：",
	uninstallStep3: "3. 按需删除上面的位置：缓存类删了无影响；「插件用户数据」删了会丢配置与对话记忆（想保留就先备份其中的 main-config.jsonc）。",
	uninstallCmd: "dsh plugin --profile {profile} remove dsh-pet-desktop"
};
const en = {
	"productivity.nav": "Pomodoro & Todo",
	nav: "Pet Config",
	intro: "Manage multiple pets: each pet has its own size and position (applies instantly after saving).",
	petsLabel: "Pets",
	add: "Add pet",
	remove: "Remove",
	confirmRemove: "Delete pet \"{id}\"?",
	confirmTitle: "Confirm action",
	cancel: "Cancel",
	atLeastOne: "Keep at least one pet.",
	emptyPets: "No pets yet — click \"Add pet\" to create one.",
	sizeLabel: "Size (width px)",
	sizeHint: "Height is automatic = width × 9/16.",
	nameLabel: "Name",
	nameHint: "Shown on hover and added to AI personas (\"your name is X\"). Duplicates allowed; empty falls back to the pet id.",
	balanceEnabled: "Balance",
	balanceEnabledHint: "When enabled, this pet plays balance animations and shows the balance bubble.",
	whisperEnabled: "Whisper",
	whisperEnabledHint: "When enabled, this pet periodically generates a line via AI and plays the whisper animation (persona & interval live in the top-level config).",
	workStatusEnabled: "Work status",
	workStatusEnabledHint: "When enabled, this pet follows DSH work state: thinking / working / waiting / done / error switch animations and show bubbles (pool in top-level config; listening only, no model calls).",
	displayLabel: "Display",
	displayHint: "web = browser only / desktop = desktop only / both = both / none = neither",
	"display.web": "Browser only",
	"display.desktop": "Desktop only",
	"display.both": "Both",
	"display.none": "Neither",
	cornerLabel: "Position",
	"corner.top-left": "Top-left",
	"corner.top-right": "Top-right",
	"corner.bottom-left": "Bottom-left",
	"corner.bottom-right": "Bottom-right",
	marginX: "Horizontal offset",
	marginY: "Vertical offset",
	save: "Save",
	sync: "Sync",
	confirmSync: "Sync? This overwrites the user config with the bundled default config (all fields + comments); current customizations are lost.",
	corruptTitle: "User config is corrupted — not saved",
	corruptConfirm: "Save anyway",
	corruptBody: "The user config file cannot be parsed (corrupted, not valid JSON/JSONC): {path}. Saving now rebuilds it from the whitelist — everything currently in that file (animations / physics / memes …) will be lost. Cancel = leave the file untouched (fix it and save again); Confirm = save anyway (discard what is in the file).",
	syncHint: "\"Sync\" writes the bundled default config (comments + every advanced field included) to the user config file, overwriting your current customizations; the file is then directly editable. Two caveats: (1) once created, that file is an explicit override layer — later changes to the bundled defaults will not take effect automatically (until you sync again or delete the file); (2) clicking \"Save\" on this page rewrites the file from a whitelist — field values are kept, comments are dropped.",
	configMeta: "Advanced (files)",
	configMetaHint: "User config may override pets / animation pools / weights — refresh or restart to apply: refresh the page in the browser, or right-click a desktop pet → \"Reload config\" (rebuilds every desktop pet window). The default config is the complete reference.",
	defaultConfig: "Default config (read-only, complete reference)",
	userConfig: "User config (custom overrides)",
	animationDir: "Animation assets dir (add/customize animations here)",
	saved: "Saved — the pets updated instantly.",
	loadError: "Failed to load config",
	invalid: "Check your input: size must be positive; margins can be any number.",
	busy: "Saving…",
	extraPetsHint: "{n} extra pet(s) are file-defined in the pet/ directory (<name>-config.json + <name>-animation/). They are not in this list — after editing the files, refresh the page (browser) or right-click a desktop pet → \"Reload config\".",
	notifyToggle: "System notifications",
	notifyToggleHint: "OS-level toasts (bottom-right of the desktop) for conversation completion, failures, permission requests, and questions — only while this window is unfocused.",
	whisperImageToggle: "Whisper images",
	whisperImageToggleHint: "Attach one random meme from the pool to each whisper line (image mapping lives in the top-level `memes` config field). Tokens: a whisper already calls the model every cycle, so the image only appends the name + description of that one meme (~100 chars / ~60 tokens) to the same request — negligible.",
	chatImageToggle: "Chat images",
	chatImageToggleHint: "Let the AI pick one meme from the pool that fits the current context (optional; mapping lives in the top-level `memes` config field). Tokens: every message carries the whole catalog — currently ~1.1k chars (~650 tokens, about 11x the whisper case) and growing with the number of images; turning this off appends nothing at all.",
	confineToggle: "Lock throws to the current screen",
	confineToggleHint: "Multi-monitor: a thrown pet bounces only inside the screen it was released on (screen seams act as walls, so it never flies to the neighbouring monitor); turn this off to let it cross screens as usual. Desktop only — the browser overlay always bounces inside the viewport anyway.",
	hideFullscreenToggle: "Hide pets while an app is fullscreen",
	hideFullscreenToggleHint: "When another app goes fullscreen (a game, a fullscreen video, presentation mode), every pet on the covered screen is hidden automatically and comes back when it ends; pets on other monitors keep moving. Detection uses Windows' own fullscreen state, so a merely maximized window never triggers it. Cost: once enabled, the desktop helper polls the OS every 800ms (~1ms per query, needs the koffi dependency); disabled means zero overhead. Desktop only — the browser overlay only reacts to the Fullscreen API (F11-style browser fullscreen is not detectable). Note: while a pet is auto-hidden you cannot right-click it, so turn this switch off from this settings page.",
	peekTitle: "Screen peeking",
	peekHint: "The pet periodically peeks at your screen and makes one remark (through the whisper pipeline: talking animation + white bubble). Intel = foreground window title + process name + idle time; the screen image never leaves this machine unless you enable \"allow screenshots\" AND the current model is multimodal. Desktop only (a browser cannot see what other apps are doing). Whether a given pet peeks is controlled per pet in the list above.",
	peekPromptLabel: "Peek persona (prompt)",
	peekPromptHint: "Describe only who the pet is and how it talks (e.g. a chibi maid who sneaks a glance and makes a 20-character remark). Attitude rules are appended automatically by pomodoro phase: nudging during focus, calling out slacking, relaxing during breaks. Empty = bundled default persona.",
	peekIntervalLabel: "Peek interval (seconds)",
	peekIntervalHint: "How often to peek and generate one remark; every peek calls the model, so keep it at 300s or more (default 600 = 10 minutes).",
	peekScreenToggle: "Peek: allow screenshots",
	peekScreenToggleHint: "Also send one screenshot to the model — this requires a multimodal model: images are only sent when the model declares image input (explicitly text-only models are skipped; unknown models are tried once and fall back automatically). Screenshots go to your model provider, so leave this off if that bothers you.",
	peekPomodoroToggle: "Peek: link the pomodoro",
	peekPomodoroToggleHint: "Include pomodoro phase / remaining time / linked task in the intel, so the pet nudges you during focus, calls out slacking (social/video/game windows), and relaxes during breaks.",
	peekEnabled: "Screen peeking",
	peekEnabledHint: "Whether this pet periodically peeks at your screen and makes a remark (each remark calls the model). Desktop only.",
	invalidPeek: "Check the peek interval: it must be a positive number of seconds.",
	sfxTitle: "\"Needs your decision\" alert sound",
	sfxHint: "Plays a short audio cue when DSH needs you to decide something: permission requests, the model asking you a question, or a blocked turn. With several pets and a browser overlay online at once it still rings only once (the host keeps one global cue and clients claim it, first come first served). A missing audio file means complete silence — no errors, no fallback sound.",
	sfxToggle: "Alert sound",
	sfxToggleHint: "Master switch. When off, nothing plays and the status is no longer polled every second.",
	sfxVolumeLabel: "Volume (0–1)",
	sfxVolumeHint: "0 = mute, 1 = full volume; invalid values fall back to 0.8.",
	sfxFileLabel: "Audio file name",
	sfxFileHint: "Drop the audio into ~/.dsh/dsh-pet-desktop/main-sound/ (user dir, takes priority) or the bundled assets/sound/, then enter the file name here (no path, non-ASCII names are fine). Supported: mp3 / wav / ogg / oga / m4a / aac / opus / flac / webm.",
	invalidSfx: "Check the alert sound: volume must be 0–1 and the file name must be a single name with a supported extension.",
	physicsTitle: "Physics (drag & throw feel)",
	physicsHint: "Global, shared by every pet; written to the user config on \"Save\" (never written immediately). Applies instantly in the browser; on the desktop it applies once Save reloads the pet windows.",
	"physics.gravity": "Gravity",
	"physics.gravityHint": "px/s² — the higher, the faster it falls; 0 = weightless (flies straight forever)",
	"physics.restitution": "Bounciness",
	"physics.restitutionHint": "0–1, speed kept when bouncing off a wall or the floor (1 = perfectly elastic, 0 = stops dead)",
	"physics.groundFriction": "Ground friction",
	"physics.groundFrictionHint": "per second, horizontal damping while on the ground; 0 = frictionless ice",
	"physics.throwPower": "Throw power",
	"physics.throwPowerHint": "> 0, overall multiplier for spring tracking and release speed (1 = default; higher = tighter tracking, harder throws)",
	physicsCeilingBounce: "Ceiling bounce",
	physicsCeilingBounceHint: "Turn this off to let a throw fly out through the top of the screen (gravity still pulls it back)",
	physicsPetCollision: "Pet collisions",
	physicsPetCollisionHint: "A flying pet bounces off the others with momentum conservation (mass ∝ size²)",
	invalidPhysics: "Check the physics values: gravity / ground friction ≥ 0, bounciness 0–1, throw power > 0.",
	notifyGetPermission: "Get permission",
	notifyPermissionOk: "Notification permission granted — a test notification was sent.",
	notifyDenyUnsupported: "System notifications are not supported in this environment (no Notification API).",
	notifyDenyBlocked: "Notification permission is blocked by the browser.",
	notifyDenyRejected: "You chose \"Block\" in the permission prompt.",
	notifyDenyError: "Failed to request permission",
	notifyGuide: "Guide: click the 🔒/ⓘ icon next to the address bar → Site settings → Notifications → set to \"Allow\", then refresh and retry.",
	storageTitle: "Uninstall & storage",
	storageHint: "Every location this plugin writes to. Deleting cache folders is harmless (they re-download / rebuild); deleting \"plugin user data\" loses your config and chat memory.",
	"storage.userData": "Plugin user data: custom config main-config.jsonc, chat memory memory.json, custom animation assets main-animation/, file pets pet/",
	"storage.electron": "Electron runtime used by the desktop pet (large; re-downloaded automatically the next time desktop mode starts)",
	"storage.desktopCache": "Desktop pet window cache and primary-monitor scale cache (safe to delete, rebuilt automatically)",
	"storage.electronCache": "Electron installer download cache (safe to delete, re-downloaded when needed)",
	"storage.package": "The plugin itself (managed by DSH — remove it with the command below instead of deleting it)",
	storageMissing: " (not created yet)",
	uninstallTitle: "How to uninstall",
	uninstallStep1: "1. Quit DSH first (the desktop pet exits with it); do not delete these files while the pet is running.",
	uninstallStep2: "2. Remove the plugin itself (run in a terminal; this also drops it from the profile bundle layer):",
	uninstallStep3: "3. Delete the locations above as needed: cache folders are harmless; deleting \"plugin user data\" loses your config and chat memory (back up main-config.jsonc first if you want to keep it).",
	uninstallCmd: "dsh plugin --profile {profile} remove dsh-pet-desktop"
};
function makePetConfigSection(rt) {
	const { h, useState, useEffect, t } = rt;
	const CORNERS = [
		"top-left",
		"top-right",
		"bottom-left",
		"bottom-right"
	];
	const cornerLabel = (c) => t("corner." + c);
	const inputStyle = {
		boxSizing: "border-box",
		border: "1px solid var(--dsw-alias-border-l2)",
		borderRadius: "8px",
		background: "var(--dsw-alias-bg-layer-1)",
		color: "var(--dsw-alias-label-primary)",
		padding: "5px 10px",
		fontSize: "13px",
		minHeight: "28px",
		outline: "none"
	};
	/** 等宽字体栈（路径与命令展示用；不引外部字体，走系统栈，避免多拉一份资源） */
	const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, \"Courier New\", monospace";
	/** 生成一个未占用的宠物 id（pet-2、pet-3…） */
	const nextId = (list) => {
		let n = 2;
		for (;; n++) {
			const id = "pet-" + n;
			if (!list.some((p) => p.id === id)) return id;
		}
	};
	/** 全局开关的一格（2×2 网格单元）：勾选框 + 标题在上，描述在下。
	*  label 为文案键：标题 = t(label)，描述 = t(label + 'Hint')；描述左缩进 24px 与标题同列对齐
	*  （勾选框 16px + 间距 8px）。label 元素包住整格，点标题或描述都能切换。 */
	const toggleCell$1 = (label, value, disabled, onToggle) => h("label", {
		key: label,
		style: {
			display: "flex",
			flexDirection: "column",
			gap: "4px",
			minWidth: 0,
			fontSize: "13px",
			color: "var(--dsw-alias-label-primary)",
			cursor: "pointer"
		},
		children: [h("span", {
			style: {
				display: "flex",
				gap: "8px",
				alignItems: "center"
			},
			children: [h("input", {
				type: "checkbox",
				checked: value,
				disabled,
				onChange: (e) => onToggle(e.target.checked),
				style: {
					width: "16px",
					height: "16px",
					accentColor: "var(--dsw-alias-state-business-primary)"
				}
			}), h("span", { children: t(label) })]
		}), h("span", {
			style: {
				fontSize: "11px",
				color: "var(--dsw-alias-label-tertiary)",
				paddingLeft: "24px"
			},
			children: t(label + "Hint")
		})]
	});
	return function PetConfigSection() {
		const initPets = petBridge.current.filter((p) => !p.extra);
		const extraCount = petBridge.current.filter((p) => p.extra).length;
		const [pets, setPets] = useState(initPets.map((p) => ({
			...p,
			position: { ...p.position }
		})));
		const [selId, setSelId] = useState(initPets[0]?.id ?? "");
		const [busy, setBusy] = useState(false);
		const [msg, setMsg] = useState({
			kind: "",
			text: ""
		});
		const [dialog, setDialog] = useState(null);
		const [paths, setPaths] = useState(null);
		useEffect(() => {
			fetch("/dsh-pet-desktop-7340/config/meta").then((r) => r.ok ? r.json() : null).then((p) => setPaths(p)).catch(() => console.warn("[dsh-pet-desktop] 读取配置文件路径失败"));
		}, []);
		const [notifyEnabled$1, setNotifyEnabled] = useState(true);
		const [whisperImage, setWhisperImage] = useState(false);
		const [chatImage, setChatImage] = useState(false);
		const [confineScreen, setConfineScreen] = useState(false);
		const [hideFullscreen, setHideFullscreen] = useState(false);
		const [peekPrompt, setPeekPrompt] = useState("");
		const [peekScreen, setPeekScreen] = useState(false);
		const [peekPomodoro, setPeekPomodoro] = useState(true);
		const [peekInterval, setPeekInterval] = useState(600);
		const [refreshSec, setRefreshSec] = useState({});
		const [sfxOn, setSfxOn] = useState(true);
		const [sfxVol, setSfxVol] = useState(.8);
		const [sfxFile, setSfxFile] = useState("need-decision.mp3");
		const [physics, setPhysics] = useState({ ...DEFAULT_PHYSICS });
		const [permMsg, setPermMsg] = useState({
			kind: "",
			text: ""
		});
		useEffect(() => {
			let alive = true;
			fetch("/dsh-pet-desktop-7340/config").then((r) => r.ok ? r.json() : null).then((d) => {
				if (!alive || !d || !d.main) return;
				const m = d.main;
				if (typeof m.notificationsEnabled === "boolean") setNotifyEnabled(m.notificationsEnabled);
				if (typeof m.whisperImageEnabled === "boolean") setWhisperImage(m.whisperImageEnabled);
				if (typeof m.chatImageEnabled === "boolean") setChatImage(m.chatImageEnabled);
				if (typeof m.confineToScreen === "boolean") setConfineScreen(m.confineToScreen);
				if (typeof m.hideOnFullscreen === "boolean") setHideFullscreen(m.hideOnFullscreen);
				if (typeof m.peekPrompt === "string") setPeekPrompt(m.peekPrompt);
				if (typeof m.peekScreenEnabled === "boolean") setPeekScreen(m.peekScreenEnabled);
				if (typeof m.peekPomodoroEnabled === "boolean") setPeekPomodoro(m.peekPomodoroEnabled);
				if (typeof m.sfxEnabled === "boolean") setSfxOn(m.sfxEnabled);
				if (m.sfxVolume !== void 0) setSfxVol(clampSfxVolume(m.sfxVolume));
				if (typeof m.sfxDecision === "string" && m.sfxDecision.trim()) setSfxFile(m.sfxDecision.trim());
				if (m.eventsRefreshSec && typeof m.eventsRefreshSec === "object") {
					const seg = m.eventsRefreshSec;
					setRefreshSec(seg);
					if (Number.isFinite(Number(seg.peek))) setPeekInterval(Number(seg.peek));
				}
				if (m.physics && typeof m.physics === "object") setPhysics({
					...DEFAULT_PHYSICS,
					...m.physics
				});
			}).catch(() => {});
			return () => {
				alive = false;
			};
		}, []);
		const toggleNotify = async (v) => {
			setNotifyEnabled(v);
			if (v) await requestNotificationPermission();
		};
		const grantNotifyPermission = async () => {
			setPermMsg({
				kind: "",
				text: ""
			});
			const r = await requestNotificationPermission();
			if (!r.ok) {
				const reason = r.reason === "unsupported" ? t("notifyDenyUnsupported") : r.reason === "denied" ? t("notifyDenyBlocked") : r.reason === "rejected" ? t("notifyDenyRejected") : t("notifyDenyError") + (r.message ? "：" + r.message : "");
				setPermMsg({
					kind: "err",
					text: reason + (r.reason === "unsupported" ? "" : " " + t("notifyGuide"))
				});
				return;
			}
			try {
				new Notification("测试通知", {
					body: "【dsh-pet-desktop】系统通知已就绪。",
					icon: NOTIFY_ICONS.test
				});
			} catch {}
			setPermMsg({
				kind: "ok",
				text: t("notifyPermissionOk")
			});
		};
		const cur = pets.find((p) => p.id === selId) ?? null;
		const updateSel = (patch) => setPets((list) => list.map((p) => {
			if (p.id !== selId) return p;
			const { position: posPatch,...rest } = patch;
			return {
				...p,
				...rest,
				position: posPatch ? {
					...p.position,
					...posPatch
				} : p.position
			};
		}));
		const validated = () => {
			for (const p of pets) if (!Number.isFinite(p.size) || p.size <= 0 || !Number.isFinite(p.position.marginX) || !Number.isFinite(p.position.marginY)) {
				setMsg({
					kind: "err",
					text: t("invalid")
				});
				return false;
			}
			if (!Number.isFinite(physics.gravity) || physics.gravity < 0 || !Number.isFinite(physics.restitution) || physics.restitution < 0 || physics.restitution > 1 || !Number.isFinite(physics.groundFriction) || physics.groundFriction < 0 || !Number.isFinite(physics.throwPower) || physics.throwPower <= 0) {
				setMsg({
					kind: "err",
					text: t("invalidPhysics")
				});
				return false;
			}
			if (!Number.isFinite(peekInterval) || peekInterval <= 0) {
				setMsg({
					kind: "err",
					text: t("invalidPeek")
				});
				return false;
			}
			if (!Number.isFinite(sfxVol) || sfxVol < 0 || sfxVol > 1 || !isSoundFileName(sfxFile)) {
				setMsg({
					kind: "err",
					text: t("invalidSfx")
				});
				return false;
			}
			return true;
		};
		const save = async (force = false) => {
			const isOk = validated();
			if (!isOk) return;
			setBusy(true);
			setMsg({
				kind: "",
				text: ""
			});
			try {
				const body = {
					pets,
					notificationsEnabled: notifyEnabled$1,
					whisperImageEnabled: whisperImage,
					chatImageEnabled: chatImage,
					confineToScreen: confineScreen,
					hideOnFullscreen: hideFullscreen,
					peekPrompt,
					peekScreenEnabled: peekScreen,
					peekPomodoroEnabled: peekPomodoro,
					eventsRefreshSec: {
						...refreshSec,
						peek: peekInterval
					},
					sfxEnabled: sfxOn,
					sfxVolume: sfxVol,
					sfxDecision: sfxFile,
					physics
				};
				const res = await fetch("/dsh-pet-desktop-7340/config" + (force === true ? "?force=1" : ""), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				});
				if (res.status === 409) {
					const info = await res.json().catch(() => null);
					setDialog({
						kind: "corrupt",
						path: typeof info?.userFile === "string" ? info.userFile : paths?.user ?? ""
					});
					return;
				}
				if (!res.ok) throw new Error("HTTP " + res.status);
				petBridge.reload(await res.json());
				reloadNotifications();
				setMsg({
					kind: "ok",
					text: t("saved")
				});
			} catch {
				setMsg({
					kind: "err",
					text: t("loadError")
				});
			} finally {
				setBusy(false);
			}
		};
		const sync = () => setDialog({ kind: "sync" });
		const doSync = async () => {
			setBusy(true);
			setMsg({
				kind: "",
				text: ""
			});
			try {
				const res = await fetch("/dsh-pet-desktop-7340/config", { method: "POST" });
				if (!res.ok) throw new Error("HTTP " + res.status);
				const merged = await res.json();
				const defs = merged.main?.pets ?? [];
				setPets(defs.map((p) => ({
					...p,
					position: { ...p.position }
				})));
				setSelId(defs[0]?.id ?? "");
				petBridge.reload(merged);
				setMsg({
					kind: "ok",
					text: t("saved")
				});
			} catch {
				setMsg({
					kind: "err",
					text: t("loadError")
				});
			} finally {
				setBusy(false);
			}
		};
		const addPet = () => {
			const tpl = petBridge.template;
			if (!tpl) return;
			const id = nextId(pets);
			setPets((list) => [...list, {
				id,
				name: id,
				size: tpl.size,
				balanceEnabled: tpl.balanceEnabled,
				whisperEnabled: tpl.whisperEnabled,
				workStatusEnabled: tpl.workStatusEnabled,
				display: tpl.display,
				position: { ...tpl.position }
			}]);
			setSelId(id);
		};
		const removeSel = () => {
			if (pets.length <= 1) {
				setMsg({
					kind: "err",
					text: t("atLeastOne")
				});
				return;
			}
			setDialog({ kind: "remove" });
		};
		const doRemove = () => {
			const list = pets.filter((p) => p.id !== selId);
			setPets(list);
			setSelId(list[0].id);
		};
		const field$1 = (key, value, setter, width) => h("input", {
			type: "number",
			step: key === "size" ? "10" : "1",
			min: key === "size" ? "120" : "",
			value: String(value),
			disabled: busy,
			onChange: (e) => setter(Number(e.target.value)),
			style: {
				width,
				...inputStyle
			}
		});
		/** 物理参数的一格：标题 + 数字输入 + 一行说明（排版与全局开关一致，说明缩进对齐输入框） */
		const physField = (key, step, min) => h("label", {
			style: {
				display: "flex",
				flexDirection: "column",
				gap: "4px",
				minWidth: 0,
				fontSize: "13px",
				color: "var(--dsw-alias-label-primary)"
			},
			children: [
				h("span", { children: t("physics." + key) }),
				h("input", {
					type: "number",
					step,
					min,
					value: String(physics[key]),
					disabled: busy,
					onChange: (e) => setPhysics((p) => ({
						...p,
						[key]: Number(e.target.value)
					})),
					style: {
						width: "140px",
						...inputStyle
					}
				}),
				h("span", {
					style: {
						fontSize: "11px",
						color: "var(--dsw-alias-label-tertiary)"
					},
					children: t("physics." + key + "Hint")
				})
			]
		});
		return h("section", {
			style: {
				maxWidth: "720px",
				color: "var(--dsw-alias-label-primary)",
				display: "flex",
				flexDirection: "column",
				gap: "6px"
			},
			children: [
				h("h2", {
					style: {
						margin: 0,
						fontSize: "16px",
						fontWeight: 500,
						lineHeight: "24px"
					},
					children: t("nav")
				}),
				h("p", {
					style: {
						margin: 0,
						fontSize: "14px",
						color: "var(--dsw-alias-label-tertiary)",
						lineHeight: "22px"
					},
					children: t("intro")
				}),
				extraCount > 0 ? h("p", {
					style: {
						margin: 0,
						fontSize: "12px",
						color: "var(--dsw-alias-label-tertiary)",
						lineHeight: "18px"
					},
					children: t("extraPetsHint").replace("{n}", String(extraCount))
				}) : null,
				h("div", {
					style: {
						display: "flex",
						gap: "8px",
						flexWrap: "wrap",
						alignItems: "center",
						marginTop: "4px"
					},
					children: [
						h("span", {
							style: {
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: t("petsLabel")
						}),
						...pets.map((p) => h("button", {
							key: p.id,
							type: "button",
							onClick: () => setSelId(p.id),
							style: {
								border: "1px solid " + (p.id === selId ? "var(--dsw-alias-state-business-primary)" : "var(--dsw-alias-border-l2)"),
								background: p.id === selId ? "var(--dsw-alias-interactive-bg-active)" : "transparent",
								color: "var(--dsw-alias-label-primary)",
								borderRadius: "8px",
								padding: "4px 12px",
								fontSize: "13px",
								cursor: "pointer"
							},
							children: (p.name || p.id) + " (" + p.size + "px)"
						})),
						h("button", {
							type: "button",
							onClick: addPet,
							disabled: busy,
							style: {
								border: "1px dashed var(--dsw-alias-border-l2)",
								background: "transparent",
								color: "var(--dsw-alias-label-secondary)",
								borderRadius: "8px",
								padding: "4px 12px",
								fontSize: "13px",
								cursor: "pointer"
							},
							children: "+ " + t("add")
						})
					]
				}),
				cur ? h("div", {
					style: {
						display: "flex",
						gap: "16px",
						flexWrap: "wrap",
						marginTop: "8px",
						padding: "12px 14px",
						border: "1px solid var(--dsw-alias-border-l2)",
						borderRadius: "12px"
					},
					children: [
						h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [
								t("nameLabel"),
								h("input", {
									type: "text",
									value: String(cur.name ?? ""),
									disabled: busy,
									maxLength: 50,
									onChange: (e) => updateSel({ name: e.target.value }),
									style: {
										width: "200px",
										...inputStyle
									}
								}),
								h("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: t("nameHint")
								})
							]
						}),
						h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [
								t("sizeLabel"),
								field$1("size", cur.size, (v) => updateSel({ size: v }), "150px"),
								h("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: t("sizeHint")
								})
							]
						}),
						h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [t("cornerLabel"), h("select", {
								value: cur.position.corner,
								disabled: busy,
								onChange: (e) => updateSel({ position: { corner: e.target.value } }),
								style: {
									width: "160px",
									...inputStyle
								},
								children: CORNERS.map((c) => h("option", {
									key: c,
									value: c,
									children: cornerLabel(c)
								}))
							})]
						}),
						h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [t("marginX"), field$1("marginX", cur.position.marginX, (v) => updateSel({ position: { marginX: v } }), "120px")]
						}),
						h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [t("marginY"), field$1("marginY", cur.position.marginY, (v) => updateSel({ position: { marginY: v } }), "120px")]
						}),
						h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [
								t("balanceEnabled"),
								h("input", {
									type: "checkbox",
									checked: !!cur.balanceEnabled,
									disabled: busy,
									onChange: (e) => updateSel({ balanceEnabled: e.target.checked }),
									style: {
										width: "16px",
										height: "16px",
										accentColor: "var(--dsw-alias-state-business-primary)"
									}
								}),
								h("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: t("balanceEnabledHint")
								})
							]
						}),
						h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [
								t("whisperEnabled"),
								h("input", {
									type: "checkbox",
									checked: !!cur.whisperEnabled,
									disabled: busy,
									onChange: (e) => updateSel({ whisperEnabled: e.target.checked }),
									style: {
										width: "16px",
										height: "16px",
										accentColor: "var(--dsw-alias-state-business-primary)"
									}
								}),
								h("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: t("whisperEnabledHint")
								})
							]
						}),
						h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [
								t("workStatusEnabled"),
								h("input", {
									type: "checkbox",
									checked: !!cur.workStatusEnabled,
									disabled: busy,
									onChange: (e) => updateSel({ workStatusEnabled: e.target.checked }),
									style: {
										width: "16px",
										height: "16px",
										accentColor: "var(--dsw-alias-state-business-primary)"
									}
								}),
								h("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: t("workStatusEnabledHint")
								})
							]
						}),
						h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [
								t("peekEnabled"),
								h("input", {
									type: "checkbox",
									checked: !!cur.peekEnabled,
									disabled: busy,
									onChange: (e) => updateSel({ peekEnabled: e.target.checked }),
									style: {
										width: "16px",
										height: "16px",
										accentColor: "var(--dsw-alias-state-business-primary)"
									}
								}),
								h("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: t("peekEnabledHint")
								})
							]
						}),
						h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [
								t("displayLabel"),
								h("select", {
									value: cur.display,
									disabled: busy,
									onChange: (e) => updateSel({ display: e.target.value }),
									style: {
										width: "160px",
										...inputStyle
									},
									children: PET_DISPLAYS.map((d) => h("option", {
										key: d,
										value: d,
										children: t("display." + d)
									}))
								}),
								h("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: t("displayHint")
								})
							]
						}),
						h("button", {
							type: "button",
							onClick: removeSel,
							disabled: busy,
							title: t("remove"),
							style: {
								alignSelf: "flex-end",
								border: "1px solid var(--dsw-alias-state-error-secondary)",
								background: "transparent",
								color: "var(--dsw-alias-state-error-primary)",
								borderRadius: "8px",
								padding: "4px 12px",
								fontSize: "12px",
								cursor: "pointer"
							},
							children: t("remove")
						})
					]
				}) : h("p", {
					style: {
						margin: 0,
						fontSize: "13px",
						color: "var(--dsw-alias-label-tertiary)"
					},
					children: t("emptyPets")
				}),
				h("div", {
					style: {
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: "10px 16px",
						marginTop: "8px",
						alignItems: "start"
					},
					children: [
						toggleCell$1("notifyToggle", notifyEnabled$1, busy, (v) => void toggleNotify(v)),
						toggleCell$1("whisperImageToggle", whisperImage, busy, setWhisperImage),
						toggleCell$1("chatImageToggle", chatImage, busy, setChatImage),
						toggleCell$1("confineToggle", confineScreen, busy, setConfineScreen),
						toggleCell$1("hideFullscreenToggle", hideFullscreen, busy, setHideFullscreen)
					]
				}),
				h("div", {
					style: {
						marginTop: "10px",
						fontSize: "13px",
						fontWeight: 500,
						color: "var(--dsw-alias-label-primary)"
					},
					children: t("peekTitle")
				}),
				h("p", {
					style: {
						margin: 0,
						fontSize: "11px",
						color: "var(--dsw-alias-label-tertiary)",
						lineHeight: "16px"
					},
					children: t("peekHint")
				}),
				h("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: "10px",
						marginTop: "4px"
					},
					children: [
						h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [
								t("peekPromptLabel"),
								h("textarea", {
									value: peekPrompt,
									disabled: busy,
									rows: 3,
									maxLength: 2e3,
									placeholder: t("peekPromptLabel"),
									onChange: (e) => setPeekPrompt(e.target.value),
									style: {
										width: "100%",
										resize: "vertical",
										lineHeight: "20px",
										...inputStyle
									}
								}),
								h("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: t("peekPromptHint")
								})
							]
						}),
						h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [
								t("peekIntervalLabel"),
								h("input", {
									type: "number",
									min: "30",
									step: "30",
									value: String(peekInterval),
									disabled: busy,
									onChange: (e) => setPeekInterval(Number(e.target.value)),
									style: {
										width: "140px",
										...inputStyle
									}
								}),
								h("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: t("peekIntervalHint")
								})
							]
						}),
						h("div", {
							style: {
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: "10px 16px",
								alignItems: "start"
							},
							children: [toggleCell$1("peekScreenToggle", peekScreen, busy, setPeekScreen), toggleCell$1("peekPomodoroToggle", peekPomodoro, busy, setPeekPomodoro)]
						})
					]
				}),
				h("div", {
					style: {
						marginTop: "10px",
						fontSize: "13px",
						fontWeight: 500,
						color: "var(--dsw-alias-label-primary)"
					},
					children: t("sfxTitle")
				}),
				h("p", {
					style: {
						margin: 0,
						fontSize: "11px",
						color: "var(--dsw-alias-label-tertiary)",
						lineHeight: "16px"
					},
					children: t("sfxHint")
				}),
				h("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: "10px",
						marginTop: "4px"
					},
					children: [toggleCell$1("sfxToggle", sfxOn, busy, setSfxOn), h("div", {
						style: {
							display: "grid",
							gridTemplateColumns: "160px minmax(0,1fr)",
							gap: "10px 16px",
							alignItems: "start"
						},
						children: [h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [
								t("sfxVolumeLabel"),
								h("input", {
									type: "number",
									min: "0",
									max: "1",
									step: "0.1",
									value: String(sfxVol),
									disabled: busy,
									onChange: (e) => setSfxVol(Number(e.target.value)),
									style: {
										width: "120px",
										...inputStyle
									}
								}),
								h("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: t("sfxVolumeHint")
								})
							]
						}), h("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: [
								t("sfxFileLabel"),
								h("input", {
									type: "text",
									value: sfxFile,
									disabled: busy,
									maxLength: 128,
									placeholder: "need-decision.mp3",
									onChange: (e) => setSfxFile(e.target.value.trim()),
									style: {
										width: "100%",
										...inputStyle
									}
								}),
								h("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: t("sfxFileHint")
								})
							]
						})]
					})]
				}),
				h("div", {
					style: {
						marginTop: "10px",
						fontSize: "13px",
						fontWeight: 500,
						color: "var(--dsw-alias-label-primary)"
					},
					children: t("physicsTitle")
				}),
				h("p", {
					style: {
						margin: 0,
						fontSize: "11px",
						color: "var(--dsw-alias-label-tertiary)",
						lineHeight: "16px"
					},
					children: t("physicsHint")
				}),
				h("div", {
					style: {
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: "10px 16px",
						marginTop: "4px",
						alignItems: "start"
					},
					children: [
						physField("gravity", "50", "0"),
						physField("restitution", "0.01", "0"),
						physField("groundFriction", "0.1", "0"),
						physField("throwPower", "0.05", "0.05"),
						toggleCell$1("physicsCeilingBounce", physics.ceilingBounce, busy, (v) => setPhysics((p) => ({
							...p,
							ceilingBounce: v
						}))),
						toggleCell$1("physicsPetCollision", physics.petCollision, busy, (v) => setPhysics((p) => ({
							...p,
							petCollision: v
						})))
					]
				}),
				h("div", {
					style: {
						display: "flex",
						gap: "8px",
						alignItems: "center",
						marginTop: "4px"
					},
					children: [h("button", {
						type: "button",
						onClick: () => void grantNotifyPermission(),
						style: {
							border: "1px solid var(--dsw-alias-border-l2)",
							background: "transparent",
							color: "var(--dsw-alias-label-primary)",
							borderRadius: "8px",
							padding: "4px 14px",
							fontSize: "12px",
							cursor: "pointer"
						},
						children: t("notifyGetPermission")
					}), permMsg.text ? h("span", {
						style: {
							fontSize: "12px",
							color: permMsg.kind === "err" ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-ok-primary)",
							lineHeight: "18px"
						},
						children: permMsg.text
					}) : null]
				}),
				h("div", {
					style: {
						display: "flex",
						gap: "8px",
						alignItems: "center",
						marginTop: "4px"
					},
					children: [
						h("button", {
							type: "button",
							disabled: busy,
							onClick: () => void save(),
							style: {
								border: "1px solid var(--dsw-alias-button-info-fill)",
								background: "var(--dsw-alias-button-info-fill)",
								color: "#fff",
								borderRadius: "8px",
								padding: "4px 14px",
								fontSize: "12px",
								cursor: "pointer",
								opacity: busy ? .5 : 1
							},
							children: t("save")
						}),
						h("button", {
							type: "button",
							disabled: busy,
							onClick: sync,
							style: {
								border: "1px solid var(--dsw-alias-border-l2)",
								background: "transparent",
								color: "var(--dsw-alias-label-primary)",
								borderRadius: "8px",
								padding: "4px 14px",
								fontSize: "12px",
								cursor: "pointer",
								opacity: busy ? .5 : 1
							},
							children: t("sync")
						}),
						msg.text ? h("span", {
							style: {
								fontSize: "12px",
								color: msg.kind === "err" ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-ok-primary)",
								marginLeft: "4px"
							},
							children: msg.text
						}) : null
					]
				}),
				h("p", {
					style: {
						margin: 0,
						fontSize: "11px",
						color: "var(--dsw-alias-label-tertiary)",
						lineHeight: "16px"
					},
					children: t("syncHint")
				}),
				paths ? h("div", {
					style: {
						marginTop: "12px",
						padding: "10px 14px",
						border: "1px solid var(--dsw-alias-border-l2)",
						borderRadius: "12px",
						display: "flex",
						flexDirection: "column",
						gap: "6px",
						fontSize: "12px",
						color: "var(--dsw-alias-label-secondary)"
					},
					children: [
						h("div", {
							style: {
								fontSize: "12px",
								color: "var(--dsw-alias-label-primary)",
								fontWeight: 500
							},
							children: t("configMeta")
						}),
						h("div", {
							style: {
								fontSize: "12px",
								lineHeight: "20px"
							},
							children: t("configMetaHint")
						}),
						h("div", {
							style: {
								fontSize: "12px",
								lineHeight: "18px",
								wordBreak: "break-all"
							},
							children: t("defaultConfig") + "：" + paths.default
						}),
						h("div", {
							style: {
								fontSize: "12px",
								lineHeight: "18px",
								wordBreak: "break-all"
							},
							children: t("userConfig") + "：" + paths.user
						}),
						h("div", {
							style: {
								fontSize: "12px",
								lineHeight: "18px",
								wordBreak: "break-all"
							},
							children: t("animationDir") + "：" + paths.animations
						})
					]
				}) : null,
				paths && paths.storage && paths.storage.length > 0 ? h("div", {
					style: {
						marginTop: "12px",
						padding: "10px 14px",
						border: "1px solid var(--dsw-alias-border-l2)",
						borderRadius: "12px",
						display: "flex",
						flexDirection: "column",
						gap: "6px",
						fontSize: "12px",
						color: "var(--dsw-alias-label-secondary)"
					},
					children: [
						h("div", {
							style: {
								fontSize: "12px",
								color: "var(--dsw-alias-label-primary)",
								fontWeight: 500
							},
							children: t("storageTitle")
						}),
						h("div", {
							style: {
								fontSize: "12px",
								lineHeight: "20px"
							},
							children: t("storageHint")
						}),
						...paths.storage.map((s) => h("div", {
							key: s.key,
							style: {
								fontSize: "12px",
								lineHeight: "18px",
								wordBreak: "break-all",
								userSelect: "text"
							},
							children: [h("span", {
								style: {
									color: "var(--dsw-alias-label-primary)",
									fontFamily: MONO
								},
								children: s.path
							}), h("span", { children: " — " + t("storage." + s.key) + (s.exists === false ? t("storageMissing") : "") })]
						})),
						h("div", {
							style: {
								marginTop: "4px",
								fontSize: "12px",
								color: "var(--dsw-alias-label-primary)",
								fontWeight: 500
							},
							children: t("uninstallTitle")
						}),
						h("div", {
							style: {
								fontSize: "12px",
								lineHeight: "20px"
							},
							children: t("uninstallStep1")
						}),
						h("div", {
							style: {
								fontSize: "12px",
								lineHeight: "20px"
							},
							children: t("uninstallStep2")
						}),
						h("div", {
							style: {
								fontFamily: MONO,
								fontSize: "12px",
								lineHeight: "18px",
								wordBreak: "break-all",
								userSelect: "text",
								padding: "6px 10px",
								borderRadius: "8px",
								border: "1px solid var(--dsw-alias-border-l2)",
								background: "var(--dsw-alias-interactive-bg-active)",
								color: "var(--dsw-alias-label-primary)"
							},
							children: t("uninstallCmd").replace("{profile}", paths.profile || "<profile>")
						}),
						h("div", {
							style: {
								fontSize: "12px",
								lineHeight: "20px"
							},
							children: t("uninstallStep3")
						})
					]
				}) : null,
				dialog ? h("div", {
					style: {
						position: "fixed",
						inset: 0,
						zIndex: 2147483647,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: "rgba(0, 0, 0, 0.45)"
					},
					onClick: () => setDialog(null),
					children: h("div", {
						style: {
							width: "340px",
							maxWidth: "calc(100vw - 40px)",
							background: "var(--dsw-alias-bg-layer-1)",
							border: "1px solid var(--dsw-alias-border-l2)",
							borderRadius: "12px",
							padding: "16px 18px",
							boxShadow: "0 8px 30px rgba(0, 0, 0, 0.35)",
							display: "flex",
							flexDirection: "column",
							gap: "12px"
						},
						onClick: (e) => e.stopPropagation(),
						children: [
							h("div", {
								style: {
									fontSize: "14px",
									fontWeight: 500,
									color: "var(--dsw-alias-label-primary)"
								},
								children: dialog.kind === "corrupt" ? t("corruptTitle") : t("confirmTitle")
							}),
							h("div", {
								style: {
									fontSize: "13px",
									lineHeight: "20px",
									color: "var(--dsw-alias-label-secondary)"
								},
								children: dialog.kind === "remove" ? t("confirmRemove").replace("{id}", selId) : dialog.kind === "corrupt" ? t("corruptBody").replace("{path}", dialog.path) : t("confirmSync")
							}),
							h("div", {
								style: {
									display: "flex",
									gap: "8px",
									justifyContent: "flex-end"
								},
								children: [h("button", {
									type: "button",
									onClick: () => setDialog(null),
									style: {
										border: "1px solid var(--dsw-alias-border-l2)",
										background: "transparent",
										color: "var(--dsw-alias-label-primary)",
										borderRadius: "8px",
										padding: "4px 14px",
										fontSize: "12px",
										cursor: "pointer"
									},
									children: t("cancel")
								}), h("button", {
									type: "button",
									onClick: () => {
										const d = dialog;
										setDialog(null);
										if (d.kind === "remove") doRemove();
										else if (d.kind === "corrupt") save(true);
										else doSync();
									},
									style: dialog.kind === "sync" ? {
										border: "1px solid var(--dsw-alias-button-info-fill)",
										background: "var(--dsw-alias-button-info-fill)",
										color: "#fff",
										borderRadius: "8px",
										padding: "4px 14px",
										fontSize: "12px",
										cursor: "pointer"
									} : {
										border: "1px solid var(--dsw-alias-state-error-secondary)",
										background: "transparent",
										color: "var(--dsw-alias-state-error-primary)",
										borderRadius: "8px",
										padding: "4px 14px",
										fontSize: "12px",
										cursor: "pointer"
									},
									children: dialog.kind === "remove" ? t("remove") : dialog.kind === "corrupt" ? t("corruptConfirm") : t("sync")
								})]
							})
						]
					})
				}) : null
			]
		});
	};
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
//#region src/shared/productivity.ts
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

//#endregion
//#region src/client/pet.ts
/** 播放动画扩展名 = 共享常量（src/shared/constants.ts 的 ANIMATION_EXT，默认 .webm）。
*  macOS Safari/WKWebView 需改共享常量/产物为 .mov（HEVC-with-Alpha）后自构建。 */
const THUMB_EXT = ANIMATION_EXT;
/** 余额气泡展示时长（ms）：定时自动消失，与动画生命周期解耦 */
const BUBBLE_DURATION_MS = 10 * 1e3;
/** 内联 CSS —— 注入一次（官方插件标准做法） */
const css = [
	".dsh-pet-desktop-root{position:fixed;z-index:40;pointer-events:none;user-select:none}",
	".dsh-pet-desktop-root[data-corner=\"bottom-right\"]{right:var(--dsh-pet-desktop-mx,24px);bottom:var(--dsh-pet-desktop-my,0)}",
	".dsh-pet-desktop-root[data-corner=\"bottom-left\"]{left:var(--dsh-pet-desktop-mx,24px);bottom:var(--dsh-pet-desktop-my,0)}",
	".dsh-pet-desktop-root[data-corner=\"top-right\"]{right:var(--dsh-pet-desktop-mx,24px);top:var(--dsh-pet-desktop-my,0)}",
	".dsh-pet-desktop-root[data-corner=\"top-left\"]{left:var(--dsh-pet-desktop-mx,24px);top:var(--dsh-pet-desktop-my,0)}",
	".dsh-pet-desktop-stage{position:relative;width:var(--dsh-pet-desktop-size,462px);height:calc(var(--dsh-pet-desktop-size,462px)*9/16);pointer-events:none}",
	".dsh-pet-desktop-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:0;transition:opacity .18s ease;transform-origin:center}",
	".dsh-pet-desktop-video.is-front{opacity:1}",
	".dsh-pet-desktop-hit{position:absolute;pointer-events:auto;cursor:url(\"/dsh-pet-desktop-7340/pic/cursor-grab.png\") 16 16, grab;z-index:1}",
	".dsh-pet-desktop-hit.dragging{cursor:url(\"/dsh-pet-desktop-7340/pic/cursor-grabbing.png\") 16 16, grabbing}",
	"@media (prefers-reduced-motion: reduce){.dsh-pet-desktop-video{transition:none}}",
	MENU_CSS
].join("\n");
const cssTag = "dsh-pet-desktop/style.css";
function injectCss() {
	if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + cssTag + "\"]") === null) {
		const tag = document.createElement("style");
		tag.dataset.plugin = "dsh-pet-desktop";
		tag.dataset.pluginCss = cssTag;
		tag.textContent = css;
		document.head.appendChild(tag);
	}
}
function makePetUI(rt) {
	const { h, useState, useEffect, useRef } = rt;
	injectCss();
	/** 余额气泡（哑组件：数据与显隐由 PetCard 传入） */
	const BalanceBubble = makeBalanceBubble({ h });
	/** 碎碎念气泡（哑组件：文本与显隐由 PetCard 传入） */
	const WhisperBubble = makeWhisperBubble({ h });
	/** 单个宠物实例（配置由容器 PetMulti 传入；碎碎念轮询/触发/气泡完全自理） */
	function PetCard({ cfg, balance, balanceTick, balanceNoticeTick, workStatus, workStatusTick, productivity, productivityNow, arena }) {
		const [size, setSize] = useState(cfg.size);
		const halfW = size / 2;
		const halfH = size * 9 / 16 / 2;
		const bottomPad = size * (9 / 16) * (CANVAS_H - FEET_Y) / CANVAS_H;
		const petAnims = cfg.animations;
		const petWeights = cfg.animationWeights;
		const [anim, setAnim] = useState(petAnims.idle[0] ?? "");
		const [once, setOnce] = useState(true);
		const [facing, setFacing] = useState("left");
		const [dragging, setDragging] = useState(false);
		const [customPos, setCustomPos] = useState(null);
		const [corner, setCorner] = useState(cfg.position.corner);
		const [margin, setMargin] = useState({
			x: cfg.position.marginX,
			y: cfg.position.marginY
		});
		const [bubbleOn, setBubbleOn] = useState(false);
		const bubbleTimerRef = useRef(null);
		const [whisperBubbleOn, setWhisperBubbleOn] = useState(false);
		const whisperBubbleTimerRef = useRef(null);
		const [whisperText, setWhisperText] = useState(null);
		const [whisperImage, setWhisperImage] = useState(void 0);
		const [workBubbleOn, setWorkBubbleOn] = useState(false);
		const workBubbleTimerRef = useRef(null);
		const [workText, setWorkText] = useState(null);
		const menuRef = useRef(null);
		const chatRef = useRef(null);
		useEffect(() => {
			setSize(cfg.size);
			setCorner(cfg.position.corner);
			setMargin({
				x: cfg.position.marginX,
				y: cfg.position.marginY
			});
		}, [
			cfg.size,
			cfg.position.corner,
			cfg.position.marginX,
			cfg.position.marginY
		]);
		const [seq, setSeq] = useState(0);
		const rootRef = useRef(null);
		const stageRef = useRef(null);
		const videoARef = useRef(null);
		const videoBRef = useRef(null);
		const frontRef = useRef(0);
		const pendingRef = useRef(null);
		const genRef = useRef(0);
		const dragRef = useRef({
			active: false,
			dragging: false,
			sx: 0,
			sy: 0,
			offX: 0,
			offY: 0
		});
		const justDraggedRef = useRef(false);
		const dragTrailRef = useRef([]);
		const boxPxRef = useRef(null);
		const dragTargetRef = useRef(null);
		const dragVelRef = useRef({
			vx: 0,
			vy: 0
		});
		const dragFollowRef = useRef(null);
		const dragFollowTokenRef = useRef(0);
		const throwRef = useRef(null);
		const throwTokenRef = useRef(0);
		const throwStateRef = useRef(null);
		const pressScoreFiredRef = useRef(false);
		const squashRef = useRef(null);
		const squashTokenRef = useRef(0);
		const pendingSquashRef = useRef(false);
		const animRef = useRef(anim);
		animRef.current = anim;
		const workStatusRef = useRef(workStatus);
		workStatusRef.current = workStatus;
		const blobUrlRef = useRef({
			a: null,
			b: null
		});
		const mountedRef = useRef(false);
		const inflightRef = useRef([]);
		const switchTo = (next, nextOnce) => {
			if (!next) return;
			const pending = pendingRef.current;
			if (pending && pending.anim === next && pending.once === nextOnce) {
				if (pendingSquashRef.current) {
					pendingSquashRef.current = false;
					const front = frontRef.current === 0 ? videoARef : videoBRef;
					if (front.current) startSquash(front.current);
				}
				return;
			}
			const gen = ++genRef.current;
			pendingRef.current = {
				anim: next,
				once: nextOnce,
				gen
			};
			const target = frontRef.current === 0 ? videoBRef : videoARef;
			const el = target.current;
			if (!el) return;
			const inEvents = isEventAnim(petAnims.events, next);
			if (inEvents) console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " switch " + next + " once=" + nextOnce);
			const assetUrl = "/dsh-pet-desktop-7340/thumb/" + encodeURIComponent(cfg.assetRoot ?? cfg.id) + "/" + encodeURIComponent(next) + THUMB_EXT;
			el.loop = !nextOnce;
			el.muted = true;
			el.autoplay = true;
			el.playsInline = true;
			el.onended = nextOnce ? handleEnded : null;
			const targetIsB = frontRef.current === 0;
			const ac = new AbortController();
			inflightRef.current.push(ac);
			const fetchTimer = window.setTimeout(() => ac.abort(), 1e4);
			fetch(assetUrl, {
				cache: "default",
				signal: ac.signal
			}).then((r) => {
				if (!r.ok) throw new Error("asset HTTP " + r.status);
				return r.blob();
			}).then((blob) => {
				window.clearTimeout(fetchTimer);
				const ix = inflightRef.current.indexOf(ac);
				if (ix !== -1) inflightRef.current.splice(ix, 1);
				if (!mountedRef.current) return;
				if (pendingRef.current?.gen !== gen) return;
				const slot = targetIsB ? "b" : "a";
				const oldUrl = blobUrlRef.current[slot];
				if (oldUrl) URL.revokeObjectURL(oldUrl);
				const obj = URL.createObjectURL(blob);
				blobUrlRef.current[slot] = obj;
				el.src = obj;
				el.load();
			}).catch((err) => {
				window.clearTimeout(fetchTimer);
				const ix = inflightRef.current.indexOf(ac);
				if (ix !== -1) inflightRef.current.splice(ix, 1);
				if (!mountedRef.current) return;
				if (pendingRef.current?.gen !== gen) return;
				pendingRef.current = null;
				console.warn("[dsh-pet-desktop] 素材加载失败 pet=" + cfg.id + " anim=" + next + "：" + (err instanceof Error ? err.message : String(err)) + "（已释放本次切换）");
			});
			const onReady = () => {
				el.removeEventListener("loadeddata", onReady);
				if (pendingRef.current?.gen !== gen) return;
				const old = frontRef.current === 0 ? videoARef : videoBRef;
				el.classList.add("is-front");
				if (old.current && old.current !== el) {
					old.current.classList.remove("is-front");
					old.current.onended = null;
					old.current.pause();
				}
				frontRef.current = frontRef.current === 0 ? 1 : 0;
				pendingRef.current = null;
				el.style.transform = facingRef.current === "right" ? "scaleX(-1)" : "";
				el.play().catch(() => {});
				if (pendingSquashRef.current) {
					pendingSquashRef.current = false;
					startSquash(el);
				}
				if (pendingMoveRef.current) startMoveDrive(el);
			};
			el.addEventListener("loadeddata", onReady);
		};
		useEffect(() => {
			switchTo(anim, once);
		}, [
			anim,
			once,
			seq
		]);
		useEffect(() => {
			mountedRef.current = true;
			const bu = blobUrlRef.current;
			const inflight = inflightRef.current;
			return () => {
				mountedRef.current = false;
				for (const c of inflight) c.abort();
				inflight.length = 0;
				stopMove();
				stopDragFollow();
				stopThrow();
				stopSquash();
				if (bu.a) URL.revokeObjectURL(bu.a);
				if (bu.b) URL.revokeObjectURL(bu.b);
			};
		}, []);
		useEffect(() => () => {
			if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
			if (whisperBubbleTimerRef.current !== null) window.clearTimeout(whisperBubbleTimerRef.current);
		}, []);
		useEffect(() => () => {
			if (menuRef.current) {
				menuRef.current.close();
				menuRef.current = null;
			}
			if (chatRef.current) {
				chatRef.current.close();
				chatRef.current = null;
			}
		}, []);
		const prevTickRef = useRef(0);
		useEffect(() => {
			if (!cfg.balanceEnabled) return;
			if (balanceTick === 0 || balanceTick === prevTickRef.current) return;
			prevTickRef.current = balanceTick;
			if (!balance || !balance.ok) return;
			const p = balancePercent(balance);
			if (p === void 0) return;
			const pool = petAnims.events?.balance;
			if (!pool || pool.length === 0) {
				console.error("[dsh-pet-desktop] 配置缺少 animations.events.balance，无法播放余额事件动画");
				return;
			}
			const idx = balanceEventIndex(p);
			const slot = pool[idx];
			if (!slot) {
				console.error("[dsh-pet-desktop] balance 档位索引越界：p=" + p + " idx=" + idx);
				return;
			}
			const name = pickSlot(slot, animRef.current);
			console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " balance pet=" + cfg.id + " p=" + p.toFixed(1) + "% -> [档" + idx + "] " + name);
			stopMove();
			setBubbleOn(true);
			if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
			bubbleTimerRef.current = window.setTimeout(() => setBubbleOn(false), BUBBLE_DURATION_MS);
			setOnce(true);
			setAnim(name);
		}, [balanceTick]);
		const prevNoticeRef = useRef(0);
		useEffect(() => {
			if (!cfg.balanceEnabled) return;
			if (balanceNoticeTick === 0 || balanceNoticeTick === prevNoticeRef.current) return;
			prevNoticeRef.current = balanceNoticeTick;
			if (!balance || balance.ok) return;
			setBubbleOn(true);
			if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
			bubbleTimerRef.current = window.setTimeout(() => setBubbleOn(false), BUBBLE_DURATION_MS);
		}, [balanceNoticeTick]);
		const prevWorkTickRef = useRef(0);
		const prevWorkStateRef = useRef(void 0);
		useEffect(() => {
			if (!cfg.workStatusEnabled) return;
			if (workStatusTick === 0 || workStatusTick === prevWorkTickRef.current) return;
			prevWorkTickRef.current = workStatusTick;
			if (!workStatus || workStatus.state === null) {
				console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " " + (prevWorkStateRef.current ?? "null") + "->null    播完即停（回待机，收起气泡）");
				prevWorkStateRef.current = null;
				if (poolIncludes(petAnims.events?.workStatus ?? [], animRef.current)) {
					const front = frontRef.current === 0 ? videoARef.current : videoBRef.current;
					if (front) {
						front.loop = false;
						front.onended = handleEnded;
					}
				}
				if (workBubbleTimerRef.current !== null) window.clearTimeout(workBubbleTimerRef.current);
				workBubbleTimerRef.current = null;
				setWorkText(null);
				setWorkBubbleOn(false);
				return;
			}
			const pool = petAnims.events?.workStatus;
			if (!pool || pool.length === 0) {
				console.error("[dsh-pet-desktop] 配置缺少 animations.events.workStatus，无法播放工作状态动画");
				return;
			}
			const idx = WORK_STATUS_INDEX[workStatus.state];
			const slot = pool[idx];
			if (slot === void 0) {
				console.error("[dsh-pet-desktop] work-status 档位索引越界：state=" + workStatus.state + " idx=" + idx);
				return;
			}
			const name = pickSlot(slot, animRef.current);
			console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " " + (prevWorkStateRef.current ?? "null") + "->" + workStatus.state + "    " + name);
			const stateChanged = prevWorkStateRef.current !== workStatus.state;
			prevWorkStateRef.current = workStatus.state;
			stopMove();
			const textGroup = Array.isArray(cfg.workStatusTexts) ? cfg.workStatusTexts[idx] : void 0;
			const configuredText = Array.isArray(textGroup) && textGroup.length > 0 ? textGroup[Math.floor(Math.random() * textGroup.length)] : void 0;
			setWorkText(workStatus.task ?? configuredText ?? null);
			const terminal = workStatus.state === "success" || workStatus.state === "error";
			if (stateChanged) {
				setWorkBubbleOn(true);
				if (workBubbleTimerRef.current !== null) window.clearTimeout(workBubbleTimerRef.current);
				workBubbleTimerRef.current = terminal ? window.setTimeout(() => setWorkBubbleOn(false), BUBBLE_DURATION_MS) : null;
			}
			const rotating = !terminal && Array.isArray(slot) && slot.length > 1;
			setOnce(terminal || rotating);
			setAnim(name);
		}, [workStatusTick]);
		const whisperTextRef = useRef(null);
		const prevWhisperTsRef = useRef(0);
		useEffect(() => {
			if (!cfg.whisperEnabled) return;
			let alive = true;
			let hasBaseline = false;
			const refresh = async () => {
				try {
					const state = await fetchWhisperState("/dsh-pet-desktop-7340/whisper?pet=" + encodeURIComponent(cfg.id));
					if (!alive) return;
					if (state.ok) {
						if (!hasBaseline) {
							hasBaseline = true;
							prevWhisperTsRef.current = state.ts;
							whisperTextRef.current = state.text;
							return;
						}
						if (state.ts !== prevWhisperTsRef.current) {
							prevWhisperTsRef.current = state.ts;
							whisperTextRef.current = state.text;
							triggerWhisper(state.text, state.image);
						}
					} else console.warn("[dsh-pet-desktop] 碎碎念生成失败 pet=" + cfg.id + " reason=" + state.reason + (state.message ? " " + state.message : ""));
				} catch (e) {
					if (alive) console.warn("[dsh-pet-desktop] 碎碎念拉取异常 pet=" + cfg.id, e);
				}
			};
			refresh();
			const intervalMs = Math.max(1e3, (cfg.eventsRefreshSec.whisper ?? 3600) * 1e3);
			const timer = window.setInterval(() => void refresh(), intervalMs);
			return () => {
				alive = false;
				window.clearInterval(timer);
			};
		}, [cfg.id, cfg.whisperEnabled]);
		const prevBroadcastTsRef = useRef(0);
		useEffect(() => {
			let alive = true;
			let hasBaseline = false;
			const refresh = async () => {
				try {
					const r = await fetch("/dsh-pet-desktop-7340/broadcast?pet=" + encodeURIComponent(cfg.id), { cache: "no-store" });
					if (!alive || !r.ok) return;
					const d = await r.json().catch(() => null);
					if (!d || d.ok !== true) return;
					const ts = typeof d.ts === "number" ? d.ts : 0;
					if (!hasBaseline) {
						hasBaseline = true;
						prevBroadcastTsRef.current = ts;
						return;
					}
					if (ts === 0 || ts === prevBroadcastTsRef.current) return;
					prevBroadcastTsRef.current = ts;
					if (typeof d.text === "string" && d.text) triggerWhisper(d.text, typeof d.image === "string" ? d.image : void 0);
				} catch {}
			};
			refresh();
			const timer = window.setInterval(() => void refresh(), 1e3);
			return () => {
				alive = false;
				window.clearInterval(timer);
			};
		}, [cfg.id]);
		const triggerWhisper = (text, image) => {
			const pool = petAnims.events?.whisper;
			if (!pool || pool.length === 0) {
				console.error("[dsh-pet-desktop] 配置缺少 animations.events.whisper，无法播放碎碎念动画");
				return;
			}
			const name = pickSlot(pick(pool, animRef.current), animRef.current);
			console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " whisper pet=" + cfg.id + " -> [" + name + "] 「" + text + "」");
			stopMove();
			setWhisperText(text);
			setWhisperImage(image);
			setWhisperBubbleOn(true);
			if (whisperBubbleTimerRef.current !== null) window.clearTimeout(whisperBubbleTimerRef.current);
			whisperBubbleTimerRef.current = window.setTimeout(() => setWhisperBubbleOn(false), BUBBLE_DURATION_MS);
			setOnce(true);
			setAnim(name);
		};
		useEffect(() => {
			const onResize = () => setCustomPos((prev) => prev ? { ...prev } : prev);
			window.addEventListener("resize", onResize);
			return () => window.removeEventListener("resize", onResize);
		}, []);
		const pickNext = () => {
			const animations = petAnims;
			const animationWeights = petWeights;
			const roll = Math.random();
			const k = rollKind(roll, animationWeights);
			let kind;
			let next;
			if (k === "idle") {
				kind = "IDLE";
				next = pick(animations.idle, animRef.current);
				setAnim(next);
			} else if (k === "turn") {
				kind = "TURN";
				next = pick(animations.turn, animRef.current);
				setAnim(next);
			} else if (k === "move") {
				const moved = tryMove();
				if (moved === false) {
					const act = pickCategoryAction(animations.categories, animations.idle, facingRef.current, animRef.current);
					kind = act.id;
					next = act.name;
					setAnim(next);
				} else {
					kind = "MOVES";
					next = typeof moved === "string" ? moved : "移动进行中(不重播)";
				}
			} else {
				const act = pickCategoryAction(animations.categories, animations.idle, facingRef.current, animRef.current);
				kind = act.id;
				next = act.name;
				setAnim(next);
			}
			console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " facing=" + facingRef.current + " roll=" + roll.toFixed(4) + " -> [" + kind + "] " + next);
			setOnce(true);
			setSeq((s) => s + 1);
		};
		const resumeWorkStatusAnim = () => {
			const ws = workStatusRef.current;
			if (!ws || !ws.state || ws.state === "success" || ws.state === "error") return false;
			const pool = petAnims.events?.workStatus;
			if (!pool || pool.length === 0) return false;
			const idx = WORK_STATUS_INDEX[ws.state];
			const slot = pool[idx];
			if (slot === void 0) return false;
			const name = pickSlot(slot, animRef.current);
			console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " 互动结束恢复状态动画: " + name);
			setOnce(Array.isArray(slot) && slot.length > 1);
			setAnim(name);
			return true;
		};
		const handleEnded = (e) => {
			const evEl = e && e.currentTarget;
			if (evEl && !evEl.classList.contains("is-front")) return;
			const animations = petAnims;
			if (dragRef.current.active) return;
			const isEvent = isEventAnim(animations.events, animRef.current);
			const wsNow = workStatusRef.current;
			if (isEvent && wsNow && wsNow.state && wsNow.state !== "success" && wsNow.state !== "error") {
				const nextWork = nextWorkStatusAnim(animations.events?.workStatus ?? [], animRef.current);
				if (nextWork !== null) {
					console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " workStatus 档内轮换: " + animRef.current + " -> " + nextWork);
					setOnce(true);
					setAnim(nextWork);
					setSeq((s) => s + 1);
					return;
				}
				if (poolIncludes(animations.events?.workStatus ?? [], animRef.current)) {
					console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " workStatus 循环续播: " + animRef.current);
					setOnce(false);
					setSeq((s) => s + 1);
					return;
				}
			}
			if (isEvent) {
				console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " 事件动画播完 ended anim=" + animRef.current + " ws=" + (workStatusRef.current && workStatusRef.current.state || "null"));
				if (resumeWorkStatusAnim()) return;
				if (animations.idle.length) setAnim(pick(animations.idle, animRef.current));
				setOnce(true);
				setSeq((s) => s + 1);
				return;
			}
			if (animations.turn.includes(animRef.current)) {
				const next = facing === "left" ? "right" : "left";
				setFacing(next);
				facingRef.current = next;
			}
			if (animations.drag.includes(animRef.current) || animations.clicks.includes(animRef.current)) {
				if (resumeWorkStatusAnim()) return;
				if (animations.idle.length) setAnim(pick(animations.idle, animRef.current));
				setOnce(true);
				setSeq((s) => s + 1);
				return;
			}
			pickNext();
		};
		const moveRef = useRef(null);
		const moveTokenRef = useRef(0);
		const pendingMoveRef = useRef(null);
		const customPosRef = useRef(customPos);
		customPosRef.current = customPos;
		const currentCenterX = () => {
			const cp = customPosRef.current;
			if (cp) return cp.rx * window.innerWidth;
			const rootEl = rootRef.current;
			if (rootEl) return rootEl.getBoundingClientRect().left + halfW;
			return window.innerWidth - 24 - halfW;
		};
		const currentCenterY = () => {
			const cp = customPosRef.current;
			if (cp) return cp.ry * window.innerHeight;
			const rootEl = rootRef.current;
			if (rootEl) return rootEl.getBoundingClientRect().top + halfH;
			return window.innerHeight - 20 - halfH;
		};
		const startMoveDrive = (el) => {
			const pm = pendingMoveRef.current;
			if (!pm || moveRef.current !== null) return;
			pendingMoveRef.current = null;
			const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
			const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
			const travelWindow = Math.max(.1, duration - leadSec - tailSec);
			const token = ++moveTokenRef.current;
			const step = () => {
				if (moveTokenRef.current !== token) return;
				const t = el.currentTime || 0;
				const rootEl = rootRef.current;
				if (rootEl) {
					const W = window.innerWidth;
					const H = window.innerHeight;
					let ratioX;
					if (t <= leadSec) ratioX = startRatio;
					else if (t >= duration - tailSec) ratioX = targetRatio;
					else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);
					const px = ratioX * W;
					const py = startYRatio * H;
					rootEl.style.left = px - halfW + "px";
					rootEl.style.top = py - halfH + "px";
					rootEl.style.right = "auto";
					rootEl.style.bottom = "auto";
				}
				if (t < duration - tailSec) moveRef.current = requestAnimationFrame(step);
				else {
					moveRef.current = null;
					setCustomPos({
						rx: targetRatio,
						ry: startYRatio
					});
				}
			};
			moveRef.current = requestAnimationFrame(step);
		};
		/** 尝试发起一次移动：占用中返回 true（不重播），无法移动返回 false，成功返回动作名（供日志显示具体动作）。
		*  preferredName 传入时固定使用该动画（右键菜单点播移动动画），否则与随机链一致随机从 moves.actions 选。 */
		const tryMove = (preferredName) => {
			if (moveRef.current !== null || pendingMoveRef.current || throwRef.current !== null) return true;
			const moves = petAnims.moves;
			const actions = moves.actions;
			if (!actions.length) return false;
			const chosen = preferredName ? actions.find((a) => a.name === preferredName) ?? null : actions[Math.floor(Math.random() * actions.length)];
			if (!chosen) return false;
			const mp = Object.assign({}, moves.default, chosen.params || {});
			const dir = facingRef.current === "right" !== petAnims.turn.includes(animRef.current) ? 1 : -1;
			const W = window.innerWidth;
			const distScale = size / PET_REF_WIDTH;
			const plan = planMove({
				cx: currentCenterX(),
				cy: currentCenterY(),
				W,
				H: window.innerHeight,
				dir,
				minDist: mp.minDist * distScale,
				maxDist: mp.maxDist * distScale,
				margin: mp.margin,
				halfW,
				sideAllow
			});
			if (!plan) return false;
			pendingMoveRef.current = {
				...plan,
				dir,
				leadSec: mp.leadSec,
				tailSec: mp.tailSec
			};
			setOnce(true);
			setAnim(chosen.name);
			return chosen.name;
		};
		const stopMove = () => {
			pendingMoveRef.current = null;
			moveTokenRef.current++;
			if (moveRef.current !== null) {
				cancelAnimationFrame(moveRef.current);
				moveRef.current = null;
			}
		};
		/** 停止弹簧跟随（不碰 dragState：指针捕获期间由 pointerdown/up 独立管理） */
		const stopDragFollow = () => {
			dragFollowTokenRef.current++;
			if (dragFollowRef.current !== null) {
				cancelAnimationFrame(dragFollowRef.current);
				dragFollowRef.current = null;
			}
			dragTargetRef.current = null;
			dragVelRef.current = {
				vx: 0,
				vy: 0
			};
		};
		/** 停止抛掷（宠物在空中被抓住/点菜单/回家时立即定格在当前落点）。
		*  同时清速度状态 throwStateRef——否则「抓住后温柔放下」会残留最后一次飞行速度，
		*  静止的宠物点一下就误判为飞行中。点击积分用的飞行动态由 pointerdown 提前记录。 */
		const stopThrow = () => {
			throwTokenRef.current++;
			if (throwRef.current !== null) {
				cancelAnimationFrame(throwRef.current);
				throwRef.current = null;
			}
			throwStateRef.current = null;
		};
		/** rAF 弹簧跟随：包围盒朝拖拽目标（指针-抓取偏移）过阻尼追赶，抹平高频抖动 */
		const startDragFollow = (rootEl) => {
			if (dragFollowRef.current !== null) return;
			const token = ++dragFollowTokenRef.current;
			let last = performance.now();
			const step = () => {
				if (dragFollowTokenRef.current !== token) return;
				const target = dragTargetRef.current;
				if (!target) {
					dragFollowRef.current = null;
					return;
				}
				const now = performance.now();
				const dt = Math.min((now - last) / 1e3, 1 / 30);
				last = now;
				const vel = dragVelRef.current;
				let x = boxPxRef.current?.x ?? 0;
				let y = boxPxRef.current?.y ?? 0;
				vel.vx = springStep(vel.vx, x, target.x, dt, cfg.physics.throwPower);
				vel.vy = springStep(vel.vy, y, target.y, dt, cfg.physics.throwPower);
				x += vel.vx * dt;
				y += vel.vy * dt;
				boxPxRef.current = {
					x,
					y
				};
				rootEl.style.left = x + "px";
				rootEl.style.top = y + "px";
				rootEl.style.right = "auto";
				rootEl.style.bottom = "auto";
				dragFollowRef.current = requestAnimationFrame(step);
			};
			dragFollowRef.current = requestAnimationFrame(step);
		};
		/** 抛掷驱动：重力 + 边缘反弹 + 落地摩擦，落定后提交 customPos（飞行中只改 DOM，避免逐帧 React 重渲染） */
		const startThrow = (px, py, vx, vy) => {
			stopDragFollow();
			stopMove();
			const bounds = throwBounds({
				W: window.innerWidth,
				H: window.innerHeight,
				size,
				sideAllow
			});
			const token = ++throwTokenRef.current;
			let state = {
				x: px,
				y: py,
				vx,
				vy
			};
			let last = performance.now();
			let prevGrounded = false;
			const rootEl = rootRef.current;
			const step = () => {
				if (throwTokenRef.current !== token) return;
				const now = performance.now();
				const dt = (now - last) / 1e3;
				last = now;
				const fallingVy = state.vy;
				const res = throwStep(state, dt, bounds, cfg.physics);
				state = {
					x: res.x,
					y: res.y,
					vx: res.vx,
					vy: res.vy
				};
				throwStateRef.current = state;
				if (cfg.physics.petCollision) {
					const myBody = bodyPixelBox({
						x: state.x,
						y: state.y,
						size,
						bottomPad
					});
					for (const slotId of Object.keys(arena.current.slots)) {
						if (slotId === cfg.id) continue;
						const slot = arena.current.slots[slotId];
						const otherBox = slot.getBox();
						if (!otherBox) continue;
						const otherBody = bodyPixelBox({
							x: otherBox.x,
							y: otherBox.y,
							size: slot.size,
							bottomPad: slot.bottomPad
						});
						if (!rectsOverlap(myBody, otherBody)) continue;
						const vel = slot.getVel();
						const hit = collidePet({
							x: state.x,
							y: state.y,
							vx: state.vx,
							vy: state.vy,
							size
						}, {
							x: otherBox.x,
							y: otherBox.y,
							vx: vel.vx,
							vy: vel.vy,
							size: slot.size
						});
						if (hit) {
							state.vx = hit.fvx;
							state.vy = hit.fvy;
							throwStateRef.current = state;
							slot.onHit(hit.hvx, hit.hvy);
							break;
						}
					}
				}
				if (rootEl) {
					rootEl.style.left = res.x + "px";
					rootEl.style.top = res.y + "px";
					rootEl.style.right = "auto";
					rootEl.style.bottom = "auto";
				}
				boxPxRef.current = {
					x: res.x,
					y: res.y
				};
				customPosRef.current = {
					rx: (res.x + halfW) / window.innerWidth,
					ry: (res.y + halfH) / window.innerHeight
				};
				const grounded = res.y >= bounds.maxY - 1;
				if (res.bounced && grounded && !prevGrounded) {
					const frontEl = frontRef.current === 0 ? videoARef.current : videoBRef.current;
					if (frontEl) startSquash(frontEl, landingSquash(fallingVy));
				}
				prevGrounded = grounded;
				if (res.atRest) {
					throwRef.current = null;
					throwStateRef.current = null;
					setCustomPos(customPosRef.current);
					return;
				}
				throwRef.current = requestAnimationFrame(step);
			};
			throwRef.current = requestAnimationFrame(step);
		};
		/** 被撞回调（宠物间碰撞）：被其它飞行中宠物撞到 → 停当前动作，从落点以新初速抛出去（全复用现有物理） */
		const startThrowLatestRef = useRef(() => {});
		startThrowLatestRef.current = startThrow;
		const onPetHit = (vx, vy) => {
			stopMove();
			stopDragFollow();
			stopThrow();
			const bx = boxPxRef.current;
			let sx = 0;
			let sy = 0;
			if (bx) {
				sx = bx.x;
				sy = bx.y;
			} else {
				const r = rootRef.current?.getBoundingClientRect();
				if (r) {
					sx = r.left;
					sy = r.top;
				}
			}
			startThrowLatestRef.current(sx, sy, vx, vy);
		};
		useEffect(() => {
			const arenaSlots = arena.current.slots;
			arenaSlots[cfg.id] = {
				size,
				bottomPad,
				getBox: () => {
					if (boxPxRef.current) return boxPxRef.current;
					const r = rootRef.current?.getBoundingClientRect();
					return r ? {
						x: r.left,
						y: r.top
					} : null;
				},
				getVel: () => throwRef.current !== null && throwStateRef.current ? {
					vx: throwStateRef.current.vx,
					vy: throwStateRef.current.vy
				} : {
					vx: 0,
					vy: 0
				},
				onHit: onPetHit
			};
			return () => {
				delete arenaSlots[cfg.id];
			};
		}, [
			cfg.id,
			size,
			bottomPad,
			arena
		]);
		/** Q 弹挤压：前台视频垂直压扁（贴地锚定，transform-origin:bottom）再回弹；
		*  与桌面同构，曲线在 shared（squashScale）。depth = 下压幅度（点击固定 0.55；
		*  落地按冲击速度 landingSquash 动态取）。reduce-motion 时跳过。 */
		const startSquash = (el, depth = SQ_SQUASH) => {
			if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
			const token = ++squashTokenRef.current;
			if (squashRef.current !== null) cancelAnimationFrame(squashRef.current);
			const origin = el.style.transformOrigin;
			el.style.transformOrigin = "bottom";
			const t0 = performance.now();
			const step = () => {
				if (squashTokenRef.current !== token) return;
				const u = Math.min((performance.now() - t0) / SQ_DURATION_MS, 1);
				const scale = squashScale(u, depth);
				el.style.transform = (facingRef.current === "right" ? "scaleX(-1) " : "") + "scaleY(" + scale + ")";
				if (u < 1) squashRef.current = requestAnimationFrame(step);
				else {
					squashRef.current = null;
					el.style.transformOrigin = origin;
					el.style.transform = facingRef.current === "right" ? "scaleX(-1)" : "";
				}
			};
			squashRef.current = requestAnimationFrame(step);
		};
		const stopSquash = () => {
			squashTokenRef.current++;
			if (squashRef.current !== null) {
				cancelAnimationFrame(squashRef.current);
				squashRef.current = null;
			}
		};
		const facingRef = useRef(facing);
		facingRef.current = facing;
		const handlePointerDown = (e) => {
			if (e.button !== 0) return;
			const grabState = throwStateRef.current;
			console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " grab vx=" + (grabState ? Math.round(grabState.vx) : 0) + " vy=" + (grabState ? Math.round(grabState.vy) : 0) + " |v|=" + (grabState ? Math.round(Math.hypot(grabState.vx, grabState.vy)) : 0));
			pressScoreFiredRef.current = false;
			if (grabState) {
				const grabSpeed = Math.hypot(grabState.vx, grabState.vy);
				if (grabSpeed >= SCORE_MIN_SPEED) {
					const sc = clickScore(grabSpeed, size);
					pressScoreFiredRef.current = true;
					console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " click-score speed=" + Math.round(grabSpeed) + " size=" + size + " -> +" + sc);
					spawnScoreBurst(e.clientX, e.clientY);
					mountScorePopup({
						x: e.clientX,
						y: e.clientY,
						score: sc,
						speed: grabSpeed,
						size
					});
				}
			}
			stopThrow();
			stopDragFollow();
			stopMove();
			dragTrailRef.current = [];
			e.currentTarget.classList.add("dragging");
			e.currentTarget.setPointerCapture(e.pointerId);
			const rootEl = rootRef.current;
			let offX = 0;
			let offY = 0;
			if (rootEl) {
				const rr = rootEl.getBoundingClientRect();
				offX = e.clientX - (rr.left + rr.width / 2);
				offY = e.clientY - (rr.top + rr.height / 2);
				boxPxRef.current = {
					x: rr.left,
					y: rr.top
				};
			}
			dragRef.current = {
				active: true,
				dragging: false,
				sx: e.clientX,
				sy: e.clientY,
				offX,
				offY
			};
		};
		const handlePointerMove = (e) => {
			const d = dragRef.current;
			if (!d.active) return;
			const dx = e.clientX - d.sx;
			const dy = e.clientY - d.sy;
			if (!d.dragging) {
				if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
				d.dragging = true;
				setDragging(true);
				setOnce(true);
				if (petAnims.drag.length) {
					const name = pick(petAnims.drag);
					console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " -> [DRAG] " + name);
					setAnim(name);
				}
			}
			const now = performance.now();
			dragTrailRef.current = trimTrail([...dragTrailRef.current, {
				t: now,
				x: e.clientX,
				y: e.clientY
			}], now);
			dragTargetRef.current = {
				x: e.clientX - d.offX - halfW,
				y: e.clientY - d.offY - halfH
			};
			const rootEl = rootRef.current;
			if (rootEl) startDragFollow(rootEl);
			const stageEl = stageRef.current;
			if (stageEl) stageEl.style.transform = "none";
		};
		const handlePointerUp = (e) => {
			const d = dragRef.current;
			const wasDragging = d.dragging;
			d.active = false;
			d.dragging = false;
			e.currentTarget.classList.remove("dragging");
			stopDragFollow();
			if (wasDragging) {
				justDraggedRef.current = true;
				setTimeout(() => {
					justDraggedRef.current = false;
				}, 100);
				setDragging(false);
				const stageEl = stageRef.current;
				if (stageEl) stageEl.style.transform = "translateY(" + bottomPad + "px)";
				if (!resumeWorkStatusAnim()) {
					if (petAnims.idle.length) setAnim(pick(petAnims.idle, animRef.current));
					setOnce(true);
				}
				const bx = boxPxRef.current;
				const px = bx ? bx.x : e.clientX - d.offX - halfW;
				const py = bx ? bx.y : e.clientY - d.offY - halfH;
				const vel = estimateReleaseVelocity(dragTrailRef.current, performance.now(), cfg.physics);
				dragTrailRef.current = [];
				if (vel) {
					console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " release vx=" + Math.round(vel.vx) + " vy=" + Math.round(vel.vy) + " |v|=" + Math.round(Math.hypot(vel.vx, vel.vy)));
					startThrow(px, py, vel.vx, vel.vy);
				} else setCustomPos({
					rx: (px + halfW) / window.innerWidth,
					ry: (py + halfH) / window.innerHeight
				});
			}
		};
		const handleClick = () => {
			const d = dragRef.current;
			if (d.active || d.dragging || justDraggedRef.current) return;
			if (pressScoreFiredRef.current) {
				pressScoreFiredRef.current = false;
				stopThrow();
				stopMove();
				return;
			}
			stopThrow();
			stopMove();
			setOnce(true);
			if (!petAnims.clicks.length) return;
			const name = pick(petAnims.clicks);
			console.log("[dsh-pet-desktop] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " -> [CLICK] " + name);
			pendingSquashRef.current = true;
			setSeq((s) => s + 1);
			setAnim(name);
		};
		const handleMenuAction = (leaf$1) => {
			if (leaf$1.action === "open-config" || leaf$1.action === "open-productivity") {
				mountProductivityPanel("/dsh-pet-desktop-7340/productivity", leaf$1.action === "open-config" ? "config" : "productivity");
				return;
			}
			if (leaf$1.action === "whisper") {
				console.info("[dsh-pet-desktop] 菜单触发碎碎念 pet=" + cfg.id);
				fetchWhisperTrigger("/dsh-pet-desktop-7340/whisper/trigger?pet=" + encodeURIComponent(cfg.id)).then((state) => {
					if (state.ok) triggerWhisper(state.text, state.image);
					else console.warn("[dsh-pet-desktop] 碎碎念手动触发失败 reason=" + state.reason + (state.message ? " " + state.message : ""));
				}).catch((e) => console.warn("[dsh-pet-desktop] 碎碎念手动触发异常", e));
				return;
			}
			if (leaf$1.action === "chat") {
				if (chatRef.current) chatRef.current.close();
				const hitRect = stageRef.current?.querySelector(".dsh-pet-desktop-hit")?.getBoundingClientRect();
				chatRef.current = mountChatDialog({
					petId: cfg.id,
					baseUrl: "/dsh-pet-desktop-7340/chat",
					x: hitRect ? hitRect.right + 6 : window.innerWidth - 256,
					y: hitRect ? hitRect.top + 6 : 8,
					onReply: (reply, image) => {
						console.info("[dsh-pet-desktop] 对话回复 pet=" + cfg.id + "「" + reply + "」" + (image ? " [" + image + "]" : ""));
						triggerWhisper(reply, image);
					},
					onClose: () => {
						chatRef.current = null;
					}
				});
				return;
			}
			if (leaf$1.action === "home") {
				stopThrow();
				stopMove();
				setCustomPos(null);
				return;
			}
			if (!leaf$1.anim) return;
			if (isNoMirrorAnimation(petAnims.categories, leaf$1.anim) && facingRef.current === "right") setFacing("left");
			if (petAnims.moves.actions.some((a) => a.name === leaf$1.anim)) {
				if (tryMove(leaf$1.anim) === false) {
					stopMove();
					setOnce(true);
					setAnim(leaf$1.anim);
				}
				return;
			}
			stopMove();
			setOnce(true);
			setAnim(leaf$1.anim);
		};
		const handleContextMenu = (e) => {
			const tree = [
				{
					label: "碎碎念",
					action: "whisper"
				},
				{
					label: "对话",
					action: "chat"
				},
				{
					label: "回到初始位置",
					action: "home"
				},
				...buildMenuTree(petAnims)
			];
			if (!tree.length) return;
			e.preventDefault();
			e.stopPropagation();
			const d = dragRef.current;
			if (d.active || d.dragging || justDraggedRef.current) return;
			stopThrow();
			stopMove();
			if (menuRef.current) menuRef.current.close();
			menuRef.current = mountContextMenu({
				tree,
				x: e.clientX,
				y: e.clientY,
				onAction: handleMenuAction,
				onClose: () => {
					if (menuRef.current) menuRef.current = null;
				}
			});
		};
		const sideAllow = HIT_BOX.x0 / 640 * size;
		const stageStyle = dragging ? { transform: "none" } : { transform: "translateY(" + bottomPad + "px)" };
		const rootStyle = customPos ? (() => {
			const rx = customPos.rx;
			const ry = customPos.ry;
			return {
				left: rx * window.innerWidth - halfW + "px",
				top: ry * window.innerHeight - halfH + "px",
				right: "auto",
				bottom: "auto"
			};
		})() : {};
		const workTerminal = workStatus?.state === "success" || workStatus?.state === "error";
		const pomodoroText = productivity ? productivityBubbleText(productivity, productivityNow) : null;
		const bubbleNode = (() => {
			if (workTerminal && workBubbleOn && workText && cfg.workStatusEnabled) return h(WhisperBubble, {
				text: workText,
				on: workBubbleOn
			});
			if (whisperBubbleOn && whisperText) return h(WhisperBubble, {
				text: whisperText,
				image: whisperImage,
				on: whisperBubbleOn
			});
			if (bubbleOn && balance && cfg.balanceEnabled) return h(BalanceBubble, {
				state: balance,
				on: bubbleOn
			});
			if (pomodoroText) return h(WhisperBubble, {
				text: pomodoroText,
				on: true
			});
			if (workBubbleOn && workText && cfg.workStatusEnabled) return h(WhisperBubble, {
				text: workText,
				on: workBubbleOn
			});
			return null;
		})();
		const commonVideoProps = {
			muted: true,
			playsInline: true,
			autoPlay: true,
			title: cfg.name
		};
		const hitProps = {
			className: "dsh-pet-desktop-hit",
			style: {
				left: HIT_BOX.x0 / 640 * 100 + "%",
				top: HIT_BOX.y0 / 360 * 100 + "%",
				width: (HIT_BOX.x1 - HIT_BOX.x0) / 640 * 100 + "%",
				height: (HIT_BOX.y1 - HIT_BOX.y0) / 360 * 100 + "%"
			},
			onClick: handleClick,
			onPointerDown: handlePointerDown,
			onPointerMove: handlePointerMove,
			onPointerUp: handlePointerUp,
			onPointerCancel: handlePointerUp,
			onContextMenu: handleContextMenu,
			title: cfg.name
		};
		return h("div", {
			ref: rootRef,
			className: "dsh-pet-desktop-root",
			"data-corner": corner,
			"data-facing": facing,
			style: Object.assign({
				"--dsh-pet-desktop-size": size + "px",
				"--dsh-pet-desktop-mx": margin.x + "px",
				"--dsh-pet-desktop-my": margin.y + "px"
			}, rootStyle),
			children: [bubbleNode, h("div", {
				ref: stageRef,
				className: "dsh-pet-desktop-stage",
				style: stageStyle,
				children: [
					h("video", Object.assign({}, commonVideoProps, {
						ref: videoARef,
						className: "dsh-pet-desktop-video is-front"
					})),
					h("video", Object.assign({}, commonVideoProps, {
						ref: videoBRef,
						className: "dsh-pet-desktop-video"
					})),
					h("div", hitProps)
				]
			})]
		});
	}
	/** 多开容器：一次拉取成品配置 → 拍平 → 渲染多个 PetCard */
	function PetMulti() {
		const [pets, setPets] = useState([]);
		const [ready, setReady] = useState(false);
		const arenaRef = useRef({ slots: {} });
		const mainRefreshRef = useRef({});
		const [balance, setBalance] = useState(null);
		const [balanceTick, setBalanceTick] = useState(0);
		const [balanceNoticeTick, setBalanceNoticeTick] = useState(0);
		const noticeKeyRef = useRef(null);
		const applyBalanceRef = useRef(() => {});
		applyBalanceRef.current = (state, explicit) => {
			setBalance(state);
			if (state.ok) {
				setBalanceTick((t) => t + 1);
				return;
			}
			const { show, key } = decideBalanceNotice(state, noticeKeyRef.current, explicit);
			noticeKeyRef.current = key;
			if (show) setBalanceNoticeTick((t) => t + 1);
			if (state.reason !== "unsupported") console.error("[dsh-pet-desktop] 余额查询失败 reason=" + state.reason + (state.message ? " " + state.message : ""));
		};
		const [workStatus, setWorkStatus] = useState(null);
		const [workStatusTick, setWorkStatusTick] = useState(0);
		const [productivity, setProductivity] = useState(null);
		const [productivityNow, setProductivityNow] = useState(Date.now());
		useEffect(() => {
			let alive = true;
			const onPanelConfigSaved = (event) => {
				const merged = event.detail;
				if (merged && typeof merged === "object") petBridge.reload(merged);
			};
			window.addEventListener("dsh-pet-desktop:config-saved", onPanelConfigSaved);
			/** 唯一填充点：host 成品聚合 → 渲染列表。初始加载与设置页保存/同步后重载都走这里——
			*  条目级字段（动画池/权重/刷新周期/物理参数/工作状态文案）只由 flattenConfigPets 吹入，
			*  容器不再自己拼任何字段（曾经的第二份补吹实现漏过 physics，导致新增/同步后拖不动）。 */
			const applyMerged = (merged) => {
				const main = merged?.main;
				if (typeof main !== "object" || main === null) throw new Error("配置响应不是成品聚合（host 版本不匹配？）");
				const flattened = flattenConfigPets(merged);
				mainRefreshRef.current = main.eventsRefreshSec ?? {};
				petBridge.current = flattened;
				petBridge.template = Array.isArray(main.pets) ? main.pets[0] ?? void 0 : void 0;
				setPets(flattened);
			};
			/** 拉成品聚合：host readAllConfig 的输出（字段填满、绝对正确），客户端零校验零兜底 */
			const loadMerged = async () => {
				const r = await fetch("/dsh-pet-desktop-7340/config");
				if (!r.ok) throw new Error("config HTTP " + r.status);
				return await r.json();
			};
			(async () => {
				try {
					const merged = await loadMerged();
					if (!alive) return;
					applyMerged(merged);
					setReady(true);
				} catch (e) {
					console.error("[dsh-pet-desktop] 配置加载失败", e);
				}
			})();
			petBridge.reload = (merged) => {
				(async () => {
					try {
						const next = merged ?? await loadMerged();
						if (!alive) return;
						applyMerged(next);
					} catch (e) {
						console.error("[dsh-pet-desktop] 配置重载失败，保留当前渲染列表", e);
					}
				})();
			};
			return () => {
				alive = false;
				window.removeEventListener("dsh-pet-desktop:config-saved", onPanelConfigSaved);
				petBridge.reload = () => {};
			};
		}, []);
		useEffect(() => {
			if (!ready) return;
			let alive = true;
			const refresh = async () => {
				try {
					const response = await fetch("/dsh-pet-desktop-7340/productivity", { cache: "no-store" });
					if (!response.ok) return;
					const next = await response.json();
					if (!alive) return;
					setProductivity((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
				} catch {}
			};
			refresh();
			const timer = window.setInterval(() => void refresh(), 2e3);
			return () => {
				alive = false;
				window.clearInterval(timer);
			};
		}, [ready]);
		useEffect(() => {
			if (!ready) return;
			let alive = true;
			let timer = 0;
			let lastHandled = "";
			let missingWarned = false;
			const audio = typeof Audio !== "undefined" ? new Audio() : null;
			const tick = async () => {
				let state = null;
				try {
					const res = await fetch("/dsh-pet-desktop-7340/sfx", { cache: "no-store" });
					if (res.ok) state = await res.json();
				} catch {}
				if (!alive) return;
				if (state?.missing && !missingWarned) {
					missingWarned = true;
					console.warn("[dsh-pet-desktop] 提醒音已开启但找不到音频文件：放到 ~/.dsh/dsh-pet-desktop/main-sound/ （或包内 assets/sound/），文件名见配置 sfxDecision");
				}
				if (sfxCueAction(lastHandled, state) === "claim" && state?.pending) {
					lastHandled = state.pending.id;
					try {
						const res = await fetch("/dsh-pet-desktop-7340/sfx/claim", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ id: lastHandled })
						});
						const out = res.ok ? await res.json() : null;
						if (out?.play === true && audio && state.url) {
							const url = sfxAssetUrl("/dsh-pet-desktop-7340", state.url);
							if (url) {
								audio.volume = clampSfxVolume(state.volume);
								if (audio.src !== url) audio.src = url;
								audio.currentTime = 0;
								audio.play().catch((e) => {
									console.warn("[dsh-pet-desktop] 提醒音播放失败：" + String(e instanceof Error ? e.message : e));
								});
							}
						}
					} catch {}
				}
				if (!alive) return;
				timer = window.setTimeout(() => void tick(), sfxPollDelayMs(!!state?.enabled));
			};
			tick();
			return () => {
				alive = false;
				window.clearTimeout(timer);
				if (audio) {
					audio.pause();
					audio.src = "";
				}
			};
		}, [ready]);
		useEffect(() => {
			if (!productivity?.pomodoro.state.running) return;
			const refreshNow = () => setProductivityNow(Date.now());
			refreshNow();
			const timer = window.setInterval(refreshNow, 1e3);
			return () => window.clearInterval(timer);
		}, [productivity?.pomodoro.state.running, productivity?.pomodoro.state.sequence]);
		const visiblePets = pets.filter((p) => isWebVisible(p.display));
		const anyBalanceEnabled = visiblePets.some((p) => p.balanceEnabled);
		const anyWorkStatusEnabled = visiblePets.some((p) => p.workStatusEnabled);
		useEffect(() => {
			if (!ready || !anyBalanceEnabled) return;
			let alive = true;
			const refresh = async () => {
				try {
					const state = await fetchBalanceState();
					if (!alive) return;
					applyBalanceRef.current(state, false);
				} catch (e) {
					if (alive) console.error("[dsh-pet-desktop] 余额拉取异常", e);
				}
			};
			refresh();
			const intervalMs = Math.max(1e3, (mainRefreshRef.current.balance ?? 1800) * 1e3);
			const timer = window.setInterval(() => void refresh(), intervalMs);
			return () => {
				alive = false;
				window.clearInterval(timer);
			};
		}, [ready, anyBalanceEnabled]);
		useEffect(() => {
			if (!ready || !anyBalanceEnabled) return;
			let alive = true;
			let prev = -1;
			const poll = async () => {
				try {
					const r = await fetch("/dsh-pet-desktop-7340/balance/trigger");
					if (!alive || !r.ok) return;
					const data = await r.json().catch(() => null);
					const count = data && typeof data.count === "number" ? data.count : -1;
					if (count < 0) return;
					if (prev === -1) {
						prev = count;
						return;
					}
					if (count === prev) return;
					prev = count;
					const state = await fetchBalanceState();
					if (!alive) return;
					applyBalanceRef.current(state, true);
				} catch {}
			};
			poll();
			const timer = window.setInterval(() => void poll(), 1e3);
			return () => {
				alive = false;
				window.clearInterval(timer);
			};
		}, [ready, anyBalanceEnabled]);
		useEffect(() => {
			if (!ready || !anyWorkStatusEnabled) return;
			let alive = true;
			let prevTs = -1;
			const poll = async () => {
				try {
					const snap = await fetchWorkStatus();
					if (!alive) return;
					if (snap.ts === prevTs) return;
					prevTs = snap.ts;
					setWorkStatus(snap);
					setWorkStatusTick((t) => t + 1);
				} catch {}
			};
			poll();
			const timer = window.setInterval(() => void poll(), 1e3);
			return () => {
				alive = false;
				window.clearInterval(timer);
			};
		}, [ready, anyWorkStatusEnabled]);
		const [apiFullscreen, setApiFullscreen] = useState(false);
		useEffect(() => {
			const onChange = () => setApiFullscreen(document.fullscreenElement !== null);
			document.addEventListener("fullscreenchange", onChange);
			onChange();
			return () => document.removeEventListener("fullscreenchange", onChange);
		}, []);
		const hideOnFullscreen = pets.some((p) => p.hideOnFullscreen === true);
		return ready && !(hideOnFullscreen && apiFullscreen) ? visiblePets.map((p) => h(PetCard, {
			key: p.id,
			cfg: p,
			balance,
			balanceTick,
			balanceNoticeTick,
			workStatus,
			workStatusTick,
			productivity,
			productivityNow,
			arena: arenaRef
		})) : null;
	}
	return PetMulti;
}

//#endregion
//#region src/client/productivity.ts
const productivityBridge = {
	current: null,
	async load() {
		const response = await fetch("/dsh-pet-desktop-7340/productivity");
		if (!response.ok) throw new Error("加载生产力数据失败");
		this.current = await response.json();
		return this.current;
	},
	async save(snapshot) {
		const response = await fetch("/dsh-pet-desktop-7340/productivity", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(snapshot)
		});
		if (!response.ok) throw new Error("保存生产力数据失败");
		this.current = await response.json();
		return this.current;
	},
	async action(action, todoId) {
		const snapshot = this.current ?? await this.load();
		const now = Date.now();
		const state = snapshot.pomodoro.state;
		const next = action === "start" ? startTimer(state, todoId ?? state.todoId, now, snapshot.pomodoro.settings) : action === "pause" ? pauseTimer(state, now) : action === "resume" ? resumeTimer(state, now) : action === "skip" ? skipTimer(state, now, snapshot.pomodoro.settings).state : resetTimer(state, snapshot.pomodoro.settings);
		return this.save({
			...snapshot,
			pomodoro: {
				...snapshot.pomodoro,
				state: next
			}
		});
	},
	reconcile(now = Date.now()) {
		if (!this.current) return null;
		const result = advanceTimer(this.current.pomodoro.state, now, this.current.pomodoro.settings);
		if (result.state === this.current.pomodoro.state) return this.current;
		this.current = {
			...this.current,
			pomodoro: {
				...this.current.pomodoro,
				state: result.state
			}
		};
		return this.current;
	}
};

//#endregion
//#region src/client/productivity-settings.ts
function makeProductivitySection({ h, useState, useEffect, t }) {
	return function ProductivitySection() {
		const [snapshot, setSnapshot] = useState(productivityBridge.current);
		const [title, setTitle] = useState("");
		const [error, setError] = useState("");
		useEffect(() => {
			let alive = true;
			productivityBridge.load().then((value) => {
				if (alive) setSnapshot(value);
			}).catch((e) => setError(String(e)));
			const timer$1 = window.setInterval(() => {
				const current = productivityBridge.reconcile();
				if (current && alive) setSnapshot({ ...current });
			}, 1e3);
			return () => {
				alive = false;
				window.clearInterval(timer$1);
			};
		}, []);
		if (!snapshot) return h("div", {
			className: "dsh-settings-section",
			children: error || "加载中…"
		});
		const save = async (next) => {
			try {
				setSnapshot(await productivityBridge.save(next));
				setError("");
			} catch (e) {
				setError(String(e));
			}
		};
		const add = () => {
			const value = title.trim();
			if (!value) return;
			const now = Date.now();
			const item = {
				id: crypto.randomUUID(),
				title: value,
				notes: "",
				completed: false,
				estimatedPomodoros: 1,
				completedPomodoros: 0,
				order: snapshot.todos.length,
				createdAt: now,
				updatedAt: now
			};
			save({
				...snapshot,
				todos: [...snapshot.todos, item]
			});
			setTitle("");
		};
		const timer = snapshot.pomodoro.state;
		return h("div", {
			className: "dsh-settings-section",
			children: [
				h("h2", { children: t("productivity.nav") }),
				h("p", { children: `${timer.phase} · ${Math.ceil(timer.remainingSeconds / 60)} 分钟 · ${timer.running ? "运行中" : "已暂停"}` }),
				h("button", {
					onClick: () => productivityBridge.action(timer.running ? "pause" : "start").then(setSnapshot),
					children: timer.running ? "暂停" : "开始"
				}),
				h("button", {
					onClick: () => productivityBridge.action("reset").then(setSnapshot),
					children: "重置"
				}),
				h("h3", { children: "Todo" }),
				h("div", { children: [h("input", {
					value: title,
					onInput: (e) => setTitle(e.currentTarget.value),
					placeholder: "新增 Todo"
				}), h("button", {
					onClick: add,
					children: "添加"
				})] }),
				h("ul", { children: snapshot.todos.map((todo) => h("li", {
					key: todo.id,
					children: [h("input", {
						type: "checkbox",
						checked: todo.completed,
						onChange: (e) => save({
							...snapshot,
							todos: snapshot.todos.map((x) => x.id === todo.id ? {
								...x,
								completed: e.currentTarget.checked,
								updatedAt: Date.now()
							} : x)
						})
					}), `${todo.title} (${todo.completedPomodoros}/${todo.estimatedPomodoros})`]
				})) }),
				error ? h("p", { children: error }) : null
			]
		});
	};
}

//#endregion
//#region src/client/app.ts
function makeFactory() {
	return (require) => {
		const module = { exports: {} };
		const react = require("react");
		const { useEffect, useRef, useState } = react;
		const { jsx: h } = require("react/jsx-runtime");
		const PetMulti = makePetUI({
			h,
			useState,
			useEffect,
			useRef
		});
		const name = "pet";
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"remote.commands",
			"commandUi"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-pet-desktop: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.effect(() => {
				const ac = new AbortController();
				startNotify(ac.signal);
				return () => ac.abort();
			}, "dsh-pet-desktop: notifications");
			ctx.effect(() => {
				const commandUi = ctx.get?.("commandUi");
				if (!commandUi || typeof commandUi.decorate !== "function") {
					console.warn("[dsh-pet-desktop] 命令选择框不可用：commandUi 服务缺失（/pet 仍可手输 id 或名字）");
					return () => {};
				}
				return commandUi.decorate({
					name: "pet",
					available: () => true,
					ui: {
						kind: "popupSelect",
						options: async () => petBridge.current.map((p) => ({
							id: p.id,
							label: p.name || p.id,
							detail: (p.assetRoot && p.assetRoot !== p.id ? p.assetRoot + " / " : "") + p.id
						})),
						onSelect: async (option, session) => {
							await ctx.remote?.commands?.execute(session.sessionId, "/pet " + option.id, []);
						}
					}
				});
			}, "dsh-pet-desktop: /pet picker");
			ctx.slots.inject("shell.overlay", function* () {
				yield ctx.slots.register({
					name: "shell.overlay",
					id: "pet",
					order: 1e3
				}, () => h(PetMulti, {}));
			});
			const PetConfigSection = makePetConfigSection({
				h,
				useState,
				useEffect,
				t
			});
			const ProductivitySection = makeProductivitySection({
				h,
				useState,
				useEffect,
				t
			});
			ctx.slots.inject("settings.section", function* () {
				yield ctx.slots.register({
					name: "settings.section",
					id: "pet-config",
					order: 30,
					label: () => t("nav"),
					inject: () => ({ t })
				}, PetConfigSection);
			});
			ctx.slots.inject("settings.section", function* () {
				yield ctx.slots.register({
					name: "settings.section",
					id: "productivity",
					order: 35,
					label: () => t("productivity.nav"),
					inject: () => ({ t })
				}, ProductivitySection);
			});
		}
		module.exports = {
			apply,
			inject,
			name
		};
		return module.exports;
	};
}

//#endregion
//#region src/client/index.ts
window.__ModuleLoader__.load({
	id: "dsh-pet-desktop",
	factory: makeFactory()
});

//#endregion
})();