// Cursor wave trail effect
// Adapted from open-source canvas trail — uses SnowMind brand red

type Point = {
  x: number;
  y: number;
};

type PointerEventLike = MouseEvent | TouchEvent;

const SETTINGS = {
  friction: 0.5,
  trails: 15,
  size: 25,
  dampening: 0.025,
  tension: 0.99,
  lineWidth: 10,
  strokeStyle: "rgba(232, 65, 66, 0.035)",
} as const;

class TrailNode {
  x: number;
  y: number;
  vx: number;
  vy: number;

  constructor(initial: Point) {
    this.x = initial.x;
    this.y = initial.y;
    this.vx = 0;
    this.vy = 0;
  }
}

class TrailLine {
  spring: number;
  friction: number;
  nodes: TrailNode[];

  constructor(baseSpring: number, pointer: Point) {
    this.spring = baseSpring + 0.1 * Math.random() - 0.05;
    this.friction = SETTINGS.friction + 0.01 * Math.random() - 0.005;
    this.nodes = Array.from({ length: SETTINGS.size }, () => new TrailNode(pointer));
  }

  update(pointer: Point) {
    let springStrength = this.spring;
    let node = this.nodes[0];

    node.vx += (pointer.x - node.x) * springStrength;
    node.vy += (pointer.y - node.y) * springStrength;

    for (let i = 0; i < this.nodes.length; i += 1) {
      node = this.nodes[i];

      if (i > 0) {
        const previous = this.nodes[i - 1];
        node.vx += (previous.x - node.x) * springStrength;
        node.vy += (previous.y - node.y) * springStrength;
        node.vx += previous.vx * SETTINGS.dampening;
        node.vy += previous.vy * SETTINGS.dampening;
      }

      node.vx *= this.friction;
      node.vy *= this.friction;
      node.x += node.vx;
      node.y += node.vy;
      springStrength *= SETTINGS.tension;
    }
  }

  draw(context: CanvasRenderingContext2D) {
    let x = this.nodes[0].x;
    let y = this.nodes[0].y;

    context.beginPath();
    context.moveTo(x, y);

    for (let i = 1; i < this.nodes.length - 1; i += 1) {
      const current = this.nodes[i];
      const next = this.nodes[i + 1];
      x = 0.5 * (current.x + next.x);
      y = 0.5 * (current.y + next.y);
      context.quadraticCurveTo(current.x, current.y, x, y);
    }

    const penultimate = this.nodes[this.nodes.length - 2];
    const last = this.nodes[this.nodes.length - 1];
    context.quadraticCurveTo(penultimate.x, penultimate.y, last.x, last.y);
    context.stroke();
    context.closePath();
  }
}

let context2d: CanvasRenderingContext2D | null = null;
let isRunning = false;
let pointer: Point = { x: 0, y: 0 };
let lines: TrailLine[] = [];
const listeners: Array<() => void> = [];
let pointerListenersBound = false;

function addListener(
  target: EventTarget,
  eventName: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(eventName, handler, options);
  listeners.push(() => target.removeEventListener(eventName, handler, options));
}

function resetLines() {
  lines = [];
  for (let index = 0; index < SETTINGS.trails; index += 1) {
    const baseSpring = 0.45 + (index / SETTINGS.trails) * 0.025;
    lines.push(new TrailLine(baseSpring, pointer));
  }
}

function updatePointer(event: PointerEventLike) {
  const touchEvent = event as TouchEvent;
  if (touchEvent.touches && touchEvent.touches.length > 0) {
    pointer = {
      x: touchEvent.touches[0].pageX,
      y: touchEvent.touches[0].pageY,
    };
  } else {
    const mouseEvent = event as MouseEvent;
    pointer = {
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
    };
  }

  event.preventDefault();
}

function render() {
  if (!isRunning || !context2d) return;

  context2d.globalCompositeOperation = "source-over";
  context2d.clearRect(0, 0, context2d.canvas.width, context2d.canvas.height);
  context2d.globalCompositeOperation = "lighter";
  context2d.strokeStyle = SETTINGS.strokeStyle;
  context2d.lineWidth = SETTINGS.lineWidth;

  for (const line of lines) {
    line.update(pointer);
    line.draw(context2d);
  }

  window.requestAnimationFrame(render);
}

function resizeCanvas() {
  if (!context2d) return;
  context2d.canvas.width = window.innerWidth - 20;
  context2d.canvas.height = window.innerHeight;
}

function bindPointerTracking(initialEvent: PointerEventLike) {
  if (pointerListenersBound) return;
  pointerListenersBound = true;

  document.removeEventListener("mousemove", bindPointerTracking as unknown as EventListener);
  document.removeEventListener("touchstart", bindPointerTracking as unknown as EventListener);

  addListener(document, "mousemove", (event) => updatePointer(event as MouseEvent));
  addListener(document, "touchmove", (event) => updatePointer(event as TouchEvent), { passive: false });
  addListener(document, "touchstart", (event) => {
    const touchEvent = event as TouchEvent;
    if (touchEvent.touches.length === 1) {
      updatePointer(touchEvent);
    }
  });

  updatePointer(initialEvent);
  resetLines();
  render();
}

export function renderCanvas() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const canvas = document.getElementById("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const nextContext = canvas.getContext("2d");
  if (!nextContext) return;

  stopCanvas();

  context2d = nextContext;
  isRunning = true;
  pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  resetLines();

  addListener(document, "mousemove", bindPointerTracking as unknown as EventListener);
  addListener(document, "touchstart", bindPointerTracking as unknown as EventListener, { passive: false });
  addListener(window, "resize", resizeCanvas);
  addListener(window, "focus", () => {
    if (!isRunning) {
      isRunning = true;
      render();
    }
  });
  addListener(window, "blur", () => {
    isRunning = false;
  });

  resizeCanvas();
  render();
}

export function stopCanvas() {
  isRunning = false;
  pointerListenersBound = false;
  while (listeners.length > 0) {
    const remove = listeners.pop();
    if (remove) remove();
  }
  lines = [];
  context2d = null;
}
