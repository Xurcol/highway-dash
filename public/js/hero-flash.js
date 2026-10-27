import * as THREE from "three";
const GOLD = [1, .55, .05];
export class FlashMode {
  constructor(hero) {
    this.hero = hero; this.on = false; this.energy = 100; this.burst = 0; this.phase = 0; this.time = 0;
    this.cool = {burst:0, bolt:0, tornado:0, phase:0, time:0};
    this.positions = new Float32Array(144 * 6); this.history = new Float32Array(25 * 3); this.samples = 0; this.tick = 0;
    this.colors = new Float32Array(this.positions.length);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors,3).setUsage(THREE.DynamicDrawUsage)); this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.LineSegments(this.geometry,new THREE.LineBasicMaterial({color:0xffffff,vertexColors:true,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false}));
    this.mesh.frustumCulled=false; this.mesh.visible=false; hero.ctx.scene.add(this.mesh);
    this.probe=new THREE.Vector3(); this.result={contacts:[]}; this.hudTime=0;
  }
  set(on, quiet=false) {
    const h=this.hero,H=h.H;
    if (!quiet && (h.carry || h.combat.downT>0 || h.combat.action?.kind==="finisher")) {
      h.P.settings.heroMode=this.on?"flash":"arcline";
      h.hud.center("CANNOT SWITCH YET","Finish the current action first",1.5,"small"); return;
    }
    if(on!==this.on) {
      if(on) h.P.settings.webSuit=h.suitId==="flash"?"arcline":h.suitId;
      if(h.on) { H.releaseWebs("switch"); H.zip=null; H.sling=null; H.move=null; H.glide=H.dive=false; H.toAir(); h.tricks.reset(); h.combat.action=null; H.combatLock=0; }
      this.burst=this.phase=this.time=0; this.samples=0;
    }
    this.on=on; H.speedster=on; H.speedBurst=0;
    h.P.settings.heroMode=on?"flash":"arcline";
    h.setSuit(on?"flash":h.P.settings.webSuit|| (h.suitId==="flash"?"arcline":h.suitId));
    document.body.classList.toggle("flash-mode",on&&h.on);
    h.hud.el.querySelector(".hh-identity strong").textContent=on?"THE FLASH":"ARCLINE";
    h.gadgetT=0;
    const select=document.querySelector('[data-arc-setting="heroMode"]');if(select)select.value=h.P.settings.heroMode;
    if(!on)this.mesh.visible=false;
    if(!quiet&&h.on)h.hud.center(on?"THE FLASH":"ARCLINE",on?"Shift · Speed   C · Burst   E · Phase   N · Switch":"Web abilities restored · N switches hero",3);
  }
  use(name,cost,cooldown) {
    if(this.cool[name]>0||this.energy<cost){this.hero.hud.center("SPEED FORCE",this.cool[name]>0?`${name.toUpperCase()} ready in ${Math.ceil(this.cool[name])}s`:"Build more speed energy",1,"small");return false;}
    this.energy-=cost;this.cool[name]=cooldown;return true;
  }
  input(dt,i) {
    const h=this.hero,H=h.H,cb=h.combat;
    if(i.heroSwitch&&dt>0)this.set(!this.on);
    if(!this.on)return;
    const burst=i.zip,bolt=i.strike,tornado=i.throwObj,phase=i.gadget===1,time=i.trickDown;
    i.swing=i.swingDown=i.swingUp=i.zip=i.sling=i.wings=i.strike=i.throwObj=i.trick=i.trickDown=false;i.gadget=i.ability=0;
    if(dt<=0)return;
    for(const key in this.cool)this.cool[key]=Math.max(0,this.cool[key]-dt);
    this.burst=Math.max(0,this.burst-dt);this.phase=Math.max(0,this.phase-dt);this.time=Math.max(0,this.time-dt);
    this.energy=Math.min(100,this.energy+dt*(H.speed>20?9:5));
    H.speedBurst=this.burst;
    if(cb.downT>0||h.carry||H.combatLock>0)return;
    if(burst&&this.use("burst",18,3)){this.burst=1.2;H.speedBurst=1.2;h.sfx("whoosh",1.2);}
    if(phase&&this.use("phase",25,6)) {
      const dx=i.look.x,dz=i.look.z,l=Math.hypot(dx,dz)||1;let moved=false;
      for(let d=12;d>=2;d-=.5){
        const x=H.p.x+dx/l*d,z=H.p.z+dz/l*d;let clear=true;
        for(let j=-1;j<=1;j++){this.probe.set(x,H.p.y+j*.48,z);if(h.W.collide(this.probe,.43,this.result,1)>0){clear=false;break;}}
        if(!clear)continue;
        H.releaseWebs("phase");H.move=null;H.zip=null;H.p.x=x;H.p.z=z;H.toAir();h.afterTeleport();moved=true;break;
      }
      if(moved){this.phase=1;this.samples=0;h.sfx("whoosh",1);}
      else {this.energy+=25;this.cool.phase=0;h.hud.center("NO CLEAR EXIT","Aim past a thinner obstacle",1.2,"small");}
    }
    if(bolt){const e=cb.pickTarget(i);if(e&&cb.visible(e)&&cb.dist(e)<36){if(this.use("bolt",20,2.5)){cb.applyHit(e,{dmg:65,kind:"lightning",heavy:true,kx:H.face.x,kz:H.face.z});h.parts.energy(e.x,e.y+1,e.z,20,GOLD);h.sfx("launch",.8);}}else h.hud.center("NO LIGHTNING TARGET","Aim at an enemy within 36 metres",1,"small");}
    if(tornado&&this.use("tornado",35,8)){cb.impact(H.p.x,H.p.y-1,H.p.z,11,55,{launch:10});h.parts.energy(H.p.x,H.p.y,H.p.z,50,GOLD);h.sfx("boom",.7);}
    if(time&&this.use("time",40,14)){this.time=4;h.hud.center("SPEED TIME",h.online?"Enhanced reflexes · shared world stays at normal speed":"Enemy movement slowed for 4 seconds",1.5,"small");}
    if(this.time>0){cb.iframes=Math.max(cb.iframes,.12);}
    // Speed healing is gradual and only works after the normal damage recovery delay.
    if(cb.regenT>5)cb.hp=Math.min(1,cb.hp+dt*.035);
  }
  effects(dt) {
    const h=this.hero,H=h.H;
    this.mesh.visible=this.on&&h.on&&!h.cam.firstPerson&&H.speed>12;
    if(!this.mesh.visible){this.samples=0;return;}
    this.tick+=dt;if(this.tick<.025)return;this.tick%=.025;
    // Fixed buffers keep six branching ribbons cheap even at maximum speed.
    if(this.samples&&Math.hypot(this.history[0]-H.p.x,this.history[1]-H.p.y,this.history[2]-H.p.z)>15)this.samples=0;
    this.history.copyWithin(3,0,72);this.history[0]=H.p.x;this.history[1]=H.p.y;this.history[2]=H.p.z;this.samples=Math.min(25,this.samples+1);
    const speed=Math.min(1,H.speed/85), fx=H.face.x,fz=H.face.z;
    let n=0;
    for(let strand=0;strand<6;strand++)for(let k=0;k<this.samples-1;k++)for(let end=0;end<2;end++){
      const j=k+end, fade=Math.pow(1-j/24,1.7);
      const seed=Math.sin(j*7.3+strand*13+h.clock*24)*(.12+speed*.16);
      const spread=(strand-2.5)*.17+seed, bright=strand%2===0;
      this.positions[n]=this.history[j*3]+fz*spread;
      this.colors[n++]=fade*(bright?1:.9);
      this.positions[n]=this.history[j*3+1]-.65+(strand%3)*.58+seed;
      this.colors[n++]=fade*(bright?.82:.28);
      this.positions[n]=this.history[j*3+2]-fx*spread;
      this.colors[n++]=fade*(bright?.35:.015);
    }
    this.mesh.material.opacity=this.burst>0?1:.85;
    this.geometry.setDrawRange(0,n/3);this.geometry.attributes.position.needsUpdate=true;this.geometry.attributes.color.needsUpdate=true;
  }

  bar(){return [["C","Burst","burst",18],["F","Lightning","bolt",20],["Q","Tornado","tornado",35],["E","Phase","phase",25],["X","Speed Time","time",40]].map(([key,name,id,cost])=>`<span class="${this.cool[id]<=0&&this.energy>=cost?"ready":""}">${key} ${name}<small>${this.cool[id]>0?Math.ceil(this.cool[id])+"s":cost+" energy"}</small></span>`).join("");}
  hint(){return `FLASH · ${Math.floor(this.energy)}% ENERGY · Shift Speed · C Burst ${Math.ceil(this.cool.burst)}s · F Lightning · Q Tornado · E Phase · X Speed Time · N Switch`;}
}
