import * as THREE from "three";
import { HeroRig, SUITS } from "./hero-rig.js?v=mvq292b7";
export const FLASH_POWERS = [
  ["2","Mirages","mirage",25,9], ["3","Barrage","barrage",25,5],
  ["4","Mass punch","mass",40,9], ["5","Speed steal","steal",20,10],
  ["6","Healing","heal",35,15], ["7","Sonic boom","sonic",30,8],
  ["8","Chain bolt","chain",35,7], ["9","Time anchor","recall",30,18],
];
const GOLD=[1,.65,.1];
export class FlashPowers {
  constructor(flash) {
    this.flash=flash; this.hero=flash.hero; this.mirage=0; this.healing=0; this.combo=null; this.anchor=null;
    this.auraTick=0; this.ghostTick=0; this.ghostIndex=0; this.ghosts=[]; this.bolts=[];
    this.group=new THREE.Group(); this.group.visible=false; this.hero.ctx.scene.add(this.group);
    for(const [, ,id] of FLASH_POWERS)flash.cool[id]=0;
    for(let k=0;k<8;k++) {
      const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(13*3),3).setUsage(THREE.DynamicDrawUsage));
      const mesh=new THREE.Line(g,new THREE.LineBasicMaterial({color:k%2?0xff9b19:0xffef9c,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
      mesh.frustumCulled=false;mesh.visible=false;this.group.add(mesh);this.bolts.push({mesh,t:0});
    }
    const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(129*3),3).setUsage(THREE.DynamicDrawUsage));
    this.vortex=new THREE.Line(g,new THREE.LineBasicMaterial({color:0xffc34b,transparent:true,opacity:.7,depthWrite:false,blending:THREE.AdditiveBlending}));
    this.vortex.frustumCulled=false;this.vortex.visible=false;this.group.add(this.vortex);this.vortexT=0;this.vortexPulse=0;
    this.marker=new THREE.Mesh(new THREE.RingGeometry(.9,1.1,32),new THREE.MeshBasicMaterial({color:0x9deaff,transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));
    this.marker.rotation.x=-Math.PI/2;this.marker.visible=false;this.group.add(this.marker);
    this.point=new THREE.Vector3();this.probe=new THREE.Vector3();this.collision={contacts:[]};
  }
  reset() {
    this.mirage=this.healing=this.vortexT=0;this.combo=this.anchor=null;this.group.visible=false;
    for(const g of this.ghosts){g.t=0;g.rig.group.visible=false;}
    for(const b of this.bolts){b.t=0;b.mesh.visible=false;}
    this.vortex.visible=false;this.marker.visible=false;
  }
  ghost() {
    if(!this.ghosts.length)for(let k=0;k<3;k++) {
      const rig=new HeroRig(SUITS.flash);rig.mat.dispose();
      rig.mesh.material=new THREE.MeshBasicMaterial({color:0xffb329,transparent:true,opacity:.3,depthWrite:false,blending:THREE.AdditiveBlending});
      rig.mesh.castShadow=false;rig.group.visible=false;this.group.add(rig.group);this.ghosts.push({rig,t:0});
    }
    const g=this.ghosts[this.ghostIndex++%3],source=this.hero.rig;
    g.t=.4;g.rig.group.visible=true;g.rig.group.position.copy(source.group.position);g.rig.group.quaternion.copy(source.group.quaternion);
    for(let k=0;k<source.bones.length;k++){g.rig.bones[k].position.copy(source.bones[k].position);g.rig.bones[k].quaternion.copy(source.bones[k].quaternion);}
    // Split stationary mirages sideways so the evasion is visible even without moving.
    if(this.hero.H.speed<3){g.rig.group.position.x+=(this.ghostIndex%3-1)*1.25;}
  }
  arc(x,y,z) {
    const H=this.hero.H,b=this.bolts.find(b=>b.t<=0)||this.bolts[0],a=b.mesh.geometry.attributes.position;
    for(let k=0;k<13;k++){const t=k/12,j=k===0||k===12?0:Math.sin(k*19+this.hero.clock*37)*.5;a.setXYZ(k,H.p.x+(x-H.p.x)*t+j,H.p.y+.3+(y-H.p.y-.3)*t-j,H.p.z+(z-H.p.z)*t+j);}
    a.needsUpdate=true;b.t=.3;b.mesh.visible=true;b.mesh.material.opacity=1;
  }
  target(i,r) {
    const cb=this.hero.combat,e=cb.pickTarget(i,r);
    if(e&&cb.alive(e)&&cb.dist(e)<=r&&cb.visible(e)&&Math.abs(e.y-this.hero.H.p.y)<4)return e;
    this.hero.hud.center("NO TARGET",`Aim at an enemy within ${r} metres`,1,"small");return null;
  }
  hit(e,dmg,extra={}) {
    const h=this.hero,H=h.H,d=Math.hypot(e.x-H.p.x,e.z-H.p.z)||1;
    h.combat.applyHit(e,{dmg,kind:"lightning",kx:(e.x-H.p.x)/d,kz:(e.z-H.p.z)/d,...extra});
    this.arc(e.x,e.y+.5,e.z);h.parts.energy(e.x,e.y+.5,e.z,8,GOLD);
  }
  startTornado() {this.vortexT=2.4;this.vortexPulse=.3;this.point.copy(this.hero.H.p);}
  update(dt,i,slot) {
    const f=this.flash,h=this.hero,H=h.H,cb=h.combat;
    if(cb.downT>0){this.reset();return;}
    this.mirage=Math.max(0,this.mirage-dt);
    if(this.mirage>0)cb.iframes=Math.max(cb.iframes,.12);
    if(this.healing>0){this.healing=Math.max(0,this.healing-dt);cb.hp=Math.min(1,cb.hp+dt*.12);}
    if(this.anchor&&(h.clock>this.anchor.until||this.anchor.tp!==h.tpN))this.anchor=null;
    if(this.vortexT>0) {
      this.vortexT=Math.max(0,this.vortexT-dt);this.vortexPulse-=dt;
      if(this.vortexPulse<=0){this.vortexPulse=.4;cb.impact(this.point.x,this.point.y-1,this.point.z,11,8,{launch:5});}
    }
    if(this.combo) {
      const a=this.combo,e=cb.byId(a.target);a.t-=dt;
      if(!cb.alive(e)||cb.dist(e)>5||!cb.visible(e)||cb.action?.kind==="hit")this.combo=null;
      else if(a.t<=0){this.hit(e,a.mass?55:7,{heavy:a.mass,knock:a.mass?15:0});h.sfx("punch",a.mass?1.3:.6);a.left--;a.t=.085;if(!a.left)this.combo=null;}
      if(this.combo){i.attack=i.attackDown=i.attackHeld=false;}
    }
    if(!slot||h.carry||H.combatLock>0||this.combo)return;
    const p=FLASH_POWERS.find(p=>+p[0]===slot);if(!p)return;
    const [,label,id,cost,cool]=p;
    if(id==="recall"&&this.anchor) {
      const a=this.anchor;if(!this.clear(a.x,a.y,a.z)){h.hud.center("ANCHOR BLOCKED","The return point is no longer clear",1.5,"small");return;}
      this.anchor=null;H.releaseWebs("recall");H.move=H.zip=H.sling=null;H.p.set(a.x,a.y,a.z);H.v.set(0,0,0);H.toAir();cb.hp=Math.max(cb.hp,a.hp);h.afterTeleport();f.samples=0;h.parts.energy(a.x,a.y,a.z,40,GOLD);h.sfx("whoosh",1);return;
    }
    let target=null;
    if(["barrage","mass","chain"].includes(id)){target=this.target(i,id==="chain"?36:5);if(!target)return;}
    if(id==="heal"&&cb.hp>=1){h.hud.center("HEALTH FULL","Healing is already complete",1,"small");return;}
    if(id==="recall"&&(H.state!=="ground"||!this.clear(H.p.x,H.p.y,H.p.z))){h.hud.center("LAND FIRST","Set your time anchor on clear ground",1,"small");return;}
    if(id==="steal"&&!cb.list.some(e=>cb.alive(e)&&cb.dist(e)<12&&Math.abs(e.y-H.p.y)<4&&cb.visible(e))){h.hud.center("NO SPEED TO STEAL","Get within 12 metres of an enemy",1,"small");return;}
    if(!f.use(id,cost,cool))return;
    if(id==="mirage"){this.mirage=3;cb.iframes=Math.max(cb.iframes,.12);}
    if(id==="heal")this.healing=3;
    if(id==="barrage"||id==="mass"){this.combo={target:target.id,left:id==="mass"?3:10,t:id==="mass"?.4:.08,mass:id==="mass"};H.face.set(target.x-H.p.x,0,target.z-H.p.z).normalize();}
    if(id==="steal") {
      let count=0;for(const e of cb.list)if(cb.alive(e)&&cb.dist(e)<12&&Math.abs(e.y-H.p.y)<4&&cb.visible(e)){this.hit(e,2,{speedSlow:4});count++;}
      f.energy=Math.min(100,f.energy+Math.min(30,count*8));f.burst=2;H.speedBurst=2;
    }
    if(id==="sonic"){cb.impact(H.p.x,H.p.y-1,H.p.z,16,40,{knock:15,disarm:true});h.parts.energy(H.p.x,H.p.y,H.p.z,60,GOLD);h.sfx("boom",1);}
    if(id==="chain") {
      this.hit(target,50,{heavy:true});let count=1;
      for(const e of cb.list)if(e!==target&&count<6&&cb.alive(e)&&cb.dist(e)<36&&Math.hypot(e.x-target.x,e.z-target.z)<12&&Math.abs(e.y-H.p.y)<4&&cb.visible(e)){this.hit(e,35,{heavy:true});count++;}
    }
    if(id==="recall")this.anchor={x:H.p.x,y:H.p.y,z:H.p.z,hp:cb.hp,until:h.clock+8,tp:h.tpN};
    h.hud.center(label.toUpperCase(),id==="recall"?"9 again within 8s · return here and recover saved health":id==="mirage"?"3 seconds of afterimage evasion":id==="heal"?"Recovering health over 3 seconds":id==="steal"?"Nearby enemies slowed for 4s · energy absorbed":"SPEED FORCE",1.5,"small");
  }
  clear(x,y,z) {
    for(let j=-1;j<=1;j++){this.probe.set(x,y+j*.48,z);if(this.hero.W.collide(this.probe,.43,this.collision,1)>0)return false;}return true;
  }
  pose() {
    if(!this.combo)return null;
    if(this.combo.mass)return {kind:"cross",k:this.combo.left===3?.15+(1-this.combo.t/.4)*.5:1-this.combo.t/.085,side:1};
    return {kind:this.combo.left%2?"jab":"cross",k:1-this.combo.t/.085,side:this.combo.left%2?1:-1};
  }
  effects(dt) {
    const h=this.hero;this.group.visible=this.flash.on&&h.on;if(!this.group.visible)return;
    this.marker.visible=!!this.anchor;
    if(this.anchor){this.marker.position.set(this.anchor.x,this.anchor.y-.94,this.anchor.z);const scale=1+Math.sin(h.clock*5)*.12;this.marker.scale.setScalar(scale);}
    this.auraTick-=dt;if(this.auraTick<=0&&(this.healing>0||this.flash.phase>0)){this.auraTick=.12;h.parts.energy(h.H.p.x,h.H.p.y,h.H.p.z,3,GOLD);}
    this.ghostTick-=dt;
    if(this.mirage>0&&!h.cam.firstPerson&&this.ghostTick<=0){this.ghostTick=.12;this.ghost();}
    for(const g of this.ghosts){g.t=Math.max(0,g.t-dt);g.rig.group.visible=g.t>0&&!h.cam.firstPerson;g.rig.mesh.material.opacity=g.t*.8;}
    for(const b of this.bolts){b.t=Math.max(0,b.t-dt);b.mesh.visible=b.t>0;b.mesh.material.opacity=b.t/.3;}
    this.vortex.visible=this.vortexT>0;
    if(this.vortex.visible){const a=this.vortex.geometry.attributes.position;for(let k=0;k<129;k++){const t=k/128,angle=t*Math.PI*12+h.clock*14,r=2+t*7;a.setXYZ(k,this.point.x+Math.cos(angle)*r,this.point.y-1+t*6,this.point.z+Math.sin(angle)*r);}a.needsUpdate=true;this.vortex.material.opacity=Math.min(.7,this.vortexT);}
  }
  bar() {return FLASH_POWERS.map(([key,name,id,cost])=>`<span class="${this.flash.cool[id]<=0&&this.flash.energy>=cost||id==="recall"&&this.anchor?"ready":""}">${key} ${name}<small>${id==="recall"&&this.anchor?"RETURN "+Math.ceil(this.anchor.until-this.hero.clock)+"s":this.flash.cool[id]>0?Math.ceil(this.flash.cool[id])+"s":cost+" energy"}</small></span>`).join("");}
}
