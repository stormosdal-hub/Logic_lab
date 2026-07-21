/* js/mobile.js — mobile off-canvas drawers for the toolbar + palette (both apps).
 *
 * Pure DOM, browser-only (never loaded by the Node test suites). Desktop is left
 * completely untouched: every drawer style lives behind a `max-width` media query
 * in style.css, and the pull-tab handles are `display:none` above that width, so
 * this script only has a visible effect on narrow screens.
 *
 * Each app (digital + analog) gets two drawers:
 *   - the top toolbar  → slides down  (a ☰ tab, top-left)
 *   - the left palette → slides in     (a ▸ tab, left edge)
 * Both handles support a tap (toggle) and a drag (pull the panel with your finger,
 * snaps open/closed on release). A backdrop dims the canvas while a drawer is open
 * and closes it on tap; picking a component from the palette auto-closes it. */
(function () {
  "use strict";

  function make(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  // Wire the two drawers inside one app container. Returns { closeAll }.
  function wireApp(app, cfg) {
    if (!app) return null;
    var toolbar = app.querySelector(cfg.toolbar);
    var palette = app.querySelector(cfg.palette);
    if (!toolbar || !palette) return null;

    var backdrop = make("div", "drawer-backdrop");
    var barHandle = make("button", "drawer-handle dh-bar", "☰"); // ☰
    var palHandle = make("button", "drawer-handle dh-pal", "▸"); // ▸
    barHandle.type = palHandle.type = "button";
    barHandle.setAttribute("aria-label", "Show toolbar");
    palHandle.setAttribute("aria-label", "Show components");
    app.appendChild(backdrop);
    app.appendChild(barHandle);
    app.appendChild(palHandle);

    var drawers = [
      { panel: toolbar, handle: barHandle, axis: "y" },
      { panel: palette, handle: palHandle, axis: "x" },
    ];

    function isOpen(d) { return d.panel.classList.contains("drawer-open"); }
    function anyOpen() { return drawers.some(isOpen); }
    function syncBackdrop() { backdrop.classList.toggle("on", anyOpen()); }

    function setOpen(d, open) {
      d.panel.style.transition = "";
      d.panel.style.transform = "";
      d.panel.classList.toggle("drawer-open", open);
      d.handle.classList.toggle("active", open);
      d.handle.textContent = d.axis === "y"
        ? (open ? "✕" : "☰")   // ✕ / ☰
        : (open ? "◂" : "▸");  // ◂ / ▸
      syncBackdrop();
    }
    function closeAll() { drawers.forEach(function (d) { setOpen(d, false); }); }
    function openOnly(d) {
      drawers.forEach(function (o) { if (o !== d) setOpen(o, false); });
      setOpen(d, true);
    }

    drawers.forEach(function (d) {
      var prop = d.axis === "x" ? "clientX" : "clientY";
      var dragging = false, start = 0, moved = 0, size = 0, wasOpen = false;

      d.handle.addEventListener("pointerdown", function (e) {
        dragging = true;
        moved = 0;
        wasOpen = isOpen(d);
        start = e[prop];
        size = d.axis === "x" ? d.panel.offsetWidth : d.panel.offsetHeight;
        d.panel.style.transition = "none";
        try { d.handle.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      });

      d.handle.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        var delta = e[prop] - start;
        moved = Math.max(moved, Math.abs(delta));
        var base = wasOpen ? 0 : -size;                       // px offset when closed
        var t = Math.min(0, Math.max(-size, base + delta));   // clamp to [-size, 0]
        d.panel.style.transform =
          (d.axis === "x" ? "translateX(" : "translateY(") + t + "px)";
      });

      function finish(e) {
        if (!dragging) return;
        dragging = false;
        try { d.handle.releasePointerCapture(e.pointerId); } catch (_) {}
        var want;
        if (moved < 8) {
          want = !wasOpen;                                    // a tap → toggle
        } else {
          var delta = e[prop] - start;                        // a drag → snap by distance
          want = wasOpen ? delta > -size / 2 : delta > size / 3;
        }
        if (want) openOnly(d); else setOpen(d, false);
      }
      d.handle.addEventListener("pointerup", finish);
      d.handle.addEventListener("pointercancel", finish);
    });

    backdrop.addEventListener("pointerdown", function (e) { e.preventDefault(); closeAll(); });

    // picking a component closes the palette so you can drop it on the sheet
    palette.addEventListener("click", function (e) {
      if (e.target.closest(cfg.item)) setOpen(drawers[1], false);
    });

    // switching sim/edit gets the toolbar out of the way of the canvas
    var modeBtn = cfg.modeBtn && app.querySelector(cfg.modeBtn);
    if (modeBtn) modeBtn.addEventListener("click", closeAll);

    return { closeAll: closeAll };
  }

  function init() {
    var apps = [
      wireApp(document.getElementById("digitalApp"), {
        toolbar: "#toolbar", palette: "#palette", item: ".tool", modeBtn: "#modeBtn",
      }),
      wireApp(document.getElementById("analogApp"), {
        toolbar: "#anToolbar", palette: "#anPalette", item: ".an-part", modeBtn: "#anModeBtn",
      }),
    ].filter(Boolean);

    function closeEverything() { apps.forEach(function (a) { a.closeAll(); }); }

    // closing all drawers when the tab changes keeps each app tidy
    var tabbar = document.getElementById("tabbar");
    if (tabbar) tabbar.addEventListener("click", closeEverything);

    // dragging a part out of the palette needs the sheet visible
    window.MobileDrawers = { closeAll: closeEverything };
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
