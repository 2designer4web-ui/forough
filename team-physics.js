(() => {
  const field = document.querySelector('.team-squares');
  if (!field) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const gravity = 1050;
  const restitution = .34;
  const stepSize = 1 / 120;
  const quarterTurn = Math.PI / 2;
  const blocks = [];
  let width = 0;
  let height = 0;
  let frame = 0;
  let previousTime = 0;
  let visible = false;
  let pointer;
  let grab;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const render = (block) => {
    block.element.style.transform = 'translate3d(' + (block.x - block.half) + 'px,' +
      (block.y - block.half) + 'px,0) rotate(' + block.angle + 'rad)';
  };

  function layout() {
    const previousWidth = width;
    const previousHeight = height;
    width = field.clientWidth;
    height = field.clientHeight;
    if (!width || !height) return;
    const count = clamp(Math.floor(width / 17), 12, 58);
    if (count !== blocks.length) {
      release();
      field.replaceChildren();
      blocks.length = 0;
      for (let index = 0; index < count; index++) {
        const element = document.createElement('span');
        const half = (12 + (index * 13 % 16)) / 2;
        const x = (index + .5) * width / count;
        const raised = index % 4 === 0 && !reducedMotion.matches;
        const y = height - half - (raised ? 25 : 0);
        element.style.setProperty('--size', half * 2 + 'px');
        element.dataset.block = index;
        const block = { element, half, x, y, vx: 0, vy: 0, angle: 0, spin: 0 };
        field.append(element);
        blocks.push(block);
        render(block);
      }
    } else if (previousWidth && (width !== previousWidth || height !== previousHeight)) {
      release();
      for (const block of blocks) {
        block.x = clamp(block.x * width / previousWidth, block.half, width - block.half);
        block.y = clamp(block.y + height - previousHeight, block.half, height - block.half);
        render(block);
      }
    }
    schedule();
  }

  function updateBlock(block, seconds) {
    if (block === grab?.block) return;
    if (reducedMotion.matches) {
      block.y = height - block.half;
      block.angle = 0;
      block.vx = 0;
      block.vy = 0;
      return;
    }
    if (pointer && !grab && block !== pointer.target) {
      const dx = block.x - pointer.x;
      const dy = block.y - pointer.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 60) {
        const push = (1 - distance / 60) * 3000 * seconds;
        block.vx += (distance ? dx / distance : 1) * push;
        block.vy -= push * (.58 + Math.max(0, -dy / 60));
        block.spin += clamp(dx / 55, -1, 1) * push * .055;
      }
    }
    block.vx = clamp(block.vx * .997, -750, 750);
    block.vy = clamp(block.vy + gravity * seconds, -750, 750);
    block.x += block.vx * seconds;
    block.y += block.vy * seconds;
    block.angle += block.spin * seconds;
    block.spin *= .990;

    const edge = block.half * (Math.abs(Math.sin(block.angle)) + Math.abs(Math.cos(block.angle)));
    if (block.x < edge || block.x > width - edge) {
      block.x = clamp(block.x, edge, width - edge);
      block.vx *= -restitution;
    }
    if (block.y < edge) {
      block.y = edge;
      block.vy = Math.abs(block.vy) * restitution;
    }
    if (block.y >= height - edge) {
      block.y = height - edge;
      block.vy = block.vy > 34 ? -block.vy * restitution : 0;
      block.vx *= .90;
      block.spin *= .70;
      const flat = Math.round(block.angle / quarterTurn) * quarterTurn;
      block.angle += (flat - block.angle) * .18;
    }
  }

  function collide(first, second) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const overlapX = first.half + second.half - Math.abs(dx);
    const overlapY = first.half + second.half - Math.abs(dy);
    if (overlapX <= 0 || overlapY <= 0) return;
    const horizontal = overlapX < overlapY;
    const axis = horizontal ? 'x' : 'y';
    const velocity = horizontal ? 'vx' : 'vy';
    const sign = (horizontal ? dx : dy) >= 0 ? 1 : -1;
    const firstWeight = first === grab?.block ? 0 : 1;
    const secondWeight = second === grab?.block ? 0 : 1;
    const totalWeight = firstWeight + secondWeight;
    const shift = (horizontal ? overlapX : overlapY) / totalWeight * sign;
    first[axis] -= shift * firstWeight;
    second[axis] += shift * secondWeight;
    const approach = (second[velocity] - first[velocity]) * sign;
    if (approach < 0) {
      const impulse = -(1 + restitution) * approach / totalWeight * sign;
      first[velocity] -= impulse * firstWeight;
      second[velocity] += impulse * secondWeight;
    }
  }

  function tick(time) {
    frame = 0;
    if (!visible || !blocks.length || document.hidden) return;
    const elapsed = previousTime ? Math.min((time - previousTime) / 1000, .035) : stepSize;
    previousTime = time;
    const steps = Math.max(1, Math.ceil(elapsed / stepSize));
    for (let index = 0; index < steps; index++) {
      for (const block of blocks) updateBlock(block, elapsed / steps);
      if (reducedMotion.matches) continue;
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) collide(blocks[i], blocks[j]);
      }
      for (const block of blocks) {
        if (block === grab?.block) continue;
        block.x = clamp(block.x, block.half, width - block.half);
        block.y = clamp(block.y, block.half, height - block.half);
      }
    }
    for (const block of blocks) render(block);
    schedule();
  }

  function schedule() {
    if (!frame && visible && !document.hidden && (!reducedMotion.matches || grab)) {
      frame = requestAnimationFrame(tick);
    }
  }

  function local(event) {
    const bounds = field.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  field.addEventListener('pointerdown', (event) => {
    const block = blocks[event.target.dataset?.block];
    if (!block || grab || event.button !== 0) return;
    event.preventDefault();
    field.setPointerCapture(event.pointerId);
    const point = local(event);
    grab = {
      block, id: event.pointerId, dx: block.x - point.x, dy: block.y - point.y,
      speedX: 0, speedY: 0, time: event.timeStamp
    };
    block.vx = 0;
    block.vy = 0;
    block.spin = 0;
    block.angle = 0;
    block.element.dataset.held = '';
    field.dataset.grabbing = '';
    render(block);
    schedule();
  });

  field.addEventListener('pointermove', (event) => {
    const point = local(event);
    if (!grab) {
      if (event.pointerType === 'mouse') pointer = { ...point, target: blocks[event.target.dataset?.block] };
      return;
    }
    if (event.pointerId !== grab.id) return;
    const { block } = grab;
    const x = clamp(point.x + grab.dx, block.half, width - block.half);
    const y = clamp(point.y + grab.dy, block.half, height - block.half);
    const seconds = Math.max(.012, (event.timeStamp - grab.time) / 1000);
    grab.speedX = clamp((x - block.x) / seconds, -750, 750);
    grab.speedY = clamp((y - block.y) / seconds, -750, 750);
    grab.time = event.timeStamp;
    block.x = x;
    block.y = y;
    render(block);
  });

  function release(event) {
    if (!grab || (event && event.pointerId !== grab.id)) return;
    const { block, id, speedX, speedY, time } = grab;
    const throwBlock = event?.type === 'pointerup' && event.timeStamp - time < 80 && !reducedMotion.matches;
    block.vx = throwBlock ? speedX : 0;
    block.vy = throwBlock ? speedY : 0;
    block.spin = throwBlock ? speedX * .009 : 0;
    delete block.element.dataset.held;
    delete field.dataset.grabbing;
    grab = undefined;
    pointer = undefined;
    if (field.hasPointerCapture(id)) field.releasePointerCapture(id);
    if (reducedMotion.matches) {
      block.y = height - block.half;
      render(block);
    }
  }

  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) field.addEventListener(event, release);
  field.addEventListener('pointerleave', () => { pointer = undefined; });
  new ResizeObserver(layout).observe(field);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    previousTime = 0;
    schedule();
  }).observe(field);
  document.addEventListener('visibilitychange', () => {
    previousTime = 0;
    schedule();
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      for (const block of blocks) {
        updateBlock(block, 0);
        render(block);
      }
    }
    schedule();
  });
  layout();
})();
