window.LMS = window.LMS || {};

(function(){
  const RES = window.LMS.RES, BADGE = window.LMS.BADGE;
  const go = window.LMS.go;

  /* ---------- drawer ---------- */
  const drawer=document.getElementById("drawer"), scrim=document.getElementById("scrim");
  let current=null;
  function openRes(id){
    const r = RES[id]; if(!r) return;
    current = r;
    document.getElementById("dType").textContent = r.type;
    document.getElementById("dTitle").textContent = r.title;
    document.getElementById("dBadges").innerHTML = r.badges.map(([t,c])=>
      '<span class="'+(BADGE[c]||"badge outline")+'"><span class="dot"></span>'+t+'</span>').join("");
    let html = '<dl class="kv">'+r.kv.map(([k,v])=>'<dt>'+k+'</dt><dd>'+v+'</dd>').join("")+'</dl>';
    if(r.links && r.links.length){
      html += '<div class="drawer-sec">Related</div><div class="chip-row">'+
        r.links.map(l=>'<span class="ref link">'+(RES[l]?RES[l].title:l)+'</span>').join("")+'</div>';
    }
    document.getElementById("dBody").innerHTML = html;
    drawer.classList.add("on"); scrim.classList.add("on");
  }
  function closeDrawer(){ drawer.classList.remove("on"); scrim.classList.remove("on"); }
  document.getElementById("dClose").addEventListener("click",closeDrawer);
  scrim.addEventListener("click",closeDrawer);
  document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeDrawer(); });
  document.getElementById("dOpen").addEventListener("click",()=>{ if(current) go(current.view); });
  document.getElementById("dCopy").addEventListener("click",()=>{
    if(current) navigator.clipboard && navigator.clipboard.writeText(current.title);
    document.getElementById("dCopy").textContent="Copied ✓";
    setTimeout(()=>document.getElementById("dCopy").textContent="Copy ref",1200);
  });

  /* expose to the other files */
  window.LMS.openRes = openRes;
  window.LMS.closeDrawer = closeDrawer;
})();
