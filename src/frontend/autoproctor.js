if (!document.getElementById("ap-preflight-modal")) {
  const style = document.createElement("style");
  style.innerHTML = `
  #ap-preflight-modal { position: fixed; inset: 0; display:flex;align-items:center;justify-content:center;
    background: rgba(0,0,0,0.5); z-index: 99999; }
  #ap-preflight-card { background: #fff; padding: 18px; border-radius: 8px; width: 420px; max-width: 92%; box-shadow:0 6px 24px rgba(0,0,0,.25); font-family: Arial, sans-serif;}
  #ap-preflight-card h3 { margin:0 0 8px 0; font-size:18px; }
  #ap-preflight-card p { margin:6px 0 12px 0; font-size:13px; color:#333; }
  #ap-preflight-status { font-size:13px; margin-bottom:12px; min-height:20px; }
  #ap-preflight-actions { display:flex; gap:8px; justify-content:flex-end; }
  .ap-btn { padding:8px 12px; border-radius:6px; cursor:pointer; border:1px solid #ccc; background:#f7f7f7; }
  .ap-btn.primary { background:#0366d6; color:#fff; border-color:transparent; }
  `;
  document.head.appendChild(style);

  const modal = document.createElement("div");
  modal.id = "ap-preflight-modal";
  modal.style.display = "none";
  modal.innerHTML = `
    <div id="ap-preflight-card" role="dialog" aria-modal="true" aria-labelledby="ap-preflight-title">
      <h3 id="ap-preflight-title">Pre-check: Microphone & Screen</h3>
      <p>Please allow microphone & screen sharing so proctoring can start. We'll record the screen and audio for the test session.</p>
      <div id="ap-preflight-status"></div>
      <div id="ap-preflight-actions">
        <button class="ap-btn" id="ap-preflight-cancel">Cancel</button>
        <button class="ap-btn primary" id="ap-preflight-allow">Allow & Start</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function showPreflight(statusText = "") {
  const modal = document.getElementById("ap-preflight-modal");
  document.getElementById("ap-preflight-status").textContent = statusText;
  modal.style.display = "flex";
}
function hidePreflight() {
  const modal = document.getElementById("ap-preflight-modal");
  modal.style.display = "none";
  document.getElementById("ap-preflight-status").textContent = "";
}

// helper: try to get mic & screen streams (permissions prompt)
// we immediately stop tracks after obtaining permission — actual proctoring library should take its own streams
async function requestMicAndScreen() {
  // request microphone
  const micStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((e) => { throw { type: "mic", error: e }; });
  // request screen (may prompt)
  const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true }).catch((e) => { 
    // if screen denied, release mic and bubble error
    micStream.getTracks().forEach(t => t.stop());
    throw { type: "screen", error: e }; 
  });

  // stop tracks immediately (we just needed permission); AutoProctor should do actual recording
  micStream.getTracks().forEach(t => t.stop());
  screenStream.getTracks().forEach(t => t.stop());
  return true;
}

// Utility: simulate the original click/submit after proctoring started
function proceedWithOriginalAction(origEventTarget, origEvent) {
  try {
    // If the button was a regular button/link that triggers UI, re-trigger it.
    // Cloning click behavior is safer than dispatching original event (preventDefault currently blocked it),
    // so we try to call click() on the element.
    if (origEventTarget && typeof origEventTarget.click === "function") {
      // small microtask delay to ensure UI is ready
      setTimeout(() => origEventTarget.click(), 20);
    } else {
      // fallback: submit closest form
      const form = document.querySelector("form");
      if (form) form.submit();
    }
  } catch (e) {
    console.warn("[JRJ AP] proceedWithOriginalAction failed", e);
  }
}

// Prevent double-handling
const apPreflightState = {
  pending: false
};

// Replace/augment the existing start button listener with a guarded version:
document.addEventListener(
  "click",
  async (e) => {
    const btn = e.target.closest(
      '.wpProQuiz_button[name="startQuiz"], .wpProQuiz_button[name="restartQuiz"], .ld-quiz-start, .quiz_continue_link'
    );
    if (!btn) return;

    // if ap already started — let normal behavior pass
    if (started || apPreflightState.pending) {
      // if apPreflightState.pending is true, we absorb the extra clicks
      if (apPreflightState.pending) e.preventDefault();
      return;
    }

    // Prevent the default quiz-start action until proctoring is ready.
    e.preventDefault();
    apPreflightState.pending = true;

    showPreflight("Waiting for your permission...");

    // wire modal buttons
    const allowBtn = document.getElementById("ap-preflight-allow");
    const cancelBtn = document.getElementById("ap-preflight-cancel");

    // set temporary handlers (will be removed below)
    const cleanupModalHandlers = () => {
      allowBtn.onclick = null;
      cancelBtn.onclick = null;
    };

    const onCancel = () => {
      cleanupModalHandlers();
      hidePreflight();
      apPreflightState.pending = false;
      // let user try again if desired; do nothing further
    };

    cancelBtn.onclick = onCancel;

    allowBtn.onclick = async () => {
      allowBtn.disabled = true;
      cancelBtn.disabled = true;
      document.getElementById("ap-preflight-status").textContent = "Requesting mic permission...";
      try {
        // request mic + screen permissions
        await requestMicAndScreen();
        document.getElementById("ap-preflight-status").textContent = "Permissions granted. Initializing proctoring...";

        // start proctoring (this will set started = true inside startProctoring)
        // attach a one-time listener for apMonitoringStarted to proceed with quiz
        const onMonitoringStarted = () => {
          // show success and then close modal
          document.getElementById("ap-preflight-status").textContent = "Proctoring started — launching quiz...";
          // small delay so user reads status
          setTimeout(() => {
            hidePreflight();
            cleanupModalHandlers();
            apPreflightState.pending = false;
            // proceed with original action
            proceedWithOriginalAction(btn, e);
          }, 500);
          window.removeEventListener("apMonitoringStarted", onMonitoringStarted);
        };

        window.addEventListener("apMonitoringStarted", onMonitoringStarted);

        // call your existing startProctoring function
        try {
          await startProctoring();
          // Note: startProctoring may resolve before the AP internals dispatch apMonitoringStarted.
          // We rely on apMonitoringStarted event to call proceedWithOriginalAction.
        } catch (spErr) {
          console.error("[JRJ AP] startProctoring error:", spErr);
          document.getElementById("ap-preflight-status").textContent = "Failed to start proctoring. Please refresh or contact support.";
          // cleanup listeners
          window.removeEventListener("apMonitoringStarted", onMonitoringStarted);
          cleanupModalHandlers();
          apPreflightState.pending = false;
          setTimeout(hidePreflight, 2500);
        }
      } catch (permErr) {
        console.warn("[JRJ AP] permission error", permErr);
        let msg = "Permission denied. Microphone and screen sharing are required.";
        if (permErr && permErr.type === "screen") msg = "Screen sharing was denied. Please allow screen sharing.";
        if (permErr && permErr.type === "mic") msg = "Microphone permission was denied. Please allow microphone.";
        document.getElementById("ap-preflight-status").textContent = msg;
        allowBtn.disabled = false;
        cancelBtn.disabled = false;
        apPreflightState.pending = false;
        // keep modal open so user can try again
      }
    }; // allowBtn.onclick
  },
  { capture: true }
);