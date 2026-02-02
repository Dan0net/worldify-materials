import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

interface Pallet {
  materials: string[];
  maps: Record<string, Record<string, { width: number; height: number; channels: string; layers: number }>>;
  indicies: Record<string, number>;
  types: {
    solid: number[];
    liquid: number[];
    transparent: number[];
  };
  colors: string[];
}

interface MaterialConfig {
  type: 'solid' | 'liquid' | 'transparent';
  albedo?: { path?: string; channel?: string; color?: { r: number; g: number; b: number; alpha?: number } };
  normal?: { path?: string; channel?: string };
  ao?: { path?: string; channel?: string };
  roughness?: { path?: string; channel?: string };
  metalness?: { path?: string; channel?: string };
}

interface MaterialsConfig {
  textureSize: { low: number; high: number };
  materials: Record<string, MaterialConfig>;
}

interface MaterialInfo {
  name: string;
  inPallet: boolean;
  inConfig: boolean;
  hasSourceFolder: boolean;
  type?: 'solid' | 'liquid' | 'transparent';
  previewImage?: string;
}

export function PalletEditor() {
  const [pallet, setPallet] = useState<Pallet | null>(null);
  const [materialsConfig, setMaterialsConfig] = useState<MaterialsConfig | null>(null);
  const [sourceFolders, setSourceFolders] = useState<string[]>([]);
  const [sourceFiles, setSourceFiles] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled' | 'unconfigured'>('all');
  const [search, setSearch] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  // Load all data
  useEffect(() => {
    async function loadData() {
      try {
        const [palletRes, configRes, foldersRes] = await Promise.all([
          fetch('/api/pallet'),
          fetch('/api/materials-config'),
          fetch('/api/sources'),
        ]);

        const palletData = await palletRes.json();
        const configData = await configRes.json();
        const foldersData = await foldersRes.json();

        setPallet(palletData);
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
    if (!pallet || !materialsConfig) return [];

    const allNames = new Set<string>();

    // Add all source folders
    sourceFolders.forEach((name) => allNames.add(name));

    // Add all materials from config
    Object.keys(materialsConfig.materials).forEach((name) => allNames.add(name));

    // Add all materials from pallet
    pallet.materials.forEach((name) => allNames.add(name));

    return Array.from(allNames)
      .sort((a, b) => {
        const aInPallet = pallet.materials.includes(a);
        const bInPallet = pallet.materials.includes(b);
        
        // Enabled materials come first, sorted by index
        if (aInPallet && bInPallet) {
          return pallet.indicies[a] - pallet.indicies[b];
        }
        if (aInPallet) return -1;
        if (bInPallet) return 1;
        
        // Non-enabled materials sorted alphabetically
        return a.localeCompare(b);
      })
      .map((name) => {
        const config = materialsConfig.materials[name];
        const files = sourceFiles[name] || [];
        const colorFile = files.find(
          (f) => /color|albedo|diff|basecolor/i.test(f) && /\.(png|jpg|jpeg|webp)$/i.test(f)
        );

        return {
          name,
          inPallet: pallet.materials.includes(name),
          inConfig: !!config,
          hasSourceFolder: sourceFolders.includes(name),
          type: config?.type,
          previewImage: colorFile ? `/sources/${name}/${colorFile}` : undefined,
        };
      });
  }, [pallet, materialsConfig, sourceFolders, sourceFiles]);

  // Filtered materials
  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      // Search filter
      if (search && !m.name.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }

      // Status filter
      switch (filter) {
        case 'enabled':
          return m.inPallet;
        case 'disabled':
          return !m.inPallet && m.inConfig;
        case 'unconfigured':
          return !m.inConfig;
        default:
          return true;
      }
    });
  }, [materials, filter, search]);

  // Toggle material in pallet
  const toggleMaterial = (name: string) => {
    if (!pallet) return;

    const newMaterials = pallet.materials.includes(name)
      ? pallet.materials.filter((m) => m !== name)
      : [...pallet.materials, name];

    // Rebuild indices
    const newIndicies: Record<string, number> = {};
    newMaterials.forEach((m, i) => {
      newIndicies[m] = i;
    });

    // Rebuild type arrays
    const newTypes = {
      solid: [] as number[],
      liquid: [] as number[],
      transparent: [] as number[],
    };

    newMaterials.forEach((m, i) => {
      const type = materialsConfig?.materials[m]?.type || 'solid';
      newTypes[type].push(i);
    });

    // Update layer counts in maps
    const newMaps = { ...pallet.maps };
    Object.keys(newMaps).forEach((res) => {
      Object.keys(newMaps[res]).forEach((mapType) => {
        newMaps[res][mapType] = {
          ...newMaps[res][mapType],
          layers: newMaterials.length,
        };
      });
    });

    setPallet({
      ...pallet,
      materials: newMaterials,
      indicies: newIndicies,
      types: newTypes,
      maps: newMaps,
    });
    setHasChanges(true);
  };

  // Save changes
  const savePallet = async () => {
    if (!pallet) return;

    setSaving(true);
    try {
      const res = await fetch('/api/pallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pallet),
      });

      if (res.ok) {
        setHasChanges(false);
      } else {
        console.error('Failed to save pallet');
      }
    } catch (err) {
      console.error('Failed to save pallet:', err);
    } finally {
      setSaving(false);
    }
  };

  // Move material up/down in order
  const moveMaterial = (name: string, direction: 'up' | 'down') => {
    if (!pallet) return;

    const index = pallet.materials.indexOf(name);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= pallet.materials.length) return;

    const newMaterials = [...pallet.materials];
    [newMaterials[index], newMaterials[newIndex]] = [newMaterials[newIndex], newMaterials[index]];

    // Rebuild indices
    const newIndicies: Record<string, number> = {};
    newMaterials.forEach((m, i) => {
      newIndicies[m] = i;
    });

    // Rebuild type arrays
    const newTypes = {
      solid: [] as number[],
      liquid: [] as number[],
      transparent: [] as number[],
    };

    newMaterials.forEach((m, i) => {
      const type = materialsConfig?.materials[m]?.type || 'solid';
      newTypes[type].push(i);
    });

    setPallet({
      ...pallet,
      materials: newMaterials,
      indicies: newIndicies,
      types: newTypes,
    });
    setHasChanges(true);
  };

  // Set material to specific index, swapping with existing material at that position
  const setMaterialIndex = (name: string, targetIndex: number) => {
    if (!pallet) return;

    const currentIndex = pallet.materials.indexOf(name);
    if (currentIndex === -1) return;
    if (targetIndex < 0 || targetIndex >= pallet.materials.length) return;
    if (currentIndex === targetIndex) return;

    const newMaterials = [...pallet.materials];
    // Swap the two materials
    [newMaterials[currentIndex], newMaterials[targetIndex]] = [newMaterials[targetIndex], newMaterials[currentIndex]];

    // Rebuild indices
    const newIndicies: Record<string, number> = {};
    newMaterials.forEach((m, i) => {
      newIndicies[m] = i;
    });

    // Rebuild type arrays
    const newTypes = {
      solid: [] as number[],
      liquid: [] as number[],
      transparent: [] as number[],
    };

    newMaterials.forEach((m, i) => {
      const type = materialsConfig?.materials[m]?.type || 'solid';
      newTypes[type].push(i);
    });

    setPallet({
      ...pallet,
      materials: newMaterials,
      indicies: newIndicies,
      types: newTypes,
    });
    setHasChanges(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  const enabledCount = materials.filter((m) => m.inPallet).length;
  const configuredCount = materials.filter((m) => m.inConfig).length;
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
                {enabledCount} enabled / {configuredCount} configured / {totalCount} total materials
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {hasChanges && <span className="text-yellow-400 text-sm">Unsaved changes</span>}
            <button
              onClick={savePallet}
              disabled={saving || !hasChanges}
              className={`px-4 py-2 rounded font-medium ${
                hasChanges
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              {saving ? 'Saving...' : 'Save Pallet'}
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
            {(['all', 'enabled', 'disabled', 'unconfigured'] as const).map((f) => (
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
                {f === 'disabled' && ` (${configuredCount - enabledCount})`}
                {f === 'unconfigured' && ` (${totalCount - configuredCount})`}
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
              index={pallet?.indicies[material.name]}
              maxIndex={pallet ? pallet.materials.length - 1 : 0}
              onToggle={() => toggleMaterial(material.name)}
              onMoveUp={() => moveMaterial(material.name, 'up')}
              onMoveDown={() => moveMaterial(material.name, 'down')}
              onSetIndex={(newIndex) => setMaterialIndex(material.name, newIndex)}
              canMoveUp={
                material.inPallet && pallet ? pallet.indicies[material.name] > 0 : false
              }
              canMoveDown={
                material.inPallet && pallet
                  ? pallet.indicies[material.name] < pallet.materials.length - 1
                  : false
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
  index?: number;
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
  index,
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
        material.inPallet
          ? 'border-blue-500 bg-gray-800'
          : material.inConfig
            ? 'border-gray-600 bg-gray-800/50'
            : 'border-yellow-600/50 bg-gray-800/30'
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
        {index !== undefined && (
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
        {material.type && (
          <div
            className={`absolute top-1 right-1 ${typeColors[material.type]} text-white text-xs px-1.5 py-0.5 rounded`}
          >
            {material.type}
          </div>
        )}

        {/* Status indicators */}
        <div className="absolute bottom-1 left-1 flex gap-1">
          {!material.inConfig && (
            <span className="bg-yellow-600 text-white text-xs px-1 py-0.5 rounded" title="Not in config">
              !
            </span>
          )}
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
            disabled={!material.inConfig}
            className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
              material.inPallet
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : material.inConfig
                  ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                  : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
            }`}
            title={!material.inConfig ? 'Configure this material first' : undefined}
          >
            {material.inPallet ? 'Enabled' : 'Disabled'}
          </button>

          {material.inPallet && (
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
