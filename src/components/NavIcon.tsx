import {
  AlertTriangle,
  Banknote,
  Baby,
  BarChart3,
  Building2,
  CalendarCheck,
  ClipboardCheck,
  Clock,
  DoorOpen,
  Ellipsis,
  House,
  Inbox,
  Plus,
  Receipt,
  Sun,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon as NavIconName } from "@/lib/roles";

const icons: Record<NavIconName, LucideIcon> = {
  home: House,
  building: Building2,
  inbox: Inbox,
  chart: BarChart3,
  wrench: Wrench,
  sun: Sun,
  child: Baby,
  plus: Plus,
  money: Wallet,
  receipt: Receipt,
  "calendar-check": CalendarCheck,
  cash: Banknote,
  door: DoorOpen,
  "check-list": ClipboardCheck,
  alert: AlertTriangle,
  people: Users,
  clock: Clock,
  more: Ellipsis,
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = icons[name];
  return <Icon aria-hidden="true" className={className} strokeWidth={1.75} />;
}
