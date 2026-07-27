window.LMS = window.LMS || {};

(function(){
  const RES = window.LMS.RES, ALIAS = window.LMS.ALIAS;
  const openRes = window.LMS.openRes, go = window.LMS.go;

  /* resolve any .ref click to a registry entry by best text match */
  function findRes(text){
    text = text.trim();
    if(RES[text]) return text;
    if(ALIAS[text]) return ALIAS[text];
    let best=null, bestIdx=Infinity;
    const keys = Object.keys(RES).concat(Object.keys(ALIAS));
    for(const k of keys){
      const i = text.indexOf(k);
      if(i>-1 && i<bestIdx){ bestIdx=i; best = ALIAS[k]||k; }
    }
    return best;
  }
  document.addEventListener("click",e=>{
    const ref = e.target.closest(".ref");
    if(ref){
      const id = findRes(ref.textContent);
      if(id){ openRes(id); return; }
    }
    const t = e.target.closest("[data-nav]");
    if(t && !t.classList.contains("nav-item")) go(t.dataset.nav);
  });

  /* expose to the other files */
  window.LMS.findRes = findRes;
})();
