/**
 * Gradient Favorites Panel
 * Save, manage, and load favorite gradients
 */

import React, { useState, useEffect } from 'react';
import { Star, Trash2, Download, Upload, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Card } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { Input } from '../ui/input';
import { toast } from 'sonner';
import type { GradientConfig } from '../../types/gradient';
import { validateUploadFile, validateJsonImportText } from '../../utils/uploadValidation';

interface GradientFavoritesPanelProps {
  onGradientGenerated: (gradient: GradientConfig) => void;
}

interface SavedGradient {
  id: string;
  name: string;
  gradient: GradientConfig;
  timestamp: number;
}

export function GradientFavoritesPanel({ onGradientGenerated }: GradientFavoritesPanelProps) {
  const [favorites, setFavorites] = useState<SavedGradient[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Load favorites from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('gradient-favorites');
    if (saved) {
      try {
        setFavorites(JSON.parse(saved));
      } catch (error) {
        console.error('Failed to load favorites:', error);
      }
    }
    
    // Listen for favorites updates
    const handleFavoritesUpdate = () => {
      const updated = localStorage.getItem('gradient-favorites');
      if (updated) {
        try {
          setFavorites(JSON.parse(updated));
        } catch (error) {
          console.error('Failed to reload favorites:', error);
        }
      }
    };
    
    window.addEventListener('gradientFavoritesUpdated', handleFavoritesUpdate);
    
    return () => {
      window.removeEventListener('gradientFavoritesUpdated', handleFavoritesUpdate);
    };
  }, []);

  // Save favorites to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('gradient-favorites', JSON.stringify(favorites));
  }, [favorites]);

  const addToFavorites = (gradient: GradientConfig, name?: string) => {
    const newFavorite: SavedGradient = {
      id: `fav-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name || `Gradient ${favorites.length + 1}`,
      gradient,
      timestamp: Date.now(),
    };

    setFavorites([newFavorite, ...favorites]);
    toast.success(`Added "${newFavorite.name}" to favorites!`);
  };

  const removeFavorite = (id: string) => {
    const favorite = favorites.find(f => f.id === id);
    setFavorites(favorites.filter(f => f.id !== id));
    toast.success(`Removed "${favorite?.name}" from favorites`);
  };

  const applyFavorite = (gradient: GradientConfig, name: string) => {
    onGradientGenerated(gradient);
    toast.success(`Applied "${name}"`);
  };

  const startEditing = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingName(currentName);
  };

  const saveEdit = (id: string) => {
    if (editingName.trim()) {
      setFavorites(favorites.map(f => 
        f.id === id ? { ...f, name: editingName.trim() } : f
      ));
      toast.success('Name updated!');
    }
    setEditingId(null);
    setEditingName('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const exportFavorites = () => {
    const dataStr = JSON.stringify(favorites, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gradient-favorites-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Favorites exported!');
  };

  const importFavorites = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const fileValidation = validateUploadFile(file, 'json-import');
        if (!fileValidation.ok) {
          toast.error(fileValidation.error || 'Invalid favorites import file');
          input.value = '';
          return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const rawJson = event.target?.result as string;
            const jsonValidation = validateJsonImportText(rawJson);
            if (!jsonValidation.ok) {
              toast.error(jsonValidation.error || 'Invalid favorites JSON');
              return;
            }
            const imported = JSON.parse(rawJson);
            if (!Array.isArray(imported)) {
              toast.error('Favorites import must be a JSON array');
              return;
            }
            setFavorites([...imported, ...favorites]);
            toast.success(`Imported ${imported.length} favorites!`);
          } catch (error) {
            toast.error('Failed to import favorites');
          }
        };
        reader.onerror = () => toast.error('Unable to read favorites import file');
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const clearAllFavorites = () => {
    if (confirm('Are you sure you want to clear all favorites? This cannot be undone.')) {
      setFavorites([]);
      toast.success('All favorites cleared');
    }
  };

  const renderGradientPreview = (gradient: GradientConfig) => {
    let backgroundStyle: string;

    switch (gradient.type) {
      case 'linear':
        backgroundStyle = `linear-gradient(${gradient.angle}deg, ${gradient.colors
          .map(c => `${c.color} ${c.position * 100}%`)
          .join(', ')})`;
        break;
      case 'radial':
        backgroundStyle = `radial-gradient(circle at ${gradient.centerX * 100}% ${gradient.centerY * 100}%, ${gradient.colors
          .map(c => `${c.color} ${c.position * 100}%`)
          .join(', ')})`;
        break;
      case 'conic':
        backgroundStyle = `conic-gradient(from ${gradient.angle}deg at ${gradient.centerX * 100}% ${gradient.centerY * 100}%, ${gradient.colors
          .map(c => `${c.color} ${c.position * 360}deg`)
          .join(', ')})`;
        break;
      case 'voronoi':
        // CSS approximation - use radial gradient
        backgroundStyle = `radial-gradient(circle, ${gradient.colors
          .map(c => `${c.color} ${c.position * 100}%`)
          .join(', ')})`;
        break;
      case 'diamond':
        // CSS approximation - use conic gradient
        backgroundStyle = `conic-gradient(${gradient.colors
          .map(c => `${c.color} ${c.position * 360}deg`)
          .join(', ')})`;
        break;
      default:
        backgroundStyle = `linear-gradient(180deg, ${gradient.colors
          .map(c => `${c.color} ${c.position * 100}%`)
          .join(', ')})`;
    }

    return (
      <div
        className="w-full h-16 rounded border-2 border-zinc-700 shadow-lg"
        style={{ background: backgroundStyle }}
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* Header Actions */}
      <div className="flex gap-2">
        <Button
          onClick={exportFavorites}
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={favorites.length === 0}
        >
          <Download className="w-3 h-3 mr-1" />
          Export
        </Button>
        <Button
          onClick={importFavorites}
          variant="outline"
          size="sm"
          className="flex-1"
        >
          <Upload className="w-3 h-3 mr-1" />
          Import
        </Button>
      </div>

      {/* Favorites Count */}
      <div className="text-xs text-zinc-400 text-center">
        {favorites.length} {favorites.length === 1 ? 'favorite' : 'favorites'} saved
      </div>

      {/* Favorites List */}
      {favorites.length === 0 ? (
        <Card className="p-6 bg-zinc-900 border-zinc-800 text-center">
          <Star className="w-12 h-12 mx-auto mb-3 text-zinc-700" />
          <p className="text-sm text-zinc-400 mb-1">No favorites yet</p>
          <p className="text-xs text-zinc-500">
            Save your favorite gradients for quick access
          </p>
        </Card>
      ) : (
        <ScrollArea className="h-[300px] border border-zinc-800 rounded-lg bg-zinc-950">
          <div className="p-2 space-y-2">
            {favorites.map((favorite) => (
              <Card key={favorite.id} className="p-2 bg-zinc-900 border-zinc-800">
                {renderGradientPreview(favorite.gradient)}
                
                <div className="mt-2 space-y-2">
                  {editingId === favorite.id ? (
                    <div className="flex gap-1">
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(favorite.id);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        className="h-7 text-xs bg-zinc-800 border-zinc-700"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={() => saveEdit(favorite.id)}
                        className="h-7 px-2"
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={cancelEdit}
                        className="h-7 px-2"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      className="text-xs font-medium cursor-pointer hover:text-[#51a2ff] transition-colors"
                      onClick={() => startEditing(favorite.id, favorite.name)}
                    >
                      {favorite.name}
                    </div>
                  )}

                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      onClick={() => applyFavorite(favorite.gradient, favorite.name)}
                      className="flex-1 h-7 text-xs bg-gradient-to-r from-[#5200FF] to-[#7000FF] hover:from-[#4400DD] hover:to-[#6000DD]"
                    >
                      Apply
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeFavorite(favorite.id)}
                      className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-950/20"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>

                  <div className="text-xs text-zinc-500">
                    {favorite.gradient.type} • {favorite.gradient.colors.length} colors
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Clear All */}
      {favorites.length > 0 && (
        <Button
          onClick={clearAllFavorites}
          variant="outline"
          size="sm"
          className="w-full text-red-400 hover:text-red-300 border-red-900/30 hover:bg-red-950/20"
        >
          Clear All Favorites
        </Button>
      )}

      {/* Tips */}
      <Card className="p-3 bg-zinc-900/50 border-zinc-800">
        <div className="text-xs text-zinc-400 space-y-1">
          <p className="font-medium text-zinc-300 mb-2">💡 Tips:</p>
          <p>• Click gradient name to rename</p>
          <p>• Export favorites to backup or share</p>
          <p>• Import favorites from exported files</p>
        </div>
      </Card>
    </div>
  );
}