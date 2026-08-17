const MIN_SCALE = 0.01;
const MAX_SCALE = 40;

/** Аффинное преобразование мира в экран: screen = world * scale + offset. */
export class Camera {
  scale = 1;
  x = 0;
  y = 0;

  /**
   * Взял ли пользователь камеру в свои руки (колесо или перетаскивание).
   * Пока false, вписывание идёт автоматически; после первого вмешательства —
   * никогда, иначе камера отбирала бы управление на следующем же сообщении
   * раскладки.
   */
  private userControlled = false;

  toScreen(wx: number, wy: number): [number, number] {
    return [wx * this.scale + this.x, wy * this.scale + this.y];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.x) / this.scale, (sy - this.y) / this.scale];
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  /** Масштабирует так, чтобы точка мира под (sx, sy) осталась на месте. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const applied = next / this.scale;
    this.x = sx - (sx - this.x) * applied;
    this.y = sy - (sy - this.y) * applied;
    this.scale = next;
  }

  /** Вписывает облако точек (пары x, y) в прямоугольник width × height. */
  fit(positions: Float32Array, width: number, height: number): void {
    if (positions.length < 2) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 2) {
      const px = positions[i]!;
      const py = positions[i + 1]!;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const padding = 0.85;
    this.scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min((width / spanX) * padding, (height / spanY) * padding)),
    );
    this.x = width / 2 - ((minX + maxX) / 2) * this.scale;
    this.y = height / 2 - ((minY + maxY) / 2) * this.scale;
  }

  /**
   * Вписывает в вид только активные узлы. Массив позиций покрывает все пути
   * за всю историю, и мёртвые узлы в нём хранят старые координаты — если их
   * учесть, масштаб определится по давно исчезнувшему углу дерева.
   * Возвращает false, если активных узлов не оказалось: вызывающий не должен
   * считать, что камера настроена, иначе она останется настроенной никогда.
   */
  fitActive(positions: Float32Array, active: Uint8Array, width: number, height: number): boolean {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (let path = 0; path < active.length; path++) {
      if (active[path] === 0) continue;
      const px = positions[path * 2]!;
      const py = positions[path * 2 + 1]!;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      count++;
    }
    if (count === 0) return false;
    this.fit(Float32Array.from([minX, minY, maxX, maxY]), width, height);
    return true;
  }

  /** Помечает камеру как управляемую вручную: автовписывание больше не работает. */
  takeManualControl(): void {
    this.userControlled = true;
  }

  /**
   * Автоматическое вписывание живых узлов. Зовётся на каждом сообщении
   * раскладки, поэтому камера следует за деревом, пока то расходится: узел
   * рождается рядом с родителем, и первые кадры — плотный комок в сотню
   * единиц, а не готовое облако. Однократное вписывание на первом же остывшем
   * сообщении оставляло бы дерево обрезанным в углу.
   *
   * Само вписывание прекращается естественно: воркер шлёт позиции, только
   * пока симуляция идёт, и замолкает, когда раскладка успокоилась.
   * Возвращает false, если вписывать было нечего или камерой уже управляет
   * пользователь.
   */
  autoFit(positions: Float32Array, active: Uint8Array, width: number, height: number): boolean {
    if (this.userControlled) return false;
    return this.fitActive(positions, active, width, height);
  }

  /** Вешает колесо и перетаскивание. Возвращает функцию отписки. */
  attach(canvas: HTMLCanvasElement): () => void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Любой жест камерой — это заявка пользователя на управление: дальше
      // автовписывание молчит, иначе оно вернуло бы масштаб на следующем же
      // сообщении раскладки.
      this.takeManualControl();
      this.zoomAt(event.offsetX, event.offsetY, Math.exp(-event.deltaY * 0.002));
    };
    const onDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.offsetX;
      lastY = event.offsetY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      // Отмечаем именно перетаскивание, а не нажатие: одиночный клик по узлу
      // (инспектор в срезе 5) не должен отбирать камеру у автовписывания.
      this.takeManualControl();
      this.panBy(event.offsetX - lastX, event.offsetY - lastY);
      lastX = event.offsetX;
      lastY = event.offsetY;
    };
    const onUp = (event: PointerEvent) => {
      dragging = false;
      canvas.releasePointerCapture(event.pointerId);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
    };
  }
}
