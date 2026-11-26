const RECORDINGS = {
  "asset-search": {
    title: "data.overme.cn / 统一资产搜索",
    step: "产品实录 01 / 03",
    src: "./assets/media/01-asset-search.mp4",
    poster: "./assets/media/01-asset-search.jpg",
    ariaLabel: "资产搜索录屏：在搜索框输入检索词，结果列表收敛，命中资产并展开字段含义与口径来源"
  },
  "ai-rag": {
    title: "data.overme.cn / 单轮 AI 问资产",
    step: "产品实录 02 / 03",
    src: "./assets/media/02-ai-rag.mp4",
    poster: "./assets/media/02-ai-rag.jpg",
    ariaLabel: "问资产录屏：输入业务问题，执行步骤逐行出现，随后展示命中的资产与证据来源"
  },
  readiness: {
    title: "data.overme.cn / 指标口径与就绪度联动",
    step: "界面预览 03 / 03",
    interactivePreview: true
  }
};

const recordingObserver = "IntersectionObserver" in window
  ? new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.play().catch(function () {});
        } else {
          entry.target.pause();
        }
      });
    }, { threshold: 0.05 })
  : null;

function buildReadinessPreview() {
  const preview = document.createElement("div");
  preview.className = "readiness-ui-preview";
  preview.setAttribute("role", "img");
  preview.setAttribute(
    "aria-label",
    "指标口径维护界面预览：补齐 order_user_cnt_30d 的口径文本并绑定出数表 dws.trade_user_stat_d 后，指标模块就绪度实时更新为 71%"
  );

  preview.innerHTML = [
    '<div class="rui-shell">',
    '  <div class="rui-topbar">',
    '    <div class="rui-breadcrumb">',
    '      <span class="rui-crumb-muted">数据标准与指标</span>',
    '      <span class="rui-crumb-sep">/</span>',
    '      <span class="rui-crumb-current">交易域指标口径</span>',
    "    </div>",
    '    <div class="rui-badge-live">',
    '      <span class="rui-dot"></span>',
    '      <span>模块就绪度 65% → <strong>71%</strong></span>',
    "    </div>",
    "  </div>",
    '  <div class="rui-card">',
    '    <div class="rui-card-head">',
    '      <div>',
    '        <span class="rui-code">order_user_cnt_30d</span>',
    '        <h4 class="rui-title">近 30 天下单用户数</h4>',
    "      </div>",
    '      <span class="rui-status-ok">口径已完备</span>',
    "    </div>",
    '    <div class="rui-fields">',
    '      <div class="rui-field">',
    '        <span class="rui-label">业务口径定义</span>',
    '        <p class="rui-val">统计近 30 个自然日内完成支付且未全额退单的去重买家数（按 <code>buyer_id</code> 去重）。</p>',
    "      </div>",
    '      <div class="rui-field-grid">',
    '        <div class="rui-field">',
    '          <span class="rui-label">权威出数表</span>',
    '          <p class="rui-val"><code>dws.trade_user_stat_d</code></p>',
    "        </div>",
    '        <div class="rui-field">',
    '          <span class="rui-label">绑定结果字段</span>',
    '          <p class="rui-val"><code>order_user_cnt</code> <span class="rui-type">bigint</span></p>',
    "        </div>",
    "      </div>",
    "    </div>",
    '    <div class="rui-foot">',
    '      <span>完备性校验：口径文本 + 出数表 + 结果字段均已关联</span>',
    '      <span class="rui-delta">+1 项计入就绪度</span>',
    "    </div>",
    "  </div>",
    "</div>"
  ].join("");

  return preview;
}

class DapRecording extends HTMLElement {
  connectedCallback() {
    if (this.dataset.rendered === "true") return;

    const item = RECORDINGS[this.getAttribute("name")];
    const template = document.getElementById("recording-window-template");
    if (!item || !template) return;

    const fragment = template.content.cloneNode(true);
    fragment.querySelector(".window-title").textContent = item.title;
    fragment.querySelector(".window-step").textContent = item.step;
    const screen = fragment.querySelector(".window-screen");

    if (item.src) {
      const video = document.createElement("video");
      video.setAttribute("src", item.src);
      video.setAttribute("poster", item.poster);
      video.setAttribute("muted", "");
      video.setAttribute("autoplay", "");
      video.setAttribute("loop", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("preload", "metadata");
      video.setAttribute("aria-label", item.ariaLabel);
      video.muted = true;
      video.playsInline = true;
      screen.append(video);
    } else if (item.interactivePreview) {
      screen.append(buildReadinessPreview());
    }

    this.replaceChildren(fragment);
    const video = this.querySelector("video");
    if (video && recordingObserver) recordingObserver.observe(video);
    this.dataset.rendered = "true";
  }
}

customElements.define("dap-recording", DapRecording);

(function setUpScrollReveal() {
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion || typeof IntersectionObserver !== "function") return;

  const targets = document.querySelectorAll(
    ".current-section, .ask-intro, .sample-panel, .code-panel, .readiness-intro, .boundary-item, .deployment-intro, .compatibility, .flow-node, .responsibility-card, .entry-link"
  );
  if (!targets.length) return;

  const fold = window.innerHeight * 0.96;
  const belowFold = [];

  targets.forEach(function (el, idx) {
    if (el.getBoundingClientRect().top >= fold) {
      el.classList.add("reveal-pending");
      el.style.setProperty("--reveal-delay", ((idx % 4) * 70) + "ms");
      belowFold.push(el);
    }
  });

  if (!belowFold.length) return;

  const observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting && entry.boundingClientRect.top > 0) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -28px 0px" }
  );

  belowFold.forEach(function (el) {
    observer.observe(el);
  });
})();
