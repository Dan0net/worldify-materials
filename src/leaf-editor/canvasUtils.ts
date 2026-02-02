/**
 * Canvas rendering utilities for leaf texture editing
 */

import type { LeafBounds, PlacedLeaf, LoadedAtlas, LayerType } from './types';

/**
 * Extract a leaf region from a source layer
 */
export function extractLeafRegion(
  sourceCanvas: HTMLCanvasElement,
  bounds: LeafBounds,
  padding: number = 2
): HTMLCanvasElement {
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const w = Math.min(bounds.width + padding * 2, sourceCanvas.width - x);
  const h = Math.min(bounds.height + padding * 2, sourceCanvas.height - y);
  
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  
  ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, w, h);
  
  return canvas;
}

/**
 * Draw a placed leaf onto a destination canvas with transforms
 */
export function drawPlacedLeaf(
  ctx: CanvasRenderingContext2D,
  leafCanvas: HTMLCanvasElement,
  placed: PlacedLeaf,
  bounds: LeafBounds
): void {
  ctx.save();
  
  // Move to placement position (center of leaf)
  ctx.translate(placed.x, placed.y);
  
  // Apply rotation
  ctx.rotate((placed.rotation * Math.PI) / 180);
  
  // Apply scale and flip
  ctx.scale(
    placed.scale * (placed.flipX ? -1 : 1),
    placed.scale * (placed.flipY ? -1 : 1)
  );
  
  // Draw centered
  ctx.drawImage(
    leafCanvas,
    -leafCanvas.width / 2,
    -leafCanvas.height / 2
  );
  
  ctx.restore();
}

/**
 * Render all placed leaves to an output canvas
 */
export function renderOutput(
  atlas: LoadedAtlas,
  placedLeaves: PlacedLeaf[],
  leafBounds: LeafBounds[],
  extractedLeaves: Map<number, Map<LayerType, HTMLCanvasElement>>,
  outputSize: number,
  layerType: LayerType
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d')!;
  
  // Clear with appropriate background
  if (layerType === 'NormalGL' || layerType === 'NormalDX') {
    // Neutral normal (pointing up)
    ctx.fillStyle = 'rgb(128, 128, 255)';
  } else if (layerType === 'Opacity') {
    // Transparent
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  } else {
    // Black for color, roughness, etc
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  }
  ctx.fillRect(0, 0, outputSize, outputSize);
  
  // Draw each placed leaf
  for (const placed of placedLeaves) {
    const bounds = leafBounds.find(b => b.id === placed.sourceId);
    if (!bounds) continue;
    
    const leafLayers = extractedLeaves.get(placed.sourceId);
    if (!leafLayers) continue;
    
    const leafCanvas = leafLayers.get(layerType);
    if (!leafCanvas) continue;
    
    drawPlacedLeaf(ctx, leafCanvas, placed, bounds);
  }
  
  return canvas;
}

/**
 * Make a canvas tileable by wrapping edges
 * This duplicates content that would wrap around the edges
 */
export function makeTileable(
  canvas: HTMLCanvasElement,
  wrapSize: number = 64
): HTMLCanvasElement {
  const { width, height } = canvas;
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const ctx = output.getContext('2d')!;
  
  // Draw main content
  ctx.drawImage(canvas, 0, 0);
  
  // Draw wrapped edges with reduced opacity for blending
  ctx.globalAlpha = 0.5;
  
  // Top edge wraps to bottom
  ctx.drawImage(canvas, 0, 0, width, wrapSize, 0, height - wrapSize, width, wrapSize);
  // Bottom edge wraps to top
  ctx.drawImage(canvas, 0, height - wrapSize, width, wrapSize, 0, 0, width, wrapSize);
  // Left edge wraps to right
  ctx.drawImage(canvas, 0, 0, wrapSize, height, width - wrapSize, 0, wrapSize, height);
  // Right edge wraps to left  
  ctx.drawImage(canvas, width - wrapSize, 0, wrapSize, height, 0, 0, wrapSize, height);
  
  ctx.globalAlpha = 1.0;
  
  return output;
}

/**
 * Download a canvas as PNG
 */
export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/**
 * Download all layers as a ZIP (requires JSZip or similar)
 * For now, downloads individual files
 */
export function downloadAllLayers(
  layers: Map<LayerType, HTMLCanvasElement>,
  baseName: string
): void {
  for (const [layerType, canvas] of layers) {
    downloadCanvas(canvas, `${baseName}_${layerType}.png`);
  }
}
