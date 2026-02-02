/**
 * LeafTextureEditor - Extract and arrange individual leaves into tileable PBR textures
 * 
 * Features:
 * - Load leaf atlas textures (Color, Opacity, Normal, Roughness, etc.)
 * - Auto-detect individual leaves from opacity map
 * - Select and arrange leaves with transforms
 * - Apply identical transforms to all PBR layers
 * - Export tileable texture sets
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { detectLeaves, hasAlphaChannel } from './leafDetection';
import { extractLeafRegion, drawPlacedLeaf, downloadCanvas } from './canvasUtils';
import { SourceBrowser } from './SourceBrowser';
import type { LeafBounds, PlacedLeaf, LoadedAtlas, LayerType, TextureLayer } from './types';
import { LAYER_PATTERNS, REQUIRED_LAYERS, OPTIONAL_LAYERS } from './types';

// Output canvas size
const OUTPUT_SIZE = 1024;
const PREVIEW_SCALE = 0.5;

export function LeafTextureEditor() {
  // Source atlas state
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [atlas, setAtlas] = useState<LoadedAtlas | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSourceBrowser, setShowSourceBrowser] = useState(false);
  
  // Detection state
  const [detectedLeaves, setDetectedLeaves] = useState<LeafBounds[]>([]);
  const [selectedLeafIds, setSelectedLeafIds] = useState<Set<number>>(new Set());
  const [threshold, setThreshold] = useState(128);
  const [minArea, setMinArea] = useState(500);
  const [opacitySource, setOpacitySource] = useState<string>('');
  
  // Extracted leaf canvases (sourceId -> layerType -> canvas)
  const [extractedLeaves, setExtractedLeaves] = useState<Map<number, Map<LayerType, HTMLCanvasElement>>>(new Map());
  
  // Placed leaves in output
  const [placedLeaves, setPlacedLeaves] = useState<PlacedLeaf[]>([]);
  const [selectedPlacedId, setSelectedPlacedId] = useState<string | null>(null);
  
  // View state
  const [activeLayer, setActiveLayer] = useState<LayerType>('Color');
  const [showBounds, setShowBounds] = useState(true);
  const [showCombined, setShowCombined] = useState(true); // Show Color+Opacity combined
  
  // Export state
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFolderName, setExportFolderName] = useState('');
  const [exporting, setExporting] = useState(false);
  
  // Canvas refs
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);

  // Auto-extract all leaves and add them to output
  const autoAddAllLeaves = useCallback((loadedAtlas: LoadedAtlas, leaves: LeafBounds[]) => {
    // Extract all leaves for all layers
    const newExtracted = new Map<number, Map<LayerType, HTMLCanvasElement>>();
    
    for (const leaf of leaves) {
      const layerCanvases = new Map<LayerType, HTMLCanvasElement>();
      
      for (const [layerType, layer] of loadedAtlas.layers) {
        if (!layer.image) continue;
        const extracted = extractLeafRegion(layer.image, leaf);
        layerCanvases.set(layerType, extracted);
      }
      
      newExtracted.set(leaf.id, layerCanvases);
    }
    
    setExtractedLeaves(newExtracted);
    
    // Place all leaves in a grid pattern
    const newPlaced: PlacedLeaf[] = [];
    const cols = Math.ceil(Math.sqrt(leaves.length));
    const spacing = OUTPUT_SIZE / (cols + 1);
    
    leaves.forEach((leaf, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      
      newPlaced.push({
        id: `leaf_${Date.now()}_${index}`,
        sourceId: leaf.id,
        x: spacing * (col + 1),
        y: spacing * (row + 1),
        rotation: 0,
        scale: 1,
        flipX: false,
        flipY: false,
      });
    });
    
    setPlacedLeaves(newPlaced);
  }, []);

  // Handle loading from source browser
  const handleLoadFromSources = useCallback(async (folderName: string, files: { name: string; url: string }[]) => {
    setShowSourceBrowser(false);
    setLoading(true);
    setError(null);
    
    try {
      const loadedAtlas = await loadAtlasFromUrls(folderName, files);
      setAtlas(loadedAtlas);
      
      // Auto-detect leaves from opacity layer or color alpha
      const opacityData = getOpacityData(loadedAtlas);
      if (opacityData) {
        const { imageData, useAlpha, source } = opacityData;
        setOpacitySource(source);
        const leaves = detectLeaves(imageData, threshold, minArea, useAlpha);
        setDetectedLeaves(leaves);
        
        // Auto-select all leaves and add to output
        if (leaves.length > 0) {
          autoAddAllLeaves(loadedAtlas, leaves);
        }
      } else {
        setOpacitySource('none');
        setDetectedLeaves([]);
        setError('No opacity data found. Need an Opacity layer or Color with alpha channel.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load textures');
    } finally {
      setLoading(false);
    }
  }, [threshold, minArea, autoAddAllLeaves]);

  // Handle file drop/selection
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(f => 
      f.type.startsWith('image/') || f.name.match(/\.(png|jpg|jpeg|webp)$/i)
    );
    
    if (fileArray.length === 0) {
      setError('No valid image files found');
      return;
    }
    
    setSourceFiles(fileArray);
    setLoading(true);
    setError(null);
    
    try {
      const loadedAtlas = await loadAtlasFromFiles(fileArray);
      setAtlas(loadedAtlas);
      
      // Auto-detect leaves from opacity layer or color alpha
      const opacityData = getOpacityData(loadedAtlas);
      if (opacityData) {
        const { imageData, useAlpha, source } = opacityData;
        setOpacitySource(source);
        const leaves = detectLeaves(imageData, threshold, minArea, useAlpha);
        setDetectedLeaves(leaves);
        
        // Auto-select all leaves and add to output
        if (leaves.length > 0) {
          autoAddAllLeaves(loadedAtlas, leaves);
        }
      } else {
        setOpacitySource('none');
        setDetectedLeaves([]);
        setError('No opacity data found. Need an Opacity layer or Color with alpha channel.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load textures');
    } finally {
      setLoading(false);
    }
  }, [threshold, minArea, autoAddAllLeaves]);

  // Re-detect leaves when threshold/minArea changes
  useEffect(() => {
    if (!atlas) return;
    const opacityData = getOpacityData(atlas);
    if (opacityData) {
      const { imageData, useAlpha, source } = opacityData;
      setOpacitySource(source);
      const leaves = detectLeaves(imageData, threshold, minArea, useAlpha);
      setDetectedLeaves(leaves);
    } else {
      setOpacitySource('none');
      setDetectedLeaves([]);
    }
  }, [atlas, threshold, minArea]);

  // Render source canvas with detected bounds overlay
  useEffect(() => {
    if (!atlas || !sourceCanvasRef.current) return;
    
    const canvas = sourceCanvasRef.current;
    const ctx = canvas.getContext('2d')!;
    
    const colorLayer = atlas.layers.get('Color');
    const opacityLayer = atlas.layers.get('Opacity');
    const layer = atlas.layers.get(activeLayer);
    
    // For combined view, we need Color layer at minimum
    if (showCombined && !colorLayer?.image) return;
    if (!showCombined && !layer?.image) return;
    
    canvas.width = atlas.width * PREVIEW_SCALE;
    canvas.height = atlas.height * PREVIEW_SCALE;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (showCombined && colorLayer?.image) {
      // Draw combined Color + Opacity view
      // First draw color to a temp canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = atlas.width;
      tempCanvas.height = atlas.height;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.drawImage(colorLayer.image, 0, 0);
      
      // Apply opacity as alpha channel
      if (opacityLayer?.image) {
        const opacityCanvas = document.createElement('canvas');
        opacityCanvas.width = atlas.width;
        opacityCanvas.height = atlas.height;
        const opacityCtx = opacityCanvas.getContext('2d')!;
        opacityCtx.drawImage(opacityLayer.image, 0, 0);
        const opacityData = opacityCtx.getImageData(0, 0, atlas.width, atlas.height);
        
        const colorData = tempCtx.getImageData(0, 0, atlas.width, atlas.height);
        for (let i = 0; i < colorData.data.length; i += 4) {
          // Use red channel of opacity image as alpha
          colorData.data[i + 3] = opacityData.data[i];
        }
        tempCtx.putImageData(colorData, 0, 0);
      }
      
      // Draw checkerboard background for transparency
      const checkerSize = 8;
      for (let y = 0; y < canvas.height; y += checkerSize) {
        for (let x = 0; x < canvas.width; x += checkerSize) {
          ctx.fillStyle = ((x + y) / checkerSize) % 2 === 0 ? '#444' : '#666';
          ctx.fillRect(x, y, checkerSize, checkerSize);
        }
      }
      
      ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
    } else if (layer?.image) {
      ctx.drawImage(layer.image, 0, 0, canvas.width, canvas.height);
    }
    
    // Draw detected leaf bounds
    if (showBounds) {
      for (const leaf of detectedLeaves) {
        const isSelected = selectedLeafIds.has(leaf.id);
        
        ctx.strokeStyle = isSelected ? '#00ff00' : '#ffff00';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(
          leaf.x * PREVIEW_SCALE,
          leaf.y * PREVIEW_SCALE,
          leaf.width * PREVIEW_SCALE,
          leaf.height * PREVIEW_SCALE
        );
        
        // Draw leaf ID
        ctx.fillStyle = isSelected ? '#00ff00' : '#ffff00';
        ctx.font = '12px monospace';
        ctx.fillText(
          `#${leaf.id}`,
          leaf.x * PREVIEW_SCALE + 2,
          leaf.y * PREVIEW_SCALE + 12
        );
      }
    }
  }, [atlas, activeLayer, detectedLeaves, selectedLeafIds, showBounds, showCombined]);

  // Render output canvas
  useEffect(() => {
    if (!outputCanvasRef.current) return;
    
    const canvas = outputCanvasRef.current;
    const ctx = canvas.getContext('2d')!;
    
    canvas.width = OUTPUT_SIZE * PREVIEW_SCALE;
    canvas.height = OUTPUT_SIZE * PREVIEW_SCALE;
    
    // Clear with checkerboard for transparency
    drawCheckerboard(ctx, canvas.width, canvas.height);
    
    // Draw placed leaves
    ctx.save();
    ctx.scale(PREVIEW_SCALE, PREVIEW_SCALE);
    
    for (const placed of placedLeaves) {
      const bounds = detectedLeaves.find(b => b.id === placed.sourceId);
      if (!bounds) continue;
      
      const leafLayers = extractedLeaves.get(placed.sourceId);
      if (!leafLayers) continue;
      
      // For combined view, composite Color + Opacity
      let leafCanvas: HTMLCanvasElement | undefined;
      
      if (showCombined) {
        const colorCanvas = leafLayers.get('Color');
        const opacityCanvas = leafLayers.get('Opacity');
        
        if (colorCanvas) {
          // Create composited canvas
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = colorCanvas.width;
          tempCanvas.height = colorCanvas.height;
          const tempCtx = tempCanvas.getContext('2d')!;
          tempCtx.drawImage(colorCanvas, 0, 0);
          
          if (opacityCanvas) {
            const colorData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            const opacityCtx = opacityCanvas.getContext('2d')!;
            const opacityData = opacityCtx.getImageData(0, 0, opacityCanvas.width, opacityCanvas.height);
            
            for (let i = 0; i < colorData.data.length; i += 4) {
              // Use red channel of opacity as alpha, multiply with existing alpha
              colorData.data[i + 3] = Math.round((colorData.data[i + 3] * opacityData.data[i]) / 255);
            }
            tempCtx.putImageData(colorData, 0, 0);
          }
          
          leafCanvas = tempCanvas;
        }
      } else {
        leafCanvas = leafLayers.get(activeLayer);
      }
      
      if (!leafCanvas) continue;
      
      // Highlight selected
      if (placed.id === selectedPlacedId) {
        ctx.save();
        ctx.translate(placed.x, placed.y);
        ctx.rotate((placed.rotation * Math.PI) / 180);
        ctx.scale(placed.scale, placed.scale);
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 3 / placed.scale;
        ctx.strokeRect(
          -leafCanvas.width / 2 - 2,
          -leafCanvas.height / 2 - 2,
          leafCanvas.width + 4,
          leafCanvas.height + 4
        );
        ctx.restore();
      }
      
      drawPlacedLeaf(ctx, leafCanvas, placed, bounds);
    }
    
    ctx.restore();
  }, [placedLeaves, extractedLeaves, activeLayer, selectedPlacedId, detectedLeaves, showCombined]);

  // Click on source canvas to select/deselect leaves
  const handleSourceClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!atlas) return;
    
    const canvas = sourceCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / PREVIEW_SCALE;
    const y = (e.clientY - rect.top) / PREVIEW_SCALE;
    
    // Find clicked leaf
    for (const leaf of detectedLeaves) {
      if (x >= leaf.x && x <= leaf.x + leaf.width &&
          y >= leaf.y && y <= leaf.y + leaf.height) {
        
        setSelectedLeafIds(prev => {
          const next = new Set(prev);
          if (next.has(leaf.id)) {
            next.delete(leaf.id);
          } else {
            next.add(leaf.id);
          }
          return next;
        });
        break;
      }
    }
  }, [atlas, detectedLeaves]);

  // Click on output canvas to select placed leaf
  const handleOutputClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = outputCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / PREVIEW_SCALE;
    const y = (e.clientY - rect.top) / PREVIEW_SCALE;
    
    // Find clicked placed leaf (reverse order for top-most)
    for (let i = placedLeaves.length - 1; i >= 0; i--) {
      const placed = placedLeaves[i];
      const leafLayers = extractedLeaves.get(placed.sourceId);
      if (!leafLayers) continue;
      
      const leafCanvas = leafLayers.get('Color');
      if (!leafCanvas) continue;
      
      // Simple AABB check (could be improved with rotation)
      const halfW = (leafCanvas.width * placed.scale) / 2;
      const halfH = (leafCanvas.height * placed.scale) / 2;
      
      if (x >= placed.x - halfW && x <= placed.x + halfW &&
          y >= placed.y - halfH && y <= placed.y + halfH) {
        setSelectedPlacedId(placed.id);
        return;
      }
    }
    
    setSelectedPlacedId(null);
  }, [placedLeaves, extractedLeaves]);

  // Extract selected leaves and create canvases
  const extractSelectedLeaves = useCallback(() => {
    if (!atlas) return;
    
    const newExtracted = new Map(extractedLeaves);
    
    for (const leafId of selectedLeafIds) {
      if (newExtracted.has(leafId)) continue;
      
      const bounds = detectedLeaves.find(b => b.id === leafId);
      if (!bounds) continue;
      
      const leafLayers = new Map<LayerType, HTMLCanvasElement>();
      
      for (const [layerType, layer] of atlas.layers) {
        if (!layer.image) continue;
        
        // Create source canvas from layer image
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = atlas.width;
        srcCanvas.height = atlas.height;
        const srcCtx = srcCanvas.getContext('2d')!;
        srcCtx.drawImage(layer.image, 0, 0);
        
        // Extract leaf region
        const leafCanvas = extractLeafRegion(srcCanvas, bounds, 4);
        leafLayers.set(layerType, leafCanvas);
      }
      
      newExtracted.set(leafId, leafLayers);
    }
    
    setExtractedLeaves(newExtracted);
  }, [atlas, selectedLeafIds, detectedLeaves, extractedLeaves]);

  // Add extracted leaves to output canvas
  const addLeavesToOutput = useCallback(() => {
    extractSelectedLeaves();
    
    const newPlaced: PlacedLeaf[] = [];
    let index = 0;
    
    for (const leafId of selectedLeafIds) {
      const bounds = detectedLeaves.find(b => b.id === leafId);
      if (!bounds) continue;
      
      // Place in a grid pattern initially
      const cols = Math.ceil(Math.sqrt(selectedLeafIds.size));
      const spacing = OUTPUT_SIZE / (cols + 1);
      const col = index % cols;
      const row = Math.floor(index / cols);
      
      newPlaced.push({
        id: `leaf_${Date.now()}_${index}`,
        sourceId: leafId,
        x: spacing * (col + 1),
        y: spacing * (row + 1),
        rotation: 0,
        scale: 1,
        flipX: false,
        flipY: false,
      });
      
      index++;
    }
    
    setPlacedLeaves(prev => [...prev, ...newPlaced]);
    setSelectedLeafIds(new Set());
  }, [selectedLeafIds, detectedLeaves, extractSelectedLeaves]);

  // Update selected placed leaf
  const updateSelectedLeaf = useCallback((updates: Partial<PlacedLeaf>) => {
    if (!selectedPlacedId) return;
    
    setPlacedLeaves(prev => prev.map(leaf => 
      leaf.id === selectedPlacedId ? { ...leaf, ...updates } : leaf
    ));
  }, [selectedPlacedId]);

  // Delete selected placed leaf
  const deleteSelectedLeaf = useCallback(() => {
    if (!selectedPlacedId) return;
    setPlacedLeaves(prev => prev.filter(leaf => leaf.id !== selectedPlacedId));
    setSelectedPlacedId(null);
  }, [selectedPlacedId]);

  // Duplicate selected leaf
  const duplicateSelectedLeaf = useCallback(() => {
    if (!selectedPlacedId) return;
    
    const original = placedLeaves.find(l => l.id === selectedPlacedId);
    if (!original) return;
    
    const newLeaf: PlacedLeaf = {
      ...original,
      id: `leaf_${Date.now()}`,
      x: original.x + 50,
      y: original.y + 50,
    };
    
    setPlacedLeaves(prev => [...prev, newLeaf]);
    setSelectedPlacedId(newLeaf.id);
  }, [selectedPlacedId, placedLeaves]);

  // Open export dialog
  const openExportDialog = useCallback(() => {
    if (!atlas || placedLeaves.length === 0) return;
    // Default folder name based on source
    setExportFolderName(atlas.baseName ? `${atlas.baseName}_tileable` : 'leaves_tileable');
    setShowExportDialog(true);
  }, [atlas, placedLeaves]);

  // Generate export canvases for all layers
  const generateExportCanvases = useCallback((): Map<LayerType, HTMLCanvasElement> => {
    const canvases = new Map<LayerType, HTMLCanvasElement>();
    if (!atlas) return canvases;
    
    for (const [layerType] of atlas.layers) {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d')!;
      
      // Set background based on layer type
      if (layerType === 'NormalGL' || layerType === 'NormalDX') {
        ctx.fillStyle = 'rgb(128, 128, 255)';
        ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      }
      
      // Draw all placed leaves
      for (const placed of placedLeaves) {
        const leafLayers = extractedLeaves.get(placed.sourceId);
        if (!leafLayers) continue;
        
        const leafCanvas = leafLayers.get(layerType);
        if (!leafCanvas) continue;
        
        const bounds = detectedLeaves.find(b => b.id === placed.sourceId);
        if (!bounds) continue;
        
        drawPlacedLeaf(ctx, leafCanvas, placed, bounds);
      }
      
      canvases.set(layerType, canvas);
    }
    
    return canvases;
  }, [atlas, placedLeaves, extractedLeaves, detectedLeaves]);

  // Export all layers to downloads
  const exportToDownloads = useCallback(() => {
    if (!atlas) return;
    const baseName = exportFolderName || atlas.baseName || 'leaves_tileable';
    const canvases = generateExportCanvases();
    
    for (const [layerType, canvas] of canvases) {
      downloadCanvas(canvas, `${baseName}_${layerType}.png`);
    }
    setShowExportDialog(false);
  }, [atlas, exportFolderName, generateExportCanvases]);

  // Export all layers to sources folder
  const exportToSources = useCallback(async () => {
    if (!atlas || !exportFolderName.trim()) return;
    
    setExporting(true);
    const canvases = generateExportCanvases();
    const folderName = exportFolderName.trim();
    
    try {
      for (const [layerType, canvas] of canvases) {
        const dataUrl = canvas.toDataURL('image/png');
        const fileName = `${folderName}_${layerType}.png`;
        
        const response = await fetch('/api/save-texture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderName, fileName, dataUrl }),
        });
        
        if (!response.ok) {
          throw new Error(`Failed to save ${fileName}`);
        }
      }
      
      setShowExportDialog(false);
      setError(null);
      // Show success briefly
      alert(`Saved ${canvases.size} textures to sources/${folderName}/`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save textures');
    } finally {
      setExporting(false);
    }
  }, [atlas, exportFolderName, generateExportCanvases]);

  // Get selected placed leaf for editing
  const selectedLeaf = placedLeaves.find(l => l.id === selectedPlacedId);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center gap-4">
        <Link to="/" className="text-gray-400 hover:text-white">← Back</Link>
        <h1 className="text-xl font-bold">Leaf Texture Editor</h1>
      </header>

      <div className="flex h-[calc(100vh-64px)]">
        {/* Left panel - Source */}
        <div className="w-1/2 border-r border-gray-700 flex flex-col">
          <div className="p-4 border-b border-gray-700 bg-gray-800">
            <h2 className="font-semibold mb-2">Source Atlas</h2>
            
            {/* File drop zone */}
            <div 
              className="border-2 border-dashed border-gray-600 rounded-lg p-4 text-center hover:border-blue-500 cursor-pointer transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.accept = 'image/*';
                input.onchange = () => input.files && handleFiles(input.files);
                input.click();
              }}
            >
              {loading ? (
                <p className="text-gray-400">Loading...</p>
              ) : atlas ? (
                <div>
                  <p className="text-green-400 font-medium">{atlas.baseName}</p>
                  <p className="text-gray-400 text-sm mt-1">
                    {atlas.width}×{atlas.height} • {atlas.layers.size} layers
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2 justify-center">
                    {Array.from(atlas.layers.keys()).map(layer => (
                      <span 
                        key={layer}
                        className={`px-2 py-0.5 rounded text-xs ${
                          layer === 'Color' ? 'bg-green-700' :
                          layer === 'Opacity' ? 'bg-yellow-700' :
                          layer === 'NormalGL' || layer === 'NormalDX' ? 'bg-blue-700' :
                          layer === 'Roughness' ? 'bg-purple-700' :
                          'bg-gray-600'
                        }`}
                      >
                        {layer}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-gray-400">Drop texture files here or click to browse</p>
              )}
            </div>
            
            {/* Browse sources button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowSourceBrowser(true);
              }}
              className="mt-2 w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              📁 Browse Sources Folder
            </button>

            {error && <p className="text-red-400 mt-2">{error}</p>}

            {/* Detection controls */}
            {atlas && (
              <div className="mt-4 space-y-2">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">Threshold:</span>
                    <input 
                      type="range" 
                      min="1" 
                      max="255" 
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="w-24"
                    />
                    <span className="text-sm w-8">{threshold}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">Min Area:</span>
                    <input 
                      type="range" 
                      min="10" 
                      max="5000" 
                      value={minArea}
                      onChange={(e) => setMinArea(Number(e.target.value))}
                      className="w-24"
                    />
                    <span className="text-sm w-12">{minArea}</span>
                  </label>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <label className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      checked={showBounds}
                      onChange={(e) => setShowBounds(e.target.checked)}
                    />
                    <span className="text-sm">Show bounds</span>
                  </label>
                  <span className="text-gray-500">|</span>
                  <span className="text-sm text-gray-400">
                    Detected: {detectedLeaves.length} leaves | Selected: {selectedLeafIds.size}
                  </span>
                  {opacitySource && (
                    <>
                      <span className="text-gray-500">|</span>
                      <span className="text-sm text-yellow-400">
                        Using: {opacitySource}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Source canvas */}
          <div className="flex-1 overflow-auto p-4 bg-gray-950">
            <canvas 
              ref={sourceCanvasRef}
              onClick={handleSourceClick}
              className="cursor-crosshair border border-gray-700 max-w-full"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>

          {/* Layer tabs */}
          {atlas && (
            <div className="p-2 bg-gray-800 border-t border-gray-700 flex gap-1 items-center">
              {Array.from(atlas.layers.keys()).map(layer => (
                <button
                  key={layer}
                  onClick={() => setActiveLayer(layer)}
                  className={`px-3 py-1 rounded text-sm ${
                    activeLayer === layer && !showCombined
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {layer}
                </button>
              ))}
              <div className="w-px h-6 bg-gray-600 mx-1" />
              <button
                onClick={() => setShowCombined(!showCombined)}
                className={`px-3 py-1 rounded text-sm ${
                  showCombined 
                    ? 'bg-purple-600 text-white' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                title="Show Color with Opacity as transparency"
              >
                Combined
              </button>
            </div>
          )}
        </div>

        {/* Right panel - Output */}
        <div className="w-1/2 flex flex-col">
          <div className="p-4 border-b border-gray-700 bg-gray-800">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Output ({OUTPUT_SIZE}×{OUTPUT_SIZE})</h2>
              {atlas && (
                <div className="flex gap-1">
                  {Array.from(atlas.layers.keys()).map(layer => (
                    <span 
                      key={layer}
                      className={`px-2 py-0.5 rounded text-xs ${
                        layer === 'Color' ? 'bg-green-700' :
                        layer === 'Opacity' ? 'bg-yellow-700' :
                        layer === 'NormalGL' || layer === 'NormalDX' ? 'bg-blue-700' :
                        layer === 'Roughness' ? 'bg-purple-700' :
                        'bg-gray-600'
                      }`}
                    >
                      {layer}
                    </span>
                  ))}
                </div>
              )}
            </div>
            
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={addLeavesToOutput}
                disabled={selectedLeafIds.size === 0}
                className="px-3 py-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm"
              >
                Add Selected ({selectedLeafIds.size})
              </button>
              <button
                onClick={duplicateSelectedLeaf}
                disabled={!selectedPlacedId}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm"
              >
                Duplicate
              </button>
              <button
                onClick={deleteSelectedLeaf}
                disabled={!selectedPlacedId}
                className="px-3 py-1 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm"
              >
                Delete
              </button>
              <button
                onClick={() => setPlacedLeaves([])}
                disabled={placedLeaves.length === 0}
                className="px-3 py-1 bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded text-sm"
              >
                Clear All
              </button>
              <button
                onClick={openExportDialog}
                disabled={placedLeaves.length === 0}
                className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm"
              >
                Export All Layers
              </button>
            </div>
          </div>

          {/* Transform controls for selected leaf */}
          {selectedLeaf && (
            <div className="p-4 border-b border-gray-700 bg-gray-800 space-y-2">
              <h3 className="text-sm font-semibold text-gray-300">Transform (Leaf #{selectedLeaf.sourceId})</h3>
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2">
                  <span className="text-sm text-gray-400 w-16">X:</span>
                  <input 
                    type="number" 
                    value={Math.round(selectedLeaf.x)}
                    onChange={(e) => updateSelectedLeaf({ x: Number(e.target.value) })}
                    className="w-20 px-2 py-1 bg-gray-700 rounded text-sm"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-sm text-gray-400 w-16">Y:</span>
                  <input 
                    type="number" 
                    value={Math.round(selectedLeaf.y)}
                    onChange={(e) => updateSelectedLeaf({ y: Number(e.target.value) })}
                    className="w-20 px-2 py-1 bg-gray-700 rounded text-sm"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-sm text-gray-400 w-16">Rotation:</span>
                  <input 
                    type="range" 
                    min="0" 
                    max="360" 
                    value={selectedLeaf.rotation}
                    onChange={(e) => updateSelectedLeaf({ rotation: Number(e.target.value) })}
                    className="w-20"
                  />
                  <span className="text-sm w-10">{selectedLeaf.rotation}°</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-sm text-gray-400 w-16">Scale:</span>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="3" 
                    step="0.1"
                    value={selectedLeaf.scale}
                    onChange={(e) => updateSelectedLeaf({ scale: Number(e.target.value) })}
                    className="w-20"
                  />
                  <span className="text-sm w-10">{selectedLeaf.scale.toFixed(1)}x</span>
                </label>
                <label className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    checked={selectedLeaf.flipX}
                    onChange={(e) => updateSelectedLeaf({ flipX: e.target.checked })}
                  />
                  <span className="text-sm">Flip X</span>
                </label>
                <label className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    checked={selectedLeaf.flipY}
                    onChange={(e) => updateSelectedLeaf({ flipY: e.target.checked })}
                  />
                  <span className="text-sm">Flip Y</span>
                </label>
              </div>
            </div>
          )}

          {/* Output canvas */}
          <div className="flex-1 overflow-auto p-4 bg-gray-950">
            <canvas 
              ref={outputCanvasRef}
              onClick={handleOutputClick}
              className="cursor-pointer border border-gray-700"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>

          {/* Placed leaves list */}
          {placedLeaves.length > 0 && (
            <div className="p-2 bg-gray-800 border-t border-gray-700">
              <div className="flex gap-1 flex-wrap">
                {placedLeaves.map(leaf => (
                  <button
                    key={leaf.id}
                    onClick={() => setSelectedPlacedId(leaf.id)}
                    className={`px-2 py-1 rounded text-xs ${
                      selectedPlacedId === leaf.id 
                        ? 'bg-cyan-600 text-white' 
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    #{leaf.sourceId}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Source browser modal */}
      {showSourceBrowser && (
        <SourceBrowser
          onLoadFolder={handleLoadFromSources}
          onClose={() => setShowSourceBrowser(false)}
        />
      )}
      
      {/* Export dialog modal */}
      {showExportDialog && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg w-[450px] p-6">
            <h2 className="text-lg font-semibold mb-4">Export Textures</h2>
            
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Folder Name</label>
              <input
                type="text"
                value={exportFolderName}
                onChange={(e) => setExportFolderName(e.target.value)}
                placeholder="e.g., leaves_green_tileable"
                className="w-full px-3 py-2 bg-gray-700 rounded text-white"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                Will create: sources/{exportFolderName || '...'}/
              </p>
            </div>
            
            {atlas && (
              <div className="mb-4 p-3 bg-gray-700 rounded">
                <p className="text-sm text-gray-300 mb-2">Layers to export:</p>
                <div className="flex flex-wrap gap-1">
                  {Array.from(atlas.layers.keys()).map(layer => (
                    <span 
                      key={layer}
                      className={`px-2 py-0.5 rounded text-xs ${
                        layer === 'Color' ? 'bg-green-700' :
                        layer === 'Opacity' ? 'bg-yellow-700' :
                        layer === 'NormalGL' || layer === 'NormalDX' ? 'bg-blue-700' :
                        layer === 'Roughness' ? 'bg-purple-700' :
                        'bg-gray-600'
                      }`}
                    >
                      {exportFolderName}_{layer}.png
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowExportDialog(false)}
                disabled={exporting}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
              >
                Cancel
              </button>
              <button
                onClick={exportToDownloads}
                disabled={exporting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded"
              >
                Download
              </button>
              <button
                onClick={exportToSources}
                disabled={exporting || !exportFolderName.trim()}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded"
              >
                {exporting ? 'Saving...' : 'Save to Sources'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Get opacity data from atlas - prefers separate Opacity layer,
 * falls back to Color layer's alpha channel
 */
function getOpacityData(atlas: LoadedAtlas): { imageData: ImageData; useAlpha: boolean; source: string } | null {
  // First, try dedicated Opacity layer (grayscale image)
  const opacityLayer = atlas.layers.get('Opacity');
  if (opacityLayer?.imageData) {
    // Separate opacity files are grayscale, so R channel = opacity value
    return { imageData: opacityLayer.imageData, useAlpha: false, source: 'Opacity layer (grayscale)' };
  }
  
  // Fall back to Color layer's alpha channel
  const colorLayer = atlas.layers.get('Color');
  if (colorLayer?.imageData && hasAlphaChannel(colorLayer.imageData)) {
    return { imageData: colorLayer.imageData, useAlpha: true, source: 'Color alpha channel' };
  }
  
  return null;
}

/**
 * Load texture atlas from dropped files
 */
async function loadAtlasFromFiles(files: File[]): Promise<LoadedAtlas> {
  // Group files by base name and detect layer types
  const layers = new Map<LayerType, TextureLayer>();
  let baseName = '';
  let width = 0;
  let height = 0;
  
  for (const file of files) {
    const { name, layerType } = parseFileName(file.name);
    if (!baseName) baseName = name;
    if (!layerType) continue;
    
    const image = await loadImage(file);
    width = Math.max(width, image.width);
    height = Math.max(height, image.height);
    
    // Get image data
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    
    layers.set(layerType, {
      name: layerType,
      image,
      imageData,
    });
  }
  
  // No need to create fake Opacity layer - getOpacityData handles fallback
  if (layers.size === 0) {
    throw new Error('No valid texture layers found. Check filename patterns (e.g., _Color, _Opacity, _NormalGL)');
  }
  
  return { baseName, layers, width, height };
}

/**
 * Load texture atlas from URLs (source browser)
 */
async function loadAtlasFromUrls(
  folderName: string,
  files: { name: string; url: string }[]
): Promise<LoadedAtlas> {
  const layers = new Map<LayerType, TextureLayer>();
  let baseName = folderName;
  let width = 0;
  let height = 0;
  
  for (const file of files) {
    const { name, layerType } = parseFileName(file.name);
    if (!baseName) baseName = name;
    if (!layerType) continue;
    
    const image = await loadImageFromUrl(file.url);
    width = Math.max(width, image.width);
    height = Math.max(height, image.height);
    
    // Get image data
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    
    layers.set(layerType, {
      name: layerType,
      image,
      imageData,
    });
  }
  
  // No need to create fake Opacity layer - getOpacityData handles fallback
  if (layers.size === 0) {
    throw new Error('No valid texture layers found. Check filename patterns (e.g., _Color, _Opacity, _NormalGL)');
  }
  
  return { baseName, layers, width, height };
}

/**
 * Parse file name to extract base name and layer type
 */
function parseFileName(filename: string): { name: string; layerType: LayerType | null } {
  // Remove extension
  const base = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '');
  
  // Try to match layer patterns
  for (const [layerType, patterns] of Object.entries(LAYER_PATTERNS)) {
    for (const pattern of patterns) {
      // Match pattern at end of filename (e.g., "LeafSet024_1K-JPG_Color")
      const regex = new RegExp(`[_-]${pattern}$`, 'i');
      if (regex.test(base)) {
        const name = base.replace(regex, '');
        return { name, layerType: layerType as LayerType };
      }
    }
  }
  
  return { name: base, layerType: null };
}

/**
 * Load an image from a File
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Load an image from a URL
 */
function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Draw checkerboard pattern for transparency
 */
function drawCheckerboard(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const size = 8;
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      ctx.fillStyle = ((x + y) / size) % 2 === 0 ? '#333' : '#444';
      ctx.fillRect(x, y, size, size);
    }
  }
}
