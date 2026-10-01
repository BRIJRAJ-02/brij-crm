// The one place the app imports lucide-react. Every icon the app uses is listed
// here under its lucide.dev name, so only these ship and an unknown name is a
// type error. Add an icon with one import and one line.
import {
  AtSign,
  Building,
  Calendar,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  CircleQuestionMark,
  Download,
  Ellipsis,
  Globe,
  Hash,
  ListFilter,
  LoaderCircle,
  MapPin,
  Phone,
  Plus,
  Settings,
  Sparkles,
  Star,
  Tag,
  User,
  Users,
  X,
} from 'lucide-react';

/** Lucide 1.49 icons by their lucide.dev name: one per attribute type, the controls' own, plus AI and help. */
export const icons = {
  'at-sign': AtSign,
  building: Building,
  calendar: Calendar,
  'chevron-down': ChevronDown,
  'circle-alert': CircleAlert,
  'circle-check': CircleCheck,
  'circle-dollar-sign': CircleDollarSign,
  'circle-question-mark': CircleQuestionMark,
  download: Download,
  ellipsis: Ellipsis,
  globe: Globe,
  hash: Hash,
  'list-filter': ListFilter,
  'loader-circle': LoaderCircle,
  'map-pin': MapPin,
  phone: Phone,
  plus: Plus,
  settings: Settings,
  sparkles: Sparkles,
  star: Star,
  tag: Tag,
  user: User,
  users: Users,
  x: X,
} as const;

/** An icon in the registry, named exactly as lucide.dev lists it. */
export type IconName = keyof typeof icons;
