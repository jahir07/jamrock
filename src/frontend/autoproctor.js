(function () {
  //   if (!window.AutoProctor || !window.JRJ_AP) return;
  if (!JRJ_AP.enabled) return;

  const CLIENT_ID = JRJ_AP.clientId;
  const CLIENT_SECRET = JRJ_AP.secret || null;

  // --- helpers: generate ID & HMAC(Base64) ---
  const getTestAttemptId = () =>
    (JRJ_AP.testAttemptId &&
      String(JRJ_AP.testAttemptId).trim() +
        Math.random().toString(36).slice(2, 7)) ||
    Math.random().toString(36).slice(2, 10);

  function hmacBase64(msg, secret) {
    const secretWordArray = CryptoJS.enc.Utf8.parse(secret);
    const messageWordArray = CryptoJS.enc.Utf8.parse(msg);
    const hash = CryptoJS.HmacSHA256(messageWordArray, secretWordArray);
    return CryptoJS.enc.Base64.stringify(hash);
  }

  const testAttemptId = getTestAttemptId();
  const hashedTestAttemptId = CLIENT_SECRET
    ? hmacBase64(testAttemptId, CLIENT_SECRET)
    : null;

  const credentials = {
    clientId: CLIENT_ID,
    testAttemptId,
    hashedTestAttemptId,
  };

  const opts = JRJ_AP.opts || {};

  const getReportOptions = () => {
    return {
      groupReportsIntoTabs: true,
      userDetails: {
        name: JRJ_AP.userName || "",
        email: JRJ_AP.email || "",
      },
    };
  };

  console.log(opts);

  let apInstance = null;
  let started = false;
  let stopped = false;

  async function startProctoring() {
    if (started) return;
    started = true;

    console.log("[JRJ AP] Initializing AutoProctor…");
    try {
      apInstance = new AutoProctor(credentials);
      window.__ap = apInstance; // for debugging
      await apInstance.setup(opts);

      await apInstance.start(); // start monitoring
      console.log("[JRJ AP] Monitoring started.");
      window.addEventListener("apMonitoringStarted", () => {
        document.getElementById("ap-test-proctoring-status").innerHTML =
          "Proctoring...";
      });
    } catch (err) {
      console.error("[JRJ AP] Failed to initialize AutoProctor", err);
    }
  }

  async function stopProctoring() {
    if (stopped) return;
    stopped = true;
    try {
      await apInstance.stop();

      window.addEventListener("apMonitoringStopped", async () => {
        const reportOptions = getReportOptions();
        apInstance.showReport(reportOptions);

        document.getElementById("ap-test-proctoring-status").innerHTML =
          "Proctoring stopped";
      });
    } catch (e) {
      console.warn("[JRJ AP] stop error", e);
    } finally {
      safeFetchLog({ event: "stopped" });
    }
  }

    // -- safe fetch log ---
  function safeFetchLog(payload = {}, event = "started") {
    const body = {
      quiz_id: JRJ_AP.quizId || 0,
      attempt_id: testAttemptId, // MUST be defined
      event,
      payload,
      user: {
        name: JRJ_AP.userName,
        email: JRJ_AP.email,
      },
    };

    fetch(JRJ_AP.root + "autoproctor/attempts", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-WP-Nonce": JRJ_AP.nonce,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      keepalive: true,
    }).then((r) =>
      r.text().then((t) => console.log("ap attempt ->", r.status, t))
    );
  }

  // --- Start triggers (LD start/continue buttons) ---
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest(
        '.wpProQuiz_button[name="startQuiz"], .wpProQuiz_button[name="restartQuiz"], .ld-quiz-start, .quiz_continue_link'
      );
      if (!btn) return;
      startProctoring();
    },
    { capture: true }
  );

  // --- Stop trigger #1: click on Finish/Submit buttons ---
  document.addEventListener(
    "click",
    (e) => {
      const finishBtn = e.target.closest(
        '#quiz_continue_link, .wpProQuiz_button[value="Finish Quiz"], .wpProQuiz_button[name="endQuizSummary"], .ld-quiz-submit, .ld-quiz-finish'
      );
      if (!finishBtn) return;
      console.log("stop test");

      stopProctoring();
      // small delay to let LD process submit
      // setTimeout(() => stopProctoring(), 1500);
    },
    { capture: true }
  );

  // Auto start if configured
  window.addEventListener("load", () => {
    if (JRJ_AP.autoStart) startProctoring();
  });

  // Violation relay (optional)
  window.addEventListener("apViolation", (e) => {
    safeFetchLog({ event: "violation", detail: e.detail || {} });
  });
})();
