window.LMS = window.LMS || {};

/* Section switching for the loan detail rail.
   The hash carries the section so a link can point at one, and reload keeps it. */
(function () {
  const nav = document.querySelector("[data-secnav]");
  if (!nav) return;

  const tabs = Array.from(nav.querySelectorAll(".sec"));
  const panes = Array.from(document.querySelectorAll(".secpane"));

  function show(id, push) {
    if (!document.getElementById("sec-" + id)) return;
    tabs.forEach(t => t.setAttribute("aria-selected", String(t.dataset.sec === id)));
    panes.forEach(p => p.classList.toggle("active", p.id === "sec-" + id));
    if (push) history.replaceState(null, "", "#" + id);
  }

  tabs.forEach(t => t.addEventListener("click", () => show(t.dataset.sec, true)));

  /* left/right arrows move between sections, as a tablist should */
  nav.addEventListener("keydown", e => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1
               : e.key === "ArrowUp"   || e.key === "ArrowLeft"  ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    next.focus();
    show(next.dataset.sec, true);
  });

  show(location.hash.slice(1) || tabs[0].dataset.sec, false);

  /* relationship rows in the identity rail open the resource drawer */
  document.addEventListener("click", e => {
    const rel = e.target.closest(".rel[data-res]");
    if (rel && window.LMS.openRes) window.LMS.openRes(rel.dataset.res);
  });

  window.LMS.showSection = show;
})();
