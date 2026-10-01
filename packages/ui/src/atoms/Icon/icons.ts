// The one place the app imports lucide-react. Every icon the app uses is listed
// here under its lucide.dev name, so only these ship and an unknown name is a
// type error. Add an icon with one import and one line.
import {
  AtSign,
  Building,
  Calendar,
  CircleDollarSign,
  CircleQuestionMark,
  Globe,
  Hash,
  MapPin,
  Phone,
  Sparkles,
  Star,
  Tag,
  User,
  Users,
} from 'lucide-react';

/** Lucide 1.49 icons by their lucide.dev name: one per attribute type, plus AI and help. */
export const icons = {
  'at-sign': AtSign,
  building: Building,
  calendar: Calendar,
  'circle-dollar-sign': CircleDollarSign,
  'circle-question-mark': CircleQuestionMark,
  globe: Globe,
  hash: Hash,
  'map-pin': MapPin,
  phone: Phone,
  sparkles: Sparkles,
  star: Star,
  tag: Tag,
  user: User,
  users: Users,
} as const;

/** An icon in the registry, named exactly as lucide.dev lists it. */
export type IconName = keyof typeof icons;
