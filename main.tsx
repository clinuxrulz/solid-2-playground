import { render } from '@solidjs/web';
import { type Accessor, createSignal, createMemo, createEffect, createStore, type Signal, untrack } from 'solid-js';
import * as THREE from "three";
import { Joystick } from "./Joystick";
import { World } from "./World";
import { Player } from "./Player";
import { Court } from "./Court";

let [ canvasSize, setCanvasSize, ] = createSignal<THREE.Vector2>();

let gravity = new THREE.Vector3(0.0, -100, 0.0);

let world = new World({
  player1: new Player({
    position: new THREE.Vector3(0.0, 0.0, 2.5),
    velocity: new THREE.Vector3(0.0, 0.0, 0.0),
  }),
  court: new Court({
    width: 4.0,
    length: 6.0,
    netHeight: 0.5,
  }),
});

let [ upDown, setUpDown, ] = createSignal(false);
let [ downDown, setDownDown, ] = createSignal(false);
let [ leftDown, setLeftDown, ] = createSignal(false);
let [ rightDown, setRightDown, ] = createSignal(false);
let [ jumpDown, setJumpDown, ] = createSignal(false);

function App() {
  let joystickHitAreaSize = 150;
  let joystick = new Joystick({
    position: createMemo(() =>
      new THREE.Vector2(
        50.0,
        (canvasSize()?.y ?? 0) - 50 - joystickHitAreaSize,
      )
    ),
    hitAreaSize: joystickHitAreaSize,
    outerRingSize: () => 0.8 * joystickHitAreaSize,
    knobSize: () => 70,
  });
  let animating = createMemo(() => {
    if (jumpDown()) {
      return true;
    }
    let player1 = world.player1[0]();
    if (player1 != undefined) {
      let pos = player1.position[0]();
      if (pos.y > 0.0) {
        return true;
      }
      let vel = player1.velocity[0]();
      if (vel.x != 0.0 || vel.y != 0.0 || vel.z != 0.0) {
        return true;
      }
    }
    return upDown() || downDown() || leftDown() || rightDown() || joystick.value().x != 0.0 || joystick.value().y != 0.0;
  }); 
  let [ canvas, setCanvas, ] = createSignal<HTMLCanvasElement>();
  createEffect(canvas, (canvas: HTMLCanvasElement | undefined) => {
    if (canvas == undefined) {
      return;
    }
    let rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width == 0 && height == 0) {
      setCanvas(undefined);
      setTimeout(() => setCanvas(canvas));
      return;
    }
    let resizeObserver = new ResizeObserver(() => {
      let rect = canvas.getBoundingClientRect();
      setCanvasSize(new THREE.Vector2(
        rect.width,
        rect.height,
      ));
    });
    resizeObserver.observe(canvas);
    // TODO resizeOberver cleanup

    //
    const camera = new THREE.PerspectiveCamera( 50, width / height, 0.01, 10 );
    camera.position.set(0,2,6);
    camera.lookAt(new THREE.Vector3());

    const scene = new THREE.Scene();

    const geometry = new THREE.BoxGeometry( 0.5, 0.5, 0.5 );
    const material = new THREE.MeshNormalMaterial();

    const mesh = new THREE.Mesh( geometry, material );

    let hasPlayer1 = createMemo(() => world.player1[0]() != undefined);
    createMemo(() => {
      if (!hasPlayer1()) {
        return;
      }
      let player1 = world.player1[0] as Accessor<NonNullable<ReturnType<typeof world.player1[0]>>>;
      createMemo(() => {
        let pos = player1().position[0]();
        mesh.position.set(pos.x, pos.y + 0.25, pos.z);
      });
    });

    scene.add( mesh );
    world.render(scene);

    const renderer = new THREE.WebGLRenderer( { antialias: true, canvas, } );
    renderer.setSize( width, height );
    console.log("width", width);
    console.log("height", height);
    let updateFrame = (dt: number) => {
      let player1 = world.player1[0]();
      if (player1 != undefined) {
        let pos = player1.position;
        let vel = player1.velocity;
        let newPos = pos[0]().clone();
        let newVel = vel[0]().clone();
        if (leftDown()) {
          newPos.x -= 0.1;
        }
        if (rightDown()) {
          newPos.x += 0.1;
        }
        if (downDown()) {
          newPos.z += 0.1;
        }
        if (upDown()) {
          newPos.z -= 0.1;
        }
        newPos.x += joystick.value().x * 0.1;
        newPos.z += joystick.value().y * 0.1;
        if (newPos.y == 0.0) {
          if (jumpDown()) {
            newVel.y = 15.0;
          }
        } else if (newPos.y > 0.0) {
          newVel.add(gravity.clone().multiplyScalar(1.0 / 60.0));
        }
        newPos.add(newVel.clone().multiplyScalar(1.0 / 60.0));
        if (newPos.y <= 0.0) {
          newPos.y = 0.0;
          newVel.y = 0.0;
        }
        pos[1](newPos);
        vel[1](newVel);
      }
      world.update(dt);
    };
    let aboutToRender = false;
    let firstFrame = false;
    let lastT: number = 0.0;
    let render = (t: number) => {
      let dt = firstFrame ? t - 1.0/60.0 : t - lastT;
      firstFrame = false;
      lastT = t;
      renderer.render(scene, camera);
      if (animating()) {
        updateFrame(dt);
        aboutToRender = true;
        requestAnimationFrame(render);
      } else {
        lastT = 0.0;
        aboutToRender = false;
      }
    };
    firstFrame = true;
    requestAnimationFrame(render);
    createEffect(animating, (animating) => {
      if (animating && !aboutToRender) {
        firstFrame = true;
        requestAnimationFrame(render);
      }
    });
  });
  return (<>
    <canvas
      ref={setCanvas}
      style={{
        "width": "100%",
        "height": "100%",
      }}
    />
    <joystick.UI/>
  </>);
}

document.body.style.setProperty("overflow", "hidden");

let div = document.createElement("div");
div.style.setProperty("position", "absolute");
div.style.setProperty("left", "0");
div.style.setProperty("top", "0");
div.style.setProperty("right", "0");
div.style.setProperty("bottom", "0");
div.style.setProperty("background-color", "black");
document.body.append(div);

render(() => <App />, div);

document.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowUp":
      setUpDown(true);
      break;
    case "ArrowDown":
      setDownDown(true);
      break;
    case "ArrowLeft":
      setLeftDown(true);
      break;
    case "ArrowRight":
      setRightDown(true);
      break;
    case " ":
      setJumpDown(true);
      break;
  }
});

document.addEventListener("keyup", (e) => {
  switch (e.key) {
    case "ArrowUp":
      setUpDown(false);
      break;
    case "ArrowDown":
      setDownDown(false);
      break;
    case "ArrowLeft":
      setLeftDown(false);
      break;
    case "ArrowRight":
      setRightDown(false);
      break;
    case " ":
      setJumpDown(false);
      break;
  }
});
