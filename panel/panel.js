import { getLilySourceStamp } from "../shared/buildInfo.js";
import "../popup/popup.js";
import "../gsc/gsc-panel.js";

renderBuildStamps();

function renderBuildStamps() {
  const stamp = getLilySourceStamp();
  ["sourceStamp", "overviewSourceStamp"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = stamp;
  });
}
