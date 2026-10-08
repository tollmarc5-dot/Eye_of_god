import { memo, useEffect, useRef } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import { Direction } from '../office/types.js';

interface AgentAvatarProps {
  officeState: OfficeState;
  id: number;
  /** Device-independent scale of the 16×32 sprite. */
  scale?: number;
  dimmed?: boolean;
}

/** The agent's own office character (same palette and hue), facing the viewer. */
export const AgentAvatar = memo(function AgentAvatar({
  officeState,
  id,
  scale = 2,
  dimmed = false,
}: AgentAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const character = officeState.characters.get(id);
  const palette = character?.palette;
  const hueShift = character?.hueShift ?? 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (palette === undefined) return;
    const frame = getCharacterSprites(palette, hueShift).walk[Direction.DOWN][0];
    const zoom = Math.max(1, Math.round(scale * (window.devicePixelRatio || 1)));
    const sprite = getCachedSprite(frame, zoom);
    canvas.width = sprite.width;
    canvas.height = sprite.height;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, 0, 0);
  }, [palette, hueShift, scale]);

  return (
    <canvas
      ref={canvasRef}
      className={`cc-avatar${dimmed ? ' cc-avatar--dimmed' : ''}`}
      style={{ width: 16 * scale, height: 32 * scale }}
      aria-hidden="true"
    />
  );
});
