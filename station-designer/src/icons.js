import { createIcons,
  Accessibility, ArrowRight, ArrowUpRight, Blocks, BookOpen, Box, Camera, Check, ChevronDown, ChevronRight, CircleCheck, CircleHelp, CloudCheck, ConciergeBell, Copy, DoorOpen, Download, Ellipsis, ExternalLink, Eye, EyeOff, Eraser, Fence, FileJson, FilePlus2, FileUp, FolderOpen, Grid2x2, Hand, HardDrive, Image, Keyboard, Layers2, Layers3, LayoutPanelTop, ListFilter, Magnet, MapPin, Maximize, Minus, MousePointer2, Move, PackageOpen, PanelTopDashed, Paintbrush, Pencil, PenTool, Plus, RectangleHorizontal, Redo2, Rotate3d, RotateCcw, RotateCw, Save, Scan, Search, SlidersHorizontal, Sparkles, Toilet, TrainFront, TramFront, Trash2, TriangleAlert, Type, Undo2, X
} from 'lucide';
import { facilityIcon } from './facility-icons.js';

const icons = {
  Accessibility, ArrowRight, ArrowUpRight, Blocks, BookOpen, Box, Camera, Check, ChevronDown, ChevronRight, CircleCheck, CircleHelp, CloudCheck, ConciergeBell, Copy, DoorOpen, Download, Ellipsis, ExternalLink, Eye, EyeOff, Eraser, Fence, FileJson, FilePlus2, FileUp, FolderOpen, Grid2x2, Hand, HardDrive, Image, Keyboard, Layers2, Layers3, LayoutPanelTop, ListFilter, Magnet, MapPin, Maximize, Minus, MousePointer2, Move, PackageOpen, PanelTopDashed, Paintbrush, Pencil, PenTool, Plus, RectangleHorizontal, Redo2, Rotate3d, RotateCcw, RotateCw, Save, Scan, Search, SlidersHorizontal, Sparkles, Toilet, TrainFront, TramFront, Trash2, TriangleAlert, Type, Undo2, X
};
const facilityTypes = { 'door-open': 'exit', toilet: 'restroom', 'concierge-bell': 'service' };
export const icon = (name, cls = '') => facilityTypes[name] ? facilityIcon(facilityTypes[name], cls) : `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
export function refreshIcons() { createIcons({ icons, attrs: { 'stroke-width': 1.65 } }); }
