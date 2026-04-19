import { DEFAULT_SETTINGS } from "../shared/constants.js";

const elMy = document.getElementById("myProduct");
const elComp = document.getElementById("competitors");
const elScope = document.getElementById("defaultScope");
const elNoise = document.getElementById("hideNoise");
const elStatus = document.getElementById("status");
const elAiEnabled = document.getElementById("aiEnabled");
const elAiServerUrl = document.getElementById("aiServerUrl");
const elAiModel = document.getElementById("aiModel");

init();

async function init() {
  const res = await chrome.runtime.sendMessage({ type: "LR_GET_SETTINGS" });
  const s = res?.ok ? res.settings : { ...DEFAULT_SETTINGS };
  fill(s);

  document.getElementById("btnSave").addEventListener("click", async () => {
    const next = {
      ...s,
      myProductKeywords: splitCsv(elMy.value),
      competitorKeywords: splitCsv(elComp.value),
      aiEnabled: elAiEnabled.value === "1",
      aiServerUrl: (elAiServerUrl.value || "").trim(),
      aiModel: elAiModel.value,
      defaultScope: elScope.value,
      hideNoiseByDefault: elNoise.value === "1"
    };
    const r = await chrome.runtime.sendMessage({ type: "LR_SET_SETTINGS", settings: next });
    if (r?.ok) {
      show("已保存", true);
    } else {
      show(r?.error || "保存失败", false);
    }
  });

  document.getElementById("btnReset").addEventListener("click", () => {
    fill({ ...DEFAULT_SETTINGS });
    show("已恢复默认（请点击保存生效）", true);
  });
}

function fill(s) {
  elMy.value = (s.myProductKeywords || []).join(", ");
  elComp.value = (s.competitorKeywords || []).join(", ");
  elAiEnabled.value = s.aiEnabled ? "1" : "0";
  elAiServerUrl.value = s.aiServerUrl || "http://localhost:3100";
  elAiModel.value = s.aiModel || "gpt-4.1";
  elScope.value = s.defaultScope || "content";
  elNoise.value = s.hideNoiseByDefault ? "1" : "0";
}

function splitCsv(v) {
  return (v || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function show(text, ok) {
  elStatus.textContent = text;
  elStatus.className = ok ? "muted ok" : "muted err";
  setTimeout(() => (elStatus.textContent = ""), 2000);
}
