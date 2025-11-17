
(function () {
  if (typeof window === "undefined") return;

  // --- config / defaults ---
  var cfg = window.JRJ_INSIGHTS || {};
  cfg.root = cfg.root || window.location.origin + "/wp-json/jamrock/v1/";
  cfg.endpoint = cfg.root.replace(/\/$/, "") + "/insights/events";
  cfg.heartbeatInterval = cfg.heartbeatInterval || 60; // seconds
  cfg.debug = !!cfg.debug;

  // helper: safe log
  function dlog() {
    if (!cfg.debug) return;
    try {
      console.log.apply(console, arguments);
    } catch (e) {}
  }

  // --- transporter (sendBeacon with fetch fallback) ---
  function sendPayload(payload) {
    try {
      payload.client_ts = new Date().toISOString();
      var body = JSON.stringify(payload);
      dlog("[JRJ_INSIGHTS SEND]", payload);

      // Try navigator.sendBeacon first (good for unload)
      if (navigator.sendBeacon) {
        try {
          var blob = new Blob([body], { type: "application/json" });
          var ok = navigator.sendBeacon(cfg.endpoint, blob);
          if (ok) return Promise.resolve({ ok: true, method: "beacon" });
        } catch (e) {
          dlog("beacon failed", e);
        }
      }

      // fallback: fetch with keepalive
      var headers = { "Content-Type": "application/json" };
      if (window.JRJ_INSIGHTS && window.JRJ_INSIGHTS.nonce) {
        headers["X-WP-Nonce"] = window.JRJ_INSIGHTS.nonce;
      } else if (window.JRJ_ADMIN && window.JRJ_ADMIN.nonce) {
        headers["X-WP-Nonce"] = window.JRJ_ADMIN.nonce;
      }

      return fetch(cfg.endpoint, {
        method: "POST",
        headers: headers,
        body: body,
        keepalive: true,
        credentials: "same-origin",
      })
        .then(function (r) {
          return r.text().then(function (t) {
            dlog("[JRJ_INSIGHTS RESP]", r.status, t);
            return { ok: r.ok, status: r.status, body: t, method: "fetch" };
          });
        })
        .catch(function (err) {
          dlog("fetch send error", err);
          return { ok: false, error: err };
        });
    } catch (e) {
      dlog("sendPayload top error", e);
      return Promise.resolve({ ok: false, error: e });
    }
  }

  // --- public send function (structured payload) ---
  function sendInsight(opts) {
    // required: event
    if (!opts || !opts.event) {
      dlog("insight missing event", opts);
      return Promise.resolve({ ok: false, error: "missing_event" });
    }

    var payload = {
      event_key: opts.event,
      actor_type:
        opts.actor_type ||
        (window.JRJ_USER && window.JRJ_USER.role) ||
        "candidate",
      user_id:
        opts.user_id !== undefined
          ? opts.user_id
          : (window.JRJ_USER && window.JRJ_USER.id) || null,
      context_key: opts.context_key || null,
      context_id: opts.context_id || null,
      meta: opts.meta || {},
    };

    return sendPayload(payload);
  }

  // attach globally
  window.JRJ_INSIGHTS = window.JRJ_INSIGHTS || {};
  window.JRJ_INSIGHTS.send = sendInsight;
  // allow debug control:
  window.JRJ_INSIGHTS._cfg = cfg;

  // --- Heartbeat (activity ping) ---
  var heartbeatTimer = null;
  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(function () {
      sendInsight({
        event: "activity_ping",
        meta: { seconds: cfg.heartbeatInterval },
      });
    }, cfg.heartbeatInterval * 1000);
    // immediate ping
    sendInsight({
      event: "activity_ping",
      meta: { seconds: cfg.heartbeatInterval },
    });
  }
  function stopHeartbeat() {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  // visibility
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") startHeartbeat();
    else stopHeartbeat();
  });
  if (document.visibilityState === "visible") startHeartbeat();

  // --- Search form binding (classic forms) ---
  function attachSearchFormLogging() {
    try {
      var form =
        document.querySelector("form.search-form") ||
        document.querySelector('form[role="search"]') ||
        document.querySelector('form[action*="/?s="]');
      if (!form) return;

      form.addEventListener(
        "submit",
        function (ev) {
          try {
            var qel =
              form.querySelector('[name="s"]') ||
              form.querySelector('input[type="search"]');
            var query = qel ? (qel.value || "").trim() : "";
            if (!query) return;

            sendInsight({
              event: "search",
              context_key: "site_search",
              meta: { query: query },
            });
          } catch (e) {
            dlog("search submit error", e);
          }
        },
        { passive: true }
      );
    } catch (e) {
      dlog("attachSearchFormLogging error", e);
    }
  }
  attachSearchFormLogging();

  // --- generic data-insight clickable elements ---
  // <a data-insight='{"event":"open_doc","context_key":"doc","context_id":"123"}'>...</a>
  function attachDataInsightClicks() {
    document.addEventListener("click", function (ev) {
      var el = ev.target;
      // climb up to support clicks on child elements
      while (el && el !== document) {
        var data = el.getAttribute && el.getAttribute("data-insight");
        if (data) {
          try {
            var parsed = JSON.parse(data);
            if (parsed && parsed.event) {
              sendInsight({
                event: parsed.event,
                context_key: parsed.context_key || null,
                context_id: parsed.context_id || null,
                meta: parsed.meta || {},
              });
            }
          } catch (e) {
            // not JSON? fallback to simple string event name
            var str = data.trim();
            if (str) {
              sendInsight({ event: str });
            }
          }
          break;
        }
        el = el.parentNode;
      }
    });
  }
  attachDataInsightClicks();

  // --- Learndash / course/lesson detection heuristics ---
  // Many projects expose data attributes in the page; attempt to auto-detect course/lesson pages
  function attachPageViewDetection() {
    try {
      // If page has a data-course-id on body or element
      var body = document.body || document.documentElement;
      var courseId =
        body.getAttribute &&
        (body.getAttribute("data-course-id") ||
          body.getAttribute("data-ld-course-id"));
      var lessonId =
        body.getAttribute &&
        (body.getAttribute("data-lesson-id") ||
          body.getAttribute("data-ld-lesson-id"));

      // fallback: query selectors (commonly added by single course templates)
      if (!courseId) {
        var el = document.querySelector("[data-course-id],[data-ld-course-id]");
        if (el)
          courseId =
            el.getAttribute("data-course-id") ||
            el.getAttribute("data-ld-course-id");
      }
      if (!lessonId) {
        var el2 = document.querySelector(
          "[data-lesson-id],[data-ld-lesson-id]"
        );
        if (el2)
          lessonId =
            el2.getAttribute("data-lesson-id") ||
            el2.getAttribute("data-ld-lesson-id");
      }

      // If we detected course or lesson, send page view event now
      if (courseId) {
        sendInsight({
          event: "course_view",
          context_key: "course",
          context_id: courseId,
        });
      }
      if (lessonId) {
        sendInsight({
          event: "lesson_view",
          context_key: "lesson",
          context_id: lessonId,
        });
      }

      // fallback: detect from URL patterns (very generic)
      var p = location.pathname || "";
      var courseMatch = p.match(/courses\/(\d+)|course\/(\d+)/i) || null;
      if (!courseId && courseMatch) {
        var cid = courseMatch[1] || courseMatch[2];
        if (cid) {
          sendInsight({
            event: "course_view",
            context_key: "course",
            context_id: cid,
          });
        }
      }
    } catch (e) {
      dlog("pageView detect error", e);
    }
  }
  // run on DOM ready
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    attachPageViewDetection();
  } else {
    document.addEventListener("DOMContentLoaded", attachPageViewDetection);
  }

  // --- Quiz submit detection (common) ---
  function attachQuizSubmit() {
    try {
      // Learndash quiz forms often have '#ld-question-form' or '.learndash_quiz_form' — attempt multiple selectors
      var selectors = [
        "form#ld-question-form",
        "form.learndash_quiz_form",
        "form[name='quiz-form']",
        "form[id*='quiz']",
      ];
      selectors.forEach(function (sel) {
        var forms = document.querySelectorAll(sel);
        if (!forms) return;
        forms.forEach(function (f) {
          // avoid double-binding
          if (f.__jrj_quiz_bound) return;
          f.__jrj_quiz_bound = true;
          f.addEventListener(
            "submit",
            function (ev) {
              try {
                // attempt to grab quiz id from form dataset or input
                var qid =
                  f.getAttribute("data-quiz-id") ||
                  (f.querySelector("input[name='quiz_id']") &&
                    f.querySelector("input[name='quiz_id']").value) ||
                  null;
                sendInsight({
                  event: "quiz_submit",
                  context_key: "quiz",
                  context_id: qid,
                });
              } catch (e) {
                dlog("quiz submit catch", e);
              }
            },
            { passive: true }
          );
        });
      });
    } catch (e) {
      dlog("attachQuizSubmit error", e);
    }
  }
  attachQuizSubmit();

  // --- HTML5 video watch time tracking (simple) ---
  function attachVideoTracking() {
    try {
      var videos = document.querySelectorAll("video");
      if (!videos || videos.length === 0) return;

      videos.forEach(function (v, idx) {
        if (v.__jrj_video_bound) return;
        v.__jrj_video_bound = true;

        var watched = 0;
        var lastTime = 0;
        var ticking = false;

        function onTimeUpdate() {
          var now = Math.floor(v.currentTime || 0);
          if (now > lastTime) {
            watched += now - lastTime;
            lastTime = now;
          }
        }
        function onPlay() {
          lastTime = Math.floor(v.currentTime || 0);
          sendInsight({
            event: "video_play",
            meta: { currentTime: v.currentTime || 0 },
          });
        }
        function onPause() {
          onTimeUpdate();
          sendInsight({
            event: "video_pause",
            meta: { watched_seconds: watched, currentTime: v.currentTime || 0 },
          });
        }
        function onEnded() {
          onTimeUpdate();
          sendInsight({
            event: "video_complete",
            meta: { watched_seconds: watched },
          });
        }

        v.addEventListener("timeupdate", onTimeUpdate);
        v.addEventListener("play", onPlay);
        v.addEventListener("pause", onPause);
        v.addEventListener("ended", onEnded);

        // send partial on page unload
        window.addEventListener("beforeunload", function () {
          if (watched > 0) {
            navigator.sendBeacon &&
              navigator.sendBeacon(
                cfg.endpoint,
                new Blob(
                  [
                    JSON.stringify({
                      event_key: "video_unload",
                      user_id: (window.JRJ_USER && window.JRJ_USER.id) || null,
                      meta: {
                        watched_seconds: watched,
                        src: v.currentSrc || v.src || null,
                      },
                    }),
                  ],
                  { type: "application/json" }
                )
              );
          }
        });
      });
    } catch (e) {
      dlog("attachVideoTracking error", e);
    }
  }
  attachVideoTracking();

  // observe for dynamically injected videos/forms etc.
  var observer = new MutationObserver(function (mutations) {
    // cheap throttle: if too many mutations, re-run attaching functions
    attachSearchFormLogging();
    attachDataInsightClicks();
    attachQuizSubmit();
    attachVideoTracking();
  });
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
  });

  // expose some helpers on global
  window.JRJ_INSIGHTS.startHeartbeat = startHeartbeat;
  window.JRJ_INSIGHTS.stopHeartbeat = stopHeartbeat;
  window.JRJ_INSIGHTS.sendPayload = sendPayload;

  dlog("JRJ_INSIGHTS initialized", cfg);
})();
