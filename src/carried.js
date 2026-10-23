// Native 0xb1ee0: each link retains its own position and follows the previous
// link only when stretched. The native blend retains 3/4 of the old position.
export function updateCarried(chain, mouse, world, dt) {
  let leader = mouse;
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i];
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      node.x = leader.x; node.y = leader.y;
    }
    const previousX = node.x, previousY = node.y;
    let target = leader;
    let detour = false;
    if (!world.lineClear(node.x, node.y, leader.x, leader.y)) {
      const route = world.bfsToWorld(node.x, node.y, leader.x, leader.y);
      if (route?.length) {
        target = route[0];
        for (const point of route) {
          if (!world.lineClear(node.x, node.y, point.x, point.y)) break;
          target = point;
        }
        detour = true;
      }
    }
    const dx = target.x - node.x, dy = target.y - node.y;
    const distance = Math.hypot(dx, dy);
    const spacing = detour ? 0 : world.cell * (i === 0 ? 1.8 : 1.25);
    if (distance > spacing) {
      const alpha = 1 - Math.pow(0.75, Math.max(0, dt) * 60);
      const amount = (distance - spacing) * alpha / distance;
      const x = node.x + dx * amount, y = node.y + dy * amount;
      const radius = world.cell * 0.2;
      if (world.lineClear(node.x, node.y, x, y) && !world.circleHitsWall(x, y, radius)) { node.x = x; node.y = y; }
      else {
        if (!world.circleHitsWall(x, node.y, radius)) node.x = x;
        if (!world.circleHitsWall(node.x, y, radius)) node.y = y;
      }
    }
    const movedX = node.x - previousX, movedY = node.y - previousY;
    if (Math.hypot(movedX, movedY) > 1e-6) node.angle = Math.atan2(movedY, movedX);
    leader = node;
  }
}

export function resetCarried(chain, mouse) {
  for (const node of chain || []) { node.x = mouse.x; node.y = mouse.y; node.angle = mouse.angle; }
}
