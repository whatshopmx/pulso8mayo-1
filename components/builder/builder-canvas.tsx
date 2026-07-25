import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useBuilder, WorkflowStep } from "@/components/builder/builder-context";
import { getStepCategory, normalizeOptions } from "@/lib/workflow-type-map";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { GripVertical, Trash2 } from "lucide-react";

// Individual Sortable Item Component
function SortableItem({ element }: { element: WorkflowStep }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: element.id });

    const { removeStep, selectStep, selectedStepId } = useBuilder();

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    const isSelected = selectedStepId === element.id;

 const renderFieldPreview = () => {
  const cat = getStepCategory(element.type);

  switch (cat) {
  case 'TEXT':
   return <Input disabled placeholder={element.placeholder || "Short text answer..."} />;

  case 'NUMBER':
   return <Input disabled placeholder="0" type="number" />;

  case 'YESNO':
   return (
   <div className="flex items-center space-x-2">
    <Switch disabled id={element.id} />
    <Label htmlFor={element.id}>{element.title}</Label>
   </div>
   );

  case 'SELECT': {
   const options = normalizeOptions(element.options || element.config?.options);
   return (
   <Select disabled>
    <SelectTrigger>
    <SelectValue placeholder={options.length > 0 ? options[0] : "Seleccionar..."} />
    </SelectTrigger>
   </Select>
   );
  }

  case 'CHECKBOX': {
   const items = normalizeOptions(element.options || element.config?.options);
   return (
   <div className="flex flex-col gap-2">
    {items.length > 0 ? items.slice(0, 3).map((opt, i) => (
    <div key={i} className="flex items-center space-x-2">
     <Checkbox disabled id={`${element.id}-${i}`} />
     <Label htmlFor={`${element.id}-${i}`}>{opt}</Label>
    </div>
    )) : <div className="text-sm text-muted-foreground">No options defined</div>}
    {items.length > 3 && <div className="text-xs text-muted-foreground">+{items.length - 3} more</div>}
   </div>
   );
  }

  case 'PHOTO':
  case 'VIDEO':
   return (
   <div className="h-20 border-2 border-dashed rounded flex items-center justify-center text-muted-foreground bg-accent/10">
    <span className="text-xs">{cat === 'VIDEO' ? 'Video' : 'Photo'} Upload Area</span>
   </div>
   );

  case 'TIME':
  case 'DATE':
  case 'TIMER':
   return <Input disabled placeholder={cat === 'DATE' ? '2024-01-01' : '00:00'} type={cat === 'DATE' ? 'datetime-local' : 'time'} />;

  case 'SIGNATURE':
   return (
   <div className="h-20 border-2 border-dashed rounded flex items-center justify-center text-muted-foreground bg-accent/10">
    <span className="text-xs">Signature Area</span>
   </div>
   );

  case 'LOCATION':
   return (
   <div className="h-20 border-2 border-dashed rounded flex items-center justify-center text-muted-foreground bg-accent/10">
    <span className="text-xs">GPS Location</span>
   </div>
   );

  case 'AUDIO':
   return (
   <div className="h-20 border-2 border-dashed rounded flex items-center justify-center text-muted-foreground bg-accent/10">
    <span className="text-xs">Audio Note</span>
   </div>
   );

  case 'INFO':
   if (element.type === 'Separator') {
   return <Separator className="my-1" />;
   }
   return (
   <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded text-sm text-blue-700 dark:text-blue-300">
   {element.description || element.title}
   </div>
   );

  default:
   return <Input disabled placeholder="Type answer here..." />;
  }
 };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "relative group flex items-start gap-4 p-4 mb-3 bg-card border rounded-lg transition-all",
                isDragging ? "opacity-50 z-50 shadow-xl" : "",
                isSelected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50"
            )}
            onClick={(e) => {
                e.stopPropagation();
                selectStep(element.id);
            }}
        >
            {/* Drag Handle */}
            <div
                {...attributes}
                {...listeners}
                className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
            >
                <GripVertical size={20} />
            </div>

            {/* Content */}
            <div className="flex-1 space-y-2 pointer-events-none">
                <Label className="font-medium">
                    {element.title} {element.required && <span className="text-red-500">*</span>}
                </Label>
                {element.description && <p className="text-xs text-muted-foreground mb-2">{element.description}</p>}

                {renderFieldPreview()}
            </div>

            {/* Actions */}
            <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => {
                    e.stopPropagation();
                    removeStep(element.id);
                }}
            >
                <Trash2 size={18} />
            </Button>
        </div>
    );
}

export function BuilderCanvas() {
    const { steps, selectStep, moveStep } = useBuilder();

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            moveStep(active.id as string, over.id as string);
        }
    }

    return (
        <div
            className="w-full min-h-[500px]"
            onClick={() => selectStep(null)} // Deselect when clicking background
        >
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={steps.map(el => el.id)}
                    strategy={verticalListSortingStrategy}
                >
                    {steps.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-lg text-muted-foreground">
                            <p>Your form is empty</p>
                            <p className="text-sm">Select a tool to start building</p>
                        </div>
                    ) : (
                        steps.map((step) => (
                            <SortableItem key={step.id} element={step} />
                        ))
                    )}
                </SortableContext>
            </DndContext>
        </div>
    );
}
