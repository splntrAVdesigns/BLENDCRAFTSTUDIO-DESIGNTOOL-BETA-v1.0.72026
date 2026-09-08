// Spatial FX Chain Order Control — lets the user drag to reorder the 7
// composable spatial-domain effects (Mirror/Displace/Slice/Chroma/Blur/
// Pixelate/Shape Overlay). Reuses the exact drag pattern LayerPanel.tsx
// already established: stream the reorder on every hover tick for live
// visual feedback, commit history exactly once on drop — not once per
// tick, which would flood undo history the way an earlier layer-reorder
// bug did before that pattern was fixed there.
import { useEffect, useRef, useState } from 'react';
import { useDrag, useDrop, DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { GripVertical } from 'lucide-react';
import type { SpatialStageId } from './EffectsControls';

const STAGE_ITEM_TYPE = 'spatial-fx-stage';

const STAGE_LABELS: Record<SpatialStageId, string> = {
  mirror: 'Quad Mirror',
  displace: 'Noise Displacement',
  slice: 'Graphic Slice',
  chroma: 'Chromatic Aberration',
  blur: 'Blur',
  pixelate: 'Pixelate',
  shapeOverlay: 'Shape Overlay',
};

interface DraggableStageRowProps {
  id: SpatialStageId;
  index: number;
  isActive: boolean;
  moveStage: (from: number, to: number) => void;
  onReorderCommit?: () => void;
}

function DraggableStageRow({ id, index, isActive, moveStage, onReorderCommit }: DraggableStageRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: STAGE_ITEM_TYPE,
    item: { index },
    end: (item, monitor) => {
      if (monitor.didDrop() || item.index !== index) {
        onReorderCommit?.();
      }
    },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  const [, drop] = useDrop<{ index: number }, void, unknown>({
    accept: STAGE_ITEM_TYPE,
    hover(item, monitor) {
      if (!ref.current) return;
      const dragIndex = item.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) return;

      const rect = ref.current.getBoundingClientRect();
      const hoverMiddleY = (rect.bottom - rect.top) / 2;
      const clientOffset = monitor.getClientOffset();
      const hoverY = (clientOffset?.y ?? 0) - rect.top;

      if (dragIndex < hoverIndex && hoverY < hoverMiddleY) return;
      if (dragIndex > hoverIndex && hoverY > hoverMiddleY) return;

      moveStage(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });

  drag(handleRef);
  drop(ref);

  return (
    <div
      ref={ref}
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-opacity ${
        isDragging ? 'opacity-30' : 'opacity-100'
      } ${isActive ? 'border-zinc-700 bg-zinc-900/60 text-zinc-200' : 'border-zinc-800/60 bg-zinc-900/20 text-zinc-500'}`}
    >
      <div ref={handleRef} className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400">
        <GripVertical className="w-3.5 h-3.5" />
      </div>
      <span className="flex-1">{STAGE_LABELS[id]}</span>
      {isActive && <span className="text-[9px] font-medium uppercase tracking-wide text-blue-400">On</span>}
    </div>
  );
}

interface SpatialChainOrderControlProps {
  order: SpatialStageId[];
  activeStages: Set<SpatialStageId>;
  // Called on every hover tick during a drag — this is the "stream" side,
  // matching moveLayer()'s onReorderLayers in LayerPanel.tsx. Do NOT wire
  // this to a function that also commits undo history, or every tick
  // during a drag becomes its own history entry.
  onChange: (order: SpatialStageId[]) => void;
  // Called exactly once, when the drag ends. This is where history commits.
  onCommitHistory?: () => void;
}

export function SpatialChainOrderControl({ order, activeStages, onChange, onCommitHistory }: SpatialChainOrderControlProps) {
  const [localOrder, setLocalOrder] = useState(order);

  // Stay in sync with the parent's order when it changes from elsewhere
  // (Reset to Defaults, paste effects, loading a saved project) without a
  // drag in progress overriding it.
  useEffect(() => {
    setLocalOrder(order);
  }, [order]);

  const moveStage = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const next = [...localOrder];
    const [removed] = next.splice(from, 1);
    next.splice(to, 0, removed);
    setLocalOrder(next);
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <DndProvider backend={HTML5Backend}>
        {localOrder.map((id, index) => (
          <DraggableStageRow
            key={id}
            id={id}
            index={index}
            isActive={activeStages.has(id)}
            moveStage={moveStage}
            onReorderCommit={onCommitHistory}
          />
        ))}
      </DndProvider>
    </div>
  );
}
