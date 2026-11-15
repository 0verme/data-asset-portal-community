const RECORDINGS = {
  "asset-search": {
    title: "data.overme.cn / 资产搜索",
    step: "产品录屏 01 / 03",
    src: "./public/media/01-asset-search.mp4",
    poster: "./public/media/01-asset-search.jpg",
    ariaLabel: "资产搜索录屏：在搜索框输入检索词，结果列表收敛，命中资产并展开字段含义与口径来源"
  },
  "ai-rag": {
    title: "data.overme.cn / AI 问答",
    step: "产品录屏 02 / 03",
    src: "./public/media/02-ai-rag.mp4",
    poster: "./public/media/02-ai-rag.jpg",
    ariaLabel: "问资产录屏：输入业务问题，执行步骤逐行出现，随后展示命中的资产与证据来源"
  },
  readiness: {
    title: "data.overme.cn / 指标口径",
    step: "产品录屏占位 03 / 03",
    storyboard: true
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
    }, { threshold: 0.01 })
  : null;

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
      video.setAttribute("preload", "auto");
      video.setAttribute("aria-label", item.ariaLabel);
      video.muted = true;
      video.playsInline = true;
      screen.append(video);
    } else if (item.storyboard) {
      const placeholder = document.createElement("div");
      placeholder.className = "placeholder-screen";
      const storyboard = document.createElement("div");
      storyboard.className = "storyboard";

      const title = document.createElement("p");
      title.className = "storyboard-title";
      title.textContent = "在这里放：补一条口径，看就绪度";

      const caption = document.createElement("p");
      caption.className = "storyboard-caption";
      caption.append("5 到 10 秒循环短视频 · 静音自动播放 · ");
      const pending = document.createElement("span");
      pending.className = "placeholder";
      pending.textContent = "[待录制，交互待确认]";
      caption.append(pending);

      const list = document.createElement("ul");
      list.className = "storyboard-list";
      [
        ["0–3 秒", "打开一个模块，看到就绪度和缺失项。"],
        ["3–7 秒", "点进一个缺口径的指标，补上口径文本。"],
        ["7–10 秒", "回到模块页，就绪度随之变化。"]
      ].forEach(function (row) {
        const li = document.createElement("li");
        const time = document.createElement("time");
        time.textContent = row[0];
        const description = document.createElement("span");
        description.textContent = row[1];
        li.append(time, description);
        list.append(li);
      });

      storyboard.append(title, caption, list);
      placeholder.append(storyboard);
      screen.append(placeholder);
    }

    this.replaceChildren(fragment);
    const video = this.querySelector("video");
    if (video && recordingObserver) recordingObserver.observe(video);
    this.dataset.rendered = "true";
  }
}

customElements.define("dap-recording", DapRecording);
