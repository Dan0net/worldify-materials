import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

interface MapConfig {
  path?: string;
  channel?: string;
  color?: { r: number; g: number; b: number; alpha?: number };
}

interface MaterialConfig {
  type: 'solid' | 'liquid' | 'transparent';
  enabled?: boolean;
  index?: number;
  albedo?: MapConfig;
  normal?: MapConfig;
  ao?: MapConfig;
  roughness?: MapConfig;
  metalness?: MapConfig;
}

interface MaterialsConfig {
  textureSize: { low: number; high: number };
  materials: Record<string, MaterialConfig>;
}

interface MaterialInfo {
  name: string;
  config: MaterialConfig;
  hasSourceFolder: boolean;
  previewImage?: string;
}

export function PalletEditor() {
  const [materialsConfig, setMaterialsConfig] = useState<MaterialsConfig | null>(null);
  const [sourceFolders, setSourceFolders] = useState<string[]>([]);
  const [sourceFiles, setSourceFiles] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [search, setSearch] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  // Load all data
  useEffect(() => {
    async function loadData() {
      try {
        const [configRes, foldersRes] = await Promise.all([
          fetch('/api/materials-config'),
          fetch('/api/sources'),
        ]);

        const configData = await configRes.json();
        const foldersData = await foldersRes.json();

        setMaterialsConfig(configData);
        setSourceFolders(foldersData);

        // Load preview images for each folder
        const files: Record<string, string[]> = {};
        await Promise.all(
          foldersData.map(async (folder: string) => {
            const res = await fetch(`/api/sources/${folder}`);
            files[folder] = await res.json();
          })
        );
        setSourceFiles(files);
      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Compute unified material list
  const materials = useMemo<MaterialInfo[]>(() => {
    if (!materialsConfig) return [];

    return Object.entries(materialsConfig.materials)
      .map(([name, config]) => {
        const files = sourceFiles[name] || [];
        const colorFile = files.find(
          (f) => /color|albedo|diff|basecolor/i.test(f) && /\.(png|jpg|jpeg|webp)$/i.test(f)
        );

        return {
          name,
          config,
          hasSourceFolder: sourceFolders.includes(name),
          previewImage: colorFile ? `/sources/${name}/${colorFile}` : undefined,
        };
      })
      .sort((a, b) => {
        const aEnabled = a.config.enabled !== false;
        const bEnabled = b.config.enabled !== false;

        // Enabled materials come first, sorted by index
        if (aEnabled && bEnabled) {
          return (a.config.index ?? 9999) - (b.config.index ?? 9999);
        }
        if (aEnabled) return -1;
        if (bEnabled) return 1;

        // Non-enabled materials sorted alphabetically
        return a.name.localeCompare(b.name);
      });
  }, [materialsConfig, sourceFolders, sourceFiles]);

  // Filtered materials
  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      // Search filter
      if (search && !m.name.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }

      // Status filter
      const isEnabled = m.config.enabled !== false;
      switch (filter) {
        case 'enabled':
          return isEnabled;
        case 'disabled':
          return !isEnabled;
        default:
          return true;
      }
    });
  }, [materials, filter, search]);

  // Get enabled materials count and next available index
  const enabledMaterials = useMemo(() => {
    return materials.filter((m) => m.config.enabled !== false);
  }, [materials]);

  const nextIndex = useMemo(() => {
    if (enabledMaterials.length === 0) return 0;
    const maxIndex = Math.max(...enabledMaterials.map((m) => m.config.index ?? 0));
    return maxIndex + 1;
  }, [enabledMaterials]);

  // Toggle material enabled state
  const toggleMaterial = (name: string) => {
    if (!materialsConfig) return;

    const material = materialsConfig.materials[name];
    const isCurrentlyEnabled = material.enabled !== false;

    const updatedMaterial = {
      ...material,
      enabled: !isCurrentlyEnabled,
      index: !isCurrentlyEnabled ? nextIndex : undefined,
    };

    // If disabling, we need to reindex all materials after this one
    let newMaterials = { ...materialsConfig.materials, [name]: updatedMaterial };

    if (isCurrentlyEnabled) {
      // Reindex materials after the disabled one
      const disabledIndex = material.index ?? 9999;
      Object.entries(newMaterials).forEach(([matName, mat]) => {
        if (mat.enabled !== false && mat.index !== undefined && mat.index > disabledIndex) {
          newMaterials[matName] = { ...mat, index: mat.index - 1 };
        }
      });
    }

    setMaterialsConfig({ ...materialsConfig, materials: newMaterials });
    setHasChanges(true);
  };

  // Set material to specific index, swapping with existing material at that position
  const setMaterialIndex = (name: string, targetIndex: number) => {
    if (!materialsConfig) return;

    const currentMaterial = materialsConfig.materials[name];
    const currentIndex = currentMaterial.index;
    if (currentIndex === undefined || currentIndex === targetIndex) return;
    if (targetIndex < 0 || targetIndex >= enabledMaterials.length) return;

    // Find material at target index
    const targetMaterialEntry = Object.entries(materialsConfig.materials).find(
      ([_, mat]) => mat.enabled !== false && mat.index === targetIndex
    );

    const newMaterials = { ...materialsConfig.materials };

    // Swap indices
    newMaterials[name] = { ...currentMaterial, index: targetIndex };
    if (targetMaterialEntry) {
      newMaterials[targetMaterialEntry[0]] = { ...targetMaterialEntry[1], index: currentIndex };
    }

    setMaterialsConfig({ ...materialsConfig, materials: newMaterials });
    setHasChanges(true);
  };

  // Move material up/down
  const moveMaterial = (name: string, direction: 'up' | 'down') => {
    if (!materialsConfig) return;

    const material = materialsConfig.materials[name];
    const currentIndex = material.index;
    if (currentIndex === undefined) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    setMaterialIndex(name, newIndex);
  };

  // Save changes
  const saveConfig = async () => {
    if (!materialsConfig) return;

    setSaving(true);
    try {
      const res = await fetch('/api/materials-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(materialsConfig),
      });

      if (res.ok) {
        setHasChanges(false);
      } else {
        console.error('Failed to save config');
      }
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  const enabledCount = enabledMaterials.length;
  const totalCount = materials.length;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-gray-400 hover:text-white">
              ← Back
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Pallet Editor</h1>
              <p className="text-gray-400 text-sm">
                {enabledCount} enabled / {totalCount} total materials
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {hasChanges && <span className="text-yellow-400 text-sm">Unsaved changes</span>}
            <button
              onClick={saveConfig}
              disabled={saving || !hasChanges}
              className={`px-4 py-2 rounded font-medium ${
                hasChanges
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              {saving ? 'Saving...' : 'Save Config'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mt-4">
          <input
            type="text"
            placeholder="Search materials..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 w-64"
          />

          <div className="flex gap-2">
            {(['all', 'enabled', 'disabled'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-sm ${
                  filter === f
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                {f === 'enabled' && ` (${enabledCount})`}
                {f === 'disabled' && ` (${totalCount - enabledCount})`}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Material Grid */}
      <main className="p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
          {filteredMaterials.map((material) => (
            <MaterialCard
              key={material.name}
              material={material}
              maxIndex={enabledMaterials.length - 1}
              onToggle={() => toggleMaterial(material.name)}
              onMoveUp={() => moveMaterial(material.name, 'up')}
              onMoveDown={() => moveMaterial(material.name, 'down')}
              onSetIndex={(newIndex) => setMaterialIndex(material.name, newIndex)}
              canMoveUp={material.config.enabled !== false && (material.config.index ?? 0) > 0}
              canMoveDown={
                material.config.enabled !== false &&
                (material.config.index ?? 0) < enabledMaterials.length - 1
              }
            />
          ))}
        </div>

        {filteredMaterials.length === 0 && (
          <div className="text-center text-gray-500 py-12">
            No materials match the current filters.
          </div>
        )}
      </main>
    </div>
  );
}

interface MaterialCardProps {
  material: MaterialInfo;
  maxIndex: number;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSetIndex: (index: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

function MaterialCard({
  material,
  maxIndex,
  onToggle,
  onMoveUp,
  onMoveDown,
  onSetIndex,
  canMoveUp,
  canMoveDown,
}: MaterialCardProps) {
  const [isEditingIndex, setIsEditingIndex] = useState(false);
  const [editValue, setEditValue] = useState('');

  const isEnabled = material.config.enabled !== false;
  const index = material.config.index;

  const handleIndexClick = () => {
    if (index !== undefined) {
      setEditValue(String(index));
      setIsEditingIndex(true);
    }
  };

  const handleIndexSubmit = () => {
    const newIndex = parseInt(editValue, 10);
    if (!isNaN(newIndex) && newIndex >= 0 && newIndex <= maxIndex) {
      onSetIndex(newIndex);
    }
    setIsEditingIndex(false);
  };

  const handleIndexKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleIndexSubmit();
    } else if (e.key === 'Escape') {
      setIsEditingIndex(false);
    }
  };

  const typeColors = {
    solid: 'bg-gray-600',
    liquid: 'bg-blue-600',
    transparent: 'bg-green-600',
  };

  return (
    <div
      className={`relative rounded-lg overflow-hidden border-2 transition-all ${
        isEnabled
          ? 'border-blue-500 bg-gray-800'
          : 'border-gray-600 bg-gray-800/50'
      }`}
    >
      {/* Preview Image */}
      <div className="aspect-square bg-gray-700 relative">
        {material.previewImage ? (
          <img
            src={material.previewImage}
            alt={material.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">
            No preview
          </div>
        )}

        {/* Index badge - click to edit */}
        {isEnabled && index !== undefined && (
          isEditingIndex ? (
            <input
              type="number"
              min={0}
              max={maxIndex}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleIndexSubmit}
              onKeyDown={handleIndexKeyDown}
              autoFocus
              className="absolute top-1 left-1 w-12 bg-black/90 text-white text-xs px-1.5 py-0.5 rounded border border-blue-500 outline-none"
            />
          ) : (
            <button
              onClick={handleIndexClick}
              className="absolute top-1 left-1 bg-black/70 hover:bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors"
              title="Click to change index"
            >
              #{index}
            </button>
          )
        )}

        {/* Type badge */}
        <div
          className={`absolute top-1 right-1 ${typeColors[material.config.type]} text-white text-xs px-1.5 py-0.5 rounded`}
        >
          {material.config.type}
        </div>

        {/* Status indicators */}
        <div className="absolute bottom-1 left-1 flex gap-1">
          {!material.hasSourceFolder && (
            <span className="bg-red-600 text-white text-xs px-1 py-0.5 rounded" title="No source folder">
              ?
            </span>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-2">
        <div className="text-sm font-medium truncate" title={material.name}>
          {material.name}
        </div>

        <div className="flex items-center gap-1 mt-2">
          <button
            onClick={onToggle}
            className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
              isEnabled
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
          >
            {isEnabled ? 'Enabled' : 'Disabled'}
          </button>

          {isEnabled && (
            <>
              <button
                onClick={onMoveUp}
                disabled={!canMoveUp}
                className={`px-1.5 py-1 text-xs rounded ${
                  canMoveUp
                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                    : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                }`}
              >
                ↑
              </button>
              <button
                onClick={onMoveDown}
                disabled={!canMoveDown}
                className={`px-1.5 py-1 text-xs rounded ${
                  canMoveDown
                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                    : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                }`}
              >
                ↓
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
