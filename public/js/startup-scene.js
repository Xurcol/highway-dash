// A separate title tableau uses the playable rig, with no extra renderer or gameplay simulation.
import * as THREE from "three";
import { HeroRig, SUITS, POSE } from "./hero-rig.js";

export class StartupScene {
  constructor() {
    this.scene = new THREE.Scene();
    const skyCanvas = document.createElement("canvas"); skyCanvas.width = 16; skyCanvas.height = 512;
    const sky = skyCanvas.getContext("2d"), gradient = sky.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, "#192f53"); gradient.addColorStop(.48, "#7384a3"); gradient.addColorStop(.76, "#e6ad91"); gradient.addColorStop(1, "#f6cfaa");
    sky.fillStyle = gradient; sky.fillRect(0, 0, 16, 512);
    this.scene.background = new THREE.CanvasTexture(skyCanvas);
    this.scene.background.colorSpace = THREE.SRGBColorSpace;
    this.scene.fog = new THREE.Fog(0xa19aa6, 35, 125);
    this.camera = new THREE.PerspectiveCamera(39, 1, .1, 160);
    this.camera.position.set(0, 1.9, 7.1);
    this.camera.lookAt(0, 1.3, 0);
    this.scene.add(new THREE.HemisphereLight(0xcddcf7, 0x263147, 1.35));
    const sun = new THREE.DirectionalLight(0xffd1ad, 2.1);
    sun.position.set(-8, 12, 8); this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x8fbeff, 2.6);
    rim.position.set(5, 4, -3); this.scene.add(rim);
    const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 256;
    const g = canvas.getContext("2d"); g.fillStyle = "#364454"; g.fillRect(0, 0, 128, 256);
    for (let y = 5; y < 256; y += 16) for (let x = 6; x < 128; x += 16) {
      g.fillStyle = (x + y) % 5 ? "#52677a" : "#e6bb81"; g.fillRect(x, y, 9, 11);
      g.fillStyle = "#233345"; g.fillRect(x, y + 11, 10, 1);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: texture, roughness: .82 }), 180);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    for (let i = 0; i < 90; i++) {
      const col = i % 15, row = Math.floor(i / 15), h = 5 + ((i * 17) % 19);
      position.set((col - 7) * 6 + Math.sin(i * 5) * 1.2, -19 + h / 2, -14 - row * 12);
      scale.set(3.2 + i % 3, h, 4.5); matrix.compose(position, rotation, scale); boxes.setMatrixAt(i, matrix);
      boxes.setColorAt(i, new THREE.Color().setHSL(.56 + (i % 4) * .025, .12, .48 + (i % 3) * .09));
      position.y += h / 2 + .7; scale.set(scale.x * .55, 1.4 + i % 4, 2.5);
      matrix.compose(position, rotation, scale); boxes.setMatrixAt(i + 90, matrix);
      boxes.setColorAt(i + 90, new THREE.Color(0x526176));
    }
    this.scene.add(boxes);
    // Ground the silhouette on a rooftop ledge instead of suspending it against a blank wall.
    const stone = new THREE.MeshStandardMaterial({ color: 0x343e4d, roughness: .94 });
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(4.3, .55, 2.4), stone);
    ledge.position.set(1.55, -.275, .55); this.scene.add(ledge);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(4.42, .09, 2.5), new THREE.MeshStandardMaterial({color:0x687585,roughness:.86}));
    lip.position.set(1.55, -.045, .55); this.scene.add(lip);
    this.rig = new HeroRig({ ...SUITS.crimson, base:0x9f2036, accent:0x172b45, dark:0x101b2a, glow:0xc6d8e7 });
    this.rig.mat.userData.u.uGlowAmt.value = .08;
    // The title close-up needs subdued fabric, not the high-contrast pattern used at game distance.
    const compile = this.rig.mat.onBeforeCompile;
    this.rig.mat.onBeforeCompile = (shader, renderer) => {
      compile.call(this.rig.mat, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace("weave * .55", "weave * .12").replace("gBump = weave;", "gBump = weave * .12;").replace("gRough = .48", "gRough = .72");
    };
    this.rig.mat.customProgramCacheKey = () => "arcline-title-fabric-v2";
    this.rig.group.position.set(1.55, 0, .8); this.rig.group.scale.setScalar(1.5);
    this.rig.group.rotation.set(0, -.16, 0);
    POSE.torso(this.rig, 18, -4, 0, -8, 0);
    POSE.headP(this.rig, -12, 12, 0);
    POSE.arm(this.rig, 1, 22, 12, 0, 65);
    POSE.arm(this.rig, -1, 10, 14, 0, 38);
    POSE.leg(this.rig, 1, 23, 10, 46, -23);
    POSE.leg(this.rig, -1, 23, 10, 46, -23);
    this.rig.snap(); this.scene.add(this.rig.group);
    this.rig.group.updateMatrixWorld(true);
    const foot = new THREE.Vector3();
    this.rig.bonePos("footL", foot);
    this.rig.group.position.y += .065 - foot.y;
    // Soft contact shading is static and adds no shadow-map render pass.
    const shade = document.createElement("canvas"); shade.width = shade.height = 64;
    const sg = shade.getContext("2d"), shadow = sg.createRadialGradient(32,32,3,32,32,31);
    shadow.addColorStop(0,"rgba(0,0,0,.65)"); shadow.addColorStop(1,"rgba(0,0,0,0)");
    sg.fillStyle=shadow; sg.fillRect(0,0,64,64);
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.6,1.25), new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shade),transparent:true,depthWrite:false}));
    contact.rotation.x=-Math.PI/2; contact.position.set(1.55,.006,1.02); this.scene.add(contact);
  }
  render(renderer, aspect) {
    if (this.camera.aspect !== aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    renderer.render(this.scene, this.camera);
  }
}
