(function lastRideNightCity(){
  "use strict";
  const scene=document.querySelector("[data-night-scene]");
  if(!scene)return;
  const viewport=scene.querySelector("[data-city-viewport]");
  if(!viewport)return;
  const ja=document.documentElement.lang==="ja";
  const reduce=window.matchMedia("(prefers-reduced-motion: reduce)");
  let seed=20261112;
  const rnd=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
  const pick=(arr)=>arr[Math.floor(rnd()*arr.length)];
  const rect=(x,y,w,h,fill,attrs="")=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${attrs}/>`;
  const polygon=(points,fill,attrs="")=>`<polygon points="${points}" fill="${fill}" ${attrs}/>`;
  const lights=(x,y,cols,rows,gapX,gapY,colors,size=10)=>{
    let out="";
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const lit=rnd()>.42;
      out+=rect(x+c*gapX,y+r*gapY,size,size*1.35,lit?pick(colors):"#15253d",lit&&rnd()>.91?'class="window-flicker" opacity=".8"':'opacity=".65"');
    }
    return out;
  };
  const sign=(x,y,w,h,words,color)=>`<g class="neon-sign">${rect(x,y,w,h,"#18152d",`rx="3" stroke="${color}" stroke-width="2"`)}${rect(x+5,y+5,w-10,h-10,"none",`stroke="${color}" stroke-opacity=".44"`)}<text x="${x+w/2}" y="${y+h/2+7}" text-anchor="middle" font-weight="800" letter-spacing="1" font-size="${Math.min(22,h*.45)}" fill="${color}" class="neon-letters">${words}</text></g>`;
  const city=[];
  const add=(s)=>city.push(s);
  add(`<svg class="night-city-svg" role="img" aria-label="${ja?"ネオンが光る東京の街を、電車が走り続けるアニメーション":"Animated trains gliding through a retro neon Tokyo city at night"}" viewBox="0 0 1200 690" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="lr-sky" x1="0" x2=".12" y1="0" y2="1"><stop offset="0" class="sky-stop-top"/><stop offset=".64" class="sky-stop-mid"/><stop offset="1" class="sky-stop-bottom"/></linearGradient>
    <linearGradient id="lr-horizon"><stop stop-color="#743557" stop-opacity="0"/><stop offset=".54" stop-color="#fc9a80" stop-opacity=".22"/><stop offset="1" stop-color="#7e93d6" stop-opacity="0"/></linearGradient>
    <linearGradient id="lr-metal" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#eee6d6"/><stop offset=".25" stop-color="#bed2c8"/><stop offset=".72" stop-color="#5b7b8d"/><stop offset="1" stop-color="#27384f"/></linearGradient>
    <linearGradient id="lr-street" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#30304c"/><stop offset="1" stop-color="#060e25"/></linearGradient>
    <radialGradient id="lr-moon-glow"><stop stop-color="#e4b5d9" stop-opacity=".27"/><stop offset="1" stop-color="#e4b5d9" stop-opacity="0"/></radialGradient>
    <radialGradient id="lr-lamp-glow"><stop stop-color="#f9bb64" stop-opacity=".48"/><stop offset="1" stop-color="#f9bb64" stop-opacity="0"/></radialGradient>
    <filter id="lr-soft-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5"/></filter>
    <pattern id="lr-bricks" width="33" height="15" patternUnits="userSpaceOnUse"><path d="M0 0H33M0 15H33M16 0V8M0 8H33" stroke="#c77a9a" fill="none" stroke-opacity=".09"/></pattern>
    <pattern id="lr-grain" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 1h1v1H0zM5 4h1v1H5z" fill="white" opacity=".11"/></pattern>
    <clipPath id="lr-city-clip"><rect width="1200" height="690"/></clipPath>
  </defs>
  <g clip-path="url(#lr-city-clip)">${rect(0,0,1200,690,"url(#lr-sky)")}${rect(0,205,1200,250,"url(#lr-horizon)")}
    <circle cx="914" cy="116" r="117" fill="url(#lr-moon-glow)" class="night-moon-glow"/>
    <circle cx="914" cy="116" r="36" fill="#ffe4c3" class="night-moon"/>
    <circle cx="914" cy="116" r="38" fill="#ffca89" class="day-sun"/>`);
  for(let i=0;i<85;i++)add(`<circle class="night-star ${i%5===0?"star-twinkle":""}" cx="${(rnd()*1200).toFixed(1)}" cy="${(rnd()*295).toFixed(1)}" r="${rnd()>.9?1.7:.7}" fill="#e8e2ec" opacity="${(.25+rnd()*.55).toFixed(2)}"/>`);
  add(`<g class="night-depth-back">
    ${polygon("560,337 724,147 794,231 865,338","#3a3a65")}
    ${polygon("688,192 724,147 761,187 749,209 731,198 715,213","#c9b8d4",'opacity=".85"')}
    ${polygon("555,337 685,201 629,337","#363457",'opacity=".6"')}
    ${rect(0,332,1200,160,"#151f3a")}`);
  let skyX=-18;
  while(skyX<1250){
    const w=35+Math.floor(rnd()*55),h=73+Math.floor(rnd()*175),y=367-h;
    add(rect(skyX,y,w,h+75,pick(["#172641","#202947","#29304d","#1c2c47"])));
    add(lights(skyX+8,y+13,Math.max(1,Math.floor((w-15)/15)),Math.max(1,Math.floor(h/22)),15,21,["#cf9f91","#678ca8","#e4bf98"],5));
    if(rnd()>.7)add(`<path d="M${skyX+w/2} ${y}v-26" stroke="#78829c" stroke-width="2"/><circle cx="${skyX+w/2}" cy="${y-26}" r="2" fill="#f6acb7"/>`);
    skyX+=w+3;
  }
  add(`</g><g class="night-depth-middle">
    ${polygon("0,201 235,201 277,225 277,620 0,620","#16233b")}
    ${polygon("235,201 277,225 277,620 235,594","#10172e")}
    ${rect(0,204,237,394,"#273049")}${rect(0,204,237,394,"url(#lr-bricks)")}
    ${rect(11,196,239,14,"#3b4256")}
    ${lights(16,230,8,8,26,30,["#eead86","#eec7a6","#5bd3d0"],12)}
    ${rect(1,479,233,126,"#10182c")}${rect(1,486,233,7,"#f5a955")}
    ${rect(5,515,223,72,"#1c3b4f")}${rect(14,520,203,54,"#428c9b",'opacity=".22"')}
    ${sign(35,388,150,53,"喫茶・夜","#ffb06c")}
    ${sign(208,265,42,141,"終電","#ff65ae")}
    ${polygon("973,109 1122,130 1122,565 971,531","#303048")}
    ${polygon("1122,130 1200,96 1200,570 1122,565","#16263b")}
    ${polygon("973,109 1051,76 1200,96 1122,130","#45435a")}
    ${lights(990,149,5,9,25,33,["#f4ba8b","#c6dce7","#e47a9b"],12)}
    ${lights(1141,154,2,8,26,42,["#75a9c1","#d99a8a"],12)}
    ${sign(1020,355,164,70,"夜の東京","#70e6e7")}
    ${rect(1009,451,188,111,"#152037")}
    ${sign(1037,479,115,45,"居酒屋","#f3b56f")}`);
  const middle=[[278,274,119,241,"#293049"],[401,247,113,268,"#242c46"],[518,298,93,205,"#31304c"],[618,256,118,242,"#2a314e"],[739,294,110,220,"#24314a"],[853,239,118,270,"#2c2a46"]];
  for(const [x,y,w,h,color]of middle){
    add(polygon(`${x},${y} ${x+w-14},${y-14} ${x+w},${y+6} ${x+w},${y+h} ${x},${y+h}`,color));
    add(rect(x,y,w-11,h,"url(#lr-bricks)"));
    add(lights(x+12,y+22,Math.floor((w-20)/23),Math.floor((h-26)/29),23,29,["#80cfcd","#f9c39a","#cc8ba9"],11));
  }
  add(`${sign(427,276,64,131,"カフェ","#f8bb77")}${sign(661,310,54,120,"ラーメン","#ff668e")}${sign(789,348,54,90,"24H","#60efda")}
  </g><g stroke="#17243b" fill="none" stroke-width="3" opacity=".78"><path d="M-20 136Q290 168 602 128T1220 150"/><path d="M-20 147Q290 177 602 137T1220 160"/><path d="M-20 167Q310 218 610 167T1220 191"/></g>
  <g class="rail-back"><path d="M-30 394H1240" stroke="#12192e" stroke-width="49"/><path d="M-30 365H1240" stroke="#a6a4b1" stroke-width="7"/><path d="M-30 376H1240" stroke="#3d5669" stroke-width="5"/></g>`);
  function train(){
    let cars="";
    for(let i=0;i<4;i++){
      const x=18+i*137;
      cars+=`<g>${rect(x,0,134,70,"url(#lr-metal)",'rx="5" stroke="#29364a" stroke-width="3"')}${rect(x+7,11,120,5,"#db4c85")}${rect(x+12,26,113,28,"#17344b",'rx="2"')}
      ${rect(x+17,30,19,20,"#6ec2c9",'opacity=".72"')}${rect(x+40,30,19,20,"#9dd8d7",'opacity=".65"')}${rect(x+63,30,19,20,"#f6b58c",'opacity=".8"')}${rect(x+86,30,19,20,"#65aebf",'opacity=".65"')}${rect(x+109,30,12,20,"#f5ba91",'opacity=".7"')}
      <path d="M${x+65} 23V64" stroke="#334858" stroke-width="3"/>
      ${rect(x+6,65,120,6,"#1f3149")}<circle cx="${x+31}" cy="74" r="7" fill="#12192a" stroke="#6e7881" stroke-width="3"/><circle cx="${x+109}" cy="74" r="7" fill="#12192a" stroke="#6e7881" stroke-width="3"/></g>`;
    }
    return `<g transform="translate(0 307)">${rect(12,-2,558,9,"#ee9b84",'rx="5" opacity=".16" filter="url(#lr-soft-glow)"')}${cars}${rect(560,21,5,39,"#ffe3a3",'rx="2"')}<ellipse cx="585" cy="45" rx="51" ry="17" fill="#ffe6a4" opacity=".1" filter="url(#lr-soft-glow)"/></g>`;
  }
  add(`<g class="train-move train-move-a">${train()}</g><g class="train-move train-move-b">${train()}</g>
  <g class="rail-front">${rect(0,387,1200,12,"#0c172c")}${rect(0,399,1200,19,"#35445e")}${rect(0,411,1200,8,"#161e34")}`);
  for(let x=-60;x<1300;x+=152){
    add(polygon(`${x},417 ${x+19},417 ${x+33},584 ${x+4},584`,"#283347"));
    add(polygon(`${x+19},417 ${x+32},417 ${x+48},584 ${x+33},584`,"#0e1a2c"));
    add(`<path d="M${x+13} 456h23M${x+17} 493h24M${x+22} 535h26" stroke="#7a6281" opacity=".35" stroke-width="4"/>`);
  }
  add(`</g><g class="night-depth-front">
  ${polygon("0,552 1200,522 1200,690 0,690","url(#lr-street)")}
  ${polygon("0,594 1200,553 1200,565 0,606","#51536e",'opacity=".6"')}
  ${polygon("0,610 1200,568 1200,577 0,620","#c9acac",'opacity=".16"')}
  ${rect(18,551,234,16,"#62617a")}${rect(30,562,199,9,"#11182b")}
  ${rect(38,554,31,80,"#b55e61")}${rect(41,559,25,29,"#e45e68")}${rect(44,566,19,13,"#e7afba")}
  ${rect(93,549,89,12,"#242f47")}
  <g class="steam-plume" opacity=".57"><ellipse cx="186" cy="558" rx="14" ry="10" fill="#b6b8cf"/><ellipse cx="191" cy="540" rx="19" ry="11" fill="#8b99b2"/><ellipse cx="183" cy="522" rx="13" ry="9" fill="#8393ad"/></g>
  ${polygon("850,527 1039,520 1039,645 850,658","#18243a")}
  ${rect(866,544,163,8,"#c57f81")}${rect(879,553,143,65,"#315c64")}${rect(885,562,131,37,"#f4af73",'opacity=".3"')}
  ${sign(884,507,130,43,"駅前通り","#f4b26e")}
  <g class="street-lamp"><path d="M340 592V429h37" stroke="#11172a" stroke-width="10" fill="none"/><circle cx="373" cy="432" r="48" fill="url(#lr-lamp-glow)"/><rect x="358" y="429" width="35" height="12" rx="3" fill="#ffcd83"/></g>
  <g class="street-lamp"><path d="M1109 576V416h31" stroke="#131929" stroke-width="9" fill="none"/><circle cx="1138" cy="422" r="49" fill="url(#lr-lamp-glow)"/><rect x="1123" y="417" width="32" height="12" rx="2" fill="#ffca7b"/></g>
  <g class="person-person-a"><circle cx="458" cy="584" r="7" fill="#fac49d"/><path d="M451 594h14l7 28-11 5-11-5z" fill="#e0789a"/><path d="M451 622l-6 21m16-16 9 18" stroke="#152036" stroke-width="6"/></g>
  <g class="person-person-b"><circle cx="772" cy="573" r="7" fill="#d7a483"/><path d="M765 581h15l8 30-15 9-17-9z" fill="#5f9bb3"/><path d="M765 616l-5 20m18-20 5 18" stroke="#161b2b" stroke-width="6"/></g>
  ${polygon("372,579 395,579 410,687 355,687","#d4a069",'opacity=".14"')}
  ${polygon("1028,561 1056,561 1101,687 1022,687","#66e6d5",'opacity=".1"')}
  ${rect(0,685,1200,5,"#0a0c19")}
  </g><g class="sakura-drift" opacity=".82"></g>${rect(0,0,1200,690,"url(#lr-grain)",'opacity=".26" pointer-events="none"')}</g></svg>`);
  viewport.innerHTML=city.join("");
  const petalLayer=viewport.querySelector(".sakura-drift");
  let petals="";
  for(let i=0;i<28;i++){
    const x=Math.round(rnd()*1200),y=Math.round(rnd()*690),size=2+rnd()*3.6,duration=8+rnd()*13;
    petals+=`<path class="floating-petal" d="M0 0q${size} -${size*1.7} ${size*2} 0q-${size} ${size*2} -${size*2} 0" fill="${pick(["#e8a8bf","#ffcade","#f4a9bd"])}" style="--petal-x:${x}px;--petal-y:${y}px;--petal-life:${duration.toFixed(2)}s;--petal-delay:-${(rnd()*duration).toFixed(2)}s"/>`;
  }
  petalLayer.innerHTML=petals;
  const mode=scene.querySelector("[data-scene-time]");
  const motion=scene.querySelector("[data-scene-motion]");
  function setPaused(paused){
    scene.dataset.paused=String(paused);
    if(motion){motion.setAttribute("aria-pressed",String(paused));motion.textContent=paused?(ja?"▶ 再生":"▶ Resume"):(ja?"Ⅱ 一時停止":"Ⅱ Pause");}
  }
  setPaused(reduce.matches);
  motion?.addEventListener("click",()=>setPaused(scene.dataset.paused!=="true"));
  mode?.addEventListener("click",()=>{
    const day=scene.dataset.time!=="day";
    scene.dataset.time=day?"day":"night";
    mode.setAttribute("aria-pressed",String(day));
    mode.textContent=day?(ja?"☾ 夜に戻す":"☾ After dark"):(ja?"☼ 夜明け":"☼ Daybreak");
  });
  let raf=0,x=0,y=0;
  const draw=()=>{raf=0;scene.style.setProperty("--look-x",`${(x*11).toFixed(1)}px`);scene.style.setProperty("--look-y",`${(y*8).toFixed(1)}px`);};
  scene.addEventListener("pointermove",(event)=>{
    if(reduce.matches||event.pointerType==="touch")return;
    const bounds=scene.getBoundingClientRect();
    x=Math.max(-1,Math.min(1,(event.clientX-bounds.left)/bounds.width*2-1));
    y=Math.max(-1,Math.min(1,(event.clientY-bounds.top)/bounds.height*2-1));
    if(!raf)raf=requestAnimationFrame(draw);
  },{passive:true});
  scene.addEventListener("pointerleave",()=>{x=0;y=0;if(!raf)raf=requestAnimationFrame(draw);});
  reduce.addEventListener?.("change",(event)=>setPaused(event.matches));
})();