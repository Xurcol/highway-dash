// A separate title tableau uses the playable rig, with no extra renderer or gameplay simulation.
import * as THREE from "three";
import { HeroRig, SUITS, POSE } from "./hero-rig.js";

export class StartupScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe8bba7);
    this.scene.fog = new THREE.Fog(0xe8bba7, 26, 115);
    this.camera = new THREE.PerspectiveCamera(43, 1, .1, 160);
    this.camera.position.set(0, 1.7, 6);
    this.camera.lookAt(0, 1.25, 0);
    this.scene.add(new THREE.HemisphereLight(0xffe8d2, 0x4b5779, 2.4));
    const sun = new THREE.DirectionalLight(0xffd1a0, 3.2);
    sun.position.set(-8, 12, 8); this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9acaff, 1.5);
    rim.position.set(5, 4, -3); this.scene.add(rim);
    const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 256;
    const g = canvas.getContext("2d"); g.fillStyle = "#807e80"; g.fillRect(0, 0, 128, 256);
    for (let y = 5; y < 256; y += 16) for (let x = 6; x < 128; x += 16) {
      g.fillStyle = (x + y) % 5 ? "#3a5363" : "#e6c399"; g.fillRect(x, y, 9, 11);
      g.fillStyle = "#aaa09a"; g.fillRect(x, y + 11, 10, 1);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: texture, roughness: .8 }), 90);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    for (let i = 0; i < 90; i++) {
      const col = i % 15, row = Math.floor(i / 15), h = 5 + ((i * 17) % 19);
      position.set((col - 7) * 6, -17 + h / 2, -12 - row * 12);
      scale.set(3.2 + i % 3, h, 4.5); matrix.compose(position, rotation, scale); boxes.setMatrixAt(i, matrix);
      boxes.setColorAt(i, new THREE.Color().setHSL(.07 + (i % 4) * .025, .12, .48 + (i % 3) * .09));
    }
    this.scene.add(boxes);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 16, 9), new THREE.MeshStandardMaterial({ color: 0x777477, roughness: .9 }));
    wall.position.set(3.15, 2, -2.3); this.scene.add(wall);
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xb3a9a0, roughness: .7 });
    for (let i = 0; i < 7; i++) {
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(1.25, .07, 9.1), trimMat);
      ledge.position.set(3.1, -4 + i * 1.7, -2.3); this.scene.add(ledge);
    }
    this.rig = new HeroRig(SUITS.crimson);
    this.rig.group.position.set(1.52, -.15, .9); this.rig.group.scale.setScalar(1.65);
    this.rig.group.rotation.set(.06, -.45, -.2);
    POSE.torso(this.rig, 12, -28, 16, -8, -12);
    POSE.headP(this.rig, -8, -20, 8);
    POSE.arm(this.rig, 1, 110, 100, 15, 18);
    POSE.arm(this.rig, -1, 30, 48, 0, 60);
    POSE.leg(this.rig, 1, 78, 40, 110, -20);
    POSE.leg(this.rig, -1, -28, 28, 35, 20);
    this.rig.snap(); this.scene.add(this.rig.group);
  }
  render(renderer, aspect) {
    if (this.camera.aspect !== aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    renderer.render(this.scene, this.camera);
  }
}
